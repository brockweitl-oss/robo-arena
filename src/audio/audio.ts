// Robo Arena audio engine. Every sound and every note of music is synthesized at runtime with
// the Web Audio API — no audio files. See synth.ts (primitives), inst.ts (instruments),
// sfx.ts (sound recipes), loops.ts (continuous loops/ambiences), music.ts (tracks + sequencer),
// bus.ts (mixer: reverb sends, slow-mo filter, compressor, limiter).
import type * as THREE from 'three';
import { buildBus, Bus, MUSIC_LEVEL } from './bus';
import { SFX } from './sfx';
import { buildLoop, LoopVoice } from './loops';
import { TRACKS, Sequencer } from './music';
import { clamp } from './synth';

export type SfxName =
  // UI
  | 'ui_move' | 'ui_select' | 'ui_back' | 'ui_unlock' | 'ui_error'
  // movement
  | 'footstep' | 'jump' | 'double_jump' | 'dash' | 'land' | 'land_heavy'
  // weapons
  | 'gun_blaster' | 'gun_rail' | 'gun_rail_charge' | 'gun_scatter'
  | 'bomb_throw' | 'bomb_bounce' | 'explosion_small' | 'explosion_big'
  | 'pod_launch' | 'pod_seeker_ping'
  | 'charge_windup' | 'charge_swing'
  // combat
  | 'hit_light' | 'hit_heavy' | 'shield_block' | 'knockdown' | 'getup' | 'ko'
  // match
  | 'capsule_launch' | 'capsule_bounce' | 'capsule_open'
  | 'announce_ready' | 'announce_go' | 'announce_ko' | 'announce_timeup' | 'countdown_tick'
  | 'victory' | 'defeat' | 'low_hp'
  // arena
  | 'hazard_warn' | 'hazard_zap' | 'platform_move';

export type LoopName = 'thruster' | 'pod_hum' | 'ambience_foundry' | 'ambience_garden' | 'ambience_orbital';

export type MusicTrack = 'menu' | 'garage' | 'foundry' | 'garden' | 'orbital' | 'champion' | 'victory' | 'results';

export interface PlayOpts {
  volume?: number; // 0..1+, default 1
  pitch?: number; // playback-rate multiplier, default 1 (randomize slightly yourself for variety)
  pos?: THREE.Vector3; // world position for stereo pan + distance attenuation
}

export interface LoopHandle {
  /** intensity 0..1 controls volume/brightness; pitch multiplier. */
  set(intensity: number, pitch?: number): void;
  setPos(pos: THREE.Vector3): void;
  stop(): void;
}

type V3 = { x: number; y: number; z: number };

interface Voice {
  dry: GainNode;
  wet: GainNode;
  end: number;
}

const LOOP_VOL: Record<LoopName, number> = {
  thruster: 0.55,
  pod_hum: 0.35,
  ambience_foundry: 0.55,
  ambience_garden: 0.6,
  ambience_orbital: 0.6,
};
const LOOP_SPATIAL: Record<LoopName, boolean> = {
  thruster: true, pod_hum: true, ambience_foundry: false, ambience_garden: false, ambience_orbital: false,
};

const LOOKAHEAD = 0.15;
const TICK_MS = 25;
const XFADE = 0.8;

class LoopHandleImpl implements LoopHandle {
  voice?: LoopVoice;
  level?: GainNode; // per-loop volume * distance attenuation
  pan?: StereoPannerNode;
  out?: GainNode;
  intensity = 1;
  pitch = 1;
  pos?: V3;
  stopped = false;
  constructor(public eng: AudioEngine, public name: LoopName, public vol: number) {}
  set(intensity: number, pitch?: number) {
    if (this.stopped) return;
    this.intensity = Number.isFinite(intensity) ? clamp(intensity, 0, 1) : 0;
    if (pitch !== undefined && Number.isFinite(pitch)) this.pitch = clamp(pitch, 0.1, 4);
    this.eng._applyLoop(this);
  }
  setPos(pos: THREE.Vector3) {
    if (this.stopped || !pos) return;
    this.pos = { x: pos.x, y: pos.y, z: pos.z };
    this.eng._applyLoop(this);
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.eng._stopLoop(this);
  }
}

interface MusicPlayer {
  name: MusicTrack;
  seq: Sequencer;
  gain: GainNode;
  stopAt?: number;
}

