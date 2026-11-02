// Procedural canvas textures for Lantern Terrace: raked sand, granite, cedar wood, bark, moss, water ripples, paper.
import * as THREE from 'three';
import { heightToNormal } from '../../render/textures';
import { tfbm, tnoise, tcell, hash3 } from './noise';

export interface PBRMaps {
  map: THREE.Texture;
  normal: THREE.Texture;
  rough: THREE.Texture;
}

function cv(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  return { c, g };
}

function tex(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** out = [r,g,b (0..255), height 0..1, roughness 0..1] */
type Painter = (u: number, v: number, out: number[]) => void;

function bake(size: number, paint: Painter, normalStrength: number): PBRMaps {
  const a = cv(size), h = cv(size), r = cv(size);
  const ai = a.g.createImageData(size, size), hi = h.g.createImageData(size, size), ri = r.g.createImageData(size, size);
  const out = [0, 0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      paint(x / size, y / size, out);
      const i = (y * size + x) * 4;
      ai.data[i] = out[0];
      ai.data[i + 1] = out[1];
      ai.data[i + 2] = out[2];
      ai.data[i + 3] = 255;
      const hv = Math.max(0, Math.min(255, out[3] * 255));
      hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = hv;
      hi.data[i + 3] = 255;
      const rv = Math.max(0, Math.min(255, out[4] * 255));
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = rv;
      ri.data[i + 3] = 255;
    }
  }
  a.g.putImageData(ai, 0, 0);
  h.g.putImageData(hi, 0, 0);
  r.g.putImageData(ri, 0, 0);
  return { map: tex(a.c, true), normal: tex(heightToNormal(h.c, normalStrength), false), rough: tex(r.c, false) };
}

const sm = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Raked sand: parallel rake grooves with gentle warp, fine grain. Tile = ~10 m. */
export function sandMaps(size: number): PBRMaps {
  const lines = 44;
  return bake(
    size,
    (u, v, o) => {
      const warp = (tfbm(u, v, 3, 3, 11) - 0.5) * 1.2;
      const ph = (v * lines + warp) * Math.PI * 2;
      const groove = 0.5 + 0.5 * Math.sin(ph);
      const ridge = Math.pow(groove, 0.7);
      const grain = hash3((u * size) | 0, (v * size) | 0, 3, 5);
      const blot = tfbm(u, v, 6, 4, 23);
      const h = ridge * 0.75 + grain * 0.12 + blot * 0.13;
      const shade = 0.86 + ridge * 0.1 + (grain - 0.5) * 0.09 + (blot - 0.5) * 0.12;
      o[0] = 118 * shade;
      o[1] = 108 * shade;
      o[2] = 96 * shade;
      o[3] = h;
      o[4] = 0.92 - ridge * 0.05;
    },
    3.2,
  );
}

/** Concentric rake rings (for decal rings around rocks). Radial alpha fade; returns normal + alpha. */
export function ringRakeMaps(size: number): { normal: THREE.Texture; alpha: THREE.Texture } {
  const h = cv(size), al = cv(size);
  const hi = h.g.createImageData(size, size), ai = al.g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x / size - 0.5, dy = y / size - 0.5;
      const r = Math.hypot(dx, dy) * 2; // 0..1 at edge
      const g = 0.5 + 0.5 * Math.sin(r * 9 * Math.PI * 2);
      const grain = hash3(x, y, 9, 2);
      const i = (y * size + x) * 4;
      const hv = (Math.pow(g, 0.7) * 0.85 + grain * 0.15) * 255;
      hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = hv;
      hi.data[i + 3] = 255;
      const a = sm(0.32, 0.4, r) * (1 - sm(0.86, 0.99, r));
      ai.data[i] = ai.data[i + 1] = ai.data[i + 2] = a * 255;
      ai.data[i + 3] = 255;
    }
  h.g.putImageData(hi, 0, 0);
  al.g.putImageData(ai, 0, 0);
  const normal = tex(heightToNormal(h.c, 3.2), false);
  normal.wrapS = normal.wrapT = THREE.ClampToEdgeWrapping;
  const alpha = tex(al.c, false);
  alpha.wrapS = alpha.wrapT = THREE.ClampToEdgeWrapping;
  return { normal, alpha };
}

