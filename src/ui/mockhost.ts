/**
 * Dev-only MenuHost mock for menus-dev.html. No WebGL: the "backdrop" is a tinted div,
 * the garage previewRect is drawn as a dashed box, and startMatch fakes a round.
 *
 * Test hooks (window): __forceOutcome = 'win'|'lose'|'draw', __matchMs (default 1500),
 * __menus, __host, __log (array of host calls). Press P during a mock match to open pause.
 */
import { loadSave, writeSave, type Settings } from '../core/save';
import type { MenuHost } from './host';
import type { MatchConfig, MatchResult } from '../game/types';
import { rivalById } from '../data/characters';
import { resolveLoadout } from '../data/parts';
import { Menus } from './menus';

declare global {
  interface Window {
    __forceOutcome?: 'win' | 'lose' | 'draw';
    __matchMs?: number;
    __menus?: Menus;
    __host?: MenuHost;
    __log?: string[];
  }
}

const bg = document.getElementById('bg')!;
const rect = document.getElementById('rect')!;
const label = document.getElementById('label')!;
const matchEl = document.getElementById('match')!;
const log: string[] = (window.__log = []);
let yaw = 0;

const TINT: Record<string, string> = {
  title: 'radial-gradient(ellipse at 50% 60%, #3a4a66, #10141f 70%)',
  garage: 'radial-gradient(ellipse at 50% 55%, #24485a, #0b1118 70%)',
  versus: 'linear-gradient(90deg, #4a2a1a, #121722 50%, #1a2a4a)',
  none: '#000',
};

let pauseOpen = false;
let currentMatch: { cfg: MatchConfig; resolve: (r: MatchResult) => void; timer: number } | null = null;

function fakeResult(cfg: MatchConfig): MatchResult {
  const outcome = window.__forceOutcome ?? (['win', 'win', 'lose', 'draw'] as const)[Math.floor(Math.random() * 4)];
  const pMax = resolveLoadout(cfg.playerLoadout).body.hp;
  const rMax = resolveLoadout(rivalById(cfg.rivalId).loadout).body.hp;
  const ko = outcome !== 'draw' && Math.random() < 0.75;
  const rnd = (a: number, b: number) => Math.round(a + Math.random() * (b - a));
  return {
    config: cfg,
    outcome,
    finish: ko ? 'ko' : 'time',
    time: ko ? rnd(35, 85) : cfg.timeLimit ?? 90,
    playerHp: outcome === 'lose' ? 0 : rnd(150, pMax),
    playerMaxHp: pMax,
    rivalHp: outcome === 'win' ? (ko ? 0 : rnd(50, 300)) : rnd(200, rMax),
    rivalMaxHp: rMax,
    player: { damageDealt: rnd(400, 1300), hits: rnd(8, 30), knockdowns: rnd(0, 4), shots: rnd(30, 90), dodges: rnd(2, 12) },
    rival: { damageDealt: rnd(300, 1100), hits: rnd(6, 26), knockdowns: rnd(0, 3), shots: rnd(25, 80), dodges: rnd(1, 10) },
  };
}

const save = loadSave();
const host: MenuHost = {
  save,
  persist() { writeSave(save); log.push('persist'); },
  applySettings(s: Settings) { log.push('applySettings ' + JSON.stringify(s)); },
  startMatch(cfg) {
    log.push('startMatch ' + JSON.stringify(cfg));
    bg.style.background = '#05070b';
    rect.style.display = 'none';
    matchEl.style.display = 'grid';
    matchEl.textContent = `MOCK MATCH vs ${cfg.rivalId} @ ${cfg.arenaId} (${cfg.mode}) — press P to pause`;
    return new Promise<MatchResult>((resolve) => {
      const timer = window.setTimeout(() => finish(fakeResult(cfg)), window.__matchMs ?? 1500);
      currentMatch = { cfg, resolve, timer };
    });
  },
  setBackdrop(kind, opts) {
    log.push(`setBackdrop ${kind} ${JSON.stringify(opts ?? {})}`);
    bg.style.background = TINT[kind] ?? '#000';
    label.textContent = `backdrop: ${kind}${opts?.rivalId ? ' · rival ' + opts.rivalId : ''}${opts?.loadout ? ' · ' + Object.values(opts.loadout).join('/') : ''}`;
    const r = opts?.previewRect;
    if (kind === 'garage' && r) {
      Object.assign(rect.style, { display: 'block', left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    } else rect.style.display = 'none';
  },
  rotatePreview(d) { yaw += d; rect.dataset.yaw = yaw.toFixed(2); rect.textContent = `robot preview · yaw ${yaw.toFixed(2)}`; },
  focusPreview(slot) { log.push(`focusPreview ${slot}`); },
  sfx(name) { log.push('sfx ' + name); },
  music(track) { log.push('music ' + track); },
};

function finish(r: MatchResult) {
  if (!currentMatch) return;
  const m = currentMatch;
  currentMatch = null;
  clearTimeout(m.timer);
  matchEl.style.display = 'none';
  m.resolve(r);
}

const menus = new Menus(host, document.getElementById('menus')!);
window.__menus = menus;
window.__host = host;

window.addEventListener('keydown', async (e) => {
  if (e.code !== 'KeyP' || !currentMatch || pauseOpen || menus.active) return;
  pauseOpen = true;
  clearTimeout(currentMatch.timer);
  const choice = await menus.showPause();
  pauseOpen = false;
  if (!currentMatch) return;
  const cfg = currentMatch.cfg;
  if (choice === 'resume') currentMatch.timer = window.setTimeout(() => finish(fakeResult(cfg)), window.__matchMs ?? 1500);
  else finish({ ...fakeResult(cfg), quit: choice === 'quit', restart: choice === 'restart' });
});

menus.showTitle();
