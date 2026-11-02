import * as THREE from 'three';
import { Fighter, type FighterInput, type HitInfo, GRAVITY } from './fighter';
import type { ArenaBuild } from '../arena/types';
import type { GunDef, BombDef, PodDef } from '../data/parts';
import { segmentHit, pointInSolid, groundHeightBelow } from './collision';

export const SIM_DT = 1 / 60;
const BOMB_G = 22;
/** Global damage tuning knob (round length). */
export const DAMAGE_SCALE = 0.6;

export interface Projectile {
  id: number;
  owner: number;
  def: GunDef;
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
}

export type GameEvent =
  | { type: 'fighter'; who: number; ev: Fighter['events'][number]; pos: THREE.Vector3 }
  | { type: 'shot'; who: number; proj: Projectile; index: number }
  | { type: 'bombLaunch'; who: number; bomb: Bomb }
  | { type: 'bombBounce'; bomb: Bomb }
  | { type: 'podLaunch'; who: number; pod: Pod }
  | { type: 'podTrigger'; pod: Pod }
  | { type: 'impact'; pos: THREE.Vector3; normal: THREE.Vector3; color: number; proj: Projectile }
  | { type: 'explosion'; pos: THREE.Vector3; radius: number; color: number; big: boolean; onGround: boolean }
  | { type: 'hit'; victim: number; attacker: number; pos: THREE.Vector3; dir: THREE.Vector3; damage: number; heavy: boolean; knockdown: boolean; ko: boolean; blocked: boolean; source: HitInfo['source']; color: number }
  | { type: 'dodge'; who: number; pos: THREE.Vector3; perfect: boolean }
  | { type: 'deflect'; who: number; pos: THREE.Vector3; color: number }
  | { type: 'clash'; pos: THREE.Vector3 }
  | { type: 'hazard'; index: number; pos: THREE.Vector3 }
  | { type: 'ko'; loser: number };

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
  readonly events: GameEvent[] = [];
  private nextId = 1;
  koLoser = -1;
  /** When false, weapons/hits are disabled (intro). */
  combatEnabled = false;
  private seed = 12345;
  /** Deterministic RNG (0..1). */
  rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  constructor(readonly arena: ArenaBuild, a: Fighter, b: Fighter) {
    this.fighters = [a, b];
  }

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
      for (const ev of f.events) this.events.push({ type: 'fighter', who: f.id, ev, pos: f.pos.clone() });
      if (!this.combatEnabled) continue;
      for (const s of f.spawns) {
        if (s.kind === 'shot') this.spawnShot(f, s.index);
        else if (s.kind === 'bomb') this.spawnBomb(f);
        else this.spawnPod(f);
      }
    }
    if (this.combatEnabled) {
      this.stepProjectiles(dt);
      this.stepBombs(dt);
      this.stepPods(dt);
      for (const f of this.fighters) {
        const other = this.fighters[1 - f.id];
        if (f.guarding && other.guarding && f.chargePhase === 1 && f.pos.distanceTo(other.pos) < 1.8) {
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
        if (h) this.applyHit(other, f.id, h, other.chestPoint(), f.lo.gun.color);
      }
      this.stepHazards();
    }
    // events raised during combat (e.g. knockdowns) after the per-fighter flush above
    for (const f of this.fighters) for (let i = emitted[f.id]; i < f.events.length; i++) this.events.push({ type: 'fighter', who: f.id, ev: f.events[i], pos: f.pos.clone() });
    this.separate();
    this.time += dt;
  }

  /* ------------------------------------------------------------ spawning */

  private spawnShot(f: Fighter, index: number) {
    const def = f.lo.gun;
    const target = this.fighters[1 - f.id];
    const from = f.muzzlePoint();
    const aim = target.chestPoint();
    // mild lead for fast guns
    aim.addScaledVector(target.vel, Math.min(0.25, from.distanceTo(aim) / def.speed) * 0.35);
    const dist = from.distanceTo(aim);
    const dir = aim.sub(from).normalize();
    if (f.aimJitter > 0) {
      const j = f.aimJitter * Math.min(2, dist / 10);
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (this.rand() * 2 - 1) * j);
      dir.y += (this.rand() * 2 - 1) * j * 0.4;
      dir.normalize();
    }
    for (let i = 0; i < def.pellets; i++) {
      const d = dir.clone();
      if (def.pellets > 1) {
        const a = THREE.MathUtils.degToRad(def.spreadDeg) * ((i / (def.pellets - 1)) - 0.5) * 2;
        d.applyAxisAngle(new THREE.Vector3(0, 1, 0), a + (index % 2 ? 0.04 : -0.04));
      }
      const p: Projectile = {
        id: this.nextId++, owner: f.id, def, pos: from.clone(), prev: from.clone(), vel: d.multiplyScalar(def.speed), age: 0, alive: true, nearMissed: false, passed: false, homingMul: f.homingMul, deflected: false,
      };
      this.projectiles.push(p);
      this.events.push({ type: 'shot', who: f.id, proj: p, index });
    }
  }

  private spawnBomb(f: Fighter) {
    const def = f.lo.bomb;
    const target = this.fighters[1 - f.id];
    const from = f.pos.clone().add(new THREE.Vector3(Math.sin(f.yaw) * 0.1 + Math.cos(f.yaw) * 0.3, 1.9, Math.cos(f.yaw) * 0.1 - Math.sin(f.yaw) * 0.3));
    for (let i = 0; i < def.count; i++) {
      const goal = target.pos.clone().addScaledVector(target.vel, def.flightTime * 0.45);
      goal.y = groundHeightBelow(goal.x, goal.z, target.pos.y + 0.1, this.colliders);
      if (def.count > 1) {
        const a = (i / def.count) * Math.PI * 2 + this.time * 3.1;
        goal.x += Math.cos(a) * def.scatter * (i === 0 ? 0.15 : 1);
        goal.z += Math.sin(a) * def.scatter * (i === 0 ? 0.15 : 1);
      }
      const flat = new THREE.Vector3(goal.x - from.x, 0, goal.z - from.z);
      if (flat.length() > def.range) flat.setLength(def.range);
      const T = def.flightTime * (0.85 + Math.min(1, flat.length() / def.range) * 0.3) + i * 0.06;
      const vy = (goal.y - from.y + 0.5 * BOMB_G * T * T) / T;
      const b: Bomb = {
        id: this.nextId++, owner: f.id, def, pos: from.clone(), vel: new THREE.Vector3(flat.x / T, vy, flat.z / T), bounces: def.bounces, age: 0, alive: true,
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0),
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
      const pos = f.pos.clone().add(new THREE.Vector3(-fx * 0.3 + rx * side * 0.25, 1.9, -fz * 0.3 + rz * side * 0.25));
      const vel = new THREE.Vector3(fx * 3 + rx * side * 6, 5, fz * 3 + rz * side * 6);
      const p: Pod = {
        id: this.nextId++, owner: f.id, def, pos, vel, age: 0, hp: def.hp, alive: true, triggeredAt: -1, heading: f.yaw + side * 0.8,
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
      const target = this.fighters[1 - p.owner];
      if (p.age < p.def.homingTime && p.def.homing > 0 && !p.passed) {
        const want = target.chestPoint().sub(p.pos).normalize();
        const cur = p.vel.clone().normalize();
        const ang = cur.angleTo(want);
        if (ang > 1e-4) {
          const t = Math.min(1, (p.def.homing * p.homingMul * dt) / ang);
          cur.lerp(want, t).normalize();
          p.vel.copy(cur.multiplyScalar(p.def.speed));
        }
      }
      p.prev.copy(p.pos);
      p.pos.addScaledVector(p.vel, dt);
      if (p.age > p.def.life) {
        p.alive = false;
        continue;
      }
      // hit fighter (capsule) — segment closest approach
      const hit = p.passed ? null : this.segmentVsFighter(p.prev, p.pos, target, 0.55 + p.def.radius);
      if (hit && target.dodging) {
        // perfect dodge: the shot passes through
        p.passed = true;
        target.perfectDodge();
        this.events.push({ type: 'dodge', who: target.id, pos: target.chestPoint(), perfect: true });
        continue;
      }
      if (hit && target.guarding && !p.deflected) {
        const fx = Math.sin(target.yaw);
        const fz = Math.cos(target.yaw);
        const vl = Math.hypot(p.vel.x, p.vel.z) || 1;
        if ((-p.vel.x * fx - p.vel.z * fz) / vl > 0.2) {
          // deflect back at the shooter
          const shooter = this.fighters[p.owner];
          p.owner = target.id;
          p.deflected = true;
          p.age = 0;
          p.homingMul = 1.5;
          p.vel.copy(shooter.chestPoint().sub(hit).normalize().multiplyScalar(p.def.speed * 1.1));
          p.pos.copy(hit);
          this.events.push({ type: 'deflect', who: target.id, pos: hit.clone(), color: p.def.color });
          continue;
        }
      }
      if (hit) {
        p.alive = false;
        if (!target.isInvulnerable) {
          const dir = p.vel.clone().setY(0).normalize();
          this.applyHit(target, p.owner, { damage: p.def.damage, down: p.def.down, dir, knock: p.def.knockback, heavy: p.def.down >= 40, source: 'gun' }, hit, p.def.color);
        } else {
          this.events.push({ type: 'impact', pos: hit, normal: p.vel.clone().normalize().negate(), color: p.def.color, proj: p });
        }
        continue;
      }
      // near-miss: dodge detection (target dashing/jumping close by)
      if (!p.nearMissed && !p.passed && (target.mode === 'dash' || target.mode === 'airdash')) {
        const d = this.segmentDistance(p.prev, p.pos, target.chestPoint());
        if (d < 1.8) {
          p.nearMissed = true;
          target.stats.dodges++;
          this.events.push({ type: 'dodge', who: target.id, pos: target.chestPoint(), perfect: false });
        }
      }
      // hit enemy pods
      for (const pod of this.pods) {
        if (!pod.alive || pod.owner === p.owner) continue;
        if (this.segmentDistance(p.prev, p.pos, pod.pos) < 0.45) {
          pod.hp -= p.def.damage;
          p.alive = false;
          this.events.push({ type: 'impact', pos: pod.pos.clone(), normal: p.vel.clone().normalize().negate(), color: p.def.color, proj: p });
          if (pod.hp <= 0) this.detonatePod(pod, true);
          break;
        }
      }
      if (!p.alive) continue;
      // world
      const w = segmentHit(p.prev, p.pos, this.colliders);
      if (w) {
        p.alive = false;
        this.events.push({ type: 'impact', pos: w.point, normal: w.normal, color: p.def.color, proj: p });
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
      // direct hit on enemy
      const target = this.fighters[1 - b.owner];
      if (this.segmentVsFighter(prev, b.pos, target, 0.65)) {
        this.explode(b.pos, b.owner, b.def.damage, b.def.down, b.def.blastRadius, b.def.color, b.def.blastRadius > 3, 'bomb');
        b.alive = false;
        continue;
      }
      const w = segmentHit(prev, b.pos, this.colliders);
      const outOfBounds = Math.abs(b.pos.x) > this.arena.halfX + 4 || Math.abs(b.pos.z) > this.arena.halfZ + 4 || b.pos.y < -3 || b.age > 6;
      if (w || outOfBounds) {
        if (w && b.bounces > 0 && w.normal.y > 0.5) {
          b.bounces--;
          b.pos.copy(w.point).addScaledVector(w.normal, 0.05);
          b.vel.y = Math.abs(b.vel.y) * 0.45 + 3;
          b.vel.x *= 0.6;
          b.vel.z *= 0.6;
          // hop toward target a little
          const toT = target.pos.clone().sub(b.pos).setY(0);
          if (toT.length() < 6) b.vel.addScaledVector(toT.normalize(), 2);
          this.events.push({ type: 'bombBounce', bomb: b });
          continue;
        }
        const at = w ? w.point.clone().addScaledVector(w.normal, 0.1) : b.pos;
        this.explode(at, b.owner, b.def.damage, b.def.down, b.def.blastRadius, b.def.color, b.def.blastRadius > 3, 'bomb', w ? w.normal.y > 0.5 : false);
        b.alive = false;
      }
    }
    this.bombs = this.bombs.filter((b) => b.alive);
  }

  private stepPods(dt: number) {
    for (const p of this.pods) {
      if (!p.alive) continue;
      p.age += dt;
      const def = p.def;
      const target = this.fighters[1 - p.owner];
      const goal = target.chestPoint();
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
    const dmgMul = shotDown ? 0.5 : 1;
    this.explode(p.pos.clone(), p.owner, p.def.damage * dmgMul, p.def.down * dmgMul, p.def.blastRadius * (shotDown ? 0.7 : 1), p.def.color, false, 'pod');
  }

  /* ------------------------------------------------------------ damage */

  explode(pos: THREE.Vector3, owner: number, damage: number, down: number, radius: number, color: number, big: boolean, source: HitInfo['source'], onGround = true) {
    this.events.push({ type: 'explosion', pos: pos.clone(), radius, color, big, onGround });
    const victim = this.fighters[1 - owner];
    const c = victim.chestPoint();
    // distance to the capsule axis
    const yClamped = THREE.MathUtils.clamp(pos.y, victim.pos.y + 0.3, victim.pos.y + 1.7);
    const d = Math.hypot(pos.x - c.x, pos.y - yClamped, pos.z - c.z);
    if (d < radius + 0.4 && victim.dodging) {
      victim.perfectDodge();
      this.events.push({ type: 'dodge', who: victim.id, pos: c.clone(), perfect: true });
    } else if (d < radius + 0.4) {
      const fall = 1 - THREE.MathUtils.clamp((d - 0.6) / radius, 0, 1) * 0.55;
      const dir = new THREE.Vector3(c.x - pos.x, 0, c.z - pos.z);
      if (dir.lengthSq() < 1e-4) dir.set(Math.sin(victim.yaw + Math.PI), 0, Math.cos(victim.yaw + Math.PI));
      dir.normalize();
      this.applyHit(victim, owner, { damage: damage * fall, down: down * fall, dir, knock: 6, heavy: true, source }, c, color);
    }
    // chain-detonate pods caught in blasts
    for (const p of this.pods) if (p.alive && p.pos.distanceTo(pos) < radius * 0.8 && p.owner !== owner) this.detonatePod(p, true);
  }

  applyHit(victim: Fighter, attacker: number, h: HitInfo, at: THREE.Vector3, color: number) {
    const r = victim.takeHit({ ...h, damage: h.damage * DAMAGE_SCALE });
    if (!r.applied) return;
    const att = this.fighters[attacker];
    if (att) {
      att.stats.damageDealt += r.damage;
      att.stats.hits++;
      if (h.source === 'charge') att.hitstop = Math.max(att.hitstop, 0.07);
    }
    this.events.push({
      type: 'hit', victim: victim.id, attacker, pos: at.clone(), dir: h.dir.clone(), damage: r.damage, heavy: (h.heavy || r.knockdown) && !r.blocked, knockdown: r.knockdown, ko: r.ko, blocked: !!r.blocked, source: h.source, color,
    });
    if (r.ko && this.koLoser < 0) {
      this.koLoser = victim.id;
      this.events.push({ type: 'ko', loser: victim.id });
    }
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
        this.applyHit(f, -1, { damage: hz.damage, down: hz.down, dir, knock: 3, heavy: true, launch: hz.launch, source: 'hazard' }, f.chestPoint(), 0xffffff);
      }
    });
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
