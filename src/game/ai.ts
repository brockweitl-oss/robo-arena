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
  private tempo: number;
  private history: { t: number; pos: THREE.Vector3; vel: THREE.Vector3; mode: string; recovery: number; rail: number; guard: boolean; primed: boolean; comboReady: boolean }[] = [];
  private strafeDir = 1;
  private strafeAt = 0;
  private decideAt = 0;
  private gunAt = 0;
  private utilityAt = 0;
  private skillAt = 0;
  /** When the opponent's current skill wind-up was first visible (-1 = none) and whether we already reacted. */
  private castSeenAt = -1;
  private castDodged = false;
  /** Our own casts, and whether this cast is a planned feint (deterministic rhythm, top pilots only). */
  private casts = 0;
  private feintPlan = false;
  private mobilityAt = 0;
  private holdGunUntil = 0;
  private jumpUntil = 0;
  private stuckT = 0;
  private lastPos = new THREE.Vector3();
  private seenProj = new Set<number>();
  /** Seconds the foe has been out of line of sight (drives flanking around cover). */
  private noLosT = 0;
  /** Last foe charge we sidestepped (one read per wind-up). */
  private ramReadAt = -1;
  private dodgedThreats = new Set<number>();
  private input = emptyInput();
  private wasHolding = false;

  constructor(readonly personality: AIPersonality, readonly skill: number, _seed = 7) {
    this.p = AI_PROFILES[personality];
    this.reaction = THREE.MathUtils.lerp(0.42, 0.18, skill);
    // decision tempo: sharper pilots waste less time between actions (never faster than the weapon allows)
    this.tempo = THREE.MathUtils.lerp(1.2, 0.5, skill);
  }

  think(world: World, me: Fighter, foe: Fighter): FighterInput {
    const inp = this.input, dt = 1 / 60, t = world.time;
    this.history.push({ t, pos: foe.pos.clone(), vel: foe.vel.clone(), mode: foe.mode, recovery: foe.recoveryTime,
      rail: foe.railCharge, guard: foe.guarding, primed: !!foe.primer, comboReady: !!foe.primer?.armed });
    while (this.history.length > 2 && this.history[1].t <= t - this.reaction) this.history.shift();
    const seen = this.history[0];
    // emptyInput() leaves the optional fields out: clear them too, or one skill press sticks forever
    // (the pilot re-cast every time the cooldown ended, at a stale aim point).
    Object.assign(inp, emptyInput(), { skillPressed: false, skillTarget: undefined, bombTarget: undefined });
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
    // Cooldown reads (the same readout the player sees): skill and dash both spent = a window to press.
    const foeSpent = this.skill >= 0.45 && foe.skillCd > 1.5 && foe.dashCharges === 0;
    let fwd = dist > range + band ? 1 : dist < range - band ? -0.8 : vulnerable && this.p.aggression > 0.5 ? 0.3 : 0;
    if (foeSpent && this.p.aggression >= 0.4 && dist > 4) fwd = Math.max(fwd, 0.6);
    const move = toN.clone().multiplyScalar(fwd).addScaledVector(side, this.strafeDir * this.p.strafe);
    // Line of sight on the delayed observation. A pilot denied a shot for long enough walks around
    // the cover (to whichever side opens a lane first) instead of strafing behind it forever.
    const chestH = new THREE.Vector3(0, 1.15, 0);
    const foeChest = seen.pos.clone().add(chestH);
    const los = !segmentHit(me.chestPoint(), foeChest, world.colliders);
    this.noLosT = los ? 0 : this.noLosT + dt;
    if (this.noLosT > THREE.MathUtils.lerp(1.4, 0.5, this.skill) && dist > 2.5) {
      let lane: THREE.Vector3 | null = null;
      for (const [sgn, reach] of [[this.strafeDir, 4], [-this.strafeDir, 4], [this.strafeDir, 8], [-this.strafeDir, 8]]) {
        const probe = me.pos.clone().addScaledVector(side, sgn * reach).addScaledVector(toN, Math.min(3, dist * 0.25));
        if (Math.abs(probe.x) > world.arena.halfX - 2 || Math.abs(probe.z) > world.arena.halfZ - 2) continue;
        if (!segmentHit(probe.clone().add(chestH), foeChest, world.colliders)) { lane = probe; this.strafeDir = sgn; this.strafeAt = Math.max(this.strafeAt, t + 1); break; }
      }
      // up close, step around the cover to a spot beside the foe
      if (!lane && dist < 9) for (const sgn of [this.strafeDir, -this.strafeDir]) {
        const probe = seen.pos.clone().addScaledVector(side, sgn * 3.2).addScaledVector(toN, -1.5).setY(me.pos.y);
        if (!segmentHit(probe.clone().add(chestH), foeChest, world.colliders)) { lane = probe; this.strafeDir = sgn; this.strafeAt = Math.max(this.strafeAt, t + 1); break; }
      }
      // no lane nearby: close in (cover only blocks at range; up close you can walk around it)
      const goal = lane ? lane.sub(me.pos).setY(0).normalize() : toN.clone().addScaledVector(side, this.strafeDir * 0.6).normalize();
      move.copy(goal);
    }
    if (me.pos.distanceTo(this.lastPos) < 0.035 && move.lengthSq() > 0.2 && me.mode === 'ground' && !me.attackCommitted) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    this.lastPos.copy(me.pos);
    if (this.stuckT > 0.4) { this.strafeDir *= -1; inp.jumpPressed = true; this.jumpUntil = t + 0.3; this.stuckT = 0; }
    if (Math.abs(me.pos.x) > world.arena.halfX - 3 || Math.abs(me.pos.z) > world.arena.halfZ - 3)
      move.addScaledVector(me.pos.clone().setY(0).normalize(), -1.4);
    let danger = false;
    const avoid = (center: THREE.Vector3, radius: number, weight = 2) => {
      const away = me.pos.clone().sub(center).setY(0);
      if (away.length() < radius) { if (away.lengthSq() < 0.01) away.copy(side); move.addScaledVector(away.normalize(), weight); danger ||= weight >= 2; }
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
    // Bomb landing rings are visible from launch: walk out once the ring has been seen; dash if it is about to land on us.
    let blastIn = false;
    for (const b of world.bombs) {
      if (b.owner === me.id || b.age < this.reaction) continue;
      avoid(b.target, b.def.blastRadius + 0.8);
      const inside = me.pos.clone().sub(b.target).setY(0).length() < b.def.blastRadius + 0.3;
      if (inside && b.def.flightTime - b.age < 0.4 && !this.dodgedThreats.has(b.id)) { blastIn = true; this.dodgedThreats.add(b.id); }
    }
    // Enemy pods: give seekers and mines room; sidestep one that is about to pop.
    for (const pd of world.pods) {
      if (pd.owner === me.id || pd.age < this.reaction || pd.def.triggerRadius <= 0) continue;
      const d = me.pos.clone().sub(pd.pos).setY(0).length();
      // a seeker is slow: keep moving and only give ground once it is close; mines hold their lane
      // (a soft push: a pod nearby must not make the pilot abandon the Core or a pick-up)
      if (pd.triggeredAt >= 0) avoid(pd.pos, pd.def.blastRadius + 0.6);
      else if (pd.age >= pd.def.armTime) avoid(pd.pos, pd.def.model === 'seeker' ? pd.def.triggerRadius + 1.6 : pd.def.triggerRadius + 0.8, 1.2);
      if (d < pd.def.triggerRadius + (pd.def.model === 'seeker' ? 2.2 : 0.6) && pd.age >= pd.def.armTime && !this.dodgedThreats.has(pd.id)) { blastIn = true; this.dodgedThreats.add(pd.id); }
    }
    if (this.dodgedThreats.size > 200) this.dodgedThreats.clear();
    if (!danger) for (const pk of world.pickups) {
      const mine = me.pos.distanceTo(pk.pos), theirs = seen.pos.distanceTo(pk.pos);
      if (mine < theirs + 1 && mine < 12) move.lerp(pk.pos.clone().sub(me.pos).setY(0).normalize(), 0.8);
    }
    // Overcharge Core: contest it when it is (about to be) online, hold it with small moves,
    // and never walk into an occupied pad while far behind on health (shoot the capturer instead).
    const ob = world.objective;
    const coreLive = !!ob && ob.untilTick >= 0;
    const foeCapturing = coreLive && seen.pos.distanceTo(ob!.pos) < ob!.radius && Math.abs(seen.pos.y - ob!.pos.y) < 1.6 && seen.mode !== 'down';
    // (a bomb or pod nearby only softens the pull toward the pad: dodging it must not mean abandoning the Core)
    if (ob && (coreLive || world.objectiveIn() <= (this.skill >= 0.5 ? 2.5 : 0))) {
      const toCore = ob.pos.clone().sub(me.pos).setY(0), dCore = toCore.length();
      const mine = me.hp / me.maxHp, theirs = foe.hp / foe.maxHp;
      const losing = mine < 0.3 && mine + 0.25 < theirs;
      if (!(losing && foeCapturing) && (dCore < 10 + 8 * this.skill || foeCapturing)) {
        const onPad = dCore < ob.radius - 0.5 && Math.abs(me.pos.y - ob.pos.y) < 1.2;
        if (danger) { if (!onPad) move.lerp(toCore.normalize(), 0.35); }
        else if (onPad) move.multiplyScalar(0.3).addScaledVector(toCore.normalize(), (dCore / ob.radius) * 0.7);
        else move.lerp(toCore.normalize(), 0.85);
      }
    }
    if (move.lengthSq() > 1) move.normalize();
    inp.moveX = move.x; inp.moveZ = move.z; inp.faceTarget = true;
    // Aerial specialists deliberately reposition; ground duelists save jumps for obstacles/danger.
    if (me.grounded && me.canAct && t >= this.mobilityAt && (danger || this.p.aerial && dist < range - 1)) {
      inp.jumpPressed = true; this.jumpUntil = t + (this.p.aerial ? 0.9 : 0.3); this.mobilityAt = t + 3.5;
    }
    // Hidden behind low cover for a while: jump-peek (the apex clears crates and walls) to open a firing lane.
    if (this.noLosT > THREE.MathUtils.lerp(2.2, 1.1, this.skill) && dist < 9 && me.grounded && me.canAct && t >= this.mobilityAt && this.skill >= 0.35) {
      inp.jumpPressed = true; this.jumpUntil = t + 0.7; this.mobilityAt = t + 2.2; this.decideAt = Math.min(this.decideAt, t + 0.25);
    }
    inp.jumpHeld = t < this.jumpUntil;
    // Phase Blink doubles as a dodge once the dash is spent (sideways, deterministic direction).
    const blinkOk = !!me.lo.skill.blink && me.skillCd <= 0 && this.skill >= 0.5 && me.castT < 0;
    const blinkAway = () => {
      inp.skillPressed = true;
      inp.skillTarget = [me.pos.x + side.x * this.strafeDir * 8, me.pos.y, me.pos.z + side.z * this.strafeDir * 8];
    };
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
      } else if (blinkOk && t >= this.mobilityAt) {
        blinkAway();
        this.mobilityAt = t + 1.2 + (1 - this.skill);
      }
    }
    if (this.seenProj.size > 200) this.seenProj.clear();
    if (blastIn && this.skill >= 0.35 && me.canAct && me.canDash && t >= this.mobilityAt - 0.6) {
      inp.dashPressed = true;
      const out = move.lengthSq() > 0.01 ? move.clone().normalize() : side.clone().multiplyScalar(this.strafeDir);
      inp.moveX = out.x; inp.moveZ = out.z;
      this.mobilityAt = t + 1 + (1 - this.skill);
    }
    // A ram wind-up is the loudest tell in the game: sidestep it (after the reaction delay) instead of eating it.
    if (seen.mode === 'charge' && seen.guard && dist < 8 && this.ramReadAt < seen.t - 0.6 && this.skill >= 0.35 && me.canAct && me.canDash && t >= this.mobilityAt - 0.6 && !inp.dashPressed) {
      inp.dashPressed = true; inp.moveX = side.x * this.strafeDir; inp.moveZ = side.z * this.strafeDir;
      this.ramReadAt = seen.t; this.mobilityAt = t + 1.2;
    }
    // Long-range specialists reset spacing when a brawler gets on top of them.
    if (this.p.range >= 12 && dist < 4 && this.skill >= 0.4 && me.canAct && me.canDash && t >= this.mobilityAt && !inp.dashPressed) {
      inp.dashPressed = true; const away = toN.clone().multiplyScalar(-0.8).addScaledVector(side, this.strafeDir * 0.6).normalize();
      inp.moveX = away.x; inp.moveZ = away.z; this.mobilityAt = t + 2;
    }
    // Read precision wind-ups, rather than magically dodging a hypersonic slug after release.
    if (seen.rail > 0.55 && this.skill >= 0.6 && me.canAct && me.canDash && t >= this.mobilityAt) {
      inp.dashPressed = true; inp.moveX = side.x * this.strafeDir; inp.moveZ = side.z * this.strafeDir;
      this.mobilityAt = t + 1.8;
    }
    // Skill wind-ups are a visible tell. Pilots dodge one aimed at them once their reaction time has passed;
    // a feint (dash-cancelled cast) can bait that dodge.
    if (foe.castT >= 0 && !foe.lo.skill.blink) { if (this.castSeenAt < 0) { this.castSeenAt = t; this.castDodged = false; } } else this.castSeenAt = -1;
    if (this.castSeenAt >= 0 && !this.castDodged && t - this.castSeenAt >= this.reaction && this.skill >= 0.5 && (me.canAct || me.castT >= 0) && (me.canDash || (blinkOk && me.canAct)) && t >= this.mobilityAt) {
      const ct = foe.castTarget;
      const ax = ct ? ct[0] - foe.pos.x : me.pos.x - foe.pos.x, az = ct ? ct[2] - foe.pos.z : me.pos.z - foe.pos.z;
      const mx = me.pos.x - foe.pos.x, mz = me.pos.z - foe.pos.z;
      const al = Math.hypot(ax, az) || 1, along = (mx * ax + mz * az) / al;
      const off = Math.abs(mx * az - mz * ax) / al;
      if (along > 0 && along < foe.lo.skill.range && off < foe.lo.skill.radius + 1.2) {
        if (me.canDash) { inp.dashPressed = true; inp.moveX = side.x * this.strafeDir; inp.moveZ = side.z * this.strafeDir; }
        else blinkAway();
        this.mobilityAt = t + 1.2; this.castDodged = true;
      }
    }
    // a pilot who has seen the tell stops starting attacks so the dash is free when it decides
    const readingTell = this.castSeenAt >= 0 && !this.castDodged && this.skill >= 0.5;
    if (readingTell) { this.holdGunUntil = 0; this.decideAt = Math.max(this.decideAt, t + 1 / 60); }
    if (this.feintPlan && me.castT >= 0 && me.castT <= me.lo.skill.cast * 0.6 && me.canDash) {
      inp.dashPressed = true; inp.moveX = side.x * this.strafeDir; inp.moveZ = side.z * this.strafeDir;
      this.feintPlan = false;
    }
    const canHit = !foe.isInvulnerable && foe.alive;
    const precision = g === 'rail' || g === 'beam';
    const comboReady = this.skill >= 0.45 && seen.comboReady;
    // This uses the same delayed observation as movement/guard reads. A visible
    // setup can invite a release, but never bypass charge power or normal CDs.
    if (g === 'beam' && comboReady && los && !seen.guard && me.holdFrac > 0) {
      const power = (me.lo.gun.holdMinFrac ?? .3) + (1 - (me.lo.gun.holdMinFrac ?? .3)) * me.holdFrac;
      if (power >= .75) this.holdGunUntil = Math.min(this.holdGunUntil, t);
    }
    if (t >= this.decideAt && t > 0.8 + this.reaction && canHit && me.canAct && !inp.dashPressed && !inp.chargePressed) {
      this.decideAt = t + this.reaction;
      const inRange = dist < (g === 'scatter' ? 6.5 : g === 'blaster' ? 27 : 34);
      // Rail waits for a setup when possible, but will probe straight movement at a measured cadence.
      const precisionOpening = g !== 'rail' || comboReady || vulnerable || foeCapturing || seen.vel.lengthSq() < 8 || t >= this.gunAt + 0.2;
      const setupPod = me.podCd <= 0 && me.lo.pod.model !== 'turret' && me.lo.pod.model !== 'interceptor' && dist < range + 3;
      const setupBomb = me.bombCd <= 0 && dist > 4 && dist < me.lo.bomb.range;
      const setupWindow = me.gunCd > 0 || t < this.gunAt || seen.guard || !los;
      const preferSetup = precision && this.skill >= .45 && !seen.primed && setupWindow && t >= this.utilityAt && (setupPod || setupBomb);
      // Skill shots go out at readable moments: a punish, a slow/straight target, or a combo finish.
      // Aim is deterministic: the delayed observation, led by a skill-scaled fraction of the travel time.
      const sk = me.lo.skill;
      const steady = seen.vel.lengthSq() < 9;
      const skillOpening = !sk.blink && me.skillCd <= 0 && t >= this.skillAt && los && !seen.guard && dist > 2.5 && dist < sk.range * 0.9 &&
        (sk.model === 'hook' ? dist > 6 && (vulnerable || steady || foeSpent || foeCapturing) : sk.detonator ? comboReady || vulnerable || steady || foeSpent || foeCapturing : vulnerable || steady || foeSpent || foeCapturing || dist < 10);
      if (skillOpening) {
        const lead = (dist / sk.speed + sk.cast) * THREE.MathUtils.lerp(0.4, 0.9, this.skill);
        inp.skillPressed = true;
        inp.skillTarget = [seen.pos.x + seen.vel.x * lead, seen.pos.y, seen.pos.z + seen.vel.z * lead];
        this.skillAt = t + 1 + this.p.utilityCadence * 0.25;
        // every third cast, a top trickster/champion fakes it while the opponent is holding a dash
        this.casts++;
        this.feintPlan = this.skill >= 0.7 && (this.personality === 'trickster' || this.personality === 'champion') &&
          this.casts % 3 === 0 && foe.dashCharges > 0 && !foeSpent;
      } else if (!preferSetup && los && inRange && !seen.guard && me.gunCd <= 0 && t >= this.gunAt && precisionOpening) {
        this.holdGunUntil = t + (me.lo.gun.holdMax ? (comboReady ? Math.max(.6, me.lo.gun.holdMin ?? 0) : vulnerable ? 0.45 : me.lo.gun.holdMax) : 0.12);
        this.gunAt = t + Math.max(0.08, (this.p.gunCadence - 0.3) * this.tempo) + me.lo.gun.cooldown + me.lo.gun.windup;
      } else if (t >= this.utilityAt) {
        // Bombers flush cover; trap specialists establish a lane before committing a gun shot.
        if (me.podCd <= 0 && (preferSetup ? setupPod : this.personality === 'trickster' || me.lo.pod.model === 'turret' || dist < range + 3)) {
          inp.podPressed = true; this.utilityAt = t + this.p.utilityCadence * this.tempo;
        } else if (me.bombCd <= 0 && dist > 4 && (preferSetup || !los || seen.guard || vulnerable || foeCapturing || dist > range + 3 || this.personality === 'bomber')) {
          inp.bombPressed = true; this.utilityAt = t + this.p.utilityCadence * this.tempo;
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
