/**
 * Meta screens (G6): profile card, credits shop + locker, results rewards strip,
 * build share codes, and the rebindable Controls panel.
 *
 * Kept out of menus.ts so the menu shell stays easy to merge: Menus creates one MetaUI
 * with a small context of its layer plumbing and calls into it from a few hook points.
 * Everything here is cosmetic / convenience — nothing touches stats.
 */
import './meta.css';
import type { MenuHost } from './host';
import type { MusicTrack } from '../audio/audio';
import type { MatchResult } from '../game/types';
import type { Settings } from '../core/save';
import { ALL_PARTS, resolveLoadout, type Slot } from '../data/parts';
import { PLAYER_ROBOT_NAME, RIVALS, type Paint } from '../data/characters';
import { COSMETICS, KIND_LABEL, buyCosmetic, dailyStock, dateKey, msUntilRestock, type Cosmetic, type CosmeticKind } from '../data/shop';
import { decodeBuild, encodeBuild, applyImportedLoadout } from '../data/buildcode';
import {
  onMatchEnd, ensureChallenges, pilotLevel, masteryLevel, levelProgress, favoriteBuild, equipCosmetic, unequipCosmetic,
  MASTERY_XP, MAX_MASTERY, emptyRewards, weekKey, type Rewards, type ChallengeDef,
} from '../game/progression';
import { MASTERY_REWARD, masteryCosmeticId } from '../data/shop';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, checkAchievements } from '../game/achievements';
import {
  ACTIONS, ACTION_LABEL, KEY_SLOTS, MOVE_ACTIONS, DEFAULT_BINDINGS, cloneBindings, keyConflict, padConflict, keyName, padName,
  type Action,
} from '../core/input';
import {
  h, svg, btn, nav, stagger, hints, emblem, hex, clamp, wait, SLOTS, SLOT_ICON, SLOT_LABEL, LOCK_ICON, CHECK_ICON,
  type Kid, type Layer, type LayerOpts,
} from './menus';

export interface MetaCtx {
  host: MenuHost;
  setScreen(el: HTMLElement, opts?: LayerOpts): void;
  pushLayer(el: HTMLElement, opts?: LayerOpts): Layer;
  popLayer(L: Layer): void;
  /** Move focus without sound. */
  focus(el: HTMLElement | undefined): void;
  confirmBox(title: string, text: string, yes?: string, no?: string, danger?: boolean): Promise<boolean>;
  toast(text: string): void;
  header(kicker: string, title: string, extra?: Kid): HTMLElement;
  music(t: MusicTrack): void;
  /** Is `el` the current screen element? */
  isScreen(el: HTMLElement): boolean;
  /** While true, the menu shell ignores keyboard/gamepad navigation (binding capture). */
  setCapture(on: boolean): void;
  setResize(fn: (() => void) | null): void;
}

const CREDIT_ICON = '<svg viewBox="0 0 24 24"><path d="M12 2l8.7 5v10L12 22l-8.7-5V7z"/><path d="M12 6.5l4.8 2.75v5.5L12 17.5l-4.8-2.75v-5.5z" fill="#0b0e14" opacity=".55"/></svg>';
const POSE_ICON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="4" r="2.4"/><path d="M5 7.5l5 2V14l-2.5 8h2.6l2-6 2 6h2.6L14 14V9.5l5-2-.8-1.9L12 8 5.8 5.6z"/></svg>';
const TROPHY_ICON = '<svg viewBox="0 0 24 24"><path d="M7 3h10v2h3v3a4 4 0 01-4 4h-.4A5 5 0 0113 14.9V18h3v3H8v-3h3v-3.1A5 5 0 018.4 12H8a4 4 0 01-4-4V5h3zm0 4H6v1a2 2 0 001 1.7zm10 0v2.7A2 2 0 0018 8V7z"/></svg>';
const SHARE_ICON = '<svg viewBox="0 0 24 24"><path d="M18 16a3 3 0 00-2.2 1l-7-3.6a3 3 0 000-2.8l7-3.6A3 3 0 1015 5l-7 3.6a3 3 0 100 6.8l7 3.6A3 3 0 1018 16z"/></svg>';
const fmtCr = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtLeft = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440), hr = Math.floor((m % 1440) / 60), mm = m % 60;
  return d > 0 ? `${d}d ${hr}h` : `${hr}h ${String(mm).padStart(2, '0')}m`;
};
const partOf = (key: string) => {
  const [s, id] = key.split(':') as [Slot, string];
  return ALL_PARTS[s]?.[id];
};
const creditTag = (n: number, cls = '') => h('span', `mt-cr ${cls}`, svg(CREDIT_ICON), h('b', '', fmtCr(n)));

/** Small visual for a cosmetic: paint stripes, decal emblem, trail streak or pose glyph. */
function cosmeticArt(c: Cosmetic, base: Paint): HTMLElement {
  const art = h('div', `mt-art k-${c.kind}`);
  if (c.kind === 'paint' && c.paint) {
    const p = c.paint;
    art.style.setProperty('--c1', hex(p.primary));
    art.style.setProperty('--c2', hex(p.secondary));
    art.style.setProperty('--c3', hex(p.trim));
    art.style.setProperty('--c4', hex(p.dark));
    art.style.setProperty('--c5', hex(p.glow));
  } else if (c.kind === 'decal') {
    art.append(emblem({ ...base, emblem: c.decal ?? '?' }));
  } else if (c.kind === 'trail') {
    art.style.setProperty('--t', hex(c.trail ?? 0xffffff));
    art.append(h('i'), h('i'), h('i'), h('b'));
  } else {
    art.append(svg(POSE_ICON));
  }
  return art;
}

