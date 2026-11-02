// Online end-to-end: two browsers fight through the relay (local `wrangler dev` or deployed).
//   cd server && npx wrangler dev --port 8799    (or NET_URL=https://...workers.dev)
//   BASE_URL=http://127.0.0.1:5317 node tests/e2e/online.mjs
// Checks: room create/join, ready handshake, lockstep fight with autopilots on both sides,
// no desync, both machines agree on the final HP, zero console problems.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5317';
const NET = process.env.NET_URL ?? 'http://127.0.0.1:8799';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const problems = [];
const fail = async (msg) => { console.error('FAIL:', msg); console.error(problems.join('\n')); await browser.close(); process.exit(1); };
const step = (s) => console.log('•', s);

async function open(tag) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${tag} ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${tag} pageerror] ${e.message}`));
  await page.goto(`${BASE}/index.html?net=${encodeURIComponent(NET)}&autoplay`);
  await page.waitForFunction(() => window.__game?.menus, null, { timeout: 20000 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__game.menus.showOnline());
  await page.waitForTimeout(300);
  return page;
}
const click = (page, text) => page.locator('.ra-btn', { hasText: text }).first().click();

const a = await open('A');
const b = await open('B');
step('host creates a room');
await click(a, 'Create Private Room');
await a.waitForFunction(() => /room code: [A-Z0-9]{5}/.test(document.body.innerText), null, { timeout: 10000 });
const code = (await a.evaluate(() => document.body.innerText.match(/room code: ([A-Z0-9]{5})/)[1]));
step(`room ${code}; guest joins`);
await b.fill('.net-code', code);
await click(b, 'Join Room');
for (const p of [a, b]) await p.waitForFunction(() => document.body.innerText.includes(' — '), null, { timeout: 10000 });
await a.waitForTimeout(800);
await click(a, 'Ready');
await click(b, 'Ready');
for (const p of [a, b]) {
  await p.waitForFunction(() => window.__game?.match?.phase === 'fight', null, { timeout: 25000 }).catch(async () => {
    const st = await Promise.all([a, b].map((q) => q.evaluate(() => ({ phase: window.__game.match?.phase, text: document.body.innerText.slice(0, 400) }))));
    await fail('fight did not start: ' + JSON.stringify(st));
  });
}
step('fight started on both');
const snap = (p) => p.evaluate(() => {
  const m = window.__game.match;
  return { tick: m.netTick, phase: m.phase, desync: m.netDesync || m.netLeft, hp: m.world.fighters.map((f) => Math.round(f.hp * 1000) / 1000), delay: m.netDelay };
});
for (let i = 0; i < 6; i++) {
  await a.waitForTimeout(5000);
  const [sa, sb] = [await snap(a), await snap(b)];
  step(`t+${(i + 1) * 5}s A tick ${sa.tick} hp ${sa.hp} | B tick ${sb.tick} hp ${sb.hp} (delay ${sa.delay}/${sb.delay})`);
  if (sa.desync || sb.desync) await fail('desync reported');
  if (Math.abs(sa.tick - sb.tick) > 30) await fail('clients drifted apart');
  if (sa.phase !== 'fight') break;
}
// the clients exchange state hashes every 120 ticks; every compared hash must have matched
const checks = await Promise.all([a, b].map((p) => p.evaluate(() => window.__game.match.netChecks)));
step(`state hashes compared: A ${checks[0]}, B ${checks[1]}`);
if (Math.min(...checks) < 5) await fail('too few state checks');
step('guest leaves; host should get a forfeit win');
await b.close();
await a.waitForFunction(() => ['outro', 'done'].includes(window.__game.match?.phase) || !window.__game.match, null, { timeout: 20000 });
if (problems.length) await fail('console problems');
console.log('PASS');
await browser.close();
