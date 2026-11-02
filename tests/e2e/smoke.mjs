// End-to-end smoke test. Requires the dev server (npm run dev) on http://localhost:5173
// (override with BASE_URL). Fails on any console error/warning or page error.
//  1. Boots the full game (title → menus) and checks the menu layer and 3D backdrop render.
//  2. Starts a match, fires gun / bomb / pod / charge, dashes, jumps and hovers as the player.
//  3. Lets an AI pilot finish the fight and checks a MatchResult comes back.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
const fail = async (msg) => { console.error('FAIL:', msg); console.error(problems.join('\n')); await browser.close(); process.exit(1); };
const step = (s) => console.log('•', s);

// 1) Boot + menus
step('boot title screen');
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(2500);
const boot = await page.evaluate(() => ({ game: !!window.__game, menus: !!(window.__game && window.__game.menus), fps: window.__fps }));
if (!boot.game) await fail('game did not boot');
if (!boot.menus) await fail('menu layer did not load');
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
step(`menus ok (fps ${boot.fps})`);

// 2) Player-driven match: every weapon
step('start match');
await page.goto(`${BASE}/index.html?quick=dex&arena=foundry&time=60`);
await page.waitForFunction(() => window.__game?.match?.phase === 'fight', null, { timeout: 15000 });
const fired = { gun: 0, bomb: 0, pod: 0, charge: 0 };
await page.evaluate(() => {
  window.__ev = { fire: 0, bomb: 0, pod: 0, chargeStart: 0, dash: 0, jump: 0, airjump: 0 };
  const w = window.__game.match.world;
  w.fighters[1].locked = true; // keep the rival passive so hit-stun can't eat test inputs
  const orig = w.step.bind(w);
  w.step = (inp) => { orig(inp); for (const e of w.events) if (e.type === 'fighter' && e.who === 0 && e.ev.type in window.__ev) window.__ev[e.ev.type]++; };
});
const k = page.keyboard;
await k.down('KeyW');
await page.keyboard.press('KeyJ'); await page.waitForTimeout(700);      // gun (keyboard alt)
await page.keyboard.press('KeyK'); await page.waitForTimeout(500);      // bomb
await page.keyboard.press('KeyE'); await page.waitForTimeout(500);      // pod
await page.keyboard.press('ShiftLeft'); await page.waitForTimeout(500); // dash
await page.keyboard.press('Space'); await page.waitForTimeout(250);
await page.keyboard.press('Space'); await page.waitForTimeout(600);     // double jump
await k.up('KeyW');
await page.waitForTimeout(500);
await page.keyboard.press('KeyQ'); await page.waitForTimeout(900);      // charge
const ev = await page.evaluate(() => window.__ev);
Object.assign(fired, { gun: ev.fire, bomb: ev.bomb, pod: ev.pod, charge: ev.chargeStart });
step(`player events ${JSON.stringify(ev)}`);
for (const [name, n] of Object.entries(fired)) if (!n) await fail(`player could not use ${name}`);
if (!ev.dash || !ev.jump || !ev.airjump) await fail('movement actions missing');

// 3) Finish the fight with the autopilot
step('autoplay to the end');
await page.goto(`${BASE}/index.html?quick=mira&arena=garden&time=45&autoplay`);
await page.waitForFunction(() => !!window.__lastResult, null, { timeout: 90000 }).catch(() => fail('match did not finish'));
const res = await page.evaluate(() => window.__lastResult);
step(`result ${res.outcome} by ${res.finish} in ${res.time.toFixed(1)}s`);
const fps = await page.evaluate(() => window.__fps);
step(`fps ${fps}`);

await browser.close();
if (problems.length) { console.error(problems.join('\n')); console.error(`FAIL: ${problems.length} console problems`); process.exit(1); }
console.log('PASS');
