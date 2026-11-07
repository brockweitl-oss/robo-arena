import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (['warning', 'error'].includes(m.type())) problems.push(m.text()); });
const install = () => page.evaluate(() => {
  const w = window.__game.match.world, step = w.step.bind(w);
  window.__deploymentChecks = []; let tick = 0;
  w.step = inputs => {
    step(inputs); tick++;
    if ([48, 56, 66, 67, 90, 300, 600].includes(tick)) window.__deploymentChecks.push({
      tick, digest: w.digest(), fighters: w.fighters.map(f => ({ pos: f.pos.toArray(), perfect: f.launchPerfect, deployed: f.deployed })),
    });
  };
});
const finish = async () => {
  await page.waitForFunction(() => ['ko', 'timeup'].includes(window.__game.match?.phase), null, { timeout: 60000 });
  const state = await page.evaluate(() => ({ hp: window.__game.match.world.fighters.map(f => f.hp), checks: window.__deploymentChecks }));
  await page.waitForFunction(() => !window.__game.match, null, { timeout: 30000 });
  return state;
};
try {
  await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:5318'}/?autoplay`);
  await page.waitForFunction(() => window.__game?.menus);
  await page.evaluate(() => { const g = window.__game; void g.menus.runMatch({ mode: 'free', playerLoadout: g.save.customLoadout, rivalId: 'mira', arenaId: 'foundry', timeLimit: 12 }); });
  await page.waitForFunction(() => window.__game?.match?.phase === 'intro');
  await install();
  const original = await finish();
  await page.evaluate(() => window.__game.menus.watchReplay(JSON.parse(localStorage.getItem('robo-arena-replays'))[0]));
  await page.waitForFunction(() => window.__game?.match?.phase === 'intro');
  await install();
  const replay = await finish();
  assert.deepEqual(replay, original);
  assert.ok(original.checks.find(c => c.tick === 66).fighters.every(f => f.perfect && f.deployed));
  assert.deepEqual(problems, []);
  await writeFile('docs/visuals/playtest-feedback/replay-check.json', JSON.stringify({ original, replay, problems }, null, 2));
  console.log('PASS: actual Match replay matches at READY, GO and 600 combat ticks', original.hp);
} finally { await browser.close(); }
