/**
 * Data-driven part catalog. Every part is a plain config object.
 * To add a part: add an entry to the matching record below (and, for a new
 * visual `model`, a builder case in src/robot/weapons.ts / legs.ts / frames.ts).
 *
 * Balance philosophy (play-test 1 feedback: competitive, no dominant meta):
 *  - Every part is a side-grade with a visible cost. Mass ties it together:
 *    heavier builds are tankier and harder to knock back, but run slower and
 *    recover longer from hard landings.
 *  - Families give a small 3-of-5 set bonus, never a stat spike.
 *  - Balance is verified with the headless tournament in tools/balance.ts.
 */

export type Slot = 'gun' | 'bomb' | 'pod' | 'body' | 'legs' | 'skill';
export type Family = 'vanguard' | 'titan' | 'strider' | 'paladin';
/** Combo elements: a primer marks the target, a trigger detonates the mark for a combo. */
export type Element = 'shock' | 'burn' | 'cryo';

/** Combo roles shared by weapons. */
export interface ComboRole {
  /** Hitting with this applies a primed mark of this element. */
  prime?: Element;
  /** Hitting a primed target with this detonates the mark (combo). */
  trigger?: boolean;
}

export interface PartBase {
  id: string;
  slot: Slot;
  name: string;
  desc: string;
  /** Short stat blurbs shown in the garage. 1..5 */
  ratings: Record<string, number>;
  /** Part mass (contributes to the build's total mass). */
  mass: number;
  family: Family;
  /** One-line strength / weakness shown in the garage. */
  pro: string;
  con: string;
}

export interface GunDef extends PartBase, ComboRole {
  /** Heat added per shot (gun overheats at 100). */
  heat: number;
  slot: 'gun';
  model: 'blaster' | 'rail' | 'scatter' | 'beam' | 'homer';
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
  /** Action commitment after firing, independent of reload. */
  recovery: number;
  damage: number;
  down: number;
  speed: number;
  /** Homing turn rate in rad/s (soft tracking). */
  homing: number;
  /** Homing stops after this many seconds. */
  homingTime: number;
  /** Homing starts after this many seconds (curving shots). */
  homingDelay?: number;
  /** Shots launch this many degrees to the side and curve in (homer). */
  launchDeg?: number;
  /** Hold-to-charge (beam): min/max hold time; damage/down scale from minFrac to 1. */
  holdMin?: number;
  holdMax?: number;
  holdMinFrac?: number;
  /** Shot passes through pods/shots instead of stopping (beam). */
  pierce?: boolean;
  life: number;
  radius: number;
  color: number;
  coreColor: number;
  /** Fighter slows to this fraction of speed while firing on the ground. */
  groundSlow: number;
  sfx: 'gun_blaster' | 'gun_rail' | 'gun_scatter';
  knockback: number;
}

export interface BombDef extends PartBase, ComboRole {
  slot: 'bomb';
  model: 'mortar' | 'cluster' | 'napalm' | 'bouncer';
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
  /** Napalm: burning ground zone. */
  fire?: { radius: number; time: number; tick: number; damage: number; down: number };
}

/**
 * Skill shots: manually aimed, high-power abilities on a cooldown (the gun is the
 * auto-aimed basic attack). Hold to aim a line, release to fire; a quick tap fires
 * straight at the target's current position (no lead). Skill shots never home.
 */
export interface SkillDef extends PartBase, ComboRole {
  slot: 'skill';
  model: 'lance' | 'wave' | 'hook' | 'frost';
  cooldown: number;
  /** Cast time after release before the shot leaves (telegraph). */
  cast: number;
  /** Commitment after the shot leaves. */
  recovery: number;
  damage: number;
  down: number;
  speed: number;
  /** Max travel distance (m). */
  range: number;
  radius: number;
  knockback: number;
  pierce?: boolean;
  /** Pull the victim this many m/s toward the caster and stagger them. */
  pull?: number;
  /** Slow the victim (seconds). */
  slow?: number;
  color: number;
  coreColor: number;
}

