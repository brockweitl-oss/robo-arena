/**
 * First-to-2 sets with counter-picks between rounds.
 *
 * After each round the loser may swap exactly one part slot (or keep their build); then
 * the winner sees that new build and may swap one slot. Pure helpers: set scoring, swap
 * validation and the rule-based AI counter-picker. Nothing here is random.
 */
import { ALL_PARTS, type Loadout, type Slot } from '../data/parts';
import type { MatchStats } from './types';

export const SET_TARGET = 2;
/** Seconds each side gets to counter-pick (timeout = keep). */
export const PICK_SECONDS = 20;
export const PICK_SLOTS: Slot[] = ['gun', 'bomb', 'pod', 'skill', 'body', 'legs'];

export interface Pick { slot: Slot; id: string }

export interface SetState {
  /** Rounds won: [side 0 (player / P1 / local), side 1]. */
  score: [number, number];
  /** Next round number (1-based). */
  round: number;
  /** Current builds per side. */
  loadouts: [Loadout, Loadout];
}

export function newSet(a: Loadout, b: Loadout): SetState {
  return { score: [0, 0], round: 1, loadouts: [{ ...a }, { ...b }] };
}

/** Apply a round result from side 0's point of view. Draws replay the round with no score change. */
export function recordRound(s: SetState, outcome: 'win' | 'lose' | 'draw'): SetState {
  const score: [number, number] = [s.score[0] + (outcome === 'win' ? 1 : 0), s.score[1] + (outcome === 'lose' ? 1 : 0)];
  return { ...s, score, round: s.round + 1 };
}

/** Set winner side, or -1 while the set is still running. */
export function setWinner(s: SetState, target = SET_TARGET): -1 | 0 | 1 {
  return s.score[0] >= target ? 0 : s.score[1] >= target ? 1 : -1;
}

export function isValidPick(p: unknown): p is Pick {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return typeof o.slot === 'string' && (PICK_SLOTS as string[]).includes(o.slot) && typeof o.id === 'string' && Object.hasOwn(ALL_PARTS[o.slot as Slot], o.id);
}

/** The build after a pick (null / invalid = keep). Never changes more than one slot. */
export function applyPick(lo: Loadout, p: Pick | null | undefined): Loadout {
  if (!p || !isValidPick(p)) return { ...lo };
  return { ...lo, [p.slot]: p.id };
}

/** Number of slots that differ between two builds. */
export function slotsChanged(a: Loadout, b: Loadout): Slot[] {
  return PICK_SLOTS.filter((s) => a[s] !== b[s]);
}

/**
 * Counter candidates for each way the opponent dealt damage, best first.
 * Each entry swaps one slot toward a part that blunts that source.
 */
const COUNTERS: Record<string, Pick[]> = {
  // point-defense drone shoots down shots and pods; sprint legs out-run tracking
  gun: [{ slot: 'pod', id: 'interceptor' }, { slot: 'legs', id: 'sprint' }],
  // bombs: fast legs leave the landing ring; hopper jumps over the blast
  bomb: [{ slot: 'legs', id: 'sprint' }, { slot: 'legs', id: 'hopper' }],
  pod: [{ slot: 'pod', id: 'interceptor' }, { slot: 'gun', id: 'pulse' }],
  // charge rushes: punish point blank, or soak them with a heavy frame
  charge: [{ slot: 'gun', id: 'scatter' }, { slot: 'body', id: 'ironclad' }],
  // skill lanes: extra dash charges to cross the lane, or blink out
  skill: [{ slot: 'legs', id: 'sprint' }, { slot: 'skill', id: 'blink' }],
  fire: [{ slot: 'legs', id: 'hopper' }, { slot: 'legs', id: 'feather' }],
};

/** Per-source damage the opponent dealt (falls back to coarse stats when the breakdown is missing). */
function sources(st: MatchStats | undefined): [string, number][] {
  const by = { ...(st?.damageBy ?? {}) };
  if (!Object.keys(by).length && st) {
    if (st.gunDamage) by.gun = st.gunDamage;
    const rest = (st.damageDealt ?? 0) - (st.gunDamage ?? 0);
    if (rest > 0) by.charge = rest;
  }
  delete by.hazard;
  return Object.entries(by).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Rule-based AI counter-pick: find the opponent's best-performing damage source and swap
 * one slot to a part that counters it. Returns null to keep the build.
 * `allowed` limits the part pool (defaults to every part).
 */
export function aiCounterPick(aiLo: Loadout, opponentStats: MatchStats | undefined, allowed?: (p: Pick) => boolean): Pick | null {
  for (const [src] of sources(opponentStats)) {
    for (const c of COUNTERS[src] ?? []) {
      if (aiLo[c.slot] === c.id) continue;
      if (allowed && !allowed(c)) continue;
      return { ...c };
    }
  }
  return null;
}

/** Wire message for online counter-picks (relayed untouched by the room server). */
export interface PickMsg { t: 'cp'; round: number; step: 1 | 2; pick: Pick | null }

export function parsePickMsg(raw: unknown): PickMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.t !== 'cp' || typeof m.round !== 'number' || (m.step !== 1 && m.step !== 2)) return null;
  return { t: 'cp', round: m.round, step: m.step, pick: isValidPick(m.pick) ? { slot: m.pick.slot, id: m.pick.id } : null };
}
