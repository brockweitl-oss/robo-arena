/**
 * First ten minutes: staged part unlocks for brand-new pilots.
 *
 * New saves start with a small curated kit (one part per slot, one skill) and earn the
 * remaining starter skills in pairs through their first story-ladder wins, on top of the
 * parts each rival already unlocks. Saves that have played before keep the full legacy
 * starter set: nothing is ever taken away from a pilot who has fought a match.
 *
 * Pure functions only (no storage, no DOM) so the save migration stays unit-testable.
 */
import { STARTER_PARTS } from '../data/parts';
import { RIVALS } from '../data/characters';

/** What a brand-new pilot owns. */
export const NEW_PILOT_PARTS: readonly string[] = ['gun:pulse', 'bomb:mortar', 'pod:seeker', 'body:striker', 'legs:stride', 'skill:lance'];

/** Staged starter parts: stage i is granted by the (i + 1)-th story-ladder win. */
export const STAGED_UNLOCKS: readonly (readonly string[])[] = [
  ['skill:wave', 'skill:hook'],
  ['skill:frost', 'skill:blink'],
];

export interface FirstRun {
  /** This save uses the curated kit + staged unlocks (false: legacy full starter set). */
  staged: boolean;
  /** The guided first match has been completed (or skipped). */
  guideDone: boolean;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Has this (raw, possibly legacy) save ever finished a match or made progress? */
export function hasPlayed(raw: unknown): boolean {
  const d = obj(raw);
  const stats = obj(d.stats), totals = obj(d.totals);
  return n(stats.matches) > 0 || n(totals.wins) > 0 || n(totals.losses) > 0 || n(d.ladder) > 0
    || (Array.isArray(d.beaten) && d.beaten.length > 0) || (Array.isArray(d.plusBeaten) && d.plusBeaten.length > 0) || n(d.survivalBest) > 0;
}

/** Story-ladder rivals beaten (each counts once). */
export function ladderWins(beaten: readonly string[]): number {
  return RIVALS.filter((r) => beaten.includes(r.id)).length;
}

/** Every staged part earned by `wins` ladder wins. */
export function stagedEarned(wins: number): string[] {
  return STAGED_UNLOCKS.slice(0, Math.max(0, wins)).flat();
}

/** Starter parts that are always owned for this save mode. */
export function baseParts(staged: boolean): readonly string[] {
  return staged ? NEW_PILOT_PARTS : STARTER_PARTS;
}

/**
 * Resolve the first-run state and owned-part list of a raw save.
 * - Saves with a stored `firstRun` keep their mode and every part they already own.
 * - Legacy saves (no `firstRun`) that have played keep everything plus the full starter set.
 * - Legacy saves that never played are treated as new: they move to the curated kit.
 */
export function migrateFirstRun(raw: unknown, unlockedIn: readonly string[], beaten: readonly string[]): { firstRun: FirstRun; unlocked: string[] } {
  const d = obj(raw);
  const played = hasPlayed(raw);
  const fr = obj(d.firstRun);
  const known = typeof fr.staged === 'boolean';
  const staged = known ? (fr.staged as boolean) : !played;
  const guideDone = typeof fr.guideDone === 'boolean' ? fr.guideDone : played;
  let own = [...unlockedIn];
  if (staged && !known) {
    // a never-played legacy save only holds default starter parts: re-curate it
    const withheld = new Set(STAGED_UNLOCKS.flat());
    own = own.filter((k) => !withheld.has(k));
  }
  const unlocked = Array.from(new Set([...own, ...baseParts(staged), ...(staged ? stagedEarned(ladderWins(beaten)) : [])]));
  return { firstRun: { staged, guideDone }, unlocked };
}

/** Grant any staged parts the save has earned but not yet received. Returns the new part keys. */
export function grantStaged(save: { firstRun: FirstRun; unlocked: string[]; beaten: string[] }): string[] {
  if (!save.firstRun.staged) return [];
  const out: string[] = [];
  for (const k of stagedEarned(ladderWins(save.beaten))) {
    if (!save.unlocked.includes(k)) {
      save.unlocked.push(k);
      out.push(k);
    }
  }
  return out;
}

/** Should the next story-ladder fight be the guided first match? */
export function wantsGuide(save: { firstRun: FirstRun; stats: { matches: number } }): boolean {
  return !save.firstRun.guideDone && save.stats.matches === 0;
}
