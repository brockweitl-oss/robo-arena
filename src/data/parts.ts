/**
 * Data-driven part catalog. Every part is a plain config object.
 * To add a part: add an entry to the matching record below (and, for a new
 * visual `model`, a builder case in src/robot/weapons.ts or src/robot/frames.ts).
 */

export type Slot = 'gun' | 'bomb' | 'pod' | 'body' | 'legs';

export interface PartBase {
  id: string;
  slot: Slot;
  name: string;
  desc: string;
  /** Short stat blurbs shown in the garage. 1..5 */
  ratings: Record<string, number>;
}

export interface GunDef extends PartBase {
  slot: 'gun';
  model: 'blaster' | 'rail' | 'scatter';
  /** Shots per trigger pull. */
  burst: number;
  /** Seconds between shots in a burst. */
  burstInterval: number;
  /** Pellets fired per shot (spread). */
  pellets: number;
  spreadDeg: number;
  /** Seconds from end of burst until the gun can fire again. */
  cooldown: number;
  /** Wind-up before the first shot (rail charge). */
  windup: number;
  damage: number;
  down: number;
  speed: number;
  /** Homing turn rate in rad/s (soft tracking). */
  homing: number;
  /** Homing stops after this many seconds. */
  homingTime: number;
  life: number;
  radius: number;
  color: number;
  coreColor: number;
  /** Fighter slows to this fraction of speed while firing on the ground. */
  groundSlow: number;
  sfx: 'gun_blaster' | 'gun_rail' | 'gun_scatter';
  knockback: number;
}

export interface BombDef extends PartBase {
  slot: 'bomb';
  model: 'mortar' | 'cluster';
  count: number;
  /** Seconds in the air. */
  flightTime: number;
  /** Horizontal scatter of the landing points (m). */
  scatter: number;
  damage: number;
  down: number;
  blastRadius: number;
  cooldown: number;
  bounces: number;
  color: number;
  /** Max lob range in meters. */
  range: number;
}

export interface PodDef extends PartBase {
  slot: 'pod';
  model: 'seeker' | 'mine';
  count: number;
  speed: number;
  turnRate: number;
  life: number;
  armTime: number;
  triggerRadius: number;
  /** Fuse after triggering. */
  fuse: number;
  damage: number;
  down: number;
  blastRadius: number;
  cooldown: number;
  hp: number;
  hoverHeight: number;
  color: number;
}

export interface ChargeDef {
  windup: number;
  lunge: number;
  recover: number;
  speed: number;
  damage: number;
  down: number;
  cooldown: number;
  /** Ignores flinch during the lunge. */
  armor: boolean;
}

export interface BodyDef extends PartBase {
  slot: 'body';
  frame: 'striker' | 'ironclad' | 'wisp' | 'regent';
  hp: number;
  runSpeed: number;
  dashSpeed: number;
  jumpVel: number;
  airJumpVel: number;
  hoverTime: number;
  /** Knockback multiplier received (heavier = less). */
  weight: number;
  charge: ChargeDef;
  chargeName: string;
}

export interface LegsDef extends PartBase {
  slot: 'legs';
  model: 'stride' | 'hopper';
  speedMul: number;
  jumpMul: number;
  airJumps: number;
  airDashes: number;
  dashMul: number;
  hoverMul: number;
}

export type AnyPart = GunDef | BombDef | PodDef | BodyDef | LegsDef;

