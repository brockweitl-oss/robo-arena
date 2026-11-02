import type { FighterInput } from '../game/fighter';

/**
 * Keyboard + mouse + gamepad. Button presses are latched until the next
 * simulation tick consumes them, so quick taps between ticks are never lost.
 */
type Action = 'jump' | 'dash' | 'gun' | 'bomb' | 'pod' | 'charge' | 'lock' | 'pause';

const KEYMAP: Record<string, Action> = {
  Space: 'jump',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  KeyE: 'pod',
  KeyQ: 'charge',
  Tab: 'lock',
  KeyF: 'lock',
  Escape: 'pause',
  KeyJ: 'gun',
  KeyK: 'bomb',
  KeyL: 'pod',
};

// Standard gamepad mapping
const PAD: Record<Action, number[]> = {
  jump: [0],
  dash: [1],
  charge: [2],
  pod: [5],
  gun: [7],
  bomb: [6],
  lock: [11],
  pause: [9],
};

export class Input {
  private keys = new Set<string>();
  private held: Record<Action, boolean> = { jump: false, dash: false, gun: false, bomb: false, pod: false, charge: false, lock: false, pause: false };
  private latched: Record<Action, boolean> = { ...this.held };
  private padPrev: Record<Action, boolean> = { ...this.held };
  private mouseHeld = { gun: false, bomb: false, pod: false };
  private lookDX = 0;
  private lookDY = 0;
  private padMoveX = 0;
  private padMoveY = 0;
  private padLookX = 0;
  private padLookY = 0;
  /** True while gameplay input is enabled (in a match, unpaused). */
  enabled = false;
  lastDevice: 'kbm' | 'pad' = 'kbm';
  onPause: (() => void) | null = null;
  onLockToggle: (() => void) | null = null;
  /** Called on the first user gesture (audio unlock). */
  onFirstGesture: (() => void) | null = null;
  private gestured = false;

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      this.gesture();
      if (e.code === 'Tab' && this.enabled) e.preventDefault();
      if (e.code === 'Space' && this.enabled) e.preventDefault();
      this.lastDevice = 'kbm';
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = KEYMAP[e.code];
      if (a) this.press(a);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const a = KEYMAP[e.code];
      if (a) this.release(a);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      for (const k of Object.keys(this.held) as Action[]) this.held[k] = false;
      this.mouseHeld = { gun: false, bomb: false, pod: false };
    });
    window.addEventListener('pointerdown', () => this.gesture());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.lastDevice = 'kbm';
      if (document.pointerLockElement !== canvas) {
        this.requestLock();
        return;
      }
      if (e.button === 0) { this.mouseHeld.gun = true; this.press('gun'); }
      if (e.button === 2) { this.mouseHeld.bomb = true; this.press('bomb'); }
      if (e.button === 1) { this.mouseHeld.pod = true; this.press('pod'); e.preventDefault(); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouseHeld.gun = false; this.release('gun'); }
      if (e.button === 2) { this.mouseHeld.bomb = false; this.release('bomb'); }
      if (e.button === 1) { this.mouseHeld.pod = false; this.release('pod'); }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== canvas) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });
  }

  private gesture() {
    if (!this.gestured) {
      this.gestured = true;
      this.onFirstGesture?.();
    }
  }

  requestLock() {
    try {
      const p = (this.canvas as any).requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* not allowed (e.g. headless) */
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  private press(a: Action) {
    if (!this.held[a]) this.latched[a] = true;
    this.held[a] = true;
    if (a === 'pause' && this.enabled) this.onPause?.();
    if (a === 'lock' && this.enabled) this.onLockToggle?.();
  }

  private release(a: Action) {
    // keep holding if another source still holds it
    if (a === 'gun' && (this.mouseHeld.gun || this.keys.has('KeyJ'))) return;
    if (a === 'bomb' && (this.mouseHeld.bomb || this.keys.has('KeyK'))) return;
    if (a === 'pod' && (this.mouseHeld.pod || this.keys.has('KeyE') || this.keys.has('KeyL'))) return;
    if (a === 'dash' && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'))) return;
    this.held[a] = false;
  }

  /** Poll gamepads; call once per rendered frame. */
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) {
      this.padMoveX = this.padMoveY = this.padLookX = this.padLookY = 0;
      return;
    }
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    this.padMoveX = dz(pad.axes[0] ?? 0);
    this.padMoveY = -dz(pad.axes[1] ?? 0);
    this.padLookX = dz(pad.axes[2] ?? 0);
    this.padLookY = dz(pad.axes[3] ?? 0);
    if (Math.abs(this.padMoveX) + Math.abs(this.padMoveY) + Math.abs(this.padLookX) > 0.1) this.lastDevice = 'pad';
    for (const a of Object.keys(PAD) as Action[]) {
      const down = PAD[a].some((i) => {
        const b = pad!.buttons[i];
        return !!b && (b.pressed || b.value > 0.4);
      });
      if (down && !this.padPrev[a]) {
        this.lastDevice = 'pad';
        this.gesture();
        if (!this.held[a]) this.latched[a] = true;
        this.held[a] = true;
        if (a === 'pause' && this.enabled) this.onPause?.();
        if (a === 'lock' && this.enabled) this.onLockToggle?.();
      } else if (!down && this.padPrev[a]) {
        this.held[a] = false;
      }
      this.padPrev[a] = down;
    }
  }

  /** Camera look delta since last call (pixels-equivalent). */
  consumeLook(dt: number, sens: number): { dx: number; dy: number } {
    const k = 0.0022 * sens;
    const dx = this.lookDX * k + this.padLookX * 2.6 * sens * dt;
    const dy = this.lookDY * k + this.padLookY * 1.8 * sens * dt;
    this.lookDX = this.lookDY = 0;
    return { dx, dy };
  }

  /** Raw 2D move input: x = right, y = forward. */
  moveAxes() {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    x += this.padMoveX;
    y += this.padMoveY;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }

  /** Build the fighter input for one sim tick (camera-relative movement). */
  sample(cameraYaw: number, faceTarget: boolean, out: FighterInput): FighterInput {
    const { x, y } = this.enabled ? this.moveAxes() : { x: 0, y: 0 };
    // forward = (sin yaw, cos yaw); screen right = (-cos yaw, sin yaw)
    const fx = Math.sin(cameraYaw);
    const fz = Math.cos(cameraYaw);
    out.moveX = fx * y - fz * x;
    out.moveZ = fz * y + fx * x;
    const L = this.latched;
    const H = this.held;
    const on = this.enabled;
    out.jumpPressed = on && L.jump;
    out.jumpHeld = on && H.jump;
    out.dashPressed = on && L.dash;
    out.gunPressed = on && L.gun;
    out.gunHeld = on && H.gun;
    out.bombPressed = on && L.bomb;
    out.podPressed = on && L.pod;
    out.chargePressed = on && L.charge;
    out.faceTarget = faceTarget;
    for (const k of Object.keys(L) as Action[]) L[k] = false;
    return out;
  }

  /** Forget held/latched state (e.g. when pausing). */
  clear() {
    for (const k of Object.keys(this.held) as Action[]) {
      this.latched[k] = false;
    }
    this.lookDX = this.lookDY = 0;
  }
}
