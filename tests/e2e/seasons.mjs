// Ranked seasons + shared replay links, end to end against a LOCAL relay (never the live one).
//   cd server && npx wrangler dev --port 8802
//   BASE_URL=http://127.0.0.1:5322 NET_URL=http://127.0.0.1:8802 node tests/e2e/seasons.mjs [shotDir]
// 1. Plays 5 ranked placement games over raw websockets for the page's own key, then renders the
//    post-match rank panel from the real `rated` message ("Placement complete: …").
// 2. A synthetic promotion (Gold III -> Gold II) renders the PROMOTED banner and moving bar.
// 3. Online menu + season leaderboard show the season badge.
// 4. Survival screen shows the global board.
// 5. A recorded replay is shared (POST /replay), and opening its ?replay=CODE link plays it.
// Fails on any console error / warning.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5322';
const NET = process.env.NET_URL ?? 'http://127.0.0.1:8802';
if (!/127\.0\.0\.1|localhost/.test(NET)) { console.error('seasons e2e writes ratings: point NET_URL at a local wrangler dev'); process.exit(1); }
const SHOTS = process.argv[2];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const problems = [];
const fail = async (msg) => { console.error('FAIL:', msg); console.error(problems.join('\n')); await browser.close(); process.exit(1); };
const step = (s) => console.log('•', s);

// ---- raw websocket client (like server/test/relay.mjs)
const ws = NET.replace(/^http/, 'ws');
const open = (path) => new Promise((res, rej) => {
  const s = new WebSocket(ws + path); const q = []; const waiters = [];
  s.onmessage = (e) => { const m = JSON.parse(e.data); const w = waiters.shift(); w ? w(m) : q.push(m); };
  s.onopen = () => res({ ws: s, next: () => q.length ? Promise.resolve(q.shift()) : new Promise((r) => waiters.push(r)), send: (o) => s.send(JSON.stringify(o)) });
  s.onerror = rej;
});
const rnd = () => Math.random().toString(36).slice(2, 12);
const pageKey = 'e2e-page-' + rnd() + rnd();
const botKey = 'e2e-bot-' + rnd() + rnd();

/** Play `n` ranked games (page key wins) and return the last `rated` message, seen from slot 0. */
async function ranked(n) {
  const code = (await (await fetch(NET + '/new')).json()).code;
  const a = await open('/room/' + code), b = await open('/room/' + code);
  await a.next(); await b.next();
  a.send({ t: 'hello', ruleset: 'e2e', name: 'E2E Pilot', key: pageKey, ranked: true, arena: 'garden' });
  b.send({ t: 'hello', ruleset: 'e2e', name: 'E2E Bot', key: botKey, ranked: true });
  await a.next(); await b.next();
  let last;
  for (let i = 0; i < n; i++) {
    a.send({ t: 'ready' }); b.send({ t: 'ready' }); await a.next(); await b.next();
    a.send({ t: 'result', winner: 0 }); b.send({ t: 'result', winner: 0 });
    last = await a.next(); await b.next();
  }
  a.ws.close(); b.ws.close();
  return last;
}

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
await page.addInitScript((k) => { try { localStorage.setItem('ra-net-key', k); localStorage.setItem('ra-net-name', 'E2E Pilot'); } catch { /* */ } }, pageKey);
const boot = async (url) => {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.menus, null, { timeout: 20000 });
};
const fakeSession = () => ({
  code: '', peer: { name: 'E2E Bot', rating: 1000, placed: true, loadout: window.__game.save.loadout, paint: window.__game.save.paint },
  last: null, closed: false, ready() {}, close() {}, hello() {},
});

// 1) placements over the real server, then the real `rated` payload in the panel
step('5 placement games over the local relay');
const rated = await ranked(5);
if (!rated?.counted || rated.games?.[0] !== 5) await fail('placements not rated: ' + JSON.stringify(rated));
await boot(`${BASE}/index.html?net=${encodeURIComponent(NET)}`);
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
await page.evaluate(({ r, fake }) => {
  const m = window.__game.menus;
  const ses = new Function('return ' + fake)()();
  m.showOnlineLobby(ses, { ranked: true, last: 'You won the round!', rank: { before: r.before[0], after: r.ratings[0], gamesAfter: r.games[0] } });
}, { r: rated, fake: fakeSession.toString() });
await page.waitForSelector('.rank-result[data-change="placed"]', { timeout: 5000 });
const placedText = await page.locator('.rank-result[data-change="placed"] .rr-banner').innerText();
if (!/Placement complete: (Bronze|Silver|Gold|Platinum) (I|II|III)|Placement complete: Diamond/i.test(placedText)) await fail('placement banner: ' + placedText);
if (!(await page.locator('.rank-result .rank-badge[class*="tier-"]').count())) await fail('no tier badge in the rank panel');
if (!(await page.locator('.md-title .rank-badge').count())) await fail('no badge next to the opponent name');
await page.waitForTimeout(1600);
await shot(page, 'rank-placed');
step(`rank panel: ${placedText}`);

