// Feel probe: drives real keyboard/mouse input in a quick match and logs per-frame telemetry
// (player motion, camera, opponent framing, frame times). node tools/feelprobe.mjs <outDir> [arena] [rival] [port]
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
const [outDir = '.', arena = 'foundry', rival = 'dex', port = '5317'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?quick=${rival}&arena=${arena}`);
await page.waitForFunction(() => window.__game?.match?.phase === 'fight', null, { timeout: 30000 });
await page.evaluate(() => {
  const g = window.__game; const log = []; let evs = []; const he = g.match.handleEvents.bind(g.match); g.match.handleEvents = (es) => { for (const e of es) evs.push(e.type === 'fighter' ? e.who + ':' + e.ev.type : e.type); return he(es); }; window.__log = log; window.__marks = [];
  window.__mark = (s) => window.__marks.push({ t: performance.now(), s }); window.__prog0 = g.match.host.gr.renderer.info.programs.length;
  const loop = () => {
    const m = g.match; if (!m) return;
    const [p, r] = m.world.fighters; const cam = m.cam; const c = m.host.gr.camera;
    const lp = r.chestPoint(); const v = lp.clone().project(c);
    const pp = p.chestPoint().project(c);
    log.push({ t: performance.now(), mode: p.mode, px: p.pos.x, py: p.pos.y, pz: p.pos.z, vx: p.vel.x, vz: p.vel.z, vy: p.vel.y, yaw: p.yaw,
      cyaw: cam.yaw, cx: c.position.x, cy: c.position.y, cz: c.position.z, ex: v.x, ey: v.y, ez: v.z, sx: pp.x, sy: pp.y,
      sep: Math.hypot(p.pos.x - r.pos.x, p.pos.z - r.pos.z), hp: [p.hp, r.hp], landT: p.landT, rmode: r.mode, ev: evs.join(' ') }); evs = [];
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
const k = page.keyboard, ms = page.mouse;
await ms.click(640, 360); // pointer lock attempt
let shotN = 0;
const mark = async (s) => { if (process.env.SHOTS) await page.screenshot({ path: `${outDir}/${arena}_${String(shotN++).padStart(2, '0')}_${s}.png` }); await page.evaluate((s) => window.__mark(s), s); };
const W = (t) => page.waitForTimeout(t);
// scripted session: run, reverse, strafe circle, dash, hop, double jump, fire, charge
await mark('runF'); await k.down('KeyW'); await W(900); await mark('revS'); await k.up('KeyW'); await k.down('KeyS'); await W(700); await k.up('KeyS');
await mark('strafeD'); await k.down('KeyD'); await W(1500); await mark('dashD'); await k.press('ShiftLeft'); await W(700); await k.up('KeyD');
await mark('strafeA'); await k.down('KeyA'); await W(1200); await mark('hop'); await k.press('Space'); await W(1100); await k.up('KeyA');
await mark('dbl'); await k.press('Space'); await W(250); await k.press('Space'); await W(1400);
await mark('fire'); for (let i = 0; i < 4; i++) { await ms.down(); await W(50); await ms.up(); await W(450); }
await mark('charge'); await k.press('KeyQ'); await W(1200);
await mark('dashW'); await k.down('KeyW'); await k.press('ShiftLeft'); await W(600); await k.up('KeyW');
await mark('circle'); await k.down('KeyD'); await k.down('KeyW'); await W(2000); await k.up('KeyW'); await k.up('KeyD');
await mark('idle'); await W(1500);
const data = await page.evaluate(() => ({ log: window.__log, marks: window.__marks, fps: window.__fps, progs: [window.__prog0, window.__game.match.host.gr.renderer.info.programs.length] }));
await page.screenshot({ path: `${outDir}/probe_${arena}.png` });
writeFileSync(`${outDir}/probe_${arena}.json`, JSON.stringify(data));
console.log('programs start/end', data.progs.join('/'), 'frames', data.log.length, 'fps', data.fps, 'errors', errs.length, errs.slice(0, 3).join(' | '));
await browser.close();
