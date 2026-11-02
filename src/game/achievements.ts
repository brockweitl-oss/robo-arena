/**
 * Achievements. Each one is a pure check over the save (+ the match that just ended).
 * Rewards are cosmetic only. Call `checkAchievements` after a match (onMatchEnd does it)
 * and after shop purchases.
 */
import { ALL_PARTS, type Slot } from '../data/parts';
import { RIVALS } from '../data/characters';
import { ARENA_IDS } from '../arena/index';
import { COSMETICS } from '../data/shop';
import type { SaveData } from '../core/save';
import type { MatchResult } from './types';
import { allPartKeys, masteryLevel, perfectDodges, grantCosmetic } from './progression';


export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** Short glyph for the badge (1–2 characters). */
  icon: string;
  /** Cosmetic ids granted on unlock. */
  rewards?: string[];
  /** Hidden until unlocked (desc shown as ???). */
  secret?: boolean;
  check: (s: SaveData, r: MatchResult | null) => boolean;
}

const winOf = (r: MatchResult | null) => !!r && !r.quit && r.outcome === 'win';
const hpFrac = (r: MatchResult) => (r.playerMaxHp > 0 ? r.playerHp / r.playerMaxHp : 0);
const ownsAllParts = (s: SaveData) => (Object.keys(ALL_PARTS) as Slot[]).every((sl) => Object.keys(ALL_PARTS[sl]).every((id) => s.unlocked.includes(`${sl}:${id}`)));
const shopOwned = (s: SaveData) => s.cosmetics.owned.filter((id) => COSMETICS[id]?.source === 'shop').length;

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_win', name: 'First Victory', desc: 'Win your first match.', icon: 'I', check: (s, r) => winOf(r) || s.totals.wins > 0 },
  { id: 'champion', name: 'Champion', desc: 'Clear the story ladder and take the crown.', icon: 'K', rewards: ['paint:champion', 'decal:crown'], check: (s) => s.ladder >= RIVALS.length },
  { id: 'flawless', name: 'Flawless', desc: 'Win a match with at least 90% HP left.', icon: 'F', rewards: ['trail:flawless'], check: (_s, r) => winOf(r) && hpFrac(r!) >= 0.9 },
  { id: 'untouchable', name: 'Untouchable', desc: 'Perfect-dodge 10 times in one match.', icon: 'U', check: (_s, r) => !!r && !r.quit && perfectDodges(r.player) >= 10 },
  { id: 'parry_master', name: 'Parry Master', desc: 'Land 25 parries.', icon: 'P', rewards: ['decal:parry'], check: (s) => s.stats.parries >= 25 },
  { id: 'reflector', name: 'Reflector', desc: 'Deflect 50 shots with your guard.', icon: 'R', check: (s) => s.stats.deflects >= 50 },
  { id: 'collector', name: 'Collector', desc: 'Own every part.', icon: 'C', check: (s) => ownsAllParts(s) },
  { id: 'mastered', name: 'Mastered', desc: 'Raise any part to mastery level 5.', icon: 'M', check: (s) => allPartKeys().some((k) => masteryLevel(s, k) >= 5) },
  { id: 'specialist', name: 'Specialist', desc: 'Raise five parts to mastery level 3.', icon: 'S', check: (s) => allPartKeys().filter((k) => masteryLevel(s, k) >= 3).length >= 5 },
  { id: 'veteran', name: 'Veteran', desc: 'Win 10 matches.', icon: 'V', check: (s) => s.totals.wins >= 10 },
  { id: 'legend', name: 'Legend', desc: 'Win 50 matches.', icon: 'L', check: (s) => s.totals.wins >= 50 },
  { id: 'demolition', name: 'Demolition', desc: 'Land 3 knockdowns in one match.', icon: 'D', check: (_s, r) => !!r && !r.quit && (r.player?.knockdowns ?? 0) >= 3 },
  { id: 'lightning', name: 'Lightning Round', desc: 'Win by KO in under 30 seconds.', icon: 'Z', check: (_s, r) => winOf(r) && r!.finish === 'ko' && r!.time < 30 },
  { id: 'comeback', name: 'Comeback', desc: 'Win with less than 15% HP left.', icon: 'B', check: (_s, r) => winOf(r) && hpFrac(r!) > 0 && hpFrac(r!) < 0.15 },
  { id: 'on_a_roll', name: 'On a Roll', desc: 'Win 5 matches in a row.', icon: '5', check: (s) => s.stats.bestStreak >= 5 },
  { id: 'globetrotter', name: 'Globetrotter', desc: 'Win in every arena.', icon: 'G', check: (s) => ARENA_IDS.every((a) => s.stats.arenaWins.includes(a)) },
  { id: 'purist', name: 'Purist', desc: 'Win without launching your pod.', icon: 'O', check: (_s, r) => winOf(r) && r!.player?.podsUsed === 0 },
  { id: 'payday', name: 'Payday', desc: 'Earn 5,000 credits in total.', icon: '$', check: (s) => s.stats.creditsEarned >= 5000 },
  { id: 'first_buy', name: 'Fresh Coat', desc: 'Buy your first cosmetic in the shop.', icon: 'N', check: (s) => shopOwned(s) >= 1 },
  { id: 'fashion', name: 'Fashion Plate', desc: 'Own 10 cosmetics.', icon: 'W', check: (s) => s.cosmetics.owned.length >= 10 },
  { id: 'daily_driver', name: 'Daily Driver', desc: 'Complete 10 challenges.', icon: 'X', check: (s) => s.stats.challengesDone >= 10 },
  { id: 'long_haul', name: 'Long Haul', desc: 'Complete a weekly challenge.', icon: 'H', check: (s) => s.stats.weekliesDone >= 1 },
];

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

/** Unlock everything newly satisfied. Mutates the save; returns the new ids and granted cosmetics. */
export function checkAchievements(save: SaveData, result: MatchResult | null = null, now: Date = new Date()): { unlocked: string[]; cosmetics: string[] } {
  const unlocked: string[] = [];
  const cosmetics: string[] = [];
  // two passes so meta achievements (e.g. Fashion Plate after a reward) can chain
  for (let pass = 0; pass < 2; pass++) {
    for (const a of ACHIEVEMENTS) {
      if (save.achievements[a.id]) continue;
      if (!a.check(save, result)) continue;
      save.achievements[a.id] = now.getTime();
      unlocked.push(a.id);
      for (const c of a.rewards ?? []) if (grantCosmetic(save, c)) cosmetics.push(c);
    }
  }
  return { unlocked, cosmetics };
}
