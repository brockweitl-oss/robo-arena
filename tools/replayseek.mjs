// Replay timeline check: records a fight, then in its replay seeks forward (fast-sim) and
// back (restart + fast-forward). The state at a given fight tick must equal plain playback.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
p.on('pageerror', (e) => problems.push(e.message));
await p.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:5317'}/index.html?autoplay`);
await p.waitForFunction(() => !!window.__game?.menus, null, { timeout: 20000 });
await p.evaluate(() => { localStorage.removeItem('robo-arena-replays'); window.__game.menus.runMatch({ mode: 'free', playerLoadout: window.__game.save.loadout, rivalId: 'hex', arenaId: 'garden', timeLimit: 30 }); });
await p.waitForFunction(() => ['timeup', 'ko'].includes(window.__game.match?.phase), null, { timeout: 120000 });
await p.waitForFunction(() => !window.__game.match, null, { timeout: 60000 });
await p.waitForTimeout(1200);
await p.evaluate(() => window.__game.menus.watchReplay(JSON.parse(localStorage.getItem('robo-arena-replays'))[0]));
const state = () => p.evaluate(() => { const m = window.__game.match; return { raw: m.fightTime, t: +m.fightTime.toFixed(4), hp: m.world.fighters.map((f) => f.hp.toFixed(3)).join('/'), x: m.world.fighters[0].pos.x.toFixed(4) }; });
// plain playback to ~6 s, pause, remember
await p.waitForFunction(() => window.__game.match?.fightTime >= 6, null, { timeout: 60000 });
await p.keyboard.press('KeyK');
await p.waitForTimeout(300);
const plain = await state();
console.log('plain  ', plain);
// forward seek
await p.evaluate(() => window.__game.match.replayBar && (window.__game.match.seekTo = 18));
await p.waitForFunction(() => window.__game.match?.seekTo < 0, null, { timeout: 20000 });
const fwd = await state();
console.log('forward', fwd);
if (fwd.t < 17.9) { console.log('FAIL forward seek'); process.exit(1); }
// seek back to the exact plain time: restart + fast-forward
await p.evaluate((t) => { const m = window.__game.match; m.cfg.replaySeek = t; m.cfg.replayPaused = true; m.end({ restart: true }); }, plain.raw - 1e-9);
await p.waitForFunction((t) => window.__game.match?.fightTime >= t && window.__game.match?.seekTo < 0, plain.raw - 1e-9, { timeout: 30000 });
const back = await state();
console.log('back   ', back);
const ok = back.t === plain.t && back.hp === plain.hp && back.x === plain.x;
if (problems.length) console.log(problems.join('\n'));
console.log(ok && !problems.length ? 'PASS' : 'FAIL');
await b.close();
process.exit(ok && !problems.length ? 0 : 1);
