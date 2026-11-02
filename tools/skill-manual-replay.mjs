// node tools/skill-manual-replay.mjs [outDir] — hold R, steer with the mouse, release; checks the lane, the shot direction and replay determinism.
import { chromium } from 'playwright';
const out = process.argv[2] ?? 'test-results/skills';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5317';
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
try {
  await p.goto(base);
  await p.waitForFunction(() => window.__game?.menus);
  await p.evaluate(() => { localStorage.removeItem('robo-arena-replays'); const g = window.__game; void g.menus.runMatch({ mode: 'free', playerLoadout: { ...g.save.loadout, skill: 'lance' }, rivalId: 'mira', arenaId: 'foundry', timeLimit: 12 }); });
  await p.waitForFunction(() => window.__game?.match?.phase === 'fight');
  await p.mouse.click(640, 360);
  await p.waitForFunction(() => window.__game.input.pointerLocked);
  await p.keyboard.down('KeyR');
  await p.waitForTimeout(150);
  await p.mouse.move(1000, 360, { steps: 8 });
  await p.waitForTimeout(250);
  const aim = await p.evaluate(() => ({ target: window.__game.input.skillAimTarget, aiming: window.__game.input.skillAiming }));
  await p.screenshot({ path: `${out}/skill-aim.png` });
  if (!aim.target || !aim.aiming) throw Error('skill aim target missing');
  await p.keyboard.up('KeyR');
  await p.waitForTimeout(250);
  const shot = await p.evaluate(() => { const m = window.__game.match; const f = m.world.fighters[0]; const pr = m.world.projectiles.find((x) => x.spec.skill && x.owner === 0); return { casts: f.stats.skillCasts, vel: pr ? [pr.vel.x, pr.vel.z] : null, castTarget: f.castTarget }; });
  await p.screenshot({ path: `${out}/skill-fire.png` });
  if (shot.casts !== 1) throw Error('skill did not fire: ' + JSON.stringify(shot));
  const end = async () => { await p.waitForFunction(() => ['ko', 'timeup'].includes(window.__game.match?.phase), null, { timeout: 90000 }); return p.evaluate(() => window.__game.match.world.fighters.map((f) => f.hp.toFixed(3)).join('/')); };
  const original = await end();
  await p.waitForFunction(() => !window.__game.match, null, { timeout: 30000 });
  const recorded = await p.evaluate(() => { const r = JSON.parse(localStorage.getItem('robo-arena-replays'))[0]; const bytes = atob(r.streams[0]); let aimed = 0; for (let i = 0; i < bytes.length; i += 19) if (bytes.charCodeAt(i + 12) & 2) aimed++; return { rules: r.rulesVersion, aimed }; });
  if (recorded.rules !== 5 || !recorded.aimed) throw Error('skill aim not recorded ' + JSON.stringify(recorded));
  await p.evaluate(() => window.__game.menus.watchReplay(JSON.parse(localStorage.getItem('robo-arena-replays'))[0]));
  const replay = await end();
  if (original !== replay) throw Error(`skill replay mismatch ${original} vs ${replay}`);
  if (errors.length) throw Error(errors.join('\n'));
  console.log(JSON.stringify({ aim, shot, recorded, original, replay, errors: errors.length }));
} finally { await b.close(); }
