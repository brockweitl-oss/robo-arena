import type { Fighter, FighterInput } from './fighter';

/**
 * Manual aim for skill shots and bombs (presentation-side; the sim only sees the
 * resulting aim offset in FighterInput, so replays stay deterministic).
 *
 * Holding the skill or bomb button starts the aim on the opponent. Mouse X / right
 * stick X rotate it (screen-relative), mouse Y / right stick Y push it farther or
 * pull it closer. Releasing fires; the release tick still carries the aim.
 */
export class AimControl {
  /** World yaw of the aim direction and the aim distance (m). */
  yaw = 0;
  dist = 10;
  /** What is being aimed this frame (null when not aiming). */
  kind: 'skill' | 'bomb' | null = null;
  private dx = 0;
  private dy = 0;

  /** Feed this frame's look delta. Returns true when the aim consumed it (the camera should not). */
  feedLook(look: { dx: number; dy: number }, invertY: boolean): boolean {
    if (!this.kind) return false;
    this.dx += look.dx;
    this.dy += invertY ? -look.dy : look.dy;
    return true;
  }

  /** Per sim tick: write the aim offset into `inp` (after the buttons were sampled). */
  apply(inp: FighterInput, me: Fighter, foe: Fighter): FighterInput {
    const held: 'skill' | 'bomb' | null = inp.skillHeld ? 'skill' : inp.bombHeld ? 'bomb' : null;
    const releasing = !held && this.kind !== null;
    if (held && held !== this.kind) {
      // start on the opponent
      const tx = foe.pos.x - me.pos.x;
      const tz = foe.pos.z - me.pos.z;
      this.yaw = Math.atan2(tx, tz);
      this.dist = Math.hypot(tx, tz);
      this.dx = this.dy = 0;
    }
    if (held) {
      // screen right is -yaw for a camera looking along +yaw
      this.yaw -= this.dx;
      this.dist -= this.dy * 9;
      this.dx = this.dy = 0;
    }
    const max = (held ?? this.kind) === 'bomb' ? me.lo.bomb.range : me.lo.skill.range;
    this.dist = Math.max(1.5, Math.min(max, this.dist));
    if (held || releasing) {
      inp.aimX = Math.sin(this.yaw) * this.dist;
      inp.aimZ = Math.cos(this.yaw) * this.dist;
    } else inp.aimX = inp.aimZ = 0;
    this.kind = held;
    return inp;
  }

  reset() {
    this.kind = null;
    this.dx = this.dy = 0;
  }
}
