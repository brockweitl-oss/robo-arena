import * as THREE from 'three';
import { plannedBomb } from './bombAim';
import { Fighter, type FighterInput, type HitInfo, type SpawnReq, GRAVITY } from './fighter';
import type { ArenaBuild, BoxCollider } from '../arena/types';
import type { BombDef, PodDef } from '../data/parts';
import { segmentHit, pointInSolid, groundHeightBelow } from './collision';
import { TACTICS, CRATE, TRAP, PICKUP, PICKUP_KINDS, PICKUP_EFFECT, type PickupKind } from './tactics';
import { comboBonus, type PrimerClearReason } from './combos';

export const SIM_DT = 1 / 60;
const BOMB_G = 22;
/** Global damage tuning knob (round length). */
export const DAMAGE_SCALE = 0.6;
/** Deterministic weapon accuracy; aerial commitment is paid through recovery and reload, never random misses. */

/** Per-shot ballistic parameters (guns, turret shots, deflected shots). */
export interface ShotSpec {
  damage: number;
  down: number;
  speed: number;
  homing: number;
  homingTime: number;
  homingDelay: number;
  life: number;
  radius: number;
  color: number;
  coreColor: number;
  knockback: number;
  pierce: boolean;
  comboDetonator?: boolean;
  /** Visual style key for effects. */
  look: 'blaster' | 'rail' | 'scatter' | 'beam' | 'homer' | 'turret' | 'lance' | 'wave' | 'hook' | 'frost';
  /** Aimed skill shot (stats/telemetry; never homes). */
  skill?: boolean;
  /** Harpoon: pull the victim toward the shooter at this speed (m/s). */
  pull?: number;
  /** Chill the victim for this long (seconds). */
  slow?: number;
}

export interface Projectile {
  id: number;
  owner: number;
  spec: ShotSpec;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  alive: boolean;
  nearMissed: boolean;
  /** Passed through a dodging target; can't hit it any more. */
  passed: boolean;
  homingMul: number;
  deflected: boolean;
}

export interface Bomb {
  id: number;
  owner: number;
  def: BombDef;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  bounces: number;
  age: number;
  alive: boolean;
  spin: THREE.Vector3;
  /** Predicted landing point (for the ground telegraph). */
  target: THREE.Vector3;
}

export interface Pod {
  id: number;
  owner: number;
  def: PodDef;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  hp: number;
  alive: boolean;
  triggeredAt: number;
  heading: number;
  /** Turret / interceptor action timer. */
  actT: number;
}

export interface FireZone {
  id: number;
  owner: number;
  pos: THREE.Vector3;
  radius: number;
  until: number;
  nextTick: number;
  def: NonNullable<BombDef['fire']>;
  color: number;
}

export interface Crate {
  id: number;
  collider: BoxCollider;
  pos: THREE.Vector3;
  hp: number;
  alive: boolean;
}

export interface Trap {
  index: number;
  pos: THREE.Vector3;
  sw: THREE.Vector3;
  /** Time the trap was triggered (-1 idle). */
  armedAt: number;
  readyAt: number;
  owner: number;
}

export interface Pickup {
  id: number;
  kind: PickupKind;
  pos: THREE.Vector3;
  until: number;
}

export interface WorldOptions {
  arenaId?: string;
  /** Enable the pick-ups mode. */
  pickups?: boolean;
  /** Enable crates and trap switches (default true). */
  tactics?: boolean;
  seed?: number;
}

export type GameEvent =
  | { type: 'prime'; victim: number; attacker: number; pos: THREE.Vector3; duration: number }
  | { type: 'combo'; victim: number; attacker: number; primerOwner: number; pos: THREE.Vector3; bonus: number }
  | { type: 'primerClear'; victim: number; attacker: number; pos: THREE.Vector3; reason: PrimerClearReason }
  | { type: 'fighter'; who: number; ev: Fighter['events'][number]; pos: THREE.Vector3 }
  | { type: 'shot'; who: number; proj: Projectile; index: number }
  | { type: 'bombLaunch'; who: number; bomb: Bomb }
  | { type: 'bombBounce'; bomb: Bomb }
  | { type: 'podLaunch'; who: number; pod: Pod }
  | { type: 'podTrigger'; pod: Pod }
  | { type: 'impact'; pos: THREE.Vector3; normal: THREE.Vector3; color: number; proj: Projectile }
  | { type: 'explosion'; pos: THREE.Vector3; radius: number; color: number; big: boolean; onGround: boolean }
  | { type: 'hit'; victim: number; attacker: number; pos: THREE.Vector3; dir: THREE.Vector3; damage: number; heavy: boolean; knockdown: boolean; ko: boolean; blocked: boolean; parried: boolean; guardBroken: boolean; source: HitInfo['source']; color: number; skillLook?: ShotSpec['look']; skillReflected?: boolean }
  | { type: 'dodge'; who: number; pos: THREE.Vector3; perfect: boolean }
  | { type: 'deflect'; who: number; pos: THREE.Vector3; color: number; parry: boolean }
  | { type: 'clash'; pos: THREE.Vector3 }
  | { type: 'hazard'; index: number; pos: THREE.Vector3 }
  | { type: 'fireStart'; zone: FireZone }
  | { type: 'intercept'; who: number; from: THREE.Vector3; to: THREE.Vector3 }
  | { type: 'turretShot'; pod: Pod; proj: Projectile }
  | { type: 'crateHit'; crate: Crate; pos: THREE.Vector3 }
  | { type: 'crateBreak'; crate: Crate }
  | { type: 'trapArm'; trap: Trap; by: number }
  | { type: 'trapFire'; trap: Trap }
  | { type: 'pickupSpawn'; pickup: Pickup }
  | { type: 'pickupTake'; pickup: Pickup; who: number }
  | { type: 'ko'; loser: number };

