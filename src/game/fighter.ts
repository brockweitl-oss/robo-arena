import * as THREE from 'three';
import { deriveStats, BASE_MASS, type DerivedStats, type ResolvedLoadout } from '../data/parts';
import type { AnimMode, AnimSource } from '../robot/animator';
import { moveAndCollide } from './collision';
import type { Collider } from '../arena/types';
import { makePrimer, comboBonus, type PrimerState, type PrimerClearReason } from './combos';

/** Device-independent controls for one sim tick. Move is world-space XZ (length ≤ 1). */
export interface FighterInput {
  moveX: number;
  moveZ: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  dashPressed: boolean;
  gunPressed: boolean;
  gunHeld: boolean;
  bombPressed: boolean;
  podPressed: boolean;
  chargePressed: boolean;
  /** Face the target even while moving (hard lock / strafing). */
  faceTarget: boolean;
  bombTarget?: readonly [number, number, number];
  /** Skill shot (released). A target is a manually aimed world point; none = quick-cast at the target. */
  skillPressed?: boolean;
  skillTarget?: readonly [number, number, number];
}

export const emptyInput = (): FighterInput => ({
  moveX: 0, moveZ: 0, jumpPressed: false, jumpHeld: false, dashPressed: false, gunPressed: false,
  gunHeld: false, bombPressed: false, podPressed: false, chargePressed: false, faceTarget: false,
});

export const GRAVITY = 34;
export const RADIUS = 0.5;
export const HEIGHT = 2.0;
/** Global movement pace (1 = original tuning). Lowered after play-test 1: the game was too fast to follow. */
export const PACE = 0.88;
const BUFFER = 0.1;
const COYOTE = 0.1;
/** Guard frames at the very start of a charge that count as a parry. */
export const PARRY_WINDOW = 0.12;
/** Guard covers a 100-degree forward arc, shared by deflection and damage resolution. */
export const GUARD_DOT = Math.cos(50 * Math.PI / 180);
export const DASH_RECOVERY = 0.22;
/** Bonus damage multiplier on the hit that causes a knockdown (combo finisher). */
export const KNOCKDOWN_BONUS = 1.25;
/** Below this HP fraction, bomb/pod cooldowns recover faster (comeback). */
export const COMEBACK_HP = 0.25;
export const COMEBACK_CD = 0.85;
/** Hard landing threshold (m/s downward). */
const HARD_LANDING = 13;

/**
 * Ground-movement feel (play-test 3: "a little stiff, needs weight and momentum").
 * accel/brake/plant are in run speeds per second (so times are the same at any top speed), the
 * rest in m/s² or rad/s. All are divided by the build's movement weight (`moveWeight`), so light
 * builds start/stop/turn snappier and heavy builds slower. Reference build (weight 1) in comments.
 */
export const MOVE = {
  /** Ground acceleration. Effective rate = accel × (launch → top) as speed builds, so the first
   *  steps bite and the last metre per second eases in: 0.866 / accel ≈ 0.25 s to top speed. */
  accel: 3.5,
  launch: 1.6,
  top: 0.8,
  /** Stick released: coast to a stop. 1 / brake ≈ 0.19 s, ≈0.8 m slide from top speed. */
  brake: 5.2,
  /** Stick > ~100° from current velocity: plant the feet and brake hard (≈0.11 s to zero, then
   *  re-accelerate the other way): weighty, but never a slide toward danger. */
  plant: 8.9,
  plantDot: Math.cos(100 * Math.PI / 180),
  /** Extra grip on partial turns (rate × (1 + turnGrip × (1 − cos angle))): arcs instead of drifting. */
  turnGrip: 0.6,
  /** Speed above the current cap (dash carry, knockback slide) bleeds off at this rate. */
  bleed: 60,
  /** A plant that starts above this fraction of run speed emits a 'skid' event (dust). */
  skidSpeed: 0.6,
  /** Facing turn rates (rad/s): running, standing, aiming/facing the target, airborne. */
  turnRun: 12,
  turnIdle: 15,
  turnAim: 20,
  turnAir: 10,
  /** Movement weight from build mass: 1 + (mass − BASE_MASS) × perMass, clamped (≈ ±25% feel). */
  weightPerMass: 0.008,
  weightMin: 0.8,
  weightMax: 1.25,
  /** Attack slow-downs ease to their cap over this long instead of snapping (same final cap). */
  capEase: 0.1,
  /** Dash exit keeps its velocity, clamped to this × run speed, then bleeds into normal control. */
  dashExitCarry: 1.15,
  /** Jump in the back half of a ground dash (or during its recovery) is a dash-jump: it keeps
   *  horizontal speed up to this × run speed. Air carry then decays as usual (no cross-map flings). */
  dashJumpFrom: 0.5,
  dashJumpCarry: 1.3,
} as const;

/** Movement weight factor for a build mass (1 = reference build). */
export function moveWeight(mass: number) {
  return Math.min(MOVE.weightMax, Math.max(MOVE.weightMin, 1 + (mass - BASE_MASS) * MOVE.weightPerMass));
}

export type FighterEvent =
  | { type: 'jump' } | { type: 'airjump' } | { type: 'dash'; air: boolean } | { type: 'land'; speed: number; hard: boolean }
  | { type: 'fire'; index: number } | { type: 'railCharge' } | { type: 'bomb' } | { type: 'pod' }
  | { type: 'chargeStart'; wakeup: boolean } | { type: 'chargeLunge' } | { type: 'knockdown' } | { type: 'getup' }
  | { type: 'parry' } | { type: 'guardBreak' } | { type: 'hover'; on: boolean }
  | { type: 'primerClear'; owner: number; reason: PrimerClearReason }
  | { type: 'skillCast' } | { type: 'skill' } | { type: 'feint' }
  /** Hard reversal at speed: feet planted (presentation: skid dust). */
  | { type: 'skid'; speed: number };

export interface HitInfo {
  damage: number;
  down: number;
  dir: THREE.Vector3;
  knock: number;
  heavy: boolean;
  /** Launch upward (m/s), e.g. hazards. */
  launch?: number;
  source: 'gun' | 'bomb' | 'pod' | 'charge' | 'hazard' | 'fire' | 'skill';
  /** Presentation only: which weapon/ordnance model caused it (per-weapon effects). Never read by the sim. */
  look?: string;
  /** Direct bomb hit: breaks a guard instead of being blocked. */
  guardBreak?: boolean;
  /** Light damage-over-time: no flinch, no hit-stop. */
  tick?: boolean;
  /** Actual HP bonus, admitted only after a clean damaging hit. */
  comboBonus?: number;
}

