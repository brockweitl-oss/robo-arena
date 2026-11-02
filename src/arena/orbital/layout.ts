// Halo Deck layout constants (shared by geometry, textures and colliders).

export const HALF = 18; // invisible wall clamp
export const RAIL_SIDE = 19.5; // energy barrier: flat sides at ±19.5
export const RAIL_CUT = 37.5; // chamfer: |x| + |z| = 37.5
export const DECK_SIDE = 21.5; // outer deck slab
export const DECK_CUT = 40;
export const TEX_EXTENT = 22; // floor canvas covers [-22, 22]

export const DAIS_HALF = 3.5;
export const DAIS_H = 2.6;
export const RAMP_X0 = 3.5;
export const RAMP_X1 = 9.5;
export const RAMP_HW = 2;
export const SPAWN_Z = 11.5;

export type CoverKind = 'pylon' | 'bulwark' | 'barrier' | 'post';
export interface CoverDef {
  cx: number;
  cz: number;
  sx: number;
  sz: number;
  h: number;
  kind: CoverKind;
}

export const COVER: CoverDef[] = [
  { cx: 7, cz: 8.5, sx: 2.8, sz: 1.2, h: 2.2, kind: 'pylon' },
  { cx: -7, cz: 8.5, sx: 2.8, sz: 1.2, h: 2.2, kind: 'pylon' },
  { cx: 7, cz: -8.5, sx: 2.8, sz: 1.2, h: 2.2, kind: 'pylon' },
  { cx: -7, cz: -8.5, sx: 2.8, sz: 1.2, h: 2.2, kind: 'pylon' },
  { cx: 14.5, cz: 0, sx: 1.2, sz: 4, h: 2.6, kind: 'bulwark' },
  { cx: 0, cz: 16.2, sx: 4.4, sz: 1.0, h: 1.5, kind: 'barrier' },
  { cx: 0, cz: -16.2, sx: 4.4, sz: 1.0, h: 1.5, kind: 'barrier' },
  { cx: 12, cz: 4.5, sx: 1.2, sz: 1.2, h: 1.8, kind: 'post' },
  { cx: 12, cz: -4.5, sx: 1.2, sz: 1.2, h: 1.8, kind: 'post' },
  { cx: -12, cz: 4.5, sx: 1.2, sz: 1.2, h: 1.8, kind: 'post' },
  { cx: -12, cz: -4.5, sx: 1.2, sz: 1.2, h: 1.8, kind: 'post' },
];

// Arc coils: k = firing order slot.
export const COIL_R = 3;
export const COILS = [
  { x: 12.5, z: 12.5, k: 0 },
  { x: -12.5, z: -12.5, k: 1 },
  { x: -12.5, z: 12.5, k: 2 },
  { x: 12.5, z: -12.5, k: 3 },
];
export const COIL_PERIOD = 12;
export const COIL_STAGGER = 0;
export const COIL_WARN = 6.0; // phase where telegraph starts
export const COIL_FIRE = 8.5; // phase where discharge starts (2.5 s telegraph)
export const COIL_END = 9.15; // discharge ends (0.65 s)

export function coilPhase(t: number, k: number): number {
  const p = (t - k * COIL_STAGGER) % COIL_PERIOD;
  return p < 0 ? p + COIL_PERIOD : p;
}
export const coilWarning = (t: number, k: number) => {
  const p = coilPhase(t, k);
  return p >= COIL_WARN && p < COIL_FIRE;
};
export const coilActive = (t: number, k: number) => {
  const p = coilPhase(t, k);
  return p >= COIL_FIRE && p < COIL_END;
};

// Corner towers (floodlights + coil emitters) stand outside the rail chamfers.
export const TOWER_D = 20.3;
export const BOOM_Y = 8.6;
export const BOOM_TIP = 16.4; // electrode tip at (±16.4, BOOM_Y, ±16.4)

// Elevator ("hard-light lift") on the -x side.
export const ELEV = { cx: -14.5, cz: 0, half: 2, lo: 0.25, hi: 4.8, period: 10 };
export function elevHeight(t: number): { h: number; v: number } {
  const u = ((t % ELEV.period) + ELEV.period) % ELEV.period;
  const span = ELEV.hi - ELEV.lo;
  const ss = (x: number) => x * x * (3 - 2 * x);
  const ds = (x: number) => 6 * x * (1 - x);
  if (u < 3) return { h: ELEV.lo, v: 0 };
  if (u < 5) {
    const x = (u - 3) / 2;
    return { h: ELEV.lo + span * ss(x), v: (span * ds(x)) / 2 };
  }
  if (u < 8) return { h: ELEV.hi, v: 0 };
  const x = (u - 8) / 2;
  return { h: ELEV.hi - span * ss(x), v: (-span * ds(x)) / 2 };
}

/** Chamfered square polygon (CCW seen from above, as [x, z]). */
export function chamferPoly(side: number, cut: number): [number, number][] {
  const c = cut - side;
  return [
    [side, -c],
    [side, c],
    [c, side],
    [-c, side],
    [-side, c],
    [-side, -c],
    [-c, -side],
    [c, -side],
  ];
}

/** Regular octagon with flat sides on the axes. */
export function octPoly(apothem: number): [number, number][] {
  const r = apothem / Math.cos(Math.PI / 8);
  const pts: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 8 + (i * Math.PI) / 4;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}
