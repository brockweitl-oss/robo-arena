import * as THREE from 'three';
import type { Collider, RampCollider, BoxCollider } from '../arena/types';

export const STEP_HEIGHT = 0.38;
export const SNAP_DOWN = 0.45;

export function rampHeight(r: RampCollider, x: number, z: number): number {
  const a = r.axis === 'x' ? x : z;
  const lo = r.axis === 'x' ? r.min.x : r.min.z;
  const hi = r.axis === 'x' ? r.max.x : r.max.z;
  let t = THREE.MathUtils.clamp((a - lo) / (hi - lo), 0, 1);
  if (r.dir < 0) t = 1 - t;
  return r.min.y + t * (r.max.y - r.min.y);
}

/** Top surface height of a collider at (x,z), or null if (x,z) is outside its footprint (with margin). */
export function surfaceAt(c: Collider, x: number, z: number, margin = 0): number | null {
  if (x < c.min.x - margin || x > c.max.x + margin || z < c.min.z - margin || z > c.max.z + margin) return null;
  if (c.kind === 'box') return c.max.y;
  return rampHeight(c, THREE.MathUtils.clamp(x, c.min.x, c.max.x), THREE.MathUtils.clamp(z, c.min.z, c.max.z));
}

export interface MoveResult {
  grounded: boolean;
  ground: Collider | null;
  hitWall: boolean;
  hitCeiling: boolean;
  /** Fell from height: downward speed at the moment of landing (positive). */
  landSpeed: number;
}

/**
 * Move a vertical cylinder (feet at pos, radius r, height h) through the world.
 * Horizontal then vertical resolution; supports step-up, ledge snap-down, ramps and moving boxes.
 */
export function moveAndCollide(
  pos: THREE.Vector3,
  vel: THREE.Vector3,
  dt: number,
  r: number,
  h: number,
  colliders: Collider[],
  wasGrounded: boolean,
  halfX: number,
  halfZ: number,
): MoveResult {
  const res: MoveResult = { grounded: false, ground: null, hitWall: false, hitCeiling: false, landSpeed: 0 };
  const prevFeet = pos.y;
  const prevHead = pos.y + h;

  // ---- horizontal ----
  pos.x += vel.x * dt;
  pos.z += vel.z * dt;
  for (let iter = 0; iter < 2; iter++) {
    for (const c of colliders) {
      const feet = pos.y;
      const head = pos.y + h;
      // vertical overlap test: can we step onto it?
      let top: number;
      if (c.kind === 'box') top = c.max.y;
      else {
        const sh = surfaceAt(c, pos.x, pos.z, r);
        if (sh === null) continue;
        top = sh;
      }
      if (feet >= top - STEP_HEIGHT || head <= c.min.y) continue;
      // circle vs rect in XZ
      const cx = THREE.MathUtils.clamp(pos.x, c.min.x, c.max.x);
      const cz = THREE.MathUtils.clamp(pos.z, c.min.z, c.max.z);
      let dx = pos.x - cx;
      let dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (c.kind === 'ramp') {
        // walking up the ramp from its low end is not a wall
        const lowSide = c.dir > 0 ? (c.axis === 'x' ? pos.x < c.min.x + r : pos.z < c.min.z + r) : c.axis === 'x' ? pos.x > c.max.x - r : pos.z > c.max.z - r;
        if (lowSide && feet >= c.min.y - 0.05 && feet >= top - STEP_HEIGHT * 1.5) continue;
      }
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = r - d;
        pos.x += (dx / d) * push;
        pos.z += (dz / d) * push;
        // remove velocity into the wall
        const nx = dx / d;
        const nz = dz / d;
        const vn = vel.x * nx + vel.z * nz;
        if (vn < 0) {
          vel.x -= vn * nx;
          vel.z -= vn * nz;
        }
      } else {
        // center inside: push out along the shallowest axis
        const ex = [pos.x - c.min.x, c.max.x - pos.x];
        const ez = [pos.z - c.min.z, c.max.z - pos.z];
        const m = Math.min(ex[0], ex[1], ez[0], ez[1]);
        if (m === ex[0]) {
          pos.x = c.min.x - r;
          vel.x = Math.min(vel.x, 0);
        } else if (m === ex[1]) {
          pos.x = c.max.x + r;
          vel.x = Math.max(vel.x, 0);
        } else if (m === ez[0]) {
          pos.z = c.min.z - r;
          vel.z = Math.min(vel.z, 0);
        } else {
          pos.z = c.max.z + r;
          vel.z = Math.max(vel.z, 0);
        }
      }
      res.hitWall = true;
    }
  }

  // ---- arena bounds ----
  const bx = halfX - r;
  const bz = halfZ - r;
  if (pos.x > bx) { pos.x = bx; vel.x = Math.min(0, vel.x); res.hitWall = true; }
  if (pos.x < -bx) { pos.x = -bx; vel.x = Math.max(0, vel.x); res.hitWall = true; }
  if (pos.z > bz) { pos.z = bz; vel.z = Math.min(0, vel.z); res.hitWall = true; }
  if (pos.z < -bz) { pos.z = -bz; vel.z = Math.max(0, vel.z); res.hitWall = true; }

  // ---- vertical ----
  const vyBefore = vel.y;
  pos.y += vel.y * dt;
  // find the best support under the feet
  let best: Collider | null = null;
  let bestH = -Infinity;
  const margin = r * 0.55;
  for (const c of colliders) {
    const sh = surfaceAt(c, pos.x, pos.z, margin);
    if (sh === null) continue;
    if (sh > prevFeet + STEP_HEIGHT) continue; // too high to stand on from here
    if (sh > bestH) {
      bestH = sh;
      best = c;
    }
  }
  if (best) {
    const snap = wasGrounded && vel.y <= 0.01 ? SNAP_DOWN : 0;
    if (vel.y <= 0.01 && pos.y <= bestH + snap) {
      if (!wasGrounded) res.landSpeed = Math.max(0, -vyBefore);
      pos.y = bestH;
      vel.y = 0;
      res.grounded = true;
      res.ground = best;
    }
  }
  // ceilings
  if (vel.y > 0) {
    for (const c of colliders) {
      if (c.kind !== 'box') continue;
      if (pos.x < c.min.x - margin * 0.5 || pos.x > c.max.x + margin * 0.5 || pos.z < c.min.z - margin * 0.5 || pos.z > c.max.z + margin * 0.5) continue;
      if (prevHead <= c.min.y + 0.01 && pos.y + h > c.min.y) {
        pos.y = c.min.y - h;
        vel.y = 0;
        res.hitCeiling = true;
      }
    }
  }
  // safety floor
  if (pos.y < -5) {
    pos.y = 0;
    vel.y = 0;
  }
  return res;
}

