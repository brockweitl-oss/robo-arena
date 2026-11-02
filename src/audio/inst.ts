// Shared synthesized instruments (drums, bass, pads, leads, brass) used by both the music
// sequencer and the announcer/fanfare SFX. All functions take a SynthCtx (any BaseAudioContext).
import { SynthCtx, tone, noise, fm, mtof, withDrive, clamp, adEnv, driveCurve } from './synth';

const RP = (c: SynthCtx): SynthCtx => ({ ...c, p: 1 });

// ------------------------------------------------------------------ drums
export function kick(c: SynthCtx, g = 1, hard = false) {
  const k = RP(c);
  tone(k, { f: hard ? 190 : 160, f1: 42, glide: 0.12, d: hard ? 0.32 : 0.38, g: 0.9 * g });
  noise(k, { ftype: 'highpass', f: 2500, d: 0.008, g: 0.25 * g });
  if (hard) {
    const dk = withDrive(k, 3, 0.5);
    tone(dk, { type: 'triangle', f: 260, f1: 60, glide: 0.06, d: 0.09, g: 0.5 * g });
  }
}

export function snare(c: SynthCtx, g = 1, rev = 0.2) {
  const s = RP(c);
  tone(s, { type: 'triangle', f: 210, f1: 150, glide: 0.08, d: 0.11, g: 0.45 * g });
  noise(s, { ftype: 'bandpass', f: 2200, q: 0.7, d: 0.17, g: 0.65 * g, rev });
  noise(s, { ftype: 'highpass', f: 6000, d: 0.07, g: 0.25 * g });
}

export function clap(c: SynthCtx, g = 1) {
  const s = RP(c);
  for (let i = 0; i < 3; i++) noise(s, { ftype: 'bandpass', f: 1300, q: 1.4, at: i * 0.011, d: 0.012, g: 0.5 * g });
  noise(s, { ftype: 'bandpass', f: 1200, q: 1.1, at: 0.033, d: 0.15, g: 0.55 * g, rev: 0.35 });
}

export function hat(c: SynthCtx, g = 1, open = false) {
  const s = RP(c);
  noise(s, { ftype: 'highpass', f: 7500, d: open ? 0.28 : 0.04, g: 0.3 * g });
  noise(s, { ftype: 'bandpass', f: 10500, q: 2, d: open ? 0.2 : 0.03, g: 0.15 * g });
}

/** Metallic anvil/pipe hit for industrial percussion. */
export function metal(c: SynthCtx, g = 1, f = 520) {
  const s = RP(c);
  fm(s, { f, ratio: 2.37, idx: 3, idx1: 0.3, d: 0.16, g: 0.22 * g, rev: 0.2 });
  fm(s, { f: f * 1.62, ratio: 1.41, idx: 2, d: 0.1, g: 0.12 * g });
  noise(s, { ftype: 'bandpass', f: 4200, q: 5, d: 0.05, g: 0.25 * g });
}

export function rim(c: SynthCtx, g = 1) {
  const s = RP(c);
  tone(s, { type: 'triangle', f: 1700, d: 0.03, g: 0.3 * g });
  noise(s, { ftype: 'bandpass', f: 3000, q: 4, d: 0.02, g: 0.3 * g });
}

export function crash(c: SynthCtx, g = 1, len = 1.4) {
  const s = RP(c);
  noise(s, { ftype: 'highpass', f: 4500, d: len, g: 0.32 * g, rev: 0.3 });
  noise(s, { ftype: 'bandpass', f: 7000, q: 1, d: len * 0.7, g: 0.2 * g });
}

export function tom(c: SynthCtx, f: number, g = 1) {
  const s = RP(c);
  tone(s, { f, f1: f * 0.55, glide: 0.2, d: 0.26, g: 0.6 * g, rev: 0.15 });
  noise(s, { ftype: 'lowpass', f: 1500, d: 0.04, g: 0.15 * g });
}

// ------------------------------------------------------------------ melodic
export type BassKind = 'saw' | 'dist' | 'sub' | 'pluck' | 'fm';

