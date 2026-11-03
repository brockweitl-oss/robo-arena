/**
 * Robo Arena online relay (Cloudflare Worker + Durable Objects).
 *
 * The game is a deterministic lockstep sim, so the server never simulates anything:
 * - Room (one per room code): seats two players, exchanges their builds, picks the match
 *   seed, relays per-tick inputs, and (ranked) settles results both clients agree on.
 * - Lobby (one per queue): quick match / ranked queue. Pairs waiting players and hands
 *   both the same fresh room code. Ranked prefers the closest rating among waiters.
 * - Ratings (one global): Elo ratings in SQLite, keyed by a hash of each player's private key.
 *   Ratings are per season (calendar month, UTC) with placements and a soft reset; the
 *   season math lives in src/net/season.ts and is shared with the client. Also holds the
 *   per-season survival (gauntlet) leaderboard.
 * - Replays (one global): shared replay JSON behind 6-character codes, expiring after 30 days.
 *
 * Messages are JSON strings. Client -> room: hello, ready, result; anything else is relayed.
 * Room -> client: seat, peer, start, rated, left, error.
 *
 * Spectators (`/room/CODE?spectate=1`) take no seat and send nothing that is relayed. They get
 * `watch`, then the current match's `start` (players' builds + seed) and a `log` batch of every
 * input so far, then each player's input live, tagged with the sender's slot (`"s":0|1`).
 * `/live` lists rooms with a match in progress (names, arena, start time) for the watch screen.
 */
import { DurableObject } from 'cloudflare:workers';
import { START, PLACEMENT_GAMES, carryRating, kFactor, isPlaced, isSeasonId, prevSeason, rankOf, seasonEnds, seasonOf } from '../../src/net/season';

interface Env {
  ROOMS: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  RATINGS: DurableObjectNamespace<Ratings>;
  REPLAYS: DurableObjectNamespace<Replays>;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'content-type': 'application/json' } });
const ratings = (env: Env) => env.RATINGS.get(env.RATINGS.idFromName('global'));
const replays = (env: Env) => env.REPLAYS.get(env.REPLAYS.idFromName('global'));
/** Read a small request body (rejects anything over `max` bytes). */
async function body(req: Request, max: number): Promise<string | undefined> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > max) return undefined;
  const t = await req.text();
  return t.length > max ? undefined : t;
}
/** The live-match directory: one well-known Lobby instance (no extra binding or migration needed). */
const live = (env: Env) => (env.LOBBY as DurableObjectNamespace<Lobby>).get(env.LOBBY.idFromName('live'));

async function keyHash(key: unknown): Promise<string | undefined> {
  if (typeof key !== 'string' || key.length < 16 || key.length > 64) return undefined;
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(d).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}
const cleanName = (n: unknown) => (typeof n === 'string' ? n.replace(/[^\w \-.]/g, '').trim().slice(0, 16) : '') || 'Pilot';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname === '/new') return json({ code: newCode() });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const season = url.searchParams.get('season');
    if (season !== null && !isSeasonId(season)) return json({ error: 'bad season' }, 400);
    if (url.pathname === '/season') return json(await ratings(env).seasonInfo());
    // old clients read an array of {name, rating, games, wins}; season fields are extra
    if (url.pathname === '/top') return json(await ratings(env).top(season ?? undefined));
    if (url.pathname === '/live') return json(await live(env).list());
    if (url.pathname === '/me') {
      const k = await keyHash(url.searchParams.get('key'));
      return k ? json(await ratings(env).me(k)) : json({ error: 'bad key' }, 400);
    }
    if (url.pathname === '/survival' && req.method === 'POST') {
      let b: { key?: unknown; name?: unknown; rounds?: unknown; build?: unknown };
      try { b = JSON.parse((await body(req, 2048)) ?? ''); } catch { return json({ error: 'bad body' }, 400); }
      const k = await keyHash(b.key);
      const rounds = b.rounds;
      if (!k) return json({ error: 'bad key' }, 400);
      if (typeof rounds !== 'number' || !Number.isInteger(rounds) || rounds < 1 || rounds > MAX_SURVIVAL) return json({ error: 'bad rounds' }, 400);
      return json(await ratings(env).survivalPost(k, cleanName(b.name), rounds, cleanBuild(b.build)));
    }
    if (url.pathname === '/survival/top') {
      const k = await keyHash(url.searchParams.get('key'));
      return json(await ratings(env).survivalTop(season ?? undefined, k));
    }
    if (url.pathname === '/replay' && req.method === 'POST') {
      const t = await body(req, MAX_REPLAY);
      if (t === undefined) return json({ error: 'too large' }, 413);
      const r = await replays(env).put(t, req.headers.get('cf-connecting-ip') ?? '');
      return 'code' in r ? json(r) : json(r, r.error === 'slow down' ? 429 : 400);
    }
    const rp = url.pathname.match(/^\/replay\/([A-Z0-9]{6})$/);
    if (rp) {
      const t = await replays(env).get(rp[1]);
      return t ? new Response(t, { headers: { ...CORS, 'content-type': 'application/json' } }) : json({ error: 'not found' }, 404);
    }
    const m = url.pathname.match(/^\/room\/([A-Z0-9]{5})$/);
    if (m) return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    if (url.pathname === '/quick') return env.LOBBY.get(env.LOBBY.idFromName(url.searchParams.get('ranked') ? 'ranked' : 'main')).fetch(req);
    return json({ error: 'not found' }, 404);
  },
};

