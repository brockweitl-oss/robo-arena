import type { NetSession, PlayerHello } from '../net/online';
import type { Loadout } from '../data/parts';
import type { Paint } from '../data/characters';
import type { Replay } from './replay';

export interface MatchConfig {
  mode: 'ladder' | 'free' | 'rivalplus' | 'survival' | 'practice' | 'versus' | 'replay' | 'online';
  playerLoadout: Loadout;
  rivalId: string;
  arenaId: string;
  /** Ladder fight index (ladder mode only). */
  ladderIndex?: number;
  /** Round length in seconds. */
  timeLimit?: number;
  /** Pick-ups mode (power-ups spawn mid-arena). */
  pickups?: boolean;
  /** Rival+ ladder index (rivalplus mode). */
  plusIndex?: number;
  /** Survival: round number (1-based) and the HP the player carries in. */
  survival?: { round: number; startHp: number };
  /** Practice room dummy behaviour. */
  practice?: { dummy: 'idle' | 'move' | 'shoot' | 'full' };
  /** Local versus: player 2's build (gamepad). */
  versus?: { p2Loadout: Loadout; p2Paint: Paint; p2Name: string };
  /** Replay playback. */
  replay?: Replay;
  /** Online lockstep match: both builds in world order (host = 0), the room seed and which one is local. */
  online?: { session: NetSession; me: 0 | 1; seed: number; players: [PlayerHello, PlayerHello]; ranked?: boolean };
}

export interface MatchStats {
  damageDealt: number;
  hits: number;
  /** Knockdowns inflicted on the opponent. */
  knockdowns: number;
  knockdownsTaken?: number;
  shots: number;
  /** Actual primary-gun projectiles, including each pellet; excludes turret fire and returned shots. */
  gunProjectiles?: number;
  /** Primary projectiles that damaged the rival (including chip). */
  gunHits?: number;
  gunDamage?: number;
  gunDeflected?: number;
  primes?: number;
  combos?: number;
  comboDamage?: number;
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
  /** Bombs thrown this match. */
  bombsUsed?: number;
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
  /** Online: false when the match desynced or the opponent dropped (never rated). */
  netClean?: boolean;
  /** Recording of the match (absent for practice/replay playback). */
  replay?: Replay;
}
