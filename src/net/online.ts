import { emptyInput, type FighterInput } from '../game/fighter';
import { RULESET_VERSION, quantizeBombTarget } from '../game/replay';
import { ALL_PARTS, DEFAULT_LOADOUT, type Loadout, type Slot } from '../data/parts';
import { PLAYER_PAINT, type Paint } from '../data/characters';

/**
 * Online play: deterministic rollback netcode over a tiny Cloudflare relay (server/).
 * Both clients run the same sim. Each tick, each side sends its own quantized input for
 * tick + a small fixed delay. A tick runs at once with the opponent's input predicted; when the
 * real input arrives and differs, the client rewinds to that tick and re-simulates (see Match).
 * Inputs are plain JSON of already-quantized values, so both machines feed the sim bit-identical
 * numbers. Spectators receive both players' inputs from the room and run the same sim.
 */

const DEFAULT_URL = 'https://robo-arena-net.brockweitl.workers.dev';

export function netUrl(): string {
  const q = new URLSearchParams(location.search).get('net');
  return (q ?? (import.meta.env.VITE_NET_URL as string | undefined) ?? DEFAULT_URL).replace(/\/$/, '');
}

/** Round length (s). Testing hook: ?nettime=40 shortens it (every client in the room must use the same value). */
export function netTimeLimit(): number {
  const q = Number(new URLSearchParams(location.search).get('nettime'));
  return q >= 20 && q <= 120 ? q : 120;
}

/**
 * Rules both clients must share. Bump with any sim change (the replay ruleset covers sim rules).
 * The suffix is the net protocol: rollback clients hash full world state and must not be paired
 * with older lockstep clients (they would report a false desync).
 */
export const NET_RULESET = `r${RULESET_VERSION}-rb1`;

export interface PlayerHello {
  name: string;
  loadout: Loadout;
  paint: Paint;
  /** Host's arena pick (slot 0's is used). */
  arena?: string;
  /** Ranked rating (filled in by the server). */
  rating?: number;
  /** Queue type: both players must be ranked for a rated match. */
  ranked?: boolean;
}

export interface StartMsg {
  seed: number;
  arena: string;
  players: [PlayerHello, PlayerHello];
  ranked?: boolean;
  /** Sent to spectators. */
  spectate?: boolean;
}

/** A room with a match in progress (`/live`). */
export interface LiveRoom { code: string; names: string[]; arena: string; ranked: boolean; at: number }

export interface RatedMsg { counted: boolean; forfeit?: boolean; ratings?: [number, number]; deltas?: [number, number] }

/** Private per-device key (only its hash is stored server-side; never shown to opponents). */
export function netKey(): string {
  try {
    let k = localStorage.getItem('ra-net-key');
    if (!k) {
      k = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('ra-net-key', k);
    }
    return k;
  } catch { return 'nokey-' + Math.floor(performance.now()); }
}
export function netName(set?: string): string {
  try {
    if (set !== undefined) localStorage.setItem('ra-net-name', set.replace(/[^\w \-.]/g, '').slice(0, 16));
    return localStorage.getItem('ra-net-name') || `Pilot-${netKey().slice(0, 4).toUpperCase()}`;
  } catch { return 'Pilot'; }
}

export const TIERS: [number, string][] = [[1500, 'Diamond'], [1300, 'Platinum'], [1100, 'Gold'], [900, 'Silver'], [-1e9, 'Bronze']];
export const tierOf = (r: number) => TIERS.find(([min]) => r >= min)![1];

export async function fetchMyRating(): Promise<{ rating: number; games: number; wins: number } | null> {
  try { return await (await fetch(`${netUrl()}/me?key=${netKey()}`)).json(); } catch { return null; }
}
export async function fetchLeaderboard(): Promise<{ name: string; rating: number; games: number; wins: number }[]> {
  try { return await (await fetch(`${netUrl()}/top`)).json(); } catch { return []; }
}

export async function fetchLive(): Promise<LiveRoom[]> {
  try {
    const r = await (await fetch(`${netUrl()}/live`)).json();
    return Array.isArray(r) ? r : [];
  } catch { return []; }
}

type Msg = { t: string; [k: string]: any };

