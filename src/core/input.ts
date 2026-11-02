import type { FighterInput } from '../game/fighter';

/**
 * Keyboard + mouse + gamepad. Button presses are latched until the next
 * simulation tick consumes them, so quick taps between ticks are never lost.
 *
 * Every gameplay action is rebindable through a `Bindings` table (persisted in
 * `save.settings.bindings`). Keyboard entries are `KeyboardEvent.code` strings;
 * mouse buttons are `Mouse0` (left), `Mouse1` (middle), `Mouse2` (right).
 * Gamepad entries are standard-mapping button indices. Menu navigation keys are
 * fixed (WASD/arrows, Enter, Esc) and are not affected by bindings.
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'dash' | 'gun' | 'bomb' | 'pod' | 'charge' | 'lock' | 'pause';

export const ACTIONS: Action[] = ['forward', 'back', 'left', 'right', 'jump', 'dash', 'gun', 'bomb', 'pod', 'charge', 'lock', 'pause'];
/** Movement actions: the gamepad always uses the left stick for these. */
export const MOVE_ACTIONS: Action[] = ['forward', 'back', 'left', 'right'];
type ButtonAction = Exclude<Action, 'forward' | 'back' | 'left' | 'right'>;
const BUTTON_ACTIONS: ButtonAction[] = ['jump', 'dash', 'gun', 'bomb', 'pod', 'charge', 'lock', 'pause'];

export const ACTION_LABEL: Record<Action, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right',
  jump: 'Jump / hover', dash: 'Dash', gun: 'Fire gun', bomb: 'Throw bomb', pod: 'Launch pod',
  charge: 'Charge / guard', lock: 'Toggle lock-on', pause: 'Pause',
};

/** Keyboard/mouse slots per action shown in the Controls panel. */
export const KEY_SLOTS = 2;

export interface Bindings {
  /** action → exactly KEY_SLOTS codes ('' = empty slot). */
  keys: Record<Action, string[]>;
  /** action → gamepad button indices (movement actions are stick-only, always []). */
  pad: Record<Action, number[]>;
}

export const DEFAULT_BINDINGS: Bindings = {
  keys: {
    forward: ['KeyW', 'ArrowUp'],
    back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    jump: ['Space', ''],
    dash: ['ShiftLeft', 'ShiftRight'],
    gun: ['Mouse0', 'KeyJ'],
    bomb: ['Mouse2', 'KeyK'],
    pod: ['KeyE', 'Mouse1'],
    charge: ['KeyQ', ''],
    lock: ['Tab', 'KeyF'],
    pause: ['Escape', ''],
  },
  pad: {
    forward: [], back: [], left: [], right: [],
    jump: [0], dash: [1], charge: [2], pod: [5], gun: [7], bomb: [6], lock: [11], pause: [9],
  },
};

export function cloneBindings(b: Bindings): Bindings {
  const keys = {} as Bindings['keys'];
  const pad = {} as Bindings['pad'];
  for (const a of ACTIONS) {
    keys[a] = [...(b.keys[a] ?? [])];
    pad[a] = [...(b.pad[a] ?? [])];
  }
  return { keys, pad };
}

/** Fill missing actions/slots from defaults and drop junk (used by save migration). */
export function normalizeBindings(raw: unknown): Bindings {
  const out = cloneBindings(DEFAULT_BINDINGS);
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<Bindings>;
  for (const a of ACTIONS) {
    const k = r.keys?.[a];
    if (Array.isArray(k)) {
      const codes = k.map((c) => (typeof c === 'string' ? c : '')).slice(0, KEY_SLOTS);
      while (codes.length < KEY_SLOTS) codes.push('');
      out.keys[a] = codes;
    }
    const p = r.pad?.[a];
    if (Array.isArray(p) && !MOVE_ACTIONS.includes(a)) out.pad[a] = p.filter((i) => Number.isInteger(i) && i >= 0 && i < 32).slice(0, 1);
  }
  return out;
}

