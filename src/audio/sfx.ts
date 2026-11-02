// SFX recipes. Each recipe renders one sound into c.out (and optionally c.rev) starting at c.t,
// and returns its approximate length in seconds. Works on any BaseAudioContext.
import { SynthCtx, tone, noise, fm, withDrive, withFilter, shift, rng } from './synth';
import { brass, kick, crash, riser, tom } from './inst';
import type { SfxName } from './audio';

type Recipe = (c: SynthCtx) => number;

export interface SfxDef {
  fn: Recipe;
  vol: number; // base level
  voices: number; // max concurrent voices
  rev: number; // reverb send
  vary: number; // random pitch variation (+/- fraction)
  spatial?: boolean; // default true; UI/announcer are not panned
}

// Helpers -----------------------------------------------------------------------
const crackles = (c: SynthCtx, count: number, span: number, g: number, seed: number) => {
  const r = rng(seed + Math.floor(Math.random() * 1000));
  for (let i = 0; i < count; i++) {
    const at = Math.pow(r(), 1.4) * span;
    noise(c, { ftype: 'highpass', f: 2500 + r() * 4000, at, d: 0.01 + r() * 0.03, g: g * (0.4 + r() * 0.6) });
  }
};
const sparkle = (c: SynthCtx, at: number, count: number, span: number, g: number) => {
  const notes = [2093, 2637, 3136, 3520, 4186, 5274];
  for (let i = 0; i < count; i++) {
    const f = notes[Math.floor(Math.random() * notes.length)];
    fm(c, { f, ratio: 3.5, idx: 1.2, at: at + (i / count) * span + Math.random() * 0.03, d: 0.25, g, rev: 0.6 });
  }
};
const M = (n: string) => {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n)!;
  const pc: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return 12 * (+m[3] + 1) + pc[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};
const chordM = (s: string) => s.split(' ').map(M);