export function gunShotSpec(f: Fighter, power = 1): ShotSpec {
  const g = f.lo.gun;
  const p = Math.max(0, Math.min(1, power));
  return {
    damage: g.damage * p,
    down: g.down * p,
    speed: g.speed * (0.75 + 0.25 * p),
    homing: g.homing,
    homingTime: g.homingTime,
    homingDelay: g.homingDelay ?? 0,
    life: g.life,
    radius: g.radius * (g.holdMax ? 0.6 + 0.4 * p : 1),
    color: g.color,
    coreColor: g.coreColor,
    knockback: g.knockback * (0.5 + 0.5 * p),
    pierce: !!g.pierce,
    comboDetonator: (g.id === 'rail' || g.id === 'beam') && p >= 0.75,
    look: g.model,
  };
}

/**
 * The deterministic battle simulation. Fixed 60 Hz steps; no rendering.
 * Presentation reads `events` after every step.
 */
export class World {
  time = 0;
  readonly fighters: [Fighter, Fighter];
  projectiles: Projectile[] = [];
  bombs: Bomb[] = [];
  pods: Pod[] = [];
  fires: FireZone[] = [];
  crates: Crate[] = [];
  traps: Trap[] = [];
  pickups: Pickup[] = [];
  readonly events: GameEvent[] = [];
  private nextId = 1;
  /** -1 ongoing, 0/1 defeated player, 2 simultaneous knockout (draw). */
  koLoser = -1;
  /** When false, weapons/hits are disabled (intro). */
  combatEnabled = false;
  private nextPickupAt: number;
  private pickupsOn: boolean;
  private pickupIndex = 0;
  constructor(readonly arena: ArenaBuild, a: Fighter, b: Fighter, opts: WorldOptions = {}) {
    this.fighters = [a, b];
    for (const f of this.fighters) f.clearPrimer('reset');
    this.pickupsOn = !!opts.pickups;
    this.nextPickupAt = PICKUP.firstAt;
    const lay = TACTICS[opts.arenaId ?? arena.info.id];
    if (lay && opts.tactics !== false) {
      for (const [x, z] of lay.crates) {
        const y = groundHeightBelow(x, z, 50, arena.colliders);
        const h = CRATE.size / 2;
        const collider: BoxCollider = { kind: 'box', min: new THREE.Vector3(x - h, y, z - h), max: new THREE.Vector3(x + h, y + CRATE.size, z + h) };
        arena.colliders.push(collider);
        this.crates.push({ id: this.nextId++, collider, pos: new THREE.Vector3(x, y, z), hp: CRATE.hp, alive: true });
      }
      lay.pads.forEach((p, i) => {
        const y = groundHeightBelow(p.at[0], p.at[1], 50, arena.colliders);
        this.traps.push({ index: i, pos: new THREE.Vector3(p.at[0], y, p.at[1]), sw: new THREE.Vector3(...p.sw), armedAt: -1, readyAt: 0, owner: -1 });
      });
    }
    this.pickupSpot = lay ? new THREE.Vector3(lay.pickup[0], 0, lay.pickup[1]) : new THREE.Vector3();
    this.pickupSpot.y = groundHeightBelow(this.pickupSpot.x, this.pickupSpot.z, 50, arena.colliders) + 1.0;
  }

  private pickupSpot: THREE.Vector3;

  get colliders() {
    return this.arena.colliders;
  }

  step(inputs: [FighterInput, FighterInput]) {
    const dt = SIM_DT;
    this.events.length = 0;
    this.arena.tick(this.time, dt);
    const [f0, f1] = this.fighters;
    f0.step(dt, inputs[0], f1, this.colliders, this.arena.halfX, this.arena.halfZ);
    f1.step(dt, inputs[1], f0, this.colliders, this.arena.halfX, this.arena.halfZ);
    const emitted = [f0.events.length, f1.events.length];
    for (const f of this.fighters) {
      for (const ev of f.events) this.emitFighterEvent(f, ev);
      if (!this.combatEnabled) continue;
      for (const s of f.spawns) this.spawn(f, s);
    }
    if (this.combatEnabled) {
      this.stepProjectiles(dt);
      this.stepBombs(dt);
      this.stepPods(dt);
      this.stepFires();
      this.stepMelee();
      this.stepHazards();
      this.stepTraps();
      this.stepPickups();
    }
    // Resolve simultaneous hits as a draw, not a first-projectile/player-slot advantage.
    if (this.koLoser >= 0 && !f0.alive && !f1.alive) {
      this.koLoser = 2;
      for (const event of this.events) if (event.type === 'ko') event.loser = 2;
    }
    // events raised during combat (e.g. knockdowns) after the per-fighter flush above
    for (const f of this.fighters) for (let i = emitted[f.id]; i < f.events.length; i++) this.emitFighterEvent(f, f.events[i]);
    this.separate();
    this.time += dt;
  }

  private spawn(f: Fighter, s: SpawnReq) {
    if (s.kind === 'shot') this.spawnShot(f, s.index, s.air, s.power);
    else if (s.kind === 'bomb') this.spawnBomb(f);
    else if (s.kind === 'skill') this.spawnSkill(f, s.target);
    else this.spawnPod(f);
  }

  private emitFighterEvent(f: Fighter, ev: Fighter['events'][number]) {
    if (ev.type === 'primerClear') this.events.push({ type: 'primerClear', victim: f.id, attacker: ev.owner, pos: f.chestPoint(), reason: ev.reason });
    else this.events.push({ type: 'fighter', who: f.id, ev, pos: f.pos.clone() });
  }

  /* ------------------------------------------------------------ spawning */

  private makeProjectile(owner: number, spec: ShotSpec, from: THREE.Vector3, vel: THREE.Vector3, homingMul: number): Projectile {
    const p: Projectile = {
      id: this.nextId++, owner, spec, pos: from.clone(), prev: from.clone(), vel, age: 0, alive: true, nearMissed: false, passed: false, homingMul, deflected: false,
    };
    this.projectiles.push(p);
    return p;
  }

