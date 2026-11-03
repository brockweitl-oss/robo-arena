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
  | 'jump' | 'dash' | 'gun' | 'bomb' | 'pod' | 'charge' | 'skill' | 'lock' | 'pause';

export const ACTIONS: Action[] = ['forward', 'back', 'left', 'right', 'jump', 'dash', 'gun', 'skill', 'bomb', 'pod', 'charge', 'lock', 'pause'];
/** Movement actions: the gamepad always uses the left stick for these. */
export const MOVE_ACTIONS: Action[] = ['forward', 'back', 'left', 'right'];
type ButtonAction = Exclude<Action, 'forward' | 'back' | 'left' | 'right'>;
const BUTTON_ACTIONS: ButtonAction[] = ['jump', 'dash', 'gun', 'skill', 'bomb', 'pod', 'charge', 'lock', 'pause'];

export const ACTION_LABEL: Record<Action, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right',
  jump: 'Jump / hover', dash: 'Dash', gun: 'Fire gun (auto-aim)', skill: 'Skill shot (hold to aim)', bomb: 'Throw bomb', pod: 'Launch pod',
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
    skill: ['KeyR', 'Mouse3'],
    bomb: ['Mouse2', 'KeyK'],
    pod: ['KeyE', 'Mouse1'],
    charge: ['KeyQ', ''],
    lock: ['Tab', 'KeyF'],
    pause: ['Escape', ''],
  },
  pad: {
    forward: [], back: [], left: [], right: [],
    jump: [0], dash: [1], charge: [2], skill: [3], pod: [5], gun: [7], bomb: [6], lock: [11], pause: [9],
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

/** A skill press shorter than this is a quick-cast at the target. */
export const SKILL_TAP_MS = 150;

export class Input {
  /** Held keyboard codes and mouse buttons ('Mouse0'..). */
  private keys = new Set<string>();
  private held: Record<ButtonAction, boolean> = { jump: false, dash: false, gun: false, skill: false, bomb: false, pod: false, charge: false, lock: false, pause: false };
  private latched: Record<ButtonAction, boolean> = { ...this.held };
  private padPrev: Record<ButtonAction, boolean> = { ...this.held };
  private bind: Bindings = cloneBindings(DEFAULT_BINDINGS);
  /** code → actions bound to it. */
  private rev = new Map<string, Action[]>();
  private lookDX = 0;
  private lookDY = 0;
  private bombAimCode: string | null = null;
  private aimedBomb = false;
  bombAimTarget: readonly [number, number, number] | undefined;
  get bombAiming() { return this.enabled && this.bombAimCode !== null; }
  /** Skill: fires on release. Held longer than SKILL_TAP_MS with a target = manual aim; a quick tap = quick-cast. */
  private skillAimStart = -1;
  private aimedSkill = false;
  skillAimTarget: readonly [number, number, number] | undefined;
  get skillAiming() { return this.enabled && this.skillAimStart >= 0; }
  private padMoveX = 0;
  private padMoveY = 0;
  private padLookX = 0;
  private padLookY = 0;
  /** Gamepad index reserved for player 2 in local versus (-1 = none). */
  ignorePad = -1;
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
      this.cancelBombAim();
      this.cancelSkillAim();
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas) { this.cancelBombAim(); this.cancelSkillAim(); }
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
    for (const a of this.rev.get(code) ?? []) {
      if (a === 'bomb' && code.startsWith('Mouse') && this.enabled) {
        this.bombAimCode = code;
        this.bombAimTarget = undefined;
        this.held.bomb = true;
      } else if (!MOVE_ACTIONS.includes(a)) this.press(a as ButtonAction);
    }
  }

  private up(code: string) {
    this.keys.delete(code);
    if (code === this.bombAimCode) {
      this.bombAimCode = null;
      if (this.enabled) {
        this.latched.bomb = true;
        this.aimedBomb = !!this.bombAimTarget;
      }
    }
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
    if (a === 'skill') {
      // aim while held; the shot is latched on release
      if (!this.held.skill && this.enabled) {
        this.skillAimStart = performance.now();
        this.skillAimTarget = undefined;
      }
      this.held.skill = true;
      return;
    }
    if (!this.held[a]) this.latched[a] = true;
    this.held[a] = true;
    if (a === 'pause' && this.enabled) this.onPause?.();
    if (a === 'lock' && this.enabled) this.onLockToggle?.();
  }

  private release(a: ButtonAction) {
    // keep holding if another key/button bound to the same action is still down
    if (this.kbHolds(a) || this.padPrev[a]) return;
    if (a === 'skill') this.releaseSkill();
    this.held[a] = false;
  }

  /** Poll gamepads; call once per rendered frame. */
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected && p.index !== this.ignorePad) { pad = p; break; }
    if (!pad) {
      this.padMoveX = this.padMoveY = this.padLookX = this.padLookY = 0;
      return;
    }
    // Radial deadzone (the old per-axis one snapped shallow diagonals to the cardinal directions:
    // a stick at 10° off forward read as dead-ahead), rescaled so output starts at 0 at the edge.
    // Look gets a 1.6 power curve: fine aim near centre, full speed at the rim.
    const stick = (x: number, y: number, dead: number, curve: number): [number, number] => {
      const m = Math.hypot(x, y);
      if (m < dead) return [0, 0];
      const k = Math.pow(Math.min(1, (m - dead) / (1 - dead)), curve) / m;
      return [x * k, y * k];
    };
    const [mx, my] = stick(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 0.16, 1);
    const [lx, ly] = stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0, 0.14, 1.6);
    this.padMoveX = mx;
    this.padMoveY = -my;
    this.padLookX = lx;
    this.padLookY = ly;
    if (Math.abs(this.padMoveX) + Math.abs(this.padMoveY) + Math.abs(this.padLookX) > 0.1) this.lastDevice = 'pad';
    for (const a of BUTTON_ACTIONS) {
      const down = this.bind.pad[a].some((i) => {
        const b = pad!.buttons[i];
        return !!b && (b.pressed || b.value > 0.4);
      });
      if (a === 'skill') {
        if (down && !this.padPrev.skill) { this.lastDevice = 'pad'; this.gesture(); this.press('skill'); }
        else if (!down && this.padPrev.skill && !this.kbHolds('skill')) { this.padPrev.skill = false; this.release('skill'); }
        this.padPrev.skill = down;
        continue;
      }
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
    const dx = this.lookDX * k + this.padLookX * 3.2 * sens * dt; // ≈185°/s at full tilt (was 150°/s: slow to swing the free camera)
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
    out.bombTarget = out.bombPressed && this.aimedBomb ? this.bombAimTarget : undefined;
    this.aimedBomb = false;
    out.podPressed = on && L.pod;
    out.chargePressed = on && L.charge;
    out.skillPressed = on && L.skill;
    out.skillTarget = out.skillPressed && this.aimedSkill ? this.skillAimTarget : undefined;
    if (out.skillPressed) this.aimedSkill = false;
    out.faceTarget = faceTarget;
    for (const k of BUTTON_ACTIONS) L[k] = false;
    return out;
  }

  /** Forget held/latched state (e.g. when pausing). */
  clear() {
    this.cancelBombAim();
    this.cancelSkillAim();
    for (const k of BUTTON_ACTIONS) this.latched[k] = false;
    this.lookDX = this.lookDY = 0;
  }

  private releaseSkill() {
    if (!this.held.skill) return;
    this.held.skill = false;
    if (this.enabled && this.skillAimStart >= 0) {
      this.latched.skill = true;
      this.aimedSkill = performance.now() - this.skillAimStart >= SKILL_TAP_MS && !!this.skillAimTarget;
    }
    this.skillAimStart = -1;
  }

  private cancelSkillAim() {
    this.skillAimStart = -1;
    this.skillAimTarget = undefined;
    this.aimedSkill = false;
    this.latched.skill = false;
    this.held.skill = false;
  }

  private cancelBombAim() {
    this.bombAimCode = null;
    this.bombAimTarget = undefined;
    this.aimedBomb = false;
    this.latched.bomb = false;
    this.held.bomb = false;
  }
}
