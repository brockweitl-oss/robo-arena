// node tools/vfxshots.mjs <outDir> — freezes a real match and captures each combat effect from the gameplay camera.
import { chromium } from 'playwright';
const out = process.argv[2] ?? 'test-results/vfx';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5317';
const arena = process.env.ARENA ?? 'foundry';
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
try {
  await p.goto(`${base}/index.html?quick=mira&arena=${arena}`);
  await p.waitForFunction(() => window.__game?.match?.phase === 'fight', null, { timeout: 60000 });
  await p.evaluate(() => {
    const m = window.__game.match;
    for (const f of m.world.fighters) { f.locked = true; f.vel.set(0, 0, 0); }
    m.world.fighters[0].pos.set(0, 0, -7); m.world.fighters[1].pos.set(0, 0, 7); m.world.fighters[1].hp = 1e6;
    window.__hud = (on) => { document.querySelectorAll('.hud, #hud, .hud-root').forEach((e) => e.style.visibility = on ? '' : 'hidden'); };
  });
  await p.waitForTimeout(800);
  const cases = {
    gun_pulse: `const f=m.world.fighters[0]; f.yaw=0; for(let i=0;i<3;i++) setTimeout(()=>m.world.spawnShot(f,i,false,1),i*90);`,
    gun_rail: `const f=m.world.fighters[0]; f.lo.gun=P.GUNS.rail; m.world.spawnShot(f,0,false,1);`,
    gun_beam: `const f=m.world.fighters[0]; f.lo.gun=P.GUNS.beam; m.world.spawnShot(f,0,false,1);`,
    skill_lance: `const f=m.world.fighters[0]; f.lo.skill=P.SKILLS.lance; m.world.spawnSkill(f,null);`,
    skill_wave: `const f=m.world.fighters[0]; f.lo.skill=P.SKILLS.wave; m.world.spawnSkill(f,null);`,
    skill_hook: `const f=m.world.fighters[0]; f.lo.skill=P.SKILLS.hook; m.world.spawnSkill(f,null);`,
    skill_frost: `const f=m.world.fighters[0]; f.lo.skill=P.SKILLS.frost; m.world.spawnSkill(f,null);`,
    impact_heavy: `const t=m.world.fighters[1].chestPoint(); m.fx.hitSpark(t,new T.Vector3(0,0,1),0xffc53a,true); m.fx.impact(t,new T.Vector3(0,0,-1),0xffc53a,1.6);`,
    explosion: `const t=m.world.fighters[1].pos.clone().add(new T.Vector3(2,0,-2)); m.fx.explosion(t,3,0xff5a2a,true,true);`,
    muzzle: `const f=m.world.fighters[0]; const s=m.sides[0]; s.model.root.updateMatrixWorld(true); m.fx.muzzle(s.model.rig.muzzle.getWorldPosition(new T.Vector3()),new T.Vector3(0,0,1),0xffc53a,true);`,
    dash: `const f=m.world.fighters[0]; m.fx.dashBurst(f.chestPoint(),new T.Vector3(1,0,0),0x55ddff,true);`,
  };
  for (const [name, code] of Object.entries(cases)) {
    for (const delay of name.startsWith('gun') || name.startsWith('skill') ? [140] : [70, 260]) {
      await p.evaluate(async (code) => {
        const m = window.__game.match; const T = { Vector3: m.world.fighters[0].pos.constructor };
        const P = await import('/src/data/parts.ts');
        // eslint-disable-next-line no-new-func
        new Function('m', 'T', 'P', code)(m, T, P);
      }, code);
      await p.waitForTimeout(delay);
      await p.screenshot({ path: `${out}/${name}_${delay}.png` });
      await p.waitForTimeout(900);
    }
  }
  const fps = await p.evaluate(() => window.__fps);
  console.log('fps', fps, 'errors', errors.length, errors.slice(0, 3).join(' | '));
} finally { await b.close(); }
