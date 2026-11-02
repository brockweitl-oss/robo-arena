import { emptyInput, type FighterInput } from '../game/fighter';
import { RULESET_VERSION } from '../game/replay';
import type { Loadout } from '../data/parts';
import type { Paint } from '../data/characters';

/**
 * Online play: deterministic lockstep over a tiny Cloudflare relay (server/).
 * Both clients run the same sim. Each tick, each side sends its own quantized input for
 * tick + delay; a tick only runs once both inputs for it are here. Inputs are plain JSON
 * of already-quantized values, so both machines feed the sim bit-identical numbers.
 */

const DEFAULT_URL = 'https://robo-arena-net.brockweitl.workers.dev';

export function netUrl(): string {
  const q = new URLSearchParams(location.search).get('net');
  return (q ?? (import.meta.env.VITE_NET_URL as string | undefined) ?? DEFAULT_URL).replace(/\/$/, '');
}

/** Rules both clients must share. Bump with any sim change (the replay ruleset covers sim rules). */
export const NET_RULESET = `r${RULESET_VERSION}`;

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
}

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
  /** Remote desync checksums by tick. */
  readonly remoteSums = new Map<number, number>();
  /** Last tick the opponent reported reaching (for pacing). */
  remoteTick = -1;
  private pingTimer = 0;
  private seated: Promise<void>;

  private constructor(url: string) {
    this.ws = new WebSocket(url);
    let seatedRes!: () => void;
    let seatedRej!: (e: Error) => void;
    this.seated = new Promise((r, j) => { seatedRes = r; seatedRej = j; });
    this.ws.onmessage = (e) => {
      let m: Msg;
      try { m = JSON.parse(e.data as string); } catch { return; }
      switch (m.t) {
        case 'i':
          this.remote.set(m.n, decodeInput(m.i ?? {}));
          if (m.n > this.remoteTick) this.remoteTick = m.n;
          break;
        case 'sum': this.remoteSums.set(m.n, m.h); break;
        case 'ping': this.raw({ t: 'pong', c: m.c }); break;
        case 'pong': { const r = performance.now() - m.c; this.rtt = this.pongs++ ? this.rtt * 0.8 + r * 0.2 : r; break; }
        case 'seat': this.slot = m.slot; seatedRes(); break;
        case 'peer': this.peer = m.hello; this.onPeer?.(m.hello); break;
        case 'start': this.onStart?.(m as unknown as StartMsg); break;
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
    this.pingTimer = window.setInterval(() => this.raw({ t: 'ping', c: performance.now() }), 1000);
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
    this.raw({ t: 'ready' });
  }
  sendInput(n: number, i: FighterInput) { this.raw({ t: 'i', n, i: encodeInput(i) }); }
  sendSum(n: number, h: number) { this.raw({ t: 'sum', n, h }); }
  /** Input delay in ticks from the measured round trip (one-way latency plus a frame of jitter room). */
  get delay(): number {
    return Math.max(2, Math.min(8, Math.ceil(this.rtt / 2 / (1000 / 60)) + 1));
  }
  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    try { this.ws.close(); } catch { /* already closed */ }
  }
}
