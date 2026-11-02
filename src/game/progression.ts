/**
 * Meta progression: credits, part mastery, daily/weekly challenges.
 *
 * Fairness rule (owner priority): progression NEVER changes stats. Credits buy cosmetics
 * only, mastery levels unlock paint schemes / decals / trails only, and parts still come
 * only from ladder / Rival+ unlocks.
 *
 * Call `onMatchEnd(save, result)` once per finished match (not on quit), AFTER the
 * ladder/totals bookkeeping, then persist the save.
 */
import { ALL_PARTS, type Loadout, type Slot } from '../data/parts';
import { PLAYER_PAINT } from '../data/characters';
import { ARENA_IDS, ARENA_INFO, type ArenaId } from '../arena/index';
import { COSMETICS, dateKey, masteryCosmeticId, seededRng } from '../data/shop';
import type { SaveData } from '../core/save';
import type { MatchResult, MatchStats } from './types';
import { checkAchievements } from './achievements';

/* ------------------------------------------------------------------ credits */

/** Reward multiplier per mode. Unknown modes fall back to `free`. Practice pays nothing. */
export const MODE_MUL: Record<string, number> = { ladder: 1, rivalplus: 1, survival: 1, free: 0.6, versus: 0.5, practice: 0 };
export const modeMul = (mode: string) => MODE_MUL[mode] ?? MODE_MUL.free;

export const CREDITS = {
  win: 120,
  loss: 40,
  draw: 60,
  /** Win by knockout (not on time). */
  ko: 30,
  perDodge: 3,
  dodgeCap: 30,
  perParry: 10,
  parryCap: 50,
} as const;

export interface CreditLine {
  label: string;
  amount: number;
}

/** Perfect dodges, falling back to all dodges when the match doesn't report them separately. */
export const perfectDodges = (s: MatchStats | undefined) => s?.perfectDodges ?? s?.dodges ?? 0;

/** Credits for one match (before challenge payouts). Lines are already mode-scaled. */
export function matchCredits(r: MatchResult): { total: number; lines: CreditLine[] } {
  if (r.quit) return { total: 0, lines: [] };
  const mul = modeMul(r.config.mode);
  const raw: CreditLine[] = [];
  const win = r.outcome === 'win';
  raw.push({ label: win ? 'Victory' : r.outcome === 'lose' ? 'Match played' : 'Draw', amount: win ? CREDITS.win : r.outcome === 'lose' ? CREDITS.loss : CREDITS.draw });
  if (win && r.finish === 'ko') raw.push({ label: 'Knockout', amount: CREDITS.ko });
  const dodge = Math.min(CREDITS.dodgeCap, perfectDodges(r.player) * CREDITS.perDodge);
  if (dodge > 0) raw.push({ label: 'Dodges', amount: dodge });
  const parry = Math.min(CREDITS.parryCap, (r.player?.parries ?? 0) * CREDITS.perParry);
  if (parry > 0) raw.push({ label: 'Parries', amount: parry });
  const lines = raw.map((l) => ({ label: l.label, amount: Math.round(l.amount * mul) })).filter((l) => l.amount > 0);
  return { total: lines.reduce((a, l) => a + l.amount, 0), lines };
}

/* ------------------------------------------------------------------ mastery */

export const MAX_MASTERY = 5;
/** Cumulative XP needed to reach level i+1 (index 0 → level 1). */
export const MASTERY_XP = [0, 300, 800, 1500, 2500];

export function levelForXp(xp: number): number {
  let lvl = 1;
  for (let i = 1; i < MASTERY_XP.length; i++) if (xp >= MASTERY_XP[i]) lvl = i + 1;
  return lvl;
}
/** 0..1 progress inside the current level (1 at max level). */
export function levelProgress(xp: number): number {
  const lvl = levelForXp(xp);
  if (lvl >= MAX_MASTERY) return 1;
  const a = MASTERY_XP[lvl - 1], b = MASTERY_XP[lvl];
  return (xp - a) / (b - a);
}

/** XP each equipped part earns from one match. */
export function matchXp(r: MatchResult): number {
  if (r.quit) return 0;
  const base = r.outcome === 'win' ? 100 : r.outcome === 'draw' ? 70 : 50;
  const kd = Math.min(4, r.player?.knockdowns ?? 0) * 5;
  return Math.round((base + kd) * modeMul(r.config.mode));
}

export const loadoutKeys = (l: Loadout): string[] => (Object.keys(ALL_PARTS) as Slot[]).map((s) => `${s}:${l[s]}`);
export const allPartKeys = (): string[] => (Object.keys(ALL_PARTS) as Slot[]).flatMap((s) => Object.keys(ALL_PARTS[s]).map((id) => `${s}:${id}`));

