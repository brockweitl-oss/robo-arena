import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { moveAndCollide, rampHeight, segmentHit, surfaceAt } from '../../src/game/collision';
import { Fighter, emptyInput, type FighterInput } from '../../src/game/fighter';
import { World, SIM_DT } from '../../src/game/world';
import { resolveLoadout, DEFAULT_LOADOUT, GUNS, BOMBS, PODS, BODIES, LEGS } from '../../src/data/parts';
import type { ArenaBuild, Collider } from '../../src/arena/types';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const floor: Collider = { kind: 'box', min: V(-30, -1, -30), max: V(30, 0, 30) };

function testArena(extra: Collider[] = []): ArenaBuild {
  return {
    info: { id: 't', name: 't', subtitle: '', blurb: '', music: 'menu', accent: '#fff' },
    root: new THREE.Group(), colliders: [floor, ...extra], hazards: [], spawns: [V(0, 0, 8), V(0, 0, -8)],
    halfX: 18, halfZ: 18, background: new THREE.Color(), environment: null, fog: null, keyLight: new THREE.DirectionalLight(),
    tick() {}, update() {}, dispose() {},
  };
}

function makeWorld(extra: Collider[] = []) {
  const a = new Fighter(0, resolveLoadout(DEFAULT_LOADOUT));
  const b = new Fighter(1, resolveLoadout(DEFAULT_LOADOUT));
  a.pos.set(0, 0, 8);
  b.pos.set(0, 0, -8);
  const w = new World(testArena(extra), a, b);
  w.combatEnabled = true;
  return { w, a, b };
}

const run = (w: World, n: number, ia: Partial<FighterInput> = {}, ib: Partial<FighterInput> = {}) => {
  for (let i = 0; i < n; i++) w.step([{ ...emptyInput(), ...ia }, { ...emptyInput(), ...ib }]);
};

