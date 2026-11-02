// Continuous loops: thruster, pod hum, per-arena ambiences. Works on any BaseAudioContext.
// Random one-shot events (clanks, crickets...) are scheduled via tick(from, to) so the realtime
// engine can pump them from a timer and offline tests can pre-schedule a whole render.
import { SynthCtx, noiseBuffer, NoiseKind, tone, noise, fm, clamp } from './synth';
import { metal } from './inst';
import type { LoopName } from './audio';

export interface LoopVoice {
  /** intensity 0..1, pitch multiplier, at time t */
  set(i: number, p: number, t: number): void;
  /** fade out starting at t; returns the time when everything is stopped */
  stop(t: number): number;
  tick?(from: number, to: number): void;
}

interface Builder {
  ctx: BaseAudioContext;
  out: GainNode; // loop master gain (we own it)
  rev?: AudioNode;
  srcs: AudioScheduledSourceNode[];
}

function mkNoise(b: Builder, kind: NoiseKind, t: number) {
  const s = b.ctx.createBufferSource();
  s.buffer = noiseBuffer(b.ctx, kind);
  s.loop = true;
  s.start(t, Math.random() * 1.5);
  b.srcs.push(s);
  return s;
}
function mkOsc(b: Builder, type: OscillatorType, f: number, t: number) {
  const o = b.ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.start(t);
  b.srcs.push(o);
  return o;
}
function mkFilter(b: Builder, type: BiquadFilterType, f: number, q = 0.7) {
  const bq = b.ctx.createBiquadFilter();
  bq.type = type;
  bq.frequency.value = f;
  bq.Q.value = q;
  return bq;
}
function mkGain(b: Builder, g: number) {
  const n = b.ctx.createGain();
  n.gain.value = g;
  return n;
}
/** LFO connected to a param: param += sin * depth. */
function lfo(b: Builder, rate: number, depth: number, param: AudioParam, t: number, type: OscillatorType = 'sine') {
  const o = mkOsc(b, type, rate, t);
  const g = mkGain(b, depth);
  o.connect(g);
  g.connect(param);
}

function finish(b: Builder, t: number, level: number, extra: Partial<LoopVoice> & Pick<LoopVoice, 'set'>): LoopVoice {
  // fade in from silence
  b.out.gain.setValueAtTime(0, t);
  b.out.gain.linearRampToValueAtTime(level, t + 0.08);
  let stopped = false;
  return {
    set: extra.set,
    tick: extra.tick,
    stop(t2: number) {
      if (stopped) return t2;
      stopped = true;
      const g = b.out.gain;
      g.cancelScheduledValues(t2);
      g.setValueAtTime(g.value, t2);
      g.setTargetAtTime(0, t2, 0.022); // ~80 ms to -30 dB
      g.setValueAtTime(0, t2 + 0.2);
      for (const s of b.srcs) {
        try { s.stop(t2 + 0.22); } catch { /* already stopped */ }
      }
      return t2 + 0.25;
    },
  };
}

// --------------------------------------------------------------------------------------------
function thruster(b: Builder, t: number): LoopVoice {
  const { ctx } = b;
  const hiss = mkNoise(b, 'white', t);
  const bp = mkFilter(b, 'bandpass', 1500, 0.8);
  const gHiss = mkGain(b, 0.0);
  hiss.connect(bp); bp.connect(gHiss); gHiss.connect(b.out);

  const rum = mkNoise(b, 'brown', t);
  const lp = mkFilter(b, 'lowpass', 300, 1);
  const gRum = mkGain(b, 0.0);
  rum.connect(lp); lp.connect(gRum); gRum.connect(b.out);

  const saw = mkOsc(b, 'sawtooth', 70, t);
  const slp = mkFilter(b, 'lowpass', 420, 2);
  const gSaw = mkGain(b, 0.0);
  saw.connect(slp); slp.connect(gSaw); gSaw.connect(b.out);
  // flutter
  const flut = mkGain(b, 1);
  gSaw.disconnect(); gSaw.connect(flut); flut.connect(b.out);
  lfo(b, 13, 0.35, flut.gain, t, 'triangle');

  const set = (i: number, p: number, tt: number) => {
    i = clamp(i, 0, 1);
    const tc = 0.04;
    bp.frequency.setTargetAtTime(clamp((700 + 2600 * i) * p, 100, 12000), tt, tc);
    lp.frequency.setTargetAtTime(clamp((180 + 500 * i) * p, 40, 4000), tt, tc);
    saw.frequency.setTargetAtTime(clamp((55 + 45 * i) * p, 20, 2000), tt, tc);
    gHiss.gain.setTargetAtTime(0.06 + 0.32 * i, tt, tc);
    gRum.gain.setTargetAtTime(0.25 + 0.45 * i, tt, tc);
    gSaw.gain.setTargetAtTime(0.03 + 0.07 * i, tt, tc);
  };
  set(0.5, 1, t);
  void ctx;
  return finish(b, t, 1, { set });
}