/** Weathered granite with lichen. */
export function stoneMaps(size: number, seed: number, tint: [number, number, number] = [128, 124, 116]): PBRMaps {
  return bake(
    size,
    (u, v, o) => {
      const n = tfbm(u, v, 4, 5, seed);
      const n2 = tfbm(u, v, 16, 3, seed + 7);
      const cell = tcell(u, v, 7, seed + 3);
      const crack = sm(0.06, 0.0, Math.abs(tnoise(u, v, 10, seed + 9) - 0.5) - 0.0) * 0.0;
      const speck = hash3((u * size) | 0, (v * size) | 0, seed, 1);
      const lich = sm(0.58, 0.72, tfbm(u, v, 5, 4, seed + 41));
      let s = 0.78 + (n - 0.5) * 0.45 + (n2 - 0.5) * 0.18 + (speck > 0.93 ? 0.12 : speck < 0.05 ? -0.1 : 0);
      s *= 0.92 + cell * 0.12;
      const r = tint[0] * s, g = tint[1] * s, b = tint[2] * s;
      o[0] = mix(r, 128 * s * 0.95, lich * 0.55);
      o[1] = mix(g, 140 * s * 1.02, lich * 0.55);
      o[2] = mix(b, 92 * s * 0.9, lich * 0.55);
      o[3] = n * 0.6 + n2 * 0.3 + cell * 0.25 - crack;
      o[4] = 0.78 + (n2 - 0.5) * 0.2 + lich * 0.1;
    },
    2.4,
  );
}

/** Dark-stained cedar; grain runs along V. */
export function woodMaps(size: number): PBRMaps {
  return bake(
    size,
    (u, v, o) => {
      const w = tfbm(u, v, 3, 3, 71) * 2.5;
      const grain = 0.5 + 0.5 * Math.sin((u * 26 + w) * Math.PI * 2);
      const fine = tnoise(u * 1, v, 64, 72);
      const streak = tfbm(u, v * 0.25, 24, 2, 74);
      const s = 0.75 + grain * 0.18 + (fine - 0.5) * 0.12 + (streak - 0.5) * 0.25;
      o[0] = 78 * s;
      o[1] = 50 * s;
      o[2] = 36 * s;
      o[3] = grain * 0.5 + fine * 0.2 + streak * 0.3;
      o[4] = 0.55 + (1 - grain) * 0.2;
    },
    1.6,
  );
}

/** Gnarled bark: ridged fibers along V with dark fissures. */
export function barkMaps(size: number): PBRMaps {
  return bake(
    size,
    (u, v, o) => {
      const warp = tfbm(u, v, 2, 3, 81) * 1.6;
      const f = Math.abs(Math.sin((u * 9 + warp + tnoise(u, v, 4, 82) * 0.6) * Math.PI));
      const ridge = Math.pow(f, 0.45);
      const fine = tfbm(u, v, 24, 2, 83);
      const moss = sm(0.6, 0.75, tfbm(u, v, 3, 3, 84));
      const s = 0.45 + ridge * 0.5 + (fine - 0.5) * 0.2;
      o[0] = mix(96 * s, 70 * s, moss);
      o[1] = mix(80 * s, 92 * s, moss);
      o[2] = mix(68 * s, 52 * s, moss);
      o[3] = ridge * 0.8 + fine * 0.2;
      o[4] = 0.9;
    },
    4,
  );
}

/** Velvet moss / short lawn for the mid terrace. */
export function mossMaps(size: number): PBRMaps {
  return bake(
    size,
    (u, v, o) => {
      const n = tfbm(u, v, 5, 5, 91);
      const tuft = hash3((u * size) | 0, (v * size) | 0, 4, 92);
      const big = tfbm(u, v, 2, 3, 93);
      const s = 0.7 + (n - 0.5) * 0.5 + (tuft - 0.5) * 0.18;
      o[0] = (52 + big * 20) * s;
      o[1] = (84 + big * 18) * s;
      o[2] = 40 * s;
      o[3] = n * 0.7 + tuft * 0.3;
      o[4] = 0.95;
    },
    2.2,
  );
}

