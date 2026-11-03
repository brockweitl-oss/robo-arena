import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Fighter, emptyInput, MOVE, PACE, moveWeight, type FighterInput } from '../../src/game/fighter';
import { resolveLoadout, DEFAULT_LOADOUT, BODIES, LEGS, type Loadout } from '../../src/data/parts';
import type { Collider } from '../../src/arena/types';

const DT = 1 / 60;
const floor: Collider = { kind: 'box', min: new THREE.Vector3(-200, -1, -200), max: new THREE.Vector3(200, 0, 200) };
const LIGHT: Loadout = { gun: 'homer', bomb: 'bouncer', pod: 'seeker', body: 'wisp', legs: 'feather', skill: 'lance' };
const HEAVY: Loadout = { gun: 'rail', bomb: 'napalm', pod: 'turret', body: 'ironclad', legs: 'anchor', skill: 'lance' };

function rig(lo: Loadout = DEFAULT_LOADOUT) {
  const a = new Fighter(0, resolveLoadout(lo));
  const b = new Fighter(1, resolveLoadout(DEFAULT_LOADOUT));
  a.pos.set(0, 0, 0);
  b.pos.set(0, 0, 150); // far away: nothing interacts
  return { a, b };
}
const tick = (a: Fighter, b: Fighter, inp: Partial<FighterInput> = {}) => a.step(DT, { ...emptyInput(), ...inp }, b, [floor], 190, 190);
const hspeed = (f: Fighter) => Math.hypot(f.vel.x, f.vel.z);
/** Settle on the floor first so every test starts grounded and at rest. */
function settled(lo?: Loadout) {
  const r = rig(lo);
  for (let i = 0; i < 10; i++) tick(r.a, r.b);
  return r;
}

