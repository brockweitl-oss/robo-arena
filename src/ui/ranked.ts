import './ranked.css';
import { PLACEMENT_GAMES, isPlaced, rankChange, rankOf, type RankChange } from '../net/season';

/**
 * Ranked UI pieces: the season rank badge and the post-match rank-up panel.
 * Badge markup is a stable hook for the real badge art (issue #60):
 *   <span class="rank-badge tier-gold div-2"><i class="rank-badge-icon"></i><b>Gold II</b></span>
 *   <span class="rank-badge placement"> … Placement 2/5</span>
 */

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// placeholder shield; Codex replaces it with per-tier art
const SHIELD = '<svg viewBox="0 0 16 18" aria-hidden="true"><path d="M8 1 15 4v5c0 4-3 7-7 8C4 16 1 13 1 9V4z"/></svg>';

/**
 * Season rank badge. `games` is this season's game count: under PLACEMENT_GAMES shows the
 * placement progress instead of a rank. Unknown games (old server) shows the rank.
 */
export function rankBadge(rating: number, games?: number, opts: { compact?: boolean } = {}): HTMLElement {
  const b = el('span', 'rank-badge');
  const icon = el('i', 'rank-badge-icon');
  icon.innerHTML = SHIELD;
  if (games !== undefined && !isPlaced(games)) {
    b.classList.add('placement');
    b.append(icon, el('b', '', opts.compact ? `P ${games}/${PLACEMENT_GAMES}` : `Placement ${games}/${PLACEMENT_GAMES}`));
    b.title = `Placement match ${games} of ${PLACEMENT_GAMES}`;
    return b;
  }
  const r = rankOf(rating);
  b.classList.add(`tier-${r.tier}`, `div-${r.div}`);
  b.append(icon, el('b', '', r.label));
  b.title = `${r.label} · ${Math.round(rating)}`;
  return b;
}

export interface RankResult {
  before: number;
  after: number;
  /** Season games before/after this match (undefined from an older server: treated as placed). */
  gamesBefore?: number;
  gamesAfter?: number;
  forfeit?: boolean;
}

export function rankResultChange(r: RankResult): RankChange {
  const ga = r.gamesAfter ?? 99, gb = r.gamesBefore ?? (r.gamesAfter !== undefined ? r.gamesAfter - 1 : 99);
  return rankChange(r.before, r.after, gb, ga);
}

/**
 * Post-match ranked panel: rating delta, a bar animating through the division and a banner
 * for promotions, demotions and finished placements. Pure DOM + CSS; no game state.
 */
export function rankResultPanel(r: RankResult): HTMLElement {
  const change = rankResultChange(r);
  const d = Math.round(r.after - r.before);
  const from = rankOf(r.before), to = rankOf(r.after);
  const root = el('div', `rank-result rr-${change}`);
  root.dataset.change = change;

  const banner = el('div', 'rr-banner');
  if (change === 'promoted') banner.textContent = `PROMOTED → ${to.label}`;
  else if (change === 'demoted') banner.textContent = `Demoted → ${to.label}`;
  else if (change === 'placed') banner.textContent = `Placement complete: ${to.label}`;
  else if (change === 'placement') banner.textContent = `Placement ${r.gamesAfter}/${PLACEMENT_GAMES}`;
  else banner.textContent = to.label;

  const delta = el('div', `rr-delta ${d >= 0 ? 'up' : 'down'}`, `${d >= 0 ? '+' : ''}${d}`);
  const rating = el('div', 'rr-rating', change === 'placement' ? 'Rank revealed after placements' : `Rating ${Math.round(r.after)}`);
  const head = el('div', 'rr-head');
  head.append(change === 'placement' ? rankBadge(r.after, r.gamesAfter) : rankBadge(r.after), delta, rating);

  // progress bar within the division; promotions fill up then roll over into the new division
  const bar = el('div', 'rr-bar');
  const fill = el('i', 'rr-fill');
  const lbl = el('div', 'rr-bar-lbl');
  bar.append(fill);
  const showDivision = change !== 'placement';
  const setFill = (k: number) => fill.style.setProperty('--w', String(Math.max(0, Math.min(1, k))));
  const nextLabel = to.div === 0 ? '' : to.div === 1 ? (to.tier === 'platinum' ? 'Diamond' : 'next tier') : 'next division';
  lbl.textContent = showDivision ? (to.div === 0 ? 'Top tier' : `${Math.max(0, Math.ceil(to.max - r.after))} to ${nextLabel}`) : '';
  if (showDivision) {
    const startK = change === 'placed' ? 0 : from.progress;
    setFill(startK);
    const steps: [number, () => void][] = [];
    if (change === 'promoted') steps.push([350, () => setFill(1)], [900, () => { fill.classList.add('roll'); setFill(0); }], [950, () => { fill.classList.remove('roll'); setFill(to.progress); }]);
    else if (change === 'demoted') steps.push([350, () => setFill(0)], [900, () => { fill.classList.add('roll'); setFill(1); }], [950, () => { fill.classList.remove('roll'); setFill(to.progress); }]);
    else steps.push([350, () => setFill(to.progress)]);
    for (const [t, f] of steps) setTimeout(f, t);
  } else {
    // placements: one pip per game
    bar.classList.add('rr-pips');
    for (let i = 1; i <= PLACEMENT_GAMES; i++) bar.append(el('b', i <= (r.gamesAfter ?? 0) ? 'on' : ''));
  }

  root.append(banner, head, bar, lbl);
  if (r.forfeit) root.append(el('div', 'rr-note', 'Opponent left: counted as your win.'));
  return root;
}
