/**
 * Robo Arena online relay (Cloudflare Worker + Durable Objects).
 *
 * The game is a deterministic lockstep sim, so the server never simulates anything:
 * - Room (one per room code): seats two players, exchanges their builds, picks the match
 *   seed, relays per-tick inputs, and (ranked) settles results both clients agree on.
 * - Lobby (one per queue): quick match / ranked queue. Pairs waiting players and hands
 *   both the same fresh room code. Ranked prefers the closest rating among waiters.
 * - Ratings (one global): Elo ratings in SQLite, keyed by a hash of each player's private key.
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

interface Env {
  ROOMS: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  RATINGS: DurableObjectNamespace<Ratings>;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const CORS = { 'access-control-allow-origin': '*' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'content-type': 'application/json' } });
const ratings = (env: Env) => env.RATINGS.get(env.RATINGS.idFromName('global'));
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
    if (url.pathname === '/top') return json(await ratings(env).top());
    if (url.pathname === '/live') return json(await live(env).list());
    if (url.pathname === '/me') {
      const k = await keyHash(url.searchParams.get('key'));
      return k ? json(await ratings(env).get(k)) : json({ error: 'bad key' }, 400);
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

export class Room extends DurableObject<Env> {
  private ranked = false;
  private settled = true;
  /** Current match: its start message (also persisted) and every relayed input, tagged by slot. */
  private startMsg: string | null = null;
  private log: string[] = [];
  private loaded = false;

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
      ws.serializeAttachment({ slot: -2, code } satisfies Seat);
      const names = this.seats().filter((s) => s.seat.slot === 0 || s.seat.slot === 1).sort((a, b) => a.seat.slot - b.seat.slot)
        .map((s) => String(s.seat.hello?.name ?? 'Pilot'));
      ws.send(JSON.stringify({ t: 'watch', players: names }));
      this.startMsg ??= (await this.ctx.storage.get<string>('start')) ?? null;
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
    const other = this.seats().find((s) => s.ws !== ws && (s.seat.slot === 0 || s.seat.slot === 1));
    if (!this.loaded) {
      // woke from hibernation: the current match's start message survives in storage
      this.loaded = true;
      this.startMsg ??= (await this.ctx.storage.get<string>('start')) ?? null;
    }
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
      if (me.k) pub.rating = (await ratings(this.env).get(me.k)).rating;
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
      if (this.settled || !other) return;
      me.result = typeof msg.winner === 'number' ? msg.winner : -2;
      ws.serializeAttachment(me);
      if (other.seat.result === undefined) return;
      this.settled = true;
      const [a, b] = [me, other.seat].sort((x, y) => x.slot - y.slot);
      if (a.result !== b.result || a.result === -2 || !a.k || !b.k || a.k === b.k) {
        const e = JSON.stringify({ t: 'rated', counted: false });
        ws.send(e); other.ws.send(e);
        return;
      }
      const r = await ratings(this.env).report(
        { k: a.k, name: String(a.hello?.name ?? 'Pilot') }, { k: b.k, name: String(b.hello?.name ?? 'Pilot') }, a.result!);
      const out = JSON.stringify({ t: 'rated', counted: true, ...r });
      ws.send(out); other.ws.send(out);
      return;
    }

    // ready: start once both seats are ready with matching rules
    me.ready = true;
    me.result = undefined;
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
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647;
    const start = { t: 'start', seed, arena: h[0].arena, players: h, ranked: this.ranked };
    // spectators see the new match from its first input
    this.startMsg = JSON.stringify({ ...start, spectate: true });
    this.log = [];
    for (const sp of this.spectators()) try { sp.send(this.startMsg); } catch { /* closed */ }
    other.seat.ready = false;
    other.seat.result = undefined;
    me.ready = false;
    ws.serializeAttachment(me);
    other.ws.serializeAttachment(other.seat);
    ws.send(JSON.stringify(start));
    other.ws.send(JSON.stringify(start));
    // after the players have their start: persist it for late spectators, list the room as live
    await this.ctx.storage.put('start', this.startMsg);
    if (me.code) {
      await live(this.env).set(me.code, { names: h.map((x) => String(x.name ?? 'Pilot')), arena: String(h[0].arena ?? ''), ranked: this.ranked, at: Date.now() })
        .catch(() => undefined);
    }
  }

  async webSocketClose(ws: WebSocket) {
    const me = ws.deserializeAttachment() as Seat;
    if (me.slot !== 0 && me.slot !== 1) return;
    if (me.code) await live(this.env).set(me.code, null).catch(() => undefined);
    this.startMsg = null;
    await this.ctx.storage.delete('start');
    for (const s of this.seats()) if (s.ws !== ws) try { s.ws.send(JSON.stringify({ t: 'left', slot: me.slot })); } catch { /* closed */ }
    // leaving an unsettled ranked match counts as a loss
    const other = this.seats().find((s) => s.ws !== ws && (s.seat.slot === 0 || s.seat.slot === 1));
    if (!this.settled && me.k && other?.seat.k && other.seat.k !== me.k) {
      this.settled = true;
      const [a, b] = [{ k: me.k, name: String(me.hello?.name), slot: me.slot }, { k: other.seat.k, name: String(other.seat.hello?.name), slot: other.seat.slot }].sort((x, y) => x.slot - y.slot);
      const r = await ratings(this.env).report(a, b, other.seat.slot);
      try { other.ws.send(JSON.stringify({ t: 'rated', counted: true, forfeit: true, ...r })); } catch { /* closed */ }
    }
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
    if (info) await this.ctx.storage.put(`room:${code}`, info);
    else await this.ctx.storage.delete(`room:${code}`);
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
    const waiting = this.ctx.getWebSockets('wait').filter((w) => (w.deserializeAttachment() as { k?: string })?.k !== k || !k);
    this.ctx.acceptWebSocket(ws, ['wait']);
    ws.serializeAttachment({ k, rating });
    if (waiting.length > 0) {
      // closest rating first (FIFO among equals)
      const peer = waiting.reduce((best, w) => {
        const r = (w.deserializeAttachment() as { rating: number }).rating;
        const br = (best.deserializeAttachment() as { rating: number }).rating;
        return Math.abs(r - rating) < Math.abs(br - rating) ? w : best;
      });
      const code = newCode();
      peer.send(JSON.stringify({ t: 'match', code, host: true }));
      ws.send(JSON.stringify({ t: 'match', code, host: false }));
      peer.close(1000, 'matched');
      ws.close(1000, 'matched');
    } else ws.send(JSON.stringify({ t: 'waiting' }));
    return res;
  }

  async webSocketMessage() { /* keep-alive pings only */ }
  async webSocketClose(ws: WebSocket) { try { ws.close(); } catch { /* already closed */ } }
}

