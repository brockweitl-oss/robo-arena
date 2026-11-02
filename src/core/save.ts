import { DEFAULT_LOADOUT, STARTER_PARTS, ALL_PARTS, type Loadout, type Slot } from '../data/parts';
import type { Quality } from '../render/renderer';

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
}

export interface SaveData {
  version: 1;
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
};

const KEY = 'robo-arena-save-v1';

export function defaultSave(): SaveData {
  return {
    version: 1,
    unlocked: [...STARTER_PARTS],
    loadout: { ...DEFAULT_LOADOUT },
    ladder: 0,
    beaten: [],
    settings: { ...DEFAULT_SETTINGS },
    totals: { wins: 0, losses: 0, knockdowns: 0 },
    plusLadder: 0,
    plusBeaten: [],
    survivalBest: 0,
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const d = JSON.parse(raw) as Partial<SaveData>;
    const base = defaultSave();
    const merged: SaveData = {
      ...base,
      ...d,
      settings: { ...base.settings, ...(d.settings ?? {}) },
      loadout: { ...base.loadout, ...(d.loadout ?? {}) },
      totals: { ...base.totals, ...(d.totals ?? {}) },
      unlocked: Array.from(new Set([...(d.unlocked ?? []), ...STARTER_PARTS])),
      version: 1,
    };
    // drop loadout entries the player doesn't own / that no longer exist
    for (const slot of Object.keys(merged.loadout) as Slot[]) {
      const id = merged.loadout[slot];
      if (!ALL_PARTS[slot][id] || !merged.unlocked.includes(`${slot}:${id}`)) merged.loadout[slot] = DEFAULT_LOADOUT[slot];
    }
    return merged;
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
