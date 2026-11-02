// Procedural canvas textures for the Crucible Yard arena. All textures created here are
// tracked in `owned` so the arena can dispose them.
import * as THREE from 'three';
import { heightToNormal, rng } from '../../render/textures';

export class TexKit {
  owned: THREE.Texture[] = [];

  tex(c: HTMLCanvasElement, srgb: boolean, wrap = true): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(c);
    if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    this.owned.push(t);
    return t;
  }
  dispose() {
    for (const t of this.owned) t.dispose();
    this.owned.length = 0;
  }
}

export function cv(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  return { c, g };
}

// ---------- tileable value noise ----------
function hash(x: number, y: number, s: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number, px: number, py: number, s: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % px) + px) % px;
  const y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = hash(x0, y0, s);
  const b = hash(x1, y0, s);
  const c = hash(x0, y1, s);
  const d = hash(x1, y1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
/** fbm over u,v in [0,1), tileable. fx/fy = base lattice frequency per axis. */
export function fbm(u: number, v: number, fx: number, fy: number, oct: number, s: number) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    const kx = fx << o;
    const ky = fy << o;
    sum += amp * vnoise(u * kx, v * ky, kx, ky, s + o * 17);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

function noiseCanvas(size: number, f: number, oct: number, seed: number) {
  const { c, g } = cv(size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = fbm(x / size, y / size, f, f, oct, seed);
      const i = (y * size + x) * 4;
      const v = Math.max(0, Math.min(255, n * 255));
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

function grain(g: CanvasRenderingContext2D, w: number, h: number, amt: number, seed: number) {
  const r = rng(seed);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amt;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
}

/** Multiply a low-frequency tileable noise over a canvas (mottling). */
function mottle(g: CanvasRenderingContext2D, size: number, seed: number, alpha: number, f = 4) {
  const n = noiseCanvas(128, f, 4, seed);
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = alpha;
  g.imageSmoothingEnabled = true;
  g.drawImage(n, 0, 0, size, size);
  g.restore();
}

function stains(g: CanvasRenderingContext2D, size: number, r: () => number, n: number, rgb: string, a: number, rmin: number, rmax: number) {
  for (let i = 0; i < n; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = rmin + r() * (rmax - rmin);
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        const cx = x + ox;
        const cy = y + oy;
        if (cx + rad < 0 || cy + rad < 0 || cx - rad > size || cy - rad > size) continue;
        const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grd.addColorStop(0, `rgba(${rgb},${a})`);
        grd.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = grd;
        g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
  }
}

export interface PBR {
  map: THREE.Texture;
  normal: THREE.Texture;
  rough: THREE.Texture;
}

/** Steel deck plating, 4x4 plates per tile (tile = 8 m). Mid-dark, low-contrast. */
export function deckMaps(k: TexKit, seed = 11): PBR {
  const S = 1024;
  const P = 4;
  const ps = S / P;
  const r = rng(seed);
  const A = cv(S);
  const H = cv(S);
  const R = cv(S);
  for (let py = 0; py < P; py++)
    for (let px = 0; px < P; px++) {
      const x0 = px * ps;
      const y0 = py * ps;
      const v = Math.floor((r() - 0.5) * 10);
      A.g.fillStyle = `rgb(${70 + v},${73 + v},${78 + v})`;
      A.g.fillRect(x0, y0, ps, ps);
      H.g.fillStyle = '#909090';
      H.g.fillRect(x0, y0, ps, ps);
      const rv = 150 + Math.floor(r() * 40);
      R.g.fillStyle = `rgb(${rv},${rv},${rv})`;
      R.g.fillRect(x0, y0, ps, ps);
      const tread = r() < 0.35;
      if (tread) {
        for (let yy = 14; yy < ps - 12; yy += 18)
          for (let xx = 14; xx < ps - 12; xx += 18) {
            const alt = ((xx / 18) | 0) + ((yy / 18) | 0);
            const rot = alt % 2 ? Math.PI / 4 : -Math.PI / 4;
            for (const [cg, col] of [
              [H.g, '#c4c4c4'],
              [A.g, 'rgba(255,255,255,0.06)'],
              [R.g, 'rgba(0,0,0,0.18)'],
            ] as [CanvasRenderingContext2D, string][]) {
              cg.save();
              cg.translate(x0 + xx, y0 + yy);
              cg.rotate(rot);
              cg.fillStyle = col;
              cg.beginPath();
              cg.ellipse(0, 0, 6.5, 2, 0, 0, Math.PI * 2);
              cg.fill();
              cg.restore();
            }
          }
      } else {
        // brushed streaks
        A.g.strokeStyle = 'rgba(255,255,255,0.025)';
        for (let i = 0; i < 40; i++) {
          A.g.lineWidth = 1 + r() * 2;
          const yy = y0 + r() * ps;
          A.g.beginPath();
          A.g.moveTo(x0 + 6, yy);
          A.g.lineTo(x0 + ps - 6, yy + (r() - 0.5) * 4);
          A.g.stroke();
        }
      }
      // bolts along plate edges
      for (let kk = 16; kk < ps; kk += 32)
        for (const [bx, by] of [
          [x0 + kk, y0 + 10],
          [x0 + kk, y0 + ps - 10],
          [x0 + 10, y0 + kk],
          [x0 + ps - 10, y0 + kk],
        ]) {
          H.g.fillStyle = '#606060';
          H.g.beginPath();
          H.g.arc(bx, by, 4.5, 0, Math.PI * 2);
          H.g.fill();
          H.g.fillStyle = '#d8d8d8';
          H.g.beginPath();
          H.g.arc(bx, by, 3.2, 0, Math.PI * 2);
          H.g.fill();
          A.g.fillStyle = 'rgba(120,120,125,0.35)';
          A.g.beginPath();
          A.g.arc(bx, by, 3.2, 0, Math.PI * 2);
          A.g.fill();
        }
    }
  // seams
  for (let i = 0; i <= P; i++) {
    const p = i * ps;
    H.g.fillStyle = '#2a2a2a';
    H.g.fillRect(p - 3, 0, 6, S);
    H.g.fillRect(0, p - 3, S, 6);
    A.g.fillStyle = '#1d2024';
    A.g.fillRect(p - 2, 0, 4, S);
    A.g.fillRect(0, p - 2, S, 4);
    R.g.fillStyle = '#d0d0d0';
    R.g.fillRect(p - 3, 0, 6, S);
    R.g.fillRect(0, p - 3, S, 6);
  }
  // stains: rust, oil (oil = glossier), heat tint
  stains(A.g, S, r, 26, '70,40,22', 0.16, 30, 140);
  stains(A.g, S, r, 30, '12,12,14', 0.22, 20, 110);
  stains(R.g, S, r, 30, '40,40,40', 0.25, 20, 110);
  stains(A.g, S, r, 8, '60,45,70', 0.06, 60, 200);
  // scratches
  for (let i = 0; i < 260; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = r() * Math.PI;
    const len = 10 + r() * 60;
    A.g.strokeStyle = `rgba(200,205,210,${0.04 + r() * 0.06})`;
    R.g.strokeStyle = 'rgba(60,60,60,0.35)';
    for (const cg of [A.g, R.g]) {
      cg.lineWidth = 0.6 + r();
      cg.beginPath();
      cg.moveTo(x, y);
      cg.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      cg.stroke();
    }
  }
  mottle(A.g, S, seed + 3, 0.35, 4);
  mottle(R.g, S, seed + 4, 0.25, 6);
  grain(A.g, S, S, 10, seed);
  grain(R.g, S, S, 30, seed + 1);
  grain(H.g, S, S, 6, seed + 2);
  return { map: k.tex(A.c, true), normal: k.tex(heightToNormal(H.c, 2.4), false), rough: k.tex(R.c, false) };
}

/** Hazard stripe (seamless, 45 degrees). Tile = 256 px, 2 stripe pairs per tile. */
export function hazardMaps(k: TexKit): { map: THREE.Texture; rough: THREE.Texture } {
  const S = 256;
  const A = cv(S);
  const R = cv(S);
  const r = rng(91);
  const img = A.g.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const yel = (x + y) % 128 < 64;
      const i = (y * S + x) * 4;
      img.data[i] = yel ? 214 : 26;
      img.data[i + 1] = yel ? 156 : 24;
      img.data[i + 2] = yel ? 28 : 22;
      img.data[i + 3] = 255;
    }
  A.g.putImageData(img, 0, 0);
  R.g.fillStyle = '#a8a8a8';
  R.g.fillRect(0, 0, S, S);
  // chips (worn paint showing steel) + grime
  for (let i = 0; i < 160; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 1 + r() * 4;
    A.g.fillStyle = `rgba(${90 + r() * 30},${90 + r() * 30},${95 + r() * 30},0.8)`;
    A.g.beginPath();
    A.g.ellipse(x, y, rad * (1 + r()), rad, r() * 3, 0, Math.PI * 2);
    A.g.fill();
    R.g.fillStyle = 'rgba(50,50,50,0.8)';
    R.g.beginPath();
    R.g.arc(x, y, rad, 0, Math.PI * 2);
    R.g.fill();
  }
  stains(A.g, S, r, 20, '20,16,12', 0.3, 10, 60);
  mottle(A.g, S, 33, 0.3, 4);
  grain(A.g, S, S, 14, 5);
  return { map: k.tex(A.c, true), rough: k.tex(R.c, false) };
}

/** Molten metal: dark crust with glowing cracks. Use as map on a basic material (scaled > 1 for bloom). */
export function lavaMap(k: TexKit, seed = 7, size = 256, bias = 0): THREE.Texture {
  const { c, g } = cv(size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbm(u, v, 4, 4, 4, seed);
      const rr = 1 - Math.abs(2 * fbm(u, v, 3, 3, 4, seed + 50) - 1);
      const crack = Math.max(0, Math.min(1, (rr - 0.72) / 0.22));
      let h = Math.max(0, Math.min(1, crack * 0.95 + (n - 0.45) * 0.9 + bias));
      h = h * h * (3 - 2 * h);
      // ramp: crust -> red -> orange -> yellow
      let R: number, G: number, B: number;
      if (h < 0.35) {
        const t = h / 0.35;
        R = 22 + t * 110;
        G = 7 + t * 18;
        B = 4 + t * 2;
      } else if (h < 0.7) {
        const t = (h - 0.35) / 0.35;
        R = 132 + t * 123;
        G = 25 + t * 85;
        B = 6 + t * 8;
      } else {
        const t = (h - 0.7) / 0.3;
        R = 255;
        G = 110 + t * 110;
        B = 14 + t * 100;
      }
      const i = (y * size + x) * 4;
      img.data[i] = R;
      img.data[i + 1] = G;
      img.data[i + 2] = B;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return k.tex(c, true);
}

/** Pouring stream texture: u along the stream, v around. Bright, streaky. */
export function pourMap(k: TexKit): THREE.Texture {
  const W = 128;
  const H = 64;
  const { c, g } = cv(W, H);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const n = fbm(x / W, y / H, 2, 8, 3, 21);
      const h = 0.55 + n * 0.6;
      const i = (y * W + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = Math.min(255, 70 + h * 150);
      img.data[i + 2] = Math.min(255, 10 + Math.max(0, h - 0.8) * 300);
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return k.tex(c, true);
}

/** Furnace mouth glow: hot at the bottom, flame tongues. */
export function furnaceMap(k: TexKit): THREE.Texture {
  const W = 128;
  const H = 256;
  const { c, g } = cv(W, H);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = y / H; // 0 top, 1 bottom
      const n = fbm(x / W, v, 6, 2, 3, 61);
      let h = v * 1.1 + (n - 0.5) * 0.8 - 0.25;
      h = Math.max(0, Math.min(1, h));
      const i = (y * W + x) * 4;
      img.data[i] = 40 + h * 215;
      img.data[i + 1] = 6 + h * h * 170;
      img.data[i + 2] = 2 + h * h * h * 80;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return k.tex(c, true, false);
}

/** Ingot crate face (each face 0..1): frame, ribs, stencil. Neutral grey so vertex colours tint it. */
export function crateMaps(k: TexKit): PBR {
  const S = 512;
  const A = cv(S);
  const H = cv(S);
  const R = cv(S);
  const r = rng(404);
  A.g.fillStyle = '#b4b4b4';
  A.g.fillRect(0, 0, S, S);
  H.g.fillStyle = '#787878';
  H.g.fillRect(0, 0, S, S);
  R.g.fillStyle = '#9a9a9a';
  R.g.fillRect(0, 0, S, S);
  // frame
  const F = 44;
  A.g.fillStyle = '#c8c8c8';
  for (const [x, y, w, h] of [
    [0, 0, S, F],
    [0, S - F, S, F],
    [0, 0, F, S],
    [S - F, 0, F, S],
  ]) {
    A.g.fillRect(x, y, w, h);
    H.g.fillStyle = '#c0c0c0';
    H.g.fillRect(x, y, w, h);
  }
  H.g.strokeStyle = '#3a3a3a';
  H.g.lineWidth = 4;
  H.g.strokeRect(F, F, S - 2 * F, S - 2 * F);
  // horizontal stiffening ribs
  for (const yy of [S * 0.36, S * 0.64]) {
    H.g.fillStyle = '#b0b0b0';
    H.g.fillRect(F, yy - 9, S - 2 * F, 18);
    H.g.fillStyle = '#505050';
    H.g.fillRect(F, yy + 9, S - 2 * F, 3);
    A.g.fillStyle = 'rgba(255,255,255,0.12)';
    A.g.fillRect(F, yy - 9, S - 2 * F, 18);
  }
  // corner bolts
  for (const [bx, by] of [
    [22, 22],
    [S - 22, 22],
    [22, S - 22],
    [S - 22, S - 22],
    [S / 2, 22],
    [S / 2, S - 22],
    [22, S / 2],
    [S - 22, S / 2],
  ]) {
    H.g.fillStyle = '#f0f0f0';
    H.g.beginPath();
    H.g.arc(bx, by, 8, 0, Math.PI * 2);
    H.g.fill();
    A.g.fillStyle = '#8a8a8a';
    A.g.beginPath();
    A.g.arc(bx, by, 8, 0, Math.PI * 2);
    A.g.fill();
  }
  // stencil
  A.g.fillStyle = 'rgba(28,26,24,0.85)';
  A.g.font = 'bold 84px "Arial Black", Impact, sans-serif';
  A.g.textAlign = 'center';
  A.g.textBaseline = 'middle';
  A.g.fillText('CY-3', S / 2, S * 0.5);
  A.g.font = 'bold 30px "Arial Black", Impact, sans-serif';
  A.g.fillText('INGOT  2.4 T', S / 2, S * 0.2);
  // warning diamond plate (small)
  A.g.save();
  A.g.translate(S * 0.78, S * 0.8);
  A.g.rotate(Math.PI / 4);
  A.g.fillStyle = '#e0a020';
  A.g.fillRect(-26, -26, 52, 52);
  A.g.strokeStyle = '#111';
  A.g.lineWidth = 4;
  A.g.strokeRect(-22, -22, 44, 44);
  A.g.restore();
  // stencil bridge gaps
  A.g.fillStyle = '#b4b4b4';
  for (let i = 0; i < 6; i++) A.g.fillRect(S * 0.2 + i * 60, S * 0.5 - 3, 4, 6);
  // chipped edges (bare steel)
  for (let i = 0; i < 220; i++) {
    const edge = Math.floor(r() * 4);
    const t = r() * S;
    const d = r() * r() * 50;
    const x = edge === 0 ? t : edge === 1 ? t : edge === 2 ? d : S - d;
    const y = edge === 0 ? d : edge === 1 ? S - d : t;
    const rad = 1 + r() * 5;
    A.g.fillStyle = `rgba(${150 + r() * 60},${150 + r() * 60},${150 + r() * 60},0.9)`;
    A.g.beginPath();
    A.g.ellipse(x, y, rad * 1.6, rad, r() * 3, 0, Math.PI * 2);
    A.g.fill();
    R.g.fillStyle = 'rgba(40,40,40,0.9)';
    R.g.beginPath();
    R.g.arc(x, y, rad, 0, Math.PI * 2);
    R.g.fill();
  }
  // grime: darker toward bottom, drips
  const grd = A.g.createLinearGradient(0, S * 0.5, 0, S);
  grd.addColorStop(0, 'rgba(20,14,10,0)');
  grd.addColorStop(1, 'rgba(20,14,10,0.45)');
  A.g.fillStyle = grd;
  A.g.fillRect(0, 0, S, S);
  for (let i = 0; i < 30; i++) {
    const x = r() * S;
    const y = r() * S * 0.6;
    const len = 30 + r() * 140;
    const lg = A.g.createLinearGradient(0, y, 0, y + len);
    lg.addColorStop(0, 'rgba(40,24,14,0.25)');
    lg.addColorStop(1, 'rgba(40,24,14,0)');
    A.g.fillStyle = lg;
    A.g.fillRect(x, y, 2 + r() * 4, len);
  }
  mottle(A.g, S, 77, 0.3, 4);
  grain(A.g, S, S, 12, 8);
  grain(R.g, S, S, 26, 9);
  return { map: k.tex(A.c, true), normal: k.tex(heightToNormal(H.c, 2.5), false), rough: k.tex(R.c, false) };
}

/** Bar grating (1 m tile): bearing bars with dark gaps. */
export function gratingMaps(k: TexKit): PBR {
  const S = 256;
  const A = cv(S);
  const H = cv(S);
  const R = cv(S);
  A.g.fillStyle = '#0c0d0f';
  A.g.fillRect(0, 0, S, S);
  H.g.fillStyle = '#202020';
  H.g.fillRect(0, 0, S, S);
  R.g.fillStyle = '#e0e0e0';
  R.g.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 16) {
    A.g.fillStyle = '#60666e';
    A.g.fillRect(x, 0, 6, S);
    H.g.fillStyle = '#d8d8d8';
    H.g.fillRect(x, 0, 6, S);
    R.g.fillStyle = '#909090';
    R.g.fillRect(x, 0, 6, S);
  }
  for (let y = 0; y < S; y += 64) {
    A.g.fillStyle = '#4c5158';
    A.g.fillRect(0, y, S, 5);
    H.g.fillStyle = '#b0b0b0';
    H.g.fillRect(0, y, S, 5);
  }
  stains(A.g, S, rng(5), 10, '50,30,18', 0.2, 10, 50);
  grain(A.g, S, S, 10, 3);
  return { map: k.tex(A.c, true), normal: k.tex(heightToNormal(H.c, 2.5), false), rough: k.tex(R.c, false) };
}

/** Diamond tread plate (0.6 m tile). */
export function treadMaps(k: TexKit): PBR {
  const S = 256;
  const A = cv(S);
  const H = cv(S);
  const R = cv(S);
  A.g.fillStyle = '#6a7078';
  A.g.fillRect(0, 0, S, S);
  H.g.fillStyle = '#808080';
  H.g.fillRect(0, 0, S, S);
  R.g.fillStyle = '#9c9c9c';
  R.g.fillRect(0, 0, S, S);
  const st = 32;
  for (let y = 0; y < S; y += st)
    for (let x = 0; x < S; x += st) {
      for (const [ox, oy, rot] of [
        [st * 0.25, st * 0.25, Math.PI / 4],
        [st * 0.75, st * 0.75, -Math.PI / 4],
      ]) {
        for (const [cg, col] of [
          [H.g, '#e0e0e0'],
          [A.g, 'rgba(255,255,255,0.12)'],
          [R.g, 'rgba(0,0,0,0.3)'],
        ] as [CanvasRenderingContext2D, string][]) {
          cg.save();
          cg.translate(x + ox, y + oy);
          cg.rotate(rot);
          cg.fillStyle = col;
          cg.beginPath();
          cg.ellipse(0, 0, 11, 3.2, 0, 0, Math.PI * 2);
          cg.fill();
          cg.restore();
        }
      }
    }
  stains(A.g, S, rng(8), 5, '30,22,16', 0.15, 10, 50);
  grain(A.g, S, S, 6, 4);
  grain(R.g, S, S, 20, 4);
  return { map: k.tex(A.c, true), normal: k.tex(heightToNormal(H.c, 2.8), false), rough: k.tex(R.c, false) };
}

/** Perforated steel grille (1 m tile). */
export function grilleMaps(k: TexKit): PBR {
  const S = 256;
  const A = cv(S);
  const H = cv(S);
  const R = cv(S);
  A.g.fillStyle = '#4a5058';
  A.g.fillRect(0, 0, S, S);
  H.g.fillStyle = '#a0a0a0';
  H.g.fillRect(0, 0, S, S);
  R.g.fillStyle = '#8a8a8a';
  R.g.fillRect(0, 0, S, S);
  const st = 16;
  for (let y = 0; y < S; y += st)
    for (let x = 0; x < S; x += st) {
      const ox = (y / st) % 2 ? st / 2 : 0;
      A.g.fillStyle = '#07080a';
      H.g.fillStyle = '#202020';
      for (const cg of [A.g, H.g]) {
        cg.beginPath();
        cg.arc(x + ox, y + st / 2, 5, 0, Math.PI * 2);
        cg.fill();
        if (ox) {
          cg.beginPath();
          cg.arc(x + ox - S, y + st / 2, 5, 0, Math.PI * 2);
          cg.fill();
        }
      }
    }
  stains(A.g, S, rng(12), 10, '40,26,16', 0.3, 20, 90);
  grain(A.g, S, S, 10, 6);
  return { map: k.tex(A.c, true), normal: k.tex(heightToNormal(H.c, 2), false), rough: k.tex(R.c, false) };
}

/** Refractory brick (tile = 4 m, bricks 0.5 x 0.25 m) with soot. */
export function brickMaps(k: TexKit): PBR {
  const S = 512;
  const A = cv(S);
  const H = cv(S);
  const R = cv(S);
  const r = rng(321);
  A.g.fillStyle = '#140e0c';
  A.g.fillRect(0, 0, S, S);
  H.g.fillStyle = '#303030';
  H.g.fillRect(0, 0, S, S);
  R.g.fillStyle = '#e8e8e8';
  R.g.fillRect(0, 0, S, S);
  const bw = 64;
  const bh = 32;
  for (let row = 0; row < S / bh; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < S / bw + 1; col++) {
      const x = col * bw + off;
      const y = row * bh;
      const v = r();
      A.g.fillStyle = `rgb(${62 + v * 30},${36 + v * 16},${28 + v * 10})`;
      A.g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      const hv = 150 + Math.floor(r() * 40);
      H.g.fillStyle = `rgb(${hv},${hv},${hv})`;
      H.g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
    }
  }
  // soot fading upward
  const grd = A.g.createLinearGradient(0, 0, 0, S);
  grd.addColorStop(0, 'rgba(8,6,6,0.55)');
  grd.addColorStop(1, 'rgba(8,6,6,0.1)');
  A.g.fillStyle = grd;
  A.g.fillRect(0, 0, S, S);
  mottle(A.g, S, 19, 0.45, 4);
  grain(A.g, S, S, 14, 2);
  return { map: k.tex(A.c, true), normal: k.tex(heightToNormal(H.c, 2), false), rough: k.tex(R.c, false) };
}

/** Corrugated wall siding (tile 4 m) with rust streaks. */
export function corrugatedMaps(k: TexKit): PBR {
  const S = 256;
  const A = cv(S);
  const H = cv(S);
  const R = cv(S);
  const r = rng(55);
  const img = H.g.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const v = 128 + Math.sin((x / S) * Math.PI * 2 * 16) * 100;
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  H.g.putImageData(img, 0, 0);
  // horizontal sheet seams
  H.g.fillStyle = '#202020';
  H.g.fillRect(0, 0, S, 3);
  A.g.fillStyle = '#353c46';
  A.g.fillRect(0, 0, S, S);
  A.g.fillStyle = '#1a1d22';
  A.g.fillRect(0, 0, S, 3);
  for (let i = 0; i < 40; i++) {
    const x = r() * S;
    const y = r() * S;
    const len = 40 + r() * 180;
    const lg = A.g.createLinearGradient(0, y, 0, y + len);
    lg.addColorStop(0, `rgba(${90 + r() * 40},44,20,0.35)`);
    lg.addColorStop(1, 'rgba(90,44,20,0)');
    A.g.fillStyle = lg;
    A.g.fillRect(x, y, 2 + r() * 6, len);
  }
  R.g.fillStyle = '#b0b0b0';
  R.g.fillRect(0, 0, S, S);
  mottle(A.g, S, 23, 0.4, 3);
  grain(A.g, S, S, 10, 11);
  return { map: k.tex(A.c, true), normal: k.tex(heightToNormal(H.c, 1.5), false), rough: k.tex(R.c, false) };
}

/** Distant building windows. */
export function windowsMap(k: TexKit): THREE.Texture {
  const W = 256;
  const H = 512;
  const { c, g } = cv(W, H);
  const r = rng(808);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  for (let y = 8; y < H - 8; y += 24)
    for (let x = 8; x < W - 8; x += 20) {
      const p = r();
      if (p < 0.55) continue;
      g.fillStyle = p < 0.85 ? `rgb(255,${130 + r() * 60},${50 + r() * 40})` : 'rgb(150,180,255)';
      g.globalAlpha = 0.4 + r() * 0.6;
      g.fillRect(x, y, 12, 14);
    }
  g.globalAlpha = 1;
  return k.tex(c, true);
}

export function skyTexture(k: TexKit): THREE.Texture {
  const { c, g } = cv(4, 512);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#05070d');
  grd.addColorStop(0.45, '#0d1019');
  grd.addColorStop(0.72, '#1f1820');
  grd.addColorStop(1, '#2a1a16');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 512);
  return k.tex(c, true, false);
}

/** Glowing sign text on transparent background. */
export function signTexture(k: TexKit, text: string, sub: string): THREE.Texture {
  const W = 2048;
  const H = 512;
  const { c, g } = cv(W, H);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 210px "Arial Black", Impact, sans-serif';
  g.shadowColor = 'rgba(255,120,30,1)';
  g.shadowBlur = 30;
  g.fillStyle = '#ffb36a';
  g.fillText(text, W / 2, H * 0.4, W * 0.92);
  g.shadowBlur = 16;
  g.font = 'bold 90px "Arial Black", Impact, sans-serif';
  g.fillStyle = '#ffd2a0';
  g.fillText(sub, W / 2, H * 0.83, W * 0.92);
  return k.tex(c, true, false);
}

/** Yellow warning plate. */
export function warnPlate(k: TexKit, l1: string, l2: string): THREE.Texture {
  const W = 512;
  const H = 256;
  const { c, g } = cv(W, H);
  g.fillStyle = '#d9a21e';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#141414';
  g.lineWidth = 14;
  g.strokeRect(14, 14, W - 28, H - 28);
  // triangle glyph
  g.fillStyle = '#141414';
  g.beginPath();
  g.moveTo(90, 70);
  g.lineTo(150, 190);
  g.lineTo(30, 190);
  g.closePath();
  g.fill();
  g.fillStyle = '#d9a21e';
  g.fillRect(85, 105, 10, 50);
  g.fillRect(85, 165, 10, 12);
  g.fillStyle = '#141414';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = 'bold 66px "Arial Black", Impact, sans-serif';
  g.fillText(l1, 175, 98);
  g.font = 'bold 44px "Arial Black", Impact, sans-serif';
  g.fillText(l2, 178, 170);
  stains(g, W, rng(3), 20, '30,20,10', 0.25, 10, 60);
  grain(g, W, H, 16, 2);
  return k.tex(c, true, false);
}

/**
 * Floor paint decal covering the whole deck (36 x 36 m). Canvas y=0 is world z=-18.
 * Worn yellow crane-path lines, spawn bay boxes, stencil numbers.
 */
export function floorDecal(k: TexKit, span: number, spawnZ: number, craneA: number): THREE.Texture {
  const S = 2048;
  const { c, g } = cv(S);
  const m = S / span;
  const X = (x: number) => (x + span / 2) * m;
  const Z = (z: number) => (z + span / 2) * m;
  g.clearRect(0, 0, S, S);
  const yellow = 'rgba(214,160,40,0.9)';
  const white = 'rgba(200,205,210,0.75)';
  // crane path: dashed borders + hatched end zones
  g.strokeStyle = yellow;
  g.lineWidth = 0.16 * m;
  g.setLineDash([1.2 * m, 0.6 * m]);
  for (const z of [-2.6, 2.6]) {
    g.beginPath();
    g.moveTo(X(-craneA - 2.2), Z(z));
    g.lineTo(X(craneA + 2.2), Z(z));
    g.stroke();
  }
  g.setLineDash([]);
  // chevrons in center showing travel direction
  g.lineWidth = 0.22 * m;
  for (const dir of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const x0 = dir * (3.0 + i * 1.1);
      g.beginPath();
      g.moveTo(X(x0 - dir * 0.5), Z(-1.1));
      g.lineTo(X(x0 + dir * 0.2), Z(0));
      g.lineTo(X(x0 - dir * 0.5), Z(1.1));
      g.stroke();
    }
  // spawn bays
  g.strokeStyle = white;
  g.lineWidth = 0.14 * m;
  for (const [sz, label] of [
    [spawnZ, 'BAY 3A'],
    [-spawnZ, 'BAY 3B'],
  ] as [number, string][]) {
    const w = 5.2;
    const d = 4.2;
    g.strokeRect(X(-w / 2), Z(sz - d / 2), w * m, d * m);
    // corner ticks
    g.lineWidth = 0.28 * m;
    for (const [cx, cz] of [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [-w / 2, d / 2],
      [w / 2, d / 2],
    ]) {
      g.beginPath();
      g.moveTo(X(cx + Math.sign(-cx) * -0 + (cx < 0 ? 0.8 : -0.8)), Z(sz + cz));
      g.lineTo(X(cx), Z(sz + cz));
      g.lineTo(X(cx), Z(sz + cz + (cz < 0 ? 0.8 : -0.8)));
      g.stroke();
    }
    g.lineWidth = 0.14 * m;
    g.save();
    g.translate(X(0), Z(sz + (sz > 0 ? 3.2 : -3.2)));
    if (sz < 0) g.rotate(Math.PI);
    g.fillStyle = white;
    g.font = `bold ${0.9 * m}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 0, 0);
    g.restore();
  }
  // big floor number by the north/south edges
  g.fillStyle = 'rgba(200,205,210,0.35)';
  g.font = `bold ${3.2 * m}px "Arial Black", Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.save();
  g.translate(X(-11), Z(15.2));
  g.fillText('03', 0, 0);
  g.restore();
  g.save();
  g.translate(X(11), Z(-15.2));
  g.rotate(Math.PI);
  g.fillText('03', 0, 0);
  g.restore();
  // centre ring
  g.strokeStyle = 'rgba(214,160,40,0.55)';
  g.lineWidth = 0.12 * m;
  g.beginPath();
  g.arc(X(0), Z(0), 1.6 * m, 0, Math.PI * 2);
  g.stroke();
  // wear: erase with noise
  const wear = noiseCanvas(256, 8, 4, 999);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = 0.85;
  const tmp = cv(256);
  const wi = wear.getContext('2d')!.getImageData(0, 0, 256, 256);
  const ti = tmp.g.createImageData(256, 256);
  for (let i = 0; i < wi.data.length; i += 4) {
    const v = wi.data[i] / 255;
    const a = Math.max(0, Math.min(1, (v - 0.42) * 3.5));
    ti.data[i + 3] = a * 255;
  }
  tmp.g.putImageData(ti, 0, 0);
  g.drawImage(tmp.c, 0, 0, S, S);
  // fine speckle wear
  const r = rng(4242);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 4, 1 + r() * 3);
  }
  g.restore();
  return k.tex(c, true, false);
}

