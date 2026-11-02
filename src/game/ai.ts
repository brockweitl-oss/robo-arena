import * as THREE from 'three';
import { emptyInput, type Fighter, type FighterInput } from './fighter';
import type { World } from './world';
import type { AIPersonality } from '../data/characters';
import { segmentHit } from './collision';

/**
 * AI pilot. Produces a FighterInput each sim tick, exactly like a human would.
 * Personality sets range/aggression/weapon habits; skill sets reaction time and dodge rate.
 */
interface Profile {
  range: number;
  aggression: number;
  gunRate: number;
  bombRate: number;
  podRate: number;
  chargeRate: number;
  jumpiness: number;
  dodge: number;
  airPlay: number;
}

const PROFILES: Record<AIPersonality, Profile> = {
  rookie: { range: 7, aggression: 0.85, gunRate: 0.55, bombRate: 0.25, podRate: 0.2, chargeRate: 0.7, jumpiness: 0.2, dodge: 0.15, airPlay: 0.1 },
  rusher: { range: 5, aggression: 0.95, gunRate: 0.7, bombRate: 0.3, podRate: 0.3, chargeRate: 0.9, jumpiness: 0.35, dodge: 0.4, airPlay: 0.3 },
  bomber: { range: 15, aggression: 0.35, gunRate: 0.6, bombRate: 0.9, podRate: 0.6, chargeRate: 0.15, jumpiness: 0.7, dodge: 0.45, airPlay: 0.8 },
  duelist: { range: 9, aggression: 0.6, gunRate: 0.85, bombRate: 0.5, podRate: 0.45, chargeRate: 0.5, jumpiness: 0.45, dodge: 0.6, airPlay: 0.45 },
  trickster: { range: 13, aggression: 0.45, gunRate: 0.6, bombRate: 0.7, podRate: 0.95, chargeRate: 0.25, jumpiness: 0.5, dodge: 0.65, airPlay: 0.5 },
  champion: { range: 10, aggression: 0.65, gunRate: 0.75, bombRate: 0.55, podRate: 0.5, chargeRate: 0.5, jumpiness: 0.55, dodge: 0.6, airPlay: 0.6 },
};

export class AIPilot {
  private p: Profile;
  private reaction: number;
  private history: { t: number; pos: THREE.Vector3; vel: THREE.Vector3 }[] = [];
  private strafeDir = 1;
  private strafeT = 0;
  private decideT = 0;
  private holdGun = 0;
  private jumpHold = 0;
  private stuckT = 0;
  private lastPos = new THREE.Vector3();
  private seenProj = new Set<number>();
  private input = emptyInput();
  private rng: () => number;
  private openingDelay = -1;
  private wasHolding = false;

  constructor(personality: AIPersonality, readonly skill: number, seed = 7) {
    this.p = PROFILES[personality];
    this.reaction = THREE.MathUtils.lerp(0.45, 0.2, skill);
    let s = seed;
    this.rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  }

