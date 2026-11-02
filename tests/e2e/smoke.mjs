// End-to-end smoke test. Requires the dev server (npm run dev) on http://127.0.0.1:5317
// (override with BASE_URL). Fails on any console error/warning or page error.
//  1. Boots the full game (title → menus) and checks the menu layer and 3D backdrop render.
//  2. Starts a match, fires gun / bomb / pod / charge, dashes, jumps and hovers as the player.
//  3. Lets an AI pilot finish the fight and checks a MatchResult comes back.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5317';
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
// Wait for simulation state, not wall-clock guesses: attack/dash recovery is
// deliberate and a slow renderer may process fewer ticks in a fixed timeout.
const ready = () => page.waitForFunction(() => {
  const f = window.__game.match.world.fighters[0];
  return f.canAct && f.grounded && f.landT <= 0;
}, null, { timeout: 5000 });
const action = async (key, event) => {
  const before = await page.evaluate((name) => window.__ev[name], event);
  await k.press(key);
  await page.waitForFunction(({ name, before }) => window.__ev[name] > before,
    { name: event, before }, { timeout: 5000 });
};
await ready(); await action('KeyJ', 'fire');
await ready(); await action('KeyK', 'bomb');
await ready(); await action('KeyE', 'pod');
await ready();
await k.down('KeyW'); await action('ShiftLeft', 'dash'); await k.up('KeyW');
await ready(); await action('Space', 'jump');
await page.waitForFunction(() => {
  const f = window.__game.match.world.fighters[0];
  return !f.grounded && f.mode === 'air' && f.airJumps > 0 && !f.attackCommitted;
}, null, { timeout: 3000 });
await action('Space', 'airjump');
await ready(); await action('KeyQ', 'chargeStart');
const ev = await page.evaluate(() => window.__ev);
Object.assign(fired, { gun: ev.fire, bomb: ev.bomb, pod: ev.pod, charge: ev.chargeStart });
step(`player events ${JSON.stringify(ev)}`);
for (const [name, n] of Object.entries(fired)) if (!n) await fail(`player could not use ${name}`);
if (!ev.dash || !ev.jump || !ev.airjump) await fail('movement actions missing');

// 3) Finish the fight with the autopilot
step('autoplay to the end');
await page.goto(`${BASE}/index.html?quick=mira&arena=garden&time=45&autoplay`);
// sample frame rate mid-fight (not at the end, when the next match is loading)
await page.waitForFunction(() => window.__game?.match?.phase === 'fight', null, { timeout: 20000 });
await page.waitForTimeout(8000);
const fightFps = await page.evaluate(() => window.__fps);
await page.waitForFunction(() => !!window.__lastResult, null, { timeout: 90000 }).catch(() => fail('match did not finish'));
const res = await page.evaluate(() => window.__lastResult);
step(`result ${res.outcome} by ${res.finish} in ${res.time.toFixed(1)}s`);
step(`mid-fight fps ${fightFps}`);

await browser.close();
if (problems.length) { console.error(problems.join('\n')); console.error(`FAIL: ${problems.length} console problems`); process.exit(1); }
console.log('PASS');