function upgrade(req: Request): [WebSocket, Response] | Response {
  if (req.headers.get('upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
  const pair = new WebSocketPair();
  return [pair[1], new Response(null, { status: 101, webSocket: pair[0] })];
}

interface Seat {
  /** 0/1 players; -1 rejected; -2 spectator. */
  slot: 0 | 1 | -1 | -2;
  /** Room code (from the URL; the live directory is keyed by it). */
  code?: string;
  hello?: Record<string, unknown>;
  /** Hash of the private key (never sent to the other player). */
  k?: string;
  ready?: boolean;
  /** Reported winner for the current ranked match. */
  result?: number;
}

/** Most input messages a room keeps for late-joining spectators (two players, 60 Hz, ~5 minutes). */
const LOG_MAX = 36000;
/** Most messages a player may send per second (60 inputs/s normally, ~300/s catching up after a stall). */
const MSG_PER_SEC = 900;
/** Most spectators per room. */
const MAX_SPECTATORS = 64;

/** A ranked result reported by a player who then left, waiting for the other player's report. */
interface PendingResult { k: string; name: string; slot: 0 | 1; result: number }

export class Room extends DurableObject<Env> {
  private ranked = false;
  private settled = true;
  /** Current match: its start message (also persisted) and every relayed input, tagged by slot. */
  private startMsg: string | null = null;
  private log: string[] = [];
  private loaded = false;
  private pending: PendingResult | null = null;
  /** Per-socket message budget for the current second (memory only; resetting on wake is fine). */
  private budget = new WeakMap<WebSocket, { sec: number; n: number }>();

  /**
   * Woke from hibernation (or a fresh instance): the current match's start message and ranked
   * state live in storage, so a rated match is still settled (or forfeited) correctly.
   */
  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    const st = await this.ctx.storage.get<string | boolean | PendingResult>(['start', 'ranked', 'settled', 'pending']);
    this.startMsg ??= (st.get('start') as string | undefined) ?? null;
    if (st.has('ranked')) this.ranked = !!st.get('ranked');
    if (st.has('settled')) this.settled = !!st.get('settled');
    this.pending = (st.get('pending') as PendingResult | undefined) ?? null;
  }

  private async settle() {
    this.settled = true;
    this.pending = null;
    await this.ctx.storage.put('settled', true);
    await this.ctx.storage.delete('pending');
  }

  /** Over this second's budget: the message is dropped (a flood never reaches the other player). */
  private flooding(ws: WebSocket): boolean {
    const sec = Math.floor(Date.now() / 1000);
    let b = this.budget.get(ws);
    if (!b || b.sec !== sec) this.budget.set(ws, (b = { sec, n: 0 }));
    return ++b.n > MSG_PER_SEC;
  }

  private rate(a: { k: string; name: string }, b: { k: string; name: string }, winner: number) {
    return ratings(this.env).report({ k: a.k, name: a.name }, { k: b.k, name: b.name }, winner);
  }

  private spectators(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Seat | null)?.slot === -2);
  }

  private seats(): { ws: WebSocket; seat: Seat }[] {
    return this.ctx.getWebSockets().map((ws) => ({ ws, seat: ws.deserializeAttachment() as Seat }));
  }

  async fetch(req: Request): Promise<Response> {
    const up = upgrade(req);
    if (up instanceof Response) return up;
    const [ws, res] = up;
    const url = new URL(req.url);
    const code = url.pathname.split('/').pop();
    if (url.searchParams.get('spectate')) {
      this.ctx.acceptWebSocket(ws);
      if (this.spectators().length > MAX_SPECTATORS) {
        ws.serializeAttachment({ slot: -1 } satisfies Seat);
        ws.send(JSON.stringify({ t: 'error', reason: 'full' }));
        ws.close(4001, 'too many spectators');
        return res;
      }
      ws.serializeAttachment({ slot: -2, code } satisfies Seat);
      const names = this.seats().filter((s) => s.seat.slot === 0 || s.seat.slot === 1).sort((a, b) => a.seat.slot - b.seat.slot)
        .map((s) => String(s.seat.hello?.name ?? 'Pilot'));
      ws.send(JSON.stringify({ t: 'watch', players: names }));
      await this.load();
      if (this.startMsg) {
        ws.send(this.startMsg);
        if (this.log.length) ws.send(`{"t":"log","m":[${this.log.join(',')}]}`);
      }
      return res;
    }
    const taken = this.seats().map((s) => s.seat.slot).filter((s) => s === 0 || s === 1);
    this.ctx.acceptWebSocket(ws);
    if (taken.length >= 2) {
      ws.serializeAttachment({ slot: -1 });
      ws.send(JSON.stringify({ t: 'error', reason: 'full' }));
      ws.close(4001, 'room full');
      return res;
    }
    const slot: 0 | 1 = taken.includes(0) ? 1 : 0;
    ws.serializeAttachment({ slot, code } satisfies Seat);
    ws.send(JSON.stringify({ t: 'seat', slot }));
    return res;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 4096) return;
    const me = ws.deserializeAttachment() as Seat;
    if (me.slot !== 0 && me.slot !== 1) return;
    if (this.flooding(ws)) return;
    await this.load();
    const other = this.seats().find((s) => s.ws !== ws && (s.seat.slot === 0 || s.seat.slot === 1));
    // hot path: relay inputs untouched
    if (!raw.startsWith('{"t":"hello"') && !raw.startsWith('{"t":"ready"') && !raw.startsWith('{"t":"result"')) {
      other?.ws.send(raw);
      if (raw.startsWith('{"t":"i"') && this.startMsg) {
        // spectators: the same input, tagged with its sender's slot
        const tagged = `{"s":${me.slot},${raw.slice(1)}`;
        if (this.log.length < LOG_MAX) this.log.push(tagged);
        for (const sp of this.spectators()) try { sp.send(tagged); } catch { /* closed */ }
      }
      return;
    }
    let msg: { t: string; [k: string]: unknown };
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'hello') {
      const { key, ...pub } = msg;
      me.k = await keyHash(key);
      pub.name = cleanName(pub.name);
      // ratings come from the server only
      delete pub.rating;
      delete pub.placed;
      if (me.k) {
        const r = await ratings(this.env).get(me.k);
        pub.rating = r.rating;
        pub.placed = isPlaced(r.games);
      }
      me.hello = pub;
      me.ready = false;
      ws.serializeAttachment(me);
      // re-read the other seat: its hello may have landed while we awaited the rating
      const other = this.seats().find((s) => s.ws !== ws && (s.seat.slot === 0 || s.seat.slot === 1));
      if (other?.seat.hello) {
        ws.send(JSON.stringify({ t: 'peer', hello: other.seat.hello }));
        other.ws.send(JSON.stringify({ t: 'peer', hello: pub }));
      }
      return;
    }

    if (msg.t === 'result') {
      // ranked: both clients must report the same winner (world ids; -1 = draw)
      if (this.settled) return;
      const res = typeof msg.winner === 'number' && [-2, -1, 0, 1].includes(msg.winner) ? msg.winner : -2;
      if (!other) {
        // the opponent reported and left first (e.g. closed the tab during the outro)
        const p = this.pending;
        if (!p || !me.k) return;
        await this.settle();
        if (res !== p.result || res === -2 || p.k === me.k) { ws.send(JSON.stringify({ t: 'rated', counted: false })); return; }
        const [a, b] = [{ k: me.k, name: String(me.hello?.name ?? 'Pilot'), slot: me.slot }, p].sort((x, y) => x.slot - y.slot);
        const r = await this.rate(a, b, res);
        ws.send(JSON.stringify({ t: 'rated', counted: true, ...r }));
        return;
      }
      me.result = res;
      ws.serializeAttachment(me);
      if (other.seat.result === undefined) return;
      await this.settle();
      const [a, b] = [me, other.seat].sort((x, y) => x.slot - y.slot);
      if (a.result !== b.result || a.result === -2 || !a.k || !b.k || a.k === b.k) {
        const e = JSON.stringify({ t: 'rated', counted: false });
        ws.send(e); other.ws.send(e);
        return;
      }
      const r = await this.rate(
        { k: a.k, name: String(a.hello?.name ?? 'Pilot') }, { k: b.k, name: String(b.hello?.name ?? 'Pilot') }, a.result!);
      const out = JSON.stringify({ t: 'rated', counted: true, ...r });
      ws.send(out); other.ws.send(out);
      return;
    }

    // ready: start once both seats are ready with matching rules
    me.ready = true;
    // an early report stays until the match settles (a fast "Fight!" click must not wipe it)
    if (this.settled) me.result = undefined;
    ws.serializeAttachment(me);
    if (!other || !other.seat.ready || !me.hello || !other.seat.hello) return;
    const h = [me, other.seat].sort((a, b) => a.slot - b.slot).map((s) => s.hello!);
    if (h[0].ruleset !== h[1].ruleset) {
      const e = JSON.stringify({ t: 'error', reason: 'version' });
      ws.send(e); other.ws.send(e);
      return;
    }
    this.ranked = !!h[0].ranked && !!h[1].ranked;
    this.settled = !this.ranked;
    this.pending = null;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647;
    const start = { t: 'start', seed, arena: h[0].arena, players: h, ranked: this.ranked };
    // spectators see the new match from its first input
    this.startMsg = JSON.stringify({ ...start, spectate: true });
    this.log = [];
    for (const sp of this.spectators()) try { sp.send(this.startMsg); } catch { /* closed */ }
    other.seat.ready = false;
    other.seat.result = undefined;
    me.ready = false;
    me.result = undefined;
    ws.serializeAttachment(me);
    other.ws.serializeAttachment(other.seat);
    ws.send(JSON.stringify(start));
    other.ws.send(JSON.stringify(start));
    // after the players have their start: persist it (late spectators) and the ranked state (hibernation)
    await this.ctx.storage.put({ start: this.startMsg, ranked: this.ranked, settled: this.settled });
    await this.ctx.storage.delete('pending');
    if (me.code) {
      await live(this.env).set(me.code, { names: h.map((x) => String(x.name ?? 'Pilot')), arena: String(h[0].arena ?? ''), ranked: this.ranked, at: Date.now() })
        .catch(() => undefined);
    }
  }

  async webSocketClose(ws: WebSocket) {
    const me = ws.deserializeAttachment() as (Seat & { gone?: boolean }) | null;
    if (!me || (me.slot !== 0 && me.slot !== 1)) return;
    // a socket can report close and error: only the first counts
    if (me.gone) return;
    ws.serializeAttachment({ ...me, gone: true });
    await this.load();
    if (me.code) await live(this.env).set(me.code, null).catch(() => undefined);
    this.startMsg = null;
    this.log = [];
    await this.ctx.storage.delete('start');
    for (const s of this.seats()) if (s.ws !== ws) try { s.ws.send(JSON.stringify({ t: 'left', slot: me.slot })); } catch { /* closed */ }
    if (this.settled) return;
    const other = this.seats().find((s) => s.ws !== ws && (s.seat.slot === 0 || s.seat.slot === 1) && !(s.seat as Seat & { gone?: boolean }).gone);
    const name = String(me.hello?.name ?? 'Pilot');
    if (!other) {
      // both gone: the first reported and left, the second left without reporting (a forfeit)
      const p = this.pending;
      await this.settle();
      if (p && me.k && p.k !== me.k && me.result === undefined) {
        const [a, b] = [{ k: me.k, name, slot: me.slot }, p].sort((x, y) => x.slot - y.slot);
        await this.rate(a, b, p.slot);
      }
      return;
    }
    if (!me.k || !other.seat.k || other.seat.k === me.k) { await this.settle(); return; }
    const them = { k: other.seat.k, name: String(other.seat.hello?.name ?? 'Pilot'), slot: other.seat.slot };
    const [a, b] = [{ k: me.k, name, slot: me.slot }, them].sort((x, y) => x.slot - y.slot);
    const res = me.result;
    const tell = (o: unknown) => { try { other.ws.send(JSON.stringify(o)); } catch { /* closed */ } };
    if (res === undefined) {
      // leaving an unsettled, unreported ranked match counts as a loss
      await this.settle();
      tell({ t: 'rated', counted: true, forfeit: true, ...(await this.rate(a, b, other.seat.slot)) });
      return;
    }
    if (res === me.slot && other.seat.result === undefined) {
      // the leaver claims the win (e.g. closed the tab during the outro): the other player's own
      // report is on its way and settles it (see 'result')
      this.pending = { k: me.k, name, slot: me.slot, result: res };
      await this.ctx.storage.put('pending', this.pending);
      return;
    }
    // the leaver reported a desync, a draw or a loss (nobody gains from those), or both had reported
    // and disagreed: settle on the report if the other side agrees or has not said otherwise
    await this.settle();
    const agree = res !== -2 && res !== me.slot && (other.seat.result === undefined || other.seat.result === res);
    tell(agree ? { t: 'rated', counted: true, ...(await this.rate(a, b, res)) } : { t: 'rated', counted: false });
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
}