describe('weighted ground movement', () => {
  it('reaches top speed in ~0.2-0.32 s, not instantly', () => {
    const { a, b } = settled();
    let t = 0;
    while (hspeed(a) < a.runSpeed * 0.98 && t < 2) { tick(a, b, { moveX: 1 }); t += DT; }
    expect(t).toBeGreaterThanOrEqual(0.2);
    expect(t).toBeLessThanOrEqual(0.32);
    // and the first step still bites (not a slow ramp from zero)
    const r = settled();
    tick(r.a, r.b, { moveX: 1 });
    expect(hspeed(r.a)).toBeGreaterThan(r.a.runSpeed * 0.07);
  });

  it('coasts to a short stop when the stick is released', () => {
    const { a, b } = settled();
    for (let i = 0; i < 60; i++) tick(a, b, { moveX: 1 });
    const x0 = a.pos.x;
    let t = 0;
    while (hspeed(a) > 0.01 && t < 2) { tick(a, b); t += DT; }
    const slide = a.pos.x - x0;
    expect(t).toBeGreaterThanOrEqual(0.15);
    expect(t).toBeLessThanOrEqual(0.26);
    expect(slide).toBeGreaterThan(0.5);
    expect(slide).toBeLessThan(1.2);
  });

  it('a hard reversal plants (faster than coasting), emits one skid, and runs the other way', () => {
    const { a, b } = settled();
    for (let i = 0; i < 60; i++) tick(a, b, { moveX: 1 });
    let skids = 0;
    let t = 0;
    while (a.vel.x > 0 && t < 2) {
      tick(a, b, { moveX: -1 });
      skids += a.events.filter((e) => e.type === 'skid').length;
      t += DT;
    }
    expect(skids).toBe(1);
    expect(t).toBeLessThan(0.16); // stronger than the ~0.19 s coast, but not a dime-turn
    expect(t).toBeGreaterThan(0.06);
  });

  it('heavy builds start, stop and turn slower than light builds', () => {
    const light = settled(LIGHT), heavy = settled(HEAVY);
    expect(moveWeight(light.a.st.mass)).toBeLessThan(1);
    expect(moveWeight(heavy.a.st.mass)).toBeGreaterThan(1);
    expect(light.a.weight).toBeGreaterThanOrEqual(MOVE.weightMin);
    expect(heavy.a.weight).toBeLessThanOrEqual(MOVE.weightMax);
    for (let i = 0; i < 6; i++) { tick(light.a, light.b, { moveX: 1 }); tick(heavy.a, heavy.b, { moveX: 1 }); }
    const lf = hspeed(light.a) / light.a.runSpeed, hf = hspeed(heavy.a) / heavy.a.runSpeed;
    expect(hf).toBeLessThan(lf * 0.8);
    // facing: same 180° turn request, the light build gets there first
    light.a.yaw = 0; heavy.a.yaw = 0;
    const yawAfter = (r: { a: Fighter; b: Fighter }) => { for (let i = 0; i < 6; i++) tick(r.a, r.b, { moveZ: -1 }); return Math.abs(r.a.yaw); };
    expect(yawAfter(light)).toBeGreaterThan(yawAfter(heavy));
  });

  it('dash start is still instant: full dash speed on the first tick', () => {
    const { a, b } = settled();
    tick(a, b, { dashPressed: true, moveX: 1 });
    expect(a.mode).toBe('dash');
    expect(hspeed(a)).toBeGreaterThanOrEqual(a.st.dashSpeed * PACE * 0.99);
  });

  it('dash exit carries speed into running instead of snapping to a crawl', () => {
    const { a, b } = settled();
    tick(a, b, { dashPressed: true, moveX: 1 });
    while (a.mode === 'dash') tick(a, b, { moveX: 1 });
    expect(hspeed(a)).toBeGreaterThan(a.runSpeed * 0.9);
    expect(hspeed(a)).toBeLessThanOrEqual(a.runSpeed * MOVE.dashExitCarry + 1e-6);
    // recovery still blocks actions
    expect(a.attackCommitted).toBe(true);
  });

  it('a dash-jump carries more horizontal speed than a standing or running jump, capped', () => {
    const stand = settled();
    tick(stand.a, stand.b, { jumpPressed: true, jumpHeld: true });
    expect(stand.a.mode).toBe('air');
    const standing = hspeed(stand.a);

    const run = settled();
    for (let i = 0; i < 60; i++) tick(run.a, run.b, { moveX: 1 });
    tick(run.a, run.b, { moveX: 1, jumpPressed: true, jumpHeld: true });
    const running = hspeed(run.a);

    const dj = settled();
    tick(dj.a, dj.b, { dashPressed: true, moveX: 1 });
    let n = 0;
    while (dj.a.mode === 'dash' && n++ < 60) tick(dj.a, dj.b, { moveX: 1, jumpPressed: n === 9, jumpHeld: true });
    expect(dj.a.mode).toBe('air');
    expect(dj.a.vel.y).toBeGreaterThan(0);
    const dashJump = hspeed(dj.a);
    expect(dashJump).toBeGreaterThan(standing + 5);
    expect(dashJump).toBeGreaterThan(running);
    expect(dashJump).toBeLessThanOrEqual(dj.a.runSpeed * MOVE.dashJumpCarry + 1e-6);
    // the carry decays in the air: no cross-map fling
    for (let i = 0; i < 30; i++) tick(dj.a, dj.b, { moveX: 1, jumpHeld: false });
    expect(hspeed(dj.a)).toBeLessThan(dashJump);
  });

  it('attack slow-downs ease in over ~0.1 s and land on the same cap', () => {
    const { a, b } = settled({ ...DEFAULT_LOADOUT, gun: 'rail' });
    for (let i = 0; i < 60; i++) tick(a, b, { moveX: 1 });
    const before = hspeed(a);
    tick(a, b, { moveX: 1, gunPressed: true });
    const first = hspeed(a);
    expect(first).toBeLessThan(before);
    expect(first).toBeGreaterThan(a.runSpeed * 0.5); // not an instant snap
    for (let i = 0; i < 7; i++) tick(a, b, { moveX: 1 });
    expect(hspeed(a)).toBeLessThanOrEqual(a.runSpeed * 0.12 + 1e-6);
  });

  it('is deterministic: identical inputs give identical positions', () => {
    const script = (i: number): Partial<FighterInput> => ({
      moveX: Math.sin(i * 0.07), moveZ: i % 90 < 45 ? 1 : -1,
      dashPressed: i % 70 === 10, jumpPressed: i % 55 === 20, jumpHeld: i % 55 >= 20 && i % 55 < 30,
      gunPressed: i % 40 === 5, faceTarget: i % 100 > 60,
    });
    const run = () => {
      const { a, b } = settled();
      const out: number[] = [];
      for (let i = 0; i < 400; i++) { tick(a, b, script(i)); out.push(a.pos.x, a.pos.y, a.pos.z, a.yaw); }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('a plain hop never has landing lag on any build; a double-jump landing still does', () => {
    const land = (lo: Loadout, double: boolean) => {
      const { a, b } = settled(lo);
      tick(a, b, { jumpPressed: true, jumpHeld: true });
      for (let i = 0; i < 400; i++) {
        tick(a, b, double && i === 20 ? { jumpPressed: true } : {});
        const e = a.events.find((x) => x.type === 'land');
        if (e && e.type === 'land') return { hard: e.hard, landT: a.landT };
      }
      throw new Error('never landed');
    };
    for (const body of Object.keys(BODIES)) for (const legs of Object.keys(LEGS)) {
      const lo = { ...DEFAULT_LOADOUT, body, legs } as Loadout;
      const hop = land(lo, false);
      expect(hop.hard, `${body}/${legs} hop`).toBe(false);
      expect(hop.landT).toBe(0);
      expect(land(lo, true).hard, `${body}/${legs} double jump`).toBe(true);
    }
  });
});