export function masteryLevel(save: Pick<SaveData, 'mastery'>, partKey: string): number {
  return levelForXp(save.mastery[partKey] ?? 0);
}
/** Pilot level starts at 1 and gains one per mastery level earned on any part. */
export function pilotLevel(save: Pick<SaveData, 'mastery'>): number {
  return 1 + allPartKeys().reduce((a, k) => a + Math.max(0, masteryLevel(save, k) - 1), 0);
}

/* ------------------------------------------------------------------ challenges */

export type ChallengeTpl =
  | 'win_part' | 'win_arena' | 'deflect' | 'pdodge' | 'kd_match' | 'win_nopod' | 'parry'
  | 'damage' | 'wins' | 'ko_win' | 'hp_win' | 'fast_win' | 'play';

export interface ChallengeDef {
  /** Unique per period, e.g. "d:2026-11-01:0:deflect". */
  id: string;
  tpl: ChallengeTpl;
  text: string;
  goal: number;
  /** Credits paid out on completion. */
  reward: number;
  weekly: boolean;
  /** Part key ("slot:id") or arena id. */
  param?: string;
}

interface TplSpec {
  tpl: ChallengeTpl;
  goal: number;
  reward: number;
  text: (goal: number, param?: string) => string;
  param?: 'part' | 'arena';
}

const partName = (key?: string) => {
  const [s, id] = (key ?? '').split(':') as [Slot, string];
  return ALL_PARTS[s]?.[id]?.name ?? 'that part';
};
const arenaName = (id?: string) => ARENA_INFO[id as ArenaId]?.name ?? 'that arena';

const DAILY: TplSpec[] = [
  { tpl: 'win_part', goal: 1, reward: 120, param: 'part', text: (_g, p) => `Win a match using ${partName(p)}` },
  { tpl: 'win_arena', goal: 1, reward: 100, param: 'arena', text: (_g, p) => `Win in ${arenaName(p)}` },
  { tpl: 'deflect', goal: 5, reward: 120, text: (g) => `Deflect ${g} shots with your guard` },
  { tpl: 'pdodge', goal: 8, reward: 120, text: (g) => `Perfect-dodge ${g} times` },
  { tpl: 'kd_match', goal: 3, reward: 150, text: (g) => `Land ${g} knockdowns in one match` },
  { tpl: 'win_nopod', goal: 1, reward: 150, text: () => 'Win without using your pod' },
  { tpl: 'parry', goal: 3, reward: 130, text: (g) => `Land ${g} parries` },
  { tpl: 'damage', goal: 3000, reward: 100, text: (g) => `Deal ${g.toLocaleString('en-US')} damage` },
  { tpl: 'wins', goal: 2, reward: 100, text: (g) => `Win ${g} matches` },
  { tpl: 'ko_win', goal: 1, reward: 110, text: () => 'Win a match by knockout' },
  { tpl: 'hp_win', goal: 1, reward: 140, text: () => 'Win with at least 50% HP left' },
  { tpl: 'fast_win', goal: 1, reward: 140, text: () => 'Win in under 60 seconds' },
];
const WEEKLY: TplSpec[] = [
  { tpl: 'wins', goal: 10, reward: 450, text: (g) => `Win ${g} matches` },
  { tpl: 'deflect', goal: 30, reward: 400, text: (g) => `Deflect ${g} shots with your guard` },
  { tpl: 'pdodge', goal: 50, reward: 400, text: (g) => `Perfect-dodge ${g} times` },
  { tpl: 'damage', goal: 20000, reward: 400, text: (g) => `Deal ${g.toLocaleString('en-US')} damage` },
  { tpl: 'parry', goal: 15, reward: 450, text: (g) => `Land ${g} parries` },
  { tpl: 'play', goal: 15, reward: 350, text: (g) => `Play ${g} matches` },
  { tpl: 'ko_win', goal: 6, reward: 450, text: (g) => `Win ${g} matches by knockout` },
];

export const DAILY_COUNT = 3;
export const WEEKLY_COUNT = 2;

/** Monday (local) of the week containing `d`, as a date key. */
export function weekKey(d: Date = new Date()): string {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return dateKey(m);
}

function pick<T>(rng: () => number, pool: T[], n: number): T[] {
  const p = [...pool];
  const out: T[] = [];
  while (out.length < n && p.length) out.push(p.splice(Math.floor(rng() * p.length), 1)[0]);
  return out;
}

/**
 * Deterministic challenge set for a period. Same seed + same unlocked parts → same set.
 * Part challenges only ever name parts the player owns.
 */
