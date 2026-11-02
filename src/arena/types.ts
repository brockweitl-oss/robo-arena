import * as THREE from 'three';

/**
 * Collision primitives used by the fighter simulation.
 * All coordinates are world-space meters. Y is up. Robots are ~1.6 m tall.
 *
 * - 'box': solid axis-aligned box. Its top is walkable, its sides block.
 * - 'ramp': solid wedge inside [min,max]. The top surface rises linearly from
 *   min.y at the low end to max.y at the high end along `axis` in direction `dir`
 *   (dir = +1 means height increases as the axis coordinate increases).
 *
 * Moving colliders: the arena's `tick()` may mutate min/max each sim step and
 * must set `vel` (m/s) so riders get carried along.
 */
export interface BoxCollider {
  kind: 'box';
  min: THREE.Vector3;
  max: THREE.Vector3;
  vel?: THREE.Vector3;
  /** Blocks projectiles too (default true). */
  blocksShots?: boolean;
}

export interface RampCollider {
  kind: 'ramp';
  min: THREE.Vector3;
  max: THREE.Vector3;
  axis: 'x' | 'z';
  dir: 1 | -1;
}

export type Collider = BoxCollider | RampCollider;

/** A periodic damage zone (e.g. a floor vent, an arc coil). */
export interface Hazard {
  /** Circle on the XZ plane. Fighters whose feet are within [yMin, yMax] get hit. */
  center: THREE.Vector3;
  radius: number;
  yMin: number;
  yMax: number;
  damage: number;
  /** Down-gauge added per hit (0..100). */
  down: number;
  /** True while the zone deals damage (evaluated with sim time in seconds). */
  isActive(t: number): boolean;
  /** True during the telegraph period before activation (for HUD/AI). */
  isWarning(t: number): boolean;
  /** Upward launch velocity applied on hit (m/s). */
  launch?: number;
}

export interface ArenaInfo {
  id: string;
  name: string;
  subtitle: string;
  /** Short description shown in Free Battle. */
  blurb: string;
  /** Music track id understood by the audio module. */
  music: string;
  /** Swatch color for menus (CSS). */
  accent: string;
}

export interface ArenaBuild {
  info: ArenaInfo;
  /** Everything visual (meshes, lights, particles). Added to the match scene. */
  root: THREE.Group;
  /** Collision. Floor must be included as a box (top at y = 0). */
  colliders: Collider[];
  hazards: Hazard[];
  /** Player spawn, opponent spawn (landing targets for the intro capsules). */
  spawns: [THREE.Vector3, THREE.Vector3];
  /** Invisible walls: fighters are clamped to |x| <= halfX, |z| <= halfZ. */
  halfX: number;
  halfZ: number;
  /** Scene setup — background color/texture, fog, environment map. */
  background: THREE.Color | THREE.Texture;
  environment: THREE.Texture | null;
  fog: THREE.Fog | THREE.FogExp2 | null;
  /** The main shadow-casting light, so the renderer can tune its shadow map. */
  keyLight: THREE.DirectionalLight;
  /** Deterministic sim step (60 Hz). Move platforms/colliders here. t = seconds since match start. */
  tick(t: number, dt: number): void;
  /** Per-frame visual animation (fans, lights, particles). Not deterministic. */
  update(time: number, dt: number): void;
  dispose(): void;
}

export type ArenaFactory = (opts: { quality: 'low' | 'medium' | 'high'; renderer: THREE.WebGLRenderer }) => ArenaBuild;
