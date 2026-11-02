import * as THREE from 'three';
import type { ResolvedLoadout } from '../data/parts';
import type { AnimMode, AnimSource } from '../robot/animator';
import { moveAndCollide } from './collision';
import type { Collider } from '../arena/types';

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
const DOWN_MAX = 100;

export type FighterEvent =
  | { type: 'jump' } | { type: 'airjump' } | { type: 'dash'; air: boolean } | { type: 'land'; speed: number }
  | { type: 'fire'; index: number } | { type: 'railCharge' } | { type: 'bomb' } | { type: 'pod' }
  | { type: 'chargeStart' } | { type: 'chargeLunge' } | { type: 'knockdown' } | { type: 'getup' }
  | { type: 'hover'; on: boolean };

export interface HitInfo {
  damage: number;
  down: number;
  dir: THREE.Vector3;
  knock: number;
  heavy: boolean;
  /** Launch upward (m/s), e.g. hazards. */
  launch?: number;
  source: 'gun' | 'bomb' | 'pod' | 'charge' | 'hazard';
}

export interface HitResult {
  applied: boolean;
  /** Absorbed by a charge guard (reduced damage, no flinch). */
  blocked?: boolean;
  knockdown: boolean;
  ko: boolean;
  damage: number;
}

export class Fighter implements AnimSource {
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
  dashCd = 0;
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
  dashIframe = 0;
  /** AI handicaps (player = 1 / 0). */
  homingMul = 1;
  aimJitter = 0;

  readonly events: FighterEvent[] = [];
  /** Requests for the world to spawn projectiles etc. */
  readonly spawns: ({ kind: 'shot'; index: number } | { kind: 'bomb' } | { kind: 'pod' })[] = [];

  // stats
  stats = { damageDealt: 0, hits: 0, knockdowns: 0, shots: 0, dodges: 0 };

  constructor(readonly id: number, readonly lo: ResolvedLoadout) {
    this.maxHp = this.hp = lo.body.hp;
    this.resetAir();
  }

  get alive() {
    return this.hp > 0;
  }
  get runSpeed() {
    return this.lo.body.runSpeed * this.lo.legs.speedMul * PACE;
  }
  /** Brief invulnerability at the start of a dash (perfect-dodge window). */
  get dodging() {
    return this.dashIframe > 0;
  }
  /** Charging robots guard: front shots deflect, blasts only chip. */
  get guarding() {
    return this.mode === 'charge' && this.chargePhase < 2;
  }
  get canAct() {
    return !this.locked && (this.mode === 'ground' || this.mode === 'air');
  }
  get isInvulnerable() {
    return this.invuln > 0 || this.mode === 'down' || this.mode === 'getup';
  }
  get maxHover() {
    return this.lo.body.hoverTime * this.lo.legs.hoverMul;
  }

  private resetAir() {
    this.airJumps = this.lo.legs.airJumps;
    this.airDashes = this.lo.legs.airDashes;
    this.hoverFuel = this.maxHover;
  }

