// Real-game regression: replay cameras must not change recorded combat results.
// BASE_URL=http://127.0.0.1:5321 node tools/replay-camera-qa.mjs [output-directory]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.BASE_URL || 'http://127.0.0.1:5318';
const out = process.argv[2] || 'test-results/replay-camera-qa';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (['warning', 'error'].includes(m.type())) errors.push(m.text()); });
const fullscreen = async value => page.waitForFunction(expected => !!document.fullscreenElement === expected, value);
try {
  await page.goto(`${base.replace(/\/$/, '')}/?autoplay`);
  await page.waitForFunction(() => window.__game?.menus);
  // Exercise both entry points, including pointer activation followed by gameplay Space.
  const fullscreenButton = page.getByRole('button', { name: 'Toggle fullscreen', exact: true });
  await fullscreenButton.click(); await fullscreen(true);
  assert.equal(await fullscreenButton.evaluate(el => el === document.activeElement), false, 'Mouse click must not leave fullscreen button focused');
  await page.keyboard.press('Space'); await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => !!document.fullscreenElement), true, 'Space must not retrigger fullscreen');
  await fullscreenButton.click(); await fullscreen(false);
  await page.keyboard.press('F11'); await fullscreen(true);
  await page.keyboard.press('F11'); await fullscreen(false);
  await page.evaluate(() => {
    localStorage.removeItem('robo-arena-replays');
    const game = window.__game;
    void game.menus.runMatch({ mode: 'free', playerLoadout: game.save.loadout, rivalId: 'mira', arenaId: 'foundry', timeLimit: 20 });
  });
  const finalHp = async () => {
    await page.waitForFunction(() => ['timeup', 'ko'].includes(window.__game.match?.phase), null, { timeout: 120000 });
    return page.evaluate(() => window.__game.match.world.fighters.map(f => f.hp.toFixed(3)).join('/'));
  };
  const original = await finalHp();
  await page.waitForFunction(() => !window.__game.match, null, { timeout: 45000 });
  await page.evaluate(() => window.__game.menus.watchReplay(JSON.parse(localStorage.getItem('robo-arena-replays'))[0]));
  await page.waitForFunction(() => window.__game.match?.phase === 'fight');
  assert.equal(await page.evaluate(() => document.pointerLockElement === null), true, 'Replay must keep the pointer available for camera controls');
  const modes = [];
  for (let i = 1; i <= 4; i++) {
    await page.keyboard.press(String(i)); await page.waitForTimeout(80);
    modes.push(await page.evaluate(() => window.__game.match.replayCamera.mode));
  }
  assert.deepEqual(modes, [0, 1, 2, 3], 'Keys 1–4 must select each replay camera');
  const start = await page.evaluate(() => window.__game.gr.camera.position.toArray());
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyE'); await page.waitForTimeout(500);
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyE');
  const finish = await page.evaluate(() => window.__game.gr.camera.position.toArray());
  const moved = Math.hypot(...finish.map((v, i) => v - start[i]));
  assert.ok(moved > .5, `Free fly must move, measured ${moved}m`);
  const pov = page.getByRole('button', { name: '1 · Player 1 POV', exact: true });
  await pov.click();
  assert.equal(await page.evaluate(() => window.__game.match.replayCamera.mode), 0);
  assert.equal(await pov.evaluate(el => el === document.activeElement), false, 'Mouse click must not leave replay button focused');
  await page.keyboard.press('Space');
  assert.equal(await pov.evaluate(el => el === document.activeElement), false);
  await page.keyboard.press('3'); await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/replay-broadcast.jpg` });
  assert.equal(await page.evaluate(() => window.__game.match?.phase), 'fight', 'Replay must still be fighting before pause');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.match?.paused);
  await page.screenshot({ path: `${out}/replay-paused.jpg` });
  await page.locator('.ra-pause .ra-btn').filter({ hasText: /^Resume$/ }).click();
  await page.waitForFunction(() => window.__game.match && !window.__game.match.paused);
  assert.equal(await page.evaluate(() => document.pointerLockElement === null), true, 'Replay resume must not capture the pointer');
  // Drag-look must rotate the free camera while retaining an accessible cursor.
  await page.keyboard.press('4');
  const beforeLook = await page.evaluate(() => window.__game.gr.camera.quaternion.toArray());
  await page.mouse.move(600, 380); await page.mouse.down();
  await page.mouse.move(800, 420, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(150);
  const afterLook = await page.evaluate(() => window.__game.gr.camera.quaternion.toArray());
  assert.ok(Math.hypot(...afterLook.map((v, i) => v - beforeLook[i])) > .02, 'Free camera drag must change orientation');
  assert.equal(await page.evaluate(() => document.pointerLockElement === null), true, 'Replay canvas drag must not capture the pointer');
  await page.keyboard.press('2'); await page.keyboard.press('3');
  const replay = await finalHp();
  assert.equal(replay, original, 'Camera input must not change replay combat result');
  await page.waitForFunction(() => !window.__game.match, null, { timeout: 45000 });
  assert.equal(await page.locator('[data-replay-camera]').count(), 0, 'Replay controls must be disposed');
  assert.deepEqual(errors, [], 'No browser errors or warnings');
  console.log(JSON.stringify({ base, original, replay, modes, moved, fullscreen: 'button and F11 enter/exit passed', errors }));
} finally { await browser.close(); }