class AudioEngine {
  private ctx?: AudioContext;
  private bus?: Bus;
  private lp: V3 = { x: 0, y: 0, z: 0 };
  private right: V3 = { x: 1, y: 0, z: 0 };
  private vols = { master: 1, sfx: 1, music: 1 };
  private voices = new Map<SfxName, Voice[]>();
  private loops = new Set<LoopHandleImpl>();
  private music?: MusicPlayer;
  private fading: MusicPlayer[] = [];
  private wantMusic?: MusicTrack;
  private timer?: ReturnType<typeof setInterval>;
  private timeScale = 1;
  private failed = false;

  /** True once an AudioContext exists. */
  get ready() { return !!this.ctx; }
  /** The underlying context (for debugging/tests). */
  get context(): AudioContext | undefined { return this.ctx; }

  init() {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        if (typeof window === 'undefined') return;
        const AC: typeof AudioContext | undefined =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) { this.failed = true; return; }
        const ctx = new AC({ latencyHint: 'interactive' });
        this.ctx = ctx;
        this.bus = buildBus(ctx, ctx.destination);
        this.applyVolumes();
        this.timer = setInterval(() => this.pump(), TICK_MS);
        // start anything requested before init
        for (const h of this.loops) this.startLoop(h);
        if (this.wantMusic) {
          const w = this.wantMusic;
          this.wantMusic = undefined;
          this.playMusic(w);
        }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch (e) {
      this.failed = true;
      this.ctx = undefined;
      this.bus = undefined;
      try { console.warn('[audio] init failed', e); } catch { /* */ }
    }
  }

  setListener(pos: THREE.Vector3, right: THREE.Vector3) {
    if (!pos || !right) return;
    this.lp.x = pos.x; this.lp.y = pos.y; this.lp.z = pos.z;
    const l = Math.hypot(right.x, right.y, right.z) || 1;
    this.right.x = right.x / l; this.right.y = right.y / l; this.right.z = right.z / l;
    // keep spatial loops tracking the camera
    if (this.ctx) for (const h of this.loops) if (h.pos) this._applyLoop(h);
  }

  setVolumes(master: number, sfx: number, music: number) {
    const f = (v: number, d: number) => (Number.isFinite(v) ? clamp(v, 0, 1) : d);
    this.vols = { master: f(master, 1), sfx: f(sfx, 1), music: f(music, 1) };
    this.applyVolumes();
  }

  private applyVolumes() {
    const b = this.bus, ctx = this.ctx;
    if (!b || !ctx) return;
    const t = ctx.currentTime;
    // squared curve feels more natural for a 0..1 slider
    b.master.gain.setTargetAtTime(0.9 * this.vols.master * this.vols.master, t, 0.02);
    b.sfxVol.gain.setTargetAtTime(this.vols.sfx * this.vols.sfx, t, 0.02);
    b.musicVol.gain.setTargetAtTime(MUSIC_LEVEL * this.vols.music * this.vols.music, t, 0.02);
  }

  /** Returns [gain, pan] for a world position. */
  private spatial(pos?: V3): [number, number] {
    if (!pos) return [1, 0];
    const dx = pos.x - this.lp.x, dy = pos.y - this.lp.y, dz = pos.z - this.lp.z;
    const d = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(d)) return [1, 0];
    const side = dx * this.right.x + dy * this.right.y + dz * this.right.z;
    const pan = clamp(side / (d + 2.5), -1, 1) * 0.85;
    const att = 1 / (1 + d / 22); // 40 m ≈ 0.35, 60 m ≈ 0.27 — never silent
    return [att, pan];
  }

  play(name: SfxName, opts?: PlayOpts) {
    const ctx = this.ctx, bus = this.bus;
    if (!ctx || !bus || ctx.state !== 'running') return;
    try {
      const def = SFX[name];
      if (!def) return;
      const now = ctx.currentTime;
      let list = this.voices.get(name);
      if (!list) this.voices.set(name, (list = []));
      // prune finished voices
      while (list.length && list[0].end < now) list.shift();
      for (let i = list.length - 1; i >= 0; i--) if (list[i].end < now) list.splice(i, 1);
      // steal oldest when over the limit
      while (list.length >= def.voices) {
        const v = list.shift()!;
        for (const g of [v.dry.gain, v.wet.gain]) {
          g.cancelScheduledValues(now);
          g.setValueAtTime(g.value, now);
          g.linearRampToValueAtTime(0, now + 0.025);
        }
      }
      const vary = def.vary;
      const slow = 0.75 + 0.25 * this.timeScale;
      const pitch = clamp((opts?.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * vary) * slow, 0.1, 4);
      const [att, pan] = def.spatial === false ? [1, 0] : this.spatial(opts?.pos);
      const vol = clamp((opts?.volume ?? 1), 0, 2) * def.vol * att * (vary > 0 ? 1 - Math.random() * 0.1 : 1);
      if (!(vol > 0.0005)) return;

      const dry = ctx.createGain();
      dry.gain.value = vol;
      const wet = ctx.createGain();
      wet.gain.value = vol;
      let panner: StereoPannerNode | undefined;
      if (pan !== 0) {
        panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        dry.connect(panner);
        panner.connect(bus.sfxIn);
      } else dry.connect(bus.sfxIn);
      wet.connect(bus.sfxRevIn);
      // dry -> base reverb send
      const voiceIn = ctx.createGain();
      const revIn = ctx.createGain();
      voiceIn.connect(dry);
      revIn.connect(wet);
      if (def.rev > 0) {
        const s = ctx.createGain();
        s.gain.value = def.rev;
        voiceIn.connect(s);
        s.connect(revIn);
      }
      const dur = def.fn({ ctx, out: voiceIn, rev: revIn, t: now + 0.004, p: pitch });
      list.push({ dry, wet, end: now + dur + 0.05 });
      setTimeout(() => {
        try {
          voiceIn.disconnect(); revIn.disconnect(); dry.disconnect(); wet.disconnect(); panner?.disconnect();
        } catch { /* */ }
      }, (dur + 0.6) * 1000);
    } catch (e) {
      try { console.warn('[audio] play failed', name, e); } catch { /* */ }
    }
  }

  loop(name: LoopName, opts?: PlayOpts): LoopHandle {
    try {
      const h = new LoopHandleImpl(this, name, clamp(opts?.volume ?? 1, 0, 2));
      if (opts?.pitch !== undefined && Number.isFinite(opts.pitch)) h.pitch = opts.pitch;
      if (opts?.pos) h.pos = { x: opts.pos.x, y: opts.pos.y, z: opts.pos.z };
      this.loops.add(h);
      if (this.ctx) this.startLoop(h);
      return h;
    } catch {
      return { set() {}, setPos() {}, stop() {} };
    }
  }

  private startLoop(h: LoopHandleImpl) {
    const ctx = this.ctx, bus = this.bus;
    if (!ctx || !bus || h.voice || h.stopped) return;
    try {
      const out = ctx.createGain();
      const level = ctx.createGain();
      out.connect(level);
      // reverb only via explicit sends from loop events (clanks, chirps...)
      const evRev = ctx.createGain();
      evRev.gain.value = LOOP_VOL[h.name] * h.vol;
      evRev.connect(bus.sfxRevIn);
      if (LOOP_SPATIAL[h.name]) {
        h.pan = ctx.createStereoPanner();
        level.connect(h.pan);
        h.pan.connect(bus.sfxIn);
      } else level.connect(bus.sfxIn);
      h.out = out;
      h.level = level;
      h.voice = buildLoop(h.name, ctx, out, evRev, ctx.currentTime + 0.01);
      (h as any)._evRev = evRev;
      this._applyLoop(h, true);
    } catch (e) {
      try { console.warn('[audio] loop failed', h.name, e); } catch { /* */ }
    }
  }

  /** @internal */
  _applyLoop(h: LoopHandleImpl, immediate = false) {
    const ctx = this.ctx;
    if (!ctx || !h.voice || !h.level) return;
    try {
      const t = ctx.currentTime;
      const [att, pan] = LOOP_SPATIAL[h.name] ? this.spatial(h.pos) : [1, 0];
      const g = LOOP_VOL[h.name] * h.vol * att;
      if (immediate) h.level.gain.setValueAtTime(g, t);
      else h.level.gain.setTargetAtTime(g, t, 0.03);
      if (h.pan) h.pan.pan.setTargetAtTime(pan, t, 0.03);
      const slow = 0.75 + 0.25 * this.timeScale;
      h.voice.set(h.intensity, h.pitch * slow, t);
    } catch { /* */ }
  }

  /** @internal */
  _stopLoop(h: LoopHandleImpl) {
    this.loops.delete(h);
    const ctx = this.ctx;
    if (!ctx || !h.voice) return;
    try {
      const end = h.voice.stop(ctx.currentTime);
      const evRev: GainNode | undefined = (h as any)._evRev;
      setTimeout(() => {
        try { h.out?.disconnect(); h.level?.disconnect(); h.pan?.disconnect(); evRev?.disconnect(); } catch { /* */ }
      }, (end - ctx.currentTime + 0.5) * 1000);
    } catch { /* */ }
  }

  playMusic(track: MusicTrack) {
    const def = TRACKS[track];
    if (!def) return;
    const ctx = this.ctx, bus = this.bus;
    if (!ctx || !bus) {
      this.wantMusic = track;
      return;
    }
    if (this.music && this.music.name === track && this.music.stopAt === undefined) return;
    try {
      const now = ctx.currentTime;
      this.fadeOutCurrent(XFADE);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + XFADE);
      gain.connect(bus.musicIn);
      // instruments' reverb sends (faded together with the dry signal)
      const send = ctx.createGain();
      send.gain.setValueAtTime(0, now);
      send.gain.linearRampToValueAtTime(1, now + XFADE);
      send.connect(bus.musicRevIn);
      const seq = new Sequencer(ctx, gain, send, def, now + 0.06);
      (gain as any)._send = send;
      this.music = { name: track, seq, gain };
      seq.pump(now + LOOKAHEAD);
    } catch (e) {
      try { console.warn('[audio] playMusic failed', e); } catch { /* */ }
    }
  }

  private fadeOutCurrent(fade: number) {
    const ctx = this.ctx;
    const m = this.music;
    this.music = undefined;
    if (!ctx || !m) return;
    const now = ctx.currentTime;
    const f = Math.max(0.03, fade);
    for (const g of [m.gain.gain, ((m.gain as any)._send as GainNode | undefined)?.gain]) {
      if (!g) continue;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + f);
    }
    m.stopAt = now + f;
    this.fading.push(m);
  }

  stopMusic(fade = 1) {
    this.wantMusic = undefined;
    try { this.fadeOutCurrent(Number.isFinite(fade) ? fade : 1); } catch { /* */ }
  }

  /** Duck music briefly (e.g. on KO). */
  duck(amount: number, seconds: number) {
    const ctx = this.ctx, bus = this.bus;
    if (!ctx || !bus) return;
    try {
      const a = clamp(Number.isFinite(amount) ? amount : 0.5, 0, 1);
      const s = Math.max(0, Number.isFinite(seconds) ? seconds : 1);
      const g = bus.duck.gain;
      const now = ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.setTargetAtTime(Math.max(0.02, 1 - a), now, 0.04);
      g.setTargetAtTime(1, now + s, 0.35);
    } catch { /* */ }
  }

  /** Slow-motion feel: lowpass music/sfx. 1 = normal. */
  setTimeScale(s: number) {
    const v = clamp(Number.isFinite(s) ? s : 1, 0.05, 1);
    if (Math.abs(v - this.timeScale) < 0.001) return;
    this.timeScale = v;
    const ctx = this.ctx, bus = this.bus;
    if (!ctx || !bus) return;
    try {
      const t = ctx.currentTime;
      const f = v >= 0.99 ? 20000 : 500 + 7000 * Math.pow(v, 1.6);
      bus.slowLp.frequency.setTargetAtTime(f, t, v >= 0.99 ? 0.12 : 0.06);
      bus.slowLp.Q.setTargetAtTime(v >= 0.99 ? 0.7 : 2.5, t, 0.08);
      for (const h of this.loops) this._applyLoop(h);
    } catch { /* */ }
  }

  private pump() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    try {
      const now = ctx.currentTime;
      const until = now + LOOKAHEAD;
      this.music?.seq.pump(until, now);
      for (let i = this.fading.length - 1; i >= 0; i--) {
        const m = this.fading[i];
        if (m.stopAt !== undefined && now > m.stopAt + 2.5) {
          try { m.gain.disconnect(); ((m.gain as any)._send as GainNode | undefined)?.disconnect(); } catch { /* */ }
          this.fading.splice(i, 1);
        } else if (m.stopAt !== undefined && now < m.stopAt) {
          m.seq.pump(Math.min(until, m.stopAt), now);
        }
      }
      for (const h of this.loops) h.voice?.tick?.(now, now + 0.25);
    } catch (e) {
      try { console.warn('[audio] pump failed', e); } catch { /* */ }
    }
  }
}

export const audio = new AudioEngine();
