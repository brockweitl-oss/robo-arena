// Usage: node tools/shot.mjs "<url>" out.png [waitMs] [width] [height]
// Captures a screenshot of a page served by `npm run dev` (default http://127.0.0.1:5317).
// Prints console errors and window.__fps.
import { chromium } from 'playwright';
const [url, out = 'shot.png', wait = '2500', w = '1600', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url.startsWith('http') ? url : `http://127.0.0.1:5317/${url}`);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
const fps = await page.evaluate(() => window.__fps).catch(() => null);
console.log('saved', out, 'fps', fps);
await browser.close();