  think(world: World, me: Fighter, foe: Fighter): FighterInput {
    const inp = this.input;
    const dt = 1 / 60;
    const t = world.time;
    const r = this.rng;
    // perceived (delayed) foe state
    this.history.push({ t, pos: foe.pos.clone(), vel: foe.vel.clone() });
    while (this.history.length > 2 && this.history[1].t <= t - this.reaction) this.history.shift();
    const seen = this.history[0];
    inp.jumpPressed = inp.dashPressed = inp.gunPressed = inp.bombPressed = inp.podPressed = inp.chargePressed = false;
    inp.gunHeld = false;

    const to = seen.pos.clone().sub(me.pos);
    to.y = 0;
    const dist = to.length();
    const toN = dist > 0.01 ? to.clone().divideScalar(dist) : new THREE.Vector3(0, 0, 1);
    const side = new THREE.Vector3(toN.z, 0, -toN.x);

    // --- movement intent ---
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = 0.8 + r() * 1.8;
      if (r() < 0.55) this.strafeDir *= -1;
    }
    // fight at the gun's best range (scatter close, rail/beam long), blended with personality
    const g = me.lo.gun.model;
    const gunRange = g === 'scatter' ? 5 : g === 'rail' || g === 'beam' ? 14 : g === 'homer' ? 11 : this.p.range;
    const range = (this.p.range * 0.4 + gunRange * 0.6) * (foe.mode === 'down' || foe.mode === 'getup' ? 0.8 : 1);
    let fwd = 0;
    if (dist > range + 2.5) fwd = 1;
    else if (dist < range - 2.5) fwd = -0.9;
    else fwd = (r() < this.p.aggression ? 0.25 : -0.1);
    const move = toN.clone().multiplyScalar(fwd).addScaledVector(side, this.strafeDir * (0.65 + 0.35 * (1 - this.p.aggression)));
    // stuck against cover → switch strafe and hop
    if (me.pos.distanceTo(this.lastPos) < 0.04 && move.lengthSq() > 0.2 && me.mode === 'ground') this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    this.lastPos.copy(me.pos);
    if (this.stuckT > 0.25) {
      this.strafeDir *= -1;
      inp.jumpPressed = true;
      this.jumpHold = 0.4;
      this.stuckT = 0;
    }
    // keep away from arena edges
    const edge = new THREE.Vector3(-me.pos.x, 0, -me.pos.z);
    if (Math.abs(me.pos.x) > world.arena.halfX - 4 || Math.abs(me.pos.z) > world.arena.halfZ - 4) move.addScaledVector(edge.normalize(), 0.8);
    // avoid active/warning hazards
    for (const hz of world.arena.hazards) {
      if (!(hz.isWarning(t) || hz.isActive(t))) continue;
      const d = new THREE.Vector3(me.pos.x - hz.center.x, 0, me.pos.z - hz.center.z);
      if (d.length() < hz.radius + 1.5) move.addScaledVector(d.normalize(), 1.5);
    }
    // avoid burning ground and armed traps
    for (const z of world.fires) {
      const d = new THREE.Vector3(me.pos.x - z.pos.x, 0, me.pos.z - z.pos.z);
      if (d.length() < z.radius + 1) move.addScaledVector(d.normalize(), 1.4);
    }
    for (const tr of world.traps) {
      if (world.trapState(tr) === 0) continue;
      const d = new THREE.Vector3(me.pos.x - tr.pos.x, 0, me.pos.z - tr.pos.z);
      if (d.length() < 3) move.addScaledVector(d.normalize(), 1.6);
    }
    // spring a trap when the foe stands on its pad and the switch is close
    for (const tr of world.traps) {
      if (world.trapState(tr) !== 0 || t < tr.readyAt) continue;
      const foeOn = Math.hypot(foe.pos.x - tr.pos.x, foe.pos.z - tr.pos.z) < 2;
      const meOn = Math.hypot(me.pos.x - tr.pos.x, me.pos.z - tr.pos.z) < 2.6;
      const toSw = new THREE.Vector3(tr.sw.x - me.pos.x, 0, tr.sw.z - me.pos.z);
      if (foeOn && !meOn && toSw.length() < 7 && r() < 0.5 + this.skill * 0.4) move.copy(toSw.normalize());
    }
    // contest pick-ups
    for (const pk of world.pickups) {
      const mine = me.pos.distanceTo(pk.pos);
      const theirs = foe.pos.distanceTo(pk.pos);
      if (mine < theirs + 2 && mine < 16) move.lerp(new THREE.Vector3(pk.pos.x - me.pos.x, 0, pk.pos.z - me.pos.z).normalize(), 0.75);
    }
    // flee incoming bombs
    for (const b of world.bombs) {
      if (b.owner === me.id || b.vel.y > 0) continue;
      const d = new THREE.Vector3(me.pos.x - b.pos.x, 0, me.pos.z - b.pos.z);
      if (d.length() < b.def.blastRadius + 1.2 && r() < 0.1 + this.skill * 0.25) move.addScaledVector(d.normalize(), 2);
    }
    if (move.lengthSq() > 1) move.normalize();
    inp.moveX = move.x;
    inp.moveZ = move.z;
    inp.faceTarget = dist < 18;

    // --- jumping / air play ---
    this.jumpHold -= dt;
    if (me.grounded && r() < this.p.jumpiness * 0.012) {
      inp.jumpPressed = true;
      this.jumpHold = 0.2 + this.p.airPlay * 0.9;
    } else if (!me.grounded && me.vel.y < 0 && r() < this.p.airPlay * 0.02) {
      inp.jumpPressed = true;
      this.jumpHold = 0.6;
    }
    inp.jumpHeld = this.jumpHold > 0;

