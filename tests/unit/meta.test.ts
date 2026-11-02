import { describe, it, expect } from 'vitest';
import { defaultSave, migrateSave } from '../../src/core/save';
import { DEFAULT_BINDINGS, normalizeBindings, keyConflict } from '../../src/core/input';
import { ALL_PARTS, DEFAULT_LOADOUT, STARTER_PARTS, type Slot } from '../../src/data/parts';
import { PLAYER_PAINT } from '../../src/data/characters';
import { COSMETICS, dailyStock, buyCosmetic, isPartKey, STOCK_SIZE } from '../../src/data/shop';
import { encodeBuild, decodeBuild, applyImportedLoadout } from '../../src/data/buildcode';
import {
  matchCredits, matchXp, levelForXp, MASTERY_XP, onMatchEnd, rollChallenges, ensureChallenges, weekKey,
  challengeProgress, pilotLevel, equipCosmetic, unequipCosmetic, CREDITS,
} from '../../src/game/progression';
import { ACHIEVEMENTS, checkAchievements } from '../../src/game/achievements';
import type { MatchResult, MatchStats } from '../../src/game/types';

const stats = (o: Partial<MatchStats> = {}): MatchStats => ({ damageDealt: 800, hits: 12, knockdowns: 1, shots: 40, dodges: 0, ...o });
function result(o: Partial<MatchResult> = {}, p: Partial<MatchStats> = {}): MatchResult {
  return {
    config: { mode: 'ladder', playerLoadout: { ...DEFAULT_LOADOUT }, rivalId: 'dex', arenaId: 'foundry' },
    outcome: 'win', finish: 'time', time: 80, playerHp: 500, playerMaxHp: 1000, rivalHp: 100, rivalMaxHp: 1000,
    player: stats(p), rival: stats(), ...o,
  };
}
const NOV1 = new Date(2026, 10, 1, 12, 0, 0); // a Sunday

describe('credits', () => {
  it('pays win 120 / loss 40 in ladder', () => {
    expect(matchCredits(result()).total).toBe(120);
    expect(matchCredits(result({ outcome: 'lose' })).total).toBe(40);
  });
  it('adds KO, dodge and parry bonuses with caps', () => {
    const r = result({ finish: 'ko' }, { perfectDodges: 4, parries: 2 });
    expect(matchCredits(r).total).toBe(120 + CREDITS.ko + 4 * CREDITS.perDodge + 2 * CREDITS.perParry);
    const capped = result({}, { perfectDodges: 100, parries: 100 });
    expect(matchCredits(capped).total).toBe(120 + CREDITS.dodgeCap + CREDITS.parryCap);
  });
  it('falls back to dodges when perfectDodges is missing', () => {
    expect(matchCredits(result({}, { dodges: 2 })).total).toBe(120 + 2 * CREDITS.perDodge);
  });
  it('scales free battle by 0.6 and pays nothing for quits', () => {
    const r = result({ config: { mode: 'free', playerLoadout: { ...DEFAULT_LOADOUT }, rivalId: 'dex', arenaId: 'foundry' } });
    expect(matchCredits(r).total).toBe(72);
    expect(matchCredits(result({ quit: true })).total).toBe(0);
  });
});

describe('mastery', () => {
  it('levels 1..5 from cumulative xp', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(MASTERY_XP[1] - 1)).toBe(1);
    expect(levelForXp(MASTERY_XP[1])).toBe(2);
    expect(levelForXp(MASTERY_XP[4])).toBe(5);
    expect(levelForXp(1e9)).toBe(5);
  });
  it('gives every equipped part xp and grants cosmetic (not stat) rewards on level-up', () => {
    const s = defaultSave();
    s.mastery['gun:pulse'] = MASTERY_XP[1] - 10;
    const rw = onMatchEnd(s, result(), NOV1);
    expect(rw.mastery).toHaveLength(6);
    expect(rw.mastery.every((m) => m.xp === matchXp(result()))).toBe(true);
    const up = rw.levelUps.find((l) => l.part === 'gun:pulse');
    expect(up?.level).toBe(2);
    expect(s.cosmetics.owned).toContain(up!.cosmetic);
    expect(COSMETICS[up!.cosmetic!].kind).toBe('paint');
    // a level-up must not touch the loadout / parts
    expect(s.unlocked.sort()).toEqual([...STARTER_PARTS].sort());
    expect(pilotLevel(s)).toBeGreaterThan(0);
  });
  it('credits the save and records stats', () => {
    const s = defaultSave();
    const rw = onMatchEnd(s, result({ finish: 'ko' }), NOV1);
    expect(s.credits).toBe(rw.credits);
    expect(rw.credits).toBeGreaterThanOrEqual(150);
    expect(s.stats.matches).toBe(1);
    expect(s.stats.koWins).toBe(1);
  });
});

