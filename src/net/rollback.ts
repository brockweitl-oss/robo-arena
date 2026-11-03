import { emptyInput, type FighterInput } from '../game/fighter';
import type { GameEvent } from '../game/world';

/**
 * Rollback netcode helpers (pure; the loop itself lives in Match).
 *
 * - The local input for tick t is sampled at tick t - delay and sent at once.
 * - The remote input for a tick that has not arrived is predicted: the last confirmed input,
 *   held buttons and stick kept, one-shot presses dropped.
 * - When a confirmed input differs from what was used, the world is restored to the snapshot
 *   taken before that tick and re-simulated to the present.
 * - Presentation only sees each (tick, event) once; see EventLedger.
 */

/** Ticks the local sim may run ahead of the opponent's confirmed input (~200 ms). */
export const ROLLBACK_WINDOW = 12;
/** The fight starts on this sim tick (same moment the offline "GO" fires: 66 ready ticks). */
export const NET_GO_TICK = 66;

const PRESSES = ['jumpPressed', 'dashPressed', 'gunPressed', 'bombPressed', 'podPressed', 'chargePressed', 'skillPressed'] as const;

/** Predict a tick's remote input from the newest confirmed one. */
export function predictInput(last: FighterInput | undefined): FighterInput {
  if (!last) return emptyInput();
  const p: FighterInput = { ...last };
  for (const k of PRESSES) if (p[k]) p[k] = false;
  delete p.bombTarget;
  delete p.skillTarget;
  return p;
}

const tupleEq = (a?: readonly number[], b?: readonly number[]) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));

/** Whether two quantized inputs drive the sim identically. */
export function sameInput(a: FighterInput, b: FighterInput): boolean {
  return a.moveX === b.moveX && a.moveZ === b.moveZ && a.jumpHeld === b.jumpHeld && a.gunHeld === b.gunHeld && a.faceTarget === b.faceTarget
    && PRESSES.every((k) => !!a[k] === !!b[k]) && tupleEq(a.bombTarget, b.bombTarget) && tupleEq(a.skillTarget, b.skillTarget);
}

/** A presentation identity for an event: same tick + same key = the same moment, already shown. */
export function eventKey(e: GameEvent): string {
  switch (e.type) {
    case 'fighter': return `f${e.who}${e.ev.type}`;
    case 'shot': return `s${e.who}:${e.index}`;
    case 'hit': return `h${e.victim}${e.attacker}${e.source}`;
    case 'explosion': return `x${e.look ?? ''}`;
    case 'impact': return `i${e.proj.owner}`;
    case 'dodge': case 'deflect': case 'blink': return e.type + e.who;
    case 'bombLaunch': case 'podLaunch': case 'intercept': return e.type + e.who;
    case 'prime': case 'combo': case 'primerClear': return e.type + e.victim;
    case 'sweetSpot': return e.type + e.attacker;
    case 'pickupTake': return e.type + e.who;
    case 'trapArm': return e.type + e.trap.index;
    case 'trapFire': return e.type + e.trap.index;
    case 'hazard': return e.type + e.index;
    case 'objective': return `o${e.phase}${e.who}`;
    default: return e.type;
  }
}

/**
 * Which events presentation has already played, per tick. A re-simulated tick only plays events
 * that were not predicted (a hit that the prediction missed); predicted events that did not happen
 * simply finish fading. Repeats within one tick are told apart by their running count.
 */
export class EventLedger {
  private shown = new Map<number, Map<string, number>>();

  /** Filter a tick's events to the ones not yet shown, and record them. */
  fresh(tick: number, events: readonly GameEvent[]): GameEvent[] {
    let seen = this.shown.get(tick);
    if (!seen) this.shown.set(tick, (seen = new Map()));
    const count = new Map<string, number>();
    const out: GameEvent[] = [];
    for (const e of events) {
      const k = eventKey(e);
      const n = (count.get(k) ?? 0) + 1;
      count.set(k, n);
      if ((seen.get(k) ?? 0) >= n) continue;
      seen.set(k, n);
      out.push(e);
    }
    return out;
  }

  /** Forget ticks that can no longer be re-simulated. */
  prune(before: number) {
    for (const t of this.shown.keys()) if (t < before) this.shown.delete(t);
  }
}
