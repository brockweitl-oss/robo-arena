// Leak check: N short AI-vs-AI matches in a row (all arenas, all rivals) in one page, sampling the
// JS heap and three.js renderer memory after each one. A healthy run is flat after warm-up.
//   BASE_URL=http://127.0.0.1:5344 node tools/leakcheck.mjs [matches=15] [seconds=20]
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5317';
const N = Number(process.argv[2] ?? 15);
const SECS = Number(process.argv[3] ?? 20);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
await page.goto(`${BASE}/index.html?autoplay`);
await page.waitForFunction(() => window.__game?.menus, null, { timeout: 30000 });
const sample = () => page.evaluate(() => {
  window.gc?.();
  const r = window.__game.gr.renderer.info;
  return {
    heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
    geometries: r.memory.geometries, textures: r.memory.textures, programs: r.programs?.length ?? 0,
    nodes: document.getElementsByTagName('*').length,
  };
});
const rows = [];
rows.push({ match: 0, ...(await sample()) });
const arenas = ['foundry', 'garden', 'orbital', 'hangar', 'proving', 'sunken'];
const rivals = ['dex', 'mira', 'vance', 'hex', 'sable'];
for (let i = 1; i <= N; i++) {
  const t0 = Date.now();
  await page.evaluate(([arena, rival, secs]) => window.__game.startMatch({ mode: 'free', playerLoadout: window.__game.save.loadout, rivalId: rival, arenaId: arena, timeLimit: secs }), [arenas[i % arenas.length], rivals[i % rivals.length], SECS]);
  // back on the menu backdrop for a moment, like a player between matches
  await page.waitForTimeout(500);
  const s = await sample();
  rows.push({ match: i, arena: arenas[i % arenas.length], secs: Math.round((Date.now() - t0) / 1000), ...s });
  console.log(JSON.stringify(rows.at(-1)));
}
const warm = rows[Math.min(6, rows.length - 1)], last = rows.at(-1);
console.log(`heap ${rows[0].heapMB} -> ${warm.heapMB} (after 6) -> ${last.heapMB} MB; geometries ${warm.geometries} -> ${last.geometries}; textures ${warm.textures} -> ${last.textures}; programs ${warm.programs} -> ${last.programs}; DOM nodes ${warm.nodes} -> ${last.nodes}`);
if (problems.length) console.log(problems.slice(0, 20).join('\n'));
await browser.close();