describe('challenges', () => {
  it('generates the same set for a fixed date', () => {
    const a = rollChallenges('2026-11-01', false, STARTER_PARTS);
    const b = rollChallenges('2026-11-01', false, STARTER_PARTS);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((c) => c.tpl)).size).toBe(3);
    const w = rollChallenges(weekKey(NOV1), true, STARTER_PARTS);
    expect(w).toHaveLength(2);
    expect(w.every((c) => c.weekly)).toBe(true);
    expect(weekKey(NOV1)).toBe('2026-10-26');
    // a different day gives a different set (for these known dates)
    const days = ['2026-11-02', '2026-11-03', '2026-11-04'].map((d) => JSON.stringify(rollChallenges(d, false, STARTER_PARTS).map((c) => c.tpl)));
    expect(new Set([JSON.stringify(a.map((c) => c.tpl)), ...days]).size).toBeGreaterThan(1);
  });
  it('only names owned parts', () => {
    for (let d = 1; d <= 28; d++) {
      for (const c of rollChallenges(`2026-02-${String(d).padStart(2, '0')}`, false, STARTER_PARTS)) {
        if (c.tpl === 'win_part') expect(STARTER_PARTS).toContain(c.param);
      }
    }
  });
  it('tracks progress from match stats and handles missing fields', () => {
    const def = { id: 'x', tpl: 'deflect' as const, text: '', goal: 5, reward: 100, weekly: false };
    expect(challengeProgress(def, 1, result({}, { deflects: 3 }))).toBe(4);
    expect(challengeProgress(def, 1, result())).toBe(1);
    const nopod = { ...def, tpl: 'win_nopod' as const, goal: 1 };
    expect(challengeProgress(nopod, 0, result())).toBe(0); // podsUsed unknown → no progress
    expect(challengeProgress(nopod, 0, result({}, { podsUsed: 0 }))).toBe(1);
    const kd = { ...def, tpl: 'kd_match' as const, goal: 3 };
    expect(challengeProgress(kd, 1, result({}, { knockdowns: 2 }))).toBe(2);
    expect(challengeProgress(kd, 2, result({}, { knockdowns: 1 }))).toBe(2);
  });
  it('pays out once on completion and re-rolls on a new day', () => {
    const s = defaultSave();
    ensureChallenges(s, NOV1);
    s.challenges.daily = [{ id: 'd:test:0:wins', tpl: 'wins', text: 'Win 1', goal: 1, reward: 100, weekly: false }];
    const rw = onMatchEnd(s, result(), NOV1);
    expect(rw.challenges[0].completed).toBe(true);
    expect(rw.lines.some((l) => l.label === 'Daily challenge' && l.amount === 100)).toBe(true);
    const again = onMatchEnd(s, result(), NOV1);
    expect(again.challenges.find((c) => c.def.id === 'd:test:0:wins')).toBeUndefined();
    ensureChallenges(s, new Date(2026, 10, 2, 9));
    expect(s.challenges.seedDate).toBe('2026-11-02');
    expect(s.challenges.daily.some((c) => c.id === 'd:test:0:wins')).toBe(false);
  });
});

