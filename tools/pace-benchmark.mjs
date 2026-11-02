// Matched read-only integration benchmark. No checkout, source edits or RNG trials.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd(), ref = process.argv[2] ?? 'c6a60a1';
const temp = mkdtempSync(path.join(tmpdir(), 'robo-pace-'));
const baseline = path.join(temp, 'baseline'); mkdirSync(baseline);
const run = (exe, args, cwd = root) => {
  const result = spawnSync(exe, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${exe} exited ${result.status}`);
};
run('git', ['archive', '--format=tar', `--output=${path.join(temp, 'baseline.tar')}`, ref, 'src']);
run('tar', ['-xf', path.join(temp, 'baseline.tar'), '-C', baseline]);
symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
// Reuse the published balance arena geometry verbatim, without editing its fixture.
const lab = readFileSync(path.join(root, 'tests/balance/balance.test.ts'), 'utf8');
const arena = lab.slice(lab.indexOf('const V ='), lab.indexOf('/** Returns 1'));
const q = (s) => JSON.stringify(s.replaceAll('\\', '/'));
for (const [label, source] of [['pt3', baseline], ['current', root]]) {
  const test = path.join(temp, `${label}.test.ts`), out = path.join(temp, `${label}.json`);
  writeFileSync(test, `import { it } from 'vitest';
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { Fighter } from ${q(path.join(source, 'src/game/fighter.ts'))};
import { World } from ${q(path.join(source, 'src/game/world.ts'))};
import { AIPilot } from ${q(path.join(source, 'src/game/ai.ts'))};
import { DEFAULT_LOADOUT, resolveLoadout } from ${q(path.join(source, 'src/data/parts.ts'))};
import type { ArenaBuild, Collider } from ${q(path.join(source, 'src/arena/types.ts'))};
${arena}
it('36 matched mirrored pace scenarios', {timeout:120000},()=>{
  const rows=[];
  const pairs=[['pulse','rail'],['pulse','beam'],['rail','beam'],['scatter','rail'],['homer','beam'],['pulse','scatter']];
  for(const [ga,gb] of pairs) for(const [profile,lane] of [['duelist',-7],['champion',0],['rusher',7]] as const) for(const swap of [false,true]) {
    const guns=swap?[gb,ga]:[ga,gb];
    const fighters=guns.map((gun,id)=>new Fighter(id,resolveLoadout({...DEFAULT_LOADOUT,gun})));
    const ar=arena(lane); fighters.forEach((f,i)=>f.pos.copy(ar.spawns[i]));
    const world=new World(ar,fighters[0],fighters[1],{arenaId:'lab',seed:12345}); world.combatEnabled=true;
    const pilots=[new AIPilot(profile,.8),new AIPilot(profile,.8)];
    for(let tick=0;tick<7200&&world.koLoser<0;tick++)world.step([pilots[0].think(world,fighters[0],fighters[1]),pilots[1].think(world,fighters[1],fighters[0])]);
    rows.push({key:ga+'/'+gb+'/'+profile+'/'+swap,guns,profile,lane,swap,seconds:world.time,finished:world.koLoser>=0,loser:world.koLoser,hp:fighters.map(f=>f.hp),combos:fighters.reduce((s,f)=>s+(f.stats.combos??0),0),comboDamage:fighters.reduce((s,f)=>s+(f.stats.comboDamage??0),0)});
  }
  writeFileSync(${q(out)},JSON.stringify(rows,null,2));
});`);
  const config = path.join(temp, `${label}.config.mjs`);
  writeFileSync(config, `export default {root:${q(temp)},test:{include:[${q(test)}],environment:'node',maxWorkers:1}};`);
  run(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config, '--reporter=dot'], temp);
}
const old = JSON.parse(readFileSync(path.join(temp, 'pt3.json'), 'utf8'));
const now = JSON.parse(readFileSync(path.join(temp, 'current.json'), 'utf8'));
const mean = (rows) => rows.length ? rows.reduce((s, r) => s + r.seconds, 0) / rows.length : null;
const summarize = (rows) => ({ matches: rows.length, knockouts: rows.filter(r => r.finished).length,
  timeouts: rows.filter(r => !r.finished).length, meanObservedSeconds: mean(rows),
  meanFinishedSeconds: mean(rows.filter(r => r.finished)), combos: rows.reduce((s, r) => s + r.combos, 0),
  comboDamage: rows.reduce((s, r) => s + r.comboDamage, 0) });
const paired = old.map((a, i) => [a, now[i]]).filter(([a, b]) => a.finished && b.finished);
const before = mean(paired.map(p => p[0])), after = mean(paired.map(p => p[1]));
const report = { baselineRef: ref, scenarios: '6 gun pairs x3 profile/lane combinations x2 mirrored sides;120s cap',
  caveat: 'Integrated version comparison, not isolated combo causality. Deterministic authored scenarios are not human PvP trials. Timeout durations are censored, not TTK.',
  baseline: summarize(old), current: summarize(now), pairedKnockouts: paired.length,
  pairedMeanBefore: before, pairedMeanAfter: after, pairedMeanChangePercent: before && after ? (after / before - 1) * 100 : null,
  baselineRows: old, currentRows: now, archive: temp };
mkdirSync(path.join(root, 'test-results/pt4'), {recursive:true});
writeFileSync(path.join(root, 'test-results/pt4/pace-comparison.json'), JSON.stringify(report, null, 2));
const { baselineRows, currentRows, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