export interface LiveRoom { names: string[]; arena: string; ranked: boolean; at: number }

export class Lobby extends DurableObject<Env> {
  /** Live directory (only on the 'live' instance): a room's match starts or its players leave. */
  async set(code: string, info: LiveRoom | null) {
    if (!/^[A-Z0-9]{5}$/.test(code)) return;
    if (info) {
      await this.ctx.storage.put(`room:${code}`, info);
      // drop stale entries here too: rooms nobody listed would otherwise pile up forever
      await this.list();
    } else await this.ctx.storage.delete(`room:${code}`);
  }

  /** Rooms whose match started in the last 4 minutes, newest first (stale entries are dropped). */
  async list(): Promise<(LiveRoom & { code: string })[]> {
    const now = Date.now();
    const out: (LiveRoom & { code: string })[] = [];
    const stale: string[] = [];
    for (const [k, v] of await this.ctx.storage.list<LiveRoom>({ prefix: 'room:' })) {
      if (now - v.at > 4 * 60_000) stale.push(k);
      else out.push({ code: k.slice(5), ...v, names: v.names.map(cleanName) });
    }
    if (stale.length) await this.ctx.storage.delete(stale);
    return out.sort((a, b) => b.at - a.at).slice(0, 20);
  }

  async fetch(req: Request): Promise<Response> {
    const up = upgrade(req);
    if (up instanceof Response) return up;
    const [ws, res] = up;
    const url = new URL(req.url);
    const k = await keyHash(url.searchParams.get('key'));
    const rating = k ? (await ratings(this.env).get(k)).rating : 1000;
    type W = { k?: string; rating: number; matched?: boolean };
    // matched sockets may still be listed while they close: never hand one out twice
    const waiting = this.ctx.getWebSockets('wait').filter((w) => {
      const a = w.deserializeAttachment() as W | null;
      return !!a && !a.matched && (a.k !== k || !k);
    });
    this.ctx.acceptWebSocket(ws, ['wait']);
    ws.serializeAttachment({ k, rating } satisfies W);
    // closest rating first (FIFO among equals); a waiter whose connection died is skipped
    const byRating = waiting
      .map((w, i) => ({ w, i, d: Math.abs((w.deserializeAttachment() as W).rating - rating) }))
      .sort((x, y) => x.d - y.d || x.i - y.i);
    for (const { w: peer } of byRating) {
      const code = newCode();
      try {
        peer.send(JSON.stringify({ t: 'match', code, host: true }));
      } catch {
        try { peer.close(1011, 'gone'); } catch { /* already closed */ }
        continue;
      }
      peer.serializeAttachment({ ...(peer.deserializeAttachment() as W), matched: true });
      ws.serializeAttachment({ k, rating, matched: true } satisfies W);
      ws.send(JSON.stringify({ t: 'match', code, host: false }));
      try { peer.close(1000, 'matched'); } catch { /* closed */ }
      ws.close(1000, 'matched');
      return res;
    }
    ws.send(JSON.stringify({ t: 'waiting' }));
    return res;
  }