describe('build codes', () => {
  const lo = { gun: Object.keys(ALL_PARTS.gun).at(-1)!, bomb: 'cluster', pod: Object.keys(ALL_PARTS.pod).at(-1)!, body: 'wisp', legs: Object.keys(ALL_PARTS.legs).at(-1)!, skill: 'frost' };
  const paint = { ...PLAYER_PAINT, primary: 0x123456, emblem: 'ACE', trail: 0xabcdef };
  it('round-trips loadout + paint', () => {
    const code = encodeBuild(lo, paint);
    expect(code.startsWith('RA-')).toBe(true);
    expect(code.length).toBeLessThan(48);
    expect(/^RA-[A-Za-z0-9_-]+$/.test(code)).toBe(true);
    const d = decodeBuild(code);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.build.loadout).toEqual(lo);
      expect(d.build.paint).toEqual(paint);
    }
    const plain = decodeBuild(encodeBuild(DEFAULT_LOADOUT, PLAYER_PAINT));
    expect(plain.ok && plain.build.paint.trail === undefined).toBe(true);
  });
  it('detects every single-character corruption', () => {
    const code = encodeBuild(lo, paint);
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let i = 3; i < code.length; i++) {
      for (const ch of ['A', 'z', '0', '_']) {
        if (code[i] === ch) continue;
        const bad = code.slice(0, i) + ch + code.slice(i + 1);
        expect(decodeBuild(bad).ok, `pos ${i} → ${ch}`).toBe(false);
      }
    }
    expect(decodeBuild(code.slice(0, -1)).ok).toBe(false);
    expect(decodeBuild(code + 'A').ok).toBe(false);
    expect(decodeBuild('hello').ok).toBe(false);
    expect(decodeBuild('RA-!!!!').ok).toBe(false);
    void alpha;
  });
  it('keeps the current part for locked slots on import', () => {
    const r = applyImportedLoadout(DEFAULT_LOADOUT, lo, [...STARTER_PARTS, 'bomb:cluster']);
    expect(r.loadout.bomb).toBe('cluster');
    expect(r.loadout.gun).toBe(DEFAULT_LOADOUT.gun);
    expect(r.locked).toContain(`gun:${lo.gun}`);
    expect(r.locked).toContain('body:wisp');
    expect(r.locked).not.toContain('bomb:cluster');
  });
});

describe('shop', () => {
  it('stocks 6 cosmetics, deterministic per day, never parts', () => {
    for (let d = 1; d <= 60; d++) {
      const day = new Date(2026, 0, d);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      const stock = dailyStock(key);
      expect(stock).toHaveLength(STOCK_SIZE);
      expect(new Set(stock).size).toBe(STOCK_SIZE);
      expect(dailyStock(key)).toEqual(stock);
      for (const id of stock) {
        expect(isPartKey(id)).toBe(false);
        const c = COSMETICS[id];
        expect(c.source).toBe('shop');
        expect(['paint', 'decal', 'pose', 'trail']).toContain(c.kind);
        expect(c.price).toBeGreaterThanOrEqual(150);
        expect(c.price).toBeLessThanOrEqual(600);
      }
    }
    // no cosmetic id collides with a part key at all
    for (const slot of Object.keys(ALL_PARTS) as Slot[]) for (const id of Object.keys(ALL_PARTS[slot])) expect(COSMETICS[`${slot}:${id}`]).toBeUndefined();
  });
  it('buys only stocked, unowned, affordable items and refuses parts', () => {
    const day = '2026-11-01';
    const id = dailyStock(day)[0];
    const w = { credits: 10, cosmetics: { owned: [] as string[] } };
    expect(buyCosmetic(w, id, day)).toEqual({ ok: false, reason: 'credits' });
    w.credits = 1000;
    expect(buyCosmetic(w, id, day).ok).toBe(true);
    expect(w.credits).toBe(1000 - COSMETICS[id].price);
    expect(buyCosmetic(w, id, day)).toEqual({ ok: false, reason: 'owned' });
    expect(buyCosmetic(w, 'gun:rail', day)).toEqual({ ok: false, reason: 'not-for-sale' });
    const notToday = Object.values(COSMETICS).find((c) => c.source === 'shop' && !dailyStock(day).includes(c.id))!;
    expect(buyCosmetic(w, notToday.id, day)).toEqual({ ok: false, reason: 'not-in-stock' });
  });
  it('equips cosmetics onto the paint and reverts', () => {
    const s = defaultSave();
    s.cosmetics.owned.push('paint:glacier', 'decal:ace');
    expect(equipCosmetic(s, 'paint:glacier')).toBe(true);
    expect(s.paint.primary).toBe(COSMETICS['paint:glacier'].paint!.primary);
    equipCosmetic(s, 'decal:ace');
    expect(s.paint.emblem).toBe('ACE');
    expect(equipCosmetic(s, 'paint:noir')).toBe(false); // not owned
    unequipCosmetic(s, 'paint');
    expect(s.paint.primary).toBe(PLAYER_PAINT.primary);
  });
});

