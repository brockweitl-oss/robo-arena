// Procedural music: track definitions + a lookahead step sequencer.
// The sequencer is driven by pump(untilTime); the engine calls it from a timer (~25 ms) with a
// ~150 ms lookahead, and offline tests call it once for the whole render.
import { SynthCtx, rng } from './synth';
import * as I from './inst';
import type { MusicTrack } from './audio';

// ------------------------------------------------------------------ notation helpers
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteMidi(n: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) throw new Error('bad note ' + n);
  return 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

const QUAL: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
  '5': [0, 7, 12], sus4: [0, 5, 7], m7b5: [0, 3, 6, 10], add9: [0, 4, 7, 14], m9: [0, 3, 7, 10, 14],
};
interface Chord { root: number; iv: number[] } // root pitch class
function parseChord(s: string): Chord {
  const m = /^([A-G][#b]?)(.*)$/.exec(s)!;
  let pc = PC[m[1][0]];
  if (m[1][1] === '#') pc++;
  if (m[1][1] === 'b') pc--;
  const iv = QUAL[m[2]];
  if (!iv) throw new Error('bad chord ' + s);
  return { root: (pc + 12) % 12, iv };
}
/** Chord tones with root in the given octave (C4 = 60). */
const tones = (c: Chord, oct: number) => c.iv.map((i) => 12 * (oct + 1) + c.root + i);
/** Close voicing around a centre midi note. */
function voicing(c: Chord, centre = 62): number[] {
  return c.iv.slice(0, 4).map((i) => {
    let n = c.root + i + 12 * 4;
    while (n < centre - 6) n += 12;
    while (n > centre + 6) n -= 12;
    return n;
  }).sort((a, b) => a - b);
}

type Mel = ({ n: number; len: number } | null)[];
/** 16 space-separated tokens per bar: note name, '-' = tie, '.' = rest. */
export function mel(s: string): Mel {
  const tok = s.trim().split(/\s+/);
  const out: Mel = new Array(16).fill(null);
  let last = -1;
  for (let i = 0; i < 16 && i < tok.length; i++) {
    const k = tok[i];
    if (k === '-') { if (last >= 0) out[last]!.len++; }
    else if (k === '.') last = -1;
    else { out[i] = { n: noteMidi(k), len: 1 }; last = i; }
  }
  return out;
}
export const melTokenCount = (s: string) => s.trim().split(/\s+/).length;

/** Drum pattern: x = 1, X = 1.25 accent, o = 0.5 ghost, . = none. */
function pat(s: string): number[] {
  return [...s.replace(/\s/g, '')].map((ch) => (ch === 'x' ? 1 : ch === 'X' ? 1.25 : ch === 'o' ? 0.5 : 0));
}

// ------------------------------------------------------------------ track definition
export interface StepInfo {
  bar: number; // bar within loop
  step: number; // 16th within bar
  t: number; // time
  d16: number; // duration of a 16th
  chord: Chord;
  loop: number; // how many times the loop has repeated
  B: boolean; // in B section (second half)
}
export interface TrackDef {
  bpm: number;
  bars: number;
  swing?: number;
  prog: string[];
  lowpass?: number; // whole-track tone (lo-fi)
  gain?: number;
  render(c: Ctx, s: StepInfo): void;
}

/** Instrument context bound to a track's output. */
export class Ctx {
  constructor(public base: SynthCtx) {}
  at(t: number): SynthCtx { return { ...this.base, t }; }
}

function playMel(c: Ctx, m: Mel | undefined, s: StepInfo, kind: I.LeadKind, g = 1, trans = 0) {
  const e = m?.[s.step];
  if (e) I.lead(c.at(s.t), e.n + trans, e.len * s.d16 * 0.92, g, kind);
}
const mels = (arr: string[]) =>
  arr.map((x) => {
    if (!x) return undefined;
    if (melTokenCount(x) !== 16 && typeof console !== 'undefined') console.warn('[audio] melody bar has ' + melTokenCount(x) + ' tokens: ' + x);
    return mel(x);
  });

function fill(c: Ctx, s: StepInfo, from = 8, toms = true) {
  if (s.step < from) return false;
  const k = s.step - from;
  const len = 16 - from;
  I.snare(c.at(s.t), 0.45 + 0.5 * (k / len), 0.15);
  if (toms && s.step % 4 === 2) I.tom(c.at(s.t), 220 - (s.step - from) * 12, 0.6);
  return true;
}

// ------------------------------------------------------------------ tracks
const MENU_LEAD = mels([
  'D5 - - A4 D5 - E5 - F#5 - - E5 D5 - A4 -',
  'B4 - - . D5 - - B4 F#5 - - . E5 - D5 -',
  'G5 - - F#5 E5 - D5 - B4 - D5 - E5 - - .',
  'C#5 - - - E5 - - - A5 - - - G5 - F#5 E5',
  'D5 - - A4 D5 - E5 - F#5 - - E5 D5 - A4 -',
  'B4 - - . D5 - - B4 F#5 - - . E5 - D5 -',
  'G5 - - A5 B5 - A5 - G5 - F#5 - E5 - D5 -',
  'E5 - - - - - - . A4 - C#5 - E5 - A5 -',
  'B5 - - - - - A5 - G5 - - - D5 - - .',
  'C#6 - - - - - B5 - A5 - - - E5 - - .',
  'A5 - - - F#5 - - - C#6 - - - A5 - - -',
  'B5 - - - - - - - D6 - C#6 - B5 - A5 -',
  'B5 - - - - - A5 - G5 - - - D5 - - .',
  'C#6 - - - - - B5 - A5 - - - E5 - - .',
  'F#5 - - - D5 - - - B4 - D5 - F#5 - B5 -',
  'A5 - - - - - - - . . . . . . . .',
]);
const menu: TrackDef = {
  gain: 0.73, bpm: 120, bars: 16,
  prog: ['D', 'Bm', 'G', 'A', 'D', 'Bm', 'G', 'A', 'G', 'A', 'F#m', 'Bm', 'G', 'A', 'Bm', 'A'],
  render(c, s) {
    const T = c.at(s.t);
    const fillBar = s.bar === 7 || s.bar === 15;
    if (pat('x...x...x...x...')[s.step]) I.kick(T, 1);
    if (!(fillBar && fill(c, s, 10))) {
      if (s.step === 4 || s.step === 12) { I.snare(T, 0.9); if (s.B) I.clap(T, 0.5); }
    }
    const hp = s.B ? pat('oxoxoxoxoxoxoxox') : pat('o.x.o.x.o.x.o.x.');
    if (hp[s.step]) I.hat(T, 0.5 * hp[s.step], s.B && s.step % 4 === 2);
    if ((s.bar === 0 || s.bar === 8) && s.step === 0) I.crash(T, 0.6);
    // bass
    const root = tones(s.chord, 2)[0];
    const bp = s.B ? pat('x.xx.x.xx.xx.x.x') : pat('x.x.x.x.x.x.x.x.');
    if (bp[s.step]) I.bass(T, root + (s.step % 4 === 2 ? 12 : 0), s.d16 * 1.6, 0.9, 'saw');
    // chords
    const v = voicing(s.chord, 64);
    if (!s.B) {
      if (s.step === 0 || s.step === 6 || s.step === 10) for (const n of v) I.lead(T, n, s.d16 * 2, 0.45, 'pluck');
    } else {
      if (s.step === 0) I.pad(T, v, s.d16 * 16, 0.8, 'warm', 1800);
      const arp = [0, 1, 2, 1];
      const tt = tones(s.chord, 5);
      I.lead(T, tt[arp[s.step % 4] % tt.length], s.d16, 0.35, 'pluck');
    }
    playMel(c, MENU_LEAD[s.bar], s, s.B ? 'saw' : 'square', 1, s.loop % 2 === 1 && !s.B ? 12 : 0);
  },
};

const garage: TrackDef = {
  gain: 0.85, bpm: 95, bars: 16, swing: 0.18, lowpass: 5200,
  prog: ['Fm7', 'Bbm7', 'Eb7', 'Abmaj7', 'Dbmaj7', 'Bbm7', 'C7', 'C7', 'Fm7', 'Bbm7', 'Eb7', 'Abmaj7', 'Dbmaj7', 'Bbm7', 'C7', 'C7'],
  render(c, s) {
    const T = c.at(s.t);
    const k = s.bar % 2 === 0 ? pat('x.....x...x.....') : pat('x.....x.x.....o.');
    if (k[s.step]) I.kick(T, 0.85 * k[s.step]);
    if (s.step === 4 || s.step === 12) I.snare(T, 0.6, 0.3);
    if (pat('..o.......o....o')[s.step]) I.rim(T, 0.5);
    const h = pat('x.o.x.o.x.o.x.o.');
    if (h[s.step]) I.hat(T, 0.35 * h[s.step]);
    if (s.bar % 2 === 1 && s.step === 14) I.metal(T, 0.25, 900); // servo tick
    if (s.bar === 15 && s.step >= 12) I.tom(T, 180 - (s.step - 12) * 20, 0.4);
    const r = tones(s.chord, 2);
    const bl: Record<number, [number, number]> = { 0: [r[0], 5], 6: [r[0], 2], 10: [r[2] ?? r[0], 3], 14: [r[0] + 12, 2] };
    const b = bl[s.step];
    if (b) I.bass(T, b[0], b[1] * s.d16, 0.9, 'fm');
    const v = voicing(s.chord, 63);
    if (s.step === 0 || s.step === 7) for (const n of v) I.lead(T, n, (s.step === 0 ? 6 : 3) * s.d16, 0.4, 'epiano');
    if (s.B || s.loop % 2 === 1) {
      const R = rng(s.bar * 31 + 7);
      const steps = [2, 8, 11];
      const idx = steps.indexOf(s.step);
      if (idx >= 0) {
        const tt = tones(s.chord, 5);
        const n = tt[Math.floor(R() * 7 + idx * 3) % tt.length];
        I.lead(T, n, s.d16 * 3, 0.55, 'bell');
      }
    }
  },
};

const VICTORY_LEAD = mels([
  'C5 - E5 - G5 - C6 - - - G5 - C6 - - -',
  'A5 - - - F5 - A5 - C6 - - - A5 - - -',
  'B5 - - - D6 - - - G5 - B5 - D6 - F6 -',
  'E6 - - - - - - - C6 - - - - - - -',
  'C6 - - - A5 - E5 - A5 - C6 - E6 - - -',
  'F6 - - - E6 - D6 - C6 - - - A5 - - -',
  'D6 - - - - - G5 - B5 - D6 - G6 - - -',
  'C6 - - - - - - - - - - - - - - -',
]);
const victory: TrackDef = {
  gain: 0.83, bpm: 140, bars: 8,
  prog: ['C', 'F', 'G', 'C', 'Am', 'F', 'G', 'C'],
  render(c, s) {
    const T = c.at(s.t);
    if (s.step === 0 || s.step === 8 || (s.step === 10 && s.bar % 2 === 1)) I.kick(T, 0.9);
    if (s.step === 4 || s.step === 12) I.snare(T, 0.8, 0.3);
    if (s.step % 2 === 0) I.hat(T, 0.35);
    if (s.bar === 0 && s.step === 0) I.crash(T, 0.6);
    if (s.bar === 7 && s.step >= 12) I.tom(T, 200 - (s.step - 12) * 25, 0.5);
    if (s.step % 4 === 0) I.bass(T, tones(s.chord, 2)[0] + (s.step === 8 ? 7 : 0), s.d16 * 3, 0.85, 'saw');
    if (s.step === 0 || s.step === 6 || s.step === 10) I.brass(T, voicing(s.chord, 64), 0, s.d16 * (s.step === 0 ? 5 : 3), 0.32, 3200);
    playMel(c, VICTORY_LEAD[s.bar], s, 'square', 1);
  },
};

const RESULTS_LEAD = mels([
  '', '', '', '', '', '', '', '',
  'G5 - - - - - Bb5 - D6 - - - - - - -',
  'Eb6 - - - D6 - - - C6 - - - G5 - - -',
  'C6 - - - - - - - Eb6 - - - - - - -',
  'D6 - - - C6 - Bb5 - F5 - - - - - - -',
  'Bb5 - - - - - D6 - F6 - - - - - - -',
  'Eb6 - - - - - D6 - C6 - - - Bb5 - - -',
  'C6 - - - - - - - - - - - Eb6 - - -',
  'D6 - - - - - - - - - - - - - - -',
]);
const results: TrackDef = {
  gain: 0.95, bpm: 90, bars: 16, swing: 0.12, lowpass: 6000,
  prog: ['Ebmaj7', 'Cm7', 'Abmaj7', 'Bb', 'Ebmaj7', 'Cm7', 'Abmaj7', 'Bb', 'Gm7', 'Cm7', 'Abmaj7', 'Bb', 'Gm7', 'Cm7', 'Abmaj7', 'Bb'],
  render(c, s) {
    const T = c.at(s.t);
    const drums = s.bar >= 4 || s.loop > 0;
    if (drums) {
      if (s.step === 0 || s.step === 10) I.kick(T, 0.6);
      if (s.step === 4 || s.step === 12) I.rim(T, 0.45);
      if (s.step % 2 === 0) I.hat(T, 0.18);
    }
    if (s.step === 0 || s.step === 8) I.bass(T, tones(s.chord, 2)[0], s.d16 * (s.step === 0 ? 7 : 6), 0.75, 'sub');
    if (s.step === 0) I.pad(T, voicing(s.chord, 63), s.d16 * 16, 0.8, 'warm', 1000);
    const tt = tones(s.chord, 4);
    const ai = [0, 3, 6, 9, 12].indexOf(s.step);
    if (ai >= 0 && (!s.B || ai % 2 === 0)) I.lead(T, tt[ai % tt.length] + (ai >= tt.length ? 12 : 0), s.d16 * 3, 0.45, 'epiano');
    playMel(c, RESULTS_LEAD[s.bar], s, 'bell', 0.9);
  },
};

/** Driving arena techno: four-on-the-floor, offbeat bass and sparse industrial stabs.
 * Bass rests on kick transients, leaving headroom and space for weapon tells. */
function club(bpm: number, root: string, variant: number): TrackDef {
  return {
    bpm, bars: 16, gain: 0.72,
    prog: Array.from({ length: 16 }, (_, bar) => bar % 8 === 6 ? `${root}m7` : `${root}5`),
    render(c, s) {
      const T = c.at(s.t), r = tones(s.chord, 1)[0];
      const breakBar = s.bar === 7 || s.bar === 15;
      if (s.step % 4 === 0 && !(breakBar && s.step >= 12)) I.kick(T, 1.05, true);
      if (s.step === 4 || s.step === 12) { I.snare(T, 0.66, 0.12); I.clap(T, 0.25); }
      if (s.step % 4 === 2) I.hat(T, 0.4, true);
      else if (s.step % 2 === 1) I.hat(T, s.B ? 0.22 : 0.12);
      if (s.step % 4 !== 0) {
        const octave = s.step % 4 === 2 ? 12 : 0;
        I.bass(T, r + octave, s.d16 * 0.75, 0.75, 'dist');
      }
      const rhythm = variant === 1 ? [2, 5, 10, 13] : [3, 6, 11, 14];
      if (rhythm.includes(s.step)) {
        const pitch = [0, 1, 7, 12][(s.step + variant + (s.B ? 1 : 0)) % 4];
        I.lead(T, r + 36 + pitch, s.d16 * 0.65, s.B ? 0.43 : 0.3, 'dsaw');
      }
      if (s.B && s.step % 4 === 3) I.metal(T, 0.24, 440 + variant * 170);
      if (breakBar && s.step >= 12) I.snare(T, 0.3 + (s.step - 12) * 0.1, 0.1);
      if (s.bar % 8 === 0 && s.step === 0) I.crash(T, 0.4);
      if (s.step === 0 && s.bar % 4 === 0) I.pad(T, [r + 24, r + 31], s.d16 * 12, 0.3, 'dark', 900);
    },
  };
}
export const TRACKS: Record<MusicTrack, TrackDef> = {
  menu, garage, foundry: club(144, 'E', 0), garden: club(140, 'D', 1),
  orbital: club(146, 'A', 2), champion: club(150, 'C', 3), victory, results,
};

// ------------------------------------------------------------------ sequencer
export class Sequencer {
  private step = 0; // global 16th counter
  private t0: number;
  private chords: Chord[];
  private c: Ctx;
  readonly d16: number;
  constructor(public ctx: BaseAudioContext, out: AudioNode, rev: AudioNode | undefined, public def: TrackDef, t0: number) {
    this.t0 = t0;
    this.d16 = 60 / def.bpm / 4;
    this.chords = def.prog.map(parseChord);
    let dest: AudioNode = out;
    if (def.gain !== undefined && def.gain !== 1) {
      const g = ctx.createGain();
      g.gain.value = def.gain;
      g.connect(dest);
      dest = g;
    }
    if (def.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = def.lowpass;
      lp.Q.value = 0.5;
      lp.connect(dest);
      dest = lp;
    }
    this.c = new Ctx({ ctx, out: dest, rev, t: t0, p: 1 });
  }
  /** Length of one loop in seconds. */
  get loopLength() { return this.def.bars * 16 * this.d16; }
  /** Schedule every step whose time is < until. If we fell behind (tab throttled), skip ahead. */
  pump(until: number, now?: number) {
    if (now !== undefined) {
      const behind = now - (this.t0 + this.step * this.d16);
      if (behind > 0.05) this.step += Math.ceil(behind / this.d16);
    }
    let guard = 0;
    while (this.t0 + this.step * this.d16 < until && guard++ < 512) {
      const stepInLoop = this.step % (this.def.bars * 16);
      const bar = Math.floor(stepInLoop / 16);
      const st = stepInLoop % 16;
      let t = this.t0 + this.step * this.d16;
      if (this.def.swing && st % 2 === 1) t += this.def.swing * this.d16;
      try {
        this.def.render(this.c, {
          bar, step: st, t, d16: this.d16, chord: this.chords[bar % this.chords.length],
          loop: Math.floor(this.step / (this.def.bars * 16)), B: bar >= this.def.bars / 2,
        });
      } catch (e) {
        // never let a music glitch break the game
        if (typeof console !== 'undefined') console.warn('[audio] music step failed', e);
      }
      this.step++;
    }
  }
}
