// Verifies replay determinism in the real game: plays a fight (AI vs AI), then watches its replay; final HP must match.
import { chromium } from 'playwright';
const [rival = 'hex', arena = 'garden'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:5317'}/index.html?autoplay`);
await p.waitForFunction(() => !!window.__game?.menus, null, { timeout: 20000 });
await p.evaluate(([rv, ar]) => { localStorage.removeItem('robo-arena-replays'); window.__game.menus.runMatch({ mode: 'free', playerLoadout: window.__game.save.loadout, rivalId: rv, arenaId: ar, timeLimit: 25 }); }, [rival, arena]);
const endHp = async () => { await p.waitForFunction(() => ['timeup', 'ko'].includes(window.__game.match?.phase), null, { timeout: 120000 }); return p.evaluate(() => window.__game.match.world.fighters.map((f) => f.hp.toFixed(3)).join(' / ')); };
const orig = await endHp();
await p.waitForFunction(() => !window.__game.match, null, { timeout: 60000 });
await p.waitForTimeout(1500);
await p.evaluate(() => window.__game.menus.watchReplay(JSON.parse(localStorage.getItem('robo-arena-replays'))[0]));
const rep = await endHp();
console.log(`original ${orig} | replay ${rep} | ${orig === rep ? 'MATCH' : 'MISMATCH'}`);
await b.close();
process.exit(orig === rep ? 0 : 1);