/** Pond bed: dark pebbles. */
export function pebbleMaps(size: number): PBRMaps {
  return bake(
    size,
    (u, v, o) => {
      const c = tcell(u, v, 22, 101);
      const id = hash3(Math.floor(u * 22), Math.floor(v * 22), 7, 102);
      const peb = sm(0.75, 0.35, c);
      const s = 0.35 + peb * (0.35 + id * 0.35);
      o[0] = 80 * s;
      o[1] = 82 * s;
      o[2] = 78 * s;
      o[3] = peb;
      o[4] = 0.6;
    },
    3,
  );
}

/** Tileable ripple normal map for water. */
export function rippleNormal(size: number): THREE.Texture {
  const h = cv(size);
  const img = h.g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const a = Math.sin((u * 3 + v * 2) * Math.PI * 2 + tfbm(u, v, 3, 3, 111) * 4);
      const b = Math.sin((u * -2 + v * 5) * Math.PI * 2 + tfbm(u, v, 4, 3, 112) * 4);
      const val = (a * 0.5 + b * 0.5) * 0.35 + tfbm(u, v, 8, 3, 113) * 0.6;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = (val * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  h.g.putImageData(img, 0, 0);
  return tex(heightToNormal(h.c, 1.6), false);
}

/** Leafy normal for foliage blobs. */
export function leafNormal(size: number): THREE.Texture {
  const h = cv(size);
  const img = h.g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = tcell(x / size, y / size, 18, 121);
      const val = Math.max(0, 1 - c * 1.6);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val * 255;
      img.data[i + 3] = 255;
    }
  h.g.putImageData(img, 0, 0);
  return tex(heightToNormal(h.c, 5), false);
}

/** Shoji-style paper window (lantern firebox glow). White-ish: tint with material color. */
export function shojiTex(): THREE.Texture {
  const { c, g } = cv(128);
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 90);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(1, '#b0a090');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(30,18,10,0.85)';
  for (let i = 0; i <= 4; i++) {
    g.fillRect(0, i * 32 - 2, 128, 4);
  }
  for (let i = 0; i <= 8; i++) g.fillRect(i * 16 - 1.5, 0, 3, 128);
  return tex(c, true);
}

/** Paper lantern skin: ribs + dark caps at both ends (lathe V runs bottom → top). */
export function paperLanternTex(): THREE.Texture {
  const { c, g } = cv(128);
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, '#5a3020');
  grd.addColorStop(0.5, '#ffffff');
  grd.addColorStop(1, '#5a3020');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(80,40,20,0.35)';
  for (let i = 0; i < 12; i++) g.fillRect(0, 10 + i * 9, 128, 1.5);
  g.fillStyle = '#1a1210';
  g.fillRect(0, 0, 128, 9);
  g.fillRect(0, 119, 128, 9);
  // abstract ring crest (no text)
  g.strokeStyle = 'rgba(150,45,25,0.55)';
  g.lineWidth = 4;
  for (let k = 0; k < 2; k++) {
    g.beginPath();
    g.arc(32 + k * 64, 64, 13, 0, Math.PI * 2);
    g.stroke();
  }
  const t = tex(c, true);
  return t;
}

/** Distant city windows: dark facade with a few warm lit windows. */
export function windowTex(): THREE.Texture {
  const { c, g } = cv(256);
  g.fillStyle = '#000000';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const r = hash3(x, y, 0, 131);
      if (r < 0.28) {
        const warm = hash3(x, y, 1, 132);
        g.fillStyle = warm < 0.8 ? `rgba(255,${170 + (warm * 60) | 0},${90 + (warm * 50) | 0},${0.5 + r})` : 'rgba(170,220,255,0.6)';
        g.fillRect(x * 16 + 4, y * 16 + 5, 8, 7);
      }
    }
  return tex(c, true);
}