  async webSocketMessage() { /* keep-alive pings only */ }
  async webSocketClose(ws: WebSocket) { try { ws.close(); } catch { /* already closed */ } }
}


/* ------------------------------------------------------------------ ratings, seasons, survival */

const MAX_SURVIVAL = 500;
const BUILD_SLOTS = ['gun', 'bomb', 'pod', 'body', 'legs', 'skill'] as const;
/** A survival build: six part ids, sanitized (unknown ids are just shown as text). */
function cleanBuild(b: unknown): Record<string, string> {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  return Object.fromEntries(BUILD_SLOTS.map((s) => [s, typeof o[s] === 'string' ? (o[s] as string).replace(/[^\w-]/g, '').slice(0, 24) : '']));
}

interface SeasonRow { name: string; rating: number; games: number; wins: number; peak: number | null }

export class Ratings extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    // players: lifetime games/wins plus the latest rating (kept for the pre-season fallback)
    sql.exec(`CREATE TABLE IF NOT EXISTS players (k TEXT PRIMARY KEY, name TEXT, rating REAL, games INTEGER, wins INTEGER)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS seasons (season TEXT, k TEXT, name TEXT, rating REAL, games INTEGER, wins INTEGER, peak REAL, PRIMARY KEY (season, k))`);
    sql.exec(`CREATE TABLE IF NOT EXISTS survival (season TEXT, k TEXT, name TEXT, rounds INTEGER, build TEXT, at INTEGER, PRIMARY KEY (season, k))`);
    sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
    // One-time cleanup: an early relay test run against the live server wrote "Ann" and "Bob".
    // Only rows with exactly those names and at most 3 games are dropped.
    if (!sql.exec(`SELECT 1 FROM meta WHERE key = 'drop-test-rows'`).toArray().length) {
      sql.exec(`DELETE FROM players WHERE name IN ('Ann', 'Bob') AND games <= 3`);
      sql.exec(`DELETE FROM seasons WHERE name IN ('Ann', 'Bob') AND games <= 3`);
      sql.exec(`INSERT INTO meta (key, value) VALUES ('drop-test-rows', ?)`, new Date().toISOString());
    }
  }

  private life(k: string) {
    return this.ctx.storage.sql.exec(`SELECT name, rating, games, wins FROM players WHERE k = ?`, k).toArray()[0] as
      { name: string; rating: number; games: number; wins: number } | undefined;
  }

  /** This season's record. A player's first look at a new season soft-resets their last one. */
  private seasonRow(k: string, season = seasonOf()): SeasonRow {
    const sql = this.ctx.storage.sql;
    const row = sql.exec(`SELECT name, rating, games, wins, peak FROM seasons WHERE season = ? AND k = ?`, season, k).toArray()[0] as SeasonRow | undefined;
    if (row) return row;
    const last = sql.exec(`SELECT season, name, rating FROM seasons WHERE k = ? AND season < ? ORDER BY season DESC LIMIT 1`, k, season).toArray()[0] as
      { season: string; name: string; rating: number } | undefined;
    // one soft reset per season that went by
    if (last) return { name: last.name, rating: carryRating(last.season, last.rating, season), games: 0, wins: 0, peak: null };
    // ratings from before seasons existed carry into the player's first season unchanged
    const old = this.life(k);
    return { name: old?.name ?? 'Pilot', rating: old?.rating ?? START, games: 0, wins: 0, peak: null };
  }

  /** Current season rating (rooms and the ranked queue use this). Same shape as before seasons. */
  get(k: string) {
    const r = this.seasonRow(k);
    return { rating: Math.round(r.rating), games: r.games, wins: r.wins };
  }

  seasonInfo() {
    const season = seasonOf();
    return { season, prev: prevSeason(season), endsAt: seasonEnds(season), now: Date.now() };
  }

  /** /me: the old fields (rating, games, wins) are this season's; plus placement and last season. */
  me(k: string) {
    const info = this.seasonInfo();
    const cur = this.seasonRow(k, info.season);
    const life = this.life(k);
    const prev = this.ctx.storage.sql.exec(`SELECT rating, games, wins, peak FROM seasons WHERE season = ? AND k = ?`, info.prev, k).toArray()[0] as SeasonRow | undefined;
    const placed = isPlaced(cur.games);
    const prevPlaced = !!prev && isPlaced(prev.games);
    return {
      rating: Math.round(cur.rating), games: cur.games, wins: cur.wins,
      ...info, placed, peak: cur.peak === null ? null : Math.round(cur.peak),
      rank: placed ? rankOf(cur.rating).label : null,
      lifetime: { games: life?.games ?? 0, wins: life?.wins ?? 0 },
      prevSeason: prev ? {
        season: info.prev, rating: Math.round(prev.rating), games: prev.games, wins: prev.wins, placed: prevPlaced,
        tier: prevPlaced ? rankOf(prev.rating).tier : null,
        peakTier: prevPlaced && prev.peak !== null ? rankOf(prev.peak).tier : null,
      } : null,
    };
  }

  /** Elo update. winner: 0 = a, 1 = b, -1 = draw. Placements and new players move faster. */
  report(a: { k: string; name: string }, b: { k: string; name: string }, winner: number) {
    const season = seasonOf();
    const ra = this.seasonRow(a.k, season), rb = this.seasonRow(b.k, season);
    const la = this.life(a.k), lb = this.life(b.k);
    const ba = Math.round(ra.rating), bb = Math.round(rb.rating);
    const ea = 1 / (1 + 10 ** ((bb - ba) / 400));
    const sa = winner === 0 ? 1 : winner === 1 ? 0 : 0.5;
    const ka = kFactor(ra.games, la?.games ?? 0), kb = kFactor(rb.games, lb?.games ?? 0);
    const da = Math.round(ka * (sa - ea)), db = Math.round(kb * ((1 - sa) - (1 - ea)));
    const sql = this.ctx.storage.sql;
    const put = (p: { k: string; name: string }, r: SeasonRow, l: { games: number; wins: number } | undefined, before: number, d: number, won: boolean) => {
      const rating = before + d, games = r.games + 1, name = cleanName(p.name);
      const peak = isPlaced(games) ? Math.max(r.peak ?? -Infinity, rating) : null;
      sql.exec(`INSERT OR REPLACE INTO seasons (season, k, name, rating, games, wins, peak) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        season, p.k, name, rating, games, r.wins + (won ? 1 : 0), peak);
      sql.exec(`INSERT OR REPLACE INTO players (k, name, rating, games, wins) VALUES (?, ?, ?, ?, ?)`,
        p.k, name, rating, (l?.games ?? 0) + 1, (l?.wins ?? 0) + (won ? 1 : 0));
      return games;
    };
    const ga = put(a, ra, la, ba, da, winner === 0);
    const gb = put(b, rb, lb, bb, db, winner === 1);
    // ratings/deltas are the pre-season fields; season/games/before let clients show rank changes
    return { ratings: [ba + da, bb + db], deltas: [da, db], season, games: [ga, gb], before: [ba, bb] };
  }

  /** Season leaderboard: placed pilots first, then by rating. */
  top(season = seasonOf()) {
    return this.ctx.storage.sql.exec(
      `SELECT name, rating, games, wins FROM seasons WHERE season = ? AND games > 0 ORDER BY (games >= ?) DESC, rating DESC LIMIT 20`,
      season, PLACEMENT_GAMES).toArray()
      .map((r) => {
        const placed = isPlaced(r.games as number);
        return { name: r.name, rating: Math.round(r.rating as number), games: r.games, wins: r.wins, season, placed, rank: placed ? rankOf(r.rating as number).label : null };
      });
  }

  /** Keep each player's best survival run this season. */
  survivalPost(k: string, name: string, rounds: number, build: Record<string, string>) {
    const season = seasonOf();
    const sql = this.ctx.storage.sql;
    const old = sql.exec(`SELECT rounds FROM survival WHERE season = ? AND k = ?`, season, k).toArray()[0] as { rounds: number } | undefined;
    const improved = !old || rounds > old.rounds;
    if (improved) sql.exec(`INSERT OR REPLACE INTO survival (season, k, name, rounds, build, at) VALUES (?, ?, ?, ?, ?, ?)`, season, k, name, rounds, JSON.stringify(build), Date.now());
    return { season, best: Math.max(rounds, old?.rounds ?? 0), improved };
  }

  survivalTop(season = seasonOf(), k?: string) {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec(`SELECT k, name, rounds, build FROM survival WHERE season = ? ORDER BY rounds DESC, at ASC LIMIT 10`, season).toArray();
    const top = rows.map((r) => ({ name: r.name as string, rounds: r.rounds as number, build: JSON.parse(r.build as string) as Record<string, string>, you: !!k && r.k === k }));
    let me: { rounds: number; place: number } | null = null;
    if (k) {
      const row = sql.exec(`SELECT rounds, at FROM survival WHERE season = ? AND k = ?`, season, k).toArray()[0] as { rounds: number; at: number } | undefined;
      if (row) {
        const ahead = sql.exec(`SELECT COUNT(*) AS n FROM survival WHERE season = ? AND (rounds > ? OR (rounds = ? AND at < ?))`, season, row.rounds, row.rounds, row.at).one().n as number;
        me = { rounds: row.rounds, place: ahead + 1 };
      }
    }
    return { season, top, me };
  }
}

/* ------------------------------------------------------------------ shared replays */

const MAX_REPLAY = 256 * 1024;
const REPLAY_TTL = 30 * 24 * 3600 * 1000;
const REPLAY_KEEP = 5000;
/** Shares per client address per minute. */
const REPLAY_PER_MIN = 20;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Shape check only; the client runs the full validateReplay (ruleset, parts, streams) before playing. */
function replayShapeOk(r: unknown): boolean {
  if (!r || typeof r !== 'object') return false;
  const x = r as Record<string, unknown>;
  const c = x.config as Record<string, unknown> | undefined;
  const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  return x.v === 1 && int(x.rulesVersion, 1, 9999) && int(x.frames, 1, 60 * 60 * 10)
    && !!c && typeof c === 'object' && typeof c.rivalId === 'string' && typeof c.arenaId === 'string'
    && !!c.playerLoadout && typeof c.playerLoadout === 'object'
    && Array.isArray(x.streams) && x.streams.length >= 1 && x.streams.length <= 2
    && x.streams.every((s) => typeof s === 'string' && s.length > 0 && B64.test(s))
    && typeof x.date === 'string';
}

export class Replays extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS replays (code TEXT PRIMARY KEY, hash TEXT UNIQUE, body TEXT, at INTEGER)`);
    // expiry and the keep-latest trim both scan by time
    ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS replays_at ON replays (at)`);
  }

  /** Uploads per client address this minute (memory only: a cheap brake on scripted floods). */
  private uploads = new Map<string, { min: number; n: number }>();

  async put(text: string, ip = ''): Promise<{ code: string } | { error: string }> {
    if (text.length > MAX_REPLAY) return { error: 'too large' };
    if (ip) {
      const min = Math.floor(Date.now() / 60_000);
      if (this.uploads.size > 5000) this.uploads.clear();
      let u = this.uploads.get(ip);
      if (!u || u.min !== min) this.uploads.set(ip, (u = { min, n: 0 }));
      if (++u.n > REPLAY_PER_MIN) return { error: 'slow down' };
    }
    let r: unknown;
    try { r = JSON.parse(text); } catch { return { error: 'bad json' }; }
    if (!replayShapeOk(r)) return { error: 'not a replay' };
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    // expire after 30 days and keep at most the latest REPLAY_KEEP
    sql.exec(`DELETE FROM replays WHERE at < ?`, now - REPLAY_TTL);
    sql.exec(`DELETE FROM replays WHERE code NOT IN (SELECT code FROM replays ORDER BY at DESC LIMIT ?)`, REPLAY_KEEP - 1);
    const body = JSON.stringify(r);
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    const hash = Array.from(new Uint8Array(d).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
    // sharing the same replay twice returns the same code (and refreshes its expiry)
    const same = sql.exec(`SELECT code FROM replays WHERE hash = ?`, hash).toArray()[0] as { code: string } | undefined;
    if (same) {
      sql.exec(`UPDATE replays SET at = ? WHERE code = ?`, now, same.code);
      return { code: same.code };
    }
    for (let i = 0; i < 8; i++) {
      const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
      if (sql.exec(`SELECT 1 FROM replays WHERE code = ?`, code).toArray().length) continue;
      sql.exec(`INSERT INTO replays (code, hash, body, at) VALUES (?, ?, ?, ?)`, code, hash, body, now);
      return { code };
    }
    return { error: 'busy' };
  }

  get(code: string): string | null {
    const row = this.ctx.storage.sql.exec(`SELECT body, at FROM replays WHERE code = ?`, code).toArray()[0] as { body: string; at: number } | undefined;
    return row && row.at >= Date.now() - REPLAY_TTL ? row.body : null;
  }
}