export interface HitResult {
  applied: boolean;
  /** Absorbed by a charge guard (reduced damage, no flinch). */
  blocked?: boolean;
  /** Perfect guard at the start of a charge: no damage at all. */
  parried?: boolean;
  guardBroken?: boolean;
  knockdown: boolean;
  ko: boolean;
  damage: number;
  comboDetonated?: boolean;
  comboBonus?: number;
}

export type SpawnReq = { kind: 'shot'; index: number; air: boolean; power: number } | { kind: 'bomb' } | { kind: 'pod' }
  | { kind: 'skill'; target: readonly [number, number, number] | null };

export type FighterSnapshot = Readonly<Record<string, unknown>> & { readonly __fighterSnapshot?: never };
/** Immutable per-match fields and per-step scratch lists: never part of a snapshot. */
const FIGHTER_STATIC = new Set(['id', 'lo', 'st', 'weight', 'events', 'spawns']);
/** Shared references (arena objects, immutable tuples) restored as-is. */
const FIGHTER_REFS = new Set(['groundCollider', 'bombTarget', 'skillTarget', 'castTarget']);
/** Readonly vectors restored in place (other code may hold them). */
const FIGHTER_VECTORS = new Set(['pos', 'vel', 'dashDir']);

/** Deep copy of plain sim state: primitives, vectors, arrays and plain objects. */
export function cloneState<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof THREE.Vector3) return v.clone() as T;
  if (Array.isArray(v)) return v.map(cloneState) as T;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) throw new Error('cloneState: unsupported sim value');
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(v as object)) o[k] = cloneState((v as Record<string, unknown>)[k]);
  return o as T;
}

export class Fighter implements AnimSource {
  primer: PrimerState | null = null;
  bombTarget: readonly [number, number, number] | undefined;

  prime(owner: number) {
    if (this.primer || !this.alive || this.mode === 'down' || this.mode === 'getup') return false;
    this.primer = makePrimer(owner);
    return true;
  }

  clearPrimer(reason: PrimerClearReason) {
    if (!this.primer) return;
    this.events.push({ type: 'primerClear', owner: this.primer.owner, reason });
    this.primer = null;
  }
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  grounded = true;
  mode: AnimMode = 'ground';
  modeTime = 0;
  chargePhase = 0;
  hovering = false;
  aimTarget: THREE.Vector3 | null = null;
  aimWeight = 0;
  railCharge = 0;
  readonly dashDir = new THREE.Vector3(0, 0, 1);
  /** Derived movement/defense stats for this loadout. */
  readonly st: DerivedStats;
  /** Movement weight from build mass (see MOVE): scales ground accel, braking and turning. */
  readonly weight: number;
  /** Eased attack slow-down cap (1 = free movement). */
  private moveCap = 1;
  /** Feet planted in a hard reversal (edge-detects the 'skid' event). */
  private planting = false;
  /** Remaining recovery that came only from a dash exit (allows a dash-jump, never actions). */
  private dashExitT = 0;
  private dashExitAir = false;

  hp: number;
  maxHp: number;
  down = 0;
  invuln = 0;
  hitstop = 0;
  /** Set true to freeze controls (intro, results). */
  locked = false;

  // timers
  gunCd = 0;
  bombCd = 0;
  podCd = 0;
  chargeCd = 0;
  skillCd = 0;
  /** Skill cast in progress: seconds until the shot leaves (-1 = none) and its aim point (null = at the target). */
  castT = -1;
  castTarget: readonly [number, number, number] | null = null;
  private skillTarget: readonly [number, number, number] | undefined;
  private bufSkill = 0;
  /** Time until the next dash charge is restored (0 = full). */
  dashCd = 0;
  dashCharges: number;
  private dashGap = 0;
  /** Commitment recovery: movement remains responsive, but another action must wait. */
  recoveryTime = 0;
  private dodgeAwarded = false;
  private burstLeft = 0;
  private shotTimer = 0;
  private shotIndex = 0;
  private fireSlowT = 0;
  private bombLockT = 0;
  private aimHold = 0;
  private coyote = 0;
  private bufJump = 0;
  private bufDash = 0;
  private bufGun = 0;
  private bufBomb = 0;
  private bufPod = 0;
  private bufCharge = 0;
  private airJumps = 0;
  private airDashes = 0;
  hoverFuel = 0;
  private sinceHit = 99;
  private jumpHeldSincePress = false;
  private chargeHit = false;
  private groundCollider: Collider | null = null;
  private hazardCd = 0;
  private downGroundT = 0;
  /** Hold-to-charge gun (beam): seconds held, -1 when not holding. */
  private holdT = -1;
  /** Hard-landing recovery remaining. */
  landT = 0;
  dashIframe = 0;
  private wakeup = false;
  /** Homing accessibility scale. Competitive local versus uses 1 for both players. */
  homingMul = 1;
  /** Legacy field retained for callers; simulation does not apply random aim error. */
  aimJitter = 0;
  /** Pick-up buffs (seconds remaining) and shield HP. */
  buffs = { overdrive: 0, speed: 0, shield: 0 };

  readonly events: FighterEvent[] = [];
  /** Requests for the world to spawn projectiles etc. */
  readonly spawns: SpawnReq[] = [];

  // stats
  stats = { damageDealt: 0, hits: 0, knockdowns: 0, knockdownsTaken: 0, shots: 0, dodges: 0, parries: 0, gunProjectiles: 0, gunHits: 0, gunDamage: 0, gunDeflected: 0, primes: 0, combos: 0, comboDamage: 0, skillCasts: 0, skillHits: 0, skillDamage: 0, feints: 0, sweetSpots: 0, captures: 0 };

  constructor(readonly id: number, readonly lo: ResolvedLoadout) {
    this.st = deriveStats(lo);
    this.weight = moveWeight(this.st.mass);
    this.maxHp = this.hp = this.st.hp;
    this.dashCharges = this.st.dashCharges;
    this.resetAir();
  }