describe('save migration', () => {
  it('upgrades a v1 save without losing progress', () => {
    const v1 = {
      version: 1,
      unlocked: ['gun:pulse', 'gun:scatter', 'legs:hopper'],
      loadout: { gun: 'scatter', bomb: 'mortar', pod: 'seeker', body: 'striker', legs: 'hopper' },
      ladder: 2,
      beaten: ['dex', 'mira'],
      settings: { master: 0.5, sfx: 0.9, music: 0.2, sensitivity: 1.4, invertY: true, cameraShake: false, quality: 'high', damageNumbers: false },
      totals: { wins: 7, losses: 3, knockdowns: 12 },
    };
    const s = migrateSave(v1);
    expect(s.version).toBe(2);
    expect(s.ladder).toBe(2);
    expect(s.beaten).toEqual(['dex', 'mira']);
    expect(s.loadout.gun).toBe('scatter');
    expect(s.loadout.legs).toBe('hopper');
    expect(s.settings.master).toBe(0.5);
    expect(s.settings.invertY).toBe(true);
    expect(s.settings.aimAssist).toBe(1);
    expect(s.settings.bindings).toEqual(DEFAULT_BINDINGS);
    expect(s.totals.wins).toBe(7);
    expect(s.credits).toBe(0);
    expect(s.mastery).toEqual({});
    expect(s.cosmetics.owned).toEqual([]);
    expect(s.paint).toEqual(PLAYER_PAINT);
    expect(s.achievements).toEqual({});
    expect(s.stats.matches).toBe(0);
    for (const p of STARTER_PARTS) expect(s.unlocked).toContain(p);
  });
  it('repairs junk and locked loadouts', () => {
    const s = migrateSave({ loadout: { gun: 'rail' }, credits: -50, settings: { aimAssist: 9, bindings: { keys: { jump: ['KeyX'] } } }, mastery: { 'gun:pulse': 'lots' } });
    expect(s.loadout.gun).toBe('pulse');
    expect(s.credits).toBe(0);
    expect(s.settings.aimAssist).toBe(1);
    expect(s.settings.bindings.keys.jump).toEqual(['KeyX', '']);
    expect(s.settings.bindings.keys.dash).toEqual(DEFAULT_BINDINGS.keys.dash);
    expect(s.mastery).toEqual({});
    expect(migrateSave(null)).toEqual(defaultSave());
    expect(migrateSave('garbage').version).toBe(2);
  });
  it('round-trips a v2 save through JSON', () => {
    const s = defaultSave();
    onMatchEnd(s, result({ finish: 'ko' }), NOV1);
    s.cosmetics.owned.push('decal:ace');
    equipCosmetic(s, 'decal:ace');
    expect(migrateSave(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe('bindings', () => {
  it('normalizes and finds conflicts', () => {
    const b = normalizeBindings(undefined);
    expect(keyConflict(b, 'Space')).toBe('jump');
    expect(keyConflict(b, 'Space', 'jump')).toBeNull();
    expect(keyConflict(b, 'KeyZ')).toBeNull();
  });
});

describe('achievements', () => {
  it('has ~20 unique achievements and unlocks first win + flawless with cosmetic rewards', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) for (const c of a.rewards ?? []) expect(COSMETICS[c]).toBeDefined();
    const s = defaultSave();
    const rw = onMatchEnd(s, result({ playerHp: 950 }), NOV1);
    expect(rw.achievements).toContain('first_win');
    expect(rw.achievements).toContain('flawless');
    expect(s.cosmetics.owned).toContain('trail:flawless');
    expect(checkAchievements(s, null).unlocked).toEqual([]);
  });
});