function podHum(b: Builder, t: number): LoopVoice {
  const lp = mkFilter(b, 'lowpass', 1800, 1);
  const trem = mkGain(b, 0.75);
  lp.connect(trem); trem.connect(b.out);
  lfo(b, 7, 0.25, trem.gain, t);
  const o1 = mkOsc(b, 'sine', 220, t);
  const o2 = mkOsc(b, 'sine', 221.7, t);
  const o3 = mkOsc(b, 'triangle', 440, t);
  const g1 = mkGain(b, 0.18), g2 = mkGain(b, 0.18), g3 = mkGain(b, 0.06);
  o1.connect(g1); o2.connect(g2); o3.connect(g3);
  g1.connect(lp); g2.connect(lp); g3.connect(lp);
  const set = (i: number, p: number, tt: number) => {
    o1.frequency.setTargetAtTime(220 * p, tt, 0.05);
    o2.frequency.setTargetAtTime(221.7 * p, tt, 0.05);
    o3.frequency.setTargetAtTime(440 * p, tt, 0.05);
    lp.frequency.setTargetAtTime(800 + 2000 * clamp(i, 0, 1), tt, 0.05);
  };
  return finish(b, t, 0.8, { set });
}

function ambFoundry(b: Builder, t: number): LoopVoice {
  const rum = mkNoise(b, 'brown', t);
  const lp = mkFilter(b, 'lowpass', 140, 0.8);
  const g = mkGain(b, 0.55);
  rum.connect(lp); lp.connect(g); g.connect(b.out);
  lfo(b, 0.09, 0.15, g.gain, t);
  const hum = mkOsc(b, 'sine', 50, t);
  const hg = mkGain(b, 0.07);
  hum.connect(hg); hg.connect(b.out);
  const hum2 = mkOsc(b, 'triangle', 100, t);
  const hg2 = mkGain(b, 0.025);
  hum2.connect(hg2); hg2.connect(b.out);
  const air = mkNoise(b, 'pink', t);
  const abp = mkFilter(b, 'bandpass', 420, 0.8);
  const ag = mkGain(b, 0.05);
  air.connect(abp); abp.connect(ag); ag.connect(b.out);

  let next = t + 0.8;
  const tick = (from: number, to: number) => {
    const cu = (x: number) => (x < from - 0.25 ? from + Math.random() * 0.3 : x);
    next = cu(next);
    while (next < to) {
      const c: SynthCtx = { ctx: b.ctx, out: b.out, rev: b.rev, t: next, p: 1 };
      const roll = Math.random();
      if (roll < 0.6) {
        // distant clank (mostly reverb)
        const dry = b.ctx.createGain();
        dry.gain.value = 0.25;
        dry.connect(b.out);
        metal({ ...c, out: dry }, 0.5 + Math.random() * 0.5, 200 + Math.random() * 500);
        if (Math.random() < 0.5) metal({ ...c, out: dry, t: next + 0.18 + Math.random() * 0.2 }, 0.4, 250 + Math.random() * 400);
      } else if (roll < 0.85) {
        noise(c, { ftype: 'highpass', f: 2500, a: 0.1, h: 0.4, d: 0.6, g: 0.05, rev: 0.5 }); // steam
      } else {
        tone(c, { f: 70, f1: 40, d: 0.5, g: 0.12, rev: 0.5 }); // heavy press thud
      }
      next += 1.2 + Math.random() * 2.8;
    }
  };
  return finish(b, t, 1, { set: (i, _p, tt) => b.out.gain.setTargetAtTime(clamp(i, 0, 1.5), tt, 0.2), tick });
}

