// Small deterministic noise kit for Lantern Terrace (textures + geometry displacement).

function h32(a: number): number {
  a = Math.imul(a ^ (a >>> 16), 0x7feb352d);
  a = Math.imul(a ^ (a >>> 15), 0x846ca68b);
  return (a ^ (a >>> 16)) >>> 0;
}

export function hash3(x: number, y: number, z: number, s = 0): number {
  return h32(Math.imul(x | 0, 73856093) ^ h32(Math.imul(y | 0, 19349663) ^ h32(Math.imul(z | 0, 83492791) ^ s))) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 3D value noise in [0,1]. */
export function noise3(x: number, y: number, z: number, s = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, s);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), xf), lerp(c(0, 1, 0), c(1, 1, 0), xf), yf),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), xf), lerp(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf,
  );
}

export function fbm3(x: number, y: number, z: number, oct = 4, s = 0): number {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * noise3(x * f, y * f, z * f, s + i * 17);
    norm += a;
    a *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Tileable 2D value noise on a lattice of `period` cells over [0,1). */
export function tnoise(u: number, v: number, period: number, s = 0): number {
  const x = u * period, y = v * period;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = fade(x - xi), yf = fade(y - yi);
  const m = (n: number) => ((n % period) + period) % period;
  const c = (dx: number, dy: number) => hash3(m(xi + dx), m(yi + dy), 0, s);
  return lerp(lerp(c(0, 0), c(1, 0), xf), lerp(c(0, 1), c(1, 1), xf), yf);
}

/** Tileable fBm in [0,1]. */
export function tfbm(u: number, v: number, base: number, oct = 4, s = 0): number {
  let a = 0.5, p = base, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * tnoise(u, v, p, s + i * 31);
    norm += a;
    a *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

/** Tileable worley-ish cell distance (F1) in [0,~1]. */
export function tcell(u: number, v: number, period: number, s = 0): number {
  const x = u * period, y = v * period;
  const xi = Math.floor(x), yi = Math.floor(y);
  let best = 9;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const mx = ((cx % period) + period) % period, my = ((cy % period) + period) % period;
      const px = cx + hash3(mx, my, 1, s), py = cy + hash3(mx, my, 2, s);
      const d = Math.hypot(px - x, py - y);
      if (d < best) best = d;
    }
  return best;
}