// 2) promotion animation
await page.evaluate(({ fake }) => {
  const ses = new Function('return ' + fake)()();
  window.__game.menus.showOnlineLobby(ses, { ranked: true, last: 'You won the round!', rank: { before: 1160, after: 1185, gamesAfter: 30 } });
}, { fake: fakeSession.toString() });
await page.waitForSelector('.rank-result[data-change="promoted"]');
const promo = await page.locator('.rank-result[data-change="promoted"] .rr-banner').innerText();
if (!/PROMOTED → Gold II/i.test(promo)) await fail('promotion banner: ' + promo);
await page.waitForTimeout(1700);
const w = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.rank-result[data-change="promoted"] .rr-fill')).getPropertyValue('--w')));
if (!(w > 0.2 && w < 0.4)) await fail('promotion bar did not land in the new division: ' + w);
await shot(page, 'rank-promoted');
step('promotion banner + bar ok');

// 3) online menu + leaderboard badges
await page.evaluate(() => window.__game.menus.showOnline());
await page.waitForSelector('.net-me .rank-badge', { timeout: 8000 });
const meLine = await page.locator('.net-me').innerText();
if (!/season/.test(meLine)) await fail('online menu season line: ' + meLine);
await page.evaluate(() => window.__game.menus.showLeaderboard());
await page.waitForSelector('.net-board-row .rank-badge', { timeout: 8000 });
if (!(await page.locator('.net-board-row', { hasText: 'E2E Pilot' }).count())) await fail('pilot missing from the season board');
await page.waitForTimeout(900);
await shot(page, 'leaderboard');
step(`online menu + leaderboard ok (${meLine.trim()})`);

// 4) survival board
await fetch(NET + '/survival', { method: 'POST', body: JSON.stringify({ key: pageKey, name: 'E2E Pilot', rounds: 4, build: { gun: 'rifle', body: 'striker' } }) });
await page.evaluate(() => window.__game.menus.showSurvival());
await page.waitForSelector('.surv-board .net-board-row', { timeout: 8000 });
const survMe = await page.locator('.surv-me').innerText();
if (!/4 rounds/.test(survMe)) await fail('survival own best: ' + survMe);
await page.waitForTimeout(900);
await shot(page, 'survival');
step(`survival board ok (${survMe})`);

// 5) shared replay link: record a short match, share it, open the link
step('record a short match for the replay');
await page.goto(`${BASE}/index.html?quick=dex&arena=foundry&time=6`);
const replay = await page.waitForFunction(() => window.__lastResult?.replay, null, { timeout: 60000, polling: 500 }).then((h) => h.jsonValue());
await boot(`${BASE}/index.html?net=${encodeURIComponent(NET)}`);
await page.evaluate((rp) => localStorage.setItem('robo-arena-replays', JSON.stringify([rp])), replay);
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await page.evaluate(() => window.__game.menus.showReplays());
await page.waitForTimeout(900); // screen transitions briefly lock input
await page.locator('.ra-btn', { hasText: 'Share' }).first().click();
await page.waitForSelector('.share-link[data-code]', { timeout: 8000 }).catch(async () => fail('share failed: ' + await page.locator('.md-col').first().innerText()));
const link = await page.locator('.share-link').innerText();
const expected = new URL('/index.html', BASE).href;
if (!link.startsWith(expected + '?replay=')) await fail(`share link ${link} is not on this page (${expected})`);
await shot(page, 'replay-share');
step(`share link ${link}`);
await page.goto(`${link}&net=${encodeURIComponent(NET)}`);
await page.waitForFunction(() => window.__game?.menus, null, { timeout: 20000 });
await page.waitForSelector('.shared-replay-note', { timeout: 5000 });
await page.waitForTimeout(600);
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__game.match?.cfg?.mode === 'replay' && window.__game.match.phase === 'fight', null, { timeout: 20000 })
  .catch(async () => fail('shared replay did not play: ' + JSON.stringify(await page.evaluate(() => ({ mode: window.__game.match?.cfg?.mode, phase: window.__game.match?.phase, text: document.body.innerText.slice(0, 300) })))));
await page.waitForTimeout(1200);
await shot(page, 'replay-playing');
step('shared replay plays');

await page.waitForTimeout(300);
if (problems.length) await fail('console problems');
console.log('PASS');
await browser.close();
process.exit(0);