/** Which action (other than `except`) already uses this keyboard/mouse code. */
export function keyConflict(b: Bindings, code: string, except?: Action): Action | null {
  if (!code) return null;
  for (const a of ACTIONS) if (a !== except && b.keys[a].includes(code)) return a;
  return null;
}
export function padConflict(b: Bindings, btn: number, except?: Action): Action | null {
  for (const a of ACTIONS) if (a !== except && b.pad[a].includes(btn)) return a;
  return null;
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt', AltRight: 'R-Alt', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter', Backspace: 'Bksp', CapsLock: 'Caps',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'M4', Mouse4: 'M5',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
};
export function keyName(code: string): string {
  if (!code) return '—';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home'];
export function padName(i: number | undefined): string {
  if (i === undefined) return '—';
  return PAD_NAMES[i] ?? `B${i}`;
}

export class Input {
  /** Held keyboard codes and mouse buttons ('Mouse0'..). */
  private keys = new Set<string>();
  private held: Record<ButtonAction, boolean> = { jump: false, dash: false, gun: false, bomb: false, pod: false, charge: false, lock: false, pause: false };
  private latched: Record<ButtonAction, boolean> = { ...this.held };
  private padPrev: Record<ButtonAction, boolean> = { ...this.held };
  private bind: Bindings = cloneBindings(DEFAULT_BINDINGS);
  /** code → actions bound to it. */
  private rev = new Map<string, Action[]>();
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
    this.setBindings(DEFAULT_BINDINGS);
    window.addEventListener('keydown', (e) => {
      this.gesture();
      if (this.enabled && this.rev.has(e.code)) e.preventDefault();
      this.lastDevice = 'kbm';
      if (e.repeat) return;
      this.down(e.code);
      // Escape always pauses, even if pause was rebound, so the player can never get stuck.
      if (e.code === 'Escape' && !this.bind.keys.pause.includes('Escape') && this.enabled) this.onPause?.();
    });
    window.addEventListener('keyup', (e) => this.up(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      for (const k of BUTTON_ACTIONS) this.held[k] = false;
    });
    window.addEventListener('pointerdown', () => this.gesture());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.lastDevice = 'kbm';
      if (document.pointerLockElement !== canvas) {
        this.requestLock();
        return;
      }
      if (e.button === 1) e.preventDefault();
      this.down(`Mouse${e.button}`);
    });
    window.addEventListener('mouseup', (e) => this.up(`Mouse${e.button}`));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== canvas) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });
  }

  /** Replace the binding table (called from applySettings). */
  setBindings(b: Bindings | undefined) {
    this.bind = normalizeBindings(b);
    this.rev.clear();
    for (const a of ACTIONS) {
      for (const c of this.bind.keys[a]) {
        if (!c) continue;
        const l = this.rev.get(c) ?? [];
        l.push(a);
        this.rev.set(c, l);
      }
    }
    for (const a of BUTTON_ACTIONS) if (!this.kbHolds(a) && !this.padPrev[a]) this.held[a] = false;
  }

  get bindings(): Bindings {
    return cloneBindings(this.bind);
  }

  private kbHolds(a: Action) {
    return this.bind.keys[a].some((c) => !!c && this.keys.has(c));
  }

  private down(code: string) {
    this.keys.add(code);
    for (const a of this.rev.get(code) ?? []) if (!MOVE_ACTIONS.includes(a)) this.press(a as ButtonAction);
  }

  private up(code: string) {
    this.keys.delete(code);
    for (const a of this.rev.get(code) ?? []) if (!MOVE_ACTIONS.includes(a)) this.release(a as ButtonAction);
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

  private press(a: ButtonAction) {
    if (!this.held[a]) this.latched[a] = true;
    this.held[a] = true;
    if (a === 'pause' && this.enabled) this.onPause?.();
    if (a === 'lock' && this.enabled) this.onLockToggle?.();
  }

  private release(a: ButtonAction) {
    // keep holding if another key/button bound to the same action is still down
    if (this.kbHolds(a) || this.padPrev[a]) return;
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
    for (const a of BUTTON_ACTIONS) {
      const down = this.bind.pad[a].some((i) => {
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
      } else if (!down && this.padPrev[a] && !this.kbHolds(a)) {
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
    if (this.kbHolds('forward')) y += 1;
    if (this.kbHolds('back')) y -= 1;
    if (this.kbHolds('right')) x += 1;
    if (this.kbHolds('left')) x -= 1;
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
    for (const k of BUTTON_ACTIONS) L[k] = false;
    return out;
  }

  /** Forget held/latched state (e.g. when pausing). */
  clear() {
    for (const k of BUTTON_ACTIONS) this.latched[k] = false;
    this.lookDX = this.lookDY = 0;
  }
}
