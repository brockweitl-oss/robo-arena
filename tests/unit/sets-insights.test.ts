import { describe, it, expect } from 'vitest';
import { defaultSave, migrateSave } from '../../src/core/save';
import { DEFAULT_LOADOUT, STARTER_PARTS, type Loadout } from '../../src/data/parts';
import { RIVALS } from '../../src/data/characters';
import { NEW_PILOT_PARTS, STAGED_UNLOCKS, grantStaged, hasPlayed, wantsGuide } from '../../src/game/onboarding';
import { matchInsights, statComparison, gunAccuracy } from '../../src/game/insights';
import { newSet, recordRound, setWinner, applyPick, aiCounterPick, slotsChanged, parsePickMsg, isValidPick } from '../../src/game/sets';
import { Guide, GUIDE_STEPS } from '../../src/game/guide';
import type { MatchResult, MatchStats } from '../../src/game/types';

const stats = (o: Partial<MatchStats> = {}): MatchStats => ({ damageDealt: 400, hits: 10, knockdowns: 0, shots: 20, dodges: 2, ...o });
function result(o: Partial<MatchResult> = {}, p: Partial<MatchStats> = {}, r: Partial<MatchStats> = {}): MatchResult {
  return {
    config: { mode: 'free', playerLoadout: { ...DEFAULT_LOADOUT }, rivalId: 'dex', arenaId: 'foundry' },
    outcome: 'lose', finish: 'ko', time: 70, playerHp: 0, playerMaxHp: 1000, rivalHp: 500, rivalMaxHp: 1000,
    player: stats(p), rival: stats(r), ...o,
  };
}

describe('first-run save migration', () => {
  it('new saves start with the curated kit', () => {
    const s = defaultSave();
    expect(s.unlocked.sort()).toEqual([...NEW_PILOT_PARTS].sort());
    expect(s.firstRun).toEqual({ staged: true, guideDone: false });
    expect(wantsGuide(s)).toBe(true);
    // the default loadout only uses curated parts
    for (const [slot, id] of Object.entries(s.loadout)) expect(s.unlocked).toContain(`${slot}:${id}`);
  });

  it('a legacy save that has played keeps every part (and the full starter set)', () => {
    const legacy = {
      version: 2, unlocked: ['gun:pulse', 'gun:scatter', 'legs:hopper', 'skill:frost'], ladder: 1, beaten: ['dex'],
      loadout: { ...DEFAULT_LOADOUT, skill: 'frost', gun: 'scatter' }, stats: { matches: 3 }, totals: { wins: 1, losses: 2, knockdowns: 0 },
    };
    const s = migrateSave(legacy);
    expect(s.firstRun).toEqual({ staged: false, guideDone: true });
    for (const k of [...legacy.unlocked, ...STARTER_PARTS]) expect(s.unlocked).toContain(k);
    expect(s.loadout.skill).toBe('frost');
    expect(s.loadout.gun).toBe('scatter');
    expect(wantsGuide(s)).toBe(false);
  });

  it('a legacy save with only losses still counts as played', () => {
    const s = migrateSave({ unlocked: [...STARTER_PARTS], totals: { wins: 0, losses: 1 } });
    expect(s.firstRun.staged).toBe(false);
    for (const k of STARTER_PARTS) expect(s.unlocked).toContain(k);
  });

  it('a legacy save that never played is re-curated', () => {
    const s = migrateSave({ unlocked: [...STARTER_PARTS], loadout: { ...DEFAULT_LOADOUT, skill: 'blink' } });
    expect(s.firstRun).toEqual({ staged: true, guideDone: false });
    expect(s.unlocked.sort()).toEqual([...NEW_PILOT_PARTS].sort());
    expect(s.loadout.skill).toBe(DEFAULT_LOADOUT.skill);
  });

  it('a staged save never loses parts across a JSON round trip, and keeps staged rewards it earned', () => {
    const s = defaultSave();
    s.beaten.push('dex');
    s.stats.matches = 1;
    expect(grantStaged(s)).toEqual([...STAGED_UNLOCKS[0]]);
    expect(grantStaged(s)).toEqual([]);
    s.unlocked.push('gun:scatter');
    const back = migrateSave(JSON.parse(JSON.stringify(s)));
    expect(back.firstRun.staged).toBe(true);
    for (const k of s.unlocked) expect(back.unlocked).toContain(k);
    expect(back.unlocked).not.toContain('skill:blink');
  });

  it('migration backfills staged parts for ladder wins already on record', () => {
    const s = migrateSave({ firstRun: { staged: true, guideDone: true }, unlocked: [...NEW_PILOT_PARTS], beaten: [RIVALS[0].id, RIVALS[1].id], stats: { matches: 2 } });
    for (const k of STAGED_UNLOCKS.flat()) expect(s.unlocked).toContain(k);
  });

  it('staged unlocks come in pairs and cover the legacy starter set', () => {
    for (const st of STAGED_UNLOCKS) expect(st).toHaveLength(2);
    expect([...NEW_PILOT_PARTS, ...STAGED_UNLOCKS.flat()].sort()).toEqual([...STARTER_PARTS].sort());
  });

  it('hasPlayed reads legacy fields defensively', () => {
    expect(hasPlayed(null)).toBe(false);
    expect(hasPlayed({ stats: { matches: 'x' } })).toBe(false);
    expect(hasPlayed({ survivalBest: 2 })).toBe(true);
  });
});