export function bass(c: SynthCtx, midi: number, dur: number, g = 1, kind: BassKind = 'saw') {
  const { ctx } = c;
  const t = c.t;
  const f = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = kind === 'pluck' ? 4 : 2;
  const base = kind === 'dist' ? 900 : kind === 'sub' ? 400 : 350;
  const peak = kind === 'pluck' ? 2600 : kind === 'dist' ? 2600 : 1500;
  lp.frequency.setValueAtTime(peak, t);
  lp.frequency.exponentialRampToValueAtTime(base, t + Math.min(0.25, dur + 0.05));
  const vca = ctx.createGain();
  const h = Math.max(0.01, dur - 0.02);
  vca.gain.setValueAtTime(0, t);
  vca.gain.linearRampToValueAtTime(0.32 * g, t + 0.004);
  vca.gain.setTargetAtTime(0.24 * g, t + 0.004, 0.08);
  vca.gain.setValueAtTime(0.24 * g, t + h);
  vca.gain.exponentialRampToValueAtTime(0.0001, t + h + 0.06);
  vca.gain.linearRampToValueAtTime(0, t + h + 0.07);
  let dest: AudioNode = vca;
  if (kind === 'dist') {
    const ws = ctx.createWaveShaper();
    ws.curve = driveCurve(5);
    ws.oversample = '2x';
    const post = ctx.createGain();
    post.gain.value = 0.55;
    lp.connect(ws);
    ws.connect(post);
    post.connect(vca);
  } else lp.connect(vca);
  vca.connect(c.out);
  const end = t + h + 0.1;
  const mk = (type: OscillatorType, fr: number, det: number, gg: number, target: AudioNode) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = fr;
    o.detune.value = det;
    const og = ctx.createGain();
    og.gain.value = gg;
    o.connect(og);
    og.connect(target);
    o.start(t);
    o.stop(end);
  };
  if (kind === 'sub') {
    mk('sine', f, 0, 1, vca);
    mk('triangle', f * 2, 0, 0.25, lp);
  } else if (kind === 'fm') {
    // round FM bass
    const mod = ctx.createOscillator();
    mod.frequency.value = f;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 2.5, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.3, t + 0.2);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    mod.connect(mg);
    mg.connect(car.frequency);
    car.connect(lp);
    car.start(t); mod.start(t); car.stop(end); mod.stop(end);
    mk('sine', f / 2, 0, 0.6, vca);
  } else {
    mk('sawtooth', f, -6, 0.6, lp);
    mk('sawtooth', f, 6, 0.6, lp);
    mk(kind === 'dist' ? 'sawtooth' : 'square', f / 2, 0, 0.5, lp);
  }
}

export type PadKind = 'warm' | 'glass' | 'dark' | 'string';

export function pad(c: SynthCtx, midis: number[], dur: number, g = 1, kind: PadKind = 'warm', cutoff = 1400) {
  const { ctx } = c;
  const t = c.t;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(cutoff * 0.6, t);
  lp.frequency.linearRampToValueAtTime(cutoff, t + Math.min(dur, 0.8));
  const vca = ctx.createGain();
  const a = Math.min(0.35, dur * 0.3);
  const rel = 0.5;
  const peak = (0.16 * g) / Math.sqrt(midis.length);
  vca.gain.setValueAtTime(0, t);
  vca.gain.linearRampToValueAtTime(peak, t + a);
  vca.gain.setValueAtTime(peak, t + Math.max(a, dur - 0.05));
  vca.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
  vca.gain.linearRampToValueAtTime(0, t + dur + rel + 0.01);
  lp.connect(vca);
  vca.connect(c.out);
  if (c.rev) {
    const s = ctx.createGain();
    s.gain.value = 0.45;
    vca.connect(s);
    s.connect(c.rev);
  }
  const end = t + dur + rel + 0.05;
  for (const m of midis) {
    const f = mtof(m);
    const types: OscillatorType[] = kind === 'glass' ? ['triangle', 'sine'] : kind === 'dark' ? ['sawtooth', 'triangle'] : ['sawtooth', 'sawtooth'];
    const dets = kind === 'string' ? [-11, 11] : [-7, 7];
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.type = types[i];
      o.frequency.value = kind === 'glass' && i === 1 ? f * 2 : f;
      o.detune.value = dets[i];
      o.connect(lp);
      o.start(t);
      o.stop(end);
    }
  }
}

export type LeadKind = 'square' | 'saw' | 'flute' | 'bell' | 'epiano' | 'brass' | 'pluck' | 'dsaw';

