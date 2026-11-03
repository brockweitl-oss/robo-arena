/**
 * Shared headless fight harness for the balance lab and the AI audit (tests/balance).
 * Deterministic: a scenario index picks a declared situation (lane, layout, side), never a dice roll.
 */
import * as THREE from 'three';
import { Fighter, emptyInput, type FighterInput } from '../../src/game/fighter';
import { World } from '../../src/game/world';
import { resolveLoadout, type Loadout } from '../../src/data/parts';
import type { ArenaBuild, Collider } from '../../src/arena/types';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider => ({ kind: 'box', min: V(x0, y0, z0), max: V(x1, y1, z1) });

/** Symmetric test arena: floor, central block, four cover pieces, two raised decks with ramps. */
export function labArena(lane = 0): ArenaBuild {
  const colliders: Collider[] = [
    box(-20, -1, -20, 20, 0, 20),
    box(-1.5, 0, -1.5, 1.5, 2.2, 1.5),
    box(-7, 0, 4, -5, 2, 6), box(5, 0, -6, 7, 2, -4), box(5, 0, 4, 7, 1.5, 6), box(-7, 0, -6, -5, 1.5, -4),
    box(-18, 0, -5, -13, 3, 5), box(13, 0, -5, 18, 3, 5),
    { kind: 'ramp', min: V(-13, 0, -2), max: V(-9, 3, 2), axis: 'x', dir: -1 },
    { kind: 'ramp', min: V(9, 0, -2), max: V(13, 3, 2), axis: 'x', dir: 1 },
  ];
  return {
    info: { id: 'lab', name: 'lab', subtitle: '', blurb: '', music: 'menu', accent: '#fff' },
    root: new THREE.Group(), colliders, hazards: [], spawns: [V(lane, 0, 11), V(-lane, 0, -11)],
    halfX: 18, halfZ: 18, background: new THREE.Color(), environment: null, fog: null, keyLight: new THREE.DirectionalLight(),
    tick() {}, update() {}, dispose() {},
  };
}

export type Pilot = (w: World, me: Fighter, foe: Fighter) => FighterInput;
export interface FightResult {
  /** 1 A wins, 0 B wins, 0.5 draw. */
  score: number;
  ko: boolean;
  time: number;
  hpA: number;
  hpB: number;
  a: Fighter;
  b: Fighter;
  w: World;
}

/** Tactics layouts used as scenario variety (crates, low walls, trap pads, core position). */
export const LAYOUTS = ['lab', 'foundry', 'garden', 'orbital'] as const;
export const LANES = [-7, 0, 7, -3.5, 3.5, 10];

/** Declared scenario `s`: lane × layout. Side swapping is done by the caller. */
export function scenario(s: number) {
  return { lane: LANES[s % LANES.length], layout: LAYOUTS[Math.floor(s / LANES.length) % LAYOUTS.length] };
}

export function fight(a: Loadout, b: Loadout, pa: () => Pilot, pb: () => Pilot, s: number, opts: { timeLimit?: number; objective?: boolean; hpA?: number } = {}): FightResult {
  const fa = new Fighter(0, resolveLoadout(a));
  const fb = new Fighter(1, resolveLoadout(b));
  const sc = scenario(s);
  const ar = labArena(sc.lane);
  fa.pos.copy(ar.spawns[0]);
  fb.pos.copy(ar.spawns[1]);
  if (opts.hpA) fa.hp = Math.min(fa.maxHp, opts.hpA);
  const w = new World(ar, fa, fb, { arenaId: sc.layout, seed: s, objective: opts.objective ?? process.env.BALANCE_OBJECTIVE !== '0' });
  w.combatEnabled = true;
  const ia = pa(), ib = pb();
  const steps = (opts.timeLimit ?? 120) * 60;
  for (let i = 0; i < steps && w.koLoser < 0; i++) w.step([ia(w, fa, fb), ib(w, fb, fa)]);
  const ra = fa.hp / fa.maxHp, rb = fb.hp / fb.maxHp;
  const ko = w.koLoser >= 0;
  const score = w.koLoser === 1 ? 1 : w.koLoser === 0 ? 0 : w.koLoser === 2 ? 0.5 : Math.abs(ra - rb) < 0.02 ? 0.5 : ra > rb ? 1 : 0;
  return { score, ko, time: w.time, hpA: ra, hpB: rb, a: fa, b: fb, w };
}

