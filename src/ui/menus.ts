/**
 * Robo Arena — menu / UI layer.
 * DOM overlays above the WebGL canvas: title, main menu, story ladder, rival intro (VS),
 * results + part unlocks, ending, free battle, garage, settings, pause.
 * Full mouse + keyboard + gamepad navigation (spatial focus navigation).
 */
import '@fontsource/russo-one';
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import './menus.css';

import type { MenuHost, MenuLayer } from './host';
import { ALL_PARTS, BODIES, LEGS, resolveLoadout, type AnyPart, type Slot, deriveStats, SET_BONUS } from '../data/parts';
import { RIVALS, RIVALS_PLUS, PLAYER_PAINT, PLAYER_ROBOT_NAME, rivalById, type Paint, type Rival } from '../data/characters';
import { gradeMatch } from '../game/grades';
import { saveReplay, loadReplays, downloadReplay, parseReplay, type Replay } from '../game/replay';
import { connectedPads } from '../core/padInput';
import { NetSession, netName, tierOf, fetchMyRating, fetchLeaderboard, type PlayerHello, type StartMsg, type RatedMsg } from '../net/online';
import { ARENA_IDS, ARENA_INFO, type ArenaId } from '../arena/index';
import { defaultSave, isUnlocked, type Settings } from '../core/save';
import { pilotLevel } from '../game/progression';
import type { MatchConfig, MatchResult } from '../game/types';
import type { MusicTrack } from '../audio/audio';
import { MetaUI } from './meta';
import { PhotoStudio } from '../render/photoStudio';
import { PartThumbnails } from '../render/partThumbnails';

/* ------------------------------------------------------------------ helpers */

type Kid = Node | string | number | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    e.append(typeof k === 'number' ? String(k) : k);
  }
  return e;
}
function svg(markup: string, cls = 'ra-ico'): HTMLElement {
  const s = h('span', cls);
  s.innerHTML = markup;
  return s;
}
const hex = (n: number) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const fmtTime = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
/** Mark children for staggered entrance. */
function stagger(els: (HTMLElement | null | undefined)[], base = 0, step = 55) {
  let i = 0;
  for (const e of els) {
    if (!e) continue;
    e.classList.add('st');
    e.style.setProperty('--d', `${base + i * step}ms`);
    i++;
  }
}

const SLOTS: Slot[] = ['gun', 'bomb', 'pod', 'skill', 'body', 'legs'];
const SLOT_LABEL: Record<Slot, string> = { gun: 'Gun', bomb: 'Bomb', pod: 'Pod', body: 'Body', legs: 'Legs', skill: 'Skill' };
const SLOT_ICON: Record<Slot, string> = {
  skill: '<svg viewBox="0 0 24 24"><path d="M2 13l12-2-3-5 11 7-12 2 3 5z"/></svg>',
  gun: '<svg viewBox="0 0 24 24"><path d="M2 8h14l1.5-2H22v5h-3l-1.5 1.5V15h-3l-1 4H9.5l1-4H8l-1-2H2z"/></svg>',
  bomb: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="14" r="7"/><path d="M14.5 8.6l2.6-2.6 1.4 1.4-2.6 2.6z"/><path d="M18.6 2.2l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z"/></svg>',
  pod: '<svg viewBox="0 0 24 24"><path d="M12 3l7.5 4.3v9.4L12 21l-7.5-4.3V7.3z" opacity=".95"/><circle cx="12" cy="12" r="3" fill="#0b0e14"/></svg>',
  body: '<svg viewBox="0 0 24 24"><path d="M7 3h10l4 4-2.5 4.5V18l-3 3h-7l-3-3v-6.5L3 7z"/><path d="M9 8h6v3H9z" fill="#0b0e14"/></svg>',
  legs: '<svg viewBox="0 0 24 24"><path d="M6 2h5v8l-2 7 3 5H4l1.5-5L6 10zM13 2h5v8l.5 7L20 22h-8l3-5-2-7z"/></svg>',
};
const LOCK_ICON = '<svg viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0110 0v3h2v12H5V10zm2 0h6V7a3 3 0 00-6 0z"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24"><path d="M9 16.2l-4.2-4.2-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';

const ARROW_HINT = { kb: 'WASD', pad: '✚' };

function part(key: string): AnyPart | undefined {
  const [slot, id] = key.split(':') as [Slot, string];
  return ALL_PARTS[slot]?.[id];
}
function unlockSource(slot: Slot, id: string): Rival | undefined {
  return RIVALS.find((r) => r.unlocks.includes(`${slot}:${id}`));
}

function emblem(p: Paint, unknown = false, cls = ''): HTMLElement {
  const e = h('div', `ra-emblem ${unknown ? 'unknown' : ''} ${!unknown && p.emblem.length > 2 ? 'l3' : ''} ${cls}`, h('span', '', unknown ? '?' : p.emblem));
  if (!unknown) {
    e.style.setProperty('--p', hex(p.primary));
    e.style.setProperty('--s', hex(p.secondary));
    e.style.setProperty('--g', hex(p.glow));
    e.style.setProperty('--k', hex(p.dark));
  }
  return e;
}
function swatches(p: Paint): HTMLElement {
  const row = h('div', 'ra-swatches');
  for (const c of [p.primary, p.secondary, p.trim, p.glow]) {
    const s = h('i');
    s.style.background = hex(c);
    row.append(s);
  }
  return row;
}
/** 1..5 segmented rating bar; optional comparison value. */
function ratingBar(label: string, v: number, cmp?: number): HTMLElement {
  const segs = h('div', 'ra-segs');
  for (let i = 1; i <= 5; i++) {
    let c = '';
    if (i <= v) c = 'on';
    if (cmp !== undefined) {
      if (i > cmp && i <= v) c = 'on gain';
      if (i > v && i <= cmp) c = 'loss';
    }
    const s = h('i', c);
    s.style.setProperty('--i', String(i));
    segs.append(s);
  }
  const delta = cmp !== undefined && cmp !== v ? h('span', `ra-delta ${v > cmp ? 'up' : 'down'}`, v > cmp ? `+${v - cmp}` : `${v - cmp}`) : null;
  return h('div', 'ra-rating', h('span', 'ra-rating-l', label), segs, delta);
}

/* ------------------------------------------------------------------ navigation model */

interface NavOpts {
  act?: () => void;
  adjust?: (dir: -1 | 1) => void;
  focus?: () => void;
  /** Non-interactive but focusable (plays error on act). */
  locked?: boolean;
  /** Don't play the move sound when focused. */
  quiet?: boolean;
}
const NAV = new WeakMap<HTMLElement, NavOpts>();
function nav<T extends HTMLElement>(el: T, o: NavOpts): T {
  el.dataset.nav = '1';
  NAV.set(el, o);
  return el;
}
function btn(label: string, act: () => void, cls = '', icon?: string): HTMLElement {
  const b = h('div', `ra-btn ${cls}`, icon ? svg(icon) : null, h('span', 'ra-btn-l', label));
  return nav(b, { act });
}

type Input = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'prev' | 'next' | 'start';

interface Layer {
  el: HTMLElement;
  back?: () => void;
  /** Any key / button / click advances (title, ending). */
  any?: () => void;
  /** Intercept confirm (e.g. skip typewriter). Return true when consumed. */
  confirm?: () => boolean;
  key?: (k: Input) => boolean;
  focus: HTMLElement | null;
  /** Garage: right stick rotates preview. */
  rotate?: boolean;
}
interface LayerOpts extends Omit<Layer, 'el' | 'focus'> {
  initial?: HTMLElement | null;
}

type HintKey = 'move' | 'confirm' | 'back' | 'tabs' | 'drag' | 'adjust';
const HINTS: Record<HintKey, [string, string]> = {
  move: ['WASD', '✚'],
  confirm: ['Enter', 'A'],
  back: ['Esc', 'B'],
  tabs: ['Q / E', 'LB / RB'],
  drag: ['Drag', 'R-Stick'],
  adjust: ['◀ ▶', '◀ ▶'],
};
function hints(list: [HintKey, string][]): HTMLElement {
  const bar = h('div', 'ra-hints');
  for (const [k, label] of list) {
    const [kb, pad] = HINTS[k];
    bar.append(h('div', 'ra-hint', h('kbd', `k-kb ${k === 'confirm' ? 'a' : k === 'back' ? 'b' : ''}`, kb), h('kbd', `k-pad ${k === 'confirm' ? 'pa' : k === 'back' ? 'pb' : ''}`, pad), h('span', '', label)));
  }
  return bar;
}

/** Shared widgets for the meta screens (src/ui/meta.ts). */
export { h, svg, btn, nav, stagger, hints, emblem, hex, clamp, wait, ratingBar, SLOTS, SLOT_ICON, SLOT_LABEL, LOCK_ICON, CHECK_ICON };
export type { Kid, Layer, LayerOpts };

/* ------------------------------------------------------------------ Menus */

export class Menus implements MenuLayer {
  private stage: HTMLElement;
  private over: HTMLElement;
  private wipeEl: HTMLElement;
  private screen: Layer | null = null;
  private stack: Layer[] = [];
  private raf = 0;
  private padPrev: boolean[] = [];
  private padInit = false;
  private held = { dir: '' as '' | Input, next: 0 };
  private lockUntil = 0;
  private musicNow: MusicTrack | null = null;
  private pauseResolve: ((v: 'resume' | 'restart' | 'quit') => void) | null = null;
  private pauseLayer: Layer | null = null;
  private resizeFn: (() => void) | null = null;
  private mainIdx = 0;
  private gSlot: Slot = 'gun';
  private fb = { rival: RIVALS[0].id, arena: RIVALS[0].arena as string, time: 90 };
  /** G6 meta screens (profile, shop, rewards, share codes, controls). */
  private meta: MetaUI;
  /** True while the Controls panel is capturing a binding (navigation paused). */
  private keyCapture = false;

  constructor(private host: MenuHost, private root: HTMLElement) {
    root.classList.add('ra-root');
    this.stage = h('div', 'ra-stage');
    this.over = h('div', 'ra-over');
    this.wipeEl = h('div', 'ra-wipe', h('i'), h('i'), h('i'));
    root.append(this.stage, this.over, this.wipeEl, h('div', 'ra-scan'));

    window.addEventListener('keydown', this.onKey, true);
    // Hover only steals focus after a real mouse movement — otherwise a cursor parked
    // where a new screen's button appears (e.g. after a match) would hijack keyboard focus.
    let lastMove = 0;
    window.addEventListener('pointermove', (e) => {
      if (e.movementX || e.movementY) lastMove = performance.now();
    });
    root.addEventListener('pointerover', (e) => {
      if (performance.now() - lastMove > 120) return;
      const t = this.navTarget(e.target);
      if (t && t !== this.top?.focus) this.setFocus(t, true);
    });
    root.addEventListener('pointerdown', (e) => {
      this.root.classList.remove('pad');
      const L = this.top;
      if (L?.any && performance.now() > this.lockUntil) {
        e.preventDefault();
        L.any();
      }
    });
    root.addEventListener('click', (e) => {
      const t = this.navTarget(e.target);
      if (!t || performance.now() < this.lockUntil) return;
      this.setFocus(t, false);
      this.activate(t);
    });
    root.addEventListener('contextmenu', (e) => {
      if (this.active) e.preventDefault();
    });
    window.addEventListener('resize', () => this.resizeFn?.());
    this.meta = new MetaUI({
      host,
      setScreen: (el, o) => this.setScreen(el, o),
      pushLayer: (el, o) => this.pushLayer(el, o),
      popLayer: (L) => this.popLayer(L),
      focus: (el) => this.setFocusKeep(el),
      confirmBox: (...a) => this.confirmBox(...a),
      toast: (t) => this.toast(t),
      header: (k, t, x) => this.header(k, t, x),
      music: (t) => this.music(t),
      isScreen: (el) => this.screen?.el === el,
      setCapture: (on) => { this.keyCapture = on; },
      setResize: (fn) => { this.resizeFn = fn; },
    });
    this.sync();
  }

  /* ---------------- MenuLayer API */

  get active(): boolean {
    return !!this.screen || this.stack.length > 0;
  }

  showTitle(): void {
    this.backdrop('title');
    this.music('menu');
    const el = h('div', 'scr scr-title');
    const logo = this.logo('big');
    const tag = h('div', 'title-tag', h('i'), 'Build it · Bolt it · Battle it', h('i'));
    const press = h('div', 'title-press', h('span', 'k-kb', 'Press any key'), h('span', 'k-pad', 'Press any button'));
    const foot = h('div', 'title-foot', h('span', '', 'An original robot-combat game'), h('span', '', 'v1.0'));
    el.append(h('div', 'vig vig-top'), h('div', 'vig vig-bot'), logo, tag, press, foot);
    stagger([tag], 700);
    let gone = false;
    this.setScreen(el, {
      any: () => {
        if (gone) return;
        gone = true;
        this.host.sfx('ui_select');
        press.classList.add('go');
        setTimeout(() => this.showMain(), 260);
      },
    });
  }