export function lead(c: SynthCtx, midi: number, dur: number, g = 1, kind: LeadKind = 'square') {
  const s = RP(c);
  const f = mtof(midi);
  const vib: [number, number] | undefined = dur > 0.25 ? [5.5, 12] : undefined;
  switch (kind) {
    case 'square': {
      const lp = withFilterAbs(s, 'lowpass', 3200, 1);
      tone(lp, { type: 'square', f, a: 0.006, h: Math.max(0, dur - 0.05), d: 0.12, g: 0.14 * g, vib, rev: 0.25 });
      tone(lp, { type: 'sawtooth', f, detune: 9, a: 0.006, h: Math.max(0, dur - 0.05), d: 0.12, g: 0.06 * g });
      break;
    }
    case 'saw':
    case 'dsaw': {
      const base = kind === 'dsaw' ? withDrive(s, 2.5, 0.5) : s;
      const lp = withFilterAbs(base, 'lowpass', kind === 'dsaw' ? 2600 : 3600, 2);
      for (const det of [-10, 0, 10]) {
        tone(lp, { type: 'sawtooth', f, detune: det, a: 0.008, h: Math.max(0, dur - 0.05), d: 0.15, g: 0.075 * g, vib, rev: 0.25 });
      }
      break;
    }
    case 'flute': {
      tone(s, { type: 'triangle', f, a: 0.03, h: Math.max(0, dur - 0.06), d: 0.12, g: 0.24 * g, vib, rev: 0.3 });
      tone(s, { type: 'sine', f: f * 2, a: 0.03, h: Math.max(0, dur - 0.06), d: 0.1, g: 0.04 * g });
      noise(s, { ftype: 'bandpass', f: f * 2, q: 3, a: 0.02, d: 0.08, g: 0.06 * g });
      break;
    }
    case 'bell':
      fm(s, { f, ratio: 3.5, idx: 1.8, idx1: 0.1, a: 0.002, d: 0.9 + dur * 0.5, g: 0.13 * g, rev: 0.45 });
      tone(s, { f, a: 0.002, d: 0.9, g: 0.06 * g });
      break;
    case 'epiano':
      fm(s, { f, ratio: 1, idx: 1.4, idx1: 0.15, a: 0.003, h: Math.max(0, dur * 0.4), d: 0.7, g: 0.12 * g, rev: 0.3 });
      fm(s, { f: f * 2, ratio: 7, idx: 0.6, idx1: 0.01, a: 0.001, d: 0.12, g: 0.03 * g });
      break;
    case 'brass':
      brass(s, [midi], 0, dur, 0.3 * g, 2800);
      break;
    case 'pluck': {
      const lp = withFilterAbs(s, 'lowpass', 4200, 3, 700, 0.18);
      tone(lp, { type: 'sawtooth', f, a: 0.002, d: Math.min(0.3, dur + 0.1), g: 0.12 * g, rev: 0.25 });
      tone(lp, { type: 'square', f, detune: 7, a: 0.002, d: Math.min(0.25, dur + 0.05), g: 0.06 * g });
      break;
    }
  }
}

function withFilterAbs(c: SynthCtx, type: BiquadFilterType, f: number, q: number, f1?: number, glide = 0.2): SynthCtx {
  const bq = c.ctx.createBiquadFilter();
  bq.type = type;
  bq.frequency.setValueAtTime(f, c.t);
  if (f1 !== undefined) bq.frequency.exponentialRampToValueAtTime(f1, c.t + glide);
  bq.Q.value = q;
  bq.connect(c.out);
  return { ...c, out: bq };
}

/** Brassy chord stab/hold: detuned saws through an enveloped lowpass. Pitch mult applies. */
export function brass(c: SynthCtx, midis: number[], at: number, dur: number, g = 0.5, bright = 3500, a = 0.02) {
  const { ctx } = c;
  const t = c.t + at;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(350, t);
  lp.frequency.exponentialRampToValueAtTime(bright, t + a + 0.04);
  lp.frequency.exponentialRampToValueAtTime(Math.max(400, bright * 0.35), t + dur + 0.2);
  const vca = ctx.createGain();
  const peak = g / Math.sqrt(midis.length);
  vca.gain.setValueAtTime(0, t);
  vca.gain.linearRampToValueAtTime(peak, t + a);
  vca.gain.setTargetAtTime(peak * 0.7, t + a, 0.15);
  vca.gain.setValueAtTime(peak * 0.7, t + dur);
  vca.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
  vca.gain.linearRampToValueAtTime(0, t + dur + 0.31);
  lp.connect(vca);
  vca.connect(c.out);
  if (c.rev) {
    const s = ctx.createGain();
    s.gain.value = 0.5;
    vca.connect(s);
    s.connect(c.rev);
  }
  const end = t + dur + 0.36;
  for (const m of midis) {
    const f = mtof(m) * c.p;
    for (const det of [-9, 9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.985, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.04); // brassy scoop
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = 0.45;
      o.connect(og);
      og.connect(lp);
      o.start(t);
      o.stop(end);
    }
  }
}

/** Short noise riser (for fills / announcer). */
export function riser(c: SynthCtx, at: number, len: number, g = 0.3) {
  noise(c, { ftype: 'bandpass', q: 1.5, f: 400, f1: 9000, glide: len, at, a: len * 0.95, d: 0.06, g, rev: 0.3 });
}

export { adEnv, clamp };
