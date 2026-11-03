/**
 * Post-match "How to win this" insights.
 *
 * Pure functions over a MatchResult: they read the stats the match already records and
 * turn the clearest gaps into 2–3 concrete, actionable tips, plus a compact you-vs-them
 * stat table. No randomness: the same result always gives the same advice.
 */
import { resolveLoadout, type Loadout } from '../data/parts';
import type { MatchResult, MatchStats } from './types';

export interface Insight {
  id: string;
  /** Short headline, e.g. "Rail accuracy 18%". */
  title: string;
  /** One or two sentences of advice. */
  text: string;
  /** Higher = more important; used to rank. */
  weight: number;
}

export interface StatRow {
  label: string;
  /** Player value and opponent value (accuracy as 0..100). */
  you: number;
  them: number;
  /** Display suffix ('%' for accuracy). */
  unit?: string;
  /** Is a higher number better for this row? */
  higherBetter: boolean;
}

const sum = (m?: Record<string, number>) => Object.values(m ?? {}).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/** Gun accuracy 0..100 (null when too few shots to judge). */
export function gunAccuracy(s: MatchStats | undefined, minShots = 1): number | null {
  const n = s?.gunProjectiles ?? 0;
  if (n < minShots) return null;
  return pct(s?.gunHits ?? 0, n);
}

/** You-vs-opponent comparison rows for the results screen. */
export function statComparison(res: MatchResult): StatRow[] {
  const p = res.player ?? ({} as MatchStats), r = res.rival ?? ({} as MatchStats);
  return [
    { label: 'Damage', you: Math.round(p.damageDealt ?? 0), them: Math.round(r.damageDealt ?? 0), higherBetter: true },
    { label: 'Accuracy', you: gunAccuracy(p) ?? 0, them: gunAccuracy(r) ?? 0, unit: '%', higherBetter: true },
    { label: 'Parries', you: p.parries ?? 0, them: r.parries ?? 0, higherBetter: true },
    { label: 'Combos', you: p.combos ?? 0, them: r.combos ?? 0, higherBetter: true },
    { label: 'Dodges', you: p.dodges ?? 0, them: r.dodges ?? 0, higherBetter: true },
    { label: 'Knockdowns', you: p.knockdowns ?? 0, them: r.knockdowns ?? 0, higherBetter: true },
  ];
}

/** Advice for closing distance with a particular gun before firing. */
function gunAdvice(gunId: string, gunName: string): string {
  switch (gunId) {
    case 'rail': return `${gunName} cannot curve after it fires. Shoot it as the rival lands or recovers from a dash, not while they strafe.`;
    case 'scatter': return `${gunName} is a point-blank weapon. Close the gap with a dash first, then fire as the dash ends.`;
    case 'beam': return `Charge ${gunName} behind cover, then release when the rival commits to an attack or a landing.`;
    case 'homer': return `${gunName} curves in from the sides. Fire it while the rival dashes straight, so the arc meets them.`;
    default: return `Close the distance with a dash, then fire as the dash ends: mid-range bursts land far more often.`;
  }
}

/**
 * The 2–3 most useful tips from a finished match, most important first.
 * `loadout` is the player's build (defaults to the config's).
 */
