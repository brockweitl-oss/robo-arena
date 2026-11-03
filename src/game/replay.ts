import { emptyInput, type FighterInput } from './fighter';
import type { MatchConfig } from './types';
import { ALL_PARTS, type Slot } from '../data/parts';
import { RIVALS, RIVALS_PLUS } from '../data/characters';
import { ARENA_INFO } from '../arena/index';

/**
 * Replays: the sim is deterministic, so a replay is just the match config, the
 * RNG seeds and every tick's input. Inputs are packed to 3 bytes per frame per
 * player (quantized stick + button bits) and run-length encoded.
 */
/** Reject recordings made against older simulation rules instead of silently desyncing. */
export const RULESET_VERSION = 7;

export interface Replay {
  rulesVersion: number;
  v: 1;
  config: MatchConfig;
  worldSeed: number;
  aiSeed: number;
  /** Packed base64 input streams: [player] or [player, player2] (versus). */
  streams: string[];
  frames: number;
  date: string;
  /** The player's aim-assist (homing multiplier) at record time; replays must not read current settings. */
  aimAssist: number;
  summary?: { outcome: string; finish: string; time: number; playerHp: number; rivalHp: number };
}

const BITS: (keyof FighterInput)[] = ['jumpPressed', 'jumpHeld', 'dashPressed', 'gunPressed', 'gunHeld', 'bombPressed', 'podPressed', 'chargePressed'];

/** Signed fixed-point coordinates: 1/64m, bounded to the supported arena envelope. */
export function quantizeBombTarget(target: readonly number[] | undefined): readonly [number, number, number] | undefined {
  if (!target || target.length !== 3 || !target.every(Number.isFinite)) return undefined;
  return target.map(v => Math.round(Math.max(-256, Math.min(256, v)) * 64) / 64) as [number, number, number];
}
/** count, x, z, buttons, face, bomb target (1+6), skill flags + target (1+6). */
const RUN_BYTES = 19;

export function packInput(i: FighterInput): [number, number, number] {
  const q = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 127))) & 0xff;
  let b = 0;
  BITS.forEach((k, n) => {
    if (i[k]) b |= 1 << n;
  });
  // faceTarget is recorded separately by InputRecorder (see encode()).
  return [q(i.moveX), q(i.moveZ), b];
}

/** Round an input to exactly what a replay can store, in place. Apply before the sim sees it. */
export function quantizeInput(i: FighterInput): FighterInput {
  const [x, z, b] = packInput(i);
  i.bombTarget = quantizeBombTarget(i.bombTarget);
  i.skillPressed = !!i.skillPressed;
  i.skillTarget = i.skillPressed ? quantizeBombTarget(i.skillTarget) : undefined;
  return unpackInput(x, z, b, i.faceTarget, i);
}

export function unpackInput(x: number, z: number, b: number, faceTarget: boolean, out = emptyInput()): FighterInput {
  const s = (v: number) => ((v << 24) >> 24) / 127;
  out.moveX = s(x);
  out.moveZ = s(z);
  BITS.forEach((k, n) => {
    (out as unknown as Record<string, unknown>)[k] = (b & (1 << n)) !== 0;
  });
  out.faceTarget = faceTarget;
  return out;
}

/** Records one player's inputs; faceTarget is stored as a run-length side channel. */
export class InputRecorder {
  private bytes: number[] = [];
  private face: number[] = [];
  private targets: number[][] = [];
  frames = 0;

  push(i: FighterInput) {
    const [x, z, b] = packInput(i);
    this.bytes.push(x, z, b);
    this.face.push(i.faceTarget ? 1 : 0);
    const target = quantizeBombTarget(i.bombTarget);
    const bytes = [target ? 1 : 0];
    for (const value of target ?? [0, 0, 0]) { const q = Math.round(value * 64) & 0xffff; bytes.push(q & 255, q >>> 8); }
    const skillTarget = i.skillPressed ? quantizeBombTarget(i.skillTarget) : undefined;
    bytes.push((i.skillPressed ? 1 : 0) | (skillTarget ? 2 : 0));
    for (const value of skillTarget ?? [0, 0, 0]) { const q = Math.round(value * 64) & 0xffff; bytes.push(q & 255, q >>> 8); }
    this.targets.push(bytes);
    this.frames++;
  }

  /** RLE: count, stick/buttons, facing, target presence and three signed16 coordinates. */
  encode(): string {
    const out: number[] = [];
    let i = 0;
    while (i < this.frames) {
      let n = 1;
      while (
        i + n < this.frames && n < 255 &&
        this.bytes[(i + n) * 3] === this.bytes[i * 3] && this.bytes[(i + n) * 3 + 1] === this.bytes[i * 3 + 1] &&
        this.bytes[(i + n) * 3 + 2] === this.bytes[i * 3 + 2] && this.face[i + n] === this.face[i] && this.targets[i + n].every((v, k) => v === this.targets[i][k])
      ) n++;
      out.push(n, this.bytes[i * 3], this.bytes[i * 3 + 1], this.bytes[i * 3 + 2], this.face[i], ...this.targets[i]);
      i += n;
    }
    let s = '';
    for (const v of out) s += String.fromCharCode(v);
    return btoa(s);
  }
}

/** Plays back an encoded input stream frame by frame. */
export class InputPlayer {
  private runs: Uint8Array;
  private ri = 0;
  private left = 0;
  private cur = emptyInput();
  done = false;

