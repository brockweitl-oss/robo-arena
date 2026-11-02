import type { Loadout } from '../data/parts';

export interface MatchConfig {
  mode: 'ladder' | 'free';
  playerLoadout: Loadout;
  rivalId: string;
  arenaId: string;
  /** Ladder fight index (ladder mode only). */
  ladderIndex?: number;
  /** Round length in seconds. */
  timeLimit?: number;
  /** Pick-ups mode (power-ups spawn mid-arena). */
  pickups?: boolean;
}

export interface MatchStats {
  damageDealt: number;
  hits: number;
  knockdowns: number;
  shots: number;
  dodges: number;
  /* Optional extras read by progression/challenges/achievements (src/game/progression.ts).
     Missing fields are treated as "unknown": challenges that need them make no progress. */
  /** Perfect parries (guard timed in the last moment before a hit). */
  parries?: number;
  /** Shots deflected by the charge guard (including parries). */
  deflects?: number;
  /** Perfect dodges only (dodges also counts near-miss dodges). Falls back to dodges. */
  perfectDodges?: number;
  /** Pods launched this match. Needed for "win without using your pod". */
  podsUsed?: number;
}

export interface MatchResult {
  config: MatchConfig;
  outcome: 'win' | 'lose' | 'draw';
  /** 'ko' or 'time'. */
  finish: 'ko' | 'time';
  /** Seconds elapsed in the round. */
  time: number;
  playerHp: number;
  playerMaxHp: number;
  rivalHp: number;
  rivalMaxHp: number;
  player: MatchStats;
  rival: MatchStats;
  /** Player chose Quit from the pause menu. */
  quit?: boolean;
  /** Player chose Restart from the pause menu (host restarts automatically). */
  restart?: boolean;
}
