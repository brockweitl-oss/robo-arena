/**
 * Counter-pick screen for first-to-2 sets (local versus, online casual sets, free-battle sets vs AI).
 *
 * Between rounds the loser may swap exactly one part slot (or keep); then the winner sees
 * the loser's new build and may swap one slot. 20 s per pick; a timeout keeps the build.
 * Each pick is decided by exactly one side (the picker is authoritative), so local, AI and
 * online pickers all end with both screens holding the same two builds.
 */
import './counterPick.css';
import { ALL_PARTS, type Loadout, type Slot } from '../data/parts';
import { PICK_SECONDS, PICK_SLOTS, applyPick, parsePickMsg, type Pick, type PickMsg } from '../game/sets';
import type { NetSession } from '../net/online';
import type { MetaCtx } from './meta';
import { h, svg, btn, nav, hints, SLOT_ICON, SLOT_LABEL, CHECK_ICON } from './menus';
import { PartThumbnails } from '../render/partThumbnails';

export type Picker =
  /** Picks on this screen (keyboard / mouse / any gamepad). */
  | { kind: 'local'; owned: (slot: Slot, id: string) => boolean }
  /** Someone else decides (AI or the online opponent); resolves with their pick. */
  | { kind: 'wait'; wait: (step: 1 | 2, loadouts: [Loadout, Loadout]) => Promise<Pick | null>; skipAfter?: number };

export interface CounterPickOpts {
  /** Round about to be played (1-based). */
  round: number;
  score: [number, number];
  names: [string, string];
  /** Accent colors per side (CSS). */
  colors: [string, string];
  loadouts: [Loadout, Loadout];
  /** Side that lost the last round: it picks first. */
  loser: 0 | 1;
  pickers: [Picker, Picker];
  /** A local side committed a pick (online: send it). */
  onPick?: (step: 1 | 2, side: 0 | 1, pick: Pick | null) => void;
  onDone: (loadouts: [Loadout, Loadout]) => void;
  /** Back / Esc (after a confirm box): leave the set. */
  onLeave?: () => void;
  /** Confirm box title and text for leaving. */
  leave?: [string, string];
}

const partName = (slot: Slot, id: string) => ALL_PARTS[slot]?.[id]?.name ?? id;

export function describePick(name: string, before: Loadout, p: Pick | null): string {
  if (!p || before[p.slot] === p.id) return `${name} kept their build`;
  return `${name} swapped ${SLOT_LABEL[p.slot]}: ${partName(p.slot, before[p.slot])} → ${partName(p.slot, p.id)}`;
}