export function matchInsights(res: MatchResult, loadout?: Loadout, max = 3): Insight[] {
  const p = res.player ?? ({} as MatchStats), r = res.rival ?? ({} as MatchStats);
  const lo = resolveLoadout(loadout ?? res.config.playerLoadout);
  const out: Insight[] = [];
  const time = Math.max(1, res.time);
  const taken = Math.max(1, sum(r.damageBy) || (res.playerMaxHp - res.playerHp));
  const by = r.damageBy ?? {};
  const share = (k: string) => (by[k] ?? 0) / taken;

  // 1. gun accuracy
  const acc = gunAccuracy(p, 8);
  if (acc !== null && acc < 30) {
    out.push({ id: 'accuracy', title: `${lo.gun.name} accuracy ${acc}%`, text: gunAdvice(lo.gun.id, lo.gun.name), weight: 40 + (30 - acc) * 1.5 });
  }

  // 2. parried by the rival
  const parried = r.parries ?? 0;
  if (parried >= 2) {
    out.push({ id: 'parried', title: `Parried ${parried} times`, text: 'Their guard is timed for your attacks. Feint your skill (dash during the wind-up) or throw a bomb to bait the guard, then attack when it drops.', weight: 35 + parried * 8 });
  }

  // 3. damage taken by source
  const ranked = Object.keys(by).filter((k) => share(k) >= 0.3 && (by[k] ?? 0) >= 60).sort((a, b) => share(b) - share(a));
  for (const src of ranked.slice(0, 1)) {
    const s = Math.round(share(src) * 100);
    const t: Record<string, [string, string]> = {
      bomb: ['Bombs', 'Strafe out sideways the moment the red landing ring appears; the shell lands where the ring is, not where you are.'],
      skill: ['Skill shots', 'A red lane on the ground means a skill shot is coming. Dash across the lane, not along it.'],
      charge: ['Charge rushes', 'Start your own charge just before their rush connects: the first instant of a charge parries it and leaves them open.'],
      pod: ['Pods', 'Shoot pods down before they reach you, or keep moving so seekers lose the chase.'],
      gun: ['Gunfire', 'Keep moving sideways and use cover. Their gun tracks straight lines; break line of sight between bursts.'],
      fire: ['Fire pools', 'Burning ground keeps ticking. Jump or hover over the pool and never fight standing in it.'],
      hazard: ['Arena hazards', 'Watch the floor warnings and leave the marked zone before it fires. Try luring the rival into it instead.'],
    };
    const [name, text] = t[src] ?? [src, 'Watch for this attack and dodge as it starts.'];
    out.push({ id: `taken-${src}`, title: `${name}: ${s}% of damage taken`, text, weight: 30 + s * 0.6 });
  }

  // 4. knocked down a lot
  const kdTaken = p.knockdownsTaken ?? r.knockdowns ?? 0;
  if (kdTaken >= 3) {
    out.push({ id: 'knockdowns', title: `Knocked down ${kdTaken} times`, text: 'Press charge as you stand up for a wake-up attack, or dash away the moment your get-up invulnerability ends.', weight: 28 + kdTaken * 4 });
  }

  // 5. never used the pod / bomb
  if (time > 25 && (p.podsUsed ?? -1) === 0) {
    out.push({ id: 'no-pod', title: `${lo.pod.name} never launched`, text: `Launch your pod (E / RB) early and often: it forces the rival to move and opens them up for your gun.`, weight: 26 });
  }
  if (time > 25 && (p.bombsUsed ?? -1) === 0) {
    out.push({ id: 'no-bomb', title: `${lo.bomb.name} never thrown`, text: 'Hold the bomb button to aim, release to throw. Bombs flush rivals out of cover and prime them for a combo.', weight: 24 });
  }

  // 6. primed but never detonated
  if ((p.primes ?? 0) >= 2 && (p.combos ?? 0) === 0) {
    out.push({ id: 'combo', title: `${p.primes} primes, 0 combos`, text: `A clean bomb or pod blast primes the rival for 2 seconds. Follow up with ${lo.skill.name} or a direct gun hit while the marker is lit.`, weight: 30 });
  }

  // 7. skill shots whiffing
  const casts = (p as MatchStats & { skillCasts?: number }).skillCasts ?? 0;
  const skillHits = (p as MatchStats & { skillHits?: number }).skillHits ?? 0;
  if (casts >= 4 && skillHits / casts < 0.25) {
    out.push({ id: 'skill', title: `${lo.skill.name}: ${skillHits}/${casts} hits`, text: 'Aim the skill where the rival will land or recover, not where they are. Fire it after a knockdown or a parry.', weight: 22 + casts });
  }

  // 8. optional match extras (filled in by other systems when present)
  const ext = p as MatchStats & { overheats?: number; objective?: number; objectiveRival?: number };
  if ((ext.overheats ?? 0) >= 2) {
    out.push({ id: 'heat', title: `Overheated ${ext.overheats} times`, text: 'Fire in shorter bursts and let the heat bar drop before you commit; an overheated gun leaves you defenceless.', weight: 30 + (ext.overheats ?? 0) * 4 });
  }
  const capsYou = p.captures ?? ext.objective, capsRival = r.captures ?? ext.objectiveRival;
  if (capsYou !== undefined && capsRival !== undefined && capsRival > capsYou) {
    out.push({ id: 'objective', title: `Overcharge Core: ${capsYou}–${capsRival}`, text: 'The rival took more cores. Be on the pad when the 5-second warning shows, and break their capture with a bomb or a dash in: two seconds alone on it buys a skill reset and Overdrive.', weight: 32 + (capsRival - capsYou) * 4 });
  }

  // 9. guard never used against charge-heavy rivals
  if ((p.parries ?? 0) === 0 && (p.deflects ?? 0) === 0 && share('charge') >= 0.15 && !out.some((i) => i.id === 'taken-charge')) {
    out.push({ id: 'guard', title: 'No guards or parries', text: 'Your charge guards while it winds up: shots from the front bounce off. Start it just before their hit lands for a parry and a free punish.', weight: 20 });
  }

  out.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const top = out.slice(0, max);
  if (top.length < 2) {
    if (res.outcome === 'win') top.push({ id: 'keep', title: 'Clean fight', text: 'Keep punishing their committed attacks. Try a harder rival or a set with counter-picks next.', weight: 1 });
    else top.push({ id: 'punish', title: 'Close fight', text: 'Wait for their committed shots and charges, dodge, then punish the recovery with your gun or skill.', weight: 1 });
  }
  return top.slice(0, max);
}
