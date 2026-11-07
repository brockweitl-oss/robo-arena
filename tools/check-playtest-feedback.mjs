import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5318';
const out = 'docs/visuals/playtest-feedback';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const problems = [];
page.on('console', m => { if (['warning', 'error'].includes(m.type())) problems.push(m.text()); });
page.on('pageerror', e => problems.push(e.message));
try {
  await page.goto(base); await page.waitForTimeout(2500);
  await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  const rects = () => page.locator('.mm-item').evaluateAll(xs => xs.map(x => {
    const r = x.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
  }));
  const before = await rects();
  for (let i = 0; i < before.length; i++) {
    await page.locator('.mm-item').nth(i).hover(); await page.waitForTimeout(160);
    assert.deepEqual(await rects(), before, `hover ${i} changed menu geometry`);
  }
  assert.equal(await page.locator('.mm-num').count(), 0);
  await page.screenshot({ path: `${out}/menu-after.png` });
  const saved = await page.evaluate(() => ({ loadout: { ...window.__game.save.loadout }, unlocked: [...window.__game.save.unlocked] }));
  await page.locator('.mm-item').filter({ hasText: 'Free Battle' }).click();
  await page.waitForTimeout(400);
  await page.locator('.ra-btn').filter({ hasText: /^Garage$/ }).click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.gar-part.locked').count(), 0);
  await page.locator('.gar-part').filter({ hasText: 'Nova Cannon' }).click();
  await page.screenshot({ path: `${out}/custom-nova.png` });
  const custom = await page.evaluate(() => ({ gun: window.__game.save.customLoadout.gun, loadout: window.__game.save.loadout, unlocked: window.__game.save.unlocked }));
  assert.equal(custom.gun, 'nova'); assert.deepEqual(custom.loadout, saved.loadout); assert.deepEqual(custom.unlocked, saved.unlocked);
  await page.reload(); await page.waitForTimeout(2500);
  assert.equal(await page.evaluate(() => window.__game.save.customLoadout.gun), 'nova');
  for (const gun of ['needle', 'nova']) {
    await page.goto(`${base}/viewer.html?robot=striker&gun=${gun}&anim=fire&cam=3,2,4`);
    await page.waitForTimeout(1800); await page.screenshot({ path: `${out}/${gun}.png` });
  }
  await page.goto(`${base}/?quick=dex&arena=foundry&time=45`);
  await page.waitForFunction(() => window.__game?.match?.phase === 'ready');
  await page.screenshot({ path: `${out}/deployment.png` });
  await page.waitForFunction(() => window.__game?.match?.phase === 'fight');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${out}/combat-after.png` });
  const fps = await page.evaluate(() => window.__fps);
  // Offline rendering exercises every new sound / club track without requiring an audio device.
  const audio = await page.evaluate(async () => {
    const { TRACKS, Sequencer } = await import('/src/audio/music.ts');
    const { SFX } = await import('/src/audio/sfx.ts');
    const { buildBus } = await import('/src/audio/bus.ts');
    const results = {};
    for (const name of ['foundry', 'garden', 'orbital', 'champion']) {
      const ctx = new OfflineAudioContext(2, 44100 * 8, 44100);
      const bus = buildBus(ctx, ctx.destination);
      new Sequencer(ctx, bus.musicIn, bus.musicRevIn, TRACKS[name], 0).pump(7.5);
      const data = (await ctx.startRendering()).getChannelData(0);
      results[name] = { finite: data.every(Number.isFinite), peak: data.reduce((m, x) => Math.max(m, Math.abs(x)), 0) };
    }
    for (const name of ['gun_beam', 'gun_homer']) {
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      SFX[name].fn({ ctx, out: ctx.destination, t: 0, p: 1 });
      const data = (await ctx.startRendering()).getChannelData(0);
      results[name] = { finite: data.every(Number.isFinite), peak: data.reduce((m, x) => Math.max(m, Math.abs(x)), 0) };
    }
    return results;
  });
  for (const [name, result] of Object.entries(audio)) assert.ok(result.finite && result.peak > 0 && result.peak < 1, `${name}: invalid or clipping audio`);
  assert.deepEqual(problems, []);
  await writeFile(`${out}/browser-check.json`, JSON.stringify({ menuStable: true, customPersistence: true, fps, audio, problems }, null, 2));
  console.log(JSON.stringify({ fps, audio, problems }));
} finally { await browser.close(); }
