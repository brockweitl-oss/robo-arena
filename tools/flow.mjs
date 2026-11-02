// Drive the real menus: title → main → ladder → intro → fight (autoplay) → results.
import { chromium } from 'playwright';
const [outDir] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
let errs = 0;
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { errs++; console.log(`[${m.type()}]`, m.text()); } });
page.on('pageerror', (e) => { errs++; console.log('[pageerror]', e.message); });
await page.goto('http://127.0.0.1:5317/index.html?autoplay');
const shot = async (n) => page.screenshot({ path: `${outDir}/flow_${n}.png` });
await page.waitForTimeout(2500);
await page.keyboard.press('Enter'); await page.waitForTimeout(1200); await shot('1_main');
await page.keyboard.press('Enter'); await page.waitForTimeout(1500); await shot('2_ladder');
await page.keyboard.press('Enter'); await page.waitForTimeout(2500); await shot('3_intro');
for (let i = 0; i < 4 && !(await page.evaluate(() => !!window.__game.match)); i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(1500); }
await shot('4_match');
await page.waitForFunction(() => !window.__game.match, null, { timeout: 120000 });
await page.waitForTimeout(3500); await shot('5_results');
await page.waitForTimeout(3000); await shot('6_results2');
console.log('save', JSON.stringify(await page.evaluate(() => ({ ladder: window.__game.save.ladder, unlocked: window.__game.save.unlocked }))));
console.log('errors', errs);
await browser.close();