export function showCounterPick(ctx: MetaCtx, o: CounterPickOpts) {
  ctx.music('menu');
  const loadouts: [Loadout, Loadout] = [{ ...o.loadouts[0] }, { ...o.loadouts[1] }];
  const changed: [Slot | null, Slot | null] = [null, null];
  const thumbs = new PartThumbnails();
  const el = h('div', 'scr-cp');
  const hd = ctx.header(`Counter-Pick · Set ${o.score[0]}–${o.score[1]}`, `Round ${o.round}`, h('div', 'ra-sub', 'The loser swaps one part first. Then the winner answers with one swap of their own.'));

  const card = (side: 0 | 1) => {
    const c = h('div', `ra-panel cp-build s${side}`);
    c.style.setProperty('--sc', o.colors[side]);
    return c;
  };
  const cards: [HTMLElement, HTMLElement] = [card(0), card(1)];
  const center = h('div', 'cp-center');
  const banner = h('div', 'cp-banner');
  const timerFill = h('i');
  const timerNum = h('b', '', String(PICK_SECONDS));
  const timer = h('div', 'cp-timer', h('div', 'cp-timer-track', timerFill), timerNum);
  const log = h('div', 'cp-log');
  el.append(h('div', 'vig vig-left'), h('div', 'vig vig-bot'), hd, h('div', 'cp-grid', cards[0], h('div', 'cp-mid', banner, timer, center, log), cards[1]),
    hints([['move', 'Move'], ['confirm', 'Select'], ['back', 'Leave set']]));

  let active: 0 | 1 | -1 = o.loser;
  let pending: Pick | null = null;

  const renderCard = (side: 0 | 1) => {
    const lo = side === active && pending ? applyPick(loadouts[side], pending) : loadouts[side];
    const c = cards[side];
    c.classList.toggle('picking', side === active);
    c.replaceChildren(
      h('div', 'cp-name', h('span', 'cp-tag', side === o.loser ? 'Lost last round' : 'Won last round'), o.names[side]),
      h('div', 'cp-slots', ...PICK_SLOTS.map((s) => {
        const isPending = side === active && pending?.slot === s;
        const isChanged = changed[side] === s;
        return h('div', `cp-slot ${isPending ? 'pending' : ''} ${isChanged ? 'changed' : ''}`,
          h('div', 'cp-slot-ico', svg(SLOT_ICON[s])),
          h('div', 'cp-slot-body', h('div', 'cp-slot-l', SLOT_LABEL[s]), h('div', 'cp-slot-n', partName(s, lo[s]))),
          isChanged ? h('div', 'cp-new', 'NEW') : isPending ? h('div', 'cp-new p', 'SWAP') : null);
      })),
    );
  };

  let deadline = 0;
  let tickTimer = 0;
  let stepDone: ((p: Pick | null) => void) | null = null;
  const stopTimer = () => { clearInterval(tickTimer); tickTimer = 0; };
  const startTimer = (onExpire: () => void, skipAfter?: { at: number; show: () => void }) => {
    stopTimer();
    deadline = performance.now() + PICK_SECONDS * 1000;
    let skipShown = false;
    tickTimer = window.setInterval(() => {
      if (!ctx.isScreen(el)) { stopTimer(); thumbs.dispose(); return; }
      const left = Math.max(0, deadline - performance.now());
      timerFill.style.setProperty('--w', String(left / (PICK_SECONDS * 1000)));
      timerNum.textContent = String(Math.ceil(left / 1000));
      timer.classList.toggle('low', left < 5000);
      if (skipAfter && !skipShown && performance.now() - (deadline - PICK_SECONDS * 1000) > skipAfter.at * 1000) { skipShown = true; skipAfter.show(); }
      if (left <= 0) onExpire();
    }, 100);
    timerFill.style.setProperty('--w', '1');
  };

  const commit = (p: Pick | null) => {
    if (!stepDone) return;
    const done = stepDone;
    stepDone = null;
    stopTimer();
    done(p);
  };

  /** Interactive chooser for a local picker. */
  const localStep = (side: 0 | 1, picker: Extract<Picker, { kind: 'local' }>) => new Promise<Pick | null>((resolve) => {
    stepDone = resolve;
    pending = null;
    let slot: Slot = 'gun';
    const tabs = h('div', 'cp-tabs');
    const list = h('div', 'cp-list');
    const tabEls = new Map<Slot, HTMLElement>();
    const keep = btn('Keep Build', () => { ctx.host.sfx('ui_back'); commit(null); }, 'big');
    const lock = btn('Lock In', () => { ctx.host.sfx('ui_select'); commit(pending); }, 'primary big', CHECK_ICON);
    const renderList = (focusFirst: boolean) => {
      for (const [s, t] of tabEls) t.classList.toggle('sel', s === slot);
      const current = loadouts[side][slot];
      const ids = Object.keys(ALL_PARTS[slot]).filter((id) => picker.owned(slot, id) || id === current);
      const items = ids.map((id) => {
        const p = ALL_PARTS[slot][id];
        const sel = (pending?.slot === slot ? pending.id : current) === id;
        const pips = h('div', 'gp-pips', ...Object.entries(p.ratings).map(([k, v]) => h('span', '', k.slice(0, 3), h('b', '', '■'.repeat(v)))));
        return nav(h('div', `gar-part cp-part ${sel ? 'equipped' : ''}`, h('div', 'gp-visual', thumbs.image(slot, id)),
          h('div', 'gp-body', h('div', 'gp-name', p.name), pips), id === current ? h('div', 'cp-cur', 'Current') : null), {
          act: () => {
            ctx.host.sfx('ui_select');
            pending = id === current ? (pending?.slot === slot ? null : pending) : { slot, id };
            renderList(false);
            renderCard(side);
            ctx.focus(lock);
          },
        });
      });
      list.replaceChildren(...items);
      if (focusFirst) ctx.focus(items.find((x) => x.classList.contains('equipped')) ?? items[0]);
    };
    for (const s of PICK_SLOTS) {
      const t = nav(h('div', 'gar-tab cp-tab', svg(SLOT_ICON[s]), h('span', '', SLOT_LABEL[s])), {
        act: () => { ctx.host.sfx('ui_move'); slot = s; renderList(true); },
        focus: () => { if (slot !== s) { slot = s; renderList(false); } },
      });
      tabEls.set(s, t);
      tabs.append(t);
    }
    banner.replaceChildren(h('b', '', `${o.names[side]}`), side === o.loser ? ' counter-picks first' : ' answers');
    center.replaceChildren(h('div', 'cp-hint', 'Swap one part, or keep your build. Only one slot can change.'), tabs, list, h('div', 'ra-actions cp-acts', keep, lock));
    renderList(false);
    ctx.focus(tabEls.get('gun'));
    startTimer(() => { ctx.host.sfx('ui_back'); commit(null); });
  });

  /** Someone else is choosing: show the clock and wait. */
  const waitStep = (side: 0 | 1, step: 1 | 2, picker: Extract<Picker, { kind: 'wait' }>) => new Promise<Pick | null>((resolve) => {
    stepDone = resolve;
    pending = null;
    const skip = btn('Skip', () => { ctx.host.sfx('ui_back'); commit(null); }, 'big is-hidden');
    banner.replaceChildren(h('b', '', o.names[side]), side === o.loser ? ' is counter-picking…' : ' is answering…');
    center.replaceChildren(h('div', 'cp-wait', h('div', 'cp-spin'), h('div', '', `${o.names[side]} is choosing a swap.`), h('div', 'md-desc', 'You will see their new build before the next round.')), h('div', 'ra-actions cp-acts', skip));
    startTimer(() => { /* the picker decides its own timeout */ }, picker.skipAfter ? { at: picker.skipAfter, show: () => skip.classList.remove('is-hidden') } : undefined);
    picker.wait(step, [{ ...loadouts[0] }, { ...loadouts[1] }]).then((p) => { if (ctx.isScreen(el)) commit(p); });
  });

  const reveal = (side: 0 | 1, p: Pick | null) => {
    const before = loadouts[side];
    const after = applyPick(before, p);
    const real = p && before[p.slot] !== p.id ? p : null;
    log.prepend(h('div', `cp-log-row s${side}`, describePick(o.names[side], before, real)));
    loadouts[side] = after;
    changed[side] = real ? real.slot : null;
    pending = null;
    renderCard(0);
    renderCard(1);
    return real;
  };

  const run = async () => {
    const order: [0 | 1, 1 | 2][] = [[o.loser, 1], [(1 - o.loser) as 0 | 1, 2]];
    for (const [side, step] of order) {
      if (!ctx.isScreen(el)) return;
      active = side;
      renderCard(0);
      renderCard(1);
      const picker = o.pickers[side];
      const p = picker.kind === 'local' ? await localStep(side, picker) : await waitStep(side, step, picker);
      if (!ctx.isScreen(el)) return;
      const real = reveal(side, p);
      if (picker.kind === 'local') o.onPick?.(step, side, real);
      ctx.host.sfx(real ? 'ui_unlock' : 'ui_move');
      timer.classList.add('idle');
      center.replaceChildren(h('div', 'cp-wait done', h('div', 'cp-big', real ? `${SLOT_LABEL[real.slot]} → ${partName(real.slot, real.id)}` : 'Build kept'), h('div', 'md-desc', `${o.names[side]} ${real ? 'swapped a part' : 'kept their build'}.`)));
      await new Promise((r) => setTimeout(r, 1300));
      timer.classList.remove('idle');
    }
    if (!ctx.isScreen(el)) return;
    active = -1;
    renderCard(0);
    renderCard(1);
    banner.replaceChildren(h('b', '', 'Builds locked'), ` · Round ${o.round}`);
    timer.classList.add('idle');
    center.replaceChildren(h('div', 'cp-wait done', h('div', 'cp-big', 'FIGHT!'), h('div', 'md-desc', 'Both builds are final.')));
    await new Promise((r) => setTimeout(r, 1100));
    if (!ctx.isScreen(el)) return;
    stopTimer();
    thumbs.dispose();
    o.onDone([{ ...loadouts[0] }, { ...loadouts[1] }]);
  };

  renderCard(0);
  renderCard(1);
  ctx.setScreen(el, {
    back: o.onLeave ? () => {
      void ctx.confirmBox(o.leave?.[0] ?? 'Leave the set?', o.leave?.[1] ?? 'The set ends here.', 'Leave', 'Stay').then((ok) => {
        if (!ok || !ctx.isScreen(el)) return;
        stopTimer();
        thumbs.dispose();
        o.onLeave!();
      });
    } : undefined,
  });
  void run();
}

