import { it, expect } from 'vitest';
import * as THREE from 'three';
import { Fighter, emptyInput, type FighterInput } from '../../src/game/fighter';
import { DEFAULT_LOADOUT, resolveLoadout } from '../../src/data/parts';
import type { Collider } from '../../src/arena/types';

function setup() {
  const f = new Fighter(0, resolveLoadout(DEFAULT_LOADOUT)), enemy = new Fighter(1, resolveLoadout(DEFAULT_LOADOUT));
  enemy.pos.z = 10;
  const floor: Collider = { kind: 'box', min: new THREE.Vector3(-30, -1, -30), max: new THREE.Vector3(30, 0, 30) };
  const step = (input: Partial<FighterInput> = {}) => f.step(1 / 60, { ...emptyInput(), ...input }, enemy, [floor], 28, 28);
  return { f, step };
}

it('a manual bomb target survives input buffering through recovery', () => {
  const { f, step } = setup(); f.recoveryTime = .05;
  step({ bombPressed: true, bombTarget: [4, 0, 7] });
  expect(f.spawns).toHaveLength(0);
  let thrown = false;
  for (let i = 0; i < 5; i++) {
    step();
    if (f.spawns.some(s => s.kind === 'bomb')) { thrown = true; expect(f.bombTarget).toEqual([4, 0, 7]); }
  }
  expect(thrown).toBe(true);
});

it('an expired buffered throw never fires later and a new automatic press discards its target', () => {
  const { f, step } = setup(); f.recoveryTime = .3;
  step({ bombPressed: true, bombTarget: [4, 0, 7] });
  for (let i = 0; i < 30; i++) { step(); expect(f.spawns).toHaveLength(0); }
  step({ bombPressed: true });
  expect(f.spawns.some(s => s.kind === 'bomb')).toBe(true);
  expect(f.bombTarget).toBeUndefined();
});