  showPause(): Promise<'resume' | 'restart' | 'quit'> {
    if (this.pauseResolve) this.closePause('resume');
    return new Promise((resolve) => {
      this.pauseResolve = resolve;
      const el = h('div', 'ra-modal ra-pause');
      const panel = h('div', 'ra-panel pause-panel');
      const title = h('div', 'pause-title', 'PAUSED');
      const list = h('div', 'pause-list');
      const resume = btn('Resume', () => this.closePause('resume'), 'big');
      const restart = btn('Restart', () => this.closePause('restart'), 'big');
      const settings = btn('Settings', () => this.openSettingsOverlay(), 'big');
      const quit = btn('Quit to Menu', async () => {
        const ok = await this.confirmBox('Quit match?', 'Progress in this round will be lost.', 'Quit', 'Keep Fighting', true);
        if (ok) this.closePause('quit');
      }, 'big danger');
      list.append(resume, restart, settings, quit);
      panel.append(h('div', 'ra-kicker', 'Match suspended'), title, list, hints([['move', 'Move'], ['confirm', 'Select'], ['back', 'Resume']]));
      stagger([title, resume, restart, settings, quit], 0, 45);
      el.append(panel);
      this.pauseLayer = this.pushLayer(el, { back: () => this.closePause('resume', true), initial: resume });
      this.host.sfx('ui_select');
    });
  }

  hidePause(): void {
    if (this.pauseResolve) this.closePause('resume', true);
  }

  /* ---------------- core layer plumbing */

  private get top(): Layer | null {
    return this.stack[this.stack.length - 1] ?? this.screen;
  }

  private sync() {
    const a = this.active;
    this.root.style.pointerEvents = a ? 'auto' : 'none';
    this.root.classList.toggle('is-active', a);
    if (a && !this.raf) {
      this.padInit = false;
      this.raf = requestAnimationFrame(this.loop);
    } else if (!a && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private setScreen(el: HTMLElement, opts: LayerOpts = {}) {
    const old = this.screen;
    this.resizeFn = null;
    if (old) {
      old.el.classList.add('leaving');
      setTimeout(() => old.el.remove(), 380);
      this.wipe();
    }
    for (const l of this.stack) l.el.remove();
    this.stack = [];
    el.classList.add('scr');
    this.stage.append(el);
    const { initial, ...rest } = opts;
    this.screen = { el, focus: null, ...rest };
    this.lockUntil = performance.now() + 220;
    this.sync();
    const f = initial ?? this.navItems(this.screen)[0];
    if (f) this.setFocus(f, false);
  }

  private pushLayer(el: HTMLElement, opts: LayerOpts = {}): Layer {
    const { initial, ...rest } = opts;
    const L: Layer = { el, focus: null, ...rest };
    this.over.append(el);
    this.stack.push(L);
    this.lockUntil = performance.now() + 200;
    this.sync();
    const f = initial ?? this.navItems(L)[0];
    if (f) this.setFocus(f, false);
    return L;
  }

  private popLayer(L: Layer) {
    const i = this.stack.indexOf(L);
    if (i < 0) return;
    this.stack.splice(i, 1);
    L.el.classList.add('leaving');
    setTimeout(() => L.el.remove(), 260);
    this.lockUntil = performance.now() + 120;
    this.sync();
  }

  private hideAll() {
    if (this.screen) {
      const el = this.screen.el;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 380);
    }
    for (const l of this.stack) l.el.remove();
    this.stack = [];
    this.screen = null;
    this.resizeFn = null;
    this.sync();
  }

  private wipe() {
    const w = this.wipeEl;
    w.classList.remove('run');
    void w.offsetWidth;
    w.classList.add('run');
  }

  private backdrop(kind: Parameters<MenuHost['setBackdrop']>[0], opts?: Parameters<MenuHost['setBackdrop']>[1]) {
    this.host.setBackdrop(kind, opts);
  }
  private music(t: MusicTrack) {
    if (this.musicNow === t) return;
    this.musicNow = t;
    this.host.music(t);
  }

  private navTarget(t: EventTarget | null): HTMLElement | null {
    const L = this.top;
    if (!L || !(t instanceof Element)) return null;
    const n = t.closest('[data-nav]') as HTMLElement | null;
    return n && L.el.contains(n) ? n : null;
  }

  private navItems(L: Layer): HTMLElement[] {
    return Array.from(L.el.querySelectorAll<HTMLElement>('[data-nav]')).filter((e) => {
      if (e.classList.contains('is-hidden')) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  private setFocus(el: HTMLElement | null, sound: boolean) {
    const L = this.top;
    if (!L || !el) return;
    if (L.focus === el) return;
    L.focus?.classList.remove('is-focus');
    L.focus = el;
    el.classList.add('is-focus');
    const o = NAV.get(el);
    o?.focus?.();
    if (sound && !o?.quiet) this.host.sfx('ui_move');
    // keep visible inside scrolling lists
    const sc = el.closest('.ra-scroll') as HTMLElement | null;
    if (sc) {
      const r = el.getBoundingClientRect(), s = sc.getBoundingClientRect();
      if (r.top < s.top + 4) sc.scrollTop -= s.top - r.top + 8;
      else if (r.bottom > s.bottom - 4) sc.scrollTop += r.bottom - s.bottom + 8;
    }
  }

  private activate(el: HTMLElement) {
    const o = NAV.get(el);
    if (!o) return;
    if (o.locked || el.classList.contains('is-disabled')) {
      this.host.sfx('ui_error');
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      return;
    }
    if (o.act) {
      el.classList.remove('press');
      void el.offsetWidth;
      el.classList.add('press');
      o.act();
    }
  }

  private move(dir: 'up' | 'down' | 'left' | 'right') {
    const L = this.top;
    if (!L) return;
    const items = this.navItems(L);
    if (!items.length) return;
    const cur = L.focus && items.includes(L.focus) ? L.focus : null;
    if (!cur) {
      this.setFocus(items[0], true);
      return;
    }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const c of items) {
      if (c === cur) continue;
      const b = c.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      let along: number, ortho: number;
      if (dir === 'left' || dir === 'right') {
        const s = dir === 'right' ? 1 : -1;
        if ((bx - ax) * s <= 2) continue;
        along = Math.max(0, s > 0 ? b.left - a.right : a.left - b.right);
        ortho = b.bottom < a.top ? a.top - b.bottom : b.top > a.bottom ? b.top - a.bottom : 0;
        ortho += Math.abs(by - ay) * 0.1;
      } else {
        const s = dir === 'down' ? 1 : -1;
        if ((by - ay) * s <= 2) continue;
        along = Math.max(0, s > 0 ? b.top - a.bottom : a.top - b.bottom);
        ortho = b.right < a.left ? a.left - b.right : b.left > a.right ? b.left - a.right : 0;
        ortho += Math.abs(bx - ax) * 0.1;
      }
      const score = along + ortho * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) this.setFocus(best, true);
  }

  private input(k: Input) {
    if (!this.active || this.keyCapture) return;
    const L = this.top!;
    const now = performance.now();
    if (L.any) {
      if (now > this.lockUntil) L.any();
      return;
    }
    if (k === 'start') {
      if (this.pauseResolve) this.closePause('resume');
      else this.input('confirm');
      return;
    }
    if ((k === 'confirm' || k === 'back') && now < this.lockUntil) return;
    if (L.key?.(k)) return;
    switch (k) {
      case 'left':
      case 'right': {
        const o = L.focus ? NAV.get(L.focus) : undefined;
        if (o?.adjust) {
          o.adjust(k === 'left' ? -1 : 1);
          return;
        }
        this.move(k);
        return;
      }
      case 'up':
      case 'down':
        this.move(k);
        return;
      case 'confirm':
        if (L.confirm?.()) return;
        if (L.focus) this.activate(L.focus);
        return;
      case 'back':
        if (L.back) {
          this.host.sfx('ui_back');
          L.back();
        }
        return;
    }
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.active || this.keyCapture) return;
    // let text fields (build-code import) receive typing; Esc still backs out
    if ((e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) && e.code !== 'Escape') return;
    this.root.classList.remove('pad');
    const L = this.top!;
    if (L.any) {
      if (e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      this.input('confirm');
      return;
    }
    let k: Input | null = null;
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': k = 'up'; break;
      case 'ArrowDown': case 'KeyS': k = 'down'; break;
      case 'ArrowLeft': case 'KeyA': k = 'left'; break;
      case 'ArrowRight': case 'KeyD': k = 'right'; break;
      case 'Enter': case 'NumpadEnter': case 'Space': k = 'confirm'; break;
      case 'Escape': case 'Backspace': k = 'back'; break;
      case 'KeyQ': case 'PageUp': k = 'prev'; break;
      case 'KeyE': case 'PageDown': k = 'next'; break;
      case 'Tab': k = e.shiftKey ? 'prev' : 'next'; break;
    }
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat && (k === 'confirm' || k === 'back' || k === 'prev' || k === 'next')) return;
    this.input(k);
  };

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) return;
    const b = gp.buttons.map((x) => x.pressed);
    if (!this.padInit) {
      this.padPrev = b;
      this.padInit = true;
      return;
    }
    const prev = this.padPrev;
    const edge = (i: number) => !!b[i] && !prev[i];
    const anyEdge = b.some((v, i) => v && !prev[i]);
    const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
    let dir: '' | Input = '';
    if (b[12]) dir = 'up';
    else if (b[13]) dir = 'down';
    else if (b[14]) dir = 'left';
    else if (b[15]) dir = 'right';
    else if (Math.abs(ax) > 0.55 || Math.abs(ay) > 0.55) dir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : (ay > 0 ? 'down' : 'up');
    if (anyEdge || dir) this.root.classList.add('pad');
    this.padPrev = b;

