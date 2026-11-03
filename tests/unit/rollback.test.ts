import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Fighter, emptyInput, type FighterInput } from '../../src/game/fighter';
import { World } from '../../src/game/world';
import { quantizeInput } from '../../src/game/replay';
import { resolveLoadout, GUNS, BOMBS, PODS, BODIES, LEGS, SKILLS, type Loadout } from '../../src/data/parts';
import type { ArenaBuild, BoxCollider, Collider } from '../../src/arena/types';
import { EventLedger, predictInput, sameInput } from '../../src/net/rollback';
import { encodeInput, decodeInput } from '../../src/net/online';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Small arena with a wall, a ramp-less ledge and a moving platform (arena.tick drives it from t). */
function testArena(): ArenaBuild {
  const lift: BoxCollider = { kind: 'box', min: V(6, -1, -2), max: V(9, 0.5, 2), vel: V(0, 0, 0) };
  const colliders: Collider[] = [
    { kind: 'box', min: V(-30, -1, -30), max: V(30, 0, 30) },
    { kind: 'box', min: V(-3, 0, -0.5), max: V(3, 2.5, 0.5) },
    { kind: 'box', min: V(-12, 0, -4), max: V(-8, 1.5, 4) },
    lift,
  ];
  return {
    info: { id: 'foundry', name: 't', subtitle: '', blurb: '', music: 'menu', accent: '#fff' },
    root: new THREE.Group(), colliders, hazards: [{
      center: V(0, 0, 10), radius: 2, yMin: -1, yMax: 1, damage: 30, down: 20,
      isActive: (t) => t % 4 > 3, isWarning: (t) => t % 4 > 2 && t % 4 <= 3, launch: 8,
    }], spawns: [V(0, 0, 8), V(0, 0, -8)],
    halfX: 17, halfZ: 17, background: new THREE.Color(), environment: null, fog: null, keyLight: new THREE.DirectionalLight(),
    tick(t: number, dt: number) {
      // a pure function of sim time, like the real arenas' lifts and cranes
      lift.max.y = 0.5 + Math.sin((t + dt) * 1.3) * 1.2;
      lift.vel!.set(0, Math.cos((t + dt) * 1.3) * 1.56, 0);
    },
    update() {}, dispose() {},
  };
}

/** Deterministic PRNG for the test's input streams. */
function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random-but-plausible player: held stick for a while, frequent action presses, some aimed casts. */
function inputStream(seed: number, n: number): FighterInput[] {
  const r = mulberry(seed);
  const out: FighterInput[] = [];
  let mx = 0, mz = 0, hold = 0, gun = false, jump = false;
  for (let i = 0; i < n; i++) {
    if (hold-- <= 0) {
      const a = r() * Math.PI * 2;
      const m = r() < 0.2 ? 0 : 0.4 + r() * 0.6;
      mx = Math.cos(a) * m; mz = Math.sin(a) * m; hold = 5 + Math.floor(r() * 30);
      gun = r() < 0.5; jump = r() < 0.2;
    }
    const i0: FighterInput = {
      ...emptyInput(), moveX: mx, moveZ: mz, gunHeld: gun, gunPressed: gun && r() < 0.2, jumpHeld: jump, jumpPressed: jump && r() < 0.1,
      dashPressed: r() < 0.03, bombPressed: r() < 0.02, podPressed: r() < 0.015, chargePressed: r() < 0.015, faceTarget: r() < 0.5,
    };
    if (i0.bombPressed && r() < 0.5) i0.bombTarget = [r() * 20 - 10, 0, r() * 20 - 10];
    if (r() < 0.015) { i0.skillPressed = true; if (r() < 0.5) i0.skillTarget = [r() * 24 - 12, 1, r() * 24 - 12]; }
    out.push(quantizeInput(i0));
  }
  return out;
}

function makeWorld(la: Loadout, lb: Loadout, pickups: boolean) {
  const a = new Fighter(0, resolveLoadout(la));
  const b = new Fighter(1, resolveLoadout(lb));
  a.pos.set(0, 0, 8);
  b.pos.set(0, 0, -8);
  const w = new World(testArena(), a, b, { arenaId: 'foundry', pickups });
  w.combatEnabled = true;
  return w;
}

