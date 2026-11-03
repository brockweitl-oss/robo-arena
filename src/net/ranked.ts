import { netUrl, netKey, netName } from './online';
import type { Loadout } from '../data/parts';
import type { TierId } from './season';

/**
 * Ranked seasons, the survival leaderboard and replay share links: small REST calls to the
 * relay server (server/src/index.ts). Every call fails soft (null / [] / silent) so the
 * game works offline and against an older server.
 */

const TIMEOUT = 6000;
async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${netUrl()}${path}`, { signal: AbortSignal.timeout(TIMEOUT) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}
/** text/plain keeps these "simple" requests (no CORS preflight). */
async function postJson<T>(path: string, body: string): Promise<T | null> {
  try {
    const r = await fetch(`${netUrl()}${path}`, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, signal: AbortSignal.timeout(TIMEOUT) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

export interface PrevSeason {
  season: string; rating: number; games: number; wins: number; placed: boolean;
  tier: TierId | null;
  /** Highest tier reached last season (reward). */
  peakTier: TierId | null;
}
export interface MeInfo {
  /** This season's rating / games / wins. */
  rating: number; games: number; wins: number;
  /** Season fields (absent on a pre-season server). */
  season?: string; prev?: string; endsAt?: number; placed?: boolean; peak?: number | null; rank?: string | null;
  lifetime?: { games: number; wins: number };
  prevSeason?: PrevSeason | null;
}
export const fetchMe = () => getJson<MeInfo>(`/me?key=${netKey()}`);

export interface TopRow { name: string; rating: number; games: number; wins: number; season?: string; placed?: boolean; rank?: string | null }
export async function fetchSeasonTop(season?: string): Promise<TopRow[]> {
  const r = await getJson<TopRow[]>(`/top${season ? `?season=${season}` : ''}`);
  return Array.isArray(r) ? r : [];
}

/* ---------------------------------------------------------------- survival */

export interface SurvivalTop {
  season: string;
  top: { name: string; rounds: number; build: Partial<Loadout>; you: boolean }[];
  me: { rounds: number; place: number } | null;
}
export const fetchSurvivalTop = () => getJson<SurvivalTop>(`/survival/top?key=${netKey()}`);

/** Fire-and-forget: report a survival run's completed rounds (the server keeps the season best). */
export function postSurvival(rounds: number, build: Loadout): Promise<unknown> {
  if (!(rounds >= 1)) return Promise.resolve(null);
  const b = { gun: build.gun, bomb: build.bomb, pod: build.pod, body: build.body, legs: build.legs, skill: build.skill };
  return postJson('/survival', JSON.stringify({ key: netKey(), name: netName(), rounds: Math.floor(rounds), build: b }));
}

/* ---------------------------------------------------------------- replay share links */

export const SHARE_CODE = /^[A-Z0-9]{6}$/;
/** Link to this very page (whatever host serves it) that opens the shared replay. */
export function replayShareUrl(code: string): string {
  return `${location.origin}${location.pathname}?replay=${code}`;
}
/** Upload a replay; resolves to its 6-character code, or null if the server refused / is unreachable. */
export async function shareReplay(replay: unknown): Promise<string | null> {
  const text = JSON.stringify(replay);
  if (text.length > 256 * 1024) return null;
  const r = await postJson<{ code?: string }>('/replay', text);
  return r?.code && SHARE_CODE.test(r.code) ? r.code : null;
}
/** Download a shared replay's raw JSON (validate it before playing). */
export function fetchSharedReplay(code: string): Promise<unknown> {
  return SHARE_CODE.test(code) ? getJson<unknown>(`/replay/${code}`) : Promise.resolve(null);
}
