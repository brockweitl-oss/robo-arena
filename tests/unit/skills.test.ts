import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Fighter, emptyInput, type FighterInput } from '../../src/game/fighter';
import { World } from '../../src/game/world';
import { AIPilot } from '../../src/game/ai';
import { DEFAULT_LOADOUT, resolveLoadout, SKILLS, type Loadout } from '../../src/data/parts';
import { InputRecorder, InputPlayer, quantizeInput } from '../../src/game/replay';
import type { ArenaBuild } from '../../src/arena/types';

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function setup(lo: Partial<Loadout> = {}) {
  const arena = { info: { id: 'test' }, root: new THREE.Group(), colliders: [{ kind: 'box', min: v(-30, -1, -30), max: v(30, 0, 30) }],
    hazards: [], spawns: [v(0, 0, -8), v(0, 0, 8)], halfX: 28, halfZ: 28, tick() {} } as unknown as ArenaBuild;
  const a = new Fighter(0, resolveLoadout({ ...DEFAULT_LOADOUT, ...lo }));
  const b = new Fighter(1, resolveLoadout(DEFAULT_LOADOUT));
  a.pos.set(0, 0, -8); b.pos.set(0, 0, 8); b.yaw = Math.PI;
  const w = new World(arena, a, b); w.combatEnabled = true;
  for (let i = 0; i < 5; i++) w.step([emptyInput(), emptyInput()]);
  return { a, b, w };
}
const step = (w: World, n: number, a: Partial<FighterInput> = {}) => { for (let i = 0; i < n; i++) w.step([{ ...emptyInput(), ...a }, emptyInput()]); };
const skillShot = (w: World) => w.projectiles.find((p) => p.spec.skill);

describe('skill shots (aimed abilities vs the auto-aimed gun)', () => {
  it('a quick-cast fires straight at the target after a telegraphed cast, never homing', () => {
    const { w, a } = setup();
    step(w, 1, { skillPressed: true });
    expect(a.castT).toBeGreaterThan(0);
    expect(skillShot(w)).toBeUndefined();
    step(w, 10);
    const p = skillShot(w)!;
    expect(p).toBeTruthy();
    expect(p.spec.homing).toBe(0);
    expect(p.vel.z).toBeGreaterThan(Math.abs(p.vel.x) * 10);
    expect(a.skillCd).toBeGreaterThan(SKILLS.lance.cooldown - 1);
  });

  it('an aimed release fires toward the aim point, not the target', () => {
    const { w } = setup();
    step(w, 1, { skillPressed: true, skillTarget: [12, 0, -8] });
    step(w, 10);
    const p = skillShot(w)!;
    expect(p.vel.x).toBeGreaterThan(Math.abs(p.vel.z) * 5);
    expect(p.vel.y).toBeCloseTo(0, 5);
  });

  it('getting knocked out of the cast cancels the shot (the cooldown is still spent)', () => {
    const { w, a, b } = setup();
    step(w, 1, { skillPressed: true });
    w.applyHit(a, b.id, { damage: 40, down: 999, dir: v(0, 0, -1), knock: 6, heavy: true, source: 'gun' }, a.chestPoint(), 0);
    step(w, 30);
    expect(skillShot(w)).toBeUndefined();
    expect(a.castT).toBe(-1);
  });

  it('the harpoon reels the target in', () => {
    const { w, a, b } = setup({ skill: 'hook' });
    const d0 = a.pos.distanceTo(b.pos);
    step(w, 1, { skillPressed: true });
    step(w, 80);
    expect(a.stats.skillHits).toBe(1);
    expect(a.pos.distanceTo(b.pos)).toBeLessThan(d0 - 4);
  });

  it('the frost spike slows the target for a fixed time', () => {
    const { w, a, b } = setup({ skill: 'frost' });
    step(w, 1, { skillPressed: true });
    step(w, 30);
    expect(a.stats.skillHits).toBe(1);
    expect(b.slowT).toBeGreaterThan(0);
    expect(b.runSpeed).toBeLessThan(b.st.runSpeed);
  });

  it('the Breaker Lance detonates an armed primer', () => {
    const { w, a, b } = setup();
    b.prime(0);
    b.primer!.armed = true;
    b.primer!.armTicks = 0;
    step(w, 1, { skillPressed: true });
    step(w, 30);
    expect(a.stats.combos).toBe(1);
  });

  it('replays store the skill press and its aim exactly', () => {
    const rec = new InputRecorder();
    const ins = [
      { ...emptyInput(), skillPressed: true, skillTarget: [7.3, 0.5, -12.6] as const },
      { ...emptyInput(), skillPressed: true },
      { ...emptyInput(), moveX: 1, bombPressed: true, bombTarget: [3, 0, 4] as const },
    ].map((i) => quantizeInput({ ...i }));
    for (const i of ins) rec.push(i);
    const pl = new InputPlayer(rec.encode());
    for (const i of ins) {
      const o = pl.next();
      expect(o.skillPressed).toBe(i.skillPressed);
      expect(o.skillTarget).toEqual(i.skillTarget);
      expect(o.bombTarget).toEqual(i.bombTarget);
    }
  });

  it('the AI casts aimed skills, deterministically', () => {
    const run = () => {
      const { w, a, b } = setup();
      const ai = new AIPilot('champion', 1, 3);
      const casts: number[] = [];
      for (let i = 0; i < 60 * 30 && a.alive && b.alive; i++) {
        const before = b.stats.skillCasts;
        w.step([emptyInput(), ai.think(w, b, a)]);
        if (b.stats.skillCasts > before) casts.push(i);
      }
      return casts;
    };
    const first = run();
    expect(first.length).toBeGreaterThan(0);
    expect(run()).toEqual(first);
  });
});
