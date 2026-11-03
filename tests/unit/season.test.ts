import { describe, expect, it } from 'vitest';
import {
  K, K_NEW, K_PLACEMENT, PLACEMENT_GAMES, START, carryRating, isPlaced, seasonsBetween, isSeasonId, kFactor, prevSeason, rankChange, rankOf,
  seasonEnds, seasonLabel, seasonOf, seasonRewardIds, softReset,
} from '../../src/net/season';
import { COSMETICS } from '../../src/data/shop';

describe('season ids', () => {
  it('is the UTC calendar month', () => {
    expect(seasonOf(new Date(Date.UTC(2026, 10, 2)))).toBe('2026-11');
    // 23:30 on Oct 31 in UTC-5 is already November in UTC
    expect(seasonOf(new Date('2026-10-31T23:30:00-05:00'))).toBe('2026-11');
    expect(seasonOf(new Date(Date.UTC(2027, 0, 1)))).toBe('2027-01');
  });
  it('steps back across a year and knows when it ends', () => {
    expect(prevSeason('2027-01')).toBe('2026-12');
    expect(prevSeason('2026-11')).toBe('2026-10');
    expect(seasonEnds('2026-12')).toBe(Date.UTC(2027, 0, 1));
    expect(seasonLabel('2026-11')).toBe('Nov 2026');
  });
  it('validates ids', () => {
    expect(isSeasonId('2026-11')).toBe(true);
    expect(isSeasonId('2026-13')).toBe(false);
    expect(isSeasonId('2026-1')).toBe(false);
    expect(isSeasonId("2026-11' OR 1")).toBe(false);
  });
});

describe('soft reset', () => {
  it('pulls ratings halfway back to the start', () => {
    expect(softReset(START)).toBe(START);
    expect(softReset(1600)).toBe(1300);
    expect(softReset(800)).toBe(900);
    expect(softReset(1001)).toBe(1000);
    expect(softReset(999)).toBe(1000);
  });
  it('applies one reset per season that went by', () => {
    expect(seasonsBetween('2026-11', '2027-01')).toBe(2);
    expect(carryRating('2026-10', 1600, '2026-11')).toBe(1300);
    expect(carryRating('2026-09', 1600, '2026-11')).toBe(1150);
    expect(carryRating('2026-11', 1600, '2026-11')).toBe(1600);
    expect(carryRating('2020-01', 1600, '2026-11')).toBe(START);
  });
  it('keeps the order of players', () => {
    const rs = [700, 950, 1000, 1240, 1777];
    const after = rs.map(softReset);
    expect([...after].sort((a, b) => a - b)).toEqual(after);
  });
});

describe('placements and K', () => {
  it('uses the placement K for the first five season games', () => {
    for (let g = 0; g < PLACEMENT_GAMES; g++) expect(kFactor(g, 100)).toBe(K_PLACEMENT);
    expect(kFactor(PLACEMENT_GAMES, 100)).toBe(K);
    expect(kFactor(PLACEMENT_GAMES, 6)).toBe(K_NEW);
    expect(K_PLACEMENT).toBeGreaterThan(K_NEW);
    expect(K_NEW).toBeGreaterThan(K);
  });
  it('hides rank until placed', () => {
    expect(isPlaced(4)).toBe(false);
    expect(isPlaced(5)).toBe(true);
    expect(rankChange(1000, 1030, 3, 4)).toBe('placement');
    expect(rankChange(1000, 1030, 4, 5)).toBe('placed');
  });
});

describe('tiers and divisions', () => {
  it('keeps the old tier boundaries', () => {
    expect(rankOf(899).tierName).toBe('Bronze');
    expect(rankOf(900).tierName).toBe('Silver');
    expect(rankOf(1099).tierName).toBe('Silver');
    expect(rankOf(1100).tierName).toBe('Gold');
    expect(rankOf(1300).tierName).toBe('Platinum');
    expect(rankOf(1500).tierName).toBe('Diamond');
    expect(rankOf(-50).tierName).toBe('Bronze');
  });
  it('splits each band into III / II / I by thirds', () => {
    expect(rankOf(1100).label).toBe('Gold III');
    expect(rankOf(1166).label).toBe('Gold III');
    expect(rankOf(1167).label).toBe('Gold II');
    expect(rankOf(1233).label).toBe('Gold II');
    expect(rankOf(1234).label).toBe('Gold I');
    expect(rankOf(1299).label).toBe('Gold I');
    expect(rankOf(1000).label).toBe('Silver II');
    expect(rankOf(400).label).toBe('Bronze III');
    expect(rankOf(899).label).toBe('Bronze I');
  });
  it('has no divisions in Diamond', () => {
    const d = rankOf(1900);
    expect(d.div).toBe(0);
    expect(d.label).toBe('Diamond');
    expect(d.progress).toBe(1);
  });
  it('steps are monotonic in rating', () => {
    let last = -1;
    for (let r = 500; r <= 1700; r++) {
      const s = rankOf(r).step;
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
    expect(rankOf(1700).step).toBe(12);
  });
  it('reports progress within the division', () => {
    const r = rankOf(1200);
    expect(r.label).toBe('Gold II');
    expect(r.progress).toBeCloseTo(0.5, 1);
  });
  it('detects promotions and demotions across divisions and tiers', () => {
    expect(rankChange(1160, 1175, 10, 11)).toBe('promoted');
    expect(rankChange(1295, 1310, 10, 11)).toBe('promoted');
    expect(rankChange(1305, 1290, 10, 11)).toBe('demoted');
    expect(rankChange(1180, 1190, 10, 11)).toBe('same');
  });
});

describe('season rewards', () => {
  it('has a decal and a paint for every tier', () => {
    for (const t of ['bronze', 'silver', 'gold', 'platinum', 'diamond'] as const) {
      for (const id of seasonRewardIds(t)) {
        expect(COSMETICS[id], id).toBeDefined();
        expect(COSMETICS[id].source).toBe('season');
        expect(COSMETICS[id].price).toBe(0);
      }
    }
  });
});
