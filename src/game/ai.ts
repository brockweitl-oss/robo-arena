import * as THREE from 'three';
import { emptyInput, type Fighter, type FighterInput } from './fighter';
import type { World } from './world';
import type { AIPersonality } from '../data/characters';
import { segmentHit } from './collision';

/** Deterministic opponents: identical visible situations produce identical decisions.
 * Difficulty changes reaction time and decision cadence, never weapon accuracy or damage. */
interface Profile {
  range: number;
  strafe: number;
  aggression: number;
  gunCadence: number;
  utilityCadence: number;
  aerial: boolean;
  parry: boolean;
}
export const AI_PROFILES: Record<AIPersonality, Profile> = {
  rookie: { range: 6, strafe: 0.2, aggression: 0.65, gunCadence: 1.1, utilityCadence: 5, aerial: false, parry: false },
  rusher: { range: 5, strafe: 0.45, aggression: 1, gunCadence: 0.4, utilityCadence: 3.5, aerial: false, parry: false },
  bomber: { range: 17, strafe: 0.6, aggression: 0.1, gunCadence: 0.9, utilityCadence: 2, aerial: true, parry: false },
  duelist: { range: 7, strafe: 0.4, aggression: 0.7, gunCadence: 0.45, utilityCadence: 4, aerial: false, parry: true },
  trickster: { range: 15, strafe: 0.55, aggression: 0.15, gunCadence: 0.65, utilityCadence: 2.5, aerial: false, parry: true },
  champion: { range: 12, strafe: 0.45, aggression: 0.55, gunCadence: 0.35, utilityCadence: 3, aerial: false, parry: true },
};

export class AIPilot {
  private p: Profile;
  private reaction: number;
  private railRead: boolean | null = null;
  private history: { t: number; pos: THREE.Vector3; vel: THREE.Vector3; mode: string; recovery: number; rail: number; guard: boolean }[] = [];
  private strafeDir = 1;
  private strafeAt = 0;
  private decideAt = 0;
  private gunAt = 0;
  private utilityAt = 0;
  private mobilityAt = 0;
  private holdGunUntil = 0;
  private jumpUntil = 0;
  private stuckT = 0;
  private lastPos = new THREE.Vector3();
  private seenProj = new Set<number>();
  private input = emptyInput();
  private wasHolding = false;

  private rngState = 7;
  private rnd() {
    this.rngState = (this.rngState * 16807) % 2147483647;
    return this.rngState / 2147483647;
  }

  constructor(readonly personality: AIPersonality, readonly skill: number, _seed = 7) {
    this.rngState = Math.max(1, Math.floor(_seed) % 2147483646);
    this.p = AI_PROFILES[personality];
    this.reaction = THREE.MathUtils.lerp(0.42, 0.18, skill);
  }

