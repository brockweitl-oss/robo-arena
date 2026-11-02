// Low-level Web Audio synthesis helpers. Everything here works on any BaseAudioContext
// (realtime AudioContext or OfflineAudioContext) so sounds can be rendered offline for tests.

export type NoiseKind = 'white' | 'pink' | 'brown';

const noiseCache = new WeakMap<BaseAudioContext, Partial<Record<NoiseKind, AudioBuffer>>>();
const curveCache = new Map<string, Float32Array<ArrayBuffer>>();
const irCache = new WeakMap<BaseAudioContext, AudioBuffer>();

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Seeded PRNG (mulberry32) for deterministic procedural content. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2-second noise buffer, generated once per context and kind. */
export function noiseBuffer(ctx: BaseAudioContext, kind: NoiseKind): AudioBuffer {
  let m = noiseCache.get(ctx);
  if (!m) noiseCache.set(ctx, (m = {}));
  const cached = m[kind];
  if (cached) return cached;
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = rng(kind === 'white' ? 1 : kind === 'pink' ? 2 : 3);
  if (kind === 'white') {
    for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
  } else if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = r() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  // normalise and crossfade the loop seam
  let pk = 0;
  for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i]));
  const k = pk > 0 ? 0.95 / pk : 1;
  for (let i = 0; i < len; i++) d[i] *= k;
  const fade = 256;
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    d[i] = d[i] * a + d[len - fade + i] * (1 - a);
  }
  m[kind] = buf;
  return buf;
}

/** Waveshaper curve: soft (tanh) drive. */
export function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const key = 'd' + amount.toFixed(2);
  const c = curveCache.get(key);
  if (c) return c;
  const n = 1024;
  const curve = new Float32Array(n);
  const norm = Math.tanh(amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / norm;
  }
  curveCache.set(key, curve);
  return curve;
}

/** Hard-ish limiter curve used at the very end of the master chain. */
export function limiterCurve(): Float32Array<ArrayBuffer> {
  const key = 'lim';
  const c = curveCache.get(key);
  if (c) return c;
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 1.5;
    const ax = Math.abs(x);
    // linear up to 0.7, then soft knee towards 0.97
    const y = ax < 0.7 ? ax : 0.7 + 0.27 * Math.tanh((ax - 0.7) / 0.27);
    curve[i] = Math.sign(x) * y;
  }
  curveCache.set(key, curve);
  return curve;
}

/** Procedural stereo impulse response: short room/hall with diffuse exponential tail. */
export function impulseResponse(ctx: BaseAudioContext, seconds = 1.6, decay = 3.2): AudioBuffer {
  const c = irCache.get(ctx);
  if (c) return c;
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const r = rng(77 + ch * 13);
    let lp = 0;
    const pre = Math.floor(ctx.sampleRate * 0.012);
    for (let i = 0; i < len; i++) {
      if (i < pre) { d[i] = 0; continue; }
      const t = (i - pre) / (len - pre);
      const w = r() * 2 - 1;
      // darker as it decays
      const a = 0.25 + 0.6 * (1 - t);
      lp += (w - lp) * a;
      // a few early reflections
      const er = (i - pre) < ctx.sampleRate * 0.05 && r() < 0.004 ? (r() * 2 - 1) * 3 : 0;
      d[i] = (lp + er) * Math.pow(1 - t, decay) * 0.5;
    }
  }
  irCache.set(ctx, buf);
  return buf;
}

// ---------------------------------------------------------------------------------------------
// Voice helpers. `t` is absolute AudioContext time.

export interface SynthCtx {
  ctx: BaseAudioContext;
  out: AudioNode; // dry destination for this voice
  rev?: AudioNode; // optional reverb send (already gain-staged)
  t: number; // start time
  p: number; // pitch multiplier
}

const EPS = 0.0001;

