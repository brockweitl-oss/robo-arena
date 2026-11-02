import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5318';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
mkdirSync('test-results/unified-skill-vfx', { recursive: true });
try {
  for (const skill of ['lance', 'wave', 'hook', 'frost']) {
    await page.goto(base);
    await page.waitForFunction(() => !!window.__game?.menus);
    await page.evaluate(skill => {
      const g = window.__game;
      g.save.loadout = { ...g.save.loadout, skill };
      void g.menus.runMatch({ mode: 'practice', playerLoadout: g.save.loadout, rivalId: 'mira', arenaId: 'proving', practice: { dummy: 'idle' } });
    }, skill);
    await page.waitForFunction(() => window.__game?.match?.phase === 'fight', null, { timeout: 20000 });
    await page.evaluate(() => {
      const m = window.__game.match, [a, b] = m.world.fighters;
      a.pos.set(0, 0, 5); b.pos.set(0, 0, -7); a.yaw = Math.PI; b.yaw = 0;
      m.sides.forEach(s => s.prevPos.copy(s.fighter.pos));
    });
    await page.waitForTimeout(800);
    const result = await page.evaluate(skill => {
      const m = window.__game.match, [a, b] = m.world.fighters;
      if (a.lo.skill.id !== skill) throw Error('Wrong equipped skill in visual QA');
      // Controlled visual capture of the real simulator's projectile: freeze only
      // after spawn, so fast skills remain visible while the screenshot is encoded.
      m.paused = true; m.world.spawnSkill(a, null);
      const p = m.world.projectiles.at(-1);
      p.pos.addScaledVector(p.vel, 4 / p.vel.length()); p.age = .1;
      if (skill === 'frost') b.slowT = 1;
      a.castT = a.lo.skill.cast * .5;
      m.sides.forEach(s => m.updateSide(s, 0, 1));
      m.fx.syncSkillStates(m.world.fighters, m.skillAnchors);
      m.fx.syncProjectiles(m.world.projectiles, 0); m.fx.update(.05);
      m.aimView.update(a, b, b.pos, m.world.colliders, m.world.time);
      return { skill, look: p.spec.look, width: p.spec.radius * 2, frostVisible: skill === 'frost' && b.slowT > 0 };
    }, skill);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `test-results/unified-skill-vfx/${skill}.png` });
    results.push(result);
  }
  writeFileSync('test-results/unified-skill-vfx/report.json', JSON.stringify({ results, errors }, null, 2));
  if (errors.length) throw Error(errors.join('\n'));
  console.log(JSON.stringify({ results, errors }));
} finally { await browser.close(); }
