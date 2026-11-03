/**
 * AI / balance audit lab (docs/audit/AI-BALANCE.md). Run: BALANCE=1 AUDIT=<suite> npx vitest run tests/balance/audit --reporter=verbose
 * Suites: cheese (scripted exploit bots vs every rival), ladder (mid-player proxies vs each ladder step), probe (timing).
 */
import { it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { AIPilot } from '../../src/game/ai';
import { RIVALS, RIVALS_PLUS, type Rival } from '../../src/data/characters';
import { DEFAULT_LOADOUT, type Loadout } from '../../src/data/parts';
import type { AIPersonality } from '../../src/data/characters';
import { fight, CHEESE, LANES, LAYOUTS, type Pilot } from './harness';

const SUITE = process.env.AUDIT ?? '';
const S = Number(process.env.AUDIT_S ?? LANES.length * LAYOUTS.length);
const ai = (p: AIPersonality, skill: number) => (): Pilot => { const x = new AIPilot(p, skill); return (w, me, foe) => x.think(w, me, foe); };
const pct = (x: number) => `${(x * 100).toFixed(0).padStart(3)}%`;
const out = (name: string, data: unknown) => { mkdirSync('tests/balance/audit', { recursive: true }); writeFileSync(`tests/balance/audit/${name}.json`, JSON.stringify(data, null, 1)); };

/** Player side plays A on even scenarios and B on odd (mirror); returns player score + mean stats. */
function series(pLo: Loadout, pilot: () => Pilot, r: Rival, n = S) {
  let score = 0, ko = 0, time = 0, timeouts = 0;
  const st: Record<string, number> = {};
  const rst: Record<string, number> = {};
  for (let s = 0; s < n; s++) {
    const swap = s % 2 === 1;
    const res = swap ? fight(r.loadout, pLo, ai(r.ai, r.skill), pilot, s) : fight(pLo, r.loadout, pilot, ai(r.ai, r.skill), s);
    const mine = swap ? 1 - res.score : res.score;
    score += mine; if (res.ko) ko++; else timeouts++; time += res.time;
    const pf = swap ? res.b : res.a, rf = swap ? res.a : res.b;
    for (const [k, v] of Object.entries(pf.stats)) st[k] = (st[k] ?? 0) + (v as number) / n;
    for (const [k, v] of Object.entries(rf.stats)) rst[k] = (rst[k] ?? 0) + (v as number) / n;
  }
  return { win: score / n, koRate: ko / n, timeouts: timeouts / n, avgTime: time / n, player: st, rival: rst };
}

it.runIf(SUITE === 'probe')('probe', { timeout: 600000 }, () => {
  const t0 = Date.now();
  const r = series(DEFAULT_LOADOUT, CHEESE.idle, RIVALS[0], 4);
  console.log('idle vs dex', r.win, r.avgTime.toFixed(1), ((Date.now() - t0) / 4).toFixed(0), 'ms/fight');
  const t1 = Date.now();
  const r2 = series(DEFAULT_LOADOUT, ai('duelist', 0.5), RIVALS[4], 4);
  console.log('duelist .5 vs sable', r2.win, r2.avgTime.toFixed(1), ((Date.now() - t1) / 4).toFixed(0), 'ms/fight');
});

const ALL = [...RIVALS, ...RIVALS_PLUS];

it.runIf(SUITE === 'cheese')('cheese bots vs every rival', { timeout: 6 * 3600 * 1000 }, () => {
  const names = (process.env.CHEESE ?? Object.keys(CHEESE).join(',')).split(',');
  const res: Record<string, Record<string, ReturnType<typeof series>>> = {};
  const rows: string[] = [];
  for (const c of names) {
    res[c] = {};
    const line: string[] = [];
    for (const r of ALL) { const x = series(DEFAULT_LOADOUT, CHEESE[c], r); res[c][r.id] = x; line.push(`${r.id}:${pct(x.win)}`); }
    rows.push(`${c.padEnd(9)} ${line.join(' ')}`);
    console.log(rows[rows.length - 1]);
  }
  out(`cheese${process.env.TAG ?? ''}`, res);
});

it.runIf(SUITE === 'ladder')('mid-player proxies vs ladder', { timeout: 6 * 3600 * 1000 }, () => {
  const proxies: [string, () => Pilot][] = [
    ['rookie.30', ai('rookie', 0.3)], ['duelist.45', ai('duelist', 0.45)], ['duelist.60', ai('duelist', 0.6)], ['champion.80', ai('champion', 0.8)],
  ];
  const res: Record<string, Record<string, ReturnType<typeof series>>> = {};
  for (const [name, p] of proxies) {
    res[name] = {};
    const line: string[] = [];
    for (const r of ALL) { const x = series(DEFAULT_LOADOUT, p, r); res[name][r.id] = x; line.push(`${r.id}:${pct(x.win)} ${x.avgTime.toFixed(0)}s`); }
    console.log(`${name.padEnd(12)} ${line.join(' | ')}`);
  }
  out(`ladder${process.env.TAG ?? ''}`, res);
});

it.runIf(SUITE === 'trace')('trace one fight', { timeout: 600000 }, async () => {
  const r = ALL.find((x) => x.id === (process.env.RIVAL ?? 'dex'))!;
  const s = Number(process.env.SC ?? 0);
  const { Fighter } = await import('../../src/game/fighter');
  const { segmentHit } = await import('../../src/game/collision');
  const THREE = await import('three');
  const cheese = CHEESE[process.env.CHEESE ?? 'turtle'];
  let last = -1;
  const wrap = (): Pilot => { const x = new AIPilot(r.ai, r.skill); return (w, me, foe) => {
    const i = x.think(w, me, foe);
    if (Math.floor(w.time) !== last) { last = Math.floor(w.time);
      const los = !segmentHit(me.chestPoint(), foe.pos.clone().add(new THREE.Vector3(0, 1.15, 0)), w.colliders);
      console.log(`t=${w.time.toFixed(0)} los${+los} ai(${me.pos.x.toFixed(1)},${me.pos.y.toFixed(1)},${me.pos.z.toFixed(1)}) ${me.mode} hp${me.hp.toFixed(0)} | p(${foe.pos.x.toFixed(1)},${foe.pos.y.toFixed(1)},${foe.pos.z.toFixed(1)}) ${foe.mode} hp${foe.hp.toFixed(0)} in:${i.moveX.toFixed(1)},${i.moveZ.toFixed(1)} g${+i.gunHeld} b${+i.bombPressed} p${+i.podPressed} s${+!!i.skillPressed} c${+i.chargePressed} d${+i.dashPressed} j${+i.jumpPressed} cds g${me.gunCd.toFixed(1)} b${me.bombCd.toFixed(1)} p${me.podCd.toFixed(1)} s${me.skillCd.toFixed(1)}`); }
    return i; }; };
  const res = fight(DEFAULT_LOADOUT, r.loadout, cheese, wrap, s);
  console.log('result', res.score, res.time.toFixed(1), JSON.stringify(res.b.stats));
  void Fighter;
});