export class MetaUI {
  private profileTab: 'ach' | 'chal' | 'mast' = 'ach';
  private shopTab: 'stock' | 'locker' = 'stock';

  constructor(private ctx: MetaCtx) {}

  private get save() {
    return this.ctx.host.save;
  }

  /* ================================================================ match end */

  /** Apply rewards for a finished match and persist. Never throws into the results screen. */
  matchEnd(res: MatchResult): Rewards {
    try {
      const r = onMatchEnd(this.save, res);
      this.ctx.host.persist();
      return r;
    } catch (e) {
      console.warn('progression failed', e);
      return emptyRewards();
    }
  }

  /** Rewards strip on the results screen: credits count-up, mastery bars, challenge ticks, achievement toasts. */
  rewardsStrip(screen: HTMLElement, rw: Rewards) {
    const s = this.save;
    const panel = h('div', 'ra-panel rw-panel');
    const crNum = h('b', '', '0');
    const crHead = h('div', 'rw-cr', svg(CREDIT_ICON), h('span', 'rw-plus', '+'), crNum, h('span', 'rw-unit', 'CR'));
    const lines = h('div', 'rw-lines', ...rw.lines.map((l, i) => {
      const row = h('div', 'rw-line', h('span', '', l.label), h('b', '', `+${fmtCr(l.amount)}`));
      row.style.setProperty('--i', String(i));
      return row;
    }));
    const bal = h('div', 'rw-bal', h('span', '', 'Balance'), creditTag(s.credits));
    panel.append(h('div', 'rw-h', 'Rewards'), crHead, lines, bal);

    if (rw.mastery.length) {
      const ms = h('div', 'rw-mast');
      rw.mastery.forEach((m, i) => {
        const p = partOf(m.part);
        if (!p) return;
        const fill = h('i');
        const lvl = h('span', 'rw-lv', `Lv ${m.levelBefore}`);
        const row = h('div', 'rw-mrow', svg(SLOT_ICON[p.slot]), h('div', 'rw-mname', p.name), lvl, h('div', 'rw-mbar', fill), h('em', '', `+${m.xp}`));
        row.style.setProperty('--i', String(i));
        fill.style.transform = `scaleX(${m.levelBefore >= MAX_MASTERY ? 1 : levelProgress(m.before)})`;
        ms.append(row);
        // animate: fill to the end of each level crossed, then the remainder
        const steps: { lv: number; to: number }[] = [];
        for (let lv = m.levelBefore; lv < m.levelAfter; lv++) steps.push({ lv: lv + 1, to: 1 });
        steps.push({ lv: m.levelAfter, to: m.levelAfter >= MAX_MASTERY ? 1 : levelProgress(m.after) });
        (async () => {
          await wait(1500 + i * 120);
          for (const st of steps) {
            if (!this.ctx.isScreen(screen)) return;
            fill.style.transform = `scaleX(${st.to})`;
            await wait(520);
            if (st.to === 1 && st.lv > m.levelBefore && st !== steps[steps.length - 1]) {
              fill.style.transition = 'none';
              fill.style.transform = 'scaleX(0)';
              void fill.offsetWidth;
              fill.style.transition = '';
            }
            if (st.lv !== m.levelBefore) {
              lvl.textContent = `Lv ${st.lv}`;
              row.classList.add('up');
              this.ctx.host.sfx('ui_select');
            }
          }
        })();
      });
      panel.append(h('div', 'rw-sub', 'Part mastery'), ms);
    }

    if (rw.challenges.length) {
      const cl = h('div', 'rw-chal', ...rw.challenges.map((c, i) => {
        const row = h('div', `rw-crow ${c.completed ? 'done' : ''}`, h('span', 'rw-tick', c.completed ? svg(CHECK_ICON) : ''), h('span', 'rw-ctext', c.def.text), h('b', '', c.completed ? `+${c.def.reward}` : `${fmtCr(c.after)}/${fmtCr(c.def.goal)}`));
        row.style.setProperty('--i', String(i));
        return row;
      }));
      panel.append(h('div', 'rw-sub', 'Challenges'), cl);
    }
    stagger([panel], 950);
    screen.append(panel);

    // credits count-up
    const t0 = performance.now() + 1200;
    const tick = () => {
      if (!this.ctx.isScreen(screen)) return;
      const k = clamp((performance.now() - t0) / 1100, 0, 1);
      crNum.textContent = fmtCr(rw.credits * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // toasts: achievements first, then cosmetic unlocks
    const toasts = h('div', 'rw-toasts');
    screen.append(toasts);
    const queue: HTMLElement[] = [];
    for (const id of rw.achievements) {
      const a = ACHIEVEMENT_BY_ID[id];
      if (a) queue.push(h('div', 'rw-toast ach', h('div', 'mt-badge on', h('span', '', a.icon)), h('div', '', h('div', 'rw-tk', 'Achievement unlocked'), h('div', 'rw-tn', a.name), h('div', 'rw-td', a.desc))));
    }
    for (const id of rw.cosmetics) {
      const c = COSMETICS[id];
      if (c) queue.push(h('div', 'rw-toast cos', cosmeticArt(c, s.paint), h('div', '', h('div', 'rw-tk', `New ${KIND_LABEL[c.kind]}`), h('div', 'rw-tn', c.name), h('div', 'rw-td', 'Equip it in the Shop › Locker'))));
    }
    (async () => {
      await wait(1900);
      for (const t of queue) {
        if (!this.ctx.isScreen(screen)) return;
        toasts.append(t);
        this.ctx.host.sfx('ui_unlock');
        await wait(700);
      }
    })();
  }

  /* ================================================================ profile */

  showProfile(onBack: () => void) {
    const s = this.save;
    ensureChallenges(s);
    this.ctx.host.setBackdrop('title');
    this.ctx.music('menu');
    const el = h('div', 'scr-profile');

    // ---- left: pilot card
    const wins = s.totals.wins, losses = s.totals.losses;
    const played = wins + losses + s.stats.draws;
    const rate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
    const lvl = pilotLevel(s);
    const allParts = SLOTS.reduce((a, sl) => a + Object.keys(ALL_PARTS[sl]).length, 0);
    const ring = h('div', 'pf-ring');
    ring.style.setProperty('--p', String(rate / 100));
    const fav = favoriteBuild(s);
    const favLo = fav ? resolveLoadout(fav.loadout) : null;
    const stat = (k: string, v: string) => h('div', 'pf-stat', h('span', '', k), h('b', '', v));
    const card = h('div', 'ra-panel pf-card',
      h('div', 'pf-top', emblem(s.paint), h('div', '', h('div', 'pf-name', PLAYER_ROBOT_NAME), h('div', 'pf-sub', s.ladder >= RIVALS.length ? 'Circuit Champion' : `Circuit ${Math.min(s.ladder, RIVALS.length)}/${RIVALS.length}`))),
      h('div', 'pf-level', h('div', 'pf-lv', h('span', '', 'Pilot level'), h('b', '', String(lvl)), h('em', '', '+1 per part mastery level')), creditTag(s.credits, 'big')),
      h('div', 'pf-rate', ring, h('div', 'pf-rate-t', h('b', '', `${rate}%`), h('span', '', 'Win rate'), h('em', '', `${wins}W · ${losses}L${s.stats.draws ? ` · ${s.stats.draws}D` : ''}`))),
      h('div', 'pf-sec', 'Favorite build', fav ? h('span', '', `${fav.count} match${fav.count === 1 ? '' : 'es'}`) : null),
      favLo
        ? h('div', 'pf-fav', ...SLOTS.map((sl) => h('div', 'pf-fav-p', svg(SLOT_ICON[sl]), h('span', '', favLo[sl].name))))
        : h('div', 'pf-empty', 'Play a match to track your favorite build.'),
      h('div', 'pf-sec', 'Career'),
      h('div', 'pf-stats',
        stat('Matches', fmtCr(played)),
        stat('KO wins', fmtCr(s.stats.koWins)),
        stat('Damage', fmtCr(s.stats.damage)),
        stat('Knockdowns', fmtCr(s.totals.knockdowns)),
        stat('Perfect dodges', fmtCr(s.stats.dodges)),
        stat('Parries', fmtCr(s.stats.parries)),
        stat('Deflects', fmtCr(s.stats.deflects)),
        stat('Best streak', fmtCr(s.stats.bestStreak)),
        stat('Fastest KO', s.stats.fastestKo ? `${s.stats.fastestKo.toFixed(1)} s` : '—'),
        stat('Challenges', fmtCr(s.stats.challengesDone))),
    );

    // ---- right: tabs
    const tabs = h('div', 'pf-tabs');
    const body = h('div', 'pf-body ra-scroll');
    const count = h('span', 'pf-count');
    const tabDefs: [typeof this.profileTab, string, string][] = [
      ['ach', 'Achievements', TROPHY_ICON],
      ['chal', 'Challenges', CHECK_ICON],
      ['mast', 'Mastery', SLOT_ICON.body],
    ];
    const tabEls = new Map<string, HTMLElement>();
    let firstItem: HTMLElement | undefined;
    const render = (t: typeof this.profileTab) => {
      this.profileTab = t;
      tabEls.forEach((e, k) => e.classList.toggle('sel', k === t));
      body.replaceChildren();
      body.scrollTop = 0;
      body.classList.toggle('mast', t === 'mast');
      if (t === 'ach') this.renderAchievements(body, count);
      else if (t === 'chal') this.renderChallenges(body, count);
      else this.renderMastery(body, count);
      firstItem = body.querySelector<HTMLElement>('[data-nav]') ?? undefined;
      body.classList.remove('swap');
      void body.offsetWidth;
      body.classList.add('swap');
    };
    for (const [k, label, ico] of tabDefs) {
      const te = nav(h('div', 'gar-tab pf-tab', svg(ico), h('span', '', label)), {
        focus: () => { if (this.profileTab !== k) render(k); },
        act: () => this.ctx.focus(firstItem),
      });
      tabEls.set(k, te);
      tabs.append(te);
    }
    const back = btn('Back', () => { this.ctx.host.sfx('ui_back'); onBack(); }, 'big');
    card.append(h('div', 'pf-foot', back));
    const main = h('div', 'ra-panel pf-main', h('div', 'pf-main-h', tabs, count), body);
    stagger([card], 80);
    stagger([main], 180);
    el.append(h('div', 'vig vig-full'), this.ctx.header('Pilot', 'Profile'), card, main, hints([['move', 'Move'], ['tabs', 'Tab'], ['back', 'Back']]));
    render(this.profileTab);
    const cycle = (d: number) => {
      const keys = tabDefs.map((t) => t[0]);
      const i = (keys.indexOf(this.profileTab) + d + keys.length) % keys.length;
      render(keys[i]);
      this.ctx.host.sfx('ui_move');
      this.ctx.focus(tabEls.get(keys[i]));
    };
    this.ctx.setScreen(el, {
      back: onBack,
      key: (k) => {
        if (k === 'prev') { cycle(-1); return true; }
        if (k === 'next') { cycle(1); return true; }
        return false;
      },
      initial: tabEls.get(this.profileTab),
    });
  }

  private renderAchievements(body: HTMLElement, count: HTMLElement) {
    const s = this.save;
    const got = ACHIEVEMENTS.filter((a) => s.achievements[a.id]).length;
    count.textContent = `${got} / ${ACHIEVEMENTS.length} unlocked`;
    const grid = h('div', 'pf-ach');
    ACHIEVEMENTS.forEach((a, i) => {
      const at = s.achievements[a.id];
      const reward = (a.rewards ?? []).map((id) => COSMETICS[id]?.name).filter(Boolean).join(', ');
      const tile = nav(h('div', `pf-at ${at ? 'on' : ''}`,
        h('div', `mt-badge ${at ? 'on' : ''}`, h('span', '', at ? a.icon : '?')),
        h('div', 'pf-at-b', h('div', 'pf-at-n', a.name), h('div', 'pf-at-d', a.desc),
          reward ? h('div', 'pf-at-r', `Reward: ${reward}`) : null,
          at ? h('div', 'pf-at-t', new Date(at).toLocaleDateString()) : null)), { quiet: true });
      tile.style.setProperty('--d', `${i * 18}ms`);
      grid.append(tile);
    });
    body.append(grid);
  }

  private renderChallenges(body: HTMLElement, count: HTMLElement) {
    const s = this.save;
    const c = s.challenges;
    const all = [...c.daily, ...c.weekly];
    count.textContent = `${all.filter((d) => c.done.includes(d.id)).length} / ${all.length} complete`;
    const now = new Date();
    const nextMonday = new Date(weekKey(now) + 'T00:00:00');
    nextMonday.setDate(nextMonday.getDate() + 7);
    const row = (d: ChallengeDef) => {
      const done = c.done.includes(d.id);
      const p = Math.min(d.goal, c.progress[d.id] ?? 0);
      const fill = h('i');
      fill.style.setProperty('--w', String(done ? 1 : p / d.goal));
      return nav(h('div', `pf-ch ${done ? 'done' : ''}`,
        h('span', 'rw-tick', done ? svg(CHECK_ICON) : ''),
        h('div', 'pf-ch-b', h('div', 'pf-ch-t', d.text), h('div', 'pf-ch-bar', fill)),
        h('div', 'pf-ch-n', done ? 'Done' : `${fmtCr(p)} / ${fmtCr(d.goal)}`),
        creditTag(d.reward)), { quiet: true });
    };
    body.append(
      h('div', 'pf-group', 'Daily', h('span', '', `Resets in ${fmtLeft(msUntilRestock(now))}`)),
      ...c.daily.map(row),
      h('div', 'pf-group', 'Weekly', h('span', '', `Resets in ${fmtLeft(nextMonday.getTime() - now.getTime())}`)),
      ...c.weekly.map(row),
      h('div', 'pf-note', 'Challenges count in every mode except practice. Rewards are credits for cosmetics only.'),
    );
  }

  private renderMastery(body: HTMLElement, count: HTMLElement) {
    const s = this.save;
    count.textContent = `Pilot level ${pilotLevel(s)}`;
    for (const sl of SLOTS) {
      body.append(h('div', 'pf-group', SLOT_LABEL[sl]));
      for (const [id, p] of Object.entries(ALL_PARTS[sl])) {
        const key = `${sl}:${id}`;
        const owned = s.unlocked.includes(key);
        const xp = s.mastery[key] ?? 0;
        const lv = masteryLevel(s, key);
        const pips = h('div', 'pf-pips', ...Array.from({ length: MAX_MASTERY }, (_, i) => h('i', i < lv ? 'on' : '')));
        const fill = h('i');
        fill.style.setProperty('--w', String(lv >= MAX_MASTERY ? 1 : levelProgress(xp)));
        const nextId = lv < MAX_MASTERY ? masteryCosmeticId(key, lv + 1) : null;
        const next = nextId ? COSMETICS[nextId] : null;
        const nextTxt = lv >= MAX_MASTERY ? 'Mastered' : next ? `Lv ${lv + 1}: ${KIND_LABEL[MASTERY_REWARD[lv + 1]]} · ${fmtCr(MASTERY_XP[lv] - xp)} XP` : '';
        body.append(nav(h('div', `pf-mp ${owned ? '' : 'locked'} ${lv >= MAX_MASTERY ? 'max' : ''}`,
          h('div', 'gp-ico', svg(owned ? SLOT_ICON[sl] : LOCK_ICON)),
          h('div', 'pf-mp-b', h('div', 'pf-mp-n', p.name, pips), h('div', 'pf-ch-bar', fill), h('div', 'pf-mp-x', owned ? nextTxt : 'Unlock this part to earn mastery'))), { quiet: true }));
      }
    }
  }

  /* ================================================================ shop + locker */

  showShop(onBack: () => void) {
    const s = this.save;
    this.ctx.music('garage');
    const el = h('div', 'scr-shop');
    const preview = h('div', 'shop-preview', h('div', 'gar-ring'));
    let previewPaint: Paint = { ...s.paint };
    const sendBackdrop = (p: Paint = s.paint) => {
      previewPaint = { ...p };
      const r = preview.getBoundingClientRect();
      this.ctx.host.setBackdrop('garage', { loadout: { ...s.loadout }, paint: previewPaint, previewRect: { x: r.left, y: r.top, w: r.width, h: r.height } });
    };
    // drag-rotate like the garage
    let dragging = false, lx = 0;
    preview.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; preview.setPointerCapture(e.pointerId); });
    preview.addEventListener('pointermove', (e) => { if (dragging) { this.ctx.host.rotatePreview((e.clientX - lx) * 0.01); lx = e.clientX; } });
    preview.addEventListener('pointerup', () => { dragging = false; });

    const wallet = h('div', 'ra-panel shop-wallet', h('span', '', 'Credits'), creditTag(s.credits, 'big'));
    const tabs = h('div', 'pf-tabs two');
    const body = h('div', 'shop-body ra-scroll');
    const sub = h('span', 'pf-count');
    const tabEls = new Map<string, HTMLElement>();
    const tryOn = (c: Cosmetic | null) => {
      const p = { ...s.paint };
      if (c?.kind === 'paint' && c.paint) Object.assign(p, c.paint);
      if (c?.kind === 'decal' && c.decal) p.emblem = c.decal;
      if (c?.kind === 'trail' && c.trail !== undefined) p.trail = c.trail;
      if (JSON.stringify(p) !== JSON.stringify(previewPaint)) sendBackdrop(p);
    };
    const refreshWallet = () => wallet.replaceChildren(h('span', '', 'Credits'), creditTag(s.credits, 'big'));
    let render: (t: typeof this.shopTab, keepFocus?: string) => void;

    const buy = async (c: Cosmetic) => {
      const day = dateKey();
      if (s.cosmetics.owned.includes(c.id)) {
        equipCosmetic(s, c.id);
        this.ctx.host.persist();
        this.ctx.host.sfx('ui_select');
        this.ctx.toast(`${c.name} equipped`);
        sendBackdrop();
        render('stock', c.id);
        return;
      }
      if (s.credits < c.price) {
        this.ctx.host.sfx('ui_error');
        this.ctx.toast(`Need ${fmtCr(c.price - s.credits)} more credits`);
        return;
      }
      const ok = await this.ctx.confirmBox(`Buy ${c.name}?`, `${KIND_LABEL[c.kind]} for ${fmtCr(c.price)} credits. Cosmetic only — no stat changes. You'll have ${fmtCr(s.credits - c.price)} left.`, 'Buy & Equip', 'Cancel');
      if (!ok) return;
      const r = buyCosmetic(s, c.id, day);
      if (!r.ok) {
        this.ctx.toast(r.reason === 'not-in-stock' ? 'Stock has rotated' : 'Purchase failed');
        render('stock');
        return;
      }
      s.stats.creditsSpent += c.price;
      equipCosmetic(s, c.id);
      const ach = checkAchievements(s, null);
      this.ctx.host.persist();
      this.ctx.host.sfx('ui_unlock');
      this.ctx.toast(ach.unlocked.length ? `Achievement: ${ACHIEVEMENT_BY_ID[ach.unlocked[0]].name}` : `${c.name} purchased`);
      refreshWallet();
      sendBackdrop();
      render('stock', c.id);
    };

    const stockView = () => {
      const day = dateKey();
      const ids = dailyStock(day);
      sub.textContent = `New stock in ${fmtLeft(msUntilRestock())}`;
      const grid = h('div', 'shop-grid');
      ids.forEach((id, i) => {
        const c = COSMETICS[id];
        const owned = s.cosmetics.owned.includes(id);
        const equipped = s.cosmetics.equipped[c.kind] === id;
        const afford = s.credits >= c.price;
        const tile = nav(h('div', `shop-item ${owned ? 'owned' : ''} ${!owned && !afford ? 'poor' : ''}`,
          cosmeticArt(c, s.paint),
          h('div', 'shop-kind', KIND_LABEL[c.kind]),
          h('div', 'shop-name', c.name),
          c.blurb ? h('div', 'shop-blurb', c.blurb) : null,
          h('div', 'shop-price', owned ? h('span', 'shop-own', svg(CHECK_ICON), equipped ? 'Equipped' : 'Owned · Equip') : creditTag(c.price))), {
          focus: () => tryOn(c),
          act: () => void buy(c),
        });
        tile.dataset.id = id;
        tile.style.setProperty('--d', `${i * 50}ms`);
        grid.append(tile);
      });
      body.append(grid, h('div', 'pf-note', 'Cosmetics only. Parts are never sold — earn them on the ladder and in Rival+.'));
    };

    const lockerView = () => {
      const owned = s.cosmetics.owned.map((id) => COSMETICS[id]).filter((c): c is Cosmetic => !!c);
      sub.textContent = `${owned.length} cosmetic${owned.length === 1 ? '' : 's'} owned`;
      const kinds: CosmeticKind[] = ['paint', 'decal', 'trail', 'pose'];
      for (const k of kinds) {
        const list = owned.filter((c) => c.kind === k);
        body.append(h('div', 'pf-group', `${KIND_LABEL[k]}s`, h('span', '', `${list.length} owned`)));
        const grid = h('div', 'lock-grid');
        const isDef = !s.cosmetics.equipped[k];
        const def = nav(h('div', `lock-item ${isDef ? 'eq' : ''}`, h('div', 'mt-art k-def', h('span', '', 'STD')), h('div', 'lock-n', 'Standard'), isDef ? h('div', 'lock-eq', svg(CHECK_ICON)) : null), {
          focus: () => tryOn(null),
          act: () => {
            unequipCosmetic(s, k);
            this.ctx.host.persist();
            this.ctx.host.sfx('ui_select');
            sendBackdrop();
            render('locker', `def:${k}`);
          },
        });
        def.dataset.id = `def:${k}`;
        grid.append(def);
        for (const c of list) {
          const eq = s.cosmetics.equipped[k] === c.id;
          const it = nav(h('div', `lock-item ${eq ? 'eq' : ''}`, cosmeticArt(c, s.paint), h('div', 'lock-n', c.name), eq ? h('div', 'lock-eq', svg(CHECK_ICON)) : null), {
            focus: () => tryOn(c),
            act: () => {
              equipCosmetic(s, c.id);
              this.ctx.host.persist();
              this.ctx.host.sfx('ui_select');
              sendBackdrop();
              render('locker', c.id);
            },
          });
          it.dataset.id = c.id;
          grid.append(it);
        }
        body.append(grid);
      }
      body.append(h('div', 'pf-note', 'Earn more from part mastery, achievements and the daily stock. Victory poses play after a win.'));
    };

    render = (t, keepFocus) => {
      const scroll = body.scrollTop;
      this.shopTab = t;
      tabEls.forEach((e, k) => e.classList.toggle('sel', k === t));
      body.replaceChildren();
      if (t === 'stock') stockView();
      else lockerView();
      if (keepFocus) {
        body.scrollTop = scroll;
        const f = body.querySelector<HTMLElement>(`[data-id="${CSS.escape(keepFocus)}"]`);
        if (f) this.ctx.focus(f);
      } else {
        body.scrollTop = 0;
        body.classList.remove('swap');
        void body.offsetWidth;
        body.classList.add('swap');
      }
    };
    for (const [k, label, ico] of [['stock', "Today's Stock", CREDIT_ICON], ['locker', 'Locker', CHECK_ICON]] as const) {
      const te = nav(h('div', 'gar-tab pf-tab', svg(ico), h('span', '', label)), {
        focus: () => { if (this.shopTab !== k) render(k); tryOn(null); },
        act: () => this.ctx.focus(body.querySelector<HTMLElement>('[data-nav]') ?? undefined),
      });
      tabEls.set(k, te);
      tabs.append(te);
    }
    const back = btn('Back', () => { this.ctx.host.sfx('ui_back'); leave(); }, 'big');
    const main = h('div', 'ra-panel shop-main', h('div', 'pf-main-h', tabs, sub), body, h('div', 'shop-foot', back));
    stagger([main], 80);
    stagger([wallet], 200);
    el.append(h('div', 'vig vig-left'), this.ctx.header('Hangar Market', 'Credits Shop'), main, preview, wallet, hints([['move', 'Move'], ['tabs', 'Tab'], ['confirm', 'Buy / Equip'], ['back', 'Back']]));
    const leave = () => {
      this.ctx.setResize(null);
      onBack();
    };
    render(this.shopTab);
    const cycle = (d: number) => {
      const next = this.shopTab === 'stock' ? 'locker' : 'stock';
      void d;
      render(next);
      tryOn(null);
      this.ctx.host.sfx('ui_move');
      this.ctx.focus(tabEls.get(next));
    };
    this.ctx.setScreen(el, {
      back: leave,
      key: (k) => {
        if (k === 'prev' || k === 'next') { cycle(k === 'prev' ? -1 : 1); return true; }
        return false;
      },
      rotate: true,
      initial: body.querySelector<HTMLElement>('[data-nav]') ?? tabEls.get(this.shopTab),
    });
    requestAnimationFrame(() => sendBackdrop());
    this.ctx.setResize(() => sendBackdrop(previewPaint));
  }

