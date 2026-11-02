import * as THREE from 'three';
import type { Fighter } from './fighter';
import type { Collider } from '../arena/types';
import { groundHeightBelow, segmentHit } from './collision';

export const BOMB_GRAVITY = 22;
const DT = 1 / 60;

/** First flight only: bouncers may subsequently bounce and home. Uses the simulation integrator. */
export function plannedBomb(f: Fighter, goal: THREE.Vector3, colliders: Collider[], index = 0) {
  const def = f.lo.bomb;
  const from = f.pos.clone().add(new THREE.Vector3(Math.sin(f.yaw) * .1 + Math.cos(f.yaw) * .3, 1.9, Math.cos(f.yaw) * .1 - Math.sin(f.yaw) * .3));
  const target = goal.clone();
  if (def.count > 1) {
    const a = index / def.count * Math.PI * 2 + f.yaw;
    target.x += Math.cos(a) * def.scatter * (index === 0 ? .15 : 1);
    target.z += Math.sin(a) * def.scatter * (index === 0 ? .15 : 1);
  }
  const flat = target.clone().sub(from).setY(0);
  if (flat.length() > def.range) flat.setLength(def.range);
  target.x = from.x + flat.x; target.z = from.z + flat.z;
  target.y = groundHeightBelow(target.x, target.z, Math.max(goal.y, f.pos.y) + .15, colliders);
  const flightTime = Math.ceil((def.flightTime * (.85 + Math.min(1, flat.length() / def.range) * .3) + index * .06) / DT) * DT;
  const velocity = new THREE.Vector3(flat.x / flightTime, (target.y - from.y) / flightTime + .5 * BOMB_GRAVITY * (flightTime + DT), flat.z / flightTime);
  const points = [from.clone()], p = from.clone(), v = velocity.clone();
  let firstImpact: THREE.Vector3 | null = null;
  for (let tick = 0; tick < Math.round(flightTime / DT); tick++) {
    const prev = p.clone(); v.y -= BOMB_GRAVITY * DT; p.addScaledVector(v, DT);
    const hit = segmentHit(prev, p, colliders);
    if (hit) { firstImpact = hit.point.clone(); points.push(firstImpact); break; }
    points.push(p.clone());
  }
  return { from, velocity, target, flightTime, points, firstImpact, obstructed: !!firstImpact && firstImpact.distanceTo(target) > .25 };
}
