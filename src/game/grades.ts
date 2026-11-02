import type { MatchResult } from './types';

export type Grade = 'S' | 'A' | 'B' | 'C';

export interface GradeReport {
  grade: Grade;
  score: number;
  parts: { label: string; points: number; max: number }[];
}

/**
 * Fight grade (S/A/B/C) from how the win was earned: HP kept, speed, defensive
 * skill (dodges, parries, deflects) and knockdowns landed. A loss caps at C.
 */
export function gradeMatch(r: MatchResult): GradeReport {
  const hpPct = r.playerHp / r.playerMaxHp;
  const p = r.player;
  const defense = (p.dodges ?? 0) + (p.parries ?? 0) * 2 + (p.deflects ?? 0);
  const parts = [
    { label: 'Armor kept', points: Math.round(hpPct * 40), max: 40 },
    { label: 'Speed', points: r.outcome === 'win' ? Math.round(Math.max(0, Math.min(1, (120 - r.time) / 90)) * 20) : 0, max: 20 },
    { label: 'Defense', points: Math.min(20, defense * 3), max: 20 },
    { label: 'Knockdowns', points: Math.min(20, (r.rival.knockdowns ?? 0) * 7), max: 20 },
  ];
  const score = parts.reduce((s, x) => s + x.points, 0);
  let grade: Grade = score >= 80 ? 'S' : score >= 62 ? 'A' : score >= 42 ? 'B' : 'C';
  if (r.outcome !== 'win') grade = 'C';
  return { grade, score, parts };
}
