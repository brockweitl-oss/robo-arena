/**
 * Ranked seasons: pure math shared by the client and the relay server (server/src/index.ts
 * imports this file), so both sides agree on tiers, divisions, placements and resets.
 *
 * - A season is one calendar month (UTC), id "YYYY-MM".
 * - The first PLACEMENT_GAMES games of a season are placements: bigger K, rank hidden.
 * - A new season soft-resets the rating halfway toward START.
 * - Tiers: Bronze < 900 ≤ Silver < 1100 ≤ Gold < 1300 ≤ Platinum < 1500 ≤ Diamond.
 *   Each tier below Diamond is split into divisions III / II / I by thirds of its band.
 */

export const START = 1000;
export const K = 32;
export const PLACEMENT_GAMES = 5;
/** Placement K: ratings move fast while the season finds your level. */
export const K_PLACEMENT = 64;
/** New players (lifetime) still move faster after placements. */
export const K_NEW = 48;
export const NEW_PLAYER_GAMES = 10;

export type TierId = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
/** [id, name, band min, band max]; Bronze's band floor is notional (divisions only). */
export const TIER_BANDS: [TierId, string, number, number][] = [
  ['bronze', 'Bronze', 700, 900],
  ['silver', 'Silver', 900, 1100],
  ['gold', 'Gold', 1100, 1300],
  ['platinum', 'Platinum', 1300, 1500],
  ['diamond', 'Diamond', 1500, Infinity],
];

export interface Rank {
  tier: TierId;
  tierName: string;
  /** 3 = III (lowest), 2 = II, 1 = I; 0 for Diamond (no divisions). */
  div: 0 | 1 | 2 | 3;
  /** "Gold II", "Diamond". */
  label: string;
  /** Monotonic step index across all tiers and divisions (Bronze III = 0). */
  step: number;
  /** Rating range of this division (Diamond: open above). */
  min: number;
  max: number;
  /** Progress through the division, 0..1 (Diamond: 1). */
  progress: number;
}

const ROMAN = ['', 'I', 'II', 'III'];

export function seasonOf(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function prevSeason(id: string): string {
  const [y, m] = id.split('-').map(Number);
  return m <= 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
/** First moment of the following season (ms since epoch, UTC). */
export function seasonEnds(id: string): number {
  const [y, m] = id.split('-').map(Number);
  return Date.UTC(y, m, 1);
}
export const isSeasonId = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
/** "2026-11" -> "Nov 2026". */
export function seasonLabel(id: string): string {
  const [y, m] = id.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] ?? '?'} ${y}`;
}

/** New season: halfway back toward START (rounded toward START, so it settles there). */
export function softReset(rating: number): number {
  return START + Math.trunc((Math.round(rating) - START) * 0.5);
}

/** Seasons between two ids ("2026-11" -> "2027-01" = 2). */
export function seasonsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Starting rating in `season` for a player whose last played season ended at `rating`: one soft reset per season gone by (capped at 12). */
export function carryRating(lastSeason: string, rating: number, season: string): number {
  let r = rating;
  for (let n = Math.min(12, seasonsBetween(lastSeason, season)); n > 0; n--) r = softReset(r);
  return r;
}

/** K for a player with `seasonGames` played this season and `lifetimeGames` overall (before this game). */
export function kFactor(seasonGames: number, lifetimeGames: number): number {
  if (seasonGames < PLACEMENT_GAMES) return K_PLACEMENT;
  return lifetimeGames < NEW_PLAYER_GAMES ? K_NEW : K;
}

export const isPlaced = (seasonGames: number) => seasonGames >= PLACEMENT_GAMES;

export function rankOf(rating: number): Rank {
  const r = Math.round(rating);
  let ti = TIER_BANDS.length - 1;
  while (ti > 0 && r < TIER_BANDS[ti][2]) ti--;
  const [tier, tierName, lo, hi] = TIER_BANDS[ti];
  if (tier === 'diamond') return { tier, tierName, div: 0, label: tierName, step: ti * 3, min: lo, max: Infinity, progress: 1 };
  const third = (hi - lo) / 3;
  // below the notional Bronze floor everything is Bronze III
  const idx = Math.max(0, Math.min(2, Math.floor((r - lo) / third)));
  const div = (3 - idx) as 1 | 2 | 3;
  const min = lo + third * idx, max = lo + third * (idx + 1);
  const progress = Math.max(0, Math.min(1, (r - min) / (max - min)));
  return { tier, tierName, div, label: `${tierName} ${ROMAN[div]}`, step: ti * 3 + idx, min, max, progress };
}

export const tierName = (rating: number) => rankOf(rating).tierName;

export type RankChange = 'promoted' | 'demoted' | 'placed' | 'placement' | 'same';

/** What happened to a player's visible rank in one rated game. */
export function rankChange(before: number, after: number, gamesBefore: number, gamesAfter: number): RankChange {
  if (!isPlaced(gamesAfter)) return 'placement';
  if (!isPlaced(gamesBefore)) return 'placed';
  const a = rankOf(before).step, b = rankOf(after).step;
  return b > a ? 'promoted' : b < a ? 'demoted' : 'same';
}

/** Cosmetic ids granted for the highest tier reached in a finished season (see data/shop.ts). */
export const seasonRewardIds = (tier: TierId): string[] => [`season:${tier}:decal`, `season:${tier}:paint`];