  private spawnShot(f: Fighter, index: number, air: boolean, power: number) {
    const def = f.lo.gun;
    const spec = gunShotSpec(f, power);
    spec.damage *= f.damageMul;
    const target = this.fighters[1 - f.id];
    const from = f.muzzlePoint();
    const aim = target.chestPoint();
    // Precision weapons predict constant motion at release. A direction change or timed dash
    // after the visible wind-up still beats the shot. No random aim/spread in PvP or AI.
    const precision = def.model === 'rail' || def.model === 'beam';
    const lead = precision ? interceptTime(aim.clone().sub(from), target.vel, spec.speed) : Math.min(0.2, from.distanceTo(aim) / spec.speed) * 0.25;
    aim.addScaledVector(target.vel, Math.min(0.45, lead));
    const dir = aim.sub(from).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    f.stats.gunProjectiles += def.pellets;
    for (let i = 0; i < def.pellets; i++) {
      const d = dir.clone();
      if (def.launchDeg) {
        // curving shots launch wide to alternating sides
        const side = i % 2 === 0 ? 1 : -1;
        d.applyAxisAngle(up, THREE.MathUtils.degToRad(def.launchDeg) * side);
        d.y += 0.15;
        d.normalize();
      } else if (def.pellets > 1) {
        const a = THREE.MathUtils.degToRad(def.spreadDeg) * ((i / (def.pellets - 1)) - 0.5) * 2;
        d.applyAxisAngle(up, a + (index % 2 ? 0.04 : -0.04));
      }
      const p = this.makeProjectile(f.id, spec, from, d.multiplyScalar(spec.speed), f.homingMul);
      this.events.push({ type: 'shot', who: f.id, proj: p, index });
    }
  }

  /**
   * Skill shot: a straight, non-homing projectile toward the aim point (or, on a quick-cast,
   * the target's current position: no lead). Vertical aim follows the target's chest height.
   */
  private spawnSkill(f: Fighter, aim: readonly [number, number, number] | null) {
    const sk = f.lo.skill;
    const foe = this.fighters[1 - f.id];
    const from = f.muzzlePoint();
    const chest = foe.chestPoint();
    const dir = aim ? new THREE.Vector3(aim[0] - from.x, chest.y - from.y, aim[2] - from.z) : chest.sub(from);
    if (aim) {
      // aimed away from the target: fly level instead of diving toward its height
      const flat = Math.hypot(dir.x, dir.z);
      const toFoe = new THREE.Vector3(foe.pos.x - f.pos.x, 0, foe.pos.z - f.pos.z).normalize();
      if (flat > 1e-3 && (dir.x * toFoe.x + dir.z * toFoe.z) / flat < 0.8) dir.y = 0;
    }
    if (dir.lengthSq() < 1e-6) dir.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
    dir.normalize();
    const spec: ShotSpec = {
      damage: sk.damage * f.damageMul, down: sk.down, speed: sk.speed, homing: 0, homingTime: 0, homingDelay: 0,
      life: sk.range / sk.speed, radius: sk.radius, color: sk.color, coreColor: sk.coreColor, knockback: sk.knockback,
      pierce: !!sk.pierce, comboDetonator: !!sk.detonator, look: sk.model, skill: true, pull: sk.pull, slow: sk.slow,
    };
    const p = this.makeProjectile(f.id, spec, from, dir.multiplyScalar(sk.speed), 0);
    this.events.push({ type: 'shot', who: f.id, proj: p, index: 0 });
  }

  private spawnBomb(f: Fighter) {
    const def = f.lo.bomb;
    const target = this.fighters[1 - f.id];
    const goal = f.bombTarget ? new THREE.Vector3(...f.bombTarget) : target.pos.clone().addScaledVector(target.vel, def.flightTime * 0.45);
    if (!f.bombTarget) {
      goal.y = groundHeightBelow(goal.x, goal.z, target.pos.y + 0.1, this.colliders);
      if (def.model === 'bouncer') goal.lerp(f.pos.clone().setY(goal.y), 0.45);
    }
    for (let i = 0; i < def.count; i++) {
      const plan = plannedBomb(f, goal, this.colliders, i);
      const b: Bomb = {
        id: this.nextId++, owner: f.id, def, pos: plan.from, vel: plan.velocity, bounces: def.bounces, age: 0, alive: true,
        spin: new THREE.Vector3(5 + i, 3 - i, 0), target: plan.target,
      };
      this.bombs.push(b);
      this.events.push({ type: 'bombLaunch', who: f.id, bomb: b });
    }
  }

  private spawnPod(f: Fighter) {
    const def = f.lo.pod;
    for (let i = 0; i < def.count; i++) {
      const side = def.count > 1 ? (i === 0 ? 1 : -1) : 0;
      const fx = Math.sin(f.yaw);
      const fz = Math.cos(f.yaw);
      const rx = Math.cos(f.yaw);
      const rz = -Math.sin(f.yaw);
      let pos: THREE.Vector3;
      let vel: THREE.Vector3;
      if (def.model === 'turret') {
        // planted beside the owner (left side), on the ground
        pos = f.pos.clone().add(new THREE.Vector3(rx * 1.4 + fx * 0.4, 0, rz * 1.4 + fz * 0.4));
        if (pointInSolid(pos.clone().setY(pos.y + 0.5), this.colliders, false)) pos.copy(f.pos);
        pos.y = groundHeightBelow(pos.x, pos.z, f.pos.y + 0.5, this.colliders) + def.hoverHeight;
        vel = new THREE.Vector3();
      } else if (def.model === 'interceptor') {
        pos = f.pos.clone().add(new THREE.Vector3(0, def.hoverHeight, 0));
        vel = new THREE.Vector3();
      } else {
        pos = f.pos.clone().add(new THREE.Vector3(-fx * 0.3 + rx * side * 0.25, 1.9, -fz * 0.3 + rz * side * 0.25));
        vel = new THREE.Vector3(fx * 3 + rx * side * 6, 5, fz * 3 + rz * side * 6);
      }
      const p: Pod = {
        id: this.nextId++, owner: f.id, def, pos, vel, age: 0, hp: def.hp, alive: true, triggeredAt: -1, heading: f.yaw + side * 0.8, actT: def.armTime,
      };
      this.pods.push(p);
      this.events.push({ type: 'podLaunch', who: f.id, pod: p });
    }
  }