  constructor(encoded: string) {
    const s = atob(encoded);
    this.runs = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) this.runs[i] = s.charCodeAt(i);
  }

  next(): FighterInput {
    if (this.left <= 0) {
      if (this.ri + RUN_BYTES > this.runs.length) {
        this.done = true;
        return emptyInput();
      }
      const r = this.runs;
      this.left = r[this.ri];
      unpackInput(r[this.ri + 1], r[this.ri + 2], r[this.ri + 3], r[this.ri + 4] === 1, this.cur);
      const vec = (at: number) => [0, 1, 2].map(k => {
        const n = r[at + k * 2] | r[at + 1 + k * 2] << 8;
        return (n << 16 >> 16) / 64;
      }) as [number, number, number];
      this.cur.bombTarget = r[this.ri + 5] ? vec(this.ri + 6) : undefined;
      const sf = r[this.ri + 12];
      this.cur.skillPressed = (sf & 1) !== 0;
      this.cur.skillTarget = sf & 2 ? vec(this.ri + 13) : undefined;
      this.ri += RUN_BYTES;
    }
    this.left--;
    return { ...this.cur };
  }
}

const KEY = 'robo-arena-replays';

export function saveReplay(r: Replay) {
  try {
    const list: Replay[] = JSON.parse(localStorage.getItem(KEY) || '[]');
    list.unshift(r);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* storage full / unavailable */
  }
}

export function loadReplays(): Replay[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((r) => validateReplay(r)) : [];
  } catch {
    return [];
  }
}

const MAX_FRAMES = 60 * 60 * 10;

/** Decode a stream and check it is well-formed RLE covering at least `frames` frames. */
function streamOk(enc: unknown, frames: number): boolean {
  if (typeof enc !== 'string' || enc.length === 0 || enc.length > 4_000_000) return false;
  let s: string;
  try {
    s = atob(enc);
  } catch {
    return false;
  }
  if (s.length % RUN_BYTES !== 0) return false;
  let total = 0;
  for (let i = 0; i < s.length; i += RUN_BYTES) {
    const n = s.charCodeAt(i);
    if (n < 1 || s.charCodeAt(i + 4) > 1 || s.charCodeAt(i + 5) > 1) return false;
    for (let k = 0; k < 3; k++) {
      const q = s.charCodeAt(i + 6 + k * 2) | s.charCodeAt(i + 7 + k * 2) << 8;
      if (Math.abs(q << 16 >> 16) > 16384) return false;
    }
    total += n;
  }
  return total >= frames;
}

/** Full structural validation: anything that could crash or desync playback is rejected. */
export function validateReplay(r: unknown): r is Replay {
  if (!r || typeof r !== 'object') return false;
  const x = r as Partial<Replay>;
  if (x.v !== 1 || x.rulesVersion !== RULESET_VERSION) return false;
  const c = x.config;
  if (!c || typeof c !== 'object') return false;
  if (![...RIVALS, ...RIVALS_PLUS].some((rv) => rv.id === c.rivalId)) return false;
  if (typeof c.arenaId !== 'string' || !Object.hasOwn(ARENA_INFO, c.arenaId)) return false;
  if (c.objective !== undefined && typeof c.objective !== 'boolean') return false;
  const lo = c.playerLoadout as unknown as Record<Slot, string> | undefined;
  if (!lo) return false;
  const partOk = (slot: Slot, id: unknown) => typeof id === 'string' && Object.hasOwn(ALL_PARTS[slot], id);
  for (const slot of ['gun', 'bomb', 'pod', 'body', 'legs', 'skill'] as Slot[]) if (!partOk(slot, lo[slot])) return false;
  if (c.versus) {
    const p2 = c.versus.p2Loadout as unknown as Record<Slot, string>;
    if (!p2) return false;
    for (const slot of ['gun', 'bomb', 'pod', 'body', 'legs', 'skill'] as Slot[]) if (!partOk(slot, p2[slot])) return false;
    const pp = c.versus.p2Paint as unknown as Record<string, unknown> | undefined;
    const col = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff;
    if (!pp || !['primary', 'secondary', 'trim', 'dark', 'glow'].every((k) => col(pp[k])) || typeof pp.emblem !== 'string') return false;
    if (typeof c.versus.p2Name !== 'string') return false;
  }
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 2 ** 31;
  if (!int(x.worldSeed) || !int(x.aiSeed)) return false;
  if (typeof x.frames !== 'number' || !Number.isInteger(x.frames) || x.frames < 1 || x.frames > MAX_FRAMES) return false;
  if (!Array.isArray(x.streams) || x.streams.length < 1 || x.streams.length > 2) return false;
  if (c.versus ? x.streams.length !== 2 : x.streams.length !== 1) return false;
  if (!x.streams.every((st) => streamOk(st, x.frames!))) return false;
  if (typeof x.date !== 'string' || Number.isNaN(Date.parse(x.date))) return false;
  if (x.aimAssist !== undefined && (typeof x.aimAssist !== 'number' || !(x.aimAssist >= 0.5 && x.aimAssist <= 1))) return false;
  return true;
}

export function downloadReplay(r: Replay) {
  const blob = new Blob([JSON.stringify(r)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `robo-arena-replay-${r.date.slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function parseReplay(text: string): Replay | null {
  try {
    const r = JSON.parse(text);
    return validateReplay(r) ? r : null;
  } catch {
    return null;
  }
}
