// Usage: node tools/shots.mjs outDir w h wait "name|url" "name|url" ...
import { chromium } from 'playwright';
const [outDir, w, h, wait, ...items] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
for (const it of items) {
  const [name, url] = it.split('|');
  await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:5317'}/${url}`);
  await page.waitForTimeout(+wait);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  const fps = await page.evaluate(() => window.__fps).catch(() => null);
  console.log(name, 'fps', fps && fps.toFixed(1));
}
await browser.close();