    const L = this.top;
    if (!L) return;
    if (L.any) {
      if (anyEdge) this.input('confirm');
      return;
    }
    if (L.rotate) {
      const rx = gp.axes[2] ?? 0;
      if (Math.abs(rx) > 0.15) this.host.rotatePreview(rx * 0.05);
    }
    const now = performance.now();
    if (dir !== this.held.dir) {
      this.held.dir = dir;
      if (dir) {
        this.input(dir);
        this.held.next = now + 380;
      }
    } else if (dir && now >= this.held.next) {
      this.input(dir);
      this.held.next = now + 110;
    }
    if (edge(0)) this.input('confirm');
    if (edge(1)) this.input('back');
    if (edge(9)) this.input('start');
    if (edge(4)) this.input('prev');
    if (edge(5)) this.input('next');
  };

  /* ---------------- shared widgets */

  private logo(size: 'big' | 'small'): HTMLElement {
    const l = h('div', `ra-logo ${size}`);
    const robo = h('div', 'logo-word w1', 'ROBO');
    robo.dataset.t = 'ROBO';
    const arena = h('div', 'logo-word w2', 'ARENA');
    arena.dataset.t = 'ARENA';
    l.append(h('div', 'logo-stripe', h('i'), h('i')), h('div', 'logo-line l1', robo), h('div', 'logo-line l2', arena), h('div', 'logo-chip', '07'));
    return l;
  }

  private confirmBox(title: string, text: string, yes = 'Confirm', no = 'Cancel', danger = false): Promise<boolean> {
    return new Promise((resolve) => {
      const el = h('div', 'ra-modal ra-confirm');
      let L: Layer;
      const done = (v: boolean) => {
        this.popLayer(L);
        this.host.sfx(v ? 'ui_select' : 'ui_back');
        resolve(v);
      };
      const bNo = btn(no, () => done(false));
      const bYes = btn(yes, () => done(true), danger ? 'danger' : 'primary');
      const panel = h('div', 'ra-panel confirm-panel', h('div', 'confirm-stripe'), h('div', 'confirm-title', title), h('div', 'confirm-text', text), h('div', 'confirm-btns', bNo, bYes));
      el.append(panel);
      L = this.pushLayer(el, { back: () => { this.popLayer(L); resolve(false); }, initial: bNo });
    });
  }

  private toast(text: string) {
    const t = h('div', 'ra-toast', text);
    this.root.append(t);
    setTimeout(() => t.classList.add('out'), 1800);
    setTimeout(() => t.remove(), 2300);
  }

  private header(kicker: string, title: string, extra?: Kid): HTMLElement {
    const hd = h('div', 'ra-header', h('div', 'ra-kicker', kicker), h('div', 'ra-title', title), extra ?? null);
    stagger([hd], 0);
    return hd;
  }

  /* ---------------- main menu */

  private showMain() {
    this.backdrop('title');
    this.music('menu');
    const s = this.host.save;
    const el = h('div', 'scr-main');
    const done = Math.min(s.ladder, RIVALS.length);
    const champ = s.ladder >= RIVALS.length;

    const items: [string, string, string | null, () => void][] = [
      ['Story Ladder', champ ? 'You hold the crown. Defend it.' : 'Climb the circuit. Five rivals stand between you and the crown.', champ ? 'CHAMPION' : `Ladder ${done}/${RIVALS.length}`, () => this.showLadder()],
      ['Free Battle', 'Any rival, any arena, your rules.', null, () => this.showFree()],
      ['Modes', 'Rival+ ladder, survival, practice room, local versus and replays.', champ ? 'RIVAL+' : null, () => this.showModes()],
      ['Garage', 'Swap guns, bombs, pods, frames and legs.', `${s.unlocked.length} parts`, () => this.showGarage(() => this.showMain())],
      ['Profile', 'Pilot card, achievements, challenges and part mastery.', `Lv ${pilotLevel(s)}`, () => this.meta.showProfile(() => this.showMain())],
      ['Shop', 'Spend credits on paint, decals, trails and victory poses.', `${s.credits.toLocaleString('en-US')} CR`, () => this.meta.showShop(() => this.showMain())],
      ['Settings', 'Audio, camera, graphics and controls.', null, () => this.showSettings(() => this.showMain())],
    ];
    const list = h('div', 'mm-list');
    const hl = h('div', 'mm-hl');
    list.append(hl);
    const els = items.map(([label, desc, tag, act], i) => {
      const it = nav(h('div', 'mm-item', h('div', 'mm-num', `0${i + 1}`), h('div', 'mm-text', h('div', 'mm-label', label), h('div', 'mm-desc', desc)), tag ? h('div', 'mm-tag', tag) : null), {
        act: () => {
          this.mainIdx = i;
          this.host.sfx('ui_select');
          act();
        },
        focus: () => {
          this.mainIdx = i;
          hl.style.transform = `translateY(${it.offsetTop}px)`;
          hl.style.height = `${it.offsetHeight}px`;
          hl.classList.add('on');
        },
      });
      list.append(it);
      return it;
    });
    const left = h('div', 'mm-left', this.logo('small'), list);
    stagger(els, 120, 70);

    // record card
    const pips = h('div', 'mm-pips');
    RIVALS.forEach((r, i) => {
      const p = h('i', s.beaten.includes(r.id) || i < s.ladder ? 'on' : i === s.ladder ? 'next' : '');
      pips.append(p);
    });
    const L = resolveLoadout(s.loadout);
    const card = h('div', 'ra-panel mm-card',
      h('div', 'mm-card-top', emblem(s.paint), h('div', '', h('div', 'mm-card-name', PLAYER_ROBOT_NAME), h('div', 'mm-card-sub', L.body.name))),
      h('div', 'mm-card-row', h('span', '', 'Circuit'), pips),
      h('div', 'mm-card-row', h('span', '', 'Record'), h('b', '', `${s.totals.wins}W · ${s.totals.losses}L`)),
      h('div', 'mm-card-row', h('span', '', 'Credits'), h('b', '', `${s.credits.toLocaleString('en-US')} CR`)),
      h('div', 'mm-card-parts', ...SLOTS.map((sl) => h('div', 'mm-card-part', svg(SLOT_ICON[sl]), h('span', '', resolveLoadout(s.loadout)[sl].name)))),
    );
    stagger([card], 380);
    el.append(h('div', 'vig vig-left'), left, card, hints([['move', 'Move'], ['confirm', 'Select'], ['back', 'Title']]));
    this.setScreen(el, { back: () => this.showTitle(), initial: els[clamp(this.mainIdx, 0, els.length - 1)] });
  }

  /* ---------------- story ladder */

  private showLadder() {
    this.backdrop('title');
    this.music('menu');
    const s = this.host.save;
    const nextIdx = Math.min(s.ladder, RIVALS.length - 1);
    const champ = s.ladder >= RIVALS.length;
    const el = h('div', 'scr-ladder');
    const cleared = RIVALS.filter((r, i) => s.beaten.includes(r.id) || i < s.ladder).length;
    const hd = this.header('Story Mode', 'Story Ladder', h('div', 'ra-sub', champ ? 'Champion of the circuit — every rival can be challenged again.' : `Rank ${cleared + 1} of ${RIVALS.length} · Defeat each rival to climb. Wins unlock their parts.`));

    const row = h('div', 'lad-row');
    let initial: HTMLElement | null = null;
    const cols: HTMLElement[] = [];
    RIVALS.forEach((r, i) => {
      const isClear = s.beaten.includes(r.id) || i < s.ladder;
      const isNext = !champ && i === s.ladder;
      const locked = !isClear && !isNext;
      const state = isClear ? 'cleared' : isNext ? 'next' : 'locked';
      const arena = ARENA_INFO[r.arena as ArenaId];
      const card = h('div', `lad-card ${state} ${i === RIVALS.length - 1 ? 'champ' : ''}`);
      if (!locked) {
        card.style.setProperty('--p', hex(r.paint.primary));
        card.style.setProperty('--g', hex(r.paint.glow));
      }
      card.append(
        h('div', 'lad-rank', i === RIVALS.length - 1 ? 'FINAL' : `ROUND ${i + 1}`),
        h('div', 'lad-badge', isClear ? h('span', 'ok', svg(CHECK_ICON), 'Cleared') : isNext ? h('span', 'nx', 'Next') : h('span', 'lk', svg(LOCK_ICON), 'Locked')),
        emblem(r.paint, locked, 'lad-emb'),
        h('div', 'lad-robot', locked ? '???' : r.robotName),
        h('div', 'lad-pilot', locked ? 'Unknown pilot' : r.pilot),
        h('div', 'lad-title', locked ? '— — —' : r.title),
        locked ? h('div', 'ra-swatches ghost', h('i'), h('i'), h('i'), h('i')) : swatches(r.paint),
        h('div', 'lad-arena', h('span', '', 'Arena'), locked ? '???' : arena?.name ?? r.arena),
      );
      if (arena && !locked) card.style.setProperty('--a', arena.accent);
      nav(card, { act: () => { this.host.sfx('ui_select'); this.showIntro(i); }, locked });
      const plinth = h('div', 'lad-plinth', h('span', '', String(i + 1).padStart(2, '0')));
      plinth.style.height = `calc(var(--u) * ${2.6 + i * 1.7})`;
      const col = h('div', `lad-col ${state}`, card, plinth);
      cols.push(col);
      row.append(col);
      if (i === nextIdx) initial = card;
    });
    stagger(cols, 120, 80);

    const next = RIVALS[nextIdx];
    const fight = btn(champ ? `Rematch ${next.pilot}` : `Fight ${next.pilot}`, () => { this.host.sfx('ui_select'); this.showIntro(nextIdx); }, 'primary big', SLOT_ICON.gun);
    const garage = btn('Garage', () => { this.host.sfx('ui_select'); this.showGarage(() => this.showLadder()); }, 'big', SLOT_ICON.body);
    const back = btn('Back', () => { this.host.sfx('ui_back'); this.showMain(); }, 'big');
    const bar = h('div', 'ra-actions', fight, garage, back);
    stagger([bar], 520);
    el.append(h('div', 'vig vig-bot'), hd, row, bar, hints([['move', 'Move'], ['confirm', 'Fight'], ['back', 'Back']]));
    this.setScreen(el, { back: () => this.showMain(), initial: initial ?? fight });
  }

  /* ---------------- versus / rival intro */

  private showIntro(i: number) {
    const r = RIVALS[i];
    const s = this.host.save;
    const cfg: MatchConfig = { mode: 'ladder', playerLoadout: { ...s.loadout }, rivalId: r.id, arenaId: r.arena, ladderIndex: i };
    const arena = ARENA_INFO[r.arena as ArenaId];
    this.showVersus(r, {
      line: r.intro,
      kicker: i === RIVALS.length - 1 ? 'Championship Final' : `Ladder Round ${i + 1} / ${RIVALS.length}`,
      info: [arena?.name ?? r.arena, arena?.subtitle ?? ''],
      onFight: () => this.runMatch(cfg),
      onBack: () => this.showLadder(),
      onGarage: () => this.showGarage(() => this.showIntro(i)),
    });
  }

  private showVersus(r: Rival, o: { line: string; kicker: string; info: [string, string]; onFight: () => void; onBack: () => void; onGarage?: () => void }) {
    const s = this.host.save;
    this.backdrop('versus', { loadout: s.loadout, rivalId: r.id });
    this.music('menu');
    const el = h('div', 'scr-vs');
    const L = resolveLoadout(s.loadout);
    const left = h('div', 'vs-plate left',
      emblem(PLAYER_PAINT, false, 'vs-emb'),
      h('div', 'vs-names', h('div', 'vs-pilot', 'Player 1'), h('div', 'vs-robot', PLAYER_ROBOT_NAME), h('div', 'vs-title', `${L.body.name} · ${L.gun.name}`)));
    left.style.setProperty('--g', hex(PLAYER_PAINT.secondary));
    const right = h('div', 'vs-plate right',
      h('div', 'vs-names', h('div', 'vs-pilot', r.pilot), h('div', 'vs-robot', r.robotName), h('div', 'vs-title', r.title)),
      emblem(r.paint, false, 'vs-emb'));
    right.style.setProperty('--g', hex(r.paint.glow));
    const vs = h('div', 'vs-slam', h('span', 'v', 'V'), h('span', 's', 'S'));
    const info = h('div', 'vs-info', h('div', 'vs-kicker', o.kicker), h('div', 'vs-arena', o.info[0]), o.info[1] ? h('div', 'vs-arena-sub', o.info[1]) : null);

    // dialog
    const text = h('div', 'dlg-text');
    const caret = h('div', 'dlg-caret');
    const fight = btn('FIGHT', () => go(), 'primary big fight-btn');
    const acts: HTMLElement[] = [fight];
    if (o.onGarage) acts.push(btn('Garage', () => { this.host.sfx('ui_select'); o.onGarage!(); }, 'big'));
    acts.push(btn('Back', () => { this.host.sfx('ui_back'); o.onBack(); }, 'big'));
    const actRow = h('div', 'dlg-acts', ...acts);
    for (const a of acts) a.classList.add('is-hidden');
    const dlg = h('div', 'ra-panel dlg', h('div', 'dlg-name', emblem(r.paint, false, 'mini'), r.pilot), text, caret, actRow);
    el.append(h('div', 'vig vig-top'), h('div', 'vig vig-bot'), left, vs, right, info, dlg, hints([['confirm', 'Skip / Fight'], ['back', 'Back']]));

    let typing = true, n = 0, timer = 0;
    const full = o.line;
    const finish = () => {
      typing = false;
      clearInterval(timer);
      text.textContent = full;
      caret.classList.add('done');
      for (const a of acts) a.classList.remove('is-hidden');
      actRow.classList.add('show');
      if (this.screen?.el === el) this.setFocus(fight, false);
    };
    const startType = () => {
      timer = window.setInterval(() => {
        if (this.screen?.el !== el) { clearInterval(timer); return; }
        n += 1;
        text.textContent = full.slice(0, n);
        if (n >= full.length) finish();
      }, 24);
    };
    setTimeout(() => { if (this.screen?.el === el) this.host.sfx('ui_unlock'); }, 520);
    setTimeout(() => { if (typing) startType(); }, 900);

    let launched = false;
    const go = () => {
      if (launched) return;
      launched = true;
      this.host.sfx('ui_select');
      const stamp = h('div', 'fight-stamp', h('span', '', 'FIGHT!'));
      el.append(stamp);
      el.classList.add('launch');
      setTimeout(() => o.onFight(), 950);
    };
    this.setScreen(el, {
      back: () => { clearInterval(timer); if (!launched) o.onBack(); },
      confirm: () => {
        if (launched) return true;
        if (typing) {
          finish();
          return true;
        }
        return false;
      },
    });
  }

  /* ---------------- match & results */

  private async runMatch(cfg: MatchConfig) {
    // replays must keep the recorded build; everything else uses the current garage loadout
    cfg = { ...cfg, playerLoadout: cfg.mode === 'replay' ? { ...cfg.playerLoadout } : { ...this.host.save.loadout } };
    this.hideAll();
    this.musicNow = null;
    let res: MatchResult = await this.host.startMatch(cfg);
    while (res.restart && !res.quit) res = await this.host.startMatch(cfg);
    this.musicNow = null;
    if (res.quit) {
      if (cfg.mode === 'ladder') this.showLadder();
      else if (cfg.mode === 'free') this.showFree();
      else this.showModes();
      return;
    }
    if (res.replay && cfg.mode !== 'replay') saveReplay(res.replay);
    if (cfg.mode === 'replay' || cfg.mode === 'practice') {
      this.showModes();
      return;
    }
    this.showResults(res);
  }

  private showResults(res: MatchResult) {
    const s = this.host.save;
    const cfg = res.config;
    const r = rivalById(cfg.rivalId);
    const ladder = cfg.mode === 'ladder';
    const idx = cfg.ladderIndex ?? RIVALS.findIndex((x) => x.id === r.id);
    const win = res.outcome === 'win';
    const newParts: string[] = [];
    let championNow = false;

    if (win) {
      s.totals.wins++;
      if (ladder) {
        if (!s.beaten.includes(r.id)) {
          s.beaten.push(r.id);
          for (const u of r.unlocks) {
            if (!s.unlocked.includes(u)) {
              s.unlocked.push(u);
              newParts.push(u);
            }
          }
          if (idx === RIVALS.length - 1) championNow = true;
        }
        s.ladder = Math.max(s.ladder, idx + 1);
      }
    } else if (res.outcome === 'lose') {
      s.totals.losses++;
    }
    const plus = cfg.mode === 'rivalplus';
    const pidx = cfg.plusIndex ?? 0;
    if (win && plus) {
      if (!s.plusBeaten.includes(r.id)) {
        s.plusBeaten.push(r.id);
        for (const u of r.unlocks) {
          if (!s.unlocked.includes(u)) {
            s.unlocked.push(u);
            newParts.push(u);
          }
        }
      }
      s.plusLadder = Math.max(s.plusLadder, pidx + 1);
    }
    const survival = cfg.mode === 'survival' ? cfg.survival : undefined;
    // best run counts completed rounds, saved after every round (a run abandoned mid-way still counts)
    if (survival) s.survivalBest = Math.max(s.survivalBest, win ? survival.round : survival.round - 1);
    s.totals.knockdowns += res.player?.knockdowns ?? 0;
    this.host.persist();
    const rewards = this.meta.matchEnd(res);

    this.backdrop('versus', { loadout: s.loadout, rivalId: r.id });
    this.music(win ? 'victory' : 'results');

    const el = h('div', `scr-res ${res.outcome}`);
    const word = win ? 'VICTORY' : res.outcome === 'lose' ? 'DEFEAT' : 'DRAW';
    const banner = h('div', 'res-banner', h('div', 'res-word', ...word.split('').map((c, i) => {
      const sp = h('span', '', c);
      sp.style.setProperty('--i', String(i));
      return sp;
    })), h('div', 'res-finish', h('b', '', res.finish === 'ko' ? 'K.O.' : 'TIME UP'), h('span', '', fmtTime(res.time)), h('span', '', ladder ? (idx === RIVALS.length - 1 ? 'Championship Final' : `Ladder Round ${idx + 1}`) : 'Free Battle')));
    banner.dataset.word = word;

    const hpBar = (hp: number, max: number, side: 'l' | 'r') => {
      const pct = clamp(max > 0 ? hp / max : 0, 0, 1);
      const fill = h('i');
      fill.style.setProperty('--w', String(pct));
      return h('div', `res-hp ${side} ${pct < 0.3 ? 'low' : ''}`, h('div', 'res-hp-track', fill), h('span', '', `${Math.max(0, Math.round(hp))} / ${Math.round(max)}`));
    };
    const top = h('div', 'res-top',
      h('div', 'res-side l', emblem(s.paint), h('div', '', h('div', 'res-name', PLAYER_ROBOT_NAME), hpBar(res.playerHp, res.playerMaxHp, 'l'))),
      h('div', 'res-mid', 'HP'),
      h('div', 'res-side r', h('div', '', h('div', 'res-name', r.robotName), hpBar(res.rivalHp, res.rivalMaxHp, 'r')), emblem(r.paint)));
    const rows: [string, keyof MatchResult['player']][] = [['Damage dealt', 'damageDealt'], ['Hits', 'hits'], ['Knockdowns', 'knockdowns'], ['Dodges', 'dodges'], ['Shots fired', 'shots']];
    const stats = h('div', 'res-stats');
    const counters: [HTMLElement, number][] = [];
    rows.forEach(([label, key], i) => {
      const a = Math.round(res.player?.[key] ?? 0), b = Math.round(res.rival?.[key] ?? 0);
      const m = Math.max(1, a, b);
      const la = h('b', a >= b ? 'lead' : '', '0'), lb = h('b', b >= a ? 'lead' : '', '0');
      counters.push([la, a], [lb, b]);
      const fa = h('i'), fb = h('i');
      fa.style.setProperty('--w', String(a / m));
      fb.style.setProperty('--w', String(b / m));
      const row = h('div', 'res-row', la, h('div', 'res-bar l', fa), h('span', 'res-lbl', label), h('div', 'res-bar r', fb), lb);
      row.style.setProperty('--i', String(i));
      stats.append(row);
    });
    const line = win ? r.defeatLine : res.outcome === 'lose' ? r.taunt : r.taunt;
    const quote = h('div', 'res-quote', emblem(r.paint, false, 'mini'), h('div', '', h('div', 'res-quote-name', r.pilot), h('div', 'res-quote-text', `“${line}”`)));
    const g = gradeMatch(res);
    const gradeEl = h('div', `res-grade g-${g.grade}`, h('div', 'res-grade-letter', g.grade), h('div', 'res-grade-parts', ...g.parts.map((p) => h('div', '', h('span', '', p.label), h('b', '', `${p.points}/${p.max}`)))));
    // counter-hint after a loss: what to try next
    let hintEl: HTMLElement | null = null;
    if (!win && r.hint) {
      const sug = r.suggest ? part(r.suggest) : undefined;
      const owned = r.suggest ? s.unlocked.includes(r.suggest) : false;
      hintEl = h('div', 'res-hint', h('b', '', 'TIP'), h('span', '', r.hint), sug ? h('em', '', owned ? `Try: ${sug.name}` : `Try: ${sug.name} (locked)`) : null);
    }
    const panel = h('div', 'ra-panel res-panel', top, stats, gradeEl, hintEl, quote);

    const acts: HTMLElement[] = [];
    const retryCfg = () => ({ ...cfg, playerLoadout: { ...s.loadout } });
    if (championNow) {
      acts.push(btn('Continue', () => { this.host.sfx('ui_select'); this.showEnding(); }, 'primary big'));
    } else if (plus) {
      if (win && pidx + 1 < RIVALS_PLUS.length) acts.push(btn('Next Rival+', () => { this.host.sfx('ui_select'); this.showPlusIntro(pidx + 1); }, 'primary big'));
      acts.push(btn(win ? 'Fight Again' : 'Retry', () => { this.host.sfx('ui_select'); this.runMatch(retryCfg()); }, win && pidx + 1 < RIVALS_PLUS.length ? 'big' : 'primary big'));
      acts.push(btn('Modes', () => { this.host.sfx('ui_back'); this.showModes(); }, 'big'));
    } else if (survival) {
      if (win) {
        const heal = Math.min(res.playerMaxHp, res.playerHp + res.playerMaxHp * 0.25);
        acts.push(btn(`Round ${survival.round + 1}`, () => { this.host.sfx('ui_select'); this.runMatch(this.survivalCfg(survival.round + 1, heal)); }, 'primary big'));
      } else {
        acts.push(btn('New Run', () => { this.host.sfx('ui_select'); this.runMatch(this.survivalCfg(1, 99999)); }, 'primary big'));
      }
      acts.push(btn('Modes', () => { this.host.sfx('ui_back'); this.showModes(); }, 'big'));
    } else if (cfg.mode === 'versus') {
      acts.push(btn('Rematch', () => { this.host.sfx('ui_select'); this.runMatch(retryCfg()); }, 'primary big'));
      acts.push(btn('Modes', () => { this.host.sfx('ui_back'); this.showModes(); }, 'big'));
    } else if (ladder) {
      if (win && idx + 1 < RIVALS.length) acts.push(btn('Next Fight', () => { this.host.sfx('ui_select'); this.showIntro(idx + 1); }, 'primary big'));
      acts.push(btn(win ? 'Fight Again' : 'Retry', () => { this.host.sfx('ui_select'); this.runMatch(retryCfg()); }, win && idx + 1 < RIVALS.length ? 'big' : 'primary big'));
      acts.push(btn('Garage', () => { this.host.sfx('ui_select'); this.showGarage(() => this.showLadder()); }, 'big'));
      acts.push(btn('Main Menu', () => { this.host.sfx('ui_back'); this.showMain(); }, 'big'));
    } else {
      acts.push(btn('Rematch', () => { this.host.sfx('ui_select'); this.runMatch(retryCfg()); }, 'primary big'));
      acts.push(btn('Change Setup', () => { this.host.sfx('ui_select'); this.showFree(); }, 'big'));
      acts.push(btn('Main Menu', () => { this.host.sfx('ui_back'); this.showMain(); }, 'big'));
    }
    if (res.replay) {
      const rp = res.replay;
      acts.push(btn('Watch Replay', () => { this.host.sfx('ui_select'); this.watchReplay(rp); }, 'big'));
    }
    acts.push(btn('Photo Mode', () => this.openPhoto(), 'big'));
    const bar = h('div', 'ra-actions res-acts', ...acts);
    stagger([panel], 450);
    stagger([bar], 800);
    el.append(h('div', 'vig vig-top'), h('div', 'vig vig-bot'), banner, panel, bar, hints([['move', 'Move'], ['confirm', 'Select']]));
    this.setScreen(el, { back: championNow ? undefined : () => this.showMain(), initial: acts[0] });
    this.meta.rewardsStrip(el, rewards);

    // count-up numbers
    const t0 = performance.now() + 600;
    const tick = () => {
      if (this.screen?.el !== el) return;
      const k = clamp((performance.now() - t0) / 900, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      for (const [n, v] of counters) n.textContent = String(Math.round(v * e));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    if (newParts.length) {
      (async () => {
        await wait(1300);
        for (const p of newParts) {
          if (this.screen?.el !== el) return;
          await this.unlockCard(p);
        }
      })();
    }
  }

  private unlockCard(key: string): Promise<void> {
    const p = part(key);
    if (!p) return Promise.resolve();
    return new Promise((resolve) => {
      const el = h('div', 'ra-modal ra-unlock');
      let L: Layer;
      const close = () => {
        this.popLayer(L);
        this.host.sfx('ui_select');
        resolve();
      };
      const ok = btn('Awesome!', close, 'primary');
      const ratings = h('div', 'unl-ratings', ...Object.entries(p.ratings).map(([k, v]) => ratingBar(k, v)));
      const card = h('div', 'unl-card',
        h('div', 'unl-burst'),
        h('div', 'unl-new', 'NEW PART!'),
        h('div', 'unl-icon', svg(SLOT_ICON[p.slot])),
        h('div', 'unl-slot', `${SLOT_LABEL[p.slot]} Part`),
        h('div', 'unl-name', p.name),
        h('div', 'unl-desc', p.desc),
        ratings,
        h('div', 'unl-foot', 'Equip it in the Garage'),
        ok);
      el.append(card);
      this.host.sfx('ui_unlock');
      L = this.pushLayer(el, { back: close, initial: ok });
    });
  }

  /* ---------------- ending */

  private showEnding() {
    this.backdrop('title');
    this.music('victory');
    const el = h('div', 'scr-end');
    const rays = h('div', 'end-rays');
    const crown = h('div', 'end-crown', svg('<svg viewBox="0 0 64 40"><path d="M4 36L0 6l16 12L32 0l16 18L64 6l-4 30z"/></svg>'));
    const word = h('div', 'end-word', ...'CHAMPION'.split('').map((c, i) => {
      const sp = h('span', '', c);
      sp.style.setProperty('--i', String(i));
      return sp;
    }));
    const sub = h('div', 'end-sub', `${PLAYER_ROBOT_NAME} · Champion of the Circuit`);
    const epi = h('div', 'end-epi');
    const lines = [
      'Sovereign drops to one knee on the Halo Deck, and the ring goes silent — then erupts.',
      'Five rivals. Three arenas. One rookie pilot and a robot bolted together part by part.',
      'The crown is yours now. Somewhere far below, someone is already building the machine that will come for it.',
    ];
    lines.forEach((t, i) => {
      const p = h('p', '', t);
      p.style.setProperty('--d', `${1400 + i * 900}ms`);
      epi.append(p);
    });
    const credits = h('div', 'end-credits');
    const roll = h('div', 'end-roll');
    const C: [string, string[]][] = [
      ['Robo Arena', ['An original robot-combat game']],
      ['Game Design', ['The Robo Arena Team']],
      ['Robots & Arenas', ['Procedurally modeled in code', 'Three.js renderer']],
      ['Rival Pilots', RIVALS.map((x) => `${x.pilot} — ${x.robotName}`)],
      ['Audio', ['All music & sound effects', 'synthesized at runtime', 'with the Web Audio API']],
      ['Typefaces', ['Russo One · Chakra Petch', 'SIL Open Font License']],
      ['Built With', ['TypeScript · Vite · Three.js']],
      ['Thanks for playing', ['See you in the arena.']],
    ];
    for (const [hd, names] of C) roll.append(h('div', 'cr-block', h('div', 'cr-h', hd), ...names.map((n) => h('div', 'cr-n', n))));
    credits.append(roll);
    el.append(h('div', 'vig vig-full'), rays, crown, word, sub, epi, credits, hints([['confirm', 'Continue']]));
    let phase = 0;
    const toCredits = () => {
      phase = 1;
      el.classList.add('roll');
      roll.addEventListener('animationend', () => { if (phase === 1) finish(); }, { once: true });
    };
    const finish = () => {
      if (phase === 2) return;
      phase = 2;
      this.host.sfx('ui_select');
      this.showMain();
    };
    const auto = setTimeout(() => { if (phase === 0 && this.screen?.el === el) toCredits(); }, 9000);
    this.setScreen(el, {
      any: () => {
        if (phase === 0) { clearTimeout(auto); this.host.sfx('ui_move'); toCredits(); }
        else finish();
      },
    });
    this.lockUntil = performance.now() + 1200;
    this.host.sfx('ui_unlock');
  }

  /* ---------------- free battle */

  private showFree() {
    this.music('menu');
    const s = this.host.save;
    const fb = this.fb;
    const setBd = () => this.backdrop('versus', { loadout: s.loadout, rivalId: fb.rival });
    setBd();
    const el = h('div', 'scr-free');
    const hd = this.header('Exhibition', 'Free Battle', h('div', 'ra-sub', 'Pick a rival, an arena and the clock. Free battle wins don’t unlock parts.'));

    const section = (n: string, label: string, ...kids: Kid[]) => h('div', 'fb-sec', h('div', 'fb-sec-h', h('b', '', n), label), ...kids);

    // opponents
    const tiles = h('div', 'fb-tiles');
    const detail = h('div', 'fb-detail');
    const tileEls: HTMLElement[] = [];
    const showDetail = (r: Rival) => {
      const beaten = s.beaten.includes(r.id);
      detail.replaceChildren(h('b', '', r.robotName), h('span', '', r.title), swatches(r.paint), h('em', beaten ? 'ok' : 'warn', beaten ? 'Beaten' : 'Unbeaten'));
    };
    RIVALS.forEach((r) => {
      const beaten = s.beaten.includes(r.id);
      const t = nav(h('div', `fb-tile ${fb.rival === r.id ? 'sel' : ''}`, emblem(r.paint), h('div', 'fb-tile-n', r.pilot), h('div', 'fb-tile-r', r.robotName), beaten ? null : h('div', 'fb-flag', 'Unbeaten')), {
        focus: () => showDetail(r),
        act: () => {
          this.host.sfx('ui_select');
          fb.rival = r.id;
          tileEls.forEach((x) => x.classList.toggle('sel', x === t));
          setBd();
        },
      });
      t.style.setProperty('--g', hex(r.paint.glow));
      tileEls.push(t);
      tiles.append(t);
    });
    showDetail(rivalById(fb.rival));
    tiles.addEventListener('pointerleave', () => showDetail(rivalById(fb.rival)));

    // arenas
    const arenas = h('div', 'fb-arenas');
    const blurb = h('div', 'fb-blurb');
    const arenaEls: HTMLElement[] = [];
    const showBlurb = (id: ArenaId) => blurb.replaceChildren(h('b', '', ARENA_INFO[id].subtitle), ' — ', ARENA_INFO[id].blurb);
    for (const id of ARENA_IDS) {
      const a = ARENA_INFO[id];
      const c = nav(h('div', `fb-arena ${fb.arena === id ? 'sel' : ''}`, h('div', 'fb-arena-art'), h('div', 'fb-arena-n', a.name), h('div', 'fb-arena-s', a.subtitle)), {
        focus: () => showBlurb(id),
        act: () => {
          this.host.sfx('ui_select');
          fb.arena = id;
          arenaEls.forEach((x) => x.classList.toggle('sel', x === c));
        },
      });
      c.style.setProperty('--a', a.accent);
      arenaEls.push(c);
      arenas.append(c);
    }
    showBlurb((ARENA_IDS as readonly string[]).includes(fb.arena) ? (fb.arena as ArenaId) : 'foundry');

    // time
    const times = h('div', 'fb-times');
    const timeEls: HTMLElement[] = [];
    for (const t of [60, 90, 120]) {
      const c = nav(h('div', `fb-time ${fb.time === t ? 'sel' : ''}`, h('b', '', String(t)), h('span', '', 'sec')), {
        act: () => {
          this.host.sfx('ui_select');
          fb.time = t;
          timeEls.forEach((x) => x.classList.toggle('sel', x === c));
        },
      });
      timeEls.push(c);
      times.append(c);
    }

    const cont = btn('Continue', () => {
      this.host.sfx('ui_select');
      const r = rivalById(fb.rival);
      const a = ARENA_INFO[fb.arena as ArenaId];
      const cfg: MatchConfig = { mode: 'free', playerLoadout: { ...s.loadout }, rivalId: r.id, arenaId: fb.arena, timeLimit: fb.time };
      this.showVersus(r, {
        line: r.taunt,
        kicker: `Free Battle · ${fb.time}s`,
        info: [a?.name ?? fb.arena, a?.subtitle ?? ''],
        onFight: () => this.runMatch(cfg),
        onBack: () => this.showFree(),
        onGarage: () => this.showGarage(() => this.showFree()),
      });
    }, 'primary big');
    const garage = btn('Garage', () => { this.host.sfx('ui_select'); this.showGarage(() => this.showFree()); }, 'big');
    const back = btn('Back', () => { this.host.sfx('ui_back'); this.showMain(); }, 'big');

    const s1 = section('01', 'Opponent', tiles, detail);
    const s2 = section('02', 'Arena', arenas, blurb);
    const s3 = section('03', 'Round Time', times);
    const bar = h('div', 'ra-actions', cont, garage, back);
    const panel = h('div', 'ra-panel fb-panel', s1, s2, s3, bar);
    stagger([s1, s2, s3, bar], 100, 70);
    el.append(h('div', 'vig vig-left'), hd, panel, hints([['move', 'Move'], ['confirm', 'Select'], ['back', 'Back']]));
    this.setScreen(el, { back: () => this.showMain(), initial: tileEls[Math.max(0, RIVALS.findIndex((r) => r.id === fb.rival))] });
  }

  /* ---------------- modes: Rival+, survival, practice, versus, replays */

  private survivalCfg(round: number, startHp: number): MatchConfig {
    // escalating opponents: early rounds draw from the story ladder, later from Rival+
    const pool = round <= 3 ? RIVALS.slice(0, 3) : round <= 6 ? RIVALS : [...RIVALS.slice(2), ...RIVALS_PLUS];
    const r = pool[(round * 7 + Math.floor(Math.random() * pool.length)) % pool.length];
    const arenas = ARENA_IDS as readonly string[];
    return { mode: 'survival', playerLoadout: { ...this.host.save.loadout }, rivalId: r.id, arenaId: arenas[round % arenas.length], timeLimit: 120, survival: { round, startHp } };
  }

  private showPlusIntro(i: number) {
    const r = RIVALS_PLUS[i];
    const a = ARENA_INFO[r.arena as ArenaId];
    const cfg: MatchConfig = { mode: 'rivalplus', playerLoadout: { ...this.host.save.loadout }, rivalId: r.id, arenaId: r.arena, plusIndex: i, timeLimit: 120 };
    this.showVersus(r, {
      line: r.intro,
      kicker: `Rival+ · ${i + 1} / ${RIVALS_PLUS.length}`,
      info: [a?.name ?? r.arena, a?.subtitle ?? ''],
      onFight: () => this.runMatch(cfg),
      onBack: () => this.showModes(),
      onGarage: () => this.showGarage(() => this.showPlusIntro(i)),
    });
  }

  private watchReplay(rp: Replay) {
    this.runMatch({ ...rp.config, mode: 'replay', replay: rp });
  }

  private showModes() {
    this.backdrop('title');
    this.music('menu');
    const s = this.host.save;
    const champ = s.ladder >= RIVALS.length;
    const el = h('div', 'scr-free scr-modes');
    const hd = this.header('Modes', 'More Ways to Fight');
    const card = (title: string, desc: string, tag: string, act: (() => void) | null) => {
      const c = nav(h('div', `ra-tile md-card ${act ? '' : 'locked'}`, h('div', 'md-title', title), h('div', 'md-desc', desc), h('div', 'md-tag', tag)), {
        act: () => {
          if (!act) {
            this.host.sfx('ui_error');
            return;
          }
          this.host.sfx('ui_select');
          act();
        },
      });
      return c;
    };
    const plusNext = Math.min(s.plusLadder, RIVALS_PLUS.length - 1);
    const pads = connectedPads().length;
    const cards = [
      card('Rival+ Ladder', 'Every rival returns with a sharper AI and a 2.0 build. Wins unlock the new parts.', champ ? `${Math.min(s.plusLadder, RIVALS_PLUS.length)} / ${RIVALS_PLUS.length}` : 'Beat the champion to unlock', champ ? () => this.showPlusIntro(plusNext) : null),
      card('Survival', 'Fight until you fall. You heal 25% between rounds, and the opponents get tougher.', `Best: ${s.survivalBest} rounds`, () => this.runMatch(this.survivalCfg(1, 99999))),
      card('Practice Room', 'A training dummy that never breaks. Live damage, combo and DPS readouts.', 'No clock', () => this.showPractice()),
      card('Online', 'Quick match, ranked Elo ladder, or a private room code for a friend.', 'Ranked · Rooms', () => this.showOnline()),
      card('Local Versus', 'Two players on one screen. Player 2 needs a gamepad.', pads ? `${pads} pad${pads > 1 ? 's' : ''} connected` : 'Connect a gamepad', () => this.showLocalVersus()),
      card('Replays', 'Rewatch your last fights, or download and import replay files.', `${loadReplays().length} saved`, () => this.showReplays()),
    ];
    const grid = h('div', 'md-grid', ...cards);
    const back = btn('Back', () => { this.host.sfx('ui_back'); this.showMain(); }, 'big');
    const panel = h('div', 'ra-panel fb-panel', grid, h('div', 'ra-actions', back));
    stagger(cards, 100, 60);
    el.append(h('div', 'vig vig-left'), hd, panel, hints([['move', 'Move'], ['confirm', 'Select'], ['back', 'Back']]));
    this.setScreen(el, { back: () => this.showMain(), initial: cards[0] });
  }

  private showPractice() {
    this.backdrop('garage', { loadout: this.host.save.loadout });
    const el = h('div', 'scr-free scr-modes');
    const hd = this.header('Practice Room', 'Training Dummy');
    let arena: string = ARENA_IDS[0];
    const arenaBtn = btn(`Arena: ${ARENA_INFO[arena as ArenaId].name}`, () => {
      const ids = ARENA_IDS as readonly string[];
      arena = ids[(ids.indexOf(arena) + 1) % ids.length];
      arenaBtn.querySelector('span')!.textContent = `Arena: ${ARENA_INFO[arena as ArenaId].name}`;
      this.host.sfx('ui_move');
    }, 'big');
    const go = (dummy: 'idle' | 'move' | 'shoot' | 'full') => () => {
      this.host.sfx('ui_select');
      this.runMatch({ mode: 'practice', playerLoadout: { ...this.host.save.loadout }, rivalId: 'dex', arenaId: arena, practice: { dummy } });
    };
    const opts = [
      btn('Dummy: Stand Still', go('idle'), 'primary big'),
      btn('Dummy: Move Only', go('move'), 'big'),
      btn('Dummy: Shoot Only', go('shoot'), 'big'),
      btn('Dummy: Full AI', go('full'), 'big'),
    ];
    const note = h('div', 'md-desc', 'Hold the bomb mouse button, move the landing marker, then release to throw. Clean bomb/pod blasts prime a target for 2 seconds; follow with rail or a charged beam after the marker closes. A perfect dodge, parry or frontal block clears the primer. Both robots refill automatically. Esc → Quit leaves practice.');
    const panel = h('div', 'ra-panel fb-panel', h('div', 'md-col', ...opts, arenaBtn, note), h('div', 'ra-actions', btn('Back', () => { this.host.sfx('ui_back'); this.showModes(); }, 'big')));
    el.append(h('div', 'vig vig-left'), hd, panel, hints([['move', 'Move'], ['confirm', 'Select'], ['back', 'Back']]));
    this.setScreen(el, { back: () => this.showModes(), initial: opts[0] });
  }

  private showLocalVersus() {
    const s = this.host.save;
    const champ = s.ladder >= RIVALS.length;
    const pool = [...RIVALS, ...(champ ? RIVALS_PLUS : [])];
    let pick = 0;
    let arena: string = ARENA_IDS[0];
    const el = h('div', 'scr-free scr-modes');
    const hd = this.header('Local Versus', 'Player 1 vs Player 2');
    const label = h('div', 'md-title', '');
    const sub = h('div', 'md-desc', '');
    const refresh = () => {
      const r = pool[pick];
      label.textContent = `P2: ${r.robotName}`;
      const L = resolveLoadout(r.loadout);
      sub.textContent = `${L.body.name} · ${L.legs.name} · ${L.gun.name} / ${L.bomb.name} / ${L.pod.name}`;
      this.backdrop('versus', { loadout: s.loadout, rivalId: r.id });
    };
    const prev = btn('◀ Robot', () => { pick = (pick + pool.length - 1) % pool.length; this.host.sfx('ui_move'); refresh(); }, 'big');
    const next = btn('Robot ▶', () => { pick = (pick + 1) % pool.length; this.host.sfx('ui_move'); refresh(); }, 'big');
    const arenaBtn = btn(`Arena: ${ARENA_INFO[arena as ArenaId].name}`, () => {
      const ids = ARENA_IDS as readonly string[];
      arena = ids[(ids.indexOf(arena) + 1) % ids.length];
      arenaBtn.querySelector('span')!.textContent = `Arena: ${ARENA_INFO[arena as ArenaId].name}`;
      this.host.sfx('ui_move');
    }, 'big');
    const pads = connectedPads().length;
    const start = btn('Fight!', () => {
      if (connectedPads().length === 0) {
        this.host.sfx('ui_error');
        this.toast('Connect a gamepad for Player 2 (press any button on it)');
        return;
      }
      this.host.sfx('ui_select');
      const r = pool[pick];
      this.runMatch({ mode: 'versus', playerLoadout: { ...s.loadout }, rivalId: r.id, arenaId: arena, timeLimit: 120, versus: { p2Loadout: { ...r.loadout }, p2Paint: r.paint, p2Name: r.robotName } });
    }, 'primary big');
    const info = h('div', 'md-desc', pads >= 2 ? 'Two pads: Player 1 uses pad 1, Player 2 uses pad 2.' : 'Player 1: keyboard and mouse. Player 2: gamepad. Shared camera.');
    const panel = h('div', 'ra-panel fb-panel', h('div', 'md-col', label, sub, h('div', 'ra-actions', prev, next), arenaBtn, info), h('div', 'ra-actions', start, btn('Back', () => { this.host.sfx('ui_back'); this.showModes(); }, 'big')));
    el.append(h('div', 'vig vig-left'), hd, panel, hints([['move', 'Move'], ['confirm', 'Select'], ['back', 'Back']]));
    this.setScreen(el, { back: () => this.showModes(), initial: start });
    refresh();
  }

  /* ---------------- online: quick match, ranked, private rooms */

  private onlineHello(ranked = false): PlayerHello {
    const ids = ARENA_IDS as readonly string[];
    return {
      name: netName(), loadout: { ...this.host.save.loadout }, paint: this.host.save.paint,
      arena: ids[Math.floor(Math.random() * ids.length)], ranked,
    };
  }

  private showOnline(status = '') {
    const s = this.host.save;
    this.backdrop('garage', { loadout: s.loadout });
    this.music('menu');
    const el = h('div', 'scr-free scr-modes');
    const hd = this.header('Online', 'Fight Real Pilots');
    const name = h('input', 'net-input') as HTMLInputElement;
    name.value = netName();
    name.maxLength = 16;
    name.setAttribute('aria-label', 'Pilot name');
    name.addEventListener('change', () => { name.value = netName(name.value); });
    const rating = h('div', 'md-desc', 'Ranked rating: …');
    fetchMyRating().then((r) => {
      rating.textContent = r ? `Ranked: ${r.rating} · ${tierOf(r.rating)} · ${r.games} games, ${r.wins} wins` : 'Ranked: offline';
    });
    const stat = h('div', 'md-desc net-status', status);
    let cancel: AbortController | null = null;
    const searching = (label: string, ranked: boolean) => () => {
      if (cancel) { cancel.abort(); cancel = null; stat.textContent = 'Search cancelled.'; return; }
      this.host.sfx('ui_select');
      cancel = new AbortController();
      stat.textContent = `${label}: searching… (press again to cancel)`;
      NetSession.quick(this.onlineHello(ranked), cancel.signal, ranked)
        .then((ses) => { cancel = null; this.showOnlineLobby(ses, { ranked, auto: true }); })
        .catch((e: Error) => { cancel = null; if (e.message !== 'cancelled') stat.textContent = 'Could not reach the online server. Try again in a moment.'; });
    };
    const code = h('input', 'net-input net-code') as HTMLInputElement;
    code.placeholder = 'CODE';
    code.maxLength = 5;
    code.setAttribute('aria-label', 'Room code');
    code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    const join = () => {
      if (code.value.length !== 5) { this.host.sfx('ui_error'); stat.textContent = 'Room codes are 5 letters.'; return; }
      this.host.sfx('ui_select');
      stat.textContent = 'Joining…';
      NetSession.join(code.value, this.onlineHello())
        .then((ses) => this.showOnlineLobby(ses, {}))
        .catch((e: Error) => { stat.textContent = e.message === 'full' ? 'That room is full.' : 'Could not join that room.'; });
    };
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    const quick = btn('Quick Match', searching('Quick match', false), 'primary big');
    const opts = [
      quick,
      btn('Ranked Match', searching('Ranked', true), 'big'),
      btn('Create Private Room', () => {
        this.host.sfx('ui_select');
        stat.textContent = 'Creating room…';
        NetSession.create(this.onlineHello()).then((ses) => this.showOnlineLobby(ses, {})).catch(() => { stat.textContent = 'Could not reach the online server.'; });
      }, 'big'),
      h('div', 'net-row', code, btn('Join Room', join, 'big')),
      btn('Leaderboard', () => { this.host.sfx('ui_select'); this.showLeaderboard(); }, 'big'),
      btn('Garage', () => { this.host.sfx('ui_select'); this.showGarage(() => this.showOnline()); }, 'big', SLOT_ICON.body),
    ];
    const note = h('div', 'md-desc', 'Both players run the same deterministic simulation; only button presses travel over the network. Lower ping = less input delay. Ranked uses Elo: Bronze, Silver, Gold, Platinum, Diamond.');
    const panel = h('div', 'ra-panel fb-panel', h('div', 'md-col', h('label', 'net-row', h('span', 'md-desc', 'Pilot name'), name), rating, ...opts, stat, note),
      h('div', 'ra-actions', btn('Back', () => { cancel?.abort(); this.host.sfx('ui_back'); this.showModes(); }, 'big')));
    el.append(h('div', 'vig vig-left'), hd, panel, hints([['move', 'Move'], ['confirm', 'Select'], ['back', 'Back']]));
    this.setScreen(el, { back: () => { cancel?.abort(); this.showModes(); }, initial: quick });
  }

  private async showLeaderboard() {
    this.backdrop('title');
    const el = h('div', 'scr-free scr-modes');
    const hd = this.header('Leaderboard', 'Top Ranked Pilots');
    const list = h('div', 'md-col net-board', h('div', 'md-desc', 'Loading…'));
    const back = btn('Back', () => { this.host.sfx('ui_back'); this.showOnline(); }, 'big');
    el.append(h('div', 'vig vig-left'), hd, h('div', 'ra-panel fb-panel', list, h('div', 'ra-actions', back)), hints([['back', 'Back']]));
    this.setScreen(el, { back: () => this.showOnline(), initial: back });
    const top = await fetchLeaderboard();
    list.replaceChildren(...(top.length ? top.map((p, i) => h('div', 'net-board-row',
      h('span', 'nb-rank', `#${i + 1}`), h('span', 'nb-name', p.name), h('span', 'nb-tier', tierOf(p.rating)),
      h('span', 'nb-rating', String(p.rating)), h('span', 'nb-rec', `${p.wins}-${p.games - p.wins}`))) : [h('div', 'md-desc', 'No ranked matches yet. Be the first.')]));
  }

  /**
   * A room with an opponent. Casual rooms are a running set (first to 2), with build changes
   * allowed between rounds for counter-picks. Ranked queues play one rated round.
   */
  private showOnlineLobby(ses: NetSession, o: { ranked?: boolean; auto?: boolean; score?: [number, number]; last?: string }) {
    const s = this.host.save;
    const score = o.score ?? [0, 0];
    this.backdrop('versus', { loadout: s.loadout, rivalId: RIVALS[0].id });
    const el = h('div', 'scr-free scr-modes');
    const hd = this.header(o.ranked ? 'Ranked' : ses.code ? `Room ${ses.code}` : 'Online', ses.peer ? `vs ${ses.peer.name}` : 'Waiting for an opponent');
    const peer = h('div', 'md-title', ses.peer ? this.peerLine(ses.peer) : 'Waiting for an opponent…');
    const sub = h('div', 'md-desc', ses.code && !o.auto ? `Share this room code: ${ses.code}` : '');
    const set = h('div', 'md-desc net-set', o.ranked ? '' : `Set (first to 2): You ${score[0]} – ${score[1]} Them`);
    const last = h('div', 'md-desc', o.last ?? '');
    const stat = h('div', 'md-desc net-status', '');
    let left = false;
    const leave = () => { ses.onStart = ses.onPeer = ses.onLeft = undefined; ses.close(); this.showOnline(left ? 'Opponent left the room.' : ''); };
    const ready = btn(o.ranked ? 'Fight!' : score[0] || score[1] ? 'Next Round' : 'Ready', () => {
      if (!ses.peer || left) { this.host.sfx('ui_error'); return; }
      this.host.sfx('ui_select');
      ses.ready();
      stat.textContent = 'Ready. Waiting for the opponent…';
    }, 'primary big');
    const build = btn('Change Build', () => {
      this.host.sfx('ui_select');
      this.showGarage(() => { ses.hello({ ...this.onlineHello(o.ranked), arena: ses.last?.arena }); this.showOnlineLobby(ses, o); });
    }, 'big', SLOT_ICON.body);
    ses.onPeer = (p) => { peer.textContent = this.peerLine(p); hd.querySelector('.ra-title')?.replaceChildren(`vs ${p.name}`); if (o.auto) { ses.ready(); stat.textContent = 'Opponent found. Starting…'; } };
    ses.onLeft = () => { left = true; stat.textContent = 'Opponent left the room.'; };
    ses.onError = (r) => { stat.textContent = r === 'version' ? 'Your opponent is on a different game version. Refresh the page.' : `Error: ${r}`; };
    ses.onStart = (st) => this.playOnline(ses, st, o.ranked ?? false, score);
    if (o.auto && ses.peer) { ses.ready(); stat.textContent = 'Starting…'; }
    const panel = h('div', 'ra-panel fb-panel', h('div', 'md-col', peer, sub, set, last, ready, ...(o.ranked ? [] : [build]), stat),
      h('div', 'ra-actions', btn('Leave', () => { this.host.sfx('ui_back'); leave(); }, 'big')));
    el.append(h('div', 'vig vig-left'), hd, panel, hints([['confirm', 'Select'], ['back', 'Leave']]));
    this.setScreen(el, { back: leave, initial: ready });
  }

  private peerLine(p: PlayerHello) {
    const L = resolveLoadout(p.loadout);
    const r = p.rating ? ` · ${p.rating} ${tierOf(p.rating)}` : '';
    return `${p.name}${r} — ${L.body.name}, ${L.gun.name}, ${L.skill.name}`;
  }

  private async playOnline(ses: NetSession, st: StartMsg, ranked: boolean, score: [number, number]) {
    ses.onStart = ses.onPeer = undefined;
    const me = ses.slot;
    const arena = (ARENA_IDS as readonly string[]).includes(st.arena) ? st.arena : ARENA_IDS[0];
    let rated: RatedMsg | null = null;
    ses.onRated = (r) => { rated = r; };
    this.hideAll();
    this.musicNow = null;
    const res = await this.host.startMatch({
      mode: 'online', playerLoadout: st.players[me].loadout, rivalId: RIVALS[0].id, arenaId: arena, timeLimit: 120,
      online: { session: ses, me, seed: st.seed, players: st.players, ranked },
    });
    this.musicNow = null;
    if (res.outcome === 'win') this.host.save.totals.wins++;
    else if (res.outcome === 'lose') this.host.save.totals.losses++;
    const worldWinner = res.outcome === 'draw' ? -1 : res.outcome === 'win' ? me : 1 - me;
    if (ranked && !res.quit) ses.report(res.netClean ? worldWinner : -2);
    const next: [number, number] = [score[0] + (res.outcome === 'win' ? 1 : 0), score[1] + (res.outcome === 'lose' ? 1 : 0)];
    const setDone = !ranked && (next[0] >= 2 || next[1] >= 2);
    let line = res.quit ? 'You forfeited.' : res.outcome === 'win' ? 'You won the round!' : res.outcome === 'lose' ? 'You lost the round.' : 'Draw.';
    if (setDone) line = next[0] >= 2 ? `You win the set ${next[0]}–${next[1]}!` : `They win the set ${next[1]}–${next[0]}.`;
    if (res.quit || ses.closed) {
      ses.close();
      this.showOnline(res.quit ? 'You left the match.' : 'Opponent left the match.');
      return;
    }
    const lobby = { ranked, score: setDone ? [0, 0] as [number, number] : next, last: line };
    this.showOnlineLobby(ses, lobby);
    if (ranked) {
      // the server settles once both reports land
      const t0 = performance.now();
      while (!rated && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 100));
      const r = rated as RatedMsg | null;
      const d = r?.counted && r.deltas ? r.deltas[me] : null;
      this.showOnlineLobby(ses, { ...lobby, last: `${line} ${d === null ? '(not rated)' : `Rating ${r!.ratings![me]} (${d >= 0 ? '+' : ''}${d}) · ${tierOf(r!.ratings![me])}`}` });
    }
  }

  private showReplays() {
    this.backdrop('title');
    const el = h('div', 'scr-free scr-modes');
    const hd = this.header('Replays', 'Your Recent Fights');
    const list = loadReplays();
    const rows = list.map((rp) => {
      const r = rivalById(rp.config.rivalId);
      const sm = rp.summary;
      const when = new Date(rp.date).toLocaleString();
      const title = `${(sm?.outcome ?? '').toUpperCase()} vs ${r.robotName}`;
      const row = h('div', 'md-row',
        h('div', '', h('div', 'md-title', title), h('div', 'md-desc', `${ARENA_INFO[rp.config.arenaId as ArenaId]?.name ?? rp.config.arenaId} · ${sm ? fmtTime(sm.time) : ''} · ${when}`)),
        h('div', 'ra-actions', btn('Watch', () => { this.host.sfx('ui_select'); this.watchReplay(rp); }, 'primary'), btn('Download', () => { this.host.sfx('ui_select'); downloadReplay(rp); }, '')));
      return row;
    });
    const file = h('input') as HTMLInputElement;
    file.type = 'file';
    file.accept = '.json,application/json';
    file.style.display = 'none';
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const rp = parseReplay(await f.text());
      if (!rp) {
        this.host.sfx('ui_error');
        this.toast('That file is not a Robo Arena replay');
        return;
      }
      saveReplay(rp);
      this.showReplays();
    });
    const importBtn = btn('Import Replay File', () => { this.host.sfx('ui_select'); file.click(); }, 'big');
    const back = btn('Back', () => { this.host.sfx('ui_back'); this.showModes(); }, 'big');
    const panel = h('div', 'ra-panel fb-panel', h('div', 'md-col ra-scroll', ...(rows.length ? rows : [h('div', 'md-desc', 'No compatible replays yet. Playtest 2 recordings use older combat rules and cannot be played here. New finished fights are saved automatically.')])), h('div', 'ra-actions', importBtn, back), file);
    el.append(h('div', 'vig vig-left'), hd, panel, hints([['move', 'Move'], ['confirm', 'Select'], ['back', 'Back']]));
    this.setScreen(el, { back: () => this.showModes(), initial: rows[0]?.querySelector<HTMLElement>('.ra-btn') ?? importBtn });
  }

  private openPhoto() {
    if (this.keyCapture) return;
    this.keyCapture = true;
    this.host.suspendBackdrop?.(true);
    const previousFocus = document.activeElement as HTMLElement | null;
    try {
      new PhotoStudio(this.host.save.loadout, this.host.save.paint, () => {
        this.keyCapture = false; this.host.suspendBackdrop?.(false); previousFocus?.focus();
      });
    } catch (error) {
      this.keyCapture = false; this.host.suspendBackdrop?.(false);
      this.toast('Photo mode could not start. Please try again.');
      throw error;
    }
  }

  /* ---------------- garage */

  private showGarage(onBack: () => void) {
    this.music('garage');
    const s = this.host.save;
    const el = h('div', 'scr-garage');
    const hd = this.header('Assembly bay / 03', 'Garage');
    const thumbnails = new PartThumbnails();

    const preview = h('div', 'gar-preview', h('div', 'gar-ring'), h('div', 'gar-drag', svg('<svg viewBox="0 0 24 24"><path d="M12 5c-4 0-7.5 1.6-9 4l-2-1v5h5L4 11.5C5.2 9.5 8.3 8 12 8s6.8 1.5 8 3.5L18 13h5V8l-2 1c-1.5-2.4-5-4-9-4z"/></svg>'), h('span', 'k-kb', 'Drag to rotate'), h('span', 'k-pad', 'R-Stick to rotate')));
    const sendBackdrop = () => {
      const r = preview.getBoundingClientRect();
      this.backdrop('garage', { loadout: { ...s.loadout }, paint: { ...s.paint }, previewRect: { x: r.left, y: r.top, w: r.width, h: r.height } });
    };
    // drag-rotate
    let dragging = false, lx = 0;
    preview.addEventListener('pointerdown', (e) => {
      dragging = true;
      lx = e.clientX;
      preview.setPointerCapture(e.pointerId);
      preview.classList.add('dragging');
    });
    preview.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx;
      lx = e.clientX;
      this.host.rotatePreview(dx * 0.01);
    });
    const endDrag = () => { dragging = false; preview.classList.remove('dragging'); };
    preview.addEventListener('pointerup', endDrag);
    preview.addEventListener('pointercancel', endDrag);

    // tabs
    const tabs = h('div', 'gar-tabs');
    const tabEls = new Map<Slot, HTMLElement>();
    const list = h('div', 'gar-list ra-scroll');
    const detail = h('div', 'ra-panel gar-detail');
    const summary = h('div', 'ra-panel gar-summary');

    const renderSummary = () => {
      const R = resolveLoadout(s.loadout);
      const body = R.body;
      const D = deriveStats(R);
      const stat = (k: string, v: string) => h('div', 'gs-stat', h('span', '', k), h('b', '', v));
      summary.replaceChildren(
        h('div', 'gs-h', 'Loadout', h('span', '', PLAYER_ROBOT_NAME)),
        h('div', 'gs-parts', ...SLOTS.map((sl) => h('div', `gs-part ${sl === this.gSlot ? 'cur' : ''}`, svg(SLOT_ICON[sl]), h('span', 'gs-slot', SLOT_LABEL[sl]), h('b', '', R[sl].name)))),
        h('div', 'gs-stats',
          stat('Armor', `${D.hp} HP`),
          stat('Endurance', `${D.endurance}`),
          stat('Mass', `${D.mass}`),
          stat('Run', `${(D.runSpeed * 0.88).toFixed(1)} m/s`),
          stat('Dash', `${D.dashStyle} ×${D.dashCharges}`),
          stat('Air', `${D.airJumps} jump · ${D.airDashes} dash`),
          stat('Hover', `${D.hoverTime.toFixed(1)} s`),
          stat('Knockback', `${Math.round(D.knockMul * 100)}%`),
          stat('Charge', body.chargeName),
          stat('Set bonus', D.set ? `${SET_BONUS[D.set].name}: ${SET_BONUS[D.set].desc}` : '—')),
      );
    };

    const renderDetail = (p: AnyPart) => {
      const owned = isUnlocked(s, p.slot, p.id);
      const equipped = s.loadout[p.slot] === p.id;
      const eq = ALL_PARTS[p.slot][s.loadout[p.slot]];
      const src = unlockSource(p.slot, p.id);
      const extra: HTMLElement[] = [];
      if (p.slot === 'body') {
        const b = BODIES[p.id];
        extra.push(h('div', 'gd-extra', h('span', '', 'Armor'), h('b', '', `${b.hp} HP`), h('span', '', 'Charge'), h('b', '', b.chargeName)));
      } else if (p.slot === 'legs') {
        const l = LEGS[p.id];
        extra.push(h('div', 'gd-extra', h('span', '', 'Air jumps'), h('b', '', String(l.airJumps)), h('span', '', 'Air dashes'), h('b', '', String(l.airDashes))));
      }
      detail.replaceChildren(
        h('div', 'gd-top', h('div', 'gd-ico', svg(SLOT_ICON[p.slot])), h('div', '', h('div', 'gd-slot', `${SLOT_LABEL[p.slot]} Part`), h('div', 'gd-name', owned ? p.name : p.name))),
        equipped ? h('div', 'gd-tag eq', svg(CHECK_ICON), 'Equipped') : owned ? h('div', 'gd-tag', 'Owned · press to equip') : h('div', 'gd-tag lk', svg(LOCK_ICON), src ? `Beat ${src.pilot} to unlock` : 'Locked'),
        h('div', 'gd-desc', p.desc),
        ...(p.slot === 'gun' && ['rail', 'beam'].includes(p.id) ? [h('div', 'gd-desc', p.id === 'rail' ? 'COMBO FINISHER · Hit an armed primer to detonate it.' : 'COMBO FINISHER · Charge to at least 75% and hit an armed primer.')] : p.slot === 'bomb' ? [h('div', 'gd-desc', 'SETUP · Hold the bomb mouse button to aim, release to throw. Clean blast hits prime a precision follow-up.')] : []),
        h('div', 'gd-ratings', ...Object.entries(p.ratings).map(([k, v]) => ratingBar(k, v, equipped ? undefined : eq?.ratings[k]))),
        ...extra,
      );
      detail.classList.toggle('locked', !owned);
      detail.classList.remove('pop');
      void detail.offsetWidth;
      detail.classList.add('pop');
    };

    let partEls: HTMLElement[] = [];
    const count = h('span', 'gar-count');
    const renderList = (slot: Slot) => {
      const parts = Object.values(ALL_PARTS[slot]);
      partEls = parts.map((p, i) => {
        const owned = isUnlocked(s, slot, p.id);
        const equipped = s.loadout[slot] === p.id;
        const src = unlockSource(slot, p.id);
        const pips = h('div', 'gp-pips', ...Object.entries(p.ratings).map(([k, v]) => h('span', '', k.slice(0, 3), h('b', '', '■'.repeat(v)))));
        const el = nav(h('div', `gar-part ${owned ? '' : 'locked'} ${equipped ? 'equipped' : ''}`,
          h('div', 'gp-visual', thumbnails.image(slot, p.id)),
          h('div', 'gp-body', h('div', 'gp-name', owned ? p.name : p.name), owned ? pips : h('div', 'gp-lock', src ? `Beat ${src.pilot} to unlock` : 'Locked')),
          equipped ? h('div', 'gp-eq', svg(CHECK_ICON), 'E') : null), {
          locked: !owned,
          focus: () => { renderDetail(p); this.host.focusPreview(slot); },
          act: () => {
            if (s.loadout[slot] === p.id) { this.host.sfx('ui_move'); return; }
            s.loadout[slot] = p.id;
            this.host.persist();
            this.host.sfx('ui_select');
            sendBackdrop();
            const keep = i;
            renderList(slot);
            renderSummary();
            this.setFocusKeep(partEls[keep]);
          },
        });
        el.style.setProperty('--d', `${i * 40}ms`);
        return el;
      });
      list.replaceChildren(...partEls);
      count.textContent = `${parts.filter((p) => isUnlocked(s, slot, p.id)).length} / ${parts.length} owned`;
    };

    const selectSlot = (slot: Slot, sound: boolean) => {
      if (this.gSlot === slot && list.childElementCount) return;
      this.gSlot = slot;
      tabEls.forEach((t, k) => t.classList.toggle('sel', k === slot));
      renderList(slot);
      renderSummary();
      const eqEl = partEls.find((e) => e.classList.contains('equipped'));
      const p = ALL_PARTS[slot][s.loadout[slot]];
      if (p) renderDetail(p);
      this.host.focusPreview(slot);
      list.classList.remove('swap');
      void list.offsetWidth;
      list.classList.add('swap');
      if (sound) this.host.sfx('ui_move');
      void eqEl;
    };

    for (const slot of SLOTS) {
      const t = nav(h('div', 'gar-tab', svg(SLOT_ICON[slot]), h('span', '', SLOT_LABEL[slot])), {
        focus: () => selectSlot(slot, false),
        act: () => {
          const eqEl = partEls.find((e) => e.classList.contains('equipped')) ?? partEls[0];
          if (eqEl) this.setFocus(eqEl, true);
        },
      });
      t.addEventListener('pointerenter', () => this.host.focusPreview(slot));
      tabEls.set(slot, t);
      tabs.append(t);
    }

    const backBtn = btn('Back', () => { this.host.sfx('ui_back'); leave(); }, 'big');
    const shareBtn = btn('Build Code', () => { this.host.sfx('ui_select'); this.meta.openShareCode(() => { sendBackdrop(); renderList(this.gSlot); renderSummary(); redrawPaint(); wear.value = String(Math.round((s.paint.wear ?? 0) * 100)); wearLabel.textContent = `Wear ${wear.value}%`; }); }, 'big');
    const presetSelect = h('select', 'gar-preset-select'); presetSelect.setAttribute('aria-label', 'Saved build slot');
    const renderPresets = () => {
      const selected = presetSelect.value || '0';
      presetSelect.replaceChildren(...s.presets.map((preset, i) => { const option = h('option', '', `${i + 1} · ${preset?.name ?? 'Empty slot'}`); option.value = String(i); return option; }));
      presetSelect.value = selected;
    };
    const savePreset = btn('Save', () => {
      const i = Number(presetSelect.value), parts = resolveLoadout(s.loadout);
      s.presets[i] = { name: `${parts.body.name} / ${parts.gun.name}`, loadout: { ...s.loadout }, paint: { ...s.paint } };
      this.host.persist(); renderPresets(); this.toast(`Build ${i + 1} saved`);
    }, 'gar-preset-action');
    const loadPreset = btn('Load', () => {
      const preset = s.presets[Number(presetSelect.value)]; if (!preset) { this.toast('This build slot is empty'); return; }
      s.loadout = { ...preset.loadout }; s.paint = { ...preset.paint }; this.host.persist();
      renderList(this.gSlot); renderSummary(); renderDetail(ALL_PARTS[this.gSlot][s.loadout[this.gSlot]]); redrawPaint();
      wear.value = String(Math.round((s.paint.wear ?? 0) * 100)); wearLabel.textContent = `Wear ${wear.value}%`; sendBackdrop(); this.toast('Build loaded');
    }, 'gar-preset-action');
    renderPresets();
    const presetRow = h('div', 'gar-presets', presetSelect, savePreset, loadPreset);
    const left = h('div', 'ra-panel gar-left', tabs, presetRow, h('div', 'gar-list-h', h('span', '', `Parts`), count), list, h('div', 'gar-left-foot', backBtn, shareBtn));
    const paintShop = h('section', 'ra-panel paint-shop');
    const studioTitle = h('div', 'paint-title', 'Finish studio');
    let zone: 'primary' | 'secondary' | 'trim' | 'dark' | 'glow' | 'flame' | 'trail' = 'primary';
    const zones = ['primary', 'secondary', 'trim', 'dark', 'glow', 'flame', 'trail'] as const;
    const colors = [0xf4f1ea, 0x232a34, 0x4e6172, 0xb53836, 0xff6a1f, 0xc7a452, 0x4c6953, 0x345c95, 0x795b9d, 0x37e8ff, 0x99efc4, 0xf17dc1];
    const zoneRow = h('div', 'paint-zones');
    const palette = h('div', 'paint-palette');
    const finishRow = h('div', 'paint-finishes');
    const decalRow = h('div', 'paint-decals');
    const applyPaint = () => { this.host.persist(); sendBackdrop(); };
    const redrawPaint = () => {
      zoneRow.replaceChildren(...zones.map(k => btn(k, () => { zone = k; redrawPaint(); }, `paint-zone ${zone === k ? 'selected' : ''}`)));
      palette.replaceChildren(...colors.map(color => {
        const b = btn('', () => { s.paint[zone] = color; applyPaint(); redrawPaint(); }, `paint-swatch ${(s.paint[zone] ?? s.paint.glow) === color ? 'selected' : ''}`);
        b.style.setProperty('--swatch', hex(color)); b.setAttribute('aria-label', `${zone} ${hex(color)}`); b.title = `${zone} ${hex(color)}`; return b;
      }));
      finishRow.replaceChildren(...(['gloss', 'matte', 'metal', 'chrome', 'carbon'] as const).map(finish => btn(finish, () => { s.paint.finish = finish; applyPaint(); redrawPaint(); }, `paint-finish ${s.paint.finish === finish ? 'selected' : ''}`)));
      decalRow.replaceChildren(...(['unit', 'chevron', 'cross', 'none'] as const).map(decal => btn(decal, () => { s.paint.decal = decal; applyPaint(); redrawPaint(); }, `paint-finish ${(s.paint.decal ?? 'unit') === decal ? 'selected' : ''}`)));
    };
    const wearLabel = h('span', '', `Wear ${Math.round((s.paint.wear ?? 0) * 100)}%`);
    const wear = h('input', 'paint-wear'); wear.type = 'range'; wear.min = '0'; wear.max = '100'; wear.value = String((s.paint.wear ?? 0) * 100); wear.setAttribute('aria-label', 'Armor wear');
    let wearTimer = 0;
    wear.oninput = () => {
      s.paint.wear = Number(wear.value) / 100; wearLabel.textContent = `Wear ${wear.value}%`;
      clearTimeout(wearTimer); wearTimer = window.setTimeout(applyPaint, 100);
    };
    wear.onchange = () => { clearTimeout(wearTimer); applyPaint(); };
    wear.addEventListener('keydown', e => e.stopPropagation());
    redrawPaint();
    paintShop.append(studioTitle, zoneRow, palette, finishRow, h('label', 'paint-wear-row', wearLabel, wear), decalRow);
    paintShop.hidden = true;
    const specsTab = btn('Specifications', () => { detail.hidden = false; summary.hidden = false; paintShop.hidden = true; specsTab.classList.add('selected'); paintTab.classList.remove('selected'); }, 'selected');
    const paintTab = btn('Paint Studio', () => { detail.hidden = true; summary.hidden = true; paintShop.hidden = false; specsTab.classList.remove('selected'); paintTab.classList.add('selected'); }, '');
    const rightTabs = h('div', 'gar-right-tabs', specsTab, paintTab);
    const right = h('div', 'gar-right', rightTabs, detail, summary, paintShop);
    const photo = btn('Photo Mode', () => this.openPhoto(), 'big', SLOT_ICON.body);
    photo.classList.add('gar-photo'); preview.append(photo);
    photo.addEventListener('pointerdown', e => e.stopPropagation());
    stagger([left], 80);
    stagger([right], 200);
    el.append(h('div', 'vig vig-left'), h('div', 'vig vig-right'), hd, preview, left, right, hints([['move', 'Move'], ['tabs', 'Slot'], ['confirm', 'Equip'], ['drag', 'Rotate'], ['back', 'Back']]));

    const leave = () => {
      clearTimeout(wearTimer); this.host.persist(); thumbnails.dispose();
      this.host.focusPreview(null);
      onBack();
    };
    const cycle = (d: number) => {
      const i = (SLOTS.indexOf(this.gSlot) + d + SLOTS.length) % SLOTS.length;
      const t = tabEls.get(SLOTS[i])!;
      selectSlot(SLOTS[i], true);
      // keep focus in the list if it was there
      const L = this.top;
      if (L?.focus && L.focus.classList.contains('gar-part')) {
        const eqEl = partEls.find((e) => e.classList.contains('equipped')) ?? partEls[0];
        this.setFocusKeep(eqEl);
      } else this.setFocusKeep(t);
    };

    const slot0 = this.gSlot;
    this.gSlot = '' as Slot;
    // build list before focusing
    this.setScreen(el, {
      back: () => leave(),
      key: (k) => {
        if (k === 'prev') { cycle(-1); return true; }
        if (k === 'next') { cycle(1); return true; }
        return false;
      },
      rotate: true,
      initial: tabEls.get(slot0),
    });
    if (!list.childElementCount) selectSlot(slot0, false);
    // initial focus on the equipped part of the slot
    const eqEl = partEls.find((e) => e.classList.contains('equipped'));
    if (eqEl) this.setFocusKeep(eqEl);
    requestAnimationFrame(() => sendBackdrop());
    this.resizeFn = () => sendBackdrop();
  }

  /** Move focus without sound (and without re-triggering when unchanged). */
  private setFocusKeep(el: HTMLElement | undefined) {
    if (!el) return;
    const L = this.top;
    if (L && L.focus && !L.el.contains(L.focus)) L.focus = null;
    this.setFocus(el, false);
  }

  /* ---------------- settings */

  private settingsPanel(inPause: boolean, onBack: () => void): HTMLElement {
    const s = this.host.save;
    const st = s.settings;
    const apply = () => {
      this.host.applySettings(st);
      this.host.persist();
    };
    const rowsEl = h('div', 'set-rows');

    const slider = (label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const fill = h('i');
      const knob = h('b');
      const val = h('span', 'set-val');
      const track = h('div', 'set-track', fill, knob);
      const paint = () => {
        const k = (get() - min) / (max - min);
        fill.style.transform = `scaleX(${k})`;
        knob.style.left = `${k * 100}%`;
        val.textContent = fmt(get());
      };
      const setV = (v: number, sound = true) => {
        const nv = clamp(Math.round(v / step) * step, min, max);
        if (Math.abs(nv - get()) < 1e-6) return;
        set(+nv.toFixed(3));
        paint();
        apply();
        if (sound) this.host.sfx('ui_move');
      };
      const row = nav(h('div', 'set-row', h('span', 'set-l', label), h('div', 'set-ctl', h('span', 'set-arrow', '◀'), track, h('span', 'set-arrow', '▶'), val)), {
        adjust: (d) => setV(get() + d * step),
      });
      let drag = false;
      const fromX = (x: number, sound: boolean) => {
        const r = track.getBoundingClientRect();
        setV(min + clamp((x - r.left) / r.width, 0, 1) * (max - min), sound);
      };
      track.addEventListener('pointerdown', (e) => { drag = true; track.setPointerCapture(e.pointerId); fromX(e.clientX, true); });
      track.addEventListener('pointermove', (e) => { if (drag) fromX(e.clientX, false); });
      track.addEventListener('pointerup', () => { drag = false; });
      paint();
      rowsEl.append(row);
      return row;
    };
    const choice = <T>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
      const seg = h('div', 'set-seg');
      const els = opts.map(([v, l]) => {
        const o = h('span', '', l);
        o.addEventListener('click', (e) => { e.stopPropagation(); pick(v); });
        seg.append(o);
        return o;
      });
      const paint = () => els.forEach((e, i) => e.classList.toggle('on', opts[i][0] === get()));
      const pick = (v: T) => {
        if (v === get()) return;
        set(v);
        paint();
        apply();
        this.host.sfx('ui_move');
      };
      const idx = () => Math.max(0, opts.findIndex((o) => o[0] === get()));
      const row = nav(h('div', 'set-row', h('span', 'set-l', label), h('div', 'set-ctl', h('span', 'set-arrow', '◀'), seg, h('span', 'set-arrow', '▶'))), {
        adjust: (d) => pick(opts[clamp(idx() + d, 0, opts.length - 1)][0]),
        act: () => pick(opts[(idx() + 1) % opts.length][0]),
      });
      paint();
      rowsEl.append(row);
      return row;
    };
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const group = (t: string) => rowsEl.append(h('div', 'set-group', t));

    group('Audio');
    const first = slider('Master volume', () => st.master, (v) => (st.master = v), 0, 1, 0.05, pct);
    slider('Effects volume', () => st.sfx, (v) => (st.sfx = v), 0, 1, 0.05, pct);
    slider('Music volume', () => st.music, (v) => (st.music = v), 0, 1, 0.05, pct);
    group('Camera');
    slider('Camera sensitivity', () => st.sensitivity, (v) => (st.sensitivity = v), 0.2, 3, 0.1, (v) => `${v.toFixed(1)}×`);
    choice('Invert Y', [[false, 'Off'], [true, 'On']], () => st.invertY, (v) => (st.invertY = v));
    choice('Camera shake', [[false, 'Off'], [true, 'On']], () => st.cameraShake, (v) => (st.cameraShake = v));
    group('Display');
    choice<Settings['quality']>('Graphics quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], () => st.quality, (v) => (st.quality = v));
    choice('Damage numbers', [[false, 'Off'], [true, 'On']], () => st.damageNumbers, (v) => (st.damageNumbers = v));
    this.meta.assistRows(group, slider, st);

    const actions: HTMLElement[] = [btn('Back', () => { this.host.sfx('ui_back'); onBack(); }, 'big')];
    if (!inPause) {
      actions.push(btn('Reset Progress', async () => {
        const ok = await this.confirmBox('Reset all progress?', 'Ladder progress, unlocked parts, loadout, record, credits, cosmetics, mastery and achievements will be erased. Settings are kept. This cannot be undone.', 'Erase', 'Cancel', true);
        if (!ok) return;
        const d = defaultSave();
        s.unlocked = d.unlocked;
        s.loadout = d.loadout;
        s.ladder = d.ladder;
        s.beaten = d.beaten;
        s.totals = d.totals;
        Object.assign(s, { credits: d.credits, paint: d.paint, mastery: d.mastery, cosmetics: d.cosmetics, challenges: d.challenges, achievements: d.achievements, stats: d.stats });
        this.host.persist();
        this.toast('Progress reset');
      }, 'big danger'));
    }
    const left = h('div', 'ra-panel set-panel', h('div', 'set-panel-h', 'Options'), rowsEl, h('div', 'ra-actions set-acts', ...actions));

    // controls reference
    const ctl = (rows: [string, string][]) => h('div', 'ctl-list', ...rows.map(([k, a]) => h('div', 'ctl-row', h('span', 'ctl-k', ...k.split(' / ').flatMap((x, i) => (i ? [h('em', '', '/'), h('kbd', '', x)] : [h('kbd', '', x)]))), h('span', 'ctl-a', a))));
    const kb = ctl([['WASD', 'Move'], ['Mouse', 'Camera'], ['Space', 'Jump · double jump · hold to hover'], ['Shift', 'Dash'], ['LMB', 'Fire gun (auto-aim)'], ['R / M4', 'Skill shot: hold + mouse to aim, release'], ['RMB', 'Bomb: hold + mouse to aim, release'], ['E / MMB', 'Launch pod'], ['Q', 'Charge attack'], ['Tab / F', 'Toggle lock-on'], ['Esc', 'Pause']]);
    const gp = ctl([['L-Stick', 'Move'], ['R-Stick', 'Camera'], ['A', 'Jump · double jump · hover'], ['B', 'Dash'], ['RT', 'Fire gun (auto-aim)'], ['Y', 'Skill shot: hold + R-stick to aim, release'], ['LT', 'Throw bomb'], ['RB', 'Launch pod'], ['X', 'Charge attack'], ['R3', 'Toggle lock-on'], ['Start', 'Pause']]);
    void kb; void gp;
    const right = this.meta.controlsPanel(st, apply);
    stagger([left], 80);
    stagger([right], 180);
    const wrap = h('div', 'set-wrap', left, right);
    (wrap as HTMLElement & { _first?: HTMLElement })._first = first;
    return wrap;
  }

  private showSettings(onBack: () => void) {
    this.backdrop('title');
    this.music('menu');
    const el = h('div', 'scr-settings');
    const wrap = this.settingsPanel(false, onBack);
    el.append(h('div', 'vig vig-full'), this.header('System', 'Settings'), wrap, hints([['move', 'Move'], ['adjust', 'Adjust'], ['back', 'Back']]));
    this.setScreen(el, { back: onBack, initial: (wrap as HTMLElement & { _first?: HTMLElement })._first });
  }

  private openSettingsOverlay() {
    this.host.sfx('ui_select');
    const el = h('div', 'ra-modal ra-pause-settings');
    let L: Layer;
    const close = () => this.popLayer(L);
    const wrap = this.settingsPanel(true, close);
    el.append(this.header('Paused', 'Settings'), wrap, hints([['move', 'Move'], ['adjust', 'Adjust'], ['back', 'Back']]));
    L = this.pushLayer(el, { back: close, initial: (wrap as HTMLElement & { _first?: HTMLElement })._first });
  }

  private closePause(v: 'resume' | 'restart' | 'quit', silent = false) {
    const res = this.pauseResolve;
    if (!res) return;
    this.pauseResolve = null;
    // remove the pause layer and everything above it
    const i = this.pauseLayer ? this.stack.indexOf(this.pauseLayer) : -1;
    if (i >= 0) {
      const above = this.stack.splice(i);
      for (const l of above) {
        l.el.classList.add('leaving');
        setTimeout(() => l.el.remove(), 260);
      }
    }
    this.pauseLayer = null;
    this.sync();
    if (!silent) this.host.sfx(v === 'resume' ? 'ui_back' : 'ui_select');
    res(v);
  }
}
