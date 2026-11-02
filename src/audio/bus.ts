// Mixer graph shared by the realtime engine and offline tests.
//
//  sfx voices ──► sfxIn ──────────────► sfxVol ─┐
//  sfx sends  ──► sfxRevIn ─► reverb ─► sfxIn   │
//  music      ──► musicIn ────────────► musicVol ─► duck ─┤
//  music sends──► musicRevIn ─► reverb ─► musicIn         │
//                                                         ▼
//                         sum ─► slow-mo lowpass ─► compressor ─► soft limiter ─► master ─► out
import { impulseResponse, limiterCurve } from './synth';

export const MUSIC_LEVEL = 0.32; // ≈ -10 dB under SFX

export interface Bus {
  sfxIn: GainNode;
  sfxRevIn: GainNode;
  sfxVol: GainNode;
  musicIn: GainNode;
  musicRevIn: GainNode;
  musicVol: GainNode;
  duck: GainNode;
  slowLp: BiquadFilterNode;
  comp: DynamicsCompressorNode;
  master: GainNode;
}

export function buildBus(ctx: BaseAudioContext, out: AudioNode): Bus {
  const g = (v = 1) => {
    const n = ctx.createGain();
    n.gain.value = v;
    return n;
  };
  const ir = impulseResponse(ctx);
  const sfxIn = g(), sfxRevIn = g(), sfxVol = g();
  const musicIn = g(), musicRevIn = g(), musicVol = g(MUSIC_LEVEL), duck = g();
  const sum = g();
  const conv1 = ctx.createConvolver();
  conv1.buffer = ir;
  const ret1 = g(0.55);
  sfxRevIn.connect(conv1); conv1.connect(ret1); ret1.connect(sfxIn);
  const conv2 = ctx.createConvolver();
  conv2.buffer = ir;
  const ret2 = g(0.5);
  musicRevIn.connect(conv2); conv2.connect(ret2); ret2.connect(musicIn);

  sfxIn.connect(sfxVol); sfxVol.connect(sum);
  musicIn.connect(musicVol); musicVol.connect(duck); duck.connect(sum);

  const slowLp = ctx.createBiquadFilter();
  slowLp.type = 'lowpass';
  slowLp.frequency.value = 20000;
  slowLp.Q.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -8;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.18;
  const makeup = g(1.0);
  const lim = ctx.createWaveShaper();
  lim.curve = limiterCurve();
  lim.oversample = '4x';
  const pre = g(1 / 1.5); // limiter curve spans ±1.5 of real signal: curve(x/1.5) = y(x) <= 0.97
  const master = g(0.9);
  sum.connect(slowLp); slowLp.connect(comp); comp.connect(makeup);
  makeup.connect(pre); pre.connect(lim); lim.connect(master);
  master.connect(out);
  return { sfxIn, sfxRevIn, sfxVol, musicIn, musicRevIn, musicVol, duck, slowLp, comp, master };
}