export function rollChallenges(seed: string, weekly: boolean, unlocked: string[]): ChallengeDef[] {
  const rng = seededRng(`${weekly ? 'weekly' : 'daily'}:${seed}`);
  const specs = pick(rng, weekly ? WEEKLY : DAILY, weekly ? WEEKLY_COUNT : DAILY_COUNT);
  const owned = [...new Set(unlocked)].filter((k) => {
    const [s, id] = k.split(':') as [Slot, string];
    return !!ALL_PARTS[s]?.[id];
  }).sort();
  return specs.map((sp, i) => {
    let param: string | undefined;
    if (sp.param === 'part') param = owned[Math.floor(rng() * owned.length)] ?? 'gun:pulse';
    if (sp.param === 'arena') param = ARENA_IDS[Math.floor(rng() * ARENA_IDS.length)];
    return { id: `${weekly ? 'w' : 'd'}:${seed}:${i}:${sp.tpl}`, tpl: sp.tpl, text: sp.text(sp.goal, param), goal: sp.goal, reward: sp.reward, weekly, param };
  });
}

/** Re-roll the daily / weekly sets when the date or week changed. */
export function ensureChallenges(save: SaveData, now: Date = new Date()) {
  const c = save.challenges;
  const day = dateKey(now), wk = weekKey(now);
  const prune = (defs: ChallengeDef[]) => {
    for (const d of defs) {
      delete c.progress[d.id];
      c.done = c.done.filter((x) => x !== d.id);
    }
  };
  if (c.seedDate !== day || !c.daily.length) {
    prune(c.daily);
    c.seedDate = day;
    c.daily = rollChallenges(day, false, save.unlocked);
  }
  if (c.weekKey !== wk || !c.weekly.length) {
    prune(c.weekly);
    c.weekKey = wk;
    c.weekly = rollChallenges(wk, true, save.unlocked);
  }
}

/**
 * New progress value for a challenge after a match. Returns the previous value when the
 * match doesn't count (or the needed stat is missing from MatchStats).
 */
export function challengeProgress(def: ChallengeDef, prev: number, r: MatchResult): number {
  const p = r.player;
  const win = r.outcome === 'win';
  const add = (n: number) => Math.min(def.goal, prev + Math.max(0, Math.floor(n)));
  switch (def.tpl) {
    case 'win_part': return win && loadoutKeys(r.config.playerLoadout).includes(def.param ?? '') ? add(1) : prev;
    case 'win_arena': return win && r.config.arenaId === def.param ? add(1) : prev;
    case 'deflect': return add(p?.deflects ?? 0);
    case 'pdodge': return add(perfectDodges(p));
    case 'kd_match': return Math.min(def.goal, Math.max(prev, p?.knockdowns ?? 0));
    case 'win_nopod': return win && p?.podsUsed === 0 ? add(1) : prev;
    case 'parry': return add(p?.parries ?? 0);
    case 'damage': return add(p?.damageDealt ?? 0);
    case 'wins': return win ? add(1) : prev;
    case 'ko_win': return win && r.finish === 'ko' ? add(1) : prev;
    case 'hp_win': return win && r.playerMaxHp > 0 && r.playerHp / r.playerMaxHp >= 0.5 ? add(1) : prev;
    case 'fast_win': return win && r.time < 60 ? add(1) : prev;
    case 'play': return add(1);
  }
  return prev;
}

/* ------------------------------------------------------------------ cosmetics equip */

/** Apply an owned cosmetic to the player's paint / pose. Returns false if not owned. */
export function equipCosmetic(save: SaveData, id: string): boolean {
  const c = COSMETICS[id];
  if (!c || !save.cosmetics.owned.includes(id)) return false;
  const eq = save.cosmetics.equipped;
  if (c.kind === 'paint' && c.paint) Object.assign(save.paint, c.paint);
  if (c.kind === 'decal' && c.decal) save.paint.emblem = c.decal;
  if (c.kind === 'trail' && c.trail !== undefined) save.paint.trail = c.trail;
  eq[c.kind] = id;
  return true;
}
/** Back to the stock Kestrel look for that cosmetic kind. */
export function unequipCosmetic(save: SaveData, kind: 'paint' | 'decal' | 'pose' | 'trail') {
  const P = PLAYER_PAINT;
  if (kind === 'paint') Object.assign(save.paint, { primary: P.primary, secondary: P.secondary, trim: P.trim, dark: P.dark, glow: P.glow });
  if (kind === 'decal') save.paint.emblem = P.emblem;
  if (kind === 'trail') delete save.paint.trail;
  save.cosmetics.equipped[kind] = null;
}
export function grantCosmetic(save: SaveData, id: string): boolean {
  if (!COSMETICS[id] || save.cosmetics.owned.includes(id)) return false;
  save.cosmetics.owned.push(id);
  return true;
}

/* ------------------------------------------------------------------ match end */

