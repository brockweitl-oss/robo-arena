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
export const RULESET_VERSION = 3;

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
  frames = 0;

  push(i: FighterInput) {
    const [x, z, b] = packInput(i);
    this.bytes.push(x, z, b);
    this.face.push(i.faceTarget ? 1 : 0);
    this.frames++;
  }

  /** RLE: [count, x, z, b, face] runs, base64 encoded. */
  encode(): string {
    const out: number[] = [];
    let i = 0;
    while (i < this.frames) {
      let n = 1;
      while (
        i + n < this.frames && n < 255 &&
        this.bytes[(i + n) * 3] === this.bytes[i * 3] && this.bytes[(i + n) * 3 + 1] === this.bytes[i * 3 + 1] &&
        this.bytes[(i + n) * 3 + 2] === this.bytes[i * 3 + 2] && this.face[i + n] === this.face[i]
      ) n++;
      out.push(n, this.bytes[i * 3], this.bytes[i * 3 + 1], this.bytes[i * 3 + 2], this.face[i]);
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
      if (this.ri + 5 > this.runs.length) {
        this.done = true;
        return emptyInput();
      }
      const r = this.runs;
      this.left = r[this.ri];
      unpackInput(r[this.ri + 1], r[this.ri + 2], r[this.ri + 3], r[this.ri + 4] === 1, this.cur);
      this.ri += 5;
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
  if (s.length % 5 !== 0) return false;
  let total = 0;
  for (let i = 0; i < s.length; i += 5) {
    const n = s.charCodeAt(i);
    if (n < 1) return false;
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
  const lo = c.playerLoadout as unknown as Record<Slot, string> | undefined;
  if (!lo) return false;
  const partOk = (slot: Slot, id: unknown) => typeof id === 'string' && Object.hasOwn(ALL_PARTS[slot], id);
  for (const slot of ['gun', 'bomb', 'pod', 'body', 'legs'] as Slot[]) if (!partOk(slot, lo[slot])) return false;
  if (c.versus) {
    const p2 = c.versus.p2Loadout as unknown as Record<Slot, string>;
    if (!p2) return false;
    for (const slot of ['gun', 'bomb', 'pod', 'body', 'legs'] as Slot[]) if (!partOk(slot, p2[slot])) return false;
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
