import { DEFAULT_LOADOUT, STARTER_PARTS, ALL_PARTS, type Loadout, type Slot } from '../data/parts';
import { PLAYER_PAINT, type Paint } from '../data/characters';
import type { Quality } from '../render/renderer';
import { DEFAULT_BINDINGS, cloneBindings, normalizeBindings, type Bindings } from './input';
import type { ChallengeDef } from '../game/progression';

export interface Settings {
  master: number;
  sfx: number;
  music: number;
  /** Mouse/stick camera sensitivity multiplier (0.2..3). */
  sensitivity: number;
  invertY: boolean;
  cameraShake: boolean;
  quality: Quality;
  damageNumbers: boolean;
  /** Rebindable controls (keyboard/mouse + gamepad). */
  bindings: Bindings;
  /**
   * Aim assist 0.5..1 (default 1). Multiplies the PLAYER's projectile homing only
   * (match sets playerFighter.homingMul from it). Lower = less tracking.
   */
  aimAssist: number;
}

export interface CosmeticSlots {
  paint: string | null;
  decal: string | null;
  pose: string | null;
  trail: string | null;
}

export interface ChallengeState {
  /** Date key ("YYYY-MM-DD") the daily set was rolled for. */
  seedDate: string;
  /** Monday date key of the week the weekly set was rolled for. */
  weekKey: string;
  daily: ChallengeDef[];
  weekly: ChallengeDef[];
  /** challenge id → progress toward its goal. */
  progress: Record<string, number>;
  /** Completed (and paid out) challenge ids for the current day/week. */
  done: string[];
}

export interface LifetimeStats {
  matches: number;
  draws: number;
  damage: number;
  dodges: number;
  parries: number;
  deflects: number;
  /** Wins by KO. */
  koWins: number;
  flawless: number;
  creditsEarned: number;
  creditsSpent: number;
  challengesDone: number;
  weekliesDone: number;
  /** Arena ids the player has won in. */
  arenaWins: string[];
  /** Fastest KO win in seconds (0 = none yet). */
  fastestKo: number;
  streak: number;
  bestStreak: number;
  /** "gun/bomb/pod/body/legs" → matches played with that build. */
  builds: Record<string, number>;
}

export interface SaveData {
  version: 2;
  /** Owned parts as "slot:id". */
  unlocked: string[];
  loadout: Loadout;
  /** Index of the next ladder fight (0..RIVALS.length). RIVALS.length = champion beaten. */
  ladder: number;
  /** Rival ids the player has beaten at least once. */
  beaten: string[];
  settings: Settings;
  totals: { wins: number; losses: number; knockdowns: number };
  /** Rival+ ladder progress (index of the next Rival+ fight) and beaten Rival+ ids. */
  plusLadder: number;
  plusBeaten: string[];
  /** Best survival run (rounds won). */
  survivalBest: number;
  /* ---- v2: meta / retention (all cosmetic, no stat effects) ---- */
  credits: number;
  /** The player's robot paint (equipped scheme + decal + trail applied). */
  paint: Paint;
  /** Part mastery XP, "slot:id" → xp. */
  mastery: Record<string, number>;
  cosmetics: { owned: string[]; equipped: CosmeticSlots };
  challenges: ChallengeState;
  /** Achievement id → unlock time (ms since epoch). */
  achievements: Record<string, number>;
  stats: LifetimeStats;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  sfx: 0.9,
  music: 0.6,
  sensitivity: 1,
  invertY: false,
  cameraShake: false,
  quality: 'medium',
  damageNumbers: true,
  bindings: DEFAULT_BINDINGS,
  aimAssist: 1,
};

const KEY = 'robo-arena-save-v1';

export function defaultStats(): LifetimeStats {
  return {
    matches: 0, draws: 0, damage: 0, dodges: 0, parries: 0, deflects: 0, koWins: 0, flawless: 0,
    creditsEarned: 0, creditsSpent: 0, challengesDone: 0, weekliesDone: 0, arenaWins: [], fastestKo: 0,
    streak: 0, bestStreak: 0, builds: {},
  };
}

export function defaultSave(): SaveData {
  return {
    version: 2,
    unlocked: [...STARTER_PARTS],
    loadout: { ...DEFAULT_LOADOUT },
    ladder: 0,
    beaten: [],
    settings: { ...DEFAULT_SETTINGS, bindings: cloneBindings(DEFAULT_BINDINGS) },
    totals: { wins: 0, losses: 0, knockdowns: 0 },
    plusLadder: 0,
    plusBeaten: [],
    survivalBest: 0,
    credits: 0,
    paint: { ...PLAYER_PAINT },
    mastery: {},
    cosmetics: { owned: [], equipped: { paint: null, decal: null, pose: null, trail: null } },
    challenges: { seedDate: '', weekKey: '', daily: [], weekly: [], progress: {}, done: [] },
    achievements: {},
    stats: defaultStats(),
  };
}

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const numMap = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(obj(v))) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
  return out;
};