describe('post-match insights', () => {
  it('flags low gun accuracy with gun-specific advice', () => {
    const res = result({}, { gunProjectiles: 40, gunHits: 4 });
    res.config.playerLoadout = { ...DEFAULT_LOADOUT, gun: 'rail' };
    const ins = matchInsights(res);
    expect(ins[0].id).toBe('accuracy');
    expect(ins[0].title).toContain('10%');
    expect(ins[0].text).toMatch(/Rail Lance/);
  });

  it('flags being parried and bomb damage, ranked, at most 3', () => {
    const res = result({}, { gunProjectiles: 30, gunHits: 3, podsUsed: 0, bombsUsed: 0 }, { parries: 4, damageBy: { bomb: 600, gun: 200 } });
    const ins = matchInsights(res);
    expect(ins.length).toBe(3);
    const ids = ins.map((i) => i.id);
    expect(ids).toContain('parried');
    expect(ids).toContain('taken-bomb');
    expect(ins.find((i) => i.id === 'taken-bomb')!.text).toMatch(/landing ring/);
  });

  it('notices an unused pod and a missed combo', () => {
    const ins = matchInsights(result({}, { podsUsed: 0, bombsUsed: 2, primes: 3, combos: 0 }), undefined, 5);
    expect(ins.map((i) => i.id)).toEqual(expect.arrayContaining(['no-pod', 'combo']));
  });

  it('is deterministic and always gives at least one tip', () => {
    const res = result({ outcome: 'win' });
    expect(matchInsights(res)).toEqual(matchInsights(res));
    expect(matchInsights(res).length).toBeGreaterThan(0);
  });

  it('uses optional heat / objective stats when present', () => {
    const p = { overheats: 3 } as Partial<MatchStats>;
    expect(matchInsights(result({}, p), undefined, 5).map((i) => i.id)).toContain('heat');
  });

  it('builds the you-vs-them comparison', () => {
    const rows = statComparison(result({}, { gunProjectiles: 10, gunHits: 5, parries: 2, combos: 1 }, { gunProjectiles: 4, gunHits: 1, knockdowns: 2 }));
    expect(rows.map((r) => r.label)).toEqual(['Damage', 'Accuracy', 'Parries', 'Combos', 'Dodges', 'Knockdowns']);
    expect(rows[1]).toMatchObject({ you: 50, them: 25, unit: '%' });
    expect(rows[5]).toMatchObject({ you: 0, them: 2 });
    expect(gunAccuracy(stats(), 5)).toBeNull();
  });
});

