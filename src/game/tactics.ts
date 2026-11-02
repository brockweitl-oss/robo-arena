/**
 * Arena tactics layouts: destructible crates, trap pads + their shootable switches,
 * and the pick-up spawn point. Every layout is symmetric between the two spawns so
 * neither side gets an advantage. Positions are XZ (y comes from the ground below).
 */
export interface TacticsLayout {
  crates: [number, number][];
  pads: { at: [number, number]; sw: [number, number, number] }[];
  pickup: [number, number];
}

export const TACTICS: Record<string, TacticsLayout> = {
  foundry: {
    crates: [[3, 3], [-3, -3], [8, -1], [-8, 1]],
    pads: [
      { at: [0, 6.5], sw: [3.8, 1.2, 6.5] },
      { at: [0, -6.5], sw: [-3.8, 1.2, -6.5] },
    ],
    pickup: [0, 0],
  },
  garden: {
    crates: [[4, 1.6], [4, -1.6], [-4.6, 2.2], [-4.6, -2.2]],
    pads: [
      { at: [1.2, 7.6], sw: [4.4, 1.2, 8.6] },
      { at: [1.2, -7.6], sw: [4.4, 1.2, -8.6] },
    ],
    pickup: [0, 0],
  },
  orbital: {
    crates: [[10.5, 8], [-10.5, -8], [10.5, -8], [-10.5, 8]],
    pads: [
      { at: [0, 7.6], sw: [3.6, 1.2, 7.6] },
      { at: [0, -7.6], sw: [-3.6, 1.2, -7.6] },
    ],
    pickup: [0, 0],
  },
};

export const CRATE = { size: 1.5, hp: 160 };
export const TRAP = { radius: 2.1, warn: 1.0, active: 0.5, cooldown: 12, damage: 55, down: 35, launch: 9, switchRadius: 0.55, touchRadius: 1.15 };
export const PICKUP = { interval: 30, firstAt: 20, life: 12, radius: 1.3 };
export type PickupKind = 'shield' | 'overdrive' | 'speed';
export const PICKUP_KINDS: PickupKind[] = ['shield', 'overdrive', 'speed'];
export const PICKUP_EFFECT = { shield: 150, overdrive: 8, speed: 8 };