/** Encode a quantized input, dropping default fields (exact round trip with decodeInput). */
export function encodeInput(i: FighterInput): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  const d = emptyInput() as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(i)) {
    if (v === undefined || v === d[k]) continue;
    if (v === false && d[k] === undefined) continue;
    o[k] = v;
  }
  return o;
}
const INPUT_BOOLS = ['jumpPressed', 'jumpHeld', 'dashPressed', 'gunPressed', 'gunHeld', 'bombPressed', 'podPressed', 'chargePressed', 'faceTarget'] as const;
/** A stick axis as the replay quantizer stores it (k/127, |k| <= 127). */
const axis = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-127, Math.min(127, Math.round(v * 127))) / 127 : 0);
/**
 * Decode a relayed input. Untrusted: only known fields survive, booleans stay booleans, the stick
 * is clamped to the replay grid and targets to quantized finite points. An honest client's
 * (already quantized) input round-trips unchanged; a doctored one (moveX: 5) cannot drive the
 * sim out of range, it only desyncs the sender.
 */
export function decodeInput(o: Record<string, unknown>): FighterInput {
  const src = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const i = emptyInput();
  i.moveX = axis(src.moveX);
  i.moveZ = axis(src.moveZ);
  for (const k of INPUT_BOOLS) i[k] = src[k] === true;
  const vec = (v: unknown) => (Array.isArray(v) ? quantizeBombTarget(v.map(Number)) : undefined);
  const bt = vec(src.bombTarget);
  if (bt) i.bombTarget = bt;
  if (src.skillPressed === true) {
    i.skillPressed = true;
    const st = vec(src.skillTarget);
    if (st) i.skillTarget = st;
  }
  return i;
}

/**
 * Clean a relayed player hello (peer and start messages carry the other client's data). Unknown or
 * hostile part ids ("constructor") fall back to the default part and bad colors to the default
 * paint, so a doctored build can never crash the model builders. Deterministic: both machines agree.
 */
export function sanitizeHello(raw: unknown): PlayerHello {
  const h = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const lo = (h.loadout && typeof h.loadout === 'object' ? h.loadout : {}) as Record<string, unknown>;
  const loadout = { ...DEFAULT_LOADOUT };
  for (const slot of Object.keys(DEFAULT_LOADOUT) as Slot[]) {
    const id = lo[slot];
    if (typeof id === 'string' && Object.hasOwn(ALL_PARTS[slot], id)) loadout[slot] = id;
  }
  const pi = (h.paint && typeof h.paint === 'object' ? h.paint : {}) as Record<string, unknown>;
  const col = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff;
  const paint: Paint = { ...PLAYER_PAINT };
  for (const k of ['primary', 'secondary', 'trim', 'dark', 'glow'] as const) { const v = pi[k]; if (col(v)) paint[k] = v; }
  if (typeof pi.emblem === 'string') paint.emblem = pi.emblem.slice(0, 3);
  for (const k of ['trail', 'flame'] as const) { const v = pi[k]; if (col(v)) paint[k] = v; }
  if (['gloss', 'matte', 'metal', 'chrome', 'carbon'].includes(String(pi.finish))) paint.finish = pi.finish as Paint['finish'];
  if (typeof pi.wear === 'number' && Number.isFinite(pi.wear)) paint.wear = Math.max(0, Math.min(1, pi.wear));
  if (['unit', 'chevron', 'cross', 'none'].includes(String(pi.decal))) paint.decal = pi.decal as Paint['decal'];
  const out = {
    ...h,
    name: (typeof h.name === 'string' ? h.name.replace(/[^\w \-.]/g, '').trim().slice(0, 16) : '') || 'Pilot',
    loadout,
    paint,
  } as PlayerHello & Record<string, unknown>;
  if (h.arena !== undefined && typeof h.arena !== 'string') delete out.arena;
  if (h.rating !== undefined && !(typeof h.rating === 'number' && Number.isFinite(h.rating))) delete out.rating;
  return out;
}

/** Clean a start message (both machines apply the same cleaning, so the sims still agree). */
export function sanitizeStart(m: Record<string, unknown>): StartMsg {
  const p = Array.isArray(m.players) ? m.players : [];
  return {
    ...(m as unknown as StartMsg),
    seed: typeof m.seed === 'number' && Number.isFinite(m.seed) ? m.seed : 1,
    arena: typeof m.arena === 'string' ? m.arena : '',
    players: [sanitizeHello(p[0]), sanitizeHello(p[1])],
  };
}