// Recipes -----------------------------------------------------------------------
const R: Record<SfxName, Recipe> = {
  // ---------------- UI
  ui_move: (c) => {
    tone(c, { f: 1900, f1: 1500, d: 0.035, g: 0.25 });
    noise(c, { ftype: 'highpass', f: 6000, d: 0.01, g: 0.08 });
    return 0.06;
  },
  ui_select: (c) => {
    tone(c, { type: 'triangle', f: 988, d: 0.06, g: 0.3 });
    tone(c, { type: 'triangle', f: 1480, at: 0.05, d: 0.14, g: 0.3, rev: 0.3 });
    tone(c, { f: 2960, at: 0.05, d: 0.1, g: 0.08 });
    return 0.22;
  },
  ui_back: (c) => {
    tone(c, { type: 'triangle', f: 740, f1: 520, d: 0.07, g: 0.28 });
    tone(c, { type: 'triangle', f: 440, at: 0.05, d: 0.1, g: 0.25 });
    return 0.18;
  },
  ui_unlock: (c) => {
    const ns = [1047, 1319, 1568, 2093, 2637, 3136];
    ns.forEach((f, i) => fm(c, { f, ratio: 3.5, idx: 1.5, at: i * 0.055, d: 0.35, g: 0.13, rev: 0.5 }));
    tone(c, { type: 'triangle', f: 523, at: 0, d: 0.5, g: 0.12 });
    noise(c, { ftype: 'highpass', f: 8000, at: 0.1, a: 0.1, d: 0.5, g: 0.05, rev: 0.4 });
    return 0.9;
  },
  ui_error: (c) => {
    const f = withFilter(c, 'lowpass', 1400, 1);
    for (const at of [0, 0.12]) {
      tone(f, { type: 'square', f: 110, at, a: 0.004, h: 0.07, d: 0.03, g: 0.18 });
      tone(f, { type: 'sawtooth', f: 117, at, a: 0.004, h: 0.07, d: 0.03, g: 0.12 });
    }
    return 0.26;
  },

  // ---------------- movement
  footstep: (c) => {
    fm(c, { f: 330, ratio: 2.76, idx: 2, d: 0.05, g: 0.18 });
    noise(c, { ftype: 'bandpass', f: 2600, q: 3, d: 0.03, g: 0.14 });
    tone(c, { f: 130, f1: 60, d: 0.05, g: 0.3 });
    // tiny servo whirr
    tone(withFilter(c, 'lowpass', 1500), { type: 'sawtooth', f: 260, f1: 340, at: 0.012, d: 0.03, g: 0.04 });
    return 0.08;
  },
  jump: (c) => {
    noise(c, { ftype: 'bandpass', f: 700, f1: 2400, q: 1, a: 0.01, d: 0.2, g: 0.45 });
    noise(c, { kind: 'brown', ftype: 'lowpass', f: 500, d: 0.12, g: 0.35 });
    tone(withFilter(c, 'lowpass', 1600), { type: 'sawtooth', f: 180, f1: 330, d: 0.09, g: 0.1 });
    tone(c, { f: 160, f1: 90, d: 0.07, g: 0.25 });
    return 0.25;
  },
  double_jump: (c) => {
    noise(c, { ftype: 'highpass', f: 1500, f1: 5000, a: 0.01, d: 0.22, g: 0.35 });
    noise(c, { ftype: 'bandpass', f: 1500, f1: 3500, q: 1.5, d: 0.15, g: 0.25 });
    tone(c, { f: 500, f1: 1150, d: 0.13, g: 0.14 });
    return 0.26;
  },
  dash: (c) => {
    noise(c, { ftype: 'bandpass', f: 500, f1: 3200, glide: 0.12, q: 1.2, a: 0.015, d: 0.26, g: 0.6 });
    noise(c, { kind: 'brown', ftype: 'lowpass', f: 900, f1: 300, a: 0.004, d: 0.2, g: 0.55 });
    tone(withDrive(c, 3, 0.6), { type: 'sawtooth', f: 95, f1: 55, d: 0.16, g: 0.16 });
    noise(c, { ftype: 'highpass', f: 5000, d: 0.04, g: 0.2 });
    return 0.32;
  },
  land: (c) => {
    tone(c, { f: 150, f1: 45, d: 0.15, g: 0.6 });
    noise(c, { ftype: 'lowpass', f: 500, d: 0.08, g: 0.35 });
    fm(c, { f: 260, ratio: 1.41, idx: 2, d: 0.08, g: 0.1 });
    noise(c, { ftype: 'highpass', f: 4000, at: 0.05, a: 0.02, d: 0.22, g: 0.1 });
    return 0.32;
  },
  land_heavy: (c) => {
    tone(c, { f: 120, f1: 33, glide: 0.3, d: 0.4, g: 0.8 });
    noise(c, { kind: 'brown', ftype: 'lowpass', f: 400, d: 0.25, g: 0.6 });
    fm(c, { f: 180, ratio: 1.41, idx: 3, d: 0.22, g: 0.2, rev: 0.3 });
    noise(c, { ftype: 'bandpass', f: 1800, q: 1, d: 0.05, g: 0.3 });
    noise(c, { ftype: 'highpass', f: 3500, at: 0.08, a: 0.03, h: 0.1, d: 0.4, g: 0.15 });
    return 0.65;
  },

  // ---------------- guns
  gun_blaster: (c) => {
    tone(withFilter(c, 'lowpass', 4500), { type: 'square', f: 1500, f1: 220, glide: 0.09, d: 0.09, g: 0.16 });
    tone(c, { f: 950, f1: 130, glide: 0.1, d: 0.11, g: 0.4 });
    fm(c, { f: 640, f1: 160, ratio: 1.5, idx: 3, d: 0.075, g: 0.2 });
    noise(c, { ftype: 'highpass', f: 3000, d: 0.015, g: 0.25 });
    tone(c, { f: 120, f1: 60, d: 0.06, g: 0.3 });
    return 0.14;
  },
  gun_rail: (c) => {
    noise(c, { ftype: 'highpass', f: 1500, d: 0.05, g: 0.6 });
    tone(withDrive(c, 3, 0.5), { type: 'sawtooth', f: 3200, f1: 80, glide: 0.25, d: 0.3, g: 0.3 });
    fm(c, { f: 220, f1: 55, ratio: 3.1, idx: 8, idx1: 0.5, d: 0.42, g: 0.3 });
    tone(c, { f: 85, f1: 35, d: 0.35, g: 0.5 });
    noise(c, { ftype: 'bandpass', f: 3000, f1: 500, q: 1, at: 0.02, d: 0.5, g: 0.15, rev: 0.4 });
    crackles(c, 6, 0.25, 0.12, 5);
    return 0.6;
  },
  gun_rail_charge: (c) => {
    tone(withFilter(c, 'bandpass', 600, 2, 3500, 0.4), { type: 'sawtooth', f: 200, f1: 1600, glide: 0.4, a: 0.3, h: 0.05, d: 0.08, g: 0.2 });
    tone(c, { f: 400, f1: 3200, glide: 0.42, a: 0.35, d: 0.07, g: 0.12, vib: [30, 40] });
    noise(c, { ftype: 'highpass', f: 2000, f1: 9000, glide: 0.4, a: 0.38, d: 0.05, g: 0.08 });
    return 0.46;
  },
  gun_scatter: (c) => {
    const ks = [1, 1.19, 0.87];
    ks.forEach((k, i) => {
      const at = i * 0.018;
      tone(c, { type: 'square', f: 1150 * k, f1: 180, glide: 0.07, at, d: 0.07, g: 0.11 });
      noise(c, { ftype: 'bandpass', f: 2200 * k, q: 2, at, d: 0.04, g: 0.18 });
    });
    noise(withDrive(c, 4, 0.5), { ftype: 'lowpass', f: 1800, f1: 400, d: 0.12, g: 0.55 });
    tone(c, { f: 150, f1: 50, d: 0.11, g: 0.45 });
    return 0.18;
  },

  // ---------------- bombs
  bomb_throw: (c) => {
    tone(c, { f: 95, f1: 45, d: 0.2, g: 0.7 });
    noise(c, { kind: 'brown', ftype: 'lowpass', f: 400, f1: 120, d: 0.18, g: 0.5 });
    tone(c, { f: 420, f1: 210, d: 0.06, g: 0.2 });
    noise(c, { ftype: 'bandpass', f: 900, q: 1, at: 0.04, a: 0.03, d: 0.15, g: 0.12 });
    return 0.3;
  },
  bomb_bounce: (c) => {
    fm(c, { f: 900, ratio: 2.71, idx: 2.5, d: 0.18, g: 0.28 });
    tone(c, { f: 2450, d: 0.09, g: 0.1 });
    noise(c, { ftype: 'highpass', f: 5000, d: 0.01, g: 0.15 });
    return 0.22;
  },
  explosion_small: (c) => {
    noise(c, { ftype: 'highpass', f: 1000, d: 0.06, g: 0.55 });
    tone(c, { f: 130, f1: 40, glide: 0.35, d: 0.45, g: 0.65 });
    noise(withDrive(c, 2, 0.6), { kind: 'brown', ftype: 'lowpass', f: 1400, f1: 200, a: 0.004, d: 0.6, g: 0.6 });
    noise(c, { ftype: 'bandpass', f: 2200, f1: 600, q: 0.8, at: 0.03, d: 0.4, g: 0.12 });
    crackles(c, 5, 0.4, 0.08, 9);
    return 0.75;
  },
  explosion_big: (c) => {
    // transient crack
    noise(c, { ftype: 'highpass', f: 800, d: 0.08, g: 0.6 });
    noise(c, { ftype: 'bandpass', f: 3000, q: 0.7, d: 0.03, g: 0.4 });
    // low boom + sub
    tone(c, { f: 95, f1: 30, glide: 0.8, a: 0.004, d: 1.1, g: 0.6 });
    tone(c, { f: 52, f1: 28, glide: 1, a: 0.01, d: 1.2, g: 0.45 });
    // body
    noise(withDrive(c, 2.5, 0.5), { kind: 'brown', ftype: 'lowpass', f: 1000, f1: 110, glide: 1, a: 0.008, d: 1.2, g: 0.75 });
    // debris tail
    noise(c, { ftype: 'bandpass', f: 2600, f1: 500, q: 0.8, at: 0.05, a: 0.05, d: 1.1, g: 0.16 });
    crackles(c, 14, 1.0, 0.09, 21);
    return 1.4;
  },

  // ---------------- pods
  pod_launch: (c) => {
    noise(c, { ftype: 'bandpass', f: 1200, q: 1.5, d: 0.06, g: 0.5 });
    tone(c, { f: 320, f1: 100, d: 0.06, g: 0.3 });
    tone(withFilter(c, 'lowpass', 3000), { type: 'square', f: 600, f1: 1400, glide: 0.12, at: 0.04, d: 0.12, g: 0.07 });
    tone(c, { f: 1300, f1: 2500, at: 0.1, d: 0.09, g: 0.12 });
    return 0.22;
  },
  pod_seeker_ping: (c) => {
    tone(c, { f: 1750, a: 0.002, d: 0.45, g: 0.22, rev: 0.6 });
    tone(c, { f: 3500, d: 0.15, g: 0.05 });
    fm(c, { f: 1750, ratio: 1.01, idx: 0.5, d: 0.3, g: 0.06 });
    return 0.5;
  },

  // ---------------- melee
  charge_windup: (c) => {
    tone(withFilter(c, 'lowpass', 400, 3, 3000, 0.5), { type: 'sawtooth', f: 120, f1: 600, glide: 0.5, a: 0.45, d: 0.1, g: 0.2 });
    tone(c, { f: 300, f1: 1200, glide: 0.5, a: 0.45, d: 0.08, g: 0.1, vib: [18, 30] });
    noise(c, { ftype: 'bandpass', f: 500, f1: 4000, glide: 0.5, q: 2, a: 0.45, d: 0.1, g: 0.15 });
    return 0.58;
  },
  charge_swing: (c) => {
    noise(c, { ftype: 'bandpass', f: 300, f1: 2200, glide: 0.14, q: 1.5, a: 0.06, d: 0.26, g: 0.75 });
    tone(c, { f: 160, f1: 60, a: 0.03, d: 0.22, g: 0.3 });
    noise(c, { kind: 'brown', ftype: 'lowpass', f: 600, a: 0.04, d: 0.2, g: 0.35 });
    return 0.34;
  },

  // ---------------- combat
  hit_light: (c) => {
    fm(c, { f: 2200, ratio: 1.47, idx: 1.5, d: 0.12, g: 0.22 });
    tone(c, { type: 'sawtooth', f: 1800, f1: 400, d: 0.05, g: 0.08 });
    noise(c, { ftype: 'highpass', f: 4000, d: 0.025, g: 0.3 });
    tone(c, { f: 220, f1: 90, d: 0.05, g: 0.28 });
    return 0.15;
  },
  hit_heavy: (c) => {
    noise(withDrive(c, 3, 0.6), { ftype: 'lowpass', f: 2500, f1: 500, d: 0.13, g: 0.6 });
    tone(c, { f: 160, f1: 45, d: 0.25, g: 0.7 });
    fm(c, { f: 420, ratio: 1.73, idx: 4, d: 0.2, g: 0.22 });
    noise(c, { ftype: 'bandpass', f: 1200, q: 2, d: 0.08, g: 0.35 });
    noise(c, { ftype: 'highpass', f: 5000, d: 0.02, g: 0.25 });
    return 0.32;
  },
  shield_block: (c) => {
    fm(c, { f: 520, ratio: 2, idx: 3, idx1: 0.2, d: 0.35, g: 0.25 });
    tone(c, { f: 1040, d: 0.3, g: 0.12, vib: [14, 40] });
    noise(c, { ftype: 'highpass', f: 3000, d: 0.05, g: 0.3 });
    tone(withFilter(c, 'lowpass', 1500), { type: 'sawtooth', f: 262, f1: 240, d: 0.3, g: 0.08 });
    return 0.4;
  },
  knockdown: (c) => {
    noise(withDrive(c, 2.5, 0.6), { ftype: 'lowpass', f: 3000, f1: 300, d: 0.5, g: 0.6 });
    tone(c, { f: 130, f1: 35, glide: 0.4, d: 0.5, g: 0.7 });
    fm(c, { f: 240, ratio: 1.41, idx: 5, d: 0.5, g: 0.18 });
    tone(withFilter(c, 'lowpass', 2500, 2, 300, 0.8, 0.15), { type: 'sawtooth', f: 800, f1: 55, glide: 0.8, at: 0.15, a: 0.01, d: 0.8, g: 0.2 });
    tone(c, { type: 'square', f: 400, f1: 40, glide: 0.8, at: 0.15, d: 0.8, g: 0.04 });
    return 1.05;
  },
  getup: (c) => {
    tone(withFilter(c, 'lowpass', 3000), { type: 'square', f: 200, f1: 1200, glide: 0.35, a: 0.02, d: 0.3, g: 0.08 });
    tone(c, { f: 400, f1: 1600, glide: 0.3, at: 0.05, d: 0.28, g: 0.15 });
    tone(c, { f: 1600, at: 0.35, d: 0.05, g: 0.12 });
    tone(c, { f: 2100, at: 0.41, d: 0.1, g: 0.12, rev: 0.4 });
    return 0.55;
  },
  ko: (c) => {
    noise(c, { ftype: 'highpass', f: 600, d: 0.1, g: 0.6 });
    tone(c, { f: 110, f1: 28, glide: 0.8, d: 0.9, g: 0.8 });
    noise(withDrive(c, 2.5, 0.5), { kind: 'brown', ftype: 'lowpass', f: 900, f1: 100, d: 1, g: 0.6 });
    fm(c, { f: 300, ratio: 1.41, idx: 6, d: 0.6, g: 0.15, rev: 0.6 });
    tone(withFilter(c, 'lowpass', 3000, 2, 200, 1.6, 0.1), { type: 'sawtooth', f: 1200, f1: 40, glide: 1.6, at: 0.1, d: 1.6, g: 0.18, rev: 0.6 });
    tone(c, { type: 'square', f: 600, f1: 30, glide: 1.6, at: 0.1, d: 1.6, g: 0.035 });
    return 2.0;
  },

  // ---------------- match
  capsule_launch: (c) => {
    tone(c, { f: 85, f1: 35, d: 0.4, g: 0.75 });
    noise(c, { ftype: 'lowpass', f: 1500, d: 0.2, g: 0.55 });
    noise(c, { ftype: 'bandpass', f: 600, f1: 3200, glide: 0.6, q: 1, at: 0.05, a: 0.1, d: 0.6, g: 0.4 });
    return 0.8;
  },
  capsule_bounce: (c) => {
    fm(c, { f: 180, ratio: 1.5, idx: 2, d: 0.3, g: 0.4 });
    tone(c, { f: 360, f1: 330, d: 0.25, g: 0.22 });
    noise(c, { ftype: 'bandpass', f: 700, q: 4, d: 0.1, g: 0.35 });
    tone(c, { f: 90, f1: 60, d: 0.12, g: 0.4 });
    return 0.35;
  },
  capsule_open: (c) => {
    noise(c, { ftype: 'highpass', f: 3000, f1: 1500, a: 0.02, h: 0.2, d: 0.4, g: 0.28 });
    fm(c, { f: 1200, ratio: 3.3, idx: 2, d: 0.05, g: 0.25 });
    fm(c, { f: 950, ratio: 3.3, idx: 2, at: 0.09, d: 0.05, g: 0.25 });
    tone(c, { f: 170, f1: 90, at: 0.09, d: 0.12, g: 0.4 });
    sparkle(c, 0.3, 7, 0.45, 0.07);
    return 1.1;
  },
  announce_ready: (c) => {
    riser(c, 0, 0.85, 0.3);
    tone(c, { type: 'sawtooth', f: 110, f1: 880, glide: 0.88, a: 0.85, d: 0.05, g: 0.06 });
    const s = shift(c, 0.88);
    kick(s, 0.8);
    brass(c, chordM('D4 F#4 A4 D5'), 0.88, 0.55, 0.45, 3800);
    brass(c, chordM('D3'), 0.88, 0.55, 0.25, 1500);
    return 1.8;
  },
  announce_go: (c) => {
    kick(c, 1, true);
    noise(c, { ftype: 'highpass', f: 1000, d: 0.05, g: 0.4 });
    brass(c, chordM('G3 D4 G4 B4 D5'), 0.0, 0.35, 0.55, 4500, 0.008);
    brass(c, chordM('G2'), 0.0, 0.35, 0.3, 1200, 0.008);
    crash(c, 0.9, 1.3);
    return 1.6;
  },
  announce_ko: (c) => {
    tone(c, { f: 75, f1: 25, glide: 1.0, d: 1.2, g: 0.8 });
    noise(c, { ftype: 'highpass', f: 800, d: 0.1, g: 0.5 });
    noise(withDrive(c, 2, 0.5), { kind: 'brown', ftype: 'lowpass', f: 800, f1: 100, d: 0.8, g: 0.5 });
    brass(c, chordM('C3 G3 C4 Eb4 G4'), 0.05, 1.0, 0.5, 3000);
    crash(shift(c, 0.05), 0.8, 1.6);
    return 2.0;
  },
  announce_timeup: (c) => {
    const f = withFilter(c, 'lowpass', 2200, 1);
    for (const at of [0, 0.3]) {
      tone(f, { type: 'square', f: 220, at, a: 0.005, h: 0.2, d: 0.04, g: 0.13 });
      tone(f, { type: 'square', f: 233, at, a: 0.005, h: 0.2, d: 0.04, g: 0.13 });
    }
    brass(c, chordM('Bb3 D4 F4'), 0.7, 0.2, 0.42);
    brass(c, chordM('Ab3 C4 Eb4'), 0.95, 0.2, 0.42);
    brass(c, chordM('F3 Ab3 C4 F4'), 1.2, 0.7, 0.45, 2500);
    tom(shift(c, 1.2), 90, 0.8);
    return 2.3;
  },
  countdown_tick: (c) => {
    tone(c, { f: 1000, d: 0.09, g: 0.3, rev: 0.25 });
    tone(c, { type: 'square', f: 2000, d: 0.03, g: 0.04 });
    tone(c, { f: 160, f1: 80, d: 0.06, g: 0.25 });
    return 0.25;
  },
  victory: (c) => {
    brass(c, chordM('G4'), 0, 0.11, 0.3);
    brass(c, chordM('C5'), 0.13, 0.11, 0.3);
    brass(c, chordM('E5'), 0.26, 0.11, 0.3);
    brass(c, chordM('C4 E4 G4 C5'), 0.4, 0.42, 0.45);
    brass(c, chordM('Ab3 C4 Eb4 Ab4'), 0.9, 0.28, 0.45);
    brass(c, chordM('Bb3 D4 F4 Bb4'), 1.25, 0.28, 0.45);
    brass(c, chordM('C4 E4 G4 C5 E5'), 1.6, 1.1, 0.5, 4000);
    brass(c, chordM('C3'), 1.6, 1.1, 0.25, 1500);
    kick(shift(c, 0.4), 0.6);
    kick(shift(c, 1.6), 0.8);
    tom(shift(c, 0.9), 140, 0.5);
    tom(shift(c, 1.25), 160, 0.5);
    crash(shift(c, 1.6), 0.7, 1.4);
    sparkle(c, 1.7, 8, 0.8, 0.05);
    return 3.1;
  },
  defeat: (c) => {
    const ch = [
      ['A3 C4 E4', 0, 0.5],
      ['F3 A3 C4', 0.55, 0.5],
      ['E3 G#3 B3', 1.1, 0.5],
      ['A2 E3 A3 C4', 1.65, 0.8],
    ] as const;
    for (const [n, at, d] of ch) brass(c, chordM(n), at, d, 0.3, 1400, 0.08);
    const lead = ['E5', 'C5', 'B4', 'A4'];
    lead.forEach((n, i) => tone(c, { type: 'triangle', f: 440 * Math.pow(2, (M(n) - 69) / 12), at: i * 0.55, a: 0.04, h: 0.35, d: 0.3, g: 0.14, rev: 0.4, vib: [5, 10] }));
    return 2.7;
  },
  low_hp: (c) => {
    tone(c, { f: 880, d: 0.07, g: 0.16 });
    tone(c, { f: 880, at: 0.14, d: 0.07, g: 0.12 });
    return 0.25;
  },

  // ---------------- arena
  hazard_warn: (c) => {
    noise(c, { ftype: 'bandpass', f: 800, f1: 6000, glide: 1.15, q: 2, a: 1.1, d: 0.1, g: 0.3 });
    tone(withFilter(c, 'lowpass', 1500), { type: 'sawtooth', f: 100, f1: 400, glide: 1.15, a: 1.1, d: 0.1, g: 0.07, vib: [25, 60] });
    // crackle density increases
    for (let i = 0; i < 16; i++) {
      const at = 1.2 * Math.sqrt((i + Math.random()) / 16);
      noise(c, { ftype: 'highpass', f: 3000 + Math.random() * 3000, at, d: 0.015, g: 0.05 + 0.1 * (i / 16) });
    }
    return 1.3;
  },
  hazard_zap: (c) => {
    noise(withDrive(c, 3, 0.5), { ftype: 'highpass', f: 1500, d: 0.3, g: 0.5 });
    const bz = withDrive(withFilter(c, 'lowpass', 3000), 4, 0.5);
    tone(bz, { type: 'sawtooth', f: 60, a: 0.005, h: 0.15, d: 0.25, g: 0.3 });
    tone(bz, { type: 'sawtooth', f: 63, a: 0.005, h: 0.15, d: 0.25, g: 0.3 });
    fm(c, { f: 300, f1: 80, ratio: 7.1, idx: 10, idx1: 1, d: 0.3, g: 0.22 });
    noise(c, { ftype: 'highpass', f: 2500, a: 0.02, h: 0.2, d: 0.5, g: 0.18 });
    crackles(c, 10, 0.4, 0.12, 33);
    return 0.8;
  },
  platform_move: (c) => {
    const lp = withFilter(c, 'lowpass', 450, 1);
    tone(lp, { type: 'sawtooth', f: 55, a: 0.1, h: 0.6, d: 0.3, g: 0.2 });
    tone(lp, { type: 'sawtooth', f: 82.5, a: 0.1, h: 0.6, d: 0.3, g: 0.12 });
    tone(c, { f: 120, f1: 60, d: 0.15, g: 0.45 });
    fm(c, { f: 300, ratio: 1.41, idx: 3, d: 0.12, g: 0.15 });
    tone(c, { f: 110, f1: 55, at: 0.9, d: 0.15, g: 0.4 });
    fm(c, { f: 260, ratio: 1.41, idx: 3, at: 0.9, d: 0.12, g: 0.13 });
    noise(c, { ftype: 'highpass', f: 3000, at: 0.85, a: 0.02, d: 0.3, g: 0.12 });
    return 1.25;
  },
};