/**
 * Online pick exchange over the existing room socket. The room server relays unknown
 * message types untouched, so this needs no server change. Attach once per session (before
 * the first round ends) so a fast opponent's pick is never missed.
 */
export class PickChannel {
  private got = new Map<string, Pick | null>();
  private waiters = new Map<string, (p: Pick | null) => void>();
  private onMsg = (e: MessageEvent) => {
    if (typeof e.data !== 'string' || !e.data.startsWith('{"t":"cp"')) return;
    let raw: unknown;
    try { raw = JSON.parse(e.data); } catch { return; }
    const m = parsePickMsg(raw);
    if (!m) return;
    const k = `${m.round}:${m.step}`;
    const w = this.waiters.get(k);
    if (w) { this.waiters.delete(k); w(m.pick); } else this.got.set(k, m.pick);
  };
  private static all = new WeakMap<NetSession, PickChannel>();

  private constructor(private ses: NetSession) {
    ses.ws.addEventListener('message', this.onMsg);
  }

  static for(ses: NetSession): PickChannel {
    let c = PickChannel.all.get(ses);
    if (!c) { c = new PickChannel(ses); PickChannel.all.set(ses, c); }
    return c;
  }

  send(round: number, step: 1 | 2, pick: Pick | null) {
    const m: PickMsg = { t: 'cp', round, step, pick };
    this.ses.raw(m as unknown as { t: string });
  }

  wait(round: number, step: 1 | 2): Promise<Pick | null> {
    const k = `${round}:${step}`;
    if (this.got.has(k)) { const p = this.got.get(k)!; this.got.delete(k); return Promise.resolve(p); }
    return new Promise((r) => {
      this.waiters.set(k, r);
      // the room closing ends the wait (keep)
      const poll = window.setInterval(() => { if (this.ses.closed) { clearInterval(poll); if (this.waiters.get(k) === r) { this.waiters.delete(k); r(null); } } else if (!this.waiters.has(k)) clearInterval(poll); }, 500);
    });
  }
}