  /**
   * Rollback netcode: every mutable sim field, deep-copied. Loadout/derived stats are immutable and
   * the ground collider is an arena object (kept by reference). Generic over own fields so new sim
   * state is captured automatically; see `World.snapshot`.
   */
  snapshot(): FighterSnapshot {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(this)) {
      if (FIGHTER_STATIC.has(k)) continue;
      const v = (this as unknown as Record<string, unknown>)[k];
      out[k] = FIGHTER_REFS.has(k) ? v : cloneState(v);
    }
    return out as FighterSnapshot;
  }

  restore(s: FighterSnapshot) {
    const self = this as unknown as Record<string, unknown>;
    for (const k of Object.keys(s)) {
      const v = (s as Record<string, unknown>)[k];
      const cur = self[k];
      if (cur instanceof THREE.Vector3 && v instanceof THREE.Vector3 && FIGHTER_VECTORS.has(k)) cur.copy(v);
      else self[k] = FIGHTER_REFS.has(k) ? v : cloneState(v);
    }
    this.events.length = 0;
    this.spawns.length = 0;
  }

  get alive() {
    return this.hp > 0;
  }
  get runSpeed() {
    return this.st.runSpeed * PACE * (this.buffs.speed > 0 ? 1.15 : 1) * (this.slowT > 0 ? 0.65 : 1);
  }
  /** Chilled by a Frost Spike (seconds, fixed duration). */
  slowT = 0;
  /** Down-gauge capacity. */
  get endurance() {
    return this.st.endurance;
  }
  /** Brief invulnerability at the start of a dash (perfect-dodge window). */
  get dodging() {
    return this.dashIframe > 0;
  }
  /** Charging robots guard: front shots deflect, blasts only chip. */
  get guarding() {
    return this.mode === 'charge' && this.chargePhase < 2;
  }
  /** First frames of the guard: a perfect parry. */
  get parrying() {
    return this.mode === 'charge' && this.chargePhase === 0 && this.modeTime < PARRY_WINDOW;
  }
  get attackCommitted() {
    return this.recoveryTime > 0 || this.holdT >= 0 || this.burstLeft > 0 || this.castT >= 0;
  }
  get remainingAirDashes() { return this.airDashes; }
  /** Facing turn rate (rad/s) while aiming/facing the target (also mirrored by the skill aim lane). */
  get aimTurnRate() {
    return this.grounded ? MOVE.turnAim / Math.sqrt(this.weight) : MOVE.turnAir;
  }

  get canDash() {
    // a skill wind-up can be feinted with a dash; other commitments cannot
    const feintable = this.castT >= 0 && this.recoveryTime <= 0 && this.holdT < 0 && this.burstLeft === 0;
    return this.dashCharges > 0 && this.dashGap <= 0 && (!this.attackCommitted || feintable);
  }
  /** Dashing out of a skill wind-up: the shot is cancelled and half the cooldown is refunded. */
  static readonly FEINT_REFUND = 0.5;
  /** Incoming travel direction must point into our forward guard, not our back. */
  facesIncoming(dir: THREE.Vector3) {
    const length = dir.length();
    return length > 1e-6 && (-dir.x * Math.sin(this.yaw) - dir.z * Math.cos(this.yaw)) / length >= GUARD_DOT;
  }
  get canAct() {
    return !this.locked && !this.attackCommitted && (this.mode === 'ground' || this.mode === 'air');
  }
  get isInvulnerable() {
    return this.invuln > 0 || this.mode === 'down' || this.mode === 'getup';
  }
  get maxHover() {
    return this.st.hoverTime;
  }
  get lowHp() {
    return this.hp / this.maxHp < COMEBACK_HP;
  }
  /** Damage multiplier for this fighter's attacks (pick-up overdrive). */
  get damageMul() {
    return this.buffs.overdrive > 0 ? 1.2 : 1;
  }
  /** Gun hold progress 0..1 (beam), for HUD/visuals. */
  get holdFrac() {
    const g = this.lo.gun;
    if (!g.holdMax || this.holdT < 0) return 0;
    return Math.min(1, this.holdT / g.holdMax);
  }

  private resetAir() {
    this.airJumps = this.st.airJumps;
    this.airDashes = this.st.airDashes;
    this.hoverFuel = this.maxHover;
  }

  setMode(m: AnimMode) {
    if (m === 'down' || m === 'getup') this.clearPrimer(this.alive ? 'down' : 'death');
    this.mode = m;
    this.planting = false;
    this.modeTime = 0;
  }

  /** Chest-height point used as the aim target by the opponent. */
  chestPoint(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.15, this.pos.z);
  }

  /** Approximate muzzle position (right forearm), used to spawn shots. */
  muzzlePoint(out = new THREE.Vector3()) {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    // right side is -X in local space
    return out.set(this.pos.x + c * -0.42 + s * 0.55, this.pos.y + 1.3, this.pos.z - s * -0.42 + c * 0.55);
  }

  private startCharge(yawToTarget: number, wake: boolean) {
    this.bufCharge = 0;
    this.setMode('charge');
    this.chargePhase = 0;
    this.chargeHit = false;
    this.wakeup = wake;
    // Reserve the full commitment immediately, including interrupted/parried attempts.
    const ch = this.lo.body.charge;
    this.chargeCd = this.st.chargeCooldown * (wake ? 1.3 : 1) + ch.windup * (wake ? 0.7 : 1) + ch.lunge + ch.recover;
    this.yaw = yawToTarget;
    this.holdT = -1;
    this.events.push({ type: 'chargeStart', wakeup: wake });
  }

  step(dt: number, inp: FighterInput, target: Fighter, colliders: Collider[], halfX: number, halfZ: number) {
    this.events.length = 0;
    this.spawns.length = 0;
    // A throw can remain buffered through the last recovery ticks. Keep that
    // press's target until another bomb press replaces it (including auto-aim).
    if (inp.bombPressed) this.bombTarget = inp.bombTarget ? [...inp.bombTarget] : undefined;
    if (inp.skillPressed) this.skillTarget = inp.skillTarget ? [...inp.skillTarget] : undefined;
    if (this.primer) {
      this.primer.remainingTicks--;
      this.primer.armTicks = Math.max(0, this.primer.armTicks - 1);
      this.primer.remaining = Math.max(0, this.primer.remainingTicks / 60);
      this.primer.armed = this.primer.armTicks === 0;
      if (!this.alive) this.clearPrimer('death');
      else if (this.primer.remainingTicks <= 0) this.clearPrimer('expired');
    }
    // Real-time combat: presentation must never freeze simulation or eat controls.
    this.hitstop = 0;
    this.modeTime += dt;
    this.sinceHit += dt;
    // comeback: utility cooldowns recover faster at low HP
    const cdRate = this.lowHp ? 1 / COMEBACK_CD : 1;
    this.gunCd = Math.max(0, this.gunCd - dt);
    this.bombCd = Math.max(0, this.bombCd - dt * cdRate);
    this.podCd = Math.max(0, this.podCd - dt * cdRate);
    this.chargeCd = Math.max(0, this.chargeCd - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.hazardCd = Math.max(0, this.hazardCd - dt);
    this.dashGap = Math.max(0, this.dashGap - dt);
    this.recoveryTime = Math.max(0, this.recoveryTime - dt);
    this.dashExitT = Math.max(0, this.dashExitT - dt);
    this.landT = Math.max(0, this.landT - dt);
    for (const k of ['overdrive', 'speed'] as const) this.buffs[k] = Math.max(0, this.buffs[k] - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    // dash charges refill one at a time
    if (this.dashCharges < this.st.dashCharges) {
      this.dashCd -= dt;
      if (this.dashCd <= 0) {
        this.dashCharges++;
        this.dashCd = this.dashCharges < this.st.dashCharges ? this.dashRecharge() : 0;
      }
    } else this.dashCd = 0;
    this.fireSlowT = Math.max(0, this.fireSlowT - dt);
    this.dashIframe = Math.max(0, this.dashIframe - dt);
    this.bombLockT = Math.max(0, this.bombLockT - dt);
    this.aimHold = Math.max(0, this.aimHold - dt);
    if (this.sinceHit > 1.1) this.down = Math.max(0, this.down - 38 * dt);

    // input buffering (~100 ms)
    const live = !this.locked;
    const buf = (b: number, pressed: boolean) => (live && pressed ? BUFFER : Math.max(0, b - dt));
    this.bufJump = buf(this.bufJump, inp.jumpPressed);
    this.bufDash = buf(this.bufDash, inp.dashPressed);
    this.bufGun = buf(this.bufGun, inp.gunPressed || (inp.gunHeld && this.burstLeft === 0 && this.holdT < 0));
    this.bufBomb = buf(this.bufBomb, inp.bombPressed);
    this.bufPod = buf(this.bufPod, inp.podPressed);
    this.bufCharge = buf(this.bufCharge, inp.chargePressed);
    this.bufSkill = buf(this.bufSkill, !!inp.skillPressed);
    this.skillCd = Math.max(0, this.skillCd - dt);
    // a cast is interrupted by anything that takes control away (hits, knockdowns, charges)
    if (this.castT >= 0 && ((this.mode !== 'ground' && this.mode !== 'air') || this.locked || !this.alive)) this.castT = -1;
    if (inp.jumpPressed) this.jumpHeldSincePress = true;
    if (!inp.jumpHeld) this.jumpHeldSincePress = false;

    const tgt = target.chestPoint();
    this.aimTarget = tgt;
    const toT = new THREE.Vector3(tgt.x - this.pos.x, 0, tgt.z - this.pos.z);
    const yawToTarget = Math.atan2(toT.x, toT.z);

    const moveLen = Math.min(1, Math.hypot(inp.moveX, inp.moveZ));
    const mv = new THREE.Vector3(inp.moveX, 0, inp.moveZ);
    if (moveLen > 0.001) mv.normalize();
    const controls = live && this.alive;
    const gun = this.lo.gun;

    // ------------------------------------------------ state logic
    switch (this.mode) {
      case 'ground':
      case 'air': {
        const grounded = this.grounded;
        if (grounded) this.coyote = COYOTE;
        else this.coyote = Math.max(0, this.coyote - dt);
        this.hovering = false;
        if (!controls) {
          this.applyFriction(dt, grounded ? 40 : 2);
          break;
        }
        const recovering = (this.landT > 0 && grounded) || this.recoveryTime > 0;
        // --- dash ---
        if (!recovering && this.bufDash > 0 && this.canDash && (grounded || this.airDashes > 0)) {
          this.bufDash = 0;
          if (this.castT >= 0) {
            this.castT = -1;
            this.skillCd = this.lo.skill.cooldown * (1 - Fighter.FEINT_REFUND);
            this.stats.feints++;
            this.events.push({ type: 'feint' });
          }
          const dir = moveLen > 0.2 ? mv.clone() : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          this.dashDir.copy(dir);
          const air = !grounded;
          if (air) this.airDashes--;
          this.setMode(air ? 'airdash' : 'dash');
          const sp = this.st.dashSpeed * PACE;
          this.dashIframe = 0.12;
          this.dodgeAwarded = false;
          this.vel.set(dir.x * sp, air ? (this.st.dashStyle === 'flight' ? 2.5 : 0.5) : 0, dir.z * sp);
          if (inp.faceTarget || this.aimHold > 0) this.yaw = yawToTarget;
          else this.yaw = Math.atan2(dir.x, dir.z);
          if (this.dashCharges === this.st.dashCharges) this.dashCd = this.dashRecharge();
          this.dashCharges--;
          this.dashGap = this.st.dashTime + DASH_RECOVERY;
          this.events.push({ type: 'dash', air });
          break;
        }
        // --- charge attack (also the guard) ---
        if (this.bufCharge > 0 && this.chargeCd <= 0 && !recovering && !this.attackCommitted) {
          this.startCharge(yawToTarget, false);
          break;
        }
        // --- jump / air jump ---
        // Dash recovery only gates actions: jumping out of it is a dash-jump that keeps the dash's speed.
        const dashOnly = this.recoveryTime > 0 && this.recoveryTime <= this.dashExitT + 1e-9 && !(this.landT > 0 && grounded);
        const jumpLocked = dashOnly ? this.holdT >= 0 || this.burstLeft > 0 || this.castT >= 0 : recovering || this.attackCommitted;
        if (this.bufJump > 0 && !jumpLocked) {
          if (grounded || this.coyote > 0) {
            this.bufJump = 0;
            if (dashOnly) this.capHorizontal(this.runSpeed * MOVE.dashJumpCarry);
            this.vel.y = this.st.jumpVel;
            this.grounded = false;
            this.coyote = 0;
            this.setMode('air');
            this.events.push({ type: 'jump' });
          } else if (this.airJumps > 0 && !dashOnly) {
            this.bufJump = 0;
            this.airJumps--;
            this.vel.y = this.st.airJumpVel;
            this.events.push({ type: 'airjump' });
          }
        }
        // --- hover (hold jump while falling) ---
        if (!this.grounded && inp.jumpHeld && this.vel.y <= 0.5 && this.hoverFuel > 0 && (this.airJumps === 0 || !this.jumpHeldSincePress || this.modeTime > 0.25)) {
          this.hovering = true;
          this.hoverFuel -= dt;
        }

        // --- gun ---
        if (gun.holdMax) {
          // hold-to-charge gun: press starts charging, release fires
          if (this.holdT < 0 && this.bufGun > 0 && this.gunCd <= 0 && !recovering && this.bombLockT <= 0) {
            this.bufGun = 0;
            this.holdT = 0;
            this.events.push({ type: 'railCharge' });
          }
          if (this.holdT >= 0) {
            this.holdT += dt;
            this.aimHold = Math.max(this.aimHold, 0.3);
            this.railCharge = this.holdFrac;
            const release = !inp.gunHeld && this.holdT >= (gun.holdMin ?? 0);
            if (release || this.holdT >= gun.holdMax + 0.5) {
              const power = (gun.holdMinFrac ?? 0.3) + (1 - (gun.holdMinFrac ?? 0.3)) * this.holdFrac;
              this.fireShot(!grounded, power);
              this.holdT = -1;
              this.railCharge = 0;
              // same air penalty as burst guns
              this.gunCd = gun.cooldown * (grounded ? 1 : 1.15);
            }
          }
        } else if (this.bufGun > 0 && this.gunCd <= 0 && this.burstLeft === 0 && !recovering && this.bombLockT <= 0) {
          this.bufGun = 0;
          this.burstLeft = gun.burst;
          this.shotTimer = gun.windup * this.st.gunWindupMul;
          this.shotIndex = 0;
          if (gun.windup > 0) this.events.push({ type: 'railCharge' });
        }
        if (this.bufBomb > 0 && this.bombCd <= 0 && !recovering && !this.attackCommitted) {
          this.bufBomb = 0;
          this.bombCd = this.lo.bomb.cooldown;
          this.bombLockT = grounded ? 0.32 : 0.26;
          this.recoveryTime = 0.26;
          this.aimHold = Math.max(this.aimHold, 0.35);
          this.spawns.push({ kind: 'bomb' });
          this.events.push({ type: 'bomb' });
        }
        // --- skill shot: released aim (or quick-cast), short telegraphed cast, then a straight shot ---
        if (this.bufSkill > 0 && this.skillCd <= 0 && !recovering && !this.attackCommitted && this.bombLockT <= 0) {
          this.bufSkill = 0;
          const sk = this.lo.skill;
          this.skillCd = sk.cooldown;
          this.castT = sk.cast;
          this.castTarget = this.skillTarget ?? null;
          this.yaw = this.castTarget ? Math.atan2(this.castTarget[0] - this.pos.x, this.castTarget[2] - this.pos.z) : yawToTarget;
          this.stats.skillCasts++;
          this.events.push({ type: 'skillCast' });
        }
        if (this.castT >= 0) {
          this.castT -= dt;
          if (this.castT <= 0) {
            this.castT = -1;
            this.recoveryTime = Math.max(this.recoveryTime, this.lo.skill.recovery);
            this.aimHold = Math.max(this.aimHold, 0.3);
            this.spawns.push({ kind: 'skill', target: this.castTarget });
            this.events.push({ type: 'skill' });
          }
        }
        if (this.bufPod > 0 && this.podCd <= 0 && !recovering && !this.attackCommitted && this.bombLockT <= 0) {
          this.bufPod = 0;
          this.podCd = this.lo.pod.cooldown;
          this.bombLockT = Math.max(this.bombLockT, 0.28);
          this.recoveryTime = 0.22;
          this.spawns.push({ kind: 'pod' });
          this.events.push({ type: 'pod' });
        }

        // --- movement ---
        // Attack commitments cap speed; the cap eases in over MOVE.capEase but lands on the same value.
        let attackCap = 1;
        if (this.fireSlowT > 0) attackCap = gun.groundSlow;
        if (this.burstLeft > 0 && gun.windup > 0) attackCap = Math.min(attackCap, 0.12);
        if (this.holdT >= 0) attackCap = Math.min(attackCap, 0.35);
        if (this.bombLockT > 0 && grounded) attackCap = Math.min(attackCap, 0.2);
        if (this.castT >= 0) attackCap = Math.min(attackCap, 0.15);
        // action recovery (shots, bombs, pods, skills) still slows you; a plain dash recovery does not
        if (this.recoveryTime > this.dashExitT + 1e-9) attackCap = Math.min(attackCap, 0.55);
        const easeStep = dt / MOVE.capEase;
        this.moveCap = attackCap < this.moveCap ? Math.max(attackCap, this.moveCap - easeStep) : Math.min(attackCap, this.moveCap + easeStep);
        let speedMul = this.moveCap;
        // hard landing: a soft target, so the landing slides into the crouch instead of sticking
        if (this.landT > 0 && grounded) speedMul = Math.min(speedMul, 0.3);
        const max = this.runSpeed * speedMul;
        if (grounded) {
          this.groundMove(mv, moveLen, max, dt);
          // a committed attack's cap is a hard limit once eased in
          if (this.moveCap < 1) this.capHorizontal(this.runSpeed * this.moveCap);
        } else {
          this.planting = false;
          // An air dash still settles into a slower drift for its recovery, but bleeds there instead of snapping.
          const settle = this.dashExitAir && this.dashExitT > 0 && this.recoveryTime > 0;
          const airMul = settle ? Math.min(speedMul, 0.55) : speedMul;
          const airMax = this.runSpeed * (this.hovering ? 0.8 : 0.9) * airMul;
          const cur = Math.hypot(this.vel.x, this.vel.z);
          if (moveLen > 0.05) {
            const lim = airMul < 1 ? airMax : Math.max(airMax, cur * 0.985);
            this.approachXZ(mv.x * lim * moveLen, mv.z * lim * moveLen, (this.hovering ? 34 : 26) * this.st.airControl * dt);
          } else this.applyFriction(dt, 3);
          // Releasing the stick must not preserve fast aerial carry through a committed shot.
          const carried = Math.hypot(this.vel.x, this.vel.z);
          if (airMul < 1 && carried > airMax) {
            const keep = speedMul < 1 ? airMax : Math.max(airMax, carried - MOVE.bleed * dt);
            this.vel.x *= keep / carried;
            this.vel.z *= keep / carried;
          }
        }
        // --- facing --- (weighty while running; aiming stays responsive so shots face the target promptly)
        let wantYaw = this.yaw;
        const attacking = this.burstLeft > 0 || this.aimHold > 0 || this.bombLockT > 0;
        const ct = this.castT >= 0 ? this.castTarget : null;
        if (ct) wantYaw = Math.atan2(ct[0] - this.pos.x, ct[2] - this.pos.z);
        else if (inp.faceTarget || (attacking && grounded)) wantYaw = yawToTarget;
        else if (moveLen > 0.1) wantYaw = Math.atan2(mv.x, mv.z);
        else if (attacking) wantYaw = yawToTarget;
        const aiming = ct || inp.faceTarget || attacking;
        const turn = !grounded || aiming ? this.aimTurnRate : (moveLen > 0.1 ? MOVE.turnRun : MOVE.turnIdle) / this.weight;
        this.turnToward(wantYaw, turn * dt);
        break;
      }
      case 'dash':
      case 'airdash': {
        const style = this.st.dashStyle;
        const dur = this.st.dashTime * (this.mode === 'airdash' ? 0.92 : 1);
        const sp = this.st.dashSpeed * PACE;
        const t = this.modeTime / dur;
        // speed profile per dash style
        let s: number;
        if (style === 'step') s = t < 0.5 ? sp * 1.05 : sp * (1 - (t - 0.5) / 0.5 * 0.85);
        else if (style === 'glide') s = sp * (1 - t * 0.25);
        else s = t < 0.65 ? sp : sp * (1 - ((t - 0.65) / 0.35) * 0.55);
        this.vel.x = this.dashDir.x * s;
        this.vel.z = this.dashDir.z * s;
        if (this.mode === 'airdash') this.vel.y = style === 'flight' ? Math.max(this.vel.y, 0.8) : Math.max(this.vel.y, -0.5);
        // dash-jump: a jump in the back half of a ground dash leaves with the dash's speed (capped)
        const dashJump = this.mode === 'dash' && controls && this.bufJump > 0 && t >= MOVE.dashJumpFrom && (this.grounded || this.coyote > 0);
        if (dashJump || this.modeTime >= dur) {
          // Carry the dash's velocity out; normal control (or air drift) bleeds it from here.
          this.capHorizontal(this.runSpeed * (dashJump ? MOVE.dashJumpCarry : MOVE.dashExitCarry));
          this.recoveryTime = DASH_RECOVERY;
          this.dashExitT = DASH_RECOVERY;
          this.dashExitAir = this.mode === 'airdash';
          if (dashJump) {
            this.bufJump = 0;
            this.vel.y = this.st.jumpVel;
            this.grounded = false;
            this.coyote = 0;
            this.setMode('air');
            this.events.push({ type: 'jump' });
          } else this.setMode(this.grounded ? 'ground' : 'air');
        }
        break;
      }
      case 'charge': {
        const ch = this.lo.body.charge;
        this.turnToward(yawToTarget, (this.chargePhase === 0 ? 4.5 : 1.2) * dt);
        if (this.chargePhase === 0) {
          this.applyFriction(dt, 60);
          if (!this.grounded) this.vel.y = Math.max(this.vel.y, -2);
          if (this.modeTime >= ch.windup * (this.wakeup ? 0.7 : 1)) {
            this.chargePhase = 1;
            this.modeTime = 0;
            this.events.push({ type: 'chargeLunge' });
          }
        } else if (this.chargePhase === 1) {
          const fx = Math.sin(this.yaw);
          const fz = Math.cos(this.yaw);
          const reach = this.wakeup ? 0.6 : 1;
          this.vel.x = fx * ch.speed * reach;
          this.vel.z = fz * ch.speed * reach;
          if (!this.grounded) this.vel.y = Math.max(this.vel.y, 0);
          if (this.modeTime >= ch.lunge || this.chargeHit) {
            this.chargePhase = 2;
            this.modeTime = 0;
            if (this.chargeHit) {
              this.vel.x *= -0.25;
              this.vel.z *= -0.25;
            }
          }
        } else {
          this.applyFriction(dt, 40);
          if (this.modeTime >= ch.recover) {
            this.chargeCd = this.st.chargeCooldown * (this.wakeup ? 1.3 : 1);
            this.wakeup = false;
            this.setMode(this.grounded ? 'ground' : 'air');
          }
        }
        break;
      }
      case 'stagger': {
        this.applyFriction(dt, this.grounded ? 22 : 2);
        if (this.modeTime >= this.staggerTime) this.setMode(this.grounded ? 'ground' : 'air');
        break;
      }
      case 'down': {
        if (this.grounded) {
          this.applyFriction(dt, 14);
          this.downGroundT += dt;
          if (this.downGroundT > 0.85 && this.alive) {
            this.setMode('getup');
            this.events.push({ type: 'getup' });
          }
        }
        break;
      }
      case 'getup': {
        this.applyFriction(dt, 40);
        // wake-up attack: charge out of the get-up (shorter reach, longer cooldown)
        if (controls && this.modeTime > 0.25 && this.bufCharge > 0 && this.chargeCd <= 0) {
          this.invuln = 0.3;
          this.down = 0;
          this.startCharge(yawToTarget, true);
          break;
        }
        if (this.modeTime >= 0.55) {
          this.invuln = 1.0;
          this.down = 0;
          this.setMode('ground');
        }
        break;
      }
      case 'intro':
      case 'victory':
      case 'defeat':
      case 'showcase':
        this.applyFriction(dt, 30);
        break;
    }
    if (this.mode !== 'ground' && this.mode !== 'air' && this.holdT >= 0) {
      // interrupted while charging the beam
      this.holdT = -1;
      this.railCharge = 0;
      this.gunCd = gun.cooldown * 0.5;
    }

    // ------------------------------------------------ gun burst
    if (this.burstLeft > 0 && (this.mode === 'ground' || this.mode === 'air' || this.mode === 'dash' || this.mode === 'airdash')) {
      this.shotTimer -= dt;
      const wu = gun.windup * this.st.gunWindupMul;
      this.railCharge = wu > 0 ? Math.min(1, 1 - this.shotTimer / wu) : 0;
      this.aimHold = Math.max(this.aimHold, 0.45);
      if (this.shotTimer <= 0 && this.mode !== 'dash' && this.mode !== 'airdash') {
        const air = !this.grounded;
        this.fireShot(air, 1);
        this.burstLeft--;
        // air vs ground trade-off: slower bursts in the air
        this.shotTimer = gun.burstInterval * (air ? 1.25 : 1);
        this.railCharge = 0;
        if (this.burstLeft === 0) this.gunCd = gun.cooldown * (air ? 1.15 : 1);
      }
    } else if (this.burstLeft > 0 && this.mode !== 'ground' && this.mode !== 'air') {
      // interrupted (hit / charge): cancel the burst
      this.burstLeft = 0;
      this.railCharge = 0;
      this.gunCd = gun.cooldown * 0.5;
    }
    this.aimWeight = this.aimHold > 0 ? 1 : 0;

    // ------------------------------------------------ physics
    const gScale = this.mode === 'airdash' ? 0 : this.hovering ? 0 : this.mode === 'charge' && this.chargePhase < 2 ? 0.25 : 1;
    if (this.hovering) this.vel.y += (-0.9 - this.vel.y) * Math.min(1, dt * 10);
    const fall = this.vel.y < 0 ? this.st.fallMul : 1;
    this.vel.y -= GRAVITY * gScale * fall * dt;
    if (this.mode === 'down' && !this.grounded) this.vel.y -= GRAVITY * 0.2 * dt;
    this.vel.y = Math.max(this.vel.y, -30);
    // ride moving platforms
    const gv = this.groundCollider && this.groundCollider.kind === 'box' ? this.groundCollider.vel : undefined;
    if (this.grounded && gv) this.pos.addScaledVector(gv, dt);

    const wasGrounded = this.grounded;
    const r = moveAndCollide(this.pos, this.vel, dt, RADIUS, HEIGHT, colliders, wasGrounded, halfX, halfZ);
    this.grounded = r.grounded;
    this.groundCollider = r.ground;
    if (r.grounded && !wasGrounded) {
      this.resetAir();
      if (this.mode === 'air') this.setMode('ground');
      const hard = r.landSpeed > HARD_LANDING && this.mode === 'ground';
      if (hard) this.landT = this.st.landingLag * Math.min(2, r.landSpeed / 18);
      if (this.mode !== 'down' || r.landSpeed > 4) this.events.push({ type: 'land', speed: r.landSpeed, hard });
      if (this.mode === 'down') this.downGroundT = 0;
    }
    if (!r.grounded && wasGrounded && this.mode === 'ground') this.setMode('air');
    if (r.grounded) this.hoverFuel = this.maxHover;
  }

  private dashRecharge() {
    return this.st.dashCooldown * (this.st.dashCharges > 1 ? 1.65 : 1);
  }

  private fireShot(air: boolean, power: number) {
    this.spawns.push({ kind: 'shot', index: this.shotIndex, air, power });
    this.events.push({ type: 'fire', index: this.shotIndex });
    this.stats.shots++;
    this.shotIndex++;
    this.fireSlowT = this.lo.gun.recovery;
    this.recoveryTime = Math.max(this.recoveryTime, this.lo.gun.recovery);
  }

  private staggerTime = 0.2;

  /** Charge-attack melee check against the opponent. Returns a hit to apply, if any. */
  meleeCheck(target: Fighter): HitInfo | null {
    if (this.mode !== 'charge' || this.chargePhase !== 1 || this.chargeHit) return null;
    const dx = target.pos.x - this.pos.x;
    const dz = target.pos.z - this.pos.z;
    const dy = target.pos.y - this.pos.y;
    const d = Math.hypot(dx, dz);
    if (d > 1.75 || Math.abs(dy) > 1.6) return null;
    // must be roughly in front
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    if ((dx * fx + dz * fz) / (d || 1) < 0.2) return null;
    if (target.isInvulnerable) return null;
    this.chargeHit = true;
    const ch = this.lo.body.charge;
    const k = this.wakeup ? 0.5 : 1;
    return {
      damage: ch.damage * k, down: ch.down * k, dir: new THREE.Vector3(fx, 0, fz), knock: 9, heavy: true, source: 'charge',
    };
  }

  /** Once per dash: a small cooldown rebate rewards timing without an infinite reset loop. */
  perfectDodge() {
    this.clearPrimer('dodge');
    if (this.dodgeAwarded) return false;
    this.dodgeAwarded = true;
    this.gunCd = Math.max(0, this.gunCd - 0.25);
    this.dashCd = Math.max(0.25, this.dashCd - 0.2);
    this.stats.dodges++;
    return true;
  }

  /** Stagger caused by an opponent's parry. */
  parriedBy() {
    this.burstLeft = 0;
    this.holdT = -1;
    this.railCharge = 0;
    this.staggerTime = 0.6;
    this.setMode('stagger');
    this.vel.multiplyScalar(-0.3);
  }

  /** Hazard cooldown so a zone hits at most once per eruption. */
  canHazardHit() {
    return this.hazardCd <= 0;
  }
  markHazard() {
    this.hazardCd = 1.0;
  }

  takeHit(h: HitInfo): HitResult {
    const out: HitResult = { applied: false, knockdown: false, ko: false, damage: 0 };
    if (this.isInvulnerable || !this.alive) return out;
    out.applied = true;
    const frontal = this.facesIncoming(h.dir);
    const guardable = frontal && h.source !== 'charge' && h.source !== 'hazard' && h.source !== 'fire';
    // a perfect parry beats everything an opponent throws at you, including their charge attack
    const parryable = frontal && h.source !== 'hazard' && h.source !== 'fire' && !h.guardBreak;
    if (this.parrying && parryable) {
      this.clearPrimer('parry');
      out.parried = true;
      this.stats.parries++;
      this.events.push({ type: 'parry' });
      return out;
    }
    if (this.guarding && guardable && h.guardBreak) {
      // direct bomb hit on a guard: the guard shatters
      out.guardBroken = true;
      h = { ...h, down: h.down + 30 };
      this.events.push({ type: 'guardBreak' });
    } else if (this.guarding && guardable) {
      if (h.source === 'gun') this.clearPrimer('guard');
      h = { ...h, damage: h.damage * 0.3 * this.st.guardChipMul, down: h.down * 0.25 };
      out.blocked = true;
    }
    // pick-up shield absorbs damage first
    let dmgIn = h.damage;
    if (this.buffs.shield > 0) {
      const a = Math.min(this.buffs.shield, dmgIn);
      this.buffs.shield -= a;
      dmgIn -= a;
    }
    const willKnock = !out.blocked && this.down + h.down >= this.endurance;
    const ordinaryDamage = dmgIn * (willKnock ? KNOCKDOWN_BONUS : 1);
    if (h.comboBonus && this.primer?.armed && !out.blocked && !out.parried && dmgIn > 0) {
      // Fixed additive payoff after defense, not another damage multiplier.
      const total = ordinaryDamage + Math.min(h.comboBonus, comboBonus(dmgIn));
      out.comboDetonated = true;
      out.comboBonus = Math.max(0, Math.min(this.hp, Math.round(total)) - Math.min(this.hp, Math.round(ordinaryDamage)));
      this.clearPrimer('consumed');
      dmgIn = total;
    } else dmgIn = ordinaryDamage;
    const dmg = Math.round(dmgIn);
    this.hp = Math.max(0, this.hp - dmg);
    out.damage = dmg;
    this.down += h.down;
    this.sinceHit = 0;
    const armored = this.mode === 'charge' && this.chargePhase === 1 && this.lo.body.charge.armor && h.source !== 'charge' && !h.heavy;
    if (this.hp <= 0) {
      out.ko = true;
      this.knockdown(h, 1.4);
      return out;
    }
    if (this.down >= this.endurance) {
      out.knockdown = true;
      this.stats.knockdownsTaken++;
      this.knockdown(h, 1);
      return out;
    }
    // Low-impact small arms pressure HP/down but cannot repeatedly erase a committed attack.
    // Heavy shots and accumulated down still create real punish windows.
    if (h.tick || h.source === 'gun' && !h.heavy && h.down <= 12) return out;
    this.hitstop = 0;
    if ((armored || out.blocked) && !out.guardBroken) return out;
    // flinch
    const k = h.knock * this.st.knockMul;
    this.vel.x = h.dir.x * k + this.vel.x * 0.2;
    this.vel.z = h.dir.z * k + this.vel.z * 0.2;
    if (h.launch) {
      this.vel.y = h.launch;
      this.grounded = false;
    } else if (!this.grounded) this.vel.y = Math.max(this.vel.y, h.heavy ? 3 : 1);
    if (out.guardBroken) {
      this.staggerTime = 0.7;
      this.setMode('stagger');
    } else if (h.heavy || h.launch) {
      this.staggerTime = h.launch ? 0.5 : 0.34;
      this.setMode('stagger');
    } else if (this.mode === 'ground' || this.mode === 'air') {
      this.staggerTime = 0.12;
      this.setMode('stagger');
    }
    return out;
  }

  private knockdown(h: HitInfo, mul: number) {
    this.burstLeft = 0;
    this.holdT = -1;
    this.railCharge = 0;
    this.hovering = false;
    this.hitstop = 0;
    this.setMode('down');
    this.downGroundT = 0;
    this.grounded = false;
    const w = this.st.knockMul;
    this.vel.set(h.dir.x * 7.5 * w * mul, (h.launch ? Math.max(h.launch, 9) : 9.5) * mul, h.dir.z * 7.5 * w * mul);
    this.pos.y += 0.05;
    this.down = 0;
    this.events.push({ type: 'knockdown' });
  }

  /**
   * Weighted ground locomotion (see MOVE): eased acceleration, a coasting stop, a hard
   * "plant" on reversals, and overspeed bleed, all scaled by the build's movement weight.
   */
  private groundMove(mv: THREE.Vector3, moveLen: number, max: number, dt: number) {
    const w = this.weight;
    const cur = Math.hypot(this.vel.x, this.vel.z);
    const run = Math.max(1e-3, this.runSpeed);
    let rate: number;
    let plant = false;
    if (moveLen > 0.05) {
      const dot = cur > 0.5 ? (this.vel.x * mv.x + this.vel.z * mv.z) / cur : 1;
      if (dot < MOVE.plantDot) {
        plant = true;
        rate = MOVE.plant * run;
      } else if (cur > max + 1e-3) {
        // above the current cap (dash carry, slowed): bleed, steering with turn grip
        rate = Math.max(MOVE.bleed, MOVE.accel * run * MOVE.top * (1 + MOVE.turnGrip * (1 - dot)));
      } else {
        const frac = Math.min(1, cur / run);
        rate = MOVE.accel * run * (MOVE.launch + (MOVE.top - MOVE.launch) * frac) * (1 + MOVE.turnGrip * (1 - dot));
      }
    } else rate = cur > max + 1e-3 && max > 0 ? MOVE.bleed : MOVE.brake * run;
    if (plant && !this.planting && cur > MOVE.skidSpeed * run) this.events.push({ type: 'skid', speed: cur });
    this.planting = plant;
    this.approachXZ(mv.x * max * moveLen, mv.z * max * moveLen, (rate / w) * dt);
  }

  /** Clamp horizontal speed without changing direction. */
  private capHorizontal(limit: number) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > limit && sp > 1e-9) {
      this.vel.x *= limit / sp;
      this.vel.z *= limit / sp;
    }
  }

  private approachXZ(tx: number, tz: number, maxDelta: number) {
    const dx = tx - this.vel.x;
    const dz = tz - this.vel.z;
    const d = Math.hypot(dx, dz);
    if (d <= maxDelta || d < 1e-6) {
      this.vel.x = tx;
      this.vel.z = tz;
    } else {
      this.vel.x += (dx / d) * maxDelta;
      this.vel.z += (dz / d) * maxDelta;
    }
  }

  private applyFriction(dt: number, k: number) {
    this.approachXZ(0, 0, k * dt);
  }

  private turnToward(yaw: number, maxStep: number) {
    let d = yaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += THREE.MathUtils.clamp(d, -maxStep, maxStep);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }
}

