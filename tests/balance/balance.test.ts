/**
 * Balance lab: headless AI-vs-AI tournament.  Run with `npm run balance`.
 *
 * For every part in every slot we play it (on an otherwise-default loadout)
 * against the default loadout, swapping sides, with identical AI pilots.
 * Then a random-build round robin estimates each part's win rate across builds,
 * plus pairwise slot combos (gun×body, gun×skill …) so dominant builds show up, not just parts.
 * Output: tests/balance/report.json + a console table. Target: every part
 * within 42–58% field (no dominant pick, nothing useless).
 *
 * Scenario variety (all declared, nothing random decides a fight): 6 approach lanes × 4 tactics
 * layouts (crates, low walls, trap pads, Core position) × 3 pilot styles × 2 sides = 144 distinct
 * fights per pairing. Before this the lab only had 9 × 2 = 18, so N=96 repeated each fight ~5 times.
 */
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { AIPilot } from '../../src/game/ai';
import { ALL_PARTS, DEFAULT_LOADOUT, type Loadout, type Slot } from '../../src/data/parts';
import { fight as run, LANES, LAYOUTS } from './harness';

const SC = LANES.length * LAYOUTS.length;
const STYLES = ['duelist', 'champion', 'rusher'] as const;
const stat = { fights: 0, ko: 0, time: 0 };

/** Returns 1 if A wins, 0 if B wins, 0.5 draw (HP fraction decides time-outs). */
function fight(a: Loadout, b: Loadout, seed: number): number {
  // styles rotate fastest; the lane×layout index is strided (7 is coprime with 24) so small N still spans layouts
  const personality = STYLES[seed % STYLES.length];
  const p = () => { const x = new AIPilot(personality, 0.8); return x.think.bind(x); };
  const r = run(a, b, p, p, (Math.floor(seed / STYLES.length) * 7) % SC);
  stat.fights++; stat.time += r.time; if (r.ko) stat.ko++;
  return r.score;
}

const N = Number(process.env.BALANCE_N ?? 200);
const SKIP = !!process.env.AUDIT;

it.skipIf(SKIP)('part balance tournament', { timeout: 6 * 60 * 60 * 1000 }, () => {
  const report: Record<string, Record<string, { vsDefault: number; field: number }>> = {};
  const slots: Slot[] = ['gun', 'bomb', 'pod', 'body', 'legs', 'skill'];
  const t0 = Date.now();
  // 1) each part vs the default build (sides swapped)
  for (const slot of slots) {
    report[slot] = {};
    for (const id of Object.keys(ALL_PARTS[slot])) {
      const lo = { ...DEFAULT_LOADOUT, [slot]: id };
      let score = 0;
      for (let i = 0; i < N; i++) {
        score += i % 2 === 0 ? fight(lo, DEFAULT_LOADOUT, i >> 1) : 1 - fight(DEFAULT_LOADOUT, lo, i >> 1);
      }
      report[slot][id] = { vsDefault: score / N, field: 0 };
    }
  }
  const mirror = { ...stat };
  // 2) random builds round robin: per-part and per-combo win rate across the field
  const rnd = (() => { let s = 99; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const pick = (slot: Slot) => { const ids = Object.keys(ALL_PARTS[slot]); return ids[Math.floor(rnd() * ids.length)]; };
  const tally: Record<string, { w: number; n: number }> = {};
  const combos: Record<string, { w: number; n: number }> = {};
  const M = N * 10; // random-build fights
  let fieldTime = 0, fieldKo = 0;
  for (let i = 0; i < M; i++) {
    const a = { gun: pick('gun'), bomb: pick('bomb'), pod: pick('pod'), body: pick('body'), legs: pick('legs'), skill: pick('skill') } as Loadout;
    const b = { gun: pick('gun'), bomb: pick('bomb'), pod: pick('pod'), body: pick('body'), legs: pick('legs'), skill: pick('skill') } as Loadout;
    const before = { ...stat };
    const r = fight(a, b, i);
    fieldTime += stat.time - before.time; fieldKo += stat.ko - before.ko;
    for (const [lo, res] of [[a, r], [b, 1 - r]] as [Loadout, number][]) {
      for (const slot of slots) {
        const k = `${slot}:${lo[slot]}`;
        tally[k] = tally[k] ?? { w: 0, n: 0 };
        tally[k].w += res; tally[k].n += 1;
      }
      for (const [s1, s2] of [['gun', 'body'], ['gun', 'skill'], ['gun', 'pod'], ['body', 'legs'], ['gun', 'bomb']] as [Slot, Slot][]) {
        const k = `${s1}:${lo[s1]}+${s2}:${lo[s2]}`;
        combos[k] = combos[k] ?? { w: 0, n: 0 };
        combos[k].w += res; combos[k].n += 1;
      }
    }
  }
  for (const [k, v] of Object.entries(tally)) {
    const [slot, id] = k.split(':');
    report[slot][id].field = v.w / v.n;
  }
  const comboRates = Object.entries(combos).filter(([, v]) => v.n >= M / 40).map(([k, v]) => ({ combo: k, win: v.w / v.n, n: v.n })).sort((x, y) => y.win - x.win);
  const meta = {
    vsDefault: { koRate: mirror.ko / mirror.fights, avgTime: mirror.time / mirror.fights },
    field: { koRate: fieldKo / M, avgTime: fieldTime / M },
    topCombos: comboRates.slice(0, 8), bottomCombos: comboRates.slice(-8),
  };
  writeFileSync('tests/balance/report.json', JSON.stringify({ n: N, field: M, scenarios: `${SC} lane×layout × ${STYLES.length} pilot styles × 2 sides (declared, deterministic)`, seconds: (Date.now() - t0) / 1000, meta, report }, null, 2));
  const rows: string[] = [];
  for (const slot of slots) for (const [id, r] of Object.entries(report[slot])) {
    const flag = r.vsDefault > 0.62 || r.vsDefault < 0.38 || r.field > 0.58 || r.field < 0.42 ? '  <-- check' : '';
    rows.push(`${slot.padEnd(5)} ${id.padEnd(12)} vsDefault ${(r.vsDefault * 100).toFixed(0).padStart(3)}%   field ${(r.field * 100).toFixed(0).padStart(3)}%${flag}`);
  }
  rows.push(`KO rate ${(meta.field.koRate * 100).toFixed(0)}%  avg fight ${meta.field.avgTime.toFixed(1)} s (field)`);
  for (const c of meta.topCombos) rows.push(`top    ${c.combo.padEnd(30)} ${(c.win * 100).toFixed(0)}% (n=${c.n})`);
  for (const c of meta.bottomCombos) rows.push(`bottom ${c.combo.padEnd(30)} ${(c.win * 100).toFixed(0)}% (n=${c.n})`);
  console.log('\n' + rows.join('\n') + `\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
});
