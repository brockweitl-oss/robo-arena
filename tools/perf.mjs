// node tools/perf.mjs rival arena seconds — samples fps, draw calls, tris, geometries, programs every 3 s.
import { chromium } from 'playwright';
const [rival = 'mira', arena = 'garden', secs = '60'] = process.argv.slice(2);
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5317';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', ...(process.env.UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${BASE}/index.html?quick=${rival}&arena=${arena}&autoplay&time=${secs}`);
for (let i = 0; i < +secs / 3 + 4; i++) {
  await page.waitForTimeout(3000);
  const s = await page.evaluate(() => {
    const g = window.__game; const r = g.gr.renderer; const m = g.match;
    return { fps: window.__fps, calls: r.info.render.calls, tris: r.info.render.triangles, geos: r.info.memory.geometries, tex: r.info.memory.textures, progs: r.info.programs?.length, phase: m?.phase, t: m?.world.time.toFixed(0), proj: m?.world.projectiles.length, sparks: m?.fx.sparks.count, smoke: m?.fx.smoke.count, scene: m?.scene.children.length };
  });
  console.log(JSON.stringify(s));
}
await browser.close();
