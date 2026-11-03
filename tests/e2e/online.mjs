// Online end-to-end: browsers fight through the relay (local `wrangler dev` only; never the live server).
//   cd server && npx wrangler dev --port 8799
//   NET_URL=http://127.0.0.1:8799 BASE_URL=http://127.0.0.1:5317 node tests/e2e/online.mjs
// 1. Clean link: room create/join, ready handshake, rollback fight with autopilots on both sides,
//    confirmed-tick state hashes all match, guest leaves -> host gets a forfeit win.
// 2. Jittery link: the guest delays every outgoing message by 60-120 ms (random, order kept), so the
//    host keeps mispredicting and rolling back. A spectator joins late (fast-forward) and watches.
//    The round is shortened (?nettime) and played to the end: no desync, and host, guest and
//    spectator all agree on the final HP.
// Zero console errors/warnings throughout.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5317';
const NET = process.env.NET_URL ?? 'http://127.0.0.1:8799';
if (!/127\.0\.0\.1|localhost/.test(NET)) { console.error('online e2e must run against a local relay (it would pollute the live server)'); process.exit(1); }
const ROUND = 40;
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const problems = [];
const fail = async (msg) => { console.error('FAIL:', msg); console.error(problems.join('\n')); await browser.close(); process.exit(1); };
const step = (s) => console.log('•', s);

async function open(tag, extra = '') {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${tag} ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${tag} pageerror] ${e.message}`));
  await page.goto(`${BASE}/index.html?net=${encodeURIComponent(NET)}&autoplay${extra}`);
  await page.waitForFunction(() => window.__game?.menus, null, { timeout: 20000 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__game.menus.showOnline());
  await page.waitForTimeout(300);
  return page;
}
const click = (page, text) => page.locator('.ra-btn', { hasText: text }).first().click();
const snap = (p) => p.evaluate(() => {
  const m = window.__game.match;
  if (!m) return null;
  return {
    tick: m.netTick, phase: m.phase, desync: m.netDesync, left: m.netLeft, checks: m.netChecks, delay: m.netDelay,
    hp: m.world.fighters.map((f) => Math.round(f.hp * 1000) / 1000), stats: { ...m.netStats },
  };
});

/** Host creates a room, guest joins, both ready; resolves once both are fighting. */
async function startMatch(a, b) {
  await click(a, 'Create Private Room');
  await a.waitForFunction(() => /room code: [A-Z0-9]{5}/.test(document.body.innerText), null, { timeout: 10000 });
  const code = await a.evaluate(() => document.body.innerText.match(/room code: ([A-Z0-9]{5})/)[1]);
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
  return code;
}

/** Wait for the round's confirmed end on a page and return its final (frozen) HP. */
async function finalHp(p, tag, timeout) {
  await p.waitForFunction(() => ['ko', 'timeup', 'outro'].includes(window.__game.match?.phase), null, { timeout }).catch(() => fail(`${tag}: round did not end`));
  const s = await snap(p);
  if (!s) await fail(`${tag}: match gone before its result was read`);
  return s;
}

// ------------------------------------------------------------------ 1. clean link
{
  const a = await open('A');
  const b = await open('B');
  await startMatch(a, b);
  for (let i = 0; i < 4; i++) {
    await a.waitForTimeout(5000);
    const [sa, sb] = [await snap(a), await snap(b)];
    step(`t+${(i + 1) * 5}s A tick ${sa.tick} hp ${sa.hp} | B tick ${sb.tick} hp ${sb.hp} (delay ${sa.delay}/${sb.delay}, rollbacks ${sa.stats.rollbacks}/${sb.stats.rollbacks})`);
    if (sa.desync || sb.desync) await fail('desync reported');
    if (Math.abs(sa.tick - sb.tick) > 30) await fail('clients drifted apart');
    if (sa.phase !== 'fight') break;
  }
  const checks = await Promise.all([a, b].map((p) => p.evaluate(() => window.__game.match.netChecks)));
  step(`confirmed state hashes compared: A ${checks[0]}, B ${checks[1]}`);
  if (Math.min(...checks) < 4) await fail('too few state checks');
  step('guest leaves; host should get a forfeit win');
  await b.close();
  await a.waitForFunction(() => ['outro', 'done'].includes(window.__game.match?.phase) || !window.__game.match, null, { timeout: 20000 });
  await a.close();
  if (problems.length) await fail('console problems');
}

// ------------------------------------------------------------------ 2. jittery link + late spectator
{
  const a = await open('A2', `&nettime=${ROUND}`);
  const b = await open('B2', `&nettime=${ROUND}&netlag=60,120`);
  const code = await startMatch(a, b);
  await a.waitForTimeout(6000);
  step('spectator joins mid-round');
  const c = await open('C2', `&nettime=${ROUND}`);
  await c.fill('.net-code', code);
  await click(c, 'Watch');
  await c.waitForFunction(() => window.__game?.match?.phase === 'fight', null, { timeout: 30000 }).catch(() => fail('spectator never caught up to the fight'));
  step('spectator is watching');
  for (let i = 0; i < 3; i++) {
    await a.waitForTimeout(6000);
    const [sa, sb, sc] = [await snap(a), await snap(b), await snap(c)];
    if (!sa || !sb || sa.phase !== 'fight') break;
    step(`A tick ${sa.tick} hp ${sa.hp} rb ${sa.stats.rollbacks} (max ${sa.stats.maxDepth}) | B tick ${sb.tick} rb ${sb.stats.rollbacks} (max ${sb.stats.maxDepth}) | C tick ${sc?.tick} (${sa.tick - (sc?.tick ?? 0)} behind)`);
    if (sa.desync || sb.desync) await fail('desync reported under jitter');
    if (process.env.SHOTS && i === 1) for (const [p, n] of [[a, 'host'], [b, 'guest-lagged'], [c, 'spectator']]) await p.screenshot({ path: `${process.env.SHOTS}/online-${n}.png` });
  }
  const [ea, eb] = await Promise.all([finalHp(a, 'host', 60000), finalHp(b, 'guest', 60000)]);
  const ec = await finalHp(c, 'spectator', 30000);
  step(`final HP: A ${ea.hp} | B ${eb.hp} | spectator ${ec.hp}`);
  step(`rollback A: ${JSON.stringify(ea.stats)} · B: ${JSON.stringify(eb.stats)} · hash checks ${ea.checks}/${eb.checks}`);
  if (ea.desync || eb.desync) await fail('desync reported under jitter');
  if (JSON.stringify(ea.hp) !== JSON.stringify(eb.hp)) await fail('players disagree on the final HP');
  if (JSON.stringify(ec.hp) !== JSON.stringify(ea.hp)) await fail('spectator disagrees on the final HP');
  if (ea.stats.rollbacks + eb.stats.rollbacks < 5) await fail('jitter produced no rollbacks (prediction is not being exercised)');
  if (Math.max(ea.stats.maxDepth, eb.stats.maxDepth) > 12) await fail('rolled back past the window');
  if (Math.min(ea.checks, eb.checks) < 3) await fail('too few state checks under jitter');
  if (problems.length) await fail('console problems');
}
console.log('PASS');
await browser.close();