const keys = <T>(o: Record<string, T>) => Object.keys(o);

/** Loadouts that, together, cover every gun, bomb, pod, body, legs and skill. */
function loadouts(): Loadout[] {
  const lists = [keys(GUNS), keys(BOMBS), keys(PODS), keys(BODIES), keys(LEGS), keys(SKILLS)];
  const n = Math.max(...lists.map((l) => l.length));
  return Array.from({ length: n }, (_, i) => ({
    gun: lists[0][i % lists[0].length], bomb: lists[1][(i + 1) % lists[1].length], pod: lists[2][(i + 2) % lists[2].length],
    body: lists[3][i % lists[3].length], legs: lists[4][(i + 3) % lists[4].length], skill: lists[5][i % lists[5].length],
  }));
}

describe('world snapshot / restore (rollback)', () => {
  const builds = loadouts();
  for (let c = 0; c < builds.length; c++) {
    const la = builds[c];
    const lb = builds[(c + 2) % builds.length];
    it(`re-simulates bit-identically: ${la.gun}/${la.bomb}/${la.pod}/${la.body}/${la.legs}/${la.skill} vs ${lb.skill}`, () => {
      const w = makeWorld(la, lb, c % 2 === 0);
      const N = 900;
      const sa = inputStream(c * 7 + 1, N), sb = inputStream(c * 7 + 2, N);
      let checked = 0;
      // walk the match in rollback-sized chunks: snapshot, run ahead, restore, run again, compare every tick
      for (let t = 0; t < N - 12;) {
        const M = 2 + ((t * 31 + c) % 11);
        const snap = w.snapshot();
        const first: number[] = [];
        for (let k = 0; k < M; k++) { w.step([sa[t + k], sb[t + k]]); first.push(w.digest()); }
        // a mispredicted run in between must not leak into the restored state
        w.restore(snap);
        for (let k = 0; k < M; k++) w.step([sb[t + k], sa[t + k]]);
        w.restore(snap);
        for (let k = 0; k < M; k++) {
          w.step([sa[t + k], sb[t + k]]);
          expect(w.digest()).toBe(first[k]);
          checked++;
        }
        t += M;
      }
      expect(checked).toBeGreaterThan(800);
      // the match actually exercised combat
      const [a, b] = w.fighters;
      expect(a.stats.shots + b.stats.shots).toBeGreaterThan(5);
      expect(a.hp < a.maxHp || b.hp < b.maxHp).toBe(true);
    });
  }

  it('matches a straight run that never rolled back', () => {
    const builds2 = loadouts();
    const N = 600;
    const sa = inputStream(91, N), sb = inputStream(92, N);
    const ref = makeWorld(builds2[1], builds2[3], true);
    const rb = makeWorld(builds2[1], builds2[3], true);
    for (let t = 0; t < N; t++) ref.step([sa[t], sb[t]]);
    // rollback run: predict the remote as "last input repeated", correct every 7 ticks
    const snaps: ReturnType<World['snapshot']>[] = [];
    let confirmed = 0;
    for (let t = 0; t < N; t++) {
      snaps[t] = rb.snapshot();
      rb.step([sa[t], sb[Math.max(0, Math.min(t, confirmed - 1))]]);
      if (t % 7 === 6) {
        rb.restore(snaps[confirmed]);
        for (let k = confirmed; k <= t; k++) { snaps[k] = rb.snapshot(); rb.step([sa[k], sb[k]]); }
        confirmed = t + 1;
      }
    }
    rb.restore(snaps[confirmed]);
    for (let k = confirmed; k < N; k++) rb.step([sa[k], sb[k]]);
    expect(rb.digest()).toBe(ref.digest());
    expect(rb.fighters.map((f) => f.hp)).toEqual(ref.fighters.map((f) => f.hp));
  });

  it('restores crates, colliders and traps in place', () => {
    const w = makeWorld(builds[0], builds[1], true);
    const crate = w.crates[0];
    expect(crate).toBeDefined();
    const snap = w.snapshot();
    const cols = w.colliders;
    const n = cols.length;
    // break the crate and spring a trap by hand, then roll back
    (w as unknown as { damageCrate(c: unknown, d: number, at: THREE.Vector3): void }).damageCrate(crate, 1e9, crate.pos.clone());
    expect(crate.alive).toBe(false);
    expect(cols.length).toBe(n - 1);
    w.traps[0].armedAt = 3;
    w.restore(snap);
    expect(w.crates[0]).toBe(crate);
    expect(crate.alive).toBe(true);
    expect(w.colliders).toBe(cols);
    expect(cols.length).toBe(n);
    expect(cols.includes(crate.collider)).toBe(true);
    expect(w.traps[0].armedAt).toBe(-1);
  });
});

