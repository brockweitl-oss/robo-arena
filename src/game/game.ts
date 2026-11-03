import * as THREE from 'three';
import { GameRenderer } from '../render/renderer';
import { Input } from '../core/input';
import { loadSave, writeSave, type SaveData, type Settings } from '../core/save';
import { audio, type MusicTrack, type SfxName } from '../audio/audio';
import { HUD } from '../ui/hud';
import { Match } from './match';
import { Showroom } from './showroom';
import type { MatchConfig, MatchResult } from './types';
import type { MenuHost, MenuLayer } from '../ui/host';
import type { Loadout } from '../data/parts';
import type { Paint } from '../data/characters';
import { track } from '../core/telemetry';

/**
 * Top-level game shell: owns the renderer, input, audio, HUD and the current
 * mode (menu backdrop or match). Implements MenuHost for the menu layer.
 */
export class Game implements MenuHost {
  readonly gr: GameRenderer;
  readonly input: Input;
  readonly hud: HUD;
  readonly save: SaveData;
  menus: MenuLayer | null = null;
  private showroom: Showroom;
  private match: Match | null = null;
  private timer = new THREE.Timer();
  private uiRoot: HTMLElement;
  private backdropSuspended = false;
  /** Debug/testing hook. */
  fps = 0;

  constructor(container: HTMLElement) {
    this.save = loadSave();
    this.gr = new GameRenderer(container);
    this.input = new Input(this.gr.renderer.domElement);
    this.input.onFirstGesture = () => audio.init();
    this.uiRoot = document.createElement('div');
    this.uiRoot.id = 'ui-root';
    Object.assign(this.uiRoot.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.appendChild(this.uiRoot);
    this.hud = new HUD(this.uiRoot);
    this.showroom = new Showroom(this.gr.renderer);
    this.gr.setScene(this.showroom.scene);
    this.applySettings(this.save.settings);
    this.timer.connect(document);
    (window as any).__game = this;
    track('session_start', { ladder: this.save.ladder, beaten: this.save.beaten, totals: this.save.totals, settings: this.save.settings, screen: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio, ua: navigator.userAgent });
  }

  /** Separate element for menus so they layer above the HUD. */
  get menuRoot() {
    return this.uiRoot;
  }

  start() {
    let frames = 0;
    setInterval(() => {
      this.fps = frames;
      (window as any).__fps = frames;
      frames = 0;
    }, 1000);
    // hidden tab: rAF stops, but an online match must keep exchanging inputs (see Match.backgroundTick)
    let pumpAt = performance.now();
    setInterval(() => {
      const now = performance.now();
      const dt = (now - pumpAt) / 1000;
      pumpAt = now;
      if (document.hidden && this.match) this.match.backgroundTick(dt);
    }, 50);
    const loop = () => {
      this.timer.update();
      frames++;
      this.frame(Math.min(this.timer.getDelta(), 0.1));
      requestAnimationFrame(loop);
    };
    loop();
  }

  private frame(dt: number) {
    if (this.backdropSuspended) return;
    if (this.match) {
      this.match.frame(dt);
      return;
    }
    const c = this.gr.camera;
    this.showroom.update(dt, c, window.innerWidth, window.innerHeight);
    this.gr.render(dt);
  }

  /* ------------------------------------------------------------ MenuHost */

  persist() {
    const snap = JSON.stringify({ l: this.save.loadout, s: this.save.settings, d: this.save.ladder, u: this.save.unlocked.length });
    if (snap !== this.lastSnap) {
      this.lastSnap = snap;
      track('save', { loadout: this.save.loadout, settings: this.save.settings, ladder: this.save.ladder, unlocked: this.save.unlocked, totals: this.save.totals });
    }
    writeSave(this.save);
  }

  applySettings(s: Settings) {
    audio.setVolumes(s.master, s.sfx, s.music);
    if (this.gr.quality !== s.quality) this.gr.setQuality(s.quality);
    if (this.match) this.match.cam.shakeEnabled = s.cameraShake;
    this.hud.damageNumbers = s.damageNumbers;
    this.input.setBindings(s.bindings);
  }

  async startMatch(cfg: MatchConfig): Promise<MatchResult> {
    for (;;) {
      this.gr.camera.clearViewOffset();
      const m = new Match(
        {
          gr: this.gr,
          input: this.input,
          hud: this.hud,
          settings: this.save.settings,
          playerPaint: this.save.paint,
          pause: () => (this.menus ? this.menus.showPause() : Promise.resolve('resume' as const)),
        },
        cfg,
      );
      this.match = m;
      const res = await m.done;
      m.dispose();
      this.menus?.hidePause();
      this.match = null;
      this.gr.setScene(this.showroom.scene);
      this.gr.camera.fov = 40;
      this.gr.camera.updateProjectionMatrix();
      if (res.restart) continue;
      return res;
    }
  }

  private lastScreen = '';
  private lastSnap = '';

  setBackdrop(kind: 'title' | 'garage' | 'versus' | 'none', opts: { loadout?: Loadout; paint?: Paint; rivalId?: string; previewRect?: { x: number; y: number; w: number; h: number } } = {}) {
    const key = kind + (opts.rivalId ?? '');
    if (key !== this.lastScreen) {
      this.lastScreen = key;
      track('screen', { kind, rival: opts.rivalId, loadout: kind === 'garage' ? opts.loadout : undefined });
    }
    this.showroom.set(kind, { loadout: opts.loadout ?? this.save.loadout, paint: { ...this.save.paint }, ...opts });
  }

  rotatePreview(d: number) {
    this.showroom.rotate(d);
  }

  focusPreview(slot: string | null) {
    this.showroom.setFocus(slot);
  }

  suspendBackdrop(suspended: boolean) {
    this.backdropSuspended = suspended;
  }

  sfx(name: SfxName) {
    audio.init();
    audio.play(name);
  }

  music(track: MusicTrack) {
    audio.playMusic(track);
  }
}
