/**
 * Arena tactics layouts: destructible crates, trap pads + their shootable switches,
 * and the pick-up spawn point. Every layout is symmetric between the two spawns so
 * neither side gets an advantage. Positions are XZ (y comes from the ground below).
 */
export interface TacticsLayout {
  crates: [number, number][];
  /** Breakable low walls (barricades): centre XZ; long axis along x. Point-symmetric pairs. */
  walls?: [number, number][];
  pads: { at: [number, number]; sw: [number, number, number] }[];
  pickup: [number, number];
  /** Overcharge Core pad centre (XZ) and the height the ground probe starts from (below moving decks). */
  objective?: { at: [number, number]; probe?: number };
}

const fieldLayout = (): TacticsLayout => ({ crates: [[3,3],[-3,-3],[3,-3],[-3,3]], walls: [[0, 4.4], [0, -4.4]], pads: [{at:[0,7],sw:[3.6,1.2,7]},{at:[0,-7],sw:[-3.6,1.2,-7]}], pickup:[0,0], objective: { at: [0, 0] } });
export const TACTICS: Record<string, TacticsLayout> = {
  hangar:fieldLayout(), proving:fieldLayout(), sunken:fieldLayout(),
  foundry: {
    crates: [[3, 3], [-3, -3], [8, -1], [-8, 1]],
    walls: [[0, 3.6], [0, -3.6]],
    pads: [
      { at: [0, 6.5], sw: [3.8, 1.2, 6.5] },
      { at: [0, -6.5], sw: [-3.8, 1.2, -6.5] },
    ],
    pickup: [0, 0],
    // on the floor, under the crane's path: the moving deck passes overhead
    objective: { at: [0, 0], probe: 1 },
  },
  garden: {
    crates: [[4, 1.6], [4, -1.6], [-4.6, 2.2], [-4.6, -2.2]],
    walls: [[0, 4.0], [0, -4.0]],
    pads: [
      { at: [1.2, 7.6], sw: [4.4, 1.2, 8.6] },
      { at: [1.2, -7.6], sw: [4.4, 1.2, -8.6] },
    ],
    pickup: [0, 0],
    objective: { at: [0, 0] },
  },
  orbital: {
    crates: [[10.5, 8], [-10.5, -8], [10.5, -8], [-10.5, 8]],
    walls: [[-6, 4.8], [6, -4.8]],
    pads: [
      { at: [0, 7.6], sw: [3.6, 1.2, 7.6] },
      { at: [0, -7.6], sw: [-3.6, 1.2, -7.6] },
    ],
    pickup: [0, 0],
    // king of the hill: the core sits on the raised centre block (ramps east and west)
    objective: { at: [0, 0] },
  },
};

export const CRATE = { size: 1.5, hp: 160 };
/** Barricade: a low breakable wall. Taller than a robot's knees, below chest-shot height for jumpers. */
export const WALL = { w: 2.4, h: 1.4, d: 0.6, hp: 320 };

/**
 * Overcharge Core: a timed, deterministic objective. The pad comes online at fixed fight times
 * (announced `warn` seconds early) and stays online for `window` seconds or until captured.
 * A robot standing on it alone fills its meter; both on it freeze both meters; off it decays.
 */
export const OBJECTIVE = {
  firstAt: 20, interval: 30, warn: 5, window: 12,
  radius: 2.2, capture: 2.0, decay: 0.5,
  /** Feet height band relative to the pad that counts as standing on it. */
  below: 0.4, above: 1.6,
  /** Reward: skill cooldown refilled + this many seconds of Overdrive (+20% damage). */
  overdrive: 6,
};
export const TRAP = { radius: 2.1, warn: 1.0, active: 0.5, cooldown: 12, damage: 55, down: 35, launch: 9, switchRadius: 0.55, touchRadius: 1.15 };
export const PICKUP = { interval: 30, firstAt: 20, life: 12, radius: 1.3 };
export type PickupKind = 'shield' | 'overdrive' | 'speed';
export const PICKUP_KINDS: PickupKind[] = ['shield', 'overdrive', 'speed'];
export const PICKUP_EFFECT = { shield: 150, overdrive: 8, speed: 8 };