/* ------------------------------------------------------------------ scripted "cheese" pilots */

const flat = (v: THREE.Vector3) => v.clone().setY(0);
/** Steer away from arena edges so scripted bots don't pin themselves (a human wouldn't). */
function edgeSafe(w: World, me: Fighter, dir: THREE.Vector3) {
  const m = 4;
  if (Math.abs(me.pos.x) > w.arena.halfX - m || Math.abs(me.pos.z) > w.arena.halfZ - m) {
    const inward = flat(me.pos).multiplyScalar(-1).normalize();
    // slide along the wall instead of into it: keep the tangential part, add inward
    dir.addScaledVector(inward, 1.2);
  }
  if (dir.lengthSq() > 1) dir.normalize();
  return dir;
}
function base(): FighterInput { const i = emptyInput(); i.faceTarget = true; return i; }
function press(i: FighterInput, me: Fighter, k: 'gun' | 'bomb' | 'pod' | 'skill' | 'charge', state: { t: number }) {
  // mash at ~7.5 presses/s like a human hammering a button
  if (Math.floor(state.t * 7.5) % 2 === 0) {
    if (k === 'gun') { i.gunPressed = true; i.gunHeld = true; }
    if (k === 'bomb') i.bombPressed = true;
    if (k === 'pod') i.podPressed = true;
    if (k === 'skill') i.skillPressed = true;
    if (k === 'charge') i.chargePressed = true;
  } else if (k === 'gun' && me.lo.gun.holdMax) i.gunHeld = false;
}