/** High clerestory windows: cool moonlit panes in a dark steel frame. */
export function clerestoryMap(k: TexKit): THREE.Texture {
  const W = 1024;
  const H = 128;
  const { c, g } = cv(W, H);
  const r = rng(1201);
  g.fillStyle = '#060708';
  g.fillRect(0, 0, W, H);
  const cols = 16;
  const pw = W / cols;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < 2; j++) {
      const x = i * pw + 6;
      const y = j * (H / 2) + 6;
      const w = pw - 12;
      const h = H / 2 - 12;
      const p = r();
      const grd = g.createLinearGradient(x, y, x + w, y + h);
      const a = p < 0.15 ? 0.15 : 0.55 + r() * 0.45;
      grd.addColorStop(0, `rgba(150,180,235,${a})`);
      grd.addColorStop(1, `rgba(70,95,150,${a * 0.7})`);
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(6,7,8,0.9)';
      g.fillRect(x + w / 2 - 1, y, 2, h);
    }
  return k.tex(c, true);
}

/** Flowing molten metal: mostly continuous orange with drifting darker crust islands. */
export function flowMap(k: TexKit, seed = 41, size = 256): THREE.Texture {
  const { c, g } = cv(size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbm(u, v, 2, 4, 4, seed);
      const crust = fbm(u, v, 3, 3, 3, seed + 9);
      let h = 0.5 + (n - 0.5) * 0.9;
      h -= Math.max(0, (crust - 0.58) * 3.2);
      h = Math.max(0, Math.min(1, h));
      const i = (y * size + x) * 4;
      img.data[i] = 40 + h * 215;
      img.data[i + 1] = 8 + h * h * 150;
      img.data[i + 2] = 3 + h * h * h * 60;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return k.tex(c, true);
}