    // --- dodging ---
    for (const pr of world.projectiles) {
      if (pr.owner === me.id || this.seenProj.has(pr.id)) continue;
      const rel = me.chestPoint().sub(pr.pos);
      const closing = rel.dot(pr.vel) / pr.vel.length();
      if (closing <= 0) continue;
      const tti = closing / pr.vel.length();
      if (tti > 0.45 || tti < this.reaction * 0.5) continue;
      this.seenProj.add(pr.id);
      // guard / parry frontal shots with the charge
      const front = (-pr.vel.x * Math.sin(me.yaw) - pr.vel.z * Math.cos(me.yaw)) / (Math.hypot(pr.vel.x, pr.vel.z) || 1) > 0.5;
      if (front && me.chargeCd <= 0 && me.canAct && r() < this.p.dodge * 0.3 * this.skill) {
        inp.chargePressed = true;
        continue;
      }
      if (r() < this.p.dodge * (0.35 + this.skill * 0.65)) {
        const perp = new THREE.Vector3(-pr.vel.z, 0, pr.vel.x).normalize().multiplyScalar(r() < 0.5 ? 1 : -1);
        inp.moveX = perp.x;
        inp.moveZ = perp.z;
        if (r() < 0.7) inp.dashPressed = true;
        else {
          inp.jumpPressed = true;
          this.jumpHold = 0.3;
        }
      }
    }
    if (this.seenProj.size > 200) this.seenProj.clear();

    // --- attacks ---
    const canHit = !foe.isInvulnerable && foe.alive;
    const los = !segmentHit(me.chestPoint(), foe.chestPoint(), world.colliders);
    this.decideT -= dt;
    // opening: hold fire for a moment so every fight doesn't start with the same barrage
    if (this.openingDelay < 0) this.openingDelay = 0.5 + r() * 1.2;
    if (this.decideT <= 0 && canHit && t > this.openingDelay) {
      this.decideT = THREE.MathUtils.lerp(0.65, 0.32, this.skill) + r() * 0.3;
      // heat discipline: don't fire into an overheat (better pilots stop earlier)
      const heatCap = THREE.MathUtils.lerp(95, 70, this.skill);
      if (los && dist < 28 && me.gunCd <= 0 && !me.overheated && me.heat < heatCap && r() < this.p.gunRate) this.holdGun = me.lo.gun.holdMax ? 0.35 + r() * 0.8 : 0.15;
      // combos: when the foe is primed, cash it in with a trigger
      if (foe.primed && r() < 0.35 + this.skill * 0.5) {
        if (me.lo.bomb.trigger && me.bombCd <= 0) inp.bombPressed = true;
        else if (me.lo.gun.trigger && me.gunCd <= 0 && !me.overheated && los) this.holdGun = me.lo.gun.holdMax ? 0.6 : 0.15;
        else if (dist < 6 && me.chargeCd <= 0) inp.chargePressed = true;
      }
      if (me.bombCd <= 0 && dist > 4 && r() < this.p.bombRate * (los ? 0.45 : 1)) inp.bombPressed = true;
      if (me.podCd <= 0 && dist > 6 && r() < this.p.podRate * 0.5) inp.podPressed = true;
      // punish recovery / close range with the charge
      const punish = foe.mode === 'stagger' || (foe.mode === 'ground' && foe.vel.lengthSq() < 1 && r() < 0.3);
      if (me.chargeCd <= 0 && dist < 6 && (punish || r() < this.p.chargeRate * 0.35) && Math.abs(foe.pos.y - me.pos.y) < 1.5) inp.chargePressed = true;
    }
    this.holdGun -= dt;
    inp.gunPressed = this.holdGun > 0 && !this.wasHolding;
    this.wasHolding = this.holdGun > 0;
    // wake-up attack when the foe crowds the get-up
    if (me.mode === 'getup' && dist < 4.5 && r() < 0.08 * this.skill) inp.chargePressed = true;
    inp.gunHeld = this.holdGun > 0;
    // dash in to close distance for rushers
    if (dist > range + 6 && me.canDash && r() < this.p.aggression * 0.03) {
      inp.dashPressed = true;
      inp.moveX = toN.x;
      inp.moveZ = toN.z;
    }
    return inp;
  }
}
