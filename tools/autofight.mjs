// node tools/autofight.mjs outDir rival arena time — AI vs AI full match; screenshots on phase changes and every 4 s.
import { chromium } from 'playwright';
const [outDir, rival = 'dex', arena = 'foundry', time = '90'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
let errs = 0;
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { errs++; console.log(`[${m.type()}]`, m.text()); } });
page.on('pageerror', (e) => { errs++; console.log('[pageerror]', e.message); });
await page.goto(`http://localhost:5173/index.html?quick=${rival}&arena=${arena}&autoplay=1&time=${time}`);
let i = 0, lastPhase = '', minFps = 999;
const t0 = Date.now();
while (Date.now() - t0 < (+time + 25) * 1000) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => { const g = window.__game; const m = g.match; return { fps: window.__fps, r: window.__lastResult ?? null, phase: m ? m.phase : 'none', hp: m ? m.world.fighters.map(f => f.hp) : [] }; });
  if (st.phase === 'fight' && st.fps) minFps = Math.min(minFps, st.fps);
  if (st.phase !== lastPhase || i % 4 === 0) await page.screenshot({ path: `${outDir}/af_${rival}_${String(i).padStart(2, '0')}_${st.phase}.png` });
  if (st.phase !== lastPhase) console.log(i, st.phase, st.hp.join('/'), 'fps', st.fps);
  lastPhase = st.phase; i++;
  if (st.r) { console.log('RESULT', JSON.stringify({ outcome: st.r.outcome, finish: st.r.finish, time: st.r.time.toFixed(1), p: st.r.player, r: st.r.rival })); break; }
}
console.log('minFps', minFps, 'errors', errs);
await browser.close();