export interface PodDef extends PartBase, ComboRole {
  slot: 'pod';
  model: 'seeker' | 'mine' | 'turret' | 'interceptor';
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
  /** Turret: periodic small shots at the enemy. */
  turret?: { interval: number; damage: number; down: number; speed: number; homing: number };
  /** Interceptor: shoots down enemy projectiles near its owner. */
  intercept?: { radius: number; interval: number; orbit: number };
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

export type DashStyle = 'burst' | 'step' | 'flight' | 'glide';

export interface BodyDef extends PartBase {
  slot: 'body';
  frame: 'striker' | 'ironclad' | 'wisp' | 'regent';
  hp: number;
  runSpeed: number;
  jumpVel: number;
  airJumpVel: number;
  hoverTime: number;
  /** Down-gauge capacity: how much down damage before a knockdown (100 = standard). */
  endurance: number;
  dash: { style: DashStyle; speed: number; time: number; cooldown: number; airDashBonus: number };
  charge: ChargeDef;
  chargeName: string;
  /** Air control acceleration multiplier. */
  airControl: number;
}

export interface LegsDef extends PartBase {
  slot: 'legs';
  model: 'stride' | 'hopper' | 'sprint' | 'anchor' | 'feather';
  speedMul: number;
  jumpMul: number;
  airJumps: number;
  airDashes: number;
  dashMul: number;
  /** Dash charges (2 = can chain two dashes; each charge recharges on the dash cooldown × 1.7). */
  dashCharges: number;
  hoverMul: number;
  /** Gravity multiplier while falling. */
  fallMul: number;
  /** Knockback received multiplier. */
  knockMul: number;
  /** Added endurance. */
  endurance: number;
  /** Hard-landing recovery multiplier. */
  landingMul: number;
}

export type AnyPart = GunDef | BombDef | PodDef | BodyDef | LegsDef | SkillDef;

export const GUNS: Record<string, GunDef> = {
  pulse: {
    id: 'pulse', slot: 'gun', heat: 12, name: 'Pulse Blaster', model: 'blaster', family: 'vanguard', mass: 10,
    desc: 'Reliable 3-round burst. Gentle tracking curves shots toward the target.',
    pro: 'Consistent at every range', con: 'Low burst damage',
    ratings: { Power: 2, Speed: 4, Tracking: 3, Reload: 4 },
    burst: 3, burstInterval: 0.13, pellets: 1, spreadDeg: 0, cooldown: 0.8, windup: 0, recovery: 0.12,
    damage: 33, down: 17, speed: 34, homing: 1.9, homingTime: 0.5, life: 1.5, radius: 0.22,
    color: 0x2fd6ff, coreColor: 0xe8fdff, groundSlow: 0.45, sfx: 'gun_blaster', knockback: 2.5,
  },
  scatter: {
    id: 'scatter', slot: 'gun', heat: 24, prime: 'burn', name: 'Scatter Fan', model: 'scatter', family: 'titan', mass: 12,
    desc: 'Fans five pellets. Brutal up close, weak at range. Hard to dodge.',
    pro: 'Huge close-range damage', con: 'Pellets fade out past ~10 m',
    ratings: { Power: 4, Speed: 3, Tracking: 1, Reload: 3 },
    burst: 1, burstInterval: 0, pellets: 5, spreadDeg: 15, cooldown: 1.15, windup: 0.14, recovery: 0.3,
    damage: 44, down: 12, speed: 34, homing: 0, homingTime: 0, life: 0.38, radius: 0.2,
    color: 0xffb03a, coreColor: 0xfff3d0, groundSlow: 0.3, sfx: 'gun_scatter', knockback: 2,
  },
  rail: {
    id: 'rail', slot: 'gun', heat: 34, trigger: true, name: 'Rail Lance', model: 'rail', family: 'paladin', mass: 14,
    desc: 'Charges, then fires one hypersonic slug. Huge down damage. Commit carefully.',
    pro: 'Fast slug, big knockdown pressure', con: 'Long charge roots you; easy to read',
    ratings: { Power: 5, Speed: 5, Tracking: 1, Reload: 1 },
    burst: 1, burstInterval: 0, pellets: 1, spreadDeg: 0, cooldown: 1.5, windup: 0.5, recovery: 0.3,
    damage: 104, down: 40, speed: 72, homing: 1.8, homingTime: 0.2, life: 0.6, radius: 0.28,
    color: 0xc46bff, coreColor: 0xffffff, groundSlow: 0.1, sfx: 'gun_rail', knockback: 9,
  },
  beam: {
    id: 'beam', slot: 'gun', heat: 26, trigger: true, name: 'Charge Beam', model: 'beam', family: 'paladin', mass: 13,
    desc: 'Hold to charge, release to fire a piercing beam bolt. Longer holds hit harder.',
    pro: 'You choose speed vs power each shot', con: 'Weak when tapped; charging is visible',
    ratings: { Power: 4, Speed: 4, Tracking: 2, Reload: 2 },
    burst: 1, burstInterval: 0, pellets: 1, spreadDeg: 0, cooldown: 0.9, windup: 0, recovery: 0.32,
    holdMin: 0.2, holdMax: 0.9, holdMinFrac: 0.4, pierce: true,
    damage: 175, down: 60, speed: 80, homing: 0, homingTime: 0, life: 0.8, radius: 0.32,
    color: 0x5dff9e, coreColor: 0xeafff2, groundSlow: 0.35, sfx: 'gun_rail', knockback: 6,
  },
  homer: {
    id: 'homer', slot: 'gun', heat: 30, prime: 'shock', name: 'Arc Homer', model: 'homer', family: 'strider', mass: 10,
    desc: 'Twin shots launch wide to the sides, then curve in on the target.',
    pro: 'Hits around cover and punishes strafing', con: 'Slow; a straight dash escapes the curve',
    ratings: { Power: 2, Speed: 2, Tracking: 5, Reload: 3 },
    burst: 1, burstInterval: 0, pellets: 2, spreadDeg: 0, launchDeg: 35, cooldown: 0.8, windup: 0, recovery: 0.18,
    damage: 29, down: 15, speed: 32, homing: 7.5, homingTime: 0.9, homingDelay: 0.1, life: 1.8, radius: 0.24,
    color: 0xff7ae6, coreColor: 0xfff0fb, groundSlow: 0.5, sfx: 'gun_blaster', knockback: 2.5,
  },
};

export const BOMBS: Record<string, BombDef> = {
  mortar: {
    id: 'mortar', slot: 'bomb', trigger: true, name: 'Arc Mortar', model: 'mortar', family: 'vanguard', mass: 12,
    desc: 'One heavy shell lobbed high. Wide blast flushes enemies out of cover.',
    pro: 'Big blast, great over cover', con: 'Long reload; shadow gives it away',
    ratings: { Power: 4, Radius: 4, Speed: 2, Reload: 2 },
    count: 1, flightTime: 1.0, scatter: 0, damage: 105, down: 55, blastRadius: 3.4, cooldown: 2.9,
    bounces: 0, color: 0xff5a2a, range: 30,
  },
  cluster: {
    id: 'cluster', slot: 'bomb', prime: 'cryo', name: 'Cluster Hopper', model: 'cluster', family: 'strider', mass: 11,
    desc: 'Three bouncing bomblets that scatter around the target. Area denial.',
    pro: 'Covers a wide area', con: 'Each bomblet is weak',
    ratings: { Power: 2, Radius: 3, Speed: 3, Reload: 3 },
    count: 3, flightTime: 0.75, scatter: 3.2, damage: 72, down: 30, blastRadius: 2.4, cooldown: 2.7,
    bounces: 1, color: 0x9dff4a, range: 26,
  },
  napalm: {
    id: 'napalm', slot: 'bomb', prime: 'burn', name: 'Cinder Pot', model: 'napalm', family: 'titan', mass: 13,
    desc: 'A canister that bursts into a burning pool. Denies ground for a few seconds.',
    pro: 'Zones the enemy off the ground', con: 'Small blast; airborne targets ignore the fire',
    ratings: { Power: 2, Radius: 3, Speed: 2, Reload: 2 },
    count: 1, flightTime: 0.95, scatter: 0, damage: 88, down: 32, blastRadius: 2.4, cooldown: 2.9,
    bounces: 0, color: 0xff8a1a, range: 26,
    fire: { radius: 2.9, time: 3.5, tick: 0.5, damage: 24, down: 8 },
  },
  bouncer: {
    id: 'bouncer', slot: 'bomb', trigger: true, name: 'Skip Grenade', model: 'bouncer', family: 'paladin', mass: 10,
    desc: 'A low, fast grenade that skips toward the target three times before it blows.',
    pro: 'Chases rolling targets; quick flight', con: 'Low arc gets stopped by tall cover',
    ratings: { Power: 3, Radius: 2, Speed: 4, Reload: 3 },
    count: 1, flightTime: 0.6, scatter: 0, damage: 76, down: 42, blastRadius: 2.5, cooldown: 3.0,
    bounces: 3, color: 0x4ad8ff, range: 22,
  },
};

export const PODS: Record<string, PodDef> = {
  seeker: {
    id: 'seeker', slot: 'pod', prime: 'shock', name: 'Seeker Pod', model: 'seeker', family: 'vanguard', mass: 8,
    desc: 'A slow drone that hunts the target. Forces movement. Can be shot down.',
    pro: 'Relentless pressure', con: 'Slow; easy to shoot down',
    ratings: { Power: 3, Speed: 2, Tracking: 4, Reload: 2 },
    count: 1, speed: 5.2, turnRate: 1.7, life: 7, armTime: 0.4, triggerRadius: 1.2, fuse: 0,
    damage: 90, down: 50, blastRadius: 2.6, cooldown: 4.5, hp: 40, hoverHeight: 1.2, color: 0xff3b6b,
  },
  mine: {
    id: 'mine', slot: 'pod', prime: 'cryo', name: 'Drift Mines', model: 'mine', family: 'strider', mass: 9,
    desc: 'Two floating mines that creep toward the enemy and detonate when close.',
    pro: 'Traps lanes and corners', con: 'Very slow; visible fuse',
    ratings: { Power: 3, Speed: 1, Tracking: 2, Reload: 3 },
    count: 2, speed: 1.4, turnRate: 0.8, life: 10, armTime: 0.8, triggerRadius: 2.2, fuse: 0.6,
    damage: 85, down: 45, blastRadius: 2.8, cooldown: 5.2, hp: 30, hoverHeight: 1.6, color: 0xffe14a,
  },
  turret: {
    id: 'turret', slot: 'pod', prime: 'shock', name: 'Sentry Tripod', model: 'turret', family: 'titan', mass: 12,
    desc: 'Plants a turret beside you that plinks the enemy for a few seconds.',
    pro: 'Free extra damage while you hold ground', con: 'Stationary; weak shots; can be destroyed',
    ratings: { Power: 2, Speed: 1, Tracking: 3, Reload: 1 },
    count: 1, speed: 0, turnRate: 0, life: 7, armTime: 0.6, triggerRadius: 0, fuse: 0,
    damage: 40, down: 20, blastRadius: 1.8, cooldown: 6, hp: 70, hoverHeight: 0.9, color: 0xffb03a,
    turret: { interval: 0.85, damage: 28, down: 10, speed: 26, homing: 1.0 },
  },
  interceptor: {
    id: 'interceptor', slot: 'pod', name: 'Aegis Drone', model: 'interceptor', family: 'paladin', mass: 9,
    desc: 'A drone orbits you and shoots down incoming shots and pods.',
    pro: 'Blunts zoning and pod spam', con: 'No damage of its own; fires slowly',
    ratings: { Power: 0, Speed: 3, Tracking: 4, Reload: 1 },
    count: 1, speed: 0, turnRate: 0, life: 8, armTime: 0.3, triggerRadius: 0, fuse: 0,
    damage: 0, down: 0, blastRadius: 0, cooldown: 7, hp: 50, hoverHeight: 1.9, color: 0x7aa8ff,
    intercept: { radius: 4.0, interval: 1.0, orbit: 1.5 },
  },
};

export const BODIES: Record<string, BodyDef> = {
  striker: {
    id: 'striker', slot: 'body', frame: 'striker', name: 'Vanguard Frame', family: 'vanguard', mass: 40,
    desc: 'Balanced all-rounder with a snappy burst dash and a straight dash-punch.',
    pro: 'No weak spots', con: 'No standout strengths',
    ratings: { Armor: 3, Speed: 3, Air: 3, Endurance: 3 },
    hp: 1000, runSpeed: 10.5, jumpVel: 14, airJumpVel: 12.5, hoverTime: 1.1, endurance: 100, airControl: 1,
    dash: { style: 'burst', speed: 24, time: 0.26, cooldown: 1.1, airDashBonus: 0 },
    charge: { windup: 0.3, lunge: 0.3, recover: 0.5, speed: 22, damage: 110, down: 55, cooldown: 1.6, armor: false },
    chargeName: 'Comet Punch',
  },
  ironclad: {
    id: 'ironclad', slot: 'body', frame: 'ironclad', name: 'Titan Frame', family: 'titan', mass: 56,
    desc: 'Heavy plating and a high down threshold. Short, stomping step-dash. Ram shrugs off fire.',
    pro: 'Huge HP and endurance; armored ram', con: 'Slow, short dash, poor in the air',
    ratings: { Armor: 5, Speed: 1, Air: 1, Endurance: 5 },
    hp: 1120, runSpeed: 8.8, jumpVel: 13, airJumpVel: 11.2, hoverTime: 0.8, endurance: 115, airControl: 0.8,
    dash: { style: 'step', speed: 22, time: 0.2, cooldown: 1.25, airDashBonus: 0 },
    charge: { windup: 0.38, lunge: 0.36, recover: 0.62, speed: 20, damage: 130, down: 65, cooldown: 2.0, armor: true },
    chargeName: 'Bulldozer Ram',
  },
  wisp: {
    id: 'wisp', slot: 'body', frame: 'wisp', name: 'Strider Frame', family: 'strider', mass: 28,
    desc: 'Featherweight flyer. Long hover and an extra air dash, but a fragile shell.',
    pro: 'Best air mobility', con: 'Low HP; knocked down quickly',
    ratings: { Armor: 1, Speed: 4, Air: 5, Endurance: 1 },
    hp: 940, runSpeed: 11.2, jumpVel: 15, airJumpVel: 13.5, hoverTime: 1.7, endurance: 82, airControl: 1.25,
    dash: { style: 'flight', speed: 23, time: 0.24, cooldown: 0.45, airDashBonus: 1 },
    charge: { windup: 0.26, lunge: 0.26, recover: 0.32, speed: 25, damage: 85, down: 45, cooldown: 1.3, armor: false },
    chargeName: 'Swallow Kick',
  },
  regent: {
    id: 'regent', slot: 'body', frame: 'regent', name: 'Paladin Frame', family: 'paladin', mass: 44,
    desc: 'A duelist chassis. Long gliding dash and a wide crescent rush, at the cost of agility in the air.',
    pro: 'Longest dash and charge reach', con: 'Long dash cooldown; heavy air control',
    ratings: { Armor: 3, Speed: 3, Air: 2, Endurance: 3 },
    hp: 980, runSpeed: 10.6, jumpVel: 14, airJumpVel: 12.5, hoverTime: 1.1, endurance: 95, airControl: 0.85,
    dash: { style: 'glide', speed: 25, time: 0.33, cooldown: 1.45, airDashBonus: 0 },
    charge: { windup: 0.3, lunge: 0.34, recover: 0.55, speed: 24, damage: 105, down: 58, cooldown: 1.7, armor: false },
    chargeName: 'Crescent Rush',
  },
};

export const LEGS: Record<string, LegsDef> = {
  stride: {
    id: 'stride', slot: 'legs', name: 'Stride Legs', model: 'stride', family: 'vanguard', mass: 22,
    desc: 'Standard servo legs. One air jump, one air dash, steady hover.',
    pro: 'Predictable and solid', con: 'Nothing special',
    ratings: { Speed: 3, Jump: 3, Air: 3 },
    speedMul: 1, jumpMul: 1, airJumps: 1, airDashes: 1, dashMul: 1, dashCharges: 1, hoverMul: 1, fallMul: 1, knockMul: 1, endurance: 0, landingMul: 1,
  },
  hopper: {
    id: 'hopper', slot: 'legs', name: 'Hopper Legs', model: 'hopper', family: 'strider', mass: 20,
    desc: 'Reverse-joint spring legs. Two air jumps and a higher leap.',
    pro: 'High, repeatable jumps', con: 'Slower run; heavy landings',
    ratings: { Speed: 2, Jump: 5, Air: 4 },
    speedMul: 0.94, jumpMul: 1.14, airJumps: 2, airDashes: 1, dashMul: 0.95, dashCharges: 1, hoverMul: 0.85, fallMul: 1.05, knockMul: 1, endurance: 0, landingMul: 1.25,
  },
  sprint: {
    id: 'sprint', slot: 'legs', name: 'Sprint Legs', model: 'sprint', family: 'paladin', mass: 18,
    desc: 'Lean racing legs. Two dash charges and a fast run, but a low jump.',
    pro: 'Chain two dashes', con: 'Low jump; slightly easier to knock down',
    ratings: { Speed: 5, Jump: 2, Air: 2 },
    speedMul: 1.08, jumpMul: 0.9, airJumps: 1, airDashes: 1, dashMul: 1.04, dashCharges: 2, hoverMul: 0.85, fallMul: 1, knockMul: 1.05, endurance: -6, landingMul: 1,
  },
  anchor: {
    id: 'anchor', slot: 'legs', name: 'Anchor Legs', model: 'anchor', family: 'titan', mass: 32,
    desc: 'Heavy stabilizers. Barely budge when hit, but every dash is short.',
    pro: 'Resists knockback; much higher endurance', con: 'Short dashes; weak jump; slow',
    ratings: { Speed: 1, Jump: 2, Air: 1 },
    speedMul: 1.0, jumpMul: 0.96, airJumps: 1, airDashes: 1, dashMul: 0.92, dashCharges: 1, hoverMul: 0.9, fallMul: 1.05, knockMul: 0.5, endurance: 52, landingMul: 1.0,
  },
  feather: {
    id: 'feather', slot: 'legs', name: 'Feather Legs', model: 'feather', family: 'strider', mass: 16,
    desc: 'Light legs with hover vanes. Slow falls and a long hover.',
    pro: 'Floats; soft landings', con: 'Light: knocked back further; slower run',
    ratings: { Speed: 2, Jump: 3, Air: 5 },
    speedMul: 0.93, jumpMul: 1, airJumps: 1, airDashes: 1, dashMul: 0.96, dashCharges: 1, hoverMul: 1.5, fallMul: 0.72, knockMul: 1.15, endurance: -4, landingMul: 0.6,
  },
};

export const SKILLS: Record<string, SkillDef> = {
  lance: {
    id: 'lance', slot: 'skill', trigger: true, name: 'Breaker Lance', model: 'lance', family: 'paladin', mass: 0,
    desc: 'A piercing hyper-velocity lance. Detonates primed marks for a combo.',
    pro: 'Highest single-hit damage', con: 'Narrow: you have to aim it',
    ratings: { Power: 5, Speed: 5, Width: 1, Reload: 2 },
    cooldown: 6, cast: 0.12, recovery: 0.3, damage: 125, down: 45, speed: 70, range: 30, radius: 0.32, knockback: 9, pierce: true,
    color: 0xffc53a, coreColor: 0xffffff,
  },
  wave: {
    id: 'wave', slot: 'skill', prime: 'shock', name: 'Ion Wave', model: 'wave', family: 'strider', mass: 0,
    desc: 'A wide, slow wall of ions that passes through shots and primes shock.',
    pro: 'Wide and forgiving', con: 'Slow: easy to jump',
    ratings: { Power: 3, Speed: 2, Width: 5, Reload: 3 },
    cooldown: 5, cast: 0.1, recovery: 0.25, damage: 70, down: 25, speed: 26, range: 22, radius: 1.15, knockback: 5, pierce: true,
    color: 0x7ab8ff, coreColor: 0xe8f4ff,
  },
  hook: {
    id: 'hook', slot: 'skill', name: 'Grapple Harpoon', model: 'hook', family: 'titan', mass: 0,
    desc: 'Harpoons the target and reels it in, staggered, for a punish.',
    pro: 'Pulls into melee range', con: 'Low damage, long cooldown',
    ratings: { Power: 2, Speed: 4, Width: 2, Reload: 1 },
    cooldown: 7, cast: 0.14, recovery: 0.32, damage: 55, down: 20, speed: 48, range: 20, radius: 0.45, knockback: 0, pull: 15,
    color: 0xff7a3a, coreColor: 0xffe2c8,
  },
  frost: {
    id: 'frost', slot: 'skill', prime: 'cryo', name: 'Frost Spike', model: 'frost', family: 'vanguard', mass: 0,
    desc: 'A quick cryo spike that slows and primes cryo.',
    pro: 'Short cooldown, slows', con: 'Moderate damage',
    ratings: { Power: 3, Speed: 4, Width: 2, Reload: 4 },
    cooldown: 4, cast: 0.08, recovery: 0.22, damage: 60, down: 22, speed: 50, range: 24, radius: 0.5, knockback: 4, slow: 1.5,
    color: 0x9ff0ff, coreColor: 0xffffff,
  },
};

export const ALL_PARTS: Record<Slot, Record<string, AnyPart>> = {
  gun: GUNS,
  bomb: BOMBS,
  pod: PODS,
  body: BODIES,
  legs: LEGS,
  skill: SKILLS,
};

export interface Loadout {
  gun: string;
  bomb: string;
  pod: string;
  body: string;
  legs: string;
  skill: string;
}

export const DEFAULT_LOADOUT: Loadout = { gun: 'pulse', bomb: 'mortar', pod: 'seeker', body: 'striker', legs: 'stride', skill: 'lance' };

/** Parts the player owns from the start. */
export const STARTER_PARTS = ['gun:pulse', 'bomb:mortar', 'pod:seeker', 'body:striker', 'legs:stride', 'skill:lance', 'skill:wave', 'skill:hook', 'skill:frost'];

export function resolveLoadout(l: Loadout) {
  return {
    gun: GUNS[l.gun] ?? GUNS.pulse,
    bomb: BOMBS[l.bomb] ?? BOMBS.mortar,
    pod: PODS[l.pod] ?? PODS.seeker,
    body: BODIES[l.body] ?? BODIES.striker,
    legs: LEGS[l.legs] ?? LEGS.stride,
    skill: SKILLS[l.skill] ?? SKILLS.lance,
  };
}
export type ResolvedLoadout = ReturnType<typeof resolveLoadout>;

/* -------------------------------------------------------------------------- */
/* Derived stats: the single source of truth for movement/defense numbers.     */
/* -------------------------------------------------------------------------- */

export const SET_BONUS: Record<Family, { name: string; desc: string }> = {
  vanguard: { name: 'Tactician', desc: 'Dash cooldown −12%' },
  titan: { name: 'Bulwark', desc: 'Guard takes 40% less chip damage, +5 endurance' },
  strider: { name: 'Skyborne', desc: 'Hover +25%, fall 10% slower' },
  paladin: { name: 'Duelist', desc: 'Charge-attack cooldown −15%, gun wind-up −10%' },
};

/** Reference build mass (Vanguard + Stride + pulse + mortar + seeker). */
export const BASE_MASS = 92;

export interface DerivedStats {
  mass: number;
  hp: number;
  runSpeed: number;
  jumpVel: number;
  airJumpVel: number;
  airJumps: number;
  airDashes: number;
  dashStyle: DashStyle;
  dashSpeed: number;
  dashTime: number;
  dashCooldown: number;
  dashCharges: number;
  hoverTime: number;
  fallMul: number;
  airControl: number;
  knockMul: number;
  endurance: number;
  /** Seconds of recovery after a hard landing (scaled by fall speed at runtime). */
  landingLag: number;
  chargeCooldown: number;
  gunWindupMul: number;
  guardChipMul: number;
  set: Family | null;
}

export function deriveStats(lo: ResolvedLoadout): DerivedStats {
  const parts = [lo.gun, lo.bomb, lo.pod, lo.body, lo.legs];
  const mass = parts.reduce((m, p) => m + p.mass, 0);
  const counts: Partial<Record<Family, number>> = {};
  for (const p of parts) counts[p.family] = (counts[p.family] ?? 0) + 1;
  let set: Family | null = null;
  for (const f of Object.keys(counts) as Family[]) if ((counts[f] ?? 0) >= 3) set = f;
  const massSpeed = Math.min(1.06, Math.max(0.88, 1 - (mass - BASE_MASS) * 0.003));
  const massKnock = Math.min(1.2, Math.max(0.8, BASE_MASS / mass));
  const b = lo.body;
  const L = lo.legs;
  return {
    mass,
    hp: b.hp,
    runSpeed: b.runSpeed * L.speedMul * massSpeed,
    jumpVel: b.jumpVel * L.jumpMul,
    airJumpVel: b.airJumpVel * L.jumpMul,
    airJumps: L.airJumps,
    airDashes: L.airDashes + b.dash.airDashBonus,
    dashStyle: b.dash.style,
    dashSpeed: b.dash.speed * L.dashMul * (0.97 + 0.03 * massSpeed),
    dashTime: b.dash.time,
    dashCooldown: b.dash.cooldown * (set === 'vanguard' ? 0.88 : 1),
    dashCharges: L.dashCharges,
    hoverTime: b.hoverTime * L.hoverMul * (set === 'strider' ? 1.25 : 1),
    fallMul: L.fallMul * (set === 'strider' ? 0.9 : 1),
    airControl: b.airControl,
    knockMul: massKnock * L.knockMul,
    endurance: b.endurance + L.endurance + (set === 'titan' ? 5 : 0),
    landingLag: 0.18 * (mass / BASE_MASS) * L.landingMul,
    chargeCooldown: b.charge.cooldown * (set === 'paladin' ? 0.85 : 1),
    gunWindupMul: set === 'paladin' ? 0.9 : 1,
    guardChipMul: set === 'titan' ? 0.6 : 1,
    set,
  };
}