/**
 * Upgrade any stored save object (v1 or v2, possibly partial or corrupt) to the current shape.
 * Pure: no storage access, so it is unit-testable.
 */
export function migrateSave(raw: unknown): SaveData {
  const base = defaultSave();
  const d = obj(raw) as Partial<SaveData> & Record<string, unknown>;
  if (!raw || typeof raw !== 'object') return base;
  const settingsIn = obj(d.settings);
  const settings: Settings = {
    ...base.settings,
    ...(settingsIn as Partial<Settings>),
    bindings: normalizeBindings(settingsIn.bindings),
    aimAssist: num(settingsIn.aimAssist, 1, 0.5, 1),
  };
  const statsIn = obj(d.stats);
  const stats: LifetimeStats = { ...base.stats };
  for (const k of Object.keys(stats) as (keyof LifetimeStats)[]) {
    if (k === 'arenaWins') stats.arenaWins = strArr(statsIn.arenaWins);
    else if (k === 'builds') stats.builds = numMap(statsIn.builds);
    else (stats[k] as number) = num(statsIn[k], 0, 0);
  }
  const cosIn = obj(d.cosmetics);
  const eqIn = obj(cosIn.equipped);
  const eqStr = (v: unknown) => (typeof v === 'string' ? v : null);
  const chIn = obj(d.challenges);
  const paintIn = obj(d.paint);
  const paint: Paint = { ...PLAYER_PAINT };
  for (const k of ['primary', 'secondary', 'trim', 'dark', 'glow'] as const) paint[k] = num(paintIn[k], PLAYER_PAINT[k], 0, 0xffffff) | 0;
  if (typeof paintIn.emblem === 'string' && paintIn.emblem.length <= 3) paint.emblem = paintIn.emblem;
  if (typeof paintIn.trail === 'number') paint.trail = num(paintIn.trail, 0, 0, 0xffffff) | 0;

  const merged: SaveData = {
    version: 2,
    unlocked: Array.from(new Set([...strArr(d.unlocked), ...STARTER_PARTS])),
    loadout: { ...base.loadout, ...(obj(d.loadout) as Partial<Loadout>) },
    ladder: num(d.ladder, 0, 0) | 0,
    beaten: strArr(d.beaten),
    settings,
    totals: { ...base.totals, ...numMap(d.totals) } as SaveData['totals'],
    plusLadder: num(d.plusLadder, 0, 0) | 0,
    plusBeaten: strArr(d.plusBeaten),
    survivalBest: num(d.survivalBest, 0, 0) | 0,
    credits: Math.floor(num(d.credits, 0, 0)),
    paint,
    mastery: numMap(d.mastery),
    cosmetics: {
      owned: Array.from(new Set(strArr(cosIn.owned))),
      equipped: { paint: eqStr(eqIn.paint), decal: eqStr(eqIn.decal), pose: eqStr(eqIn.pose), trail: eqStr(eqIn.trail) },
    },
    challenges: {
      seedDate: typeof chIn.seedDate === 'string' ? chIn.seedDate : '',
      weekKey: typeof chIn.weekKey === 'string' ? chIn.weekKey : '',
      daily: Array.isArray(chIn.daily) ? (chIn.daily as ChallengeDef[]) : [],
      weekly: Array.isArray(chIn.weekly) ? (chIn.weekly as ChallengeDef[]) : [],
      progress: numMap(chIn.progress),
      done: strArr(chIn.done),
    },
    achievements: numMap(d.achievements),
    stats,
  };
  // drop loadout entries the player doesn't own / that no longer exist
  for (const slot of Object.keys(base.loadout) as Slot[]) {
    const id = merged.loadout[slot];
    if (typeof id !== 'string' || !ALL_PARTS[slot][id] || !merged.unlocked.includes(`${slot}:${id}`)) merged.loadout[slot] = DEFAULT_LOADOUT[slot];
  }
  for (const k of Object.keys(merged.loadout)) if (!(k in base.loadout)) delete (merged.loadout as unknown as Record<string, string>)[k];
  return merged;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    return migrateSave(JSON.parse(raw));
  } catch {
    return defaultSave();
  }
}

export function writeSave(d: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable (private mode) — progress lives for this session only */
  }
}

export function isUnlocked(d: SaveData, slot: Slot, id: string) {
  return d.unlocked.includes(`${slot}:${id}`);
}
