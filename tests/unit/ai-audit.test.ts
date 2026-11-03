import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Fighter } from '../../src/game/fighter';
import { World } from '../../src/game/world';
import { AIPilot } from '../../src/game/ai';
import { DEFAULT_LOADOUT, resolveLoadout } from '../../src/data/parts';
import { RIVALS, RIVALS_PLUS } from '../../src/data/characters';
import { survivalRivalId, SURVIVAL_ORDER } from '../../src/game/progression';
import type { ArenaBuild, Collider } from '../../src/arena/types';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function arena(): ArenaBuild {
  const colliders: Collider[] = [{ kind: 'box', min: V(-20, -1, -20), max: V(20, 0, 20) }];
  return {
    info: { id: 'lab', name: 'lab', subtitle: '', blurb: '', music: 'menu', accent: '#fff' },
    root: new THREE.Group(), colliders, hazards: [], spawns: [V(0, 0, 9), V(0, 0, -9)],
    halfX: 18, halfZ: 18, background: new THREE.Color(), environment: null, fog: null, keyLight: new THREE.DirectionalLight(),
    tick() {}, update() {}, dispose() {},
  };
}

describe('AI pilot input hygiene', () => {
  it('a skill press lasts one tick (it used to stick and re-cast at a stale aim point forever)', () => {
    const a = new Fighter(0, resolveLoadout(DEFAULT_LOADOUT)), b = new Fighter(1, resolveLoadout(DEFAULT_LOADOUT));
    const ar = arena(); a.pos.copy(ar.spawns[0]); b.pos.copy(ar.spawns[1]);
    const w = new World(ar, a, b, { arenaId: 'lab', seed: 1 });
    w.combatEnabled = true;
    const pilot = new AIPilot('champion', 1);
    let presses = 0, run = 0, longest = 0;
    for (let i = 0; i < 60 * 30; i++) {
      const inp = { ...pilot.think(w, a, b) };
      if (inp.skillPressed) { presses++; run++; longest = Math.max(longest, run); } else run = 0;
      w.step([inp, { ...inp, skillPressed: false, gunPressed: false, gunHeld: false, bombPressed: false, podPressed: false, chargePressed: false, dashPressed: false, moveX: 0, moveZ: 0 }]);
      if (w.koLoser >= 0) break;
    }
    expect(presses).toBeGreaterThan(0);
    expect(longest).toBe(1);
  });
});

describe('survival schedule', () => {
  it('is fixed, escalates through every rival once, then cycles the hardest four', () => {
    const ids = new Set([...RIVALS, ...RIVALS_PLUS].map((r) => r.id));
    expect(new Set(SURVIVAL_ORDER).size).toBe(ids.size);
    for (const id of SURVIVAL_ORDER) expect(ids.has(id)).toBe(true);
    expect(survivalRivalId(1)).toBe('dex');
    expect(survivalRivalId(10)).toBe('sable+');
    expect([11, 12, 13, 14, 15].map(survivalRivalId)).toEqual(['vance+', 'sable', 'hex+', 'sable+', 'vance+']);
    expect(survivalRivalId(3)).toBe(survivalRivalId(3));
  });
});