export interface MasteryGain {
  part: string;
  xp: number;
  before: number;
  after: number;
  levelBefore: number;
  levelAfter: number;
}
export interface LevelUp {
  part: string;
  level: number;
  /** Cosmetic id granted for this level. */
  cosmetic: string | null;
}
export interface ChallengeTick {
  def: ChallengeDef;
  before: number;
  after: number;
  /** Completed by this match (credits paid). */
  completed: boolean;
}
export interface Rewards {
  /** Total credits earned (match + challenge payouts). */
  credits: number;
  lines: CreditLine[];
  mastery: MasteryGain[];
  levelUps: LevelUp[];
  challenges: ChallengeTick[];
  /** Newly unlocked achievement ids. */
  achievements: string[];
  /** Newly granted cosmetic ids (mastery + achievements). */
  cosmetics: string[];
}

export const emptyRewards = (): Rewards => ({ credits: 0, lines: [], mastery: [], levelUps: [], challenges: [], achievements: [], cosmetics: [] });

/** Apply a finished match to the save. Mutates `save`; caller persists. */
export function onMatchEnd(save: SaveData, result: MatchResult, now: Date = new Date()): Rewards {
  const out = emptyRewards();
  if (result.quit) return out;
  ensureChallenges(save, now);
  const st = save.stats;
  const p = result.player;
  const win = result.outcome === 'win';
  const paid = modeMul(result.config.mode) > 0;

  // lifetime stats (all modes count except practice)
  if (paid) {
    st.matches++;
    if (result.outcome === 'draw') st.draws++;
    st.damage += Math.round(p?.damageDealt ?? 0);
    st.dodges += perfectDodges(p);
    st.parries += p?.parries ?? 0;
    st.deflects += p?.deflects ?? 0;
    if (win) {
      st.streak++;
      st.bestStreak = Math.max(st.bestStreak, st.streak);
      if (result.finish === 'ko') {
        st.koWins++;
        if (!st.fastestKo || result.time < st.fastestKo) st.fastestKo = Math.round(result.time * 10) / 10;
      }
      if (result.playerMaxHp > 0 && result.playerHp / result.playerMaxHp >= 0.9) st.flawless++;
      if (!st.arenaWins.includes(result.config.arenaId)) st.arenaWins.push(result.config.arenaId);
    } else if (result.outcome === 'lose') st.streak = 0;
    const lo = result.config.playerLoadout;
    const bk = buildKey(lo);
    st.builds[bk] = (st.builds[bk] ?? 0) + 1;
  }

  // credits
  const mc = matchCredits(result);
  out.lines.push(...mc.lines);
  out.credits += mc.total;

  // mastery
  const xp = matchXp(result);
  if (xp > 0) {
    for (const key of loadoutKeys(result.config.playerLoadout)) {
      const [s, id] = key.split(':') as [Slot, string];
      if (!ALL_PARTS[s]?.[id]) continue;
      const before = save.mastery[key] ?? 0;
      const after = before + xp;
      save.mastery[key] = after;
      const lb = levelForXp(before), la = levelForXp(after);
      out.mastery.push({ part: key, xp, before, after, levelBefore: lb, levelAfter: la });
      for (let lv = lb + 1; lv <= la; lv++) {
        const cid = masteryCosmeticId(key, lv);
        if (cid && grantCosmetic(save, cid)) out.cosmetics.push(cid);
        out.levelUps.push({ part: key, level: lv, cosmetic: cid });
      }
    }
  }

  // challenges
  if (paid) {
    const c = save.challenges;
    for (const def of [...c.daily, ...c.weekly]) {
      if (c.done.includes(def.id)) continue;
      const before = c.progress[def.id] ?? 0;
      const after = challengeProgress(def, before, result);
      if (after === before) continue;
      c.progress[def.id] = after;
      const completed = after >= def.goal;
      if (completed) {
        c.done.push(def.id);
        st.challengesDone++;
        if (def.weekly) st.weekliesDone++;
        out.credits += def.reward;
        out.lines.push({ label: def.weekly ? 'Weekly challenge' : 'Daily challenge', amount: def.reward });
      }
      out.challenges.push({ def, before, after, completed });
    }
  }

  save.credits += out.credits;
  st.creditsEarned += out.credits;

  // achievements (may grant cosmetics)
  const ach = checkAchievements(save, result, now);
  out.achievements.push(...ach.unlocked);
  out.cosmetics.push(...ach.cosmetics);
  return out;
}

export const buildKey = (l: Loadout) => `${l.gun}/${l.bomb}/${l.pod}/${l.body}/${l.legs}`;

/** Most-played build ("gun/bomb/pod/body/legs") and its match count, or null. */
export function favoriteBuild(save: SaveData): { loadout: Loadout; count: number } | null {
  let best: string | null = null, n = 0;
  for (const [k, v] of Object.entries(save.stats.builds)) if (v > n) { best = k; n = v; }
  if (!best) return null;
  const [gun, bomb, pod, body, legs] = best.split('/');
  return { loadout: { gun, bomb, pod, body, legs }, count: n };
}