/** Point-in-solid test (for projectiles). */
export function pointInSolid(p: THREE.Vector3, colliders: Collider[], shotsOnly = true): Collider | null {
  for (const c of colliders) {
    if (c.kind === 'box' && shotsOnly && (c as BoxCollider).blocksShots === false) continue;
    if (p.x < c.min.x || p.x > c.max.x || p.z < c.min.z || p.z > c.max.z || p.y < c.min.y) continue;
    const top = c.kind === 'box' ? c.max.y : rampHeight(c, p.x, p.z);
    if (p.y <= top) return c;
  }
  return null;
}

const _d = new THREE.Vector3();
/**
 * Segment vs solids. Returns the hit point and an approximate surface normal, or null.
 * Uses slab tests for boxes and sampled tests for ramps.
 */
export function segmentHit(a: THREE.Vector3, b: THREE.Vector3, colliders: Collider[]): { point: THREE.Vector3; normal: THREE.Vector3; collider: Collider } | null {
  _d.copy(b).sub(a);
  let bestT = Infinity;
  let bestN: THREE.Vector3 | null = null;
  let bestC: Collider | null = null;
  for (const c of colliders) {
    if (c.kind === 'box') {
      if ((c as BoxCollider).blocksShots === false) continue;
      let tmin = 0;
      let tmax = 1;
      let nAxis = -1;
      let nSign = 0;
      let ok = true;
      for (let ax = 0; ax < 3; ax++) {
        const o = ax === 0 ? a.x : ax === 1 ? a.y : a.z;
        const d = ax === 0 ? _d.x : ax === 1 ? _d.y : _d.z;
        const lo = ax === 0 ? c.min.x : ax === 1 ? c.min.y : c.min.z;
        const hi = ax === 0 ? c.max.x : ax === 1 ? c.max.y : c.max.z;
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) { ok = false; break; }
        } else {
          let t1 = (lo - o) / d;
          let t2 = (hi - o) / d;
          let s = -1;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
          if (t1 > tmin) { tmin = t1; nAxis = ax; nSign = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { ok = false; break; }
        }
      }
      if (ok && tmin < bestT && nAxis >= 0) {
        bestT = tmin;
        bestN = new THREE.Vector3(nAxis === 0 ? nSign : 0, nAxis === 1 ? nSign : 0, nAxis === 2 ? nSign : 0);
        bestC = c;
      }
    } else {
      // sample along the segment
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = a.x + _d.x * t;
        const y = a.y + _d.y * t;
        const z = a.z + _d.z * t;
        if (x < c.min.x || x > c.max.x || z < c.min.z || z > c.max.z || y < c.min.y) continue;
        if (y <= rampHeight(c, x, z) && t < bestT) {
          bestT = t;
          bestN = new THREE.Vector3(0, 1, 0);
          bestC = c;
          break;
        }
      }
    }
  }
  if (!bestC || !bestN) return null;
  return { point: a.clone().addScaledVector(_d, bestT), normal: bestN, collider: bestC };
}

/** Height of the walkable surface directly below a point (for shadows/AI). */
export function groundHeightBelow(x: number, z: number, y: number, colliders: Collider[]): number {
  let best = 0;
  for (const c of colliders) {
    const sh = surfaceAt(c, x, z, 0);
    if (sh !== null && sh <= y + 0.05 && sh > best) best = sh;
  }
  return best;
}