/** Deterministic state hash for desync checks. */
export function stateHash(vals: number[]): number {
  const buf = new Float64Array(vals);
  const u = new Uint32Array(buf.buffer);
  let h = 2166136261;
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class NetSession {
  readonly ws: WebSocket;
  slot: 0 | 1 = 0;
  code = '';
  peer: PlayerHello | null = null;
  /** Smoothed round trip to the opponent (ms). */
  rtt = 120;
  closed = false;
  private pongs = 0;
  onPeer?: (h: PlayerHello) => void;
  onStart?: (s: StartMsg) => void;
  onLeft?: () => void;
  onRated?: (r: RatedMsg) => void;
  onError?: (reason: string) => void;
  /** Remote inputs by tick. */
  readonly remote = new Map<number, FighterInput>();
  /** Spectating: both players' inputs by tick (world slot order). */
  inputs: [Map<number, FighterInput>, Map<number, FighterInput>] = [new Map(), new Map()];
  /** Spectating: highest input tick received from each player. */
  latest: [number, number] = [-1, -1];
  /** Spectating: a match start that arrived while nobody was listening (shown next). */
  pendingStart: StartMsg | null = null;
  readonly spectator: boolean;
  /** Spectating: the room's players (names) when we connected. */
  watchNames: string[] = [];
  /** Opponent's simulation frontier when it sent its newest input, and its frame advantage over us. */
  remoteFrontier = -1;
  remoteAdv = 0;
  /** Remote desync checksums by tick. */
  readonly remoteSums = new Map<number, number>();
  /** Last tick the opponent reported reaching (for pacing). */
  remoteTick = -1;
  private pingTimer = 0;
  private seated: Promise<void>;

  private constructor(url: string, spectator = false) {
    this.spectator = spectator;
    this.ws = new WebSocket(url);
    let seatedRes!: () => void;
    let seatedRej!: (e: Error) => void;
    this.seated = new Promise((r, j) => { seatedRes = r; seatedRej = j; });
    this.ws.onmessage = (e) => {
      let m: Msg;
      try { m = JSON.parse(e.data as string); } catch { return; }
      if (!m || typeof m !== 'object') return;
      switch (m.t) {
        case 'i': this.onInput(m); break;
        case 'log': for (const x of (m.m ?? []) as Msg[]) this.onInput(x); break;
        case 'watch': this.watchNames = m.players ?? []; seatedRes(); break;
        case 'sum': if (typeof m.n === 'number' && typeof m.h === 'number' && this.remoteSums.size < 4096) this.remoteSums.set(m.n, m.h); break;
        case 'ping': this.send({ t: 'pong', c: m.c }); break;
        case 'pong': { if (typeof m.c !== 'number') break; const r = performance.now() - m.c; this.rtt = this.pongs++ ? this.rtt * 0.8 + r * 0.2 : r; break; }
        case 'seat': this.slot = m.slot; seatedRes(); break;
        case 'peer': { const p = sanitizeHello(m.hello); this.peer = p; this.onPeer?.(p); break; }
        case 'start': {
          const st = sanitizeStart(m);
          if (this.spectator) {
            this.resetWatch();
            if (!this.onStart) { this.pendingStart = st; break; }
          }
          this.onStart?.(st);
          break;
        }
        case 'left': this.closed = true; clearInterval(this.pingTimer); this.onLeft?.(); break;
        case 'rated': this.onRated?.(m as unknown as RatedMsg); break;
        case 'error': seatedRej(new Error(m.reason)); this.onError?.(m.reason); break;
      }
    };
    this.ws.onclose = () => {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.pingTimer);
      seatedRej(new Error('closed'));
      this.onLeft?.();
    };
    this.ws.onerror = () => seatedRej(new Error('connect'));
    this.pingTimer = window.setInterval(() => this.send({ t: 'ping', c: performance.now() }), 1000);
    // testing: ?netlag=60,120 delays every outgoing message by 60-120 ms (order kept)
    const lag = new URLSearchParams(location.search).get('netlag')?.split(',').map(Number);
    if (lag && lag.length === 2 && lag.every((x) => x >= 0)) this.lag = [lag[0], lag[1]];
  }

  private onInput(m: Msg) {
    if (typeof m.n !== 'number' || !Number.isInteger(m.n) || m.n < 0) return;
    if (this.spectator) {
      const s = m.s === 1 ? 1 : 0;
      this.inputs[s].set(m.n, decodeInput(m.i ?? {}));
      if (m.n > this.latest[s]) this.latest[s] = m.n;
      return;
    }
    this.remote.set(m.n, decodeInput(m.i ?? {}));
    if (m.n > this.remoteTick) {
      this.remoteTick = m.n;
      if (typeof m.f === 'number') this.remoteFrontier = m.f;
      if (typeof m.a === 'number') this.remoteAdv = m.a;
    }
  }

  /** Watch a room's matches (no seat); resolves once connected. */
  static async spectate(code: string): Promise<NetSession> {
    const s = new NetSession(`${netUrl().replace(/^http/, 'ws')}/room/${code.toUpperCase()}?spectate=1`, true);
    s.code = code.toUpperCase();
    await s.seated;
    return s;
  }

  /** Spectating: a new match gets fresh input buffers (a match still playing keeps its own). */
  resetWatch() {
    this.inputs = [new Map(), new Map()];
    this.latest = [-1, -1];
  }

  /** Join a room by code; resolves once seated. */
  static async join(code: string, hello: PlayerHello): Promise<NetSession> {
    const s = new NetSession(`${netUrl().replace(/^http/, 'ws')}/room/${code.toUpperCase()}`);
    s.code = code.toUpperCase();
    await s.seated;
    s.hello(hello);
    return s;
  }

  /** Make a new private room. */
  static async create(hello: PlayerHello): Promise<NetSession> {
    const r = await fetch(`${netUrl()}/new`);
    const { code } = await r.json();
    return NetSession.join(code, hello);
  }

  /** Quick match: wait in the public queue, then join the room it hands out. Cancel with the signal. */
  static quick(hello: PlayerHello, signal: AbortSignal, ranked = false): Promise<NetSession> {
    return new Promise((res, rej) => {
      const q = new WebSocket(`${netUrl().replace(/^http/, 'ws')}/quick?key=${netKey()}${ranked ? '&ranked=1' : ''}`);
      let matched = false;
      const abort = () => { q.close(); rej(new Error('cancelled')); };
      signal.addEventListener('abort', abort, { once: true });
      q.onmessage = (e) => {
        let m: Msg;
        try { m = JSON.parse(e.data as string) as Msg; } catch { return; }
        if (m?.t !== 'match' || typeof m.code !== 'string' || matched) return;
        matched = true;
        signal.removeEventListener('abort', abort);
        NetSession.join(m.code, { ...hello, ranked }).then(res, rej);
      };
      q.onerror = () => rej(new Error('connect'));
      // the queue socket dropping (server restart, network change, idle proxy) must not leave the
      // search spinning forever
      q.onclose = () => { if (!matched) { signal.removeEventListener('abort', abort); rej(new Error('connect')); } };
    });
  }

  raw(o: Msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }
  hello(h: PlayerHello) { this.last = h; this.raw({ t: 'hello', ruleset: NET_RULESET, key: netKey(), ...h }); }
  /** The last hello sent (for re-sending after a build change). */
  last: PlayerHello | null = null;
  /** Ranked: report the winner (world id, -1 draw, -2 desync) for the server to settle. */
  report(winner: number) { this.reported = true; this.raw({ t: 'result', winner }); }
  /** This match's result went to the server (a match reports as soon as its end is confirmed). */
  reported = false;
  ready() {
    this.reported = false;
    this.remote.clear();
    this.remoteSums.clear();
    this.remoteTick = -1;
    this.remoteFrontier = -1;
    this.remoteAdv = 0;
    this.raw({ t: 'ready' });
  }
  /** Input for tick n, sent from simulation frontier f with frame advantage a (time sync). */
  sendInput(n: number, i: FighterInput, f = n, a = 0) { this.send({ t: 'i', n, i: encodeInput(i), f, a }); }
  /** Test hook: artificial one-way latency/jitter on outgoing messages (ms range). Order is kept. */
  lag: [number, number] | null = null;
  private lagUntil = 0;
  private send(o: Msg) {
    if (!this.lag) return this.raw(o);
    const now = performance.now();
    const at = Math.max(this.lagUntil, now + this.lag[0] + Math.random() * (this.lag[1] - this.lag[0]));
    this.lagUntil = at;
    setTimeout(() => this.raw(o), at - now);
  }
  sendSum(n: number, h: number) { this.send({ t: 'sum', n, h }); }
  /** Fixed input delay (ticks) under rollback: 1 on a low-ping connection, otherwise 2. */
  get delay(): number {
    return this.pongs > 0 && this.rtt < 40 ? 1 : 2;
  }
  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    try { this.ws.close(); } catch { /* already closed */ }
  }
}
