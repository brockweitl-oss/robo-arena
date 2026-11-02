import { emptyInput, type FighterInput } from '../game/fighter';

/**
 * Reads one specific gamepad into a FighterInput (local versus, player 2).
 * Standard mapping: L-stick move, A jump, B dash, X charge, Y skill, RB pod, LT bomb, RT gun.
 */
const MAP = { jump: 0, dash: 1, charge: 2, skill: 3, pod: 5, bomb: 6, gun: 7 } as const;
type Act = keyof typeof MAP;

export class PadInput {
  private prev: Record<Act, boolean> = { jump: false, dash: false, charge: false, skill: false, pod: false, bomb: false, gun: false };
  private latched: Record<Act, boolean> = { ...this.prev };
  private held: Record<Act, boolean> = { ...this.prev };
  private mx = 0;
  private my = 0;
  connected = false;

  constructor(public index: number) {}

  /** Poll once per rendered frame. */
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads[this.index];
    this.connected = !!pad && pad.connected;
    if (!pad || !pad.connected) {
      this.mx = this.my = 0;
      for (const k of Object.keys(this.held) as Act[]) this.held[k] = false;
      return;
    }
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    this.mx = dz(pad.axes[0] ?? 0);
    this.my = -dz(pad.axes[1] ?? 0);
    for (const k of Object.keys(MAP) as Act[]) {
      const b = pad.buttons[MAP[k]];
      const down = !!b && (b.pressed || b.value > 0.4);
      if (down && !this.prev[k]) this.latched[k] = true;
      this.held[k] = down;
      this.prev[k] = down;
    }
  }

  /** Build the input for one sim tick, camera-relative to `yaw`. */
  sample(yaw: number, out: FighterInput = emptyInput()): FighterInput {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    out.moveX = fx * this.my - fz * this.mx;
    out.moveZ = fz * this.my + fx * this.mx;
    const L = this.latched;
    out.jumpPressed = L.jump;
    out.jumpHeld = this.held.jump;
    out.dashPressed = L.dash;
    out.gunPressed = L.gun;
    out.gunHeld = this.held.gun;
    out.bombPressed = L.bomb;
    out.podPressed = L.pod;
    out.chargePressed = L.charge;
    out.skillPressed = L.skill;
    out.skillHeld = this.held.skill;
    out.bombHeld = this.held.bomb;
    out.aimX = out.aimZ = 0;
    out.faceTarget = true;
    for (const k of Object.keys(L) as Act[]) L[k] = false;
    return out;
  }
}

/** Indices of connected gamepads. */
export function connectedPads(): number[] {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const out: number[] = [];
  for (const p of pads) if (p && p.connected) out.push(p.index);
  return out;
}
