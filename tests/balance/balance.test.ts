/**
 * Balance lab: headless AI-vs-AI tournament.  Run with `npm run balance`.
 *
 * For every part in every slot we play it (on an otherwise-default loadout)
 * against the default loadout, swapping sides, with identical AI pilots.
 * Then a random-build round robin estimates each part's win rate across builds.
 * Output: tests/balance/report.json + a console table. Target: every part
 * within 40–60% (no dominant pick, nothing useless).
 */
import { it } from 'vitest';
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { Fighter } from '../../src/game/fighter';
import { World } from '../../src/game/world';
import { AIPilot } from '../../src/game/ai';
import { ALL_PARTS, DEFAULT_LOADOUT, resolveLoadout, type Loadout, type Slot } from '../../src/data/parts';
import type { ArenaBuild, Collider } from '../../src/arena/types';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider => ({ kind: 'box', min: V(x0, y0, z0), max: V(x1, y1, z1) });

/** Symmetric test arena: floor, central block, four cover pieces, two raised decks with ramps. */
function arena(): ArenaBuild {
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
    root: new THREE.Group(), colliders, hazards: [], spawns: [V(0, 0, 11), V(0, 0, -11)],
    halfX: 18, halfZ: 18, background: new THREE.Color(), environment: null, fog: null, keyLight: new THREE.DirectionalLight(),
    tick() {}, update() {}, dispose() {},
  };
}

/** Returns 1 if A wins, 0 if B wins, 0.5 draw (HP fraction decides time-outs). */
function fight(a: Loadout, b: Loadout, seed: number, timeLimit = 120): number {
  const fa = new Fighter(0, resolveLoadout(a));
  const fb = new Fighter(1, resolveLoadout(b));
  const ar = arena();
  fa.pos.copy(ar.spawns[0]);
  fb.pos.copy(ar.spawns[1]);
  const w = new World(ar, fa, fb, { arenaId: 'lab', seed });
  w.combatEnabled = true;
  const ia = new AIPilot('duelist', 0.8, seed * 31 + 7);
  const ib = new AIPilot('duelist', 0.8, seed * 17 + 3);
  const steps = timeLimit * 60;
  for (let i = 0; i < steps && w.koLoser < 0; i++) w.step([ia.think(w, fa, fb), ib.think(w, fb, fa)]);
  if (w.koLoser === 1) return 1;
  if (w.koLoser === 0) return 0;
  const ra = fa.hp / fa.maxHp;
  const rb = fb.hp / fb.maxHp;
  return Math.abs(ra - rb) < 0.02 ? 0.5 : ra > rb ? 1 : 0;
}

const N = Number(process.env.BALANCE_N ?? 12);

it('part balance tournament', { timeout: 60 * 60 * 1000 }, () => {
  const report: Record<string, Record<string, { vsDefault: number; field: number }>> = {};
  const slots: Slot[] = ['gun', 'bomb', 'pod', 'body', 'legs'];
  const t0 = Date.now();
  // 1) each part vs the default build (sides swapped)
  for (const slot of slots) {
    report[slot] = {};
    for (const id of Object.keys(ALL_PARTS[slot])) {
      const lo = { ...DEFAULT_LOADOUT, [slot]: id };
      let score = 0;
      for (let i = 0; i < N; i++) {
        score += i % 2 === 0 ? fight(lo, DEFAULT_LOADOUT, 100 + i) : 1 - fight(DEFAULT_LOADOUT, lo, 100 + i);
      }
      report[slot][id] = { vsDefault: score / N, field: 0 };
    }
  }
  // 2) random builds round robin: per-part win rate across the field
  const rnd = (() => { let s = 99; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const pick = (slot: Slot) => { const ids = Object.keys(ALL_PARTS[slot]); return ids[Math.floor(rnd() * ids.length)]; };
  const tally: Record<string, { w: number; n: number }> = {};
  const M = N * 10;
  for (let i = 0; i < M; i++) {
    const a = { gun: pick('gun'), bomb: pick('bomb'), pod: pick('pod'), body: pick('body'), legs: pick('legs') } as Loadout;
    const b = { gun: pick('gun'), bomb: pick('bomb'), pod: pick('pod'), body: pick('body'), legs: pick('legs') } as Loadout;
    const r = fight(a, b, 500 + i);
    for (const slot of slots) {
      for (const [lo, res] of [[a, r], [b, 1 - r]] as [Loadout, number][]) {
        const k = `${slot}:${lo[slot]}`;
        tally[k] = tally[k] ?? { w: 0, n: 0 };
        tally[k].w += res;
        tally[k].n += 1;
      }
    }
  }
  for (const [k, v] of Object.entries(tally)) {
    const [slot, id] = k.split(':');
    report[slot][id].field = v.w / v.n;
  }
  writeFileSync('tests/balance/report.json', JSON.stringify({ n: N, field: M, seconds: (Date.now() - t0) / 1000, report }, null, 2));
  const rows: string[] = [];
  for (const slot of slots) for (const [id, r] of Object.entries(report[slot])) {
    const flag = r.vsDefault > 0.62 || r.vsDefault < 0.38 || r.field > 0.6 || r.field < 0.4 ? '  <-- check' : '';
    rows.push(`${slot.padEnd(5)} ${id.padEnd(12)} vsDefault ${(r.vsDefault * 100).toFixed(0).padStart(3)}%   field ${(r.field * 100).toFixed(0).padStart(3)}%${flag}`);
  }
  console.log('\n' + rows.join('\n') + `\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
});
