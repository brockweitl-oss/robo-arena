// node tools/weaponfx-shots.mjs <outDir> — fires every per-weapon / per-item effect recipe in a
// frozen match and captures each from the gameplay camera (two moments per effect).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'test-results/weaponfx';
mkdirSync(out, { recursive: true });
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5317';
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
await p.goto(`${base}/index.html?quick=mira&arena=${process.env.ARENA ?? 'garden'}`);
await p.waitForFunction(() => window.__game?.match?.phase === 'fight', null, { timeout: 60000 });
await p.evaluate(() => {
  const m = window.__game.match;
  for (const f of m.world.fighters) { f.locked = true; f.vel.set(0, 0, 0); }
  m.world.fighters[0].pos.set(0, 0, -7); m.world.fighters[1].pos.set(0, 0, 7); m.world.fighters[1].hp = 1e6;
  m.world.combatEnabled = false;
  document.querySelectorAll('.hud').forEach((e) => (e.style.visibility = 'hidden'));
});
await p.waitForTimeout(900);
const V = 'const V=(x,y,z)=>m.world.fighters[0].pos.clone().set(x,y,z);const W=m.fx.weapons;const d=V(0,0,1);const M=m.sides[0].model.rig.muzzle.getWorldPosition(V(0,0,0));';
const cases = {
  muzzle_blaster: `W.muzzle('blaster',M,d,0x37e8ff)`,
  muzzle_scatter: `W.muzzle('scatter',M,d,0xff9a3a)`,
  muzzle_rail: `W.muzzle('rail',M,d,0x9ad8ff)`,
  muzzle_beam: `W.muzzle('beam',M,d,0xff5ad8)`,
  muzzle_homer: `W.muzzle('homer',M,d,0x9dff6a)`,
  wall_blaster: `W.impact('blaster',V(0,1.2,0),V(0,0,-1),0x37e8ff)`,
  wall_rail: `W.impact('rail',V(0,1.2,0),V(0,0,-1),0x9ad8ff)`,
  wall_beam: `W.impact('beam',V(0,1.2,0),V(0,0,-1),0xff5ad8)`,
  wall_homer: `W.impact('homer',V(0,1.2,0),V(0,0,-1),0x9dff6a)`,
  wall_frost: `W.impact('frost',V(0,1.2,0),V(0,0,-1),0x9ff0ff)`,
  wall_wave: `W.impact('wave',V(0,1.2,0),V(0,0,-1),0x7ab8ff)`,
  hit_rail: `const t=m.world.fighters[1].chestPoint();m.fx.hitSpark(t,d,0x9ad8ff,true);W.hit('rail','gun',t,d,0x9ad8ff,true)`,
  hit_beam: `const t=m.world.fighters[1].chestPoint();m.fx.hitSpark(t,d,0xff5ad8,false);W.hit('beam','gun',t,d,0xff5ad8,false)`,
  boom_mortar: `W.explosion('mortar',V(2,0,2),3.2,0xff7a2a,true,true)`,
  boom_cluster: `W.explosion('cluster',V(2,0,2),3,0xffc040,false,true)`,
  boom_napalm: `W.explosion('napalm',V(2,0,2),3,0xff5a10,false,true)`,
  boom_bouncer: `W.explosion('bouncer',V(2,0,2),2.6,0x5ac8ff,false,true)`,
  boom_mine: `W.explosion('mine',V(2,0,2),2.4,0xff4a6a,false,true)`,
  boom_seeker: `W.explosion('seeker',V(2,0.8,2),2.2,0xffa03a,false,false)`,
  boom_trap: `W.explosion('trap',V(2,0.2,2),2,0xffd23a,false,true)`,
  charge_vanguard: `W.chargeStart('striker',V(0,1.2,-2),d,0x37e8ff)`,
  charge_titan: `W.chargeStart('ironclad',V(0,1.2,-2),d,0xff9a3a)`,
  charge_strider: `W.chargeStart('wisp',V(0,1.2,-2),d,0x9dff6a)`,
  charge_paladin: `W.chargeStart('regent',V(0,1.2,-2),d,0xffd23a)`,
  pick_shield: `W.pickup('shield',V(0,1,0),0x5ac8ff)`,
  pick_overdrive: `W.pickup('overdrive',V(0,1,0),0xff5a3a)`,
  pick_speed: `W.pickup('speed',V(0,1,0),0x9dff6a)`,
};
for (const [name, code] of Object.entries(cases)) {
  await p.evaluate(() => window.__game.match.fx.clear());
  await p.waitForTimeout(250);
  await p.evaluate((c) => { const m = window.__game.match; new Function('m', c)(m); }, V + code);
  await p.waitForTimeout(70);
  await p.screenshot({ path: `${out}/${name}_a.jpg`, quality: 80 });
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${out}/${name}_b.jpg`, quality: 80 });
}
console.log(errors.length ? errors.join('\n') : 'no console problems');
await b.close();