describe('counter-pick sets', () => {
  const A: Loadout = { ...DEFAULT_LOADOUT };
  const B: Loadout = { ...RIVALS[1].loadout };

  it('scores first to 2; draws do not count', () => {
    let s = newSet(A, B);
    s = recordRound(s, 'win');
    expect(setWinner(s)).toBe(-1);
    s = recordRound(s, 'draw');
    expect(s.score).toEqual([1, 0]);
    s = recordRound(s, 'lose');
    s = recordRound(s, 'lose');
    expect(setWinner(s)).toBe(1);
    expect(s.round).toBe(5);
  });

  it('a pick changes exactly one slot; invalid picks keep the build', () => {
    const after = applyPick(A, { slot: 'gun', id: 'rail' });
    expect(slotsChanged(A, after)).toEqual(['gun']);
    expect(applyPick(A, null)).toEqual(A);
    expect(applyPick(A, { slot: 'gun', id: 'nope' } as never)).toEqual(A);
    expect(isValidPick({ slot: 'hat', id: 'x' })).toBe(false);
  });

  it('AI counters the opponent\'s best damage source deterministically', () => {
    const bombs = aiCounterPick(A, stats({ damageBy: { bomb: 500, gun: 100 } }));
    expect(bombs).toEqual({ slot: 'legs', id: 'sprint' });
    const charge = aiCounterPick(A, stats({ damageBy: { charge: 300, gun: 100 } }));
    expect(charge).toEqual({ slot: 'gun', id: 'scatter' });
    // already countered: falls to the next option
    expect(aiCounterPick({ ...A, pod: 'interceptor' }, stats({ damageBy: { gun: 300 } }))).toEqual({ slot: 'legs', id: 'sprint' });
    // hazards are not a build problem
    expect(aiCounterPick(A, stats({ damageDealt: 0, damageBy: { hazard: 300 } }))).toBeNull();
    expect(aiCounterPick({ ...A, gun: 'rail' }, stats({ damageBy: { pod: 1 } }), (p) => p.slot !== 'pod')).toEqual({ slot: 'gun', id: 'pulse' });
    expect(aiCounterPick(A, stats({ damageBy: { pod: 1 } }), (p) => p.slot !== 'pod')).toBeNull();
  });

  it('parses only well-formed pick messages', () => {
    expect(parsePickMsg({ t: 'cp', round: 1, step: 1, pick: { slot: 'gun', id: 'rail' } })).toEqual({ t: 'cp', round: 1, step: 1, pick: { slot: 'gun', id: 'rail' } });
    expect(parsePickMsg({ t: 'cp', round: 1, step: 2, pick: { slot: 'gun', id: 'bad' } })!.pick).toBeNull();
    expect(parsePickMsg({ t: 'cp', round: 1, step: 3 })).toBeNull();
    expect(parsePickMsg({ t: 'i', n: 1 })).toBeNull();
  });
});

describe('guided first match', () => {
  it('advances on actions, holds the rival until the parry lesson, and times out', () => {
    const g = new Guide();
    expect(g.step!.id).toBe('move');
    expect(g.rivalArmed).toBe(false);
    for (let i = 0; i < 60; i++) g.tick(1 / 60, 0.1);
    expect(g.step!.id).toBe('dash');
    g.onEvent('fire'); // wrong action: no advance
    expect(g.step!.id).toBe('dash');
    g.onEvent('dash');
    g.onEvent('fire');
    g.onEvent('bomb');
    g.onEvent('chargeStart');
    expect(g.step!.id).toBe('parry');
    expect(g.rivalArmed).toBe(true);
    // never parrying still moves on
    for (let t = 0; t < 40; t += 1 / 60) g.tick(1 / 60, 0);
    expect(g.finished).toBe(true);
    expect(g.done).toEqual(['move', 'dash', 'fire', 'bomb', 'charge']);
    expect(GUIDE_STEPS.length).toBe(7);
  });
});