  think(world: World, me: Fighter, foe: Fighter): FighterInput {
    const inp = this.input, dt = 1 / 60, t = world.time;
    this.history.push({ t, pos: foe.pos.clone(), vel: foe.vel.clone(), mode: foe.mode, recovery: foe.recoveryTime,
      rail: foe.railCharge, guard: foe.guarding });
    while (this.history.length > 2 && this.history[1].t <= t - this.reaction) this.history.shift();
    const seen = this.history[0];
    Object.assign(inp, emptyInput());
    const to = seen.pos.clone().sub(me.pos).setY(0), dist = to.length();
    const toN = dist > 0.01 ? to.clone().divideScalar(dist) : new THREE.Vector3(0, 0, 1);
    const side = new THREE.Vector3(toN.z, 0, -toN.x);
    const g = me.lo.gun.model;
    const weaponRange = g === 'scatter' ? 3.5 : g === 'rail' ? 17 : g === 'beam' ? 13 : g === 'homer' ? 14 : 11;
    const range = weaponRange * 0.75 + this.p.range * 0.25;
    const vulnerable = seen.recovery > 0 || seen.mode === 'stagger' || (seen.mode === 'charge' && !seen.guard);
    // Deliberate sweeps rather than random left/right input on every tick.
    if (t >= this.strafeAt) { this.strafeDir *= -1; this.strafeAt = t + 2.4 + (1 - this.p.aggression); }
    const band = g === 'scatter' ? 0.8 : 2;
    let fwd = dist > range + band ? 1 : dist < range - band ? -0.8 : vulnerable && this.p.aggression > 0.5 ? 0.3 : 0;
    const move = toN.clone().multiplyScalar(fwd).addScaledVector(side, this.strafeDir * this.p.strafe);
    if (me.pos.distanceTo(this.lastPos) < 0.035 && move.lengthSq() > 0.2 && me.mode === 'ground' && !me.attackCommitted) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    this.lastPos.copy(me.pos);
    if (this.stuckT > 0.4) { this.strafeDir *= -1; inp.jumpPressed = true; this.jumpUntil = t + 0.3; this.stuckT = 0; }
    if (Math.abs(me.pos.x) > world.arena.halfX - 3 || Math.abs(me.pos.z) > world.arena.halfZ - 3)
      move.addScaledVector(me.pos.clone().setY(0).normalize(), -1.4);
    let danger = false;
    const avoid = (center: THREE.Vector3, radius: number) => {
      const away = me.pos.clone().sub(center).setY(0);
      if (away.length() < radius) { if (away.lengthSq() < 0.01) away.copy(side); move.addScaledVector(away.normalize(), 2); danger = true; }
    };
    for (const hz of world.arena.hazards) if (hz.isWarning(t) || hz.isActive(t)) avoid(hz.center, hz.radius + 1.2);
    for (const z of world.fires) if (Math.abs(me.pos.y - z.pos.y) < 1) avoid(z.pos, z.radius + 0.8);
    for (const tr of world.traps) {
      if (world.trapState(tr) !== 0) avoid(tr.pos, 3);
      else if (t >= tr.readyAt && (this.personality === 'trickster' || this.personality === 'champion')) {
        const foeOn = seen.pos.distanceTo(tr.pos) < 2, meOn = me.pos.distanceTo(tr.pos) < 2.6;
        const sw = tr.sw.clone().sub(me.pos).setY(0);
        if (foeOn && !meOn && sw.length() < 7) move.copy(sw.normalize());
      }
    }
    for (const b of world.bombs) if (b.owner !== me.id && b.vel.y < 0) avoid(b.target, b.def.blastRadius + 0.8);
    if (!danger) for (const pk of world.pickups) {
      const mine = me.pos.distanceTo(pk.pos), theirs = seen.pos.distanceTo(pk.pos);
      if (mine < theirs + 1 && mine < 12) move.lerp(pk.pos.clone().sub(me.pos).setY(0).normalize(), 0.8);
    }
    if (move.lengthSq() > 1) move.normalize();
    inp.moveX = move.x; inp.moveZ = move.z; inp.faceTarget = true;
    // Aerial specialists deliberately reposition; ground duelists save jumps for obstacles/danger.
    if (me.grounded && me.canAct && t >= this.mobilityAt && (danger || this.p.aerial && dist < range - 1)) {
      inp.jumpPressed = true; this.jumpUntil = t + (this.p.aerial ? 0.9 : 0.3); this.mobilityAt = t + 3.5;
    }
    inp.jumpHeld = t < this.jumpUntil;
    // Threat response only after the projectile has been visible for the pilot's reaction time.
    for (const pr of world.projectiles) {
      if (pr.owner === me.id || this.seenProj.has(pr.id) || pr.age < this.reaction) continue;
      const rel = me.chestPoint().sub(pr.pos), speed = pr.vel.length();
      const tti = rel.dot(pr.vel) / (speed * speed);
      if (tti < 0 || tti > 0.3 || rel.clone().addScaledVector(pr.vel, -tti).length() > 1.1) continue;
      this.seenProj.add(pr.id);
      if (!me.canAct || this.skill < 0.35) continue;
      if (this.p.parry && me.facesIncoming(pr.vel) && me.chargeCd <= 0 && tti <= 0.1) inp.chargePressed = true;
      else if (me.canDash && t >= this.mobilityAt) {
        inp.dashPressed = true;
        inp.moveX = side.x * this.strafeDir; inp.moveZ = side.z * this.strafeDir;
        this.mobilityAt = t + 1.2 + (1 - this.skill);
      }
    }
    if (this.seenProj.size > 200) this.seenProj.clear();
    // Read precision wind-ups, rather than magically dodging a hypersonic slug after release.
    // a read, not a reflex: even the best pilots miss some wind-ups (decided once per wind-up)
    if (seen.rail <= 0.05) this.railRead = null;
    else if (seen.rail > 0.55 && this.railRead === null) this.railRead = this.rnd() < 0.35 + this.skill * 0.3;
    if (seen.rail > 0.55 && this.railRead && this.skill >= 0.6 && me.canAct && me.canDash && t >= this.mobilityAt) {
      inp.dashPressed = true; inp.moveX = side.x * this.strafeDir; inp.moveZ = side.z * this.strafeDir;
      this.mobilityAt = t + 1.8;
    }
    const los = !segmentHit(me.chestPoint(), seen.pos.clone().add(new THREE.Vector3(0, 1.15, 0)), world.colliders);
    const canHit = !foe.isInvulnerable && foe.alive;
    if (t >= this.decideAt && t > 0.8 + this.reaction && canHit && me.canAct && !inp.dashPressed && !inp.chargePressed) {
      this.decideAt = t + this.reaction;
      const inRange = dist < (g === 'scatter' ? 6.5 : g === 'blaster' ? 27 : 34);
      // Rail waits for a setup when possible, but will probe straight movement at a measured cadence.
      const precisionOpening = g !== 'rail' || vulnerable || seen.vel.lengthSq() < 8 || t >= this.gunAt + 0.2;
      // combos: when the foe is primed, cash it in with a trigger
      if (foe.primed && this.rnd() < 0.35 + this.skill * 0.5) {
        if (me.lo.bomb.trigger && me.bombCd <= 0) {
          inp.bombPressed = true;
          this.utilityAt = t + this.p.utilityCadence;
        } else if (dist < 6 && me.chargeCd <= 0 && Math.abs(seen.pos.y - me.pos.y) < 1.5) inp.chargePressed = true;
      }
      // heat discipline: better pilots stop firing earlier
      const heatOk = !me.overheated && me.heat < THREE.MathUtils.lerp(95, 70, this.skill);
      if (los && inRange && !seen.guard && me.gunCd <= 0 && t >= this.gunAt && precisionOpening && heatOk) {
        this.holdGunUntil = t + (me.lo.gun.holdMax ? (vulnerable ? 0.45 : me.lo.gun.holdMax) : 0.12);
        this.gunAt = t + Math.max(0.1, this.p.gunCadence - 0.3) + me.lo.gun.cooldown + me.lo.gun.windup;
      } else if (t >= this.utilityAt) {
        // Bombers flush cover; trap specialists establish a lane before committing a gun shot.
        if (me.podCd <= 0 && (this.personality === 'trickster' || me.lo.pod.model === 'turret' || dist < range + 3)) {
          inp.podPressed = true; this.utilityAt = t + this.p.utilityCadence;
        } else if (me.bombCd <= 0 && dist > 4 && (!los || seen.guard || vulnerable || this.personality === 'bomber')) {
          inp.bombPressed = true; this.utilityAt = t + this.p.utilityCadence;
        }
      }
      if (me.chargeCd <= 0 && dist < 5 && Math.abs(seen.pos.y - me.pos.y) < 1.5 &&
          (vulnerable || this.personality === 'rusher' || (this.personality === 'duelist' || this.personality === 'rookie') && dist < 3)) {
        inp.chargePressed = true; this.holdGunUntil = 0;
      }
    }
    if (me.mode === 'getup' && dist < 3.5 && seen.mode === 'charge' && this.skill > 0.5) inp.chargePressed = true;
    inp.gunHeld = t < this.holdGunUntil;
    inp.gunPressed = inp.gunHeld && !this.wasHolding;
    this.wasHolding = inp.gunHeld;
    // Only rushers spend mobility to engage; everyone else keeps it for a defensive read.
    if (this.personality === 'rusher' && dist > range + 7 && me.canAct && me.canDash && t >= this.mobilityAt) {
      inp.dashPressed = true; inp.moveX = toN.x; inp.moveZ = toN.z; this.mobilityAt = t + 2.5;
    }
    return inp;
  }
}