function ambGarden(b: Builder, t: number): LoopVoice {
  const wind = mkNoise(b, 'pink', t);
  const bp = mkFilter(b, 'bandpass', 600, 0.6);
  const wg = mkGain(b, 0.2);
  wind.connect(bp); bp.connect(wg); wg.connect(b.out);
  lfo(b, 0.07, 280, bp.frequency, t);
  lfo(b, 0.11, 0.1, wg.gain, t);
  const leaves = mkNoise(b, 'white', t);
  const hp = mkFilter(b, 'highpass', 5000, 0.7);
  const lg = mkGain(b, 0.012);
  leaves.connect(hp); hp.connect(lg); lg.connect(b.out);
  lfo(b, 0.17, 0.01, lg.gain, t);

  let nextCricket = t + 0.3;
  let nextDrop = t + 0.1;
  const tick = (from: number, to: number) => {
    const cu = (x: number) => (x < from - 0.25 ? from + Math.random() * 0.3 : x);
    nextCricket = cu(nextCricket); nextDrop = cu(nextDrop);
    while (nextCricket < to) {
      const c: SynthCtx = { ctx: b.ctx, out: b.out, rev: b.rev, t: nextCricket, p: 1 };
      const f = 4300 + Math.random() * 900;
      const n = 3 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) tone(c, { f, at: k * 0.045, a: 0.004, d: 0.025, g: 0.025, rev: 0.3 });
      nextCricket += 0.5 + Math.random() * 1.8;
    }
    while (nextDrop < to) {
      const c: SynthCtx = { ctx: b.ctx, out: b.out, rev: b.rev, t: nextDrop, p: 1 };
      const f = 700 + Math.random() * 1300;
      tone(c, { f, f1: f * 1.8, glide: 0.04, a: 0.003, d: 0.045, g: 0.03, rev: 0.2 }); // bubble
      nextDrop += 0.06 + Math.random() * 0.25;
    }
  };
  return finish(b, t, 1, { set: (i, _p, tt) => b.out.gain.setTargetAtTime(clamp(i, 0, 1.5), tt, 0.2), tick });
}

function ambOrbital(b: Builder, t: number): LoopVoice {
  const h1 = mkOsc(b, 'sine', 40, t);
  const g1 = mkGain(b, 0.2);
  h1.connect(g1); g1.connect(b.out);
  const h2 = mkOsc(b, 'sine', 60.3, t);
  const g2 = mkGain(b, 0.06);
  h2.connect(g2); g2.connect(b.out);
  const saw = mkOsc(b, 'sawtooth', 80, t);
  const lp = mkFilter(b, 'lowpass', 220, 3);
  const sg = mkGain(b, 0.05);
  saw.connect(lp); lp.connect(sg); sg.connect(b.out);
  lfo(b, 0.05, 120, lp.frequency, t);
  // electrical buzz
  const bz = mkOsc(b, 'sawtooth', 120, t);
  const bbp = mkFilter(b, 'bandpass', 2400, 4);
  const bg = mkGain(b, 0.012);
  bz.connect(bbp); bbp.connect(bg); bg.connect(b.out);
  // airy space noise
  const air = mkNoise(b, 'pink', t);
  const ahp = mkFilter(b, 'bandpass', 1800, 0.5);
  const ag = mkGain(b, 0.015);
  air.connect(ahp); ahp.connect(ag); ag.connect(b.out);
  lfo(b, 0.06, 0.01, ag.gain, t);

  let nextFlicker = t + 0.5;
  let nextBleep = t + 2;
  const tick = (from: number, to: number) => {
    const cu = (x: number) => (x < from - 0.25 ? from + Math.random() * 0.3 : x);
    nextFlicker = cu(nextFlicker); nextBleep = cu(nextBleep);
    while (nextFlicker < to) {
      const tt = nextFlicker;
      bg.gain.setValueAtTime(0.012, tt);
      bg.gain.linearRampToValueAtTime(0.03 + Math.random() * 0.02, tt + 0.01);
      bg.gain.linearRampToValueAtTime(0.012, tt + 0.05 + Math.random() * 0.1);
      nextFlicker += 0.3 + Math.random() * 1.8;
    }
    while (nextBleep < to) {
      const c: SynthCtx = { ctx: b.ctx, out: b.out, rev: b.rev, t: nextBleep, p: 1 };
      const f = [1568, 1760, 2093, 2349][Math.floor(Math.random() * 4)];
      tone(c, { f, d: 0.15, g: 0.025, rev: 0.6 });
      if (Math.random() < 0.5) tone(c, { f: f * 1.5, at: 0.12, d: 0.15, g: 0.02, rev: 0.6 });
      if (Math.random() < 0.3) fm(c, { f: 300, ratio: 3.3, idx: 4, at: 0.3, d: 0.4, g: 0.02, rev: 0.6 });
      nextBleep += 3 + Math.random() * 4;
    }
  };
  return finish(b, t, 1, { set: (i, _p, tt) => b.out.gain.setTargetAtTime(clamp(i, 0, 1.5), tt, 0.2), tick });
}

export function buildLoop(name: LoopName, ctx: BaseAudioContext, out: GainNode, rev: AudioNode | undefined, t: number): LoopVoice {
  const b: Builder = { ctx, out, rev, srcs: [] };
  switch (name) {
    case 'thruster': return thruster(b, t);
    case 'pod_hum': return podHum(b, t);
    case 'ambience_foundry': return ambFoundry(b, t);
    case 'ambience_garden': return ambGarden(b, t);
    case 'ambience_orbital': return ambOrbital(b, t);
  }
}
