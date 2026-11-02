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
}

export interface MatchStats {
  damageDealt: number;
  hits: number;
  knockdowns: number;
  shots: number;
  dodges: number;
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