describe('rollback helpers', () => {
  it('predicts held inputs and drops one-shot presses', () => {
    const last = quantizeInput({ ...emptyInput(), moveX: 0.5, gunHeld: true, gunPressed: true, dashPressed: true, jumpHeld: true, bombPressed: true, bombTarget: [1, 0, 2], faceTarget: true });
    const p = predictInput(last);
    expect(p.moveX).toBe(last.moveX);
    expect(p.gunHeld && p.jumpHeld && p.faceTarget).toBe(true);
    expect(p.gunPressed || p.dashPressed || p.bombPressed).toBe(false);
    expect(p.bombTarget).toBeUndefined();
    expect(sameInput(predictInput(undefined), emptyInput())).toBe(true);
    // a wire round trip of a prediction-equal input compares equal
    expect(sameInput(decodeInput(encodeInput(quantizeInput({ ...p }))), p)).toBe(true);
    expect(sameInput(p, last)).toBe(false);
  });

  it('shows each tick event once, plus only what a re-simulation adds', () => {
    const led = new EventLedger();
    const pos = V(0, 0, 0);
    const shot = { type: 'explosion', pos, radius: 1, color: 0, big: false, onGround: true } as const;
    const hit = { type: 'dodge', who: 1, pos, perfect: true } as const;
    expect(led.fresh(5, [shot, shot])).toHaveLength(2);
    // re-simulated tick 5: the same two explosions and a dodge the prediction missed
    expect(led.fresh(5, [shot, hit, shot])).toEqual([hit]);
    expect(led.fresh(5, [shot, shot, shot])).toHaveLength(1);
    led.prune(6);
    expect(led.fresh(5, [shot])).toHaveLength(1);
  });
});

describe('rollback with the Overcharge Core', () => {
  it('rewinding through a capture reproduces meters, captures and the reward', () => {
    const lo = { gun: 'blaster', bomb: 'mortar', pod: 'drone', body: 'striker', legs: 'runner', skill: Object.keys(SKILLS)[0] } as unknown as Loadout;
    const a = new Fighter(0, resolveLoadout(lo));
    const b = new Fighter(1, resolveLoadout(lo));
    a.pos.set(0, 0, 8);
    b.pos.set(0, 0, -14);
    const w = new World(testArena(), a, b, { arenaId: 'foundry', pickups: false, objective: true });
    w.combatEnabled = true;
    const o = w.objective!;
    o.pos.set(0, 0, 8);
    o.nextTick = 30;
    const idle = quantizeInput(emptyInput());
    const step = () => w.step([idle, idle]);
    for (let i = 0; i < 60; i++) step();
    const snap = w.snapshot();
    let captured = false;
    for (let i = 0; i < 200; i++) { step(); if (w.events.some((e) => e.type === 'objective' && e.phase === 'capture')) captured = true; }
    expect(captured).toBe(true);
    const straight = w.digest();
    const caps = [...o.captures];
    w.restore(snap);
    expect(o.captures).toEqual([0, 0]);
    for (let i = 0; i < 200; i++) step();
    expect(w.digest()).toBe(straight);
    expect(o.captures).toEqual(caps);
  });
});