export const CHEESE: Record<string, () => Pilot> = {
  /** Does nothing: time-to-kill baseline. */
  idle: () => () => emptyInput(),
  /** Hold forward and mash the charge button (ram spam). */
  ramspam: () => { const st = { t: 0 }; return (w, me, foe) => {
    st.t = w.time; const i = base(); const d = flat(foe.pos.clone().sub(me.pos));
    const dist = d.length(); d.normalize(); i.moveX = d.x; i.moveZ = d.z;
    if (dist < 7) press(i, me, 'charge', st); else press(i, me, 'gun', st);
    return i; }; },
  /** Back-pedal away at all times, firing gun/bomb/pod whenever possible. */
  kite: () => { const st = { t: 0 }; let side = 1, flip = 0; return (w, me, foe) => {
    st.t = w.time; const i = base(); const away = flat(me.pos.clone().sub(foe.pos)).normalize();
    if (w.time > flip) { side = -side; flip = w.time + 3; }
    const tan = new THREE.Vector3(away.z, 0, -away.x).multiplyScalar(side * 0.6);
    const d = edgeSafe(w, me, away.add(tan)); i.moveX = d.x; i.moveZ = d.z;
    press(i, me, 'gun', st); i.bombPressed = true; i.podPressed = true;
    return i; }; },
  /** Hold 14–18 m, strafe, and throw every bomb/pod/skill on cooldown. */
  zoner: () => { const st = { t: 0 }; let side = 1, flip = 0; return (w, me, foe) => {
    st.t = w.time; const i = base(); const to = flat(foe.pos.clone().sub(me.pos)); const dist = to.length(); to.normalize();
    if (w.time > flip) { side = -side; flip = w.time + 2.2; }
    const d = new THREE.Vector3(to.z, 0, -to.x).multiplyScalar(side).addScaledVector(to, dist > 18 ? 0.8 : dist < 14 ? -0.8 : 0);
    edgeSafe(w, me, d); i.moveX = d.x; i.moveZ = d.z;
    i.bombPressed = true; i.podPressed = true; press(i, me, 'gun', st); if (w.time % 1 < 0.02) i.skillPressed = true;
    return i; }; },
  /** Run to the Overcharge Core pad and sit on it, shooting. */
  corecamp: () => { const st = { t: 0 }; return (w, me, foe) => {
    st.t = w.time; const i = base(); const o = w.objective;
    const goal = o ? o.pos : new THREE.Vector3();
    const d = flat(goal.clone().sub(me.pos)); const l = d.length();
    if (l > 0.6) { d.normalize(); i.moveX = d.x; i.moveZ = d.z; if (me.grounded && goal.y - me.pos.y > 0.8 && w.time % 0.5 < 0.02) i.jumpPressed = true; i.jumpHeld = true; }
    press(i, me, 'gun', st); i.bombPressed = true; i.podPressed = true;
    if (foe.pos.distanceTo(me.pos) < 4) i.chargePressed = true;
    return i; }; },
  /** Stay airborne (jump + hover) and fire. */
  airspam: () => { const st = { t: 0 }; let side = 1, flip = 0; return (w, me, foe) => {
    st.t = w.time; const i = base(); const to = flat(foe.pos.clone().sub(me.pos)); to.normalize();
    if (w.time > flip) { side = -side; flip = w.time + 2.5; }
    const d = edgeSafe(w, me, new THREE.Vector3(to.z, 0, -to.x).multiplyScalar(side)); i.moveX = d.x; i.moveZ = d.z;
    i.jumpPressed = me.grounded || w.time % 0.6 < 0.02; i.jumpHeld = true;
    press(i, me, 'gun', st); i.bombPressed = true;
    return i; }; },
  /** Walk at the target and mash every button. */
  mash: () => { const st = { t: 0 }; return (w, me, foe) => {
    st.t = w.time; const i = base(); const d = flat(foe.pos.clone().sub(me.pos)); const dist = d.length(); d.normalize();
    i.moveX = d.x; i.moveZ = d.z;
    press(i, me, 'gun', st); i.bombPressed = true; i.podPressed = true; i.skillPressed = dist < 18;
    if (dist < 5) i.chargePressed = true;
    if (w.time % 1.3 < 0.02) i.dashPressed = true;
    return i; }; },
  /** Circle-strafe at mid range, dashing on a fixed rhythm, firing. */
  circle: () => { const st = { t: 0 }; let side = 1, flip = 0; return (w, me, foe) => {
    st.t = w.time; const i = base(); const to = flat(foe.pos.clone().sub(me.pos)); const dist = to.length(); to.normalize();
    if (w.time > flip) { side = -side; flip = w.time + 4; }
    const d = new THREE.Vector3(to.z, 0, -to.x).multiplyScalar(side).addScaledVector(to, dist > 11 ? 0.5 : dist < 7 ? -0.5 : 0);
    edgeSafe(w, me, d); i.moveX = d.x; i.moveZ = d.z;
    press(i, me, 'gun', st); if (w.time % 2 < 0.02) i.dashPressed = true; if (w.time % 3 < 0.02) i.bombPressed = true;
    return i; }; },
  /** Hide behind the nearest cover from the foe and only lob bombs/pods (cover camping). */
  turtle: () => { return (w, me, foe) => {
    const i = base();
    let best: THREE.Vector3 | null = null, bd = 1e9;
    for (const c of w.colliders) { if (c.kind !== 'box') continue; const cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2;
      if (c.max.y - c.min.y < 1.3 || c.min.y > 0.5 || Math.abs(cx) > 16 || Math.abs(cz) > 16 || c.max.x - c.min.x > 10) continue;
      const hide = new THREE.Vector3(cx, 0, cz).add(new THREE.Vector3(cx - foe.pos.x, 0, cz - foe.pos.z).normalize().multiplyScalar(2));
      const dd = hide.distanceTo(me.pos); if (dd < bd) { bd = dd; best = hide; } }
    if (best) { const d = flat(best.clone().sub(me.pos)); if (d.length() > 0.4) { d.normalize(); i.moveX = d.x; i.moveZ = d.z; } }
    i.bombPressed = true; i.podPressed = true;
    return i; }; },
};