const K = 32;
const START = 1000;

export class Ratings extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS players (k TEXT PRIMARY KEY, name TEXT, rating REAL, games INTEGER, wins INTEGER)`);
  }

  get(k: string) {
    const row = this.ctx.storage.sql.exec(`SELECT name, rating, games, wins FROM players WHERE k = ?`, k).toArray()[0] as
      { name: string; rating: number; games: number; wins: number } | undefined;
    return { rating: Math.round(row?.rating ?? START), games: row?.games ?? 0, wins: row?.wins ?? 0 };
  }

  /** Elo update. winner: 0 = a, 1 = b, -1 = draw. New players move faster for their first 10 games. */
  report(a: { k: string; name: string }, b: { k: string; name: string }, winner: number) {
    const ra = this.get(a.k), rb = this.get(b.k);
    const ea = 1 / (1 + 10 ** ((rb.rating - ra.rating) / 400));
    const sa = winner === 0 ? 1 : winner === 1 ? 0 : 0.5;
    const ka = ra.games < 10 ? K * 1.5 : K, kb = rb.games < 10 ? K * 1.5 : K;
    const da = Math.round(ka * (sa - ea)), db = Math.round(kb * ((1 - sa) - (1 - ea)));
    const put = (p: { k: string; name: string }, r: { rating: number; games: number; wins: number }, d: number, won: boolean) =>
      this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO players (k, name, rating, games, wins) VALUES (?, ?, ?, ?, ?)`,
        p.k, cleanName(p.name), r.rating + d, r.games + 1, r.wins + (won ? 1 : 0));
    put(a, ra, da, winner === 0);
    put(b, rb, db, winner === 1);
    return { ratings: [ra.rating + da, rb.rating + db], deltas: [da, db] };
  }

  top() {
    return this.ctx.storage.sql.exec(`SELECT name, rating, games, wins FROM players WHERE games > 0 ORDER BY rating DESC LIMIT 20`).toArray()
      .map((r) => ({ ...r, rating: Math.round(r.rating as number) }));
  }
}