  setMode(m: AnimMode) {
    this.mode = m;
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

  step(dt: number, inp: FighterInput, target: Fighter, colliders: Collider[], halfX: number, halfZ: number) {
    this.events.length = 0;
    this.spawns.length = 0;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;
    }
    this.modeTime += dt;
    this.sinceHit += dt;
    for (const k of ['gunCd', 'bombCd', 'podCd', 'chargeCd', 'dashCd', 'invuln', 'hazardCd'] as const) this[k] = Math.max(0, this[k] - dt);
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
    this.bufGun = buf(this.bufGun, inp.gunPressed || (inp.gunHeld && this.burstLeft === 0));
    this.bufBomb = buf(this.bufBomb, inp.bombPressed);
    this.bufPod = buf(this.bufPod, inp.podPressed);
    this.bufCharge = buf(this.bufCharge, inp.chargePressed);
    if (inp.jumpPressed) this.jumpHeldSincePress = true;
    if (!inp.jumpHeld) this.jumpHeldSincePress = false;

    const tgt = target.chestPoint();
    this.aimTarget = tgt;
    const toT = new THREE.Vector3(tgt.x - this.pos.x, 0, tgt.z - this.pos.z);
    const distT = toT.length();
    const yawToTarget = Math.atan2(toT.x, toT.z);

    const moveLen = Math.min(1, Math.hypot(inp.moveX, inp.moveZ));
    const mv = new THREE.Vector3(inp.moveX, 0, inp.moveZ);
    if (moveLen > 0.001) mv.normalize();
    const controls = live && this.alive;

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
        // --- dash ---
        if (this.bufDash > 0 && this.dashCd <= 0 && (grounded || this.airDashes > 0)) {
          this.bufDash = 0;
          const dir = moveLen > 0.2 ? mv.clone() : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          this.dashDir.copy(dir);
          const air = !grounded;
          if (air) this.airDashes--;
          this.setMode(air ? 'airdash' : 'dash');
          const sp = this.lo.body.dashSpeed * this.lo.legs.dashMul * PACE;
          this.dashIframe = 0.16;
          this.vel.set(dir.x * sp, air ? 0.5 : 0, dir.z * sp);
          if (inp.faceTarget || this.aimHold > 0) this.yaw = yawToTarget;
          else this.yaw = Math.atan2(dir.x, dir.z);
          this.dashCd = 0.42;
          this.events.push({ type: 'dash', air });
          break;
        }
        // --- charge attack ---
        if (this.bufCharge > 0 && this.chargeCd <= 0) {
          this.bufCharge = 0;
          this.setMode('charge');
          this.chargePhase = 0;
          this.chargeHit = false;
          this.yaw = yawToTarget;
          this.events.push({ type: 'chargeStart' });
          break;
        }
        // --- jump / air jump ---
        if (this.bufJump > 0) {
          if (grounded || this.coyote > 0) {
            this.bufJump = 0;
            this.vel.y = this.lo.body.jumpVel * this.lo.legs.jumpMul;
            this.grounded = false;
            this.coyote = 0;
            this.setMode('air');
            this.events.push({ type: 'jump' });
          } else if (this.airJumps > 0) {
            this.bufJump = 0;
            this.airJumps--;
            this.vel.y = this.lo.body.airJumpVel * this.lo.legs.jumpMul;
            this.events.push({ type: 'airjump' });
          }
        }
        // --- hover (hold jump while falling) ---
        if (!this.grounded && inp.jumpHeld && this.vel.y <= 0.5 && this.hoverFuel > 0 && (this.airJumps === 0 || !this.jumpHeldSincePress || this.modeTime > 0.25)) {
          this.hovering = true;
          this.hoverFuel -= dt;
        }

        // --- weapons ---
        const gun = this.lo.gun;
        if (this.bufGun > 0 && this.gunCd <= 0 && this.burstLeft === 0) {
          this.bufGun = 0;
          this.burstLeft = gun.burst;
          this.shotTimer = gun.windup;
          this.shotIndex = 0;
          if (gun.windup > 0) this.events.push({ type: 'railCharge' });
        }
        if (this.bufBomb > 0 && this.bombCd <= 0) {
          this.bufBomb = 0;
          this.bombCd = this.lo.bomb.cooldown;
          this.bombLockT = grounded ? 0.28 : 0.12;
          this.aimHold = Math.max(this.aimHold, 0.35);
          this.spawns.push({ kind: 'bomb' });
          this.events.push({ type: 'bomb' });
        }
        if (this.bufPod > 0 && this.podCd <= 0) {
          this.bufPod = 0;
          this.podCd = this.lo.pod.cooldown;
          this.bombLockT = Math.max(this.bombLockT, 0.2);
          this.spawns.push({ kind: 'pod' });
          this.events.push({ type: 'pod' });
        }

        // --- movement ---
        let speedMul = 1;
        if (this.fireSlowT > 0 && grounded) speedMul = gun.groundSlow + (1 - gun.groundSlow) * 0.15;
        if (this.burstLeft > 0 && gun.windup > 0 && grounded) speedMul = Math.min(speedMul, 0.25);
        if (this.bombLockT > 0 && grounded) speedMul = Math.min(speedMul, 0.2);
        const max = this.runSpeed * speedMul;
        if (grounded) {
          const accel = moveLen > 0.05 ? 95 : 75;
          this.approachXZ(mv.x * max * moveLen, mv.z * max * moveLen, accel * dt);
        } else {
          const airMax = this.runSpeed * (this.hovering ? 0.85 : 0.95);
          const cur = Math.hypot(this.vel.x, this.vel.z);
          if (moveLen > 0.05) {
            const lim = Math.max(airMax, cur * 0.985);
            this.approachXZ(mv.x * lim * moveLen, mv.z * lim * moveLen, (this.hovering ? 34 : 26) * dt);
          } else this.applyFriction(dt, 3);
        }
        // --- facing ---
        let wantYaw = this.yaw;
        const attacking = this.burstLeft > 0 || this.aimHold > 0 || this.bombLockT > 0;
        if (inp.faceTarget || (attacking && grounded)) wantYaw = yawToTarget;
        else if (moveLen > 0.1) wantYaw = Math.atan2(mv.x, mv.z);
        else if (attacking) wantYaw = yawToTarget;
        this.turnToward(wantYaw, (grounded ? 22 : 10) * dt);
        break;
      }
      case 'dash':
      case 'airdash': {
        const dur = this.mode === 'dash' ? 0.26 : 0.24;
        const sp = this.lo.body.dashSpeed * this.lo.legs.dashMul * PACE;
        const t = this.modeTime / dur;
        // hold speed then ease out at the end of the dash
        const s = t < 0.65 ? sp : sp * (1 - (t - 0.65) / 0.35 * 0.55);
        this.vel.x = this.dashDir.x * s;
        this.vel.z = this.dashDir.z * s;
        if (this.mode === 'airdash') this.vel.y = Math.max(this.vel.y, -0.5);
        // allow guns during dash (fires on exit) — keep buffers alive
        if (this.modeTime >= dur) {
          this.vel.x *= 0.5;
          this.vel.z *= 0.5;
          this.setMode(this.grounded ? 'ground' : 'air');
        }
        break;
      }
      case 'charge': {
        const ch = this.lo.body.charge;
        this.turnToward(yawToTarget, (this.chargePhase === 0 ? 30 : 4) * dt);
        if (this.chargePhase === 0) {
          this.applyFriction(dt, 60);
          if (!this.grounded) this.vel.y = Math.max(this.vel.y, -2);
          if (this.modeTime >= ch.windup) {
            this.chargePhase = 1;
            this.modeTime = 0;
            this.events.push({ type: 'chargeLunge' });
          }
        } else if (this.chargePhase === 1) {
          const fx = Math.sin(this.yaw);
          const fz = Math.cos(this.yaw);
          this.vel.x = fx * ch.speed;
          this.vel.z = fz * ch.speed;
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
            this.chargeCd = ch.cooldown;
            this.setMode(this.grounded ? 'ground' : 'air');
          }
        }
        break;
      }
      case 'stagger': {
        this.applyFriction(dt, this.grounded ? 22 : 2);
        if (this.modeTime >= (this.mode === 'stagger' ? this.staggerTime : 0)) this.setMode(this.grounded ? 'ground' : 'air');
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

    // ------------------------------------------------ gun burst
    if (this.burstLeft > 0 && (this.mode === 'ground' || this.mode === 'air' || this.mode === 'dash' || this.mode === 'airdash')) {
      const gun = this.lo.gun;
      this.shotTimer -= dt;
      this.railCharge = gun.windup > 0 ? Math.min(1, 1 - this.shotTimer / gun.windup) : 0;
      this.aimHold = Math.max(this.aimHold, 0.45);
      if (this.shotTimer <= 0 && this.mode !== 'dash' && this.mode !== 'airdash') {
        this.spawns.push({ kind: 'shot', index: this.shotIndex });
        this.events.push({ type: 'fire', index: this.shotIndex });
        this.stats.shots++;
        this.shotIndex++;
        this.burstLeft--;
        this.shotTimer = gun.burstInterval;
        this.fireSlowT = 0.22;
        this.railCharge = 0;
        if (this.burstLeft === 0) this.gunCd = gun.cooldown;
      }
    } else if (this.burstLeft > 0 && this.mode !== 'ground' && this.mode !== 'air') {
      // interrupted (hit / charge): cancel the burst
      this.burstLeft = 0;
      this.railCharge = 0;
      this.gunCd = this.lo.gun.cooldown * 0.5;
    }
    this.aimWeight = this.aimHold > 0 ? 1 : 0;

    // ------------------------------------------------ physics
    const gScale = this.mode === 'airdash' ? 0 : this.hovering ? 0 : this.mode === 'charge' && this.chargePhase < 2 ? 0.25 : 1;
    if (this.hovering) this.vel.y += (-0.9 - this.vel.y) * Math.min(1, dt * 10);
    this.vel.y -= GRAVITY * gScale * dt;
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
      if (this.mode !== 'down' || r.landSpeed > 4) this.events.push({ type: 'land', speed: r.landSpeed });
      if (this.mode === 'down') this.downGroundT = 0;
    }
    if (!r.grounded && wasGrounded && this.mode === 'ground') this.setMode('air');
    if (r.grounded) this.hoverFuel = this.maxHover;
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
    return {
      damage: ch.damage, down: ch.down, dir: new THREE.Vector3(fx, 0, fz), knock: 9, heavy: true, source: 'charge',
    };
  }

  /** Reward for a perfect dodge: guns and dash come straight back. */
  perfectDodge() {
    this.gunCd = 0;
    this.dashCd = 0;
    this.stats.dodges++;
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
    const guard = this.guarding && h.source !== 'charge' && h.source !== 'hazard';
    if (guard) {
      h = { ...h, damage: h.damage * 0.3, down: h.down * 0.25 };
      out.blocked = true;
    }
    const dmg = Math.round(h.damage);
    this.hp = Math.max(0, this.hp - dmg);
    out.damage = dmg;
    this.down += h.down;
    this.sinceHit = 0;
    const armored = this.mode === 'charge' && this.chargePhase === 1 && this.lo.body.charge.armor && h.source !== 'charge' && !h.heavy;
    const weight = this.lo.body.weight;
    if (this.hp <= 0) {
      out.ko = true;
      this.knockdown(h, 1.4);
      return out;
    }
    if (this.down >= DOWN_MAX) {
      out.knockdown = true;
      this.stats.knockdowns++;
      this.knockdown(h, 1);
      return out;
    }
    this.hitstop = h.heavy ? 0.07 : 0.035;
    if (armored || guard) return out;
    // flinch
    const k = h.knock * weight;
    this.vel.x = h.dir.x * k + this.vel.x * 0.2;
    this.vel.z = h.dir.z * k + this.vel.z * 0.2;
    if (h.launch) {
      this.vel.y = h.launch;
      this.grounded = false;
    } else if (!this.grounded) this.vel.y = Math.max(this.vel.y, h.heavy ? 3 : 1);
    if (h.heavy || h.launch) {
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
    this.railCharge = 0;
    this.hovering = false;
    this.hitstop = 0.09;
    this.setMode('down');
    this.downGroundT = 0;
    this.grounded = false;
    const w = this.lo.body.weight;
    this.vel.set(h.dir.x * 7.5 * w * mul, (h.launch ? Math.max(h.launch, 9) : 9.5) * mul, h.dir.z * 7.5 * w * mul);
    this.pos.y += 0.05;
    this.down = 0;
    this.events.push({ type: 'knockdown' });
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
