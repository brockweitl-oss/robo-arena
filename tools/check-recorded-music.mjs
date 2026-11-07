import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const problems = [];
page.on('console', m => { if (['warning', 'error'].includes(m.type())) problems.push(m.text()); });
page.on('pageerror', e => problems.push(e.message));
await page.route('**/audio-check', r => r.fulfill({ contentType: 'text/html', body: '<title>Recorded audio check</title>' }));
let release;
const gate = new Promise(resolve => { release = resolve; });
await page.route('**/music/*.m4a', async r => { await gate; await r.continue(); });
try {
  await page.goto('http://127.0.0.1:5318/audio-check');
  await page.evaluate(async () => {
    const { audio } = await import('/src/audio/audio.ts');
    window.engine = audio;
    audio.init(); audio.playMusic('menu'); audio.playMusic('foundry');
  });
  release();
  await page.evaluate(() => window.engine.menuRecording);
  assert.equal(await page.evaluate(() => window.engine.music.name), 'foundry', 'late load must not replace arena music');
  await page.evaluate(() => window.engine.playMusic('menu'));
  await page.waitForFunction(() => !!window.engine.music?.source?.buffer);
  const result = await page.evaluate(async () => {
    const a = window.engine, original = a.music;
    a.playMusic('menu');
    const same = a.music === original;
    a.setVolumes(1, 1, 0);
    await new Promise(r => setTimeout(r, 400));
    const mute = a.bus.musicVol.gain.value;
    a.setVolumes(1, 1, 1);
    const source = a.music.source;
    const duration = source.buffer.duration;
    const loop = source.loop;
    const ended = new Promise(resolve => source.onended = () => resolve(true));
    a.stopMusic(0.05);
    return { duration, loop, same, mute, stopped: await ended };
  });
  assert.ok(result.duration > 167 && result.duration < 169);
  assert.ok(result.loop && result.same && result.stopped);
  assert.ok(result.mute < 0.001);
  assert.deepEqual(problems, []);
  console.log(JSON.stringify({ ...result, problems }));
} finally { release(); await browser.close(); }