/** Attack-decay envelope on a gain param. Starts and ends near zero (click-free). */
export function adEnv(param: AudioParam, t: number, a: number, peak: number, d: number) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + Math.max(0.001, a));
  param.exponentialRampToValueAtTime(EPS, t + Math.max(0.001, a) + Math.max(0.005, d));
  param.linearRampToValueAtTime(0, t + a + d + 0.01);
}

/** Attack-hold-release envelope. */
export function ahrEnv(param: AudioParam, t: number, a: number, peak: number, h: number, r: number) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + Math.max(0.001, a));
  param.setValueAtTime(peak, t + a + h);
  param.exponentialRampToValueAtTime(EPS, t + a + h + Math.max(0.005, r));
  param.linearRampToValueAtTime(0, t + a + h + r + 0.01);
}

export interface ToneOpts {
  type?: OscillatorType;
  f: number; // start freq (pre pitch mult)
  f1?: number; // end freq
  glide?: number; // seconds for pitch env (default = a + d)
  at?: number; // offset from c.t
  a?: number;
  d: number;
  h?: number; // hold
  g: number;
  detune?: number;
  dest?: AudioNode;
  rev?: number; // reverb send amount
  vib?: [number, number]; // [rate Hz, depth cents]
}

export function tone(c: SynthCtx, o: ToneOpts): OscillatorNode {
  const { ctx } = c;
  const t = c.t + (o.at ?? 0);
  const a = o.a ?? 0.002;
  const h = o.h ?? 0;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  const f0 = Math.max(1, o.f * c.p);
  osc.frequency.setValueAtTime(f0, t);
  if (o.f1 !== undefined) {
    const g = o.glide ?? a + h + o.d;
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1 * c.p), t + g);
  }
  if (o.detune) osc.detune.value = o.detune;
  const gn = ctx.createGain();
  if (h > 0) ahrEnv(gn.gain, t, a, o.g, h, o.d);
  else adEnv(gn.gain, t, a, o.g, o.d);
  osc.connect(gn);
  gn.connect(o.dest ?? c.out);
  if (o.rev && c.rev) {
    const s = ctx.createGain();
    s.gain.value = o.rev;
    gn.connect(s);
    s.connect(c.rev);
  }
  let vib: OscillatorNode | undefined;
  if (o.vib) {
    vib = ctx.createOscillator();
    vib.frequency.value = o.vib[0];
    const vg = ctx.createGain();
    vg.gain.value = o.vib[1];
    vib.connect(vg);
    vg.connect(osc.detune);
    vib.start(t);
    vib.stop(t + a + h + o.d + 0.05);
  }
  osc.start(t);
  osc.stop(t + a + h + o.d + 0.05);
  return osc;
}

export interface NoiseOpts {
  kind?: NoiseKind;
  ftype?: BiquadFilterType;
  f?: number; // filter freq
  f1?: number; // end filter freq
  glide?: number;
  q?: number;
  at?: number;
  a?: number;
  h?: number;
  d: number;
  g: number;
  dest?: AudioNode;
  rev?: number;
  rate?: number;
}

export function noise(c: SynthCtx, o: NoiseOpts): AudioBufferSourceNode {
  const { ctx } = c;
  const t = c.t + (o.at ?? 0);
  const a = o.a ?? 0.002;
  const h = o.h ?? 0;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, o.kind ?? 'white');
  src.loop = true;
  src.playbackRate.value = o.rate ?? 1;
  let node: AudioNode = src;
  if (o.ftype) {
    const bq = ctx.createBiquadFilter();
    bq.type = o.ftype;
    const f0 = clamp((o.f ?? 1000) * c.p, 20, 20000);
    bq.frequency.setValueAtTime(f0, t);
    if (o.f1 !== undefined) {
      bq.frequency.exponentialRampToValueAtTime(clamp(o.f1 * c.p, 20, 20000), t + (o.glide ?? a + h + o.d));
    }
    bq.Q.value = o.q ?? 0.7;
    src.connect(bq);
    node = bq;
  }
  const gn = ctx.createGain();
  if (h > 0) ahrEnv(gn.gain, t, a, o.g, h, o.d);
  else adEnv(gn.gain, t, a, o.g, o.d);
  node.connect(gn);
  gn.connect(o.dest ?? c.out);
  if (o.rev && c.rev) {
    const s = ctx.createGain();
    s.gain.value = o.rev;
    gn.connect(s);
    s.connect(c.rev);
  }
  // random offset into the buffer so repeats differ
  src.start(t, Math.random() * 1.5);
  src.stop(t + a + h + o.d + 0.05);
  return src;
}