export const GUNS: Record<string, GunDef> = {
  pulse: {
    id: 'pulse', slot: 'gun', name: 'Pulse Blaster', model: 'blaster',
    desc: 'Reliable 3-round burst. Gentle tracking curves shots toward the target.',
    ratings: { Power: 2, Speed: 4, Tracking: 3, Reload: 4 },
    burst: 3, burstInterval: 0.13, pellets: 1, spreadDeg: 0, cooldown: 0.8, windup: 0,
    damage: 34, down: 17, speed: 34, homing: 1.9, homingTime: 0.5, life: 1.5, radius: 0.22,
    color: 0x2fd6ff, coreColor: 0xe8fdff, groundSlow: 0.45, sfx: 'gun_blaster', knockback: 2.5,
  },
  scatter: {
    id: 'scatter', slot: 'gun', name: 'Scatter Fan', model: 'scatter',
    desc: 'Fans five pellets. Brutal up close, weak at range. Hard to dodge.',
    ratings: { Power: 4, Speed: 3, Tracking: 1, Reload: 3 },
    burst: 2, burstInterval: 0.22, pellets: 5, spreadDeg: 22, cooldown: 1.05, windup: 0,
    damage: 19, down: 9, speed: 28, homing: 0.6, homingTime: 0.35, life: 0.55, radius: 0.2,
    color: 0xffb03a, coreColor: 0xfff3d0, groundSlow: 0.3, sfx: 'gun_scatter', knockback: 2,
  },
  rail: {
    id: 'rail', slot: 'gun', name: 'Rail Lance', model: 'rail',
    desc: 'Charges, then fires one hypersonic slug. Huge down damage. Commit carefully.',
    ratings: { Power: 5, Speed: 5, Tracking: 1, Reload: 1 },
    burst: 1, burstInterval: 0, pellets: 1, spreadDeg: 0, cooldown: 1.7, windup: 0.5,
    damage: 135, down: 60, speed: 72, homing: 0.9, homingTime: 0.15, life: 0.6, radius: 0.28,
    color: 0xc46bff, coreColor: 0xffffff, groundSlow: 0.1, sfx: 'gun_rail', knockback: 9,
  },
};

export const BOMBS: Record<string, BombDef> = {
  mortar: {
    id: 'mortar', slot: 'bomb', name: 'Arc Mortar', model: 'mortar',
    desc: 'One heavy shell lobbed high. Wide blast flushes enemies out of cover.',
    ratings: { Power: 4, Radius: 4, Speed: 2, Reload: 2 },
    count: 1, flightTime: 1.0, scatter: 0, damage: 120, down: 55, blastRadius: 3.4, cooldown: 2.9,
    bounces: 0, color: 0xff5a2a, range: 30,
  },
  cluster: {
    id: 'cluster', slot: 'bomb', name: 'Cluster Hopper', model: 'cluster',
    desc: 'Three bouncing bomblets that scatter around the target. Area denial.',
    ratings: { Power: 2, Radius: 3, Speed: 3, Reload: 3 },
    count: 3, flightTime: 0.75, scatter: 3.2, damage: 60, down: 30, blastRadius: 2.4, cooldown: 3.1,
    bounces: 1, color: 0x9dff4a, range: 26,
  },
};

export const PODS: Record<string, PodDef> = {
  seeker: {
    id: 'seeker', slot: 'pod', name: 'Seeker Pod', model: 'seeker',
    desc: 'A slow drone that hunts the target. Forces movement. Can be shot down.',
    ratings: { Power: 3, Speed: 2, Tracking: 4, Reload: 2 },
    count: 1, speed: 5.2, turnRate: 1.7, life: 7, armTime: 0.4, triggerRadius: 1.2, fuse: 0,
    damage: 95, down: 50, blastRadius: 2.6, cooldown: 4.5, hp: 40, hoverHeight: 1.2, color: 0xff3b6b,
  },
  mine: {
    id: 'mine', slot: 'pod', name: 'Drift Mines', model: 'mine',
    desc: 'Two floating mines that creep toward the enemy and detonate when close.',
    ratings: { Power: 3, Speed: 1, Tracking: 2, Reload: 3 },
    count: 2, speed: 2.6, turnRate: 1.2, life: 10, armTime: 0.8, triggerRadius: 2.6, fuse: 0.45,
    damage: 80, down: 45, blastRadius: 3.0, cooldown: 4.0, hp: 30, hoverHeight: 1.6, color: 0xffe14a,
  },
};

