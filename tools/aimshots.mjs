// node tools/aimshots.mjs outDir [rival] [arena] [seconds] — AI vs AI; screenshots while a robot aims or casts a skill.
import { chromium } from 'playwright';
const [outDir, rival = 'nova', arena = 'foundry', time = '45'] = process.argv.slice(2);
const base = process.env.BASE_URL || 'http://127.0.0.1:5317';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
let errs = 0;
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { errs++; console.log(`[${m.type()}]`, m.text()); } });
page.on('pageerror', (e) => { errs++; console.log('[pageerror]', e.message); });
await page.goto(`${base}/index.html?quick=${rival}&arena=${arena}&autoplay=1&time=${time}`);
let shots = 0;
const t0 = Date.now();
while (Date.now() - t0 < (+time + 25) * 1000 && shots < 6) {
  await page.waitForTimeout(60);
  const st = await page.evaluate(() => {
    const m = window.__game?.match; if (!m || m.phase !== 'fight') return null;
    const [a, b] = m.world.fighters;
    return { aim: a.aiming ? (a.skillAimT >= 0 ? 'skill' : 'bomb') : b.castT >= 0 ? 'foecast' : null, r: window.__lastResult ?? null };
  });
  if (st?.aim) { await page.screenshot({ path: `${outDir}/aim_${shots}_${st.aim}.png` }); shots++; await page.waitForTimeout(700); }
}
await page.waitForTimeout(500);
const stats = await page.evaluate(() => { const m = window.__game?.match; return m ? m.world.fighters.map((f) => f.stats) : null; });
console.log(JSON.stringify(stats));
console.log('shots', shots, 'errors', errs);
await browser.close();