export interface FMOpts {
  f: number;
  f1?: number;
  glide?: number;
  ratio: number;
  idx: number; // modulation index start (in multiples of carrier freq)
  idx1?: number;
  type?: OscillatorType;
  at?: number;
  a?: number;
  h?: number;
  d: number;
  g: number;
  dest?: AudioNode;
  rev?: number;
}

/** Two-operator FM voice. */
export function fm(c: SynthCtx, o: FMOpts) {
  const { ctx } = c;
  const t = c.t + (o.at ?? 0);
  const a = o.a ?? 0.002;
  const h = o.h ?? 0;
  const end = t + a + h + o.d;
  const car = ctx.createOscillator();
  car.type = o.type ?? 'sine';
  const mod = ctx.createOscillator();
  const f0 = Math.max(1, o.f * c.p);
  const f1 = o.f1 !== undefined ? Math.max(1, o.f1 * c.p) : f0;
  const g = o.glide ?? a + h + o.d;
  car.frequency.setValueAtTime(f0, t);
  mod.frequency.setValueAtTime(f0 * o.ratio, t);
  if (o.f1 !== undefined) {
    car.frequency.exponentialRampToValueAtTime(f1, t + g);
    mod.frequency.exponentialRampToValueAtTime(f1 * o.ratio, t + g);
  }
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(o.idx * f0, t);
  mg.gain.exponentialRampToValueAtTime(Math.max(0.01, (o.idx1 ?? o.idx * 0.1) * f1), end);
  mod.connect(mg);
  mg.connect(car.frequency);
  const gn = ctx.createGain();
  if (h > 0) ahrEnv(gn.gain, t, a, o.g, h, o.d);
  else adEnv(gn.gain, t, a, o.g, o.d);
  car.connect(gn);
  gn.connect(o.dest ?? c.out);
  if (o.rev && c.rev) {
    const s = ctx.createGain();
    s.gain.value = o.rev;
    gn.connect(s);
    s.connect(c.rev);
  }
  car.start(t);
  mod.start(t);
  car.stop(end + 0.05);
  mod.stop(end + 0.05);
}

/** Creates a waveshaper -> c.out and returns a SynthCtx whose out goes through it. */
export function withDrive(c: SynthCtx, amount: number, post = 1): SynthCtx {
  const ws = c.ctx.createWaveShaper();
  ws.curve = driveCurve(amount);
  ws.oversample = '2x';
  const g = c.ctx.createGain();
  g.gain.value = post;
  ws.connect(g);
  g.connect(c.out);
  return { ...c, out: ws };
}

/** Returns a SynthCtx whose out goes through a filter (optionally swept). */
export function withFilter(
  c: SynthCtx,
  type: BiquadFilterType,
  f: number,
  q = 0.7,
  f1?: number,
  glide = 0.2,
  at = 0,
): SynthCtx {
  const bq = c.ctx.createBiquadFilter();
  bq.type = type;
  bq.frequency.setValueAtTime(clamp(f * c.p, 20, 20000), c.t + at);
  if (f1 !== undefined) bq.frequency.exponentialRampToValueAtTime(clamp(f1 * c.p, 20, 20000), c.t + at + glide);
  bq.Q.value = q;
  bq.connect(c.out);
  return { ...c, out: bq };
}

/** Offset a SynthCtx in time / pitch. */
export function shift(c: SynthCtx, dt: number, pm = 1): SynthCtx {
  return { ...c, t: c.t + dt, p: c.p * pm };
}