  /* ------------------------------------------------------------ projectiles */

  private stepProjectiles(dt: number) {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.age += dt;
      const s = p.spec;
      const target = this.fighters[1 - p.owner];
      if (p.age >= s.homingDelay && p.age < s.homingDelay + s.homingTime && s.homing > 0 && !p.passed) {
        const want = target.chestPoint().sub(p.pos).normalize();
        const cur = p.vel.clone().normalize();
        const ang = cur.angleTo(want);
        if (ang > 1e-4) {
          const t = Math.min(1, (s.homing * p.homingMul * dt) / ang);
          cur.lerp(want, t).normalize();
          p.vel.copy(cur.multiplyScalar(s.speed));
        }
      }
      p.prev.copy(p.pos);
      p.pos.addScaledVector(p.vel, dt);
      if (p.age > s.life) {
        p.alive = false;
        continue;
      }
      // hit fighter (capsule) — segment closest approach
      const solid = segmentHit(p.prev, p.pos, this.colliders);
      const travelEnd = solid?.point ?? p.pos;
      let hit = p.passed ? null : this.segmentVsFighter(p.prev, p.pos, target, 0.55 + s.radius);
      if (hit && solid && solid.point.distanceToSquared(p.prev) <= hit.distanceToSquared(p.prev)) hit = null;
      if (hit && target.dodging) {
        // perfect dodge: the shot passes through
        p.passed = true;
        if (target.perfectDodge()) this.events.push({ type: 'dodge', who: target.id, pos: target.chestPoint(), perfect: true });
        hit = null; // the same segment must still collide with a wall behind the dodging robot
      }
      if (hit && target.guarding && !p.deflected) {
        if (target.facesIncoming(p.vel)) {
          target.clearPrimer(target.parrying ? 'parry' : 'guard');
          // deflect back at the shooter; a perfect parry deflects harder
          const parry = target.parrying;
          const shooter = this.fighters[p.owner];
          if (s.look !== 'turret') shooter.stats.gunDeflected++;
          p.owner = target.id;
          p.deflected = true;
          p.age = 0;
          p.homingMul = 1.5;
          p.spec = { ...s, damage: s.damage * (parry ? 1.5 : 1), homingDelay: 0, homingTime: 0.5, homing: Math.max(2, s.homing), life: Math.max(1, s.life) };
          p.vel.copy(shooter.chestPoint().sub(hit).normalize().multiplyScalar(s.speed * 1.1));
          p.pos.copy(hit);
          if (parry) target.stats.parries++;
          this.events.push({ type: 'deflect', who: target.id, pos: hit.clone(), color: s.color, parry });
          continue;
        }
      }
      if (hit) {
        if (!target.isInvulnerable) {
          const dir = p.vel.clone().normalize();
          const result = this.applyHit(target, p.owner, { damage: s.damage, down: s.down, dir, knock: s.knockback, heavy: s.down >= 40 || !!s.pull, source: s.skill ? 'skill' : 'gun', comboBonus: !p.deflected && s.comboDetonator ? comboBonus(s.damage * DAMAGE_SCALE) : undefined }, hit, s.color, false, s.skill ? { look: s.look, reflected: p.deflected } : undefined);
          const landed = !!result && !result.blocked && !result.parried;
          if (landed && !p.deflected && s.pull && target.alive && !result.knockdown) {
            // harpoon: reel the target in (staggered by the heavy hit)
            const owner = this.fighters[p.owner];
            const pull = new THREE.Vector3(owner.pos.x - target.pos.x, 0, owner.pos.z - target.pos.z);
            const d = pull.length();
            if (d > 2.2) target.vel.copy(pull.multiplyScalar(Math.min(s.pull, (d - 1.8) * 3.2) / d)).setY(Math.max(target.vel.y, 2));
          }
          if (landed && s.slow) target.slowT = Math.max(target.slowT, s.slow);
          if (!p.deflected && s.look !== 'turret' && result && result.damage > 0) {
            const st = this.fighters[p.owner].stats;
            if (s.skill) {
              st.skillHits++;
              st.skillDamage += result.damage;
            } else {
              st.gunHits++;
              st.gunDamage += result.damage;
            }
          }
        } else {
          this.events.push({ type: 'impact', pos: hit, normal: p.vel.clone().normalize().negate(), color: s.color, proj: p });
        }
        p.alive = false;
        continue;
      }
      // near-miss: dodge detection (target dashing close by)
      if (!p.nearMissed && !p.passed && (target.mode === 'dash' || target.mode === 'airdash')) {
        const d = this.segmentDistance(p.prev, travelEnd, target.chestPoint());
        if (d < 1.8) {
          p.nearMissed = true;
          target.stats.dodges++;
          this.events.push({ type: 'dodge', who: target.id, pos: target.chestPoint(), perfect: false });
        }
      }
      // hit enemy pods
      for (const pod of this.pods) {
        if (!pod.alive || pod.owner === p.owner) continue;
        if (this.segmentDistance(p.prev, travelEnd, pod.pos) < 0.45 + (pod.def.model === 'turret' ? 0.3 : 0) && !segmentHit(p.prev, pod.pos, this.colliders)) {
          pod.hp -= s.damage;
          this.events.push({ type: 'impact', pos: pod.pos.clone(), normal: p.vel.clone().normalize().negate(), color: s.color, proj: p });
          if (pod.hp <= 0) this.detonatePod(pod, true);
          if (!s.pierce) p.alive = false;
          break;
        }
      }
      if (!p.alive) continue;
      // trap switches (any shot triggers them)
      for (const tr of this.traps) {
        if (this.segmentDistance(p.prev, travelEnd, tr.sw) < TRAP.switchRadius + s.radius && !segmentHit(p.prev, tr.sw, this.colliders)) this.triggerTrap(tr, p.owner);
      }
      // world
      const w = solid;
      if (w) {
        const crate = this.crates.find((c) => c.alive && c.collider === w.collider);
        if (crate) this.damageCrate(crate, s.damage, w.point);
        p.alive = false;
        this.events.push({ type: 'impact', pos: w.point, normal: w.normal, color: s.color, proj: p });
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  private stepBombs(dt: number) {
    for (const b of this.bombs) {
      if (!b.alive) continue;
      b.age += dt;
      const prev = b.pos.clone();
      b.vel.y -= BOMB_G * dt;
      b.pos.addScaledVector(b.vel, dt);
      const def = b.def;
      // direct hit on enemy (breaks guards)
      const target = this.fighters[1 - b.owner];
      const w = segmentHit(prev, b.pos, this.colliders);
      const fighterHit = this.segmentVsFighter(prev, b.pos, target, 0.65);
      if (fighterHit && (!w || fighterHit.distanceToSquared(prev) < w.point.distanceToSquared(prev))) {
        b.pos.copy(fighterHit);
        this.explode(b.pos, b.owner, def.damage, def.down, def.blastRadius, def.color, def.blastRadius > 3, 'bomb', false, true);
        if (def.fire) this.startFire(b, b.pos.clone().setY(groundHeightBelow(b.pos.x, b.pos.z, b.pos.y, this.colliders)));
        b.alive = false;
        continue;
      }
      const outOfBounds = Math.abs(b.pos.x) > this.arena.halfX + 4 || Math.abs(b.pos.z) > this.arena.halfZ + 4 || b.pos.y < -3 || b.age > 6;
      if (w || outOfBounds) {
        if (w && b.bounces > 0 && w.normal.y > 0.5) {
          b.bounces--;
          b.pos.copy(w.point).addScaledVector(w.normal, 0.05);
          const toT = target.pos.clone().sub(b.pos).setY(0);
          if (def.model === 'bouncer') {
            // skip toward the target: low, fast hops
            const d = toT.length();
            if (d < 1.6) {
              this.explode(b.pos, b.owner, def.damage, def.down, def.blastRadius, def.color, false, 'bomb', true);
              b.alive = false;
              continue;
            }
            const hop = Math.min(d, 6);
            const T = 0.38;
            toT.normalize().multiplyScalar(hop / T);
            b.vel.set(toT.x, 0.5 * BOMB_G * T, toT.z);
          } else {
            b.vel.y = Math.abs(b.vel.y) * 0.45 + 3;
            b.vel.x *= 0.6;
            b.vel.z *= 0.6;
            if (toT.length() < 6) b.vel.addScaledVector(toT.normalize(), 2);
          }
          this.events.push({ type: 'bombBounce', bomb: b });
          continue;
        }
        const at = w ? w.point.clone().addScaledVector(w.normal, 0.1) : b.pos;
        if (w) {
          const crate = this.crates.find((c) => c.alive && c.collider === w.collider);
          if (crate) this.damageCrate(crate, def.damage, w.point);
        }
        this.explode(at, b.owner, def.damage, def.down, def.blastRadius, def.color, def.blastRadius > 3, 'bomb', w ? w.normal.y > 0.5 : false);
        if (def.fire && w && w.normal.y > 0.5) this.startFire(b, at.clone().setY(w.point.y));
        b.alive = false;
      }
    }
    this.bombs = this.bombs.filter((b) => b.alive);
  }

  private startFire(b: Bomb, pos: THREE.Vector3) {
    const f = b.def.fire!;
    const zone: FireZone = { id: this.nextId++, owner: b.owner, pos, radius: f.radius, until: this.time + f.time, nextTick: this.time + 0.2, def: f, color: b.def.color };
    this.fires.push(zone);
    this.events.push({ type: 'fireStart', zone });
  }

  private stepFires() {
    for (const z of this.fires) {
      if (this.time < z.nextTick) continue;
      z.nextTick += z.def.tick;
      const v = this.fighters[1 - z.owner];
      const dx = v.pos.x - z.pos.x;
      const dz = v.pos.z - z.pos.z;
      // ground fire: only burns robots standing in it
      // two-sided vertical check: fire on a raised deck must not burn robots below it
      if (dx * dx + dz * dz < z.radius * z.radius && Math.abs(v.pos.y - z.pos.y) < 0.6 && v.grounded) {
        this.applyHit(v, z.owner, { damage: z.def.damage, down: z.def.down, dir: new THREE.Vector3(dx, 0, dz).normalize(), knock: 0, heavy: false, source: 'fire', tick: true }, v.chestPoint(), z.color);
      }
    }
    this.fires = this.fires.filter((z) => z.until > this.time);
  }

  private stepPods(dt: number) {
    for (const p of this.pods) {
      if (!p.alive) continue;
      p.age += dt;
      const def = p.def;
      const owner = this.fighters[p.owner];
      const target = this.fighters[1 - p.owner];
      const goal = target.chestPoint();
      if (def.turret) {
        // stationary sentry: periodic small homing shots
        p.heading = Math.atan2(goal.x - p.pos.x, goal.z - p.pos.z);
        p.actT -= dt;
        if (p.actT <= 0 && !target.isInvulnerable) {
          p.actT = def.turret.interval;
          const from = p.pos.clone().add(new THREE.Vector3(0, 0.35, 0));
          if (!segmentHit(from, goal, this.colliders)) {
            const spec: ShotSpec = {
              damage: def.turret.damage * owner.damageMul, down: def.turret.down, speed: def.turret.speed, homing: def.turret.homing, homingTime: 0.4, homingDelay: 0,
              life: 1.6, radius: 0.18, color: def.color, coreColor: 0xfff3d0, knockback: 1.5, pierce: false, look: 'turret',
            };
            const proj = this.makeProjectile(p.owner, spec, from, goal.clone().sub(from).normalize().multiplyScalar(spec.speed), owner.homingMul);
            this.events.push({ type: 'turretShot', pod: p, proj });
          }
        }
        if (p.age > def.life) this.detonatePod(p, true);
        continue;
      }
      if (def.intercept) {
        // orbit the owner and shoot down incoming shots / pods
        const a = p.age * 2.4;
        const want = owner.pos.clone().add(new THREE.Vector3(Math.cos(a) * def.intercept.orbit, def.hoverHeight, Math.sin(a) * def.intercept.orbit));
        p.pos.lerp(want, Math.min(1, dt * 10));
        p.heading = a;
        p.actT -= dt;
        if (p.actT <= 0) {
          let best: { pos: THREE.Vector3; kill: () => void } | null = null;
          let bestD = def.intercept.radius;
          for (const pr of this.projectiles) {
            if (!pr.alive || pr.owner === p.owner) continue;
            const d = pr.pos.distanceTo(owner.chestPoint());
            if (d < bestD) {
              bestD = d;
              best = { pos: pr.pos.clone(), kill: () => (pr.alive = false) };
            }
          }
          for (const ep of this.pods) {
            if (!ep.alive || ep.owner === p.owner) continue;
            const d = ep.pos.distanceTo(owner.chestPoint());
            if (d < bestD) {
              bestD = d;
              best = { pos: ep.pos.clone(), kill: () => { ep.hp -= 40; if (ep.hp <= 0) this.detonatePod(ep, true); } };
            }
          }
          if (best) {
            best.kill();
            p.actT = def.intercept.interval;
            this.events.push({ type: 'intercept', who: p.owner, from: p.pos.clone(), to: best.pos });
          } else p.actT = 0.05;
        }
        if (p.age > def.life || !owner.alive) {
          p.alive = false;
        }
        continue;
      }
      if (p.age < 0.35) {
        // launch arc
        p.vel.y -= 14 * dt;
        p.vel.multiplyScalar(1 - dt * 2);
      } else {
        // steer heading toward the target on XZ; hold hover height above ground
        const want = Math.atan2(goal.x - p.pos.x, goal.z - p.pos.z);
        let d = want - p.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        p.heading += THREE.MathUtils.clamp(d, -def.turnRate * dt, def.turnRate * dt);
        const sp = def.speed * Math.min(1, (p.age - 0.35) * 2 + 0.3);
        const ground = groundHeightBelow(p.pos.x, p.pos.z, p.pos.y + 0.5, this.colliders);
        const wantY = Math.max(ground + def.hoverHeight, Math.min(goal.y, ground + def.hoverHeight + 2.5));
        const vy = (wantY - p.pos.y) * 3 + Math.sin(p.age * 4 + p.id) * 0.3;
        p.vel.set(Math.sin(p.heading) * sp, vy, Math.cos(p.heading) * sp);
      }
      const prev = p.pos.clone();
      p.pos.addScaledVector(p.vel, dt);
      // pods slide along walls instead of exploding on them
      if (pointInSolid(p.pos, this.colliders, false)) {
        p.pos.copy(prev);
        p.pos.y += 3 * dt;
        p.heading += 1.2 * dt;
      }
      const armed = p.age >= def.armTime;
      const dist = p.pos.distanceTo(goal);
      if (armed && p.triggeredAt < 0 && dist < def.triggerRadius && !target.isInvulnerable) {
        p.triggeredAt = p.age;
        this.events.push({ type: 'podTrigger', pod: p });
      }
      if (p.triggeredAt >= 0 && p.age - p.triggeredAt >= def.fuse) {
        this.detonatePod(p, false);
        continue;
      }
      if (p.age > def.life) this.detonatePod(p, false);
    }
    this.pods = this.pods.filter((p) => p.alive);
  }

  private detonatePod(p: Pod, shotDown: boolean) {
    if (!p.alive) return;
    p.alive = false;
    if (p.def.blastRadius <= 0) return;
    const dmgMul = shotDown ? 0.5 : 1;
    this.explode(p.pos.clone(), p.owner, p.def.damage * dmgMul, p.def.down * dmgMul, p.def.blastRadius * (shotDown ? 0.7 : 1), p.def.color, false, 'pod', true, false, !shotDown);
  }

  /* ------------------------------------------------------------ melee */

  private stepMelee() {
    for (const f of this.fighters) {
      const other = this.fighters[1 - f.id];
      // clash only when both robots are lunging; a defender still in its parry window parries instead
      if (f.chargePhase === 1 && f.mode === 'charge' && other.mode === 'charge' && other.chargePhase === 1 && f.pos.distanceTo(other.pos) < 1.8) {
        // charge clash: both bounce off
        for (const g of [f, other]) {
          const away = g.pos.clone().sub(g === f ? other.pos : f.pos).setY(0).normalize();
          g.vel.set(away.x * 10, 3, away.z * 10);
          g.setMode('stagger');
        }
        this.events.push({ type: 'clash', pos: f.pos.clone().lerp(other.pos, 0.5).setY(f.pos.y + 1.2) });
        continue;
      }
      const h = f.meleeCheck(other);
      if (h) {
        h.damage *= f.damageMul;
        this.applyHit(other, f.id, h, other.chestPoint(), f.lo.gun.color);
      }
    }
  }

  /* ------------------------------------------------------------ damage */

  explode(pos: THREE.Vector3, owner: number, damage: number, down: number, radius: number, color: number, big: boolean, source: HitInfo['source'], onGround = true, direct = false, canPrime = true) {
    this.events.push({ type: 'explosion', pos: pos.clone(), radius, color, big, onGround });
    const ownerF = this.fighters[owner];
    const victim = this.fighters[1 - owner];
    const c = victim.chestPoint();
    // distance to the capsule axis
    const yClamped = THREE.MathUtils.clamp(pos.y, victim.pos.y + 0.3, victim.pos.y + 1.7);
    const d = Math.hypot(pos.x - c.x, pos.y - yClamped, pos.z - c.z);
    if (d < radius + 0.4 && victim.dodging) {
      if (victim.perfectDodge()) this.events.push({ type: 'dodge', who: victim.id, pos: c.clone(), perfect: true });
    } else if (d < radius + 0.4) {
      const fall = 1 - THREE.MathUtils.clamp((d - 0.6) / radius, 0, 1) * 0.55;
      const dir = c.clone().sub(pos);
      dir.normalize();
      this.applyHit(victim, owner, { damage: damage * fall * (ownerF ? ownerF.damageMul : 1), down: down * fall, dir, knock: 6, heavy: true, source, guardBreak: direct }, c, color, canPrime && (source === 'bomb' || source === 'pod'));
    }
    // chain-detonate pods caught in blasts; damage crates
    for (const p of this.pods) if (p.alive && p.pos.distanceTo(pos) < radius * 0.8 && p.owner !== owner) this.detonatePod(p, true);
    for (const cr of this.crates) {
      if (!cr.alive) continue;
      const cc = cr.pos.clone().setY(cr.pos.y + CRATE.size / 2);
      if (cc.distanceTo(pos) < radius + CRATE.size * 0.5) this.damageCrate(cr, damage * 0.8, cc);
    }
  }

  applyHit(victim: Fighter, attacker: number, h: HitInfo, at: THREE.Vector3, color: number, canPrime = false, skill?: { look: ShotSpec['look']; reflected: boolean }) {
    const primerOwner = victim.primer?.owner;
    const r = victim.takeHit({ ...h, damage: h.damage * DAMAGE_SCALE });
    if (!r.applied) return;
    const att = this.fighters[attacker];
    if (r.comboDetonated && primerOwner !== undefined) {
      if (att) { att.stats.combos++; att.stats.comboDamage += r.comboBonus ?? 0; }
      this.events.push({ type: 'combo', victim: victim.id, attacker, primerOwner, pos: at.clone(), bonus: r.comboBonus ?? 0 });
    }
    if (canPrime && att && attacker !== victim.id && r.damage > 0 && !r.blocked && !r.parried && !r.knockdown && !r.ko && victim.prime(attacker)) {
      att.stats.primes++;
      this.events.push({ type: 'prime', victim: victim.id, attacker, pos: at.clone(), duration: victim.primer!.duration });
    }
    if (r.parried && att && h.source === 'charge') att.parriedBy();
    if (att) {
      att.stats.damageDealt += r.damage;
      if (r.knockdown) att.stats.knockdowns++;
      if (!r.parried) att.stats.hits++;

    }
    this.events.push({
      type: 'hit', victim: victim.id, attacker, pos: at.clone(), dir: h.dir.clone(), damage: r.damage,
      heavy: (h.heavy || r.knockdown || !!r.guardBroken) && !r.blocked && !r.parried, knockdown: r.knockdown, ko: r.ko,
      blocked: !!r.blocked, parried: !!r.parried, guardBroken: !!r.guardBroken, source: h.source, color, skillLook: skill?.look, skillReflected: skill?.reflected,
    });
    if (r.ko && this.koLoser < 0) {
      this.koLoser = victim.id;
      this.events.push({ type: 'ko', loser: victim.id });
    }
    return r;
  }

  private stepHazards() {
    const t = this.time;
    this.arena.hazards.forEach((hz, i) => {
      if (!hz.isActive(t)) return;
      for (const f of this.fighters) {
        if (!f.canHazardHit() || f.isInvulnerable) continue;
        const dx = f.pos.x - hz.center.x;
        const dz = f.pos.z - hz.center.z;
        if (dx * dx + dz * dz > hz.radius * hz.radius) continue;
        if (f.pos.y < hz.yMin || f.pos.y > hz.yMax) continue;
        f.markHazard();
        const dir = new THREE.Vector3(dx, 0, dz);
        if (dir.lengthSq() < 1e-3) dir.set(1, 0, 0);
        dir.normalize();
        this.events.push({ type: 'hazard', index: i, pos: f.pos.clone() });
        this.applyHit(f, -1, { damage: hz.damage, down: hz.down, dir, knock: hz.down > 0 ? 3 : 0, heavy: hz.down > 0, launch: hz.launch, tick: hz.down <= 0, source: 'hazard' }, f.chestPoint(), 0xffffff);
      }
    });
  }

  /* ------------------------------------------------------------ arena tactics */

  private damageCrate(c: Crate, dmg: number, at: THREE.Vector3) {
    if (!c.alive) return;
    c.hp -= dmg;
    this.events.push({ type: 'crateHit', crate: c, pos: at.clone() });
    if (c.hp <= 0) {
      c.alive = false;
      const i = this.arena.colliders.indexOf(c.collider);
      if (i >= 0) this.arena.colliders.splice(i, 1);
      this.events.push({ type: 'crateBreak', crate: c });
    }
  }

  private triggerTrap(tr: Trap, by: number) {
    if (tr.armedAt >= 0 || this.time < tr.readyAt) return;
    tr.armedAt = this.time;
    tr.owner = by;
    this.events.push({ type: 'trapArm', trap: tr, by });
  }

  /** 0 idle, 1 warning, 2 active. */
  trapState(tr: Trap) {
    if (tr.armedAt < 0) return 0;
    const t = this.time - tr.armedAt;
    return t < TRAP.warn ? 1 : 2;
  }

  private stepTraps() {
    // switches are pylons: run into one (or shoot near it) to spring its trap
    for (const tr of this.traps) {
      for (const f of this.fighters) {
        if (!f.alive || f.mode === 'down') continue;
        const c = f.chestPoint();
        if (Math.hypot(c.x - tr.sw.x, c.z - tr.sw.z) < TRAP.touchRadius && Math.abs(c.y - tr.sw.y) < 1.6) this.triggerTrap(tr, f.id);
      }
    }
    for (const tr of this.traps) {
      if (tr.armedAt < 0) continue;
      const t = this.time - tr.armedAt;
      if (t >= TRAP.warn && t - SIM_DT < TRAP.warn) this.events.push({ type: 'trapFire', trap: tr });
      if (t >= TRAP.warn && t < TRAP.warn + TRAP.active) {
        // traps hurt whoever stands on them (including the one who triggered it)
        for (const f of this.fighters) {
          if (!f.canHazardHit() || f.isInvulnerable) continue;
          const dx = f.pos.x - tr.pos.x;
          const dz = f.pos.z - tr.pos.z;
          const dy = f.pos.y - tr.pos.y;
          if (dx * dx + dz * dz > TRAP.radius * TRAP.radius || dy < -0.5 || dy > 2.5) continue;
          f.markHazard();
          const dir = new THREE.Vector3(dx, 0, dz);
          if (dir.lengthSq() < 1e-3) dir.set(0, 0, 1);
          this.applyHit(f, f.id === tr.owner ? -1 : tr.owner, { damage: TRAP.damage, down: TRAP.down, dir: dir.normalize(), knock: 3, heavy: true, launch: TRAP.launch, source: 'hazard' }, f.chestPoint(), 0xffd23a);
        }
      }
      if (t >= TRAP.warn + TRAP.active) {
        tr.armedAt = -1;
        tr.readyAt = this.time + TRAP.cooldown;
      }
    }
  }

  private stepPickups() {
    if (!this.pickupsOn) return;
    if (this.time >= this.nextPickupAt && this.pickups.length === 0) {
      const kind = PICKUP_KINDS[this.pickupIndex++ % PICKUP_KINDS.length];
      const pk: Pickup = { id: this.nextId++, kind, pos: this.pickupSpot.clone(), until: this.time + PICKUP.life };
      this.pickups.push(pk);
      this.nextPickupAt = this.time + PICKUP.interval;
      this.events.push({ type: 'pickupSpawn', pickup: pk });
    }
    for (const pk of this.pickups) {
      for (const f of this.fighters) {
        if (!f.alive || f.mode === 'down') continue;
        if (f.chestPoint().distanceTo(pk.pos) < PICKUP.radius + 0.4) {
          if (pk.kind === 'shield') f.buffs.shield = PICKUP_EFFECT.shield;
          else f.buffs[pk.kind] = PICKUP_EFFECT[pk.kind];
          pk.until = -1;
          this.events.push({ type: 'pickupTake', pickup: pk, who: f.id });
          break;
        }
      }
    }
    this.pickups = this.pickups.filter((p) => p.until > this.time);
  }

  /** Keep the two robots from overlapping. */
  private separate() {
    const [a, b] = this.fighters;
    if (Math.abs(a.pos.y - b.pos.y) > 1.8) return;
    const dx = b.pos.x - a.pos.x;
    const dz = b.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    const min = 1.0;
    if (d < min && d > 1e-4) {
      const push = (min - d) / 2;
      a.pos.x -= (dx / d) * push;
      a.pos.z -= (dz / d) * push;
      b.pos.x += (dx / d) * push;
      b.pos.z += (dz / d) * push;
    }
  }

  /* ------------------------------------------------------------ geometry */

  private segmentDistance(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3) {
    const ab = b.clone().sub(a);
    const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1), 0, 1);
    return a.clone().addScaledVector(ab, t).distanceTo(p);
  }