export const BODIES: Record<string, BodyDef> = {
  striker: {
    id: 'striker', slot: 'body', frame: 'striker', name: 'Kestrel Frame',
    desc: 'Balanced all-rounder. Quick dash, solid armor, a snapping dash-punch.',
    ratings: { Armor: 3, Speed: 4, Jump: 3, Weight: 3 },
    hp: 1000, runSpeed: 10.5, dashSpeed: 24, jumpVel: 14, airJumpVel: 12.5, hoverTime: 1.1, weight: 1,
    charge: { windup: 0.3, lunge: 0.3, recover: 0.38, speed: 22, damage: 110, down: 55, cooldown: 1.6, armor: false },
    chargeName: 'Comet Punch',
  },
  ironclad: {
    id: 'ironclad', slot: 'body', frame: 'ironclad', name: 'Ironclad Frame',
    desc: 'Heavy plating, slow and stubborn. Shoulder ram shrugs off light fire.',
    ratings: { Armor: 5, Speed: 2, Jump: 2, Weight: 5 },
    hp: 1250, runSpeed: 9.0, dashSpeed: 21, jumpVel: 13, airJumpVel: 11, hoverTime: 0.8, weight: 0.65,
    charge: { windup: 0.38, lunge: 0.38, recover: 0.45, speed: 20, damage: 140, down: 70, cooldown: 2.0, armor: true },
    chargeName: 'Bulldozer Ram',
  },
  wisp: {
    id: 'wisp', slot: 'body', frame: 'wisp', name: 'Wisp Frame',
    desc: 'Featherweight flyer. Long hover, fragile shell, slicing air kick.',
    ratings: { Armor: 2, Speed: 5, Jump: 5, Weight: 1 },
    hp: 850, runSpeed: 11.5, dashSpeed: 26, jumpVel: 15, airJumpVel: 13.5, hoverTime: 1.9, weight: 1.35,
    charge: { windup: 0.26, lunge: 0.26, recover: 0.32, speed: 25, damage: 85, down: 45, cooldown: 1.3, armor: false },
    chargeName: 'Swallow Kick',
  },
  regent: {
    id: 'regent', slot: 'body', frame: 'regent', name: 'Regent Frame',
    desc: "The champion's chassis. Excellent in every way, with a crescent blade rush.",
    ratings: { Armor: 4, Speed: 4, Jump: 4, Weight: 3 },
    hp: 1100, runSpeed: 11, dashSpeed: 25, jumpVel: 14.5, airJumpVel: 13, hoverTime: 1.4, weight: 0.9,
    charge: { windup: 0.28, lunge: 0.32, recover: 0.34, speed: 24, damage: 125, down: 60, cooldown: 1.5, armor: true },
    chargeName: 'Crescent Rush',
  },
};

export const LEGS: Record<string, LegsDef> = {
  stride: {
    id: 'stride', slot: 'legs', name: 'Stride Legs', model: 'stride',
    desc: 'Standard servo legs. One air jump, one air dash, steady hover.',
    ratings: { Speed: 3, Jump: 3, Air: 3 },
    speedMul: 1, jumpMul: 1, airJumps: 1, airDashes: 1, dashMul: 1, hoverMul: 1,
  },
  hopper: {
    id: 'hopper', slot: 'legs', name: 'Hopper Legs', model: 'hopper',
    desc: 'Reverse-joint spring legs. Two air jumps and a higher leap, slightly slower run.',
    ratings: { Speed: 2, Jump: 5, Air: 4 },
    speedMul: 0.94, jumpMul: 1.14, airJumps: 2, airDashes: 1, dashMul: 0.95, hoverMul: 0.8,
  },
};

export const ALL_PARTS: Record<Slot, Record<string, AnyPart>> = {
  gun: GUNS,
  bomb: BOMBS,
  pod: PODS,
  body: BODIES,
  legs: LEGS,
};

export interface Loadout {
  gun: string;
  bomb: string;
  pod: string;
  body: string;
  legs: string;
}

export const DEFAULT_LOADOUT: Loadout = { gun: 'pulse', bomb: 'mortar', pod: 'seeker', body: 'striker', legs: 'stride' };

/** Parts the player owns from the start. */
export const STARTER_PARTS = ['gun:pulse', 'bomb:mortar', 'pod:seeker', 'body:striker', 'legs:stride'];

export function resolveLoadout(l: Loadout) {
  return {
    gun: GUNS[l.gun] ?? GUNS.pulse,
    bomb: BOMBS[l.bomb] ?? BOMBS.mortar,
    pod: PODS[l.pod] ?? PODS.seeker,
    body: BODIES[l.body] ?? BODIES.striker,
    legs: LEGS[l.legs] ?? LEGS.stride,
  };
}
export type ResolvedLoadout = ReturnType<typeof resolveLoadout>;
