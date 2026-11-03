import { emptyInput, type FighterInput } from '../game/fighter';
import { RULESET_VERSION } from '../game/replay';
import type { Loadout } from '../data/parts';
import type { Paint } from '../data/characters';

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
export function decodeInput(o: Record<string, unknown>): FighterInput {
  return { ...emptyInput(), ...(o as Partial<FighterInput>) };
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
      switch (m.t) {
        case 'i': this.onInput(m); break;
        case 'log': for (const x of (m.m ?? []) as Msg[]) this.onInput(x); break;
        case 'watch': this.watchNames = m.players ?? []; seatedRes(); break;
        case 'sum': this.remoteSums.set(m.n, m.h); break;
        case 'ping': this.send({ t: 'pong', c: m.c }); break;
        case 'pong': { const r = performance.now() - m.c; this.rtt = this.pongs++ ? this.rtt * 0.8 + r * 0.2 : r; break; }
        case 'seat': this.slot = m.slot; seatedRes(); break;
        case 'peer': this.peer = m.hello; this.onPeer?.(m.hello); break;
        case 'start':
          if (this.spectator) {
            this.resetWatch();
            if (!this.onStart) { this.pendingStart = m as unknown as StartMsg; break; }
          }
          this.onStart?.(m as unknown as StartMsg);
          break;
        case 'left': this.closed = true; this.onLeft?.(); break;
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
    if (typeof m.n !== 'number') return;
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
      const abort = () => { q.close(); rej(new Error('cancelled')); };
      signal.addEventListener('abort', abort, { once: true });
      q.onmessage = (e) => {
        const m = JSON.parse(e.data as string) as Msg;
        if (m.t !== 'match') return;
        signal.removeEventListener('abort', abort);
        NetSession.join(m.code, { ...hello, ranked }).then(res, rej);
      };
      q.onerror = () => rej(new Error('connect'));
    });
  }

  raw(o: Msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }
  hello(h: PlayerHello) { this.last = h; this.raw({ t: 'hello', ruleset: NET_RULESET, key: netKey(), ...h }); }
  /** The last hello sent (for re-sending after a build change). */
  last: PlayerHello | null = null;
  /** Ranked: report the winner (world id, -1 draw, -2 desync) for the server to settle. */
  report(winner: number) { this.raw({ t: 'result', winner }); }
  ready() {
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