describe('collision', () => {
  it('lands on the floor and reports grounded', () => {
    const p = V(0, 3, 0);
    const v = V(0, 0, 0);
    let grounded = false;
    for (let i = 0; i < 120 && !grounded; i++) {
      v.y -= 34 * SIM_DT;
      grounded = moveAndCollide(p, v, SIM_DT, 0.5, 2, [floor], false, 18, 18).grounded;
    }
    expect(grounded).toBe(true);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it('blocks walking through a tall box', () => {
    const wall: Collider = { kind: 'box', min: V(-2, 0, 2), max: V(2, 3, 3) };
    const p = V(0, 0, 0);
    for (let i = 0; i < 60; i++) moveAndCollide(p, V(0, 0, 10), SIM_DT, 0.5, 2, [floor, wall], true, 18, 18);
    expect(p.z).toBeLessThanOrEqual(1.5 + 1e-6);
  });

  it('walks up a ramp', () => {
    const ramp: Collider = { kind: 'ramp', min: V(-2, 0, 2), max: V(2, 3, 8), axis: 'z', dir: 1 };
    expect(rampHeight(ramp as any, 0, 5)).toBeCloseTo(1.5);
    const p = V(0, 0, 0);
    let g = true;
    for (let i = 0; i < 70; i++) g = moveAndCollide(p, V(0, -1, 8), SIM_DT, 0.5, 2, [floor, ramp], g, 18, 18).grounded;
    expect(p.z).toBeGreaterThan(6);
    expect(p.y).toBeGreaterThan(2);
  });

  it('clamps to arena bounds', () => {
    const p = V(17.9, 0, 0);
    moveAndCollide(p, V(50, 0, 0), SIM_DT, 0.5, 2, [floor], true, 18, 18);
    expect(p.x).toBeLessThanOrEqual(17.5);
  });

  it('segment hits a box with the right normal', () => {
    const box: Collider = { kind: 'box', min: V(-1, 0, -1), max: V(1, 2, 1) };
    const h = segmentHit(V(0, 1, 5), V(0, 1, -5), [box]);
    expect(h).not.toBeNull();
    expect(h!.point.z).toBeCloseTo(1);
    expect(h!.normal.z).toBe(1);
    expect(surfaceAt(box, 0, 0)).toBe(2);
  });
});

describe('fighter', () => {
  it('jumps, double-jumps and lands', () => {
    const { w, a } = makeWorld();
    run(w, 2);
    expect(a.grounded).toBe(true);
    run(w, 1, { jumpPressed: true, jumpHeld: true });
    expect(a.grounded).toBe(false);
    run(w, 15);
    const y1 = a.pos.y;
    run(w, 1, { jumpPressed: true });
    run(w, 10);
    expect(a.pos.y).toBeGreaterThan(y1);
    run(w, 120);
    expect(a.grounded).toBe(true);
    expect(a.mode).toBe('ground');
  });

  it('buffers a jump pressed just before landing', () => {
    const { w, a } = makeWorld();
    a.pos.y = 0.4;
    a.grounded = false;
    a.setMode('air');
    run(w, 1, { jumpPressed: true });
    run(w, 8);
    expect(a.vel.y).toBeGreaterThan(0);
  });

  it('dashes faster than running', () => {
    const { w, a } = makeWorld();
    run(w, 1, { moveX: 1, dashPressed: true });
    expect(a.mode).toBe('dash');
    expect(Math.abs(a.vel.x)).toBeGreaterThan(a.runSpeed * 1.5);
  });

  it('knocks down when the down gauge fills, then is invulnerable', () => {
    const { a } = makeWorld();
    const dir = V(0, 0, -1);
    let knocked = false;
    for (let i = 0; i < 10 && a.mode !== 'down'; i++) {
      a.hitstop = 0;
      knocked = a.takeHit({ damage: 30, down: 20, dir, knock: 2, heavy: false, source: 'gun' }).knockdown;
    }
    expect(a.mode).toBe('down');
    expect(knocked).toBe(true);
    expect(a.isInvulnerable).toBe(true);
    const hp = a.hp;
    expect(a.takeHit({ damage: 50, down: 10, dir, knock: 2, heavy: false, source: 'gun' }).applied).toBe(false);
    expect(a.hp).toBe(hp);
  });

  it('reports KO at zero HP', () => {
    const { a } = makeWorld();
    const r = a.takeHit({ damage: 99999, down: 0, dir: V(1, 0, 0), knock: 1, heavy: true, source: 'bomb' });
    expect(r.ko).toBe(true);
    expect(a.hp).toBe(0);
  });
});

describe('world combat', () => {
  it('a gun burst damages the opponent', () => {
    const { w, b } = makeWorld();
    run(w, 1, { gunPressed: true, gunHeld: true });
    run(w, 90);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('cover blocks shots', () => {
    const wall: Collider = { kind: 'box', min: V(-3, 0, -1), max: V(3, 4, 1) };
    const { w, b } = makeWorld([wall]);
    run(w, 1, { gunPressed: true, gunHeld: true });
    run(w, 90);
    expect(b.hp).toBe(b.maxHp);
  });

  it('bombs arc over cover and explode near the target', () => {
    const wall: Collider = { kind: 'box', min: V(-3, 0, -1), max: V(3, 2, 1) };
    const { w, b } = makeWorld([wall]);
    let exploded = false;
    run(w, 1, { bombPressed: true });
    for (let i = 0; i < 150; i++) {
      run(w, 1);
      if (w.events.some((e) => e.type === 'explosion')) exploded = true;
    }
    expect(exploded).toBe(true);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('pods hunt the target', () => {
    const { w, b } = makeWorld();
    run(w, 1, { podPressed: true });
    run(w, 60 * 6);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('is deterministic for identical inputs', () => {
    const go = () => {
      const { w, a, b } = makeWorld();
      for (let i = 0; i < 300; i++)
        w.step([
          { ...emptyInput(), moveX: Math.sin(i * 0.1), gunPressed: i % 40 === 0, gunHeld: true, bombPressed: i === 100 },
          { ...emptyInput(), moveZ: Math.cos(i * 0.07), jumpPressed: i % 70 === 0 },
        ]);
      return [a.pos.toArray(), b.pos.toArray(), a.hp, b.hp];
    };
    expect(go()).toEqual(go());
  });
});

describe('part catalog', () => {
  it('has the required part counts with sane stats', () => {
    expect(Object.keys(GUNS).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(BOMBS).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(PODS).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(BODIES).length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(LEGS).length).toBeGreaterThanOrEqual(1);
    for (const g of Object.values(GUNS)) expect(g.damage * g.burst * g.pellets).toBeGreaterThan(0);
    for (const b of Object.values(BODIES)) expect(b.hp).toBeGreaterThanOrEqual(800);
  });
});

describe('play-test 1 fixes', () => {
  it('emits knockdown events raised during combat', () => {
    const { w, b } = makeWorld();
    b.down = 99;
    let seen = false;
    run(w, 1, { gunPressed: true, gunHeld: true });
    for (let i = 0; i < 90 && !seen; i++) {
      run(w, 1);
      seen = w.events.some((e) => e.type === 'fighter' && e.who === 1 && e.ev.type === 'knockdown');
    }
    expect(seen).toBe(true);
  });

  it('perfect dodge: a dash at the right moment lets shots pass through', () => {
    const { w, a, b } = makeWorld();
    a.pos.set(0, 0, 3);
    b.pos.set(0, 0, -3);
    run(w, 1, {}, { gunPressed: true, gunHeld: true });
    let perfect = false;
    for (let i = 0; i < 40; i++) {
      a.dashIframe = 0.1; // hold the dodge window open
      run(w, 1);
      if (w.events.some((e) => e.type === 'dodge' && e.perfect)) perfect = true;
    }
    expect(perfect).toBe(true);
    expect(a.hp).toBe(a.maxHp);
  });

  it('charge guard deflects frontal shots back at the shooter', () => {
    const { w, a, b } = makeWorld();
    a.pos.set(0, 0, 6);
    b.pos.set(0, 0, -6);
    a.yaw = Math.PI; // face the shooter (-z)
    run(w, 1, { chargePressed: true }, { gunPressed: true, gunHeld: true });
    let deflected = false;
    for (let i = 0; i < 25; i++) {
      run(w, 1);
      if (w.events.some((e) => e.type === 'deflect')) deflected = true;
    }
    expect(deflected).toBe(true);
    expect(a.hp).toBe(a.maxHp);
  });

  it('charge guard turns blast damage into chip damage without flinching', () => {
    const { a } = makeWorld();
    a.setMode('charge');
    a.chargePhase = 1;
    const r = a.takeHit({ damage: 100, down: 50, dir: new THREE.Vector3(0, 0, 1), knock: 6, heavy: true, source: 'bomb' });
    expect(r.blocked).toBe(true);
    expect(a.hp).toBe(a.maxHp - 30);
    expect(a.mode).toBe('charge');
  });
});