const D = (fn: Recipe, vol: number, voices: number, rev: number, vary: number, spatial = true): SfxDef => ({ fn, vol, voices, rev, vary, spatial });

export const SFX: Record<SfxName, SfxDef> = {
  ui_move: D(R.ui_move, 0.74, 3, 0.05, 0.02, false),
  ui_select: D(R.ui_select, 0.91, 3, 0.1, 0, false),
  ui_back: D(R.ui_back, 1.04, 3, 0.08, 0, false),
  ui_unlock: D(R.ui_unlock, 1.51, 2, 0.2, 0, false),
  ui_error: D(R.ui_error, 0.96, 2, 0.0, 0, false),
  footstep: D(R.footstep, 0.49, 6, 0.02, 0.1),
  jump: D(R.jump, 1.37, 4, 0.05, 0.06),
  double_jump: D(R.double_jump, 0.67, 4, 0.05, 0.06),
  dash: D(R.dash, 1.50, 4, 0.06, 0.06),
  land: D(R.land, 0.62, 4, 0.05, 0.06),
  land_heavy: D(R.land_heavy, 0.73, 3, 0.12, 0.05),
  gun_blaster: D(R.gun_blaster, 0.57, 6, 0.08, 0.06),
  gun_rail: D(R.gun_rail, 0.55, 3, 0.2, 0.03),
  gun_rail_charge: D(R.gun_rail_charge, 1.09, 2, 0.05, 0.02),
  gun_scatter: D(R.gun_scatter, 1.07, 4, 0.1, 0.05),
  bomb_throw: D(R.bomb_throw, 0.72, 4, 0.08, 0.06),
  bomb_bounce: D(R.bomb_bounce, 0.69, 6, 0.1, 0.1),
  explosion_small: D(R.explosion_small, 0.59, 5, 0.25, 0.08),
  explosion_big: D(R.explosion_big, 0.65, 4, 0.3, 0.06),
  pod_launch: D(R.pod_launch, 0.92, 6, 0.08, 0.06),
  pod_seeker_ping: D(R.pod_seeker_ping, 0.87, 4, 0.3, 0.02),
  charge_windup: D(R.charge_windup, 1.00, 2, 0.05, 0.03),
  charge_swing: D(R.charge_swing, 1.14, 3, 0.1, 0.06),
  hit_light: D(R.hit_light, 0.61, 6, 0.08, 0.08),
  hit_heavy: D(R.hit_heavy, 0.64, 4, 0.15, 0.06),
  shield_block: D(R.shield_block, 0.79, 4, 0.2, 0.05),
  knockdown: D(R.knockdown, 0.71, 3, 0.25, 0.04),
  getup: D(R.getup, 1.68, 3, 0.1, 0.03),
  ko: D(R.ko, 0.61, 2, 0.45, 0),
  capsule_launch: D(R.capsule_launch, 0.69, 2, 0.2, 0.05),
  capsule_bounce: D(R.capsule_bounce, 0.65, 4, 0.2, 0.1),
  capsule_open: D(R.capsule_open, 0.53, 2, 0.25, 0.03),
  announce_ready: D(R.announce_ready, 0.80, 1, 0.3, 0, false),
  announce_go: D(R.announce_go, 0.41, 1, 0.3, 0, false),
  announce_ko: D(R.announce_ko, 0.59, 1, 0.4, 0, false),
  announce_timeup: D(R.announce_timeup, 1.16, 1, 0.3, 0, false),
  countdown_tick: D(R.countdown_tick, 0.72, 2, 0.15, 0, false),
  victory: D(R.victory, 0.62, 1, 0.3, 0, false),
  defeat: D(R.defeat, 1.62, 1, 0.3, 0, false),
  low_hp: D(R.low_hp, 0.95, 1, 0.05, 0, false),
  hazard_warn: D(R.hazard_warn, 1.43, 3, 0.15, 0.03),
  hazard_zap: D(R.hazard_zap, 0.62, 3, 0.2, 0.06),
  platform_move: D(R.platform_move, 0.69, 3, 0.1, 0.04),
};