/** Moon disc with soft maria. */
export function moonTex(): THREE.Texture {
  const size = 256;
  const { c, g } = cv(size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x / size - 0.5) * 2, dy = (y / size - 0.5) * 2;
      const r = Math.hypot(dx, dy);
      const i = (y * size + x) * 4;
      const disc = sm(1.0, 0.96, r);
      const maria = tfbm(x / size, y / size, 4, 4, 141);
      const s = 0.9 + (maria - 0.5) * 0.3 - sm(0.55, 0.75, maria) * 0.1;
      const limb = 0.75 + 0.25 * Math.sqrt(Math.max(0, 1 - r * r));
      img.data[i] = 255 * s * limb;
      img.data[i + 1] = 245 * s * limb;
      img.data[i + 2] = 225 * s * limb;
      img.data[i + 3] = disc * 255;
    }
  g.putImageData(img, 0, 0);
  const t = tex(c, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Glazed ceramic (planter) color variation. */
export function glazeMaps(size: number): PBRMaps {
  return bake(
    size,
    (u, v, o) => {
      const n = tfbm(u, v, 3, 4, 151);
      const drip = tfbm(u * 0.2, v, 12, 2, 152);
      const s = 0.8 + (n - 0.5) * 0.4 + (drip - 0.5) * 0.25;
      o[0] = 30 * s;
      o[1] = 78 * s;
      o[2] = 88 * s;
      o[3] = n * 0.3;
      o[4] = 0.18 + n * 0.15;
    },
    0.6,
  );
}

/** Plaster + timber building facade for the rooftop's side walls. */
export function facadeTex(): THREE.Texture {
  const { c, g } = cv(256);
  g.fillStyle = '#3a3532';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(${hash3(i, 0, 0, 161) < 0.5 ? '0,0,0' : '255,240,220'},0.04)`;
    g.fillRect(hash3(i, 1, 0, 161) * 256, hash3(i, 2, 0, 161) * 256, 20, 14);
  }
  g.fillStyle = '#231915';
  g.fillRect(0, 0, 256, 14);
  g.fillRect(0, 120, 256, 10);
  for (let x = 0; x < 4; x++) g.fillRect(x * 64, 0, 9, 256);
  // lit windows
  for (let x = 0; x < 4; x++) {
    g.fillStyle = hash3(x, 3, 0, 162) < 0.6 ? '#ffb070' : '#2a2422';
    g.fillRect(x * 64 + 22, 40, 26, 46);
    g.fillStyle = 'rgba(20,12,8,0.8)';
    g.fillRect(x * 64 + 34, 40, 2, 46);
    g.fillRect(x * 64 + 22, 62, 26, 2);
  }
  return tex(c, true);
}

/** Clay roof tiles (columns + overlapping rows) for wall caps. */
export function roofTileMaps(size: number): PBRMaps {
  return bake(
    size,
    (u, v, o) => {
      const cu = (u * 8) % 1, cvv = (v * 8) % 1;
      const col = Math.sin(cu * Math.PI);
      const row = Math.pow(cvv, 1.5);
      const n = tfbm(u, v, 8, 3, 171);
      const h = col * 0.6 + row * 0.35 + n * 0.1;
      const s = 0.55 + col * 0.25 + row * 0.15 + (n - 0.5) * 0.2;
      o[0] = 62 * s;
      o[1] = 68 * s;
      o[2] = 80 * s;
      o[3] = h;
      o[4] = 0.5 + (1 - col) * 0.3;
    },
    3,
  );
}

/** Bamboo culm: green with a node band at v≈0 (repeat V per node). */
export function bambooMaps(size: number): PBRMaps {
  return bake(
    size,
    (u, v, o) => {
      const node = sm(0.05, 0.0, Math.min(v, 1 - v));
      const streak = tnoise(u, v * 0.1, 48, 181);
      const n = tfbm(u, v, 4, 3, 182);
      const s = 0.8 + (streak - 0.5) * 0.15 + (n - 0.5) * 0.2 - node * 0.25;
      o[0] = (88 + n * 30) * s;
      o[1] = (118 + n * 10) * s;
      o[2] = 52 * s;
      o[3] = 0.5 + node * 0.5 + streak * 0.05;
      o[4] = 0.38 + node * 0.3;
    },
    4,
  );
}