  /** Segment vs fighter capsule (axis from feet+0.4 to head-0.4). Returns closest point if within r. */
  private segmentVsFighter(a: THREE.Vector3, b: THREE.Vector3, f: Fighter, r: number): THREE.Vector3 | null {
    // sample: cheap and robust for short per-tick segments
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const p = a.clone().lerp(b, i / steps);
      const y = THREE.MathUtils.clamp(p.y, f.pos.y + 0.45, f.pos.y + 1.55);
      const dx = p.x - f.pos.x;
      const dz = p.z - f.pos.z;
      const dy = p.y - y;
      if (dx * dx + dy * dy + dz * dz < r * r) return p;
    }
    return null;
  }
}

export { GRAVITY };

/** Earliest constant-velocity intercept time, bounded by the weapon's flight in spawnShot. */
export function interceptTime(relative: THREE.Vector3, velocity: THREE.Vector3, speed: number): number {
  const a = velocity.lengthSq() - speed * speed;
  const b = 2 * relative.dot(velocity);
  const c = relative.lengthSq();
  if (Math.abs(a) < 1e-8) return Math.abs(b) > 1e-8 ? Math.max(0, -c / b) : 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Math.sqrt(c) / speed;
  const t1 = (-b - Math.sqrt(disc)) / (2 * a), t2 = (-b + Math.sqrt(disc)) / (2 * a);
  const positive = [t1, t2].filter(t => t >= 0);
  return positive.length ? Math.min(...positive) : Math.sqrt(c) / speed;
}