  /* ================================================================ build share codes */

  /** Garage "Share Code" modal: copy this build's code or import one. `onApplied` refreshes the garage. */
  openShareCode(onApplied: () => void) {
    const s = this.save;
    const code = encodeBuild(s.loadout, s.paint);
    const el = h('div', 'ra-modal');
    let L: Layer;
    const close = () => {
      this.ctx.popLayer(L);
      this.ctx.host.sfx('ui_back');
    };
    const codeBox = h('div', 'bc-code', code);
    const copy = btn('Copy Code', async () => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(code);
        ok = true;
      } catch {
        const r = document.createRange();
        r.selectNodeContents(codeBox);
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
        try { ok = document.execCommand('copy'); } catch { ok = false; }
      }
      this.ctx.host.sfx('ui_select');
      msg.textContent = ok ? 'Copied to clipboard.' : 'Select the code and copy it manually.';
      msg.className = 'bc-msg ok';
    }, 'primary', SHARE_ICON);
    const input = h('input', 'bc-input');
    input.placeholder = 'Paste a build code (RA-…)';
    input.spellcheck = false;
    input.autocomplete = 'off';
    const msg = h('div', 'bc-msg', 'Share codes include parts and paint. Locked parts are never granted by a code.');
    const doImport = () => {
      const d = decodeBuild(input.value);
      if (!d.ok) {
        msg.textContent = d.error;
        msg.className = 'bc-msg err';
        this.ctx.host.sfx('ui_error');
        input.classList.remove('shake');
        void input.offsetWidth;
        input.classList.add('shake');
        return;
      }
      const r = applyImportedLoadout(s.loadout, d.build.loadout, s.unlocked);
      s.loadout = r.loadout;
      // colors are free; decals/trails apply only if you own a matching cosmetic
      const ip = d.build.paint;
      Object.assign(s.paint, { primary: ip.primary, secondary: ip.secondary, trim: ip.trim, dark: ip.dark, glow: ip.glow });
      s.cosmetics.equipped.paint = null;
      const ownDecal = s.cosmetics.owned.map((id) => COSMETICS[id]).find((c) => c?.kind === 'decal' && c.decal === ip.emblem);
      if (ownDecal) equipCosmetic(s, ownDecal.id);
      if (ip.trail !== undefined) {
        const ownTrail = s.cosmetics.owned.map((id) => COSMETICS[id]).find((c) => c?.kind === 'trail' && c.trail === ip.trail);
        if (ownTrail) equipCosmetic(s, ownTrail.id);
      }
      this.ctx.host.persist();
      onApplied();
      if (r.locked.length) {
        const names = r.locked.map((k) => {
          const p = partOf(k);
          const src = RIVALS.find((rv) => rv.unlocks.includes(k));
          return `${p?.name ?? k}${src ? ` (beat ${src.pilot})` : ''}`;
        });
        msg.replaceChildren(h('b', '', 'Imported with locked parts. '), `Kept your current part for: ${names.join(', ')}.`);
        msg.className = 'bc-msg warn';
        this.ctx.host.sfx('ui_select');
      } else {
        this.ctx.toast('Build imported');
        close();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doImport(); }
      if (e.key === 'Escape') { e.preventDefault(); input.blur(); }
    });
    const inputRow = nav(h('div', 'bc-field', input), { act: () => input.focus(), quiet: true });
    const imp = btn('Import', doImport, '');
    const done = btn('Done', close, '');
    const panel = h('div', 'ra-panel confirm-panel bc-panel',
      h('div', 'confirm-stripe'), h('div', 'confirm-title', 'Build Code'),
      h('div', 'bc-lbl', 'Your build'), h('div', 'bc-row', codeBox, copy),
      h('div', 'bc-lbl', 'Import a build'), h('div', 'bc-row', inputRow, imp),
      msg, h('div', 'confirm-btns', done));
    el.append(panel);
    L = this.ctx.pushLayer(el, { back: close, initial: copy });
  }

  /* ================================================================ settings */

  /** Extra rows for the Options list (aim assist). `slider` is the settings slider factory. */
  assistRows(group: (t: string) => void, slider: (label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, fmt: (v: number) => string) => HTMLElement, st: Settings) {
    group('Assist');
    slider('Aim assist', () => st.aimAssist ?? 1, (v) => (st.aimAssist = v), 0.5, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
  }

  /** Rebindable Controls panel (replaces the static reference list). */
  controlsPanel(st: Settings, apply: () => void): HTMLElement {
    const panel = h('div', 'ra-panel ctl-panel cb-panel');
    const rows = h('div', 'cb-rows ra-scroll');
    const draw = (focusKey?: string) => {
      const b = st.bindings;
      rows.replaceChildren(h('div', 'cb-head', h('span', '', 'Action'), h('span', 'k-col', 'Key 1'), h('span', 'k-col', 'Key 2'), h('span', 'k-col', 'Gamepad')));
      let toFocus: HTMLElement | undefined;
      for (const a of ACTIONS) {
        const cells: HTMLElement[] = [];
        for (let i = 0; i < KEY_SLOTS; i++) {
          const code = b.keys[a][i] ?? '';
          const c = nav(h('div', `cb-cell ${code ? '' : 'empty'}`, h('kbd', '', keyName(code))), { act: () => this.capture(st, apply, a, i, () => draw(`${a}:${i}`)) });
          c.dataset.k = `${a}:${i}`;
          if (focusKey === c.dataset.k) toFocus = c;
          cells.push(c);
        }
        let padCell: HTMLElement;
        if (MOVE_ACTIONS.includes(a)) padCell = h('div', 'cb-cell fixed', h('kbd', '', 'L-Stick'));
        else {
          padCell = nav(h('div', `cb-cell pad ${b.pad[a].length ? '' : 'empty'}`, h('kbd', '', padName(b.pad[a][0]))), { act: () => this.capture(st, apply, a, 'pad', () => draw(`${a}:pad`)) });
          padCell.dataset.k = `${a}:pad`;
          if (focusKey === padCell.dataset.k) toFocus = padCell;
        }
        rows.append(h('div', 'cb-row', h('span', 'cb-l', ACTION_LABEL[a]), ...cells, padCell));
      }
      if (toFocus) this.ctx.focus(toFocus);
    };
    const reset = btn('Reset to Defaults', async () => {
      const ok = await this.ctx.confirmBox('Reset controls?', 'All keyboard, mouse and gamepad bindings go back to the defaults.', 'Reset', 'Cancel');
      if (!ok) return;
      st.bindings = cloneBindings(DEFAULT_BINDINGS);
      apply();
      draw();
      this.ctx.toast('Controls reset');
    }, '');
    draw();
    panel.append(h('div', 'set-panel-h', 'Controls'), h('div', 'cb-note', 'Select a binding, then press a key, mouse button or gamepad button.'), rows, h('div', 'ra-actions cb-acts', reset));
    return panel;
  }

  /** Listen for the next key / mouse button (or gamepad button for 'pad'), resolve conflicts, then save. */
  private capture(st: Settings, apply: () => void, action: Action, slot: number | 'pad', redraw: () => void) {
    const isPad = slot === 'pad';
    const el = h('div', 'ra-modal cb-capture');
    const panel = h('div', 'ra-panel confirm-panel',
      h('div', 'confirm-stripe'),
      h('div', 'ra-kicker', isPad ? 'Gamepad binding' : `Key binding ${Number(slot) + 1}`),
      h('div', 'confirm-title', ACTION_LABEL[action]),
      h('div', 'cb-wait', h('i'), isPad ? 'Press a gamepad button…' : 'Press a key or mouse button…'),
      h('div', 'confirm-text', isPad ? 'Esc to cancel · Back/Select (on the pad) clears' : 'Esc to cancel · Backspace clears this slot'));
    el.append(panel);
    const L = this.ctx.pushLayer(el, {});
    this.ctx.setCapture(true);
    let doneFlag = false;
    let raf = 0;
    const pads = () => {
      const ps = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of ps) if (p && p.connected) return p.buttons.map((b) => b.pressed || b.value > 0.5);
      return [] as boolean[];
    };
    let prev = pads();
    const finish = (v: string | number | null | undefined) => {
      if (doneFlag) return;
      doneFlag = true;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      this.ctx.popLayer(L);
      // let the menu shell's own handlers see this event first, then re-enable navigation
      setTimeout(() => this.ctx.setCapture(false), 60);
      if (v === undefined) {
        this.ctx.host.sfx('ui_back');
        return;
      }
      void this.assign(st, apply, action, slot, v).then(redraw);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.code === 'Escape') return finish(undefined);
      if (isPad) return;
      if (e.code === 'Backspace' || e.code === 'Delete') return finish(null);
      finish(e.code);
    };
    const onMouse = (e: MouseEvent) => {
      if (isPad) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // swallow the click that follows so it doesn't re-open a binding underneath
      const eat = (ev: Event) => { ev.stopImmediatePropagation(); ev.preventDefault(); window.removeEventListener('click', eat, true); };
      window.addEventListener('click', eat, true);
      setTimeout(() => window.removeEventListener('click', eat, true), 600);
      finish(`Mouse${e.button}`);
    };
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const now = pads();
      for (let i = 0; i < now.length; i++) {
        if (now[i] && !prev[i]) {
          if (!isPad) {
            if (i === 1 || i === 8) finish(undefined); // B / Back cancels a keyboard capture
            continue;
          }
          if (i === 8) finish(null);
          else finish(i);
          return;
        }
      }
      prev = now;
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    raf = requestAnimationFrame(poll);
    const timer = setTimeout(() => finish(undefined), 8000);
  }

  private async assign(st: Settings, apply: () => void, action: Action, slot: number | 'pad', v: string | number | null) {
    const b = st.bindings;
    if (slot === 'pad') {
      if (v === null) b.pad[action] = [];
      else {
        const btnIdx = Number(v);
        const other = padConflict(b, btnIdx, action);
        if (other) {
          const ok = await this.ctx.confirmBox(`${padName(btnIdx)} is taken`, `${padName(btnIdx)} is bound to “${ACTION_LABEL[other]}”. Swap the two bindings?`, 'Swap', 'Cancel');
          if (!ok) return;
          b.pad[other] = [...b.pad[action]];
        }
        b.pad[action] = [btnIdx];
      }
    } else {
      const code = v === null ? '' : String(v);
      const old = b.keys[action][slot] ?? '';
      if (code === old) return;
      if (code) {
        const j = b.keys[action].indexOf(code);
        if (j >= 0 && j !== slot) {
          // already on the other slot of this action: swap slots
          b.keys[action][j] = old;
        } else {
          const other = keyConflict(b, code, action);
          if (other) {
            const ok = await this.ctx.confirmBox(`${keyName(code)} is taken`, `${keyName(code)} is bound to “${ACTION_LABEL[other]}”. Swap the two bindings?`, 'Swap', 'Cancel');
            if (!ok) return;
            const k = b.keys[other].indexOf(code);
            b.keys[other][k] = old;
          }
        }
      }
      b.keys[action][slot] = code;
    }
    apply();
    this.ctx.host.sfx('ui_select');
  }
}
