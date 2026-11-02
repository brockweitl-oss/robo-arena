import { emptyInput, type FighterInput } from './fighter';
import type { MatchConfig } from './types';

/**
 * Replays: the sim is deterministic, so a replay is just the match config, the
 * RNG seeds and every tick's input. Inputs are packed to 3 bytes per frame per
 * player (quantized stick + button bits) and run-length encoded.
 */
export interface Replay {
  v: 1;
  config: MatchConfig;
  worldSeed: number;
  aiSeed: number;
  /** Packed base64 input streams: [player] or [player, player2] (versus). */
  streams: string[];
  frames: number;
  date: string;
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
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
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
    const r = JSON.parse(text) as Replay;
    if (r.v !== 1 || !r.config || !Array.isArray(r.streams)) return null;
    return r;
  } catch {
    return null;
  }
}
