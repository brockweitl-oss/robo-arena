// Lantern Terrace — a rooftop bonsai garden at dusk. Raked sand, stacked stone terraces, a giant bonsai,
// stone lanterns, a koi pond, paper lantern strings, and three steam geysers that launch fighters.
import * as THREE from 'three';
import type { ArenaFactory, BoxCollider, Collider, Hazard, RampCollider } from './types';
import { rng, tileMaps } from '../render/textures';
import { Buckets, mat4, rbox, rockGeo, taperTube, wedgeGeo, boxUV, prep } from './garden/geo';
import {
  bambooMaps, barkMaps, glazeMaps, leafNormal, mossMaps, paperLanternTex, pebbleMaps, rippleNormal, ringRakeMaps,
  roofTileMaps, sandMaps, shojiTex, stoneMaps, woodMaps, facadeTex, type PBRMaps,
} from './garden/tex';
import { buildEnvironment, buildSky, SKY } from './garden/sky';
import { blobGeo, crown, gate, koiGeo, pad, paperLanternGeo, stoneLanternGeos, type Blob } from './garden/props';
import { Fireflies, GeyserFX, Petals, type GeyserTiming } from './garden/fx';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, blocksShots = true): BoxCollider => ({
  kind: 'box', min: V(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)), max: V(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)), blocksShots,
});

// ---- Layout constants (meters) ----
const HALF = 17.6; // invisible clamp
const WALL_IN = 18.0; // inner face of the perimeter wall
const WALL_T = 0.7;
const EDGE = 22.5; // rooftop edge
const UP_H = 3.2; // upper (west) terrace
const MID_H = 1.2; // mid (east) bonsai terrace
const WT = { x0: -WALL_IN, x1: -11, z0: -5, z1: 5 };
const ET = { x0: 10, x1: WALL_IN, z0: -8, z1: 8 };
const PLANTER = { x0: 12.4, x1: 16.6, z0: -2.4, z1: 2.4, top: 2.7 };
const GEYSER_R = 1.3;
const GEYSERS = [
  { pos: V(-7.6, 0, 0), period: 7.5, offset: 3.0 },
  { pos: V(6.5, 0, 10), period: 8.5, offset: 4.5 },
  { pos: V(6.5, 0, -10), period: 8.5, offset: 8.75 },
];
const WARN = 1.2;
const ACTIVE = 0.8;
const pondR = (a: number) => 3.1 * (1 + 0.17 * Math.sin(2 * a + 0.5) + 0.07 * Math.sin(3 * a + 1.3));

export const createGarden: ArenaFactory = ({ quality, renderer }) => {
  const low = quality === 'low';
  const root = new THREE.Group();
  root.name = 'arena-garden';
  const T = low ? 256 : 512;
  const extraTex: THREE.Texture[] = [];
  const extraDispose: { dispose(): void }[] = [];

  // ---------- Materials ----------
  const std = (maps: PBRMaps | null, p: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ ...(maps ? { map: maps.map, normalMap: maps.normal, roughnessMap: maps.rough } : {}), ...p });
  const stoneT = stoneMaps(T, 3);
  const stoneT2 = stoneMaps(T, 9, [118, 118, 114]);
  const stone = std(stoneT, { color: '#d8d2c8', roughness: 1, normalScale: new THREE.Vector2(0.9, 0.9) });
  const rock = std(stoneT, { color: '#d0cac0', roughness: 1, normalScale: new THREE.Vector2(1.1, 1.1) });
  const stoneB = std(stoneT2, { color: '#bfc0bc', roughness: 1, normalScale: new THREE.Vector2(0.7, 0.7) });
  const paveT = tileMaps({ seed: 21, size: low ? 512 : 1024, tiles: 4, base: '#6f6a62', alt: '#7b766c', line: '#2c2925' });
  const pave = std(paveT, { color: '#d0ccc4', roughness: 1 });
  const sandT = sandMaps(low ? 512 : 1024);
  const sand = std(sandT, { color: '#ffffff', roughness: 1, normalScale: new THREE.Vector2(0.85, 0.85) });
  const mossT = mossMaps(T);
  const moss = std(mossT, { roughness: 1 });
  const woodT = woodMaps(T);
  const woodV = std(woodT, { roughness: 1, color: '#d8c8c0' });
  const woodHT = { map: woodT.map.clone(), normal: woodT.normal.clone(), rough: woodT.rough.clone() };
  for (const t of [woodHT.map, woodHT.normal, woodHT.rough]) { t.rotation = Math.PI / 2; t.needsUpdate = true; extraTex.push(t); }
  const woodH = std(woodHT, { roughness: 1, color: '#d8c8c0' });
  const copper = new THREE.MeshStandardMaterial({ color: '#5f9e8a', metalness: 0.65, roughness: 0.42 });
  const barkT = barkMaps(T);
  for (const t of [barkT.map, barkT.normal, barkT.rough]) t.repeat.set(2, 1);
  const bark = std(barkT, { roughness: 1, normalScale: new THREE.Vector2(1.4, 1.4) });
  const glazeT = glazeMaps(T);
  const glaze = new THREE.MeshPhysicalMaterial({ map: glazeT.map, roughnessMap: glazeT.rough, normalMap: glazeT.normal, roughness: 1, clearcoat: 1, clearcoatRoughness: 0.12, color: '#ffffff' });
  const iron = new THREE.MeshStandardMaterial({ color: '#2b2a2c', metalness: 0.8, roughness: 0.5 });
  const pit = new THREE.MeshStandardMaterial({ color: '#0d0c0d', roughness: 0.9 });
  const tileT = roofTileMaps(T);
  const roofTile = std(tileT, { roughness: 1, metalness: 0.2 });
  const facadeT = facadeTex();
  const facade = new THREE.MeshStandardMaterial({ map: facadeT, emissiveMap: facadeT, emissive: '#ffffff', emissiveIntensity: 0.45, roughness: 0.9 });
  const cord = new THREE.MeshStandardMaterial({ color: '#2a1c16', roughness: 0.9 });
  const bambooT = bambooMaps(low ? 128 : 256);
  const bamboo = std(bambooT, { roughness: 1 });
  const lily = new THREE.MeshStandardMaterial({ color: '#3c6a34', roughness: 0.45, side: THREE.DoubleSide });
  const soil = new THREE.MeshStandardMaterial({ color: '#2e241d', roughness: 1 });
  const pebT = pebbleMaps(T);
  const pondBed = std(pebT, { roughness: 1 });

  const B = new Buckets(root);
  B.register(stone, 0.33);
  B.register(stoneB, 0.4);
  B.register(rock, null);
  B.register(pave, 0.25, false, true);
  B.register(moss, 0.22, false, true);
  B.register(woodV, 0.6);
  B.register(woodH, 0.6);
  B.register(copper, null);
  B.register(bark, null);
  B.register(glaze, 0.3);
  B.register(iron, null);
  B.register(pit, null, false, true);
  B.register(roofTile, 0.9);
  B.register(facade, 0.125, false, true);
  B.register(cord, null, false, false);
  B.register(bamboo, null);
  B.register(lily, null, false, true);
  B.register(soil, null, false, true);
  B.register(pondBed, 0.5, false, true);

  const colliders: Collider[] = [];
  const foliage: Blob[] = [];
  const lanterns: { x: number; y: number; z: number; s: number; ry: number }[] = [];

  // ---------- Masonry helper ----------
  /** Stacked stone blocks on a face. axis: direction the face runs; n: sign of the outward face normal. */
  const masonry = (axis: 'x' | 'z', a0: number, a1: number, face: number, n: 1 | -1, y0: number, y1: number, seed: number, mat: THREE.Material = stone) => {
    const r = rng(seed);
    let y = y0;
    let row = 0;
    while (y < y1 - 0.08) {
      let rh = 0.42 + r() * 0.3;
      if (y1 - (y + rh) < 0.3) rh = y1 - y;
      let a = a0 - (row % 2 ? 0.4 + r() * 0.4 : r() * 0.3);
      while (a < a1 - 0.05) {
        let len = 0.75 + r() * 1.15;
        if (a1 - (a + len) < 0.4) len = a1 - a;
        const s = Math.max(a, a0), e = Math.min(a + len, a1);
        if (e - s > 0.15) {
          const depth = 0.45;
          const out = r() * 0.035;
          const c = (s + e) / 2;
          const perp = face - n * (depth / 2) + n * out;
          const g = rbox(e - s - 0.035, rh - 0.035, depth, 0.06, 2);
          const yaw = (r() - 0.5) * 0.02;
          const m = axis === 'x' ? mat4(c, y + rh / 2, perp, 0, yaw, (r() - 0.5) * 0.01) : mat4(perp, y + rh / 2, c, (r() - 0.5) * 0.01, Math.PI / 2 + yaw, 0);
          B.add(mat, g, m, r() * 10);
        }
        a += len;
      }
      y += rh;
      row++;
    }
  };
  /** Coping slabs along an edge (top at yTop). */
  const coping = (axis: 'x' | 'z', a0: number, a1: number, center: number, width: number, yTop: number, seed: number) => {
    const r = rng(seed);
    let a = a0;
    while (a < a1 - 0.05) {
      let len = 1.1 + r() * 0.9;
      if (a1 - (a + len) < 0.5) len = a1 - a;
      const c = a + len / 2;
      const g = rbox(len - 0.03, 0.24, width, 0.05, 2);
      B.add(stoneB, g, axis === 'x' ? mat4(c, yTop - 0.12, center) : mat4(center, yTop - 0.12, c, 0, Math.PI / 2, 0), r() * 10);
      a += len;
    }
  };

  // ---------- Floor ----------
  const floorShape = new THREE.Shape();
  floorShape.moveTo(-EDGE, -EDGE);
  floorShape.lineTo(EDGE, -EDGE);
  floorShape.lineTo(EDGE, EDGE);
  floorShape.lineTo(-EDGE, EDGE);
  floorShape.closePath();
  const pondPts: THREE.Vector2[] = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const rr = pondR(a);
    pondPts.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr)); // (x, z)
  }
  floorShape.holes.push(new THREE.Path(pondPts.map((p) => new THREE.Vector2(p.x, -p.y))));
  for (const g of GEYSERS) {
    const h = new THREE.Path();
    h.absarc(g.pos.x, -g.pos.z, 1.12, 0, Math.PI * 2, false);
    floorShape.holes.push(h);
  }
  const floorG = new THREE.ShapeGeometry(floorShape, 32);
  floorG.rotateX(-Math.PI / 2);
  prep(floorG);
  boxUV(floorG, 0.1);
  const floor = new THREE.Mesh(floorG, sand);
  floor.receiveShadow = true;
  root.add(floor);
  colliders.push(box(-EDGE, -1, -EDGE, EDGE, 0, EDGE));

  // Rooftop building below: facade walls, fascia, a lower tiled skirt.
  for (const s of [-1, 1]) {
    B.add(facade, new THREE.BoxGeometry(EDGE * 2 + 0.6, 14, 0.6), mat4(0, -7.2, s * (EDGE + 0.0)));
    B.add(facade, new THREE.BoxGeometry(0.6, 14, EDGE * 2 + 0.6), mat4(s * EDGE, -7.2, 0));
    B.add(woodH, rbox(EDGE * 2 + 1.2, 0.35, 0.3, 0.04), mat4(0, -0.12, s * (EDGE + 0.3)));
    B.add(woodH, rbox(0.3, 0.35, EDGE * 2 + 1.2, 0.04), mat4(s * (EDGE + 0.3), -0.12, 0));
    B.add(roofTile, rbox(EDGE * 2 + 4.4, 0.12, 2.4, 0.04), mat4(0, -3.4, s * (EDGE + 1.0), s * 0.42, 0, 0));
    B.add(roofTile, rbox(2.4, 0.12, EDGE * 2 + 4.4, 0.04), mat4(s * (EDGE + 1.0), -3.4, 0, 0, 0, -s * 0.42));
  }

  // ---------- West upper terrace ----------
  B.add(stone, new THREE.BoxGeometry(WT.x1 - WT.x0 - 0.3, UP_H - 0.1, WT.z1 - WT.z0 - 0.3), mat4((WT.x0 + WT.x1) / 2 - 0.1, (UP_H - 0.1) / 2, 0));
  masonry('z', WT.z0, WT.z1, WT.x1, 1, 0, UP_H - 0.22, 101);
  masonry('x', WT.x0, WT.x1, WT.z1, 1, 0, UP_H - 0.22, 102);
  masonry('x', WT.x0, WT.x1, WT.z0, -1, 0, UP_H - 0.22, 103);
  coping('z', WT.z0 - 0.06, WT.z1 + 0.06, WT.x1 - 0.27, 0.66, UP_H, 104);
  coping('x', WT.x0, WT.x1 - 0.6, WT.z1 - 0.27, 0.66, UP_H, 105);
  coping('x', WT.x0, WT.x1 - 0.6, WT.z0 + 0.27, 0.66, UP_H, 106);
  B.add(pave, new THREE.BoxGeometry(WT.x1 - WT.x0 - 0.6, 0.1, WT.z1 - WT.z0 - 1.2), mat4((WT.x0 + WT.x1 - 0.6) / 2, UP_H - 0.05, 0));
  colliders.push(box(WT.x0 - 0.7, 0, WT.z0, WT.x1, UP_H, WT.z1));

  // West ramps: stone stairs between cheek walls, rising toward -x.
  const W_RAMP = { x0: -11, x1: -5 };
  for (const [z0, z1] of [[2.6, 5.0], [-5.0, -2.6]] as const) {
    const zc = (z0 + z1) / 2, w = z1 - z0;
    const steps = 8, run = (W_RAMP.x1 - W_RAMP.x0) / steps, rise = UP_H / steps;
    for (let i = 0; i < steps; i++) {
      const top = rise * (i + 0.5);
      const x = W_RAMP.x1 - run * (i + 0.5);
      B.add(stoneB, rbox(run + 0.04, top + 0.05, w - 0.5, 0.05, 2), mat4(x, (top - 0.05) / 2, zc), i * 3.1);
    }
    for (const zs of [z0 + 0.14, z1 - 0.14]) {
      const wg = wedgeGeo(W_RAMP.x1 - W_RAMP.x0, UP_H, 0.28, 0.12);
      B.add(stone, wg, mat4(W_RAMP.x1, 0.12, zs, 0, Math.PI, 0));
    }
    const ramp: RampCollider = { kind: 'ramp', min: V(W_RAMP.x0, 0, z0), max: V(W_RAMP.x1, UP_H, z1), axis: 'x', dir: -1 };
    colliders.push(ramp);
  }

  // ---------- East mid terrace (bonsai) ----------
  B.add(stone, new THREE.BoxGeometry(ET.x1 - ET.x0 - 0.3, MID_H - 0.1, ET.z1 - ET.z0 - 0.3), mat4((ET.x0 + ET.x1) / 2 + 0.1, (MID_H - 0.1) / 2, 0));
  masonry('z', ET.z0, ET.z1, ET.x0, -1, 0, MID_H - 0.22, 201);
  masonry('x', ET.x0, ET.x1, ET.z1, 1, 0, MID_H - 0.22, 202);
  masonry('x', ET.x0, ET.x1, ET.z0, -1, 0, MID_H - 0.22, 203);
  coping('z', ET.z0 - 0.06, ET.z1 + 0.06, ET.x0 + 0.27, 0.66, MID_H, 204);
  coping('x', ET.x0 + 0.6, ET.x1, ET.z1 - 0.27, 0.66, MID_H, 205);
  coping('x', ET.x0 + 0.6, ET.x1, ET.z0 + 0.27, 0.66, MID_H, 206);
  B.add(moss, new THREE.BoxGeometry(ET.x1 - ET.x0 - 0.6, 0.1, ET.z1 - ET.z0 - 1.2), mat4((ET.x0 + ET.x1 + 0.6) / 2, MID_H - 0.06, 0));
  colliders.push(box(ET.x0, 0, ET.z0, ET.x1 + 0.7, MID_H, ET.z1));
  const E_RAMP = { x0: 7, x1: 10 };
  for (const [z0, z1] of [[3.4, 6.0], [-6.0, -3.4]] as const) {
    const zc = (z0 + z1) / 2, w = z1 - z0;
    const steps = 3, run = (E_RAMP.x1 - E_RAMP.x0) / steps, rise = MID_H / steps;
    for (let i = 0; i < steps; i++) {
      const top = rise * (i + 0.5);
      B.add(stoneB, rbox(run + 0.04, top + 0.05, w - 0.44, 0.05, 2), mat4(E_RAMP.x0 + run * (i + 0.5), (top - 0.05) / 2, zc), i * 2.3 + 7);
    }
    for (const zs of [z0 + 0.12, z1 - 0.12]) B.add(stone, wedgeGeo(E_RAMP.x1 - E_RAMP.x0, MID_H, 0.24, 0.1), mat4(E_RAMP.x0, 0.1, zs));
    colliders.push({ kind: 'ramp', min: V(E_RAMP.x0, 0, z0), max: V(E_RAMP.x1, MID_H, z1), axis: 'x', dir: 1 });
  }

  // ---------- Perimeter wall with tiled cap + lantern pillars ----------
  const WALL_H = 1.0;
  type Seg = { axis: 'x' | 'z'; a0: number; a1: number; face: number; n: 1 | -1; y0: number; h: number };
  const So = WALL_IN + WALL_T;
  const segs: Seg[] = [
    { axis: 'x', a0: -So, a1: So, face: WALL_IN, n: -1, y0: 0, h: WALL_H },
    { axis: 'x', a0: -So, a1: So, face: -WALL_IN, n: 1, y0: 0, h: WALL_H },
    { axis: 'z', a0: -WALL_IN, a1: ET.z0, face: WALL_IN, n: -1, y0: 0, h: WALL_H },
    { axis: 'z', a0: ET.z0, a1: ET.z1, face: WALL_IN, n: -1, y0: MID_H, h: MID_H + WALL_H },
    { axis: 'z', a0: ET.z1, a1: WALL_IN, face: WALL_IN, n: -1, y0: 0, h: WALL_H },
    { axis: 'z', a0: -WALL_IN, a1: WT.z0, face: -WALL_IN, n: 1, y0: 0, h: WALL_H },
    { axis: 'z', a0: WT.z0, a1: WT.z1, face: -WALL_IN, n: 1, y0: UP_H, h: UP_H + WALL_H },
    { axis: 'z', a0: WT.z1, a1: WALL_IN, face: -WALL_IN, n: 1, y0: 0, h: WALL_H },
  ];
  segs.forEach((s, i) => {
    const mid = s.face - s.n * (WALL_T / 2);
    const len = s.a1 - s.a0, c = (s.a0 + s.a1) / 2;
    B.add(stone, new THREE.BoxGeometry(s.axis === 'x' ? len : WALL_T - 0.1, s.h - 0.05, s.axis === 'x' ? WALL_T - 0.1 : len), s.axis === 'x' ? mat4(c, (s.h - 0.05) / 2, mid) : mat4(mid, (s.h - 0.05) / 2, c));
    masonry(s.axis, s.a0, s.a1, s.face, s.n, s.y0, s.h - 0.02, 300 + i);
    // gable cap: two pitched tile slabs + ridge
    const capL = len + 0.3;
    for (const side of [-1, 1]) {
      const g = rbox(s.axis === 'x' ? capL : 0.62, 0.08, s.axis === 'x' ? 0.62 : capL, 0.03, 1);
      const off = side * 0.24;
      const m = s.axis === 'x' ? mat4(c, s.h + 0.1, mid + off, side * 0.38, 0, 0) : mat4(mid + off, s.h + 0.1, c, 0, 0, -side * 0.38);
      B.add(roofTile, g, m);
    }
    B.add(roofTile, rbox(s.axis === 'x' ? capL : 0.16, 0.14, s.axis === 'x' ? 0.16 : capL, 0.05, 2), s.axis === 'x' ? mat4(c, s.h + 0.23, mid) : mat4(mid, s.h + 0.23, c));
  });
  const P = WALL_IN + WALL_T / 2;
  const pillars: [number, number, number][] = [
    [-P, 0, -P], [P, 0, -P], [-P, 0, P], [P, 0, P],
    [0, 0, -P], [0, 0, P], [-9.5, 0, -P], [9.5, 0, -P], [-9.5, 0, P], [9.5, 0, P],
    [-P, 0, -12], [-P, 0, 12], [P, 0, -12.5], [P, 0, 12.5],
  ];
  pillars.forEach(([x, , z], i) => {
    const h = WALL_H + 0.42;
    B.add(stoneB, rbox(0.95, h, 0.95, 0.06, 2), mat4(x, h / 2, z), i);
    B.add(stoneB, rbox(1.08, 0.12, 1.08, 0.04, 1), mat4(x, h + 0.02, z), i + 0.5);
    lanterns.push({ x, y: h + 0.08, z, s: 0.48, ry: (i * 0.7) % 1 });
  });

  // ---------- Pond ----------
  {
    const bedShape = new THREE.Shape(pondPts.map((p) => new THREE.Vector2(p.x * 1.02, -p.y * 1.02)));
    const bed = new THREE.ShapeGeometry(bedShape, 1);
    bed.rotateX(-Math.PI / 2);
    B.add(pondBed, bed, mat4(0, -0.55, 0));
    // pond wall band
    const pos: number[] = [], idx: number[] = [];
    pondPts.forEach((p) => pos.push(p.x, 0.0, p.y, p.x, -0.58, p.y));
    for (let i = 0; i < pondPts.length; i++) {
      const a = i * 2, b2 = ((i + 1) % pondPts.length) * 2;
      idx.push(a, a + 1, b2, b2, a + 1, b2 + 1);
    }
    const wall = new THREE.BufferGeometry();
    wall.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wall.setIndex(idx);
    wall.computeVertexNormals();
    B.add(stone, wall);
    // rim stones (low, walkable)
    const r = rng(404);
    const rimG = rockGeo(7, 2, 0.25);
    let a = 0;
    while (a < Math.PI * 2 - 0.05) {
      const rr = pondR(a) + 0.08;
      const s = 0.26 + r() * 0.18;
      const g = rimG.clone();
      B.add(rock, g, mat4(Math.cos(a) * rr, 0.02, Math.sin(a) * rr, 0, r() * 6, 0, s * 1.3, 0.13 + r() * 0.05, s), r() * 9);
      a += (s * 1.6) / rr;
    }
    rimG.dispose();
    // lily pads
    for (let i = 0; i < 7; i++) {
      const ang = r() * 6.28, d = 0.8 + r() * 1.4;
      const g = new THREE.CircleGeometry(0.22 + r() * 0.14, 14, 0.25, Math.PI * 2 - 0.5);
      g.rotateX(-Math.PI / 2);
      B.add(lily, g, mat4(Math.cos(ang) * d, -0.065, Math.sin(ang) * d, 0, r() * 6, 0));
      if (i % 3 === 0) foliage.push({ x: Math.cos(ang) * d, y: -0.02, z: Math.sin(ang) * d, sx: 0.09, sy: 0.07, sz: 0.09, ry: 0, color: new THREE.Color('#ffb0c8') });
    }
  }
  const waterShape = new THREE.Shape(pondPts.map((p) => new THREE.Vector2(p.x * 1.01, -p.y * 1.01)));
  const waterG = new THREE.ShapeGeometry(waterShape, 1);
  waterG.rotateX(-Math.PI / 2);
  prep(waterG);
  boxUV(waterG, 0.35);
  const ripple = rippleNormal(low ? 128 : 256);
  extraTex.push(ripple);
  const water = new THREE.MeshPhysicalMaterial({
    color: '#0b2b30', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.8,
    normalMap: ripple, normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 1.6, ior: 1.33, specularIntensity: 1,
  });
  const waterMesh = new THREE.Mesh(waterG, water);
  waterMesh.position.y = -0.07;
  waterMesh.receiveShadow = true;
  waterMesh.renderOrder = 2;
  root.add(waterMesh);

  // Koi
  const koiG = koiGeo();
  const koiM = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35 });
  const KOI = 7;
  const koi = new THREE.InstancedMesh(koiG, koiM, KOI);
  const koiCols = ['#ff6a1f', '#f4f0e8', '#ffb23a', '#e8401c', '#f4f0e8', '#ff8a3a', '#d8d0c0'];
  koiCols.forEach((c, i) => koi.setColorAt(i, new THREE.Color(c)));
  koi.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(koi);

  // ---------- Geysers ----------
  for (const g of GEYSERS) {
    const { x, z } = g.pos;
    const collar = new THREE.LatheGeometry([V(1.12, -0.06, 0), V(1.12, 0.035, 0), V(1.2, 0.06, 0), V(1.55, 0.055, 0), V(1.7, 0.01, 0), V(1.72, -0.05, 0)].map((v) => new THREE.Vector2(v.x, v.y)), 40);
    B.add(stoneB, collar, mat4(x, 0, z));
    const wallG = new THREE.CylinderGeometry(1.12, 0.95, 0.6, 28, 1, true);
    wallG.scale(-1, 1, 1);
    wallG.computeVertexNormals();
    B.add(pit, wallG, mat4(x, -0.3, z));
    const bottom = new THREE.CircleGeometry(1.0, 24);
    bottom.rotateX(-Math.PI / 2);
    B.add(pit, bottom, mat4(x, -0.58, z));
    const ring = new THREE.TorusGeometry(1.1, 0.055, 6, 40);
    ring.rotateX(Math.PI / 2);
    B.add(iron, ring, mat4(x, 0.0, z));
    for (let k = -6; k <= 6; k++) {
      const zz = k * 0.165;
      const L = 2 * Math.sqrt(Math.max(0, 1.12 * 1.12 - zz * zz));
      if (L < 0.2) continue;
      B.add(iron, rbox(L, 0.07, 0.045, 0.015, 1), mat4(x, -0.005, z + zz));
    }
    for (const xx of [-0.55, 0, 0.55]) B.add(iron, rbox(0.07, 0.09, 2 * Math.sqrt(1.12 * 1.12 - xx * xx), 0.015, 1), mat4(x + xx, -0.02, z));
    B.add(iron, new THREE.CylinderGeometry(0.2, 0.22, 0.08, 16), mat4(x, 0.0, z));
  }

  // ---------- Big stone lanterns (cover) ----------
  const bigLanterns: [number, number, number][] = [
    [4.8, 0, 4.6], [4.8, 0, -4.6], [15.5, MID_H, 6.2], [15.5, MID_H, -6.2],
  ];
  bigLanterns.forEach(([x, y, z], i) => {
    lanterns.push({ x, y, z, s: 1, ry: i * 0.4 });
    colliders.push(box(x - 0.8, y, z - 0.8, x + 0.8, y + 2.9, z + 0.8));
    foliage.push({ x: x + 0.5, y: y + 0.02, z: z - 0.3, sx: 0.5, sy: 0.16, sz: 0.4, ry: 0, color: new THREE.Color('#3f5f30') });
    foliage.push({ x: x - 0.45, y: y + 0.02, z: z + 0.4, sx: 0.4, sy: 0.12, sz: 0.35, ry: 1, color: new THREE.Color('#4a6a34') });
  });

  // ---------- Boulders with raked rings ----------
  const ringMaps = ringRakeMaps(low ? 256 : 512);
  extraTex.push(ringMaps.normal, ringMaps.alpha);
  const ringMat = new THREE.MeshStandardMaterial({
    color: '#6a6156', roughness: 0.95, normalMap: ringMaps.normal, normalScale: new THREE.Vector2(0.9, 0.9), alphaMap: ringMaps.alpha,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  });
  const ringGeo = new THREE.PlaneGeometry(1, 1);
  ringGeo.rotateX(-Math.PI / 2);
  extraDispose.push(ringGeo, ringMat);
  const addRakeRing = (x: number, z: number, size: number) => {
    const m = new THREE.Mesh(ringGeo, ringMat);
    m.position.set(x, 0.004, z);
    m.scale.set(size, 1, size);
    m.receiveShadow = true;
    m.renderOrder = 1;
    root.add(m);
  };
  const rockBox = (g: THREE.BufferGeometry, m: THREE.Matrix4) => {
    const c = g.clone().applyMatrix4(m);
    c.computeBoundingBox();
    const bb = c.boundingBox!.clone();
    c.dispose();
    return bb;
  };
  const boulder = (x: number, z: number, seed: number, sx: number, sy: number, sz: number, ry: number) => {
    const g1 = rockGeo(seed, 3, 0.26);
    const m1 = mat4(x, sy * 0.3, z, 0, ry, 0, sx, sy, sz);
    const g2 = rockGeo(seed + 11, 3, 0.3);
    const m2 = mat4(x + Math.cos(ry) * sx * 0.95, 0.15, z - Math.sin(ry) * sx * 0.95, 0, ry + 1, 0, sx * 0.42, sy * 0.38, sz * 0.5);
    const bb = rockBox(g1, m1).union(rockBox(g2, m2));
    B.add(rock, g1, m1, seed);
    B.add(rock, g2, m2, seed + 3);
    // shrink a touch: organic silhouettes sit inside the box
    colliders.push(box(bb.min.x + 0.08, 0, bb.min.z + 0.08, bb.max.x - 0.08, bb.max.y - 0.05, bb.max.z - 0.08));
    foliage.push({ x: x - Math.cos(ry) * sx * 0.8, y: 0.02, z: z + Math.sin(ry) * sx * 0.8, sx: 0.55, sy: 0.18, sz: 0.45, ry: 0, color: new THREE.Color('#3d5e2e') });
    return bb;
  };
  for (const s of [1, -1]) {
    boulder(-2.8, 6.5 * s, s > 0 ? 31 : 37, 1.25, 1.55, 0.95, s * 0.35);
    addRakeRing(-2.8, 6.5 * s, 7.6);
    // tall standing stone (east lanes)
    const g = rockGeo(s > 0 ? 51 : 57, 3, 0.22);
    const m = mat4(13.6, 1.0, 13.0 * s, 0.05 * s, s * 0.6, 0.06, 0.9, 2.2, 0.75);
    const bb = rockBox(g, m);
    B.add(rock, g, m, 4);
    const g2 = rockGeo(s > 0 ? 61 : 67, 2, 0.3);
    const m2 = mat4(12.5, 0.2, 13.6 * s, 0, 1, 0, 0.6, 0.55, 0.5);
    bb.union(rockBox(g2, m2));
    B.add(rock, g2, m2, 8);
    colliders.push(box(bb.min.x + 0.08, 0, bb.min.z + 0.08, bb.max.x - 0.08, bb.max.y - 0.05, bb.max.z - 0.08));
    addRakeRing(13.2, 13.2 * s, 6.4);
  }

  // Stepping stones (flush) from spawns toward the pond and the east ramps.
  {
    const r = rng(505);
    const flat = rockGeo(91, 2, 0.18);
    const stoneAt = (x: number, z: number, s: number) =>
      B.add(rock, flat.clone(), mat4(x, -0.035, z, 0, r() * 6, 0, s * (1 + r() * 0.3), 0.07, s), r() * 9);
    for (const sg of [1, -1]) {
      for (let i = 0; i < 5; i++) stoneAt((i % 2 ? 0.45 : -0.45) + (r() - 0.5) * 0.2, sg * (9.4 - i * 1.15), 0.42);
      for (let i = 0; i < 4; i++) stoneAt(2.2 + i * 1.2, sg * (10.4 - i * 1.4), 0.38);
      for (let i = 0; i < 4; i++) stoneAt(-4.5 - i * 1.1, sg * (8.5 - i * 0.9), 0.36);
    }
    flat.dispose();
  }

  // ---------- Gates ----------
  const gm = { woodV, woodH, copper, stone: stoneB, roof: roofTile };
  const gateHangs: THREE.Vector3[] = [];
  {
    const H = 4.4, half = 3.3, cx = -14.8;
    gateHangs.push(gate(B, gm, cx, UP_H, 0, 'z', half, H));
    for (const s of [-1, 1]) colliders.push(box(cx - 0.3, UP_H, s * half - 0.3, cx + 0.3, UP_H + H, s * half + 0.3));
    colliders.push(box(cx - 0.55, UP_H + H - 1.1, -half - 0.85, cx + 0.55, UP_H + H + 0.35, half + 0.85));
  }
  for (const sz of [1, -1]) {
    const H = 4.0, half = 1.9, cx = -8.5, cz = 11 * sz;
    gateHangs.push(gate(B, gm, cx, 0, cz, 'x', half, H));
    for (const s of [-1, 1]) colliders.push(box(cx + s * half - 0.3, 0, cz - 0.3, cx + s * half + 0.3, H, cz + 0.3));
    colliders.push(box(cx - half - 0.85, H - 1.1, cz - 0.55, cx + half + 0.85, H + 0.35, cz + 0.55));
  }

  // ---------- Bamboo groves (cover) ----------
  for (const sz of [1, -1]) {
    const cx = -14.2, cz = 13.2 * sz, hw = 1.3;
    const r = rng(sz > 0 ? 606 : 616);
    for (const [dx, dz, w, d] of [[0, -hw, hw * 2 + 0.3, 0.3], [0, hw, hw * 2 + 0.3, 0.3], [-hw, 0, 0.3, hw * 2 - 0.3], [hw, 0, 0.3, hw * 2 - 0.3]]) {
      B.add(stoneB, rbox(w, 0.4, d, 0.06, 2), mat4(cx + dx, 0.2, cz + dz), r() * 9);
    }
    B.add(moss, new THREE.BoxGeometry(hw * 2 - 0.3, 0.1, hw * 2 - 0.3), mat4(cx, 0.32, cz));
    const n = low ? 9 : 14;
    for (let i = 0; i < n; i++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * (hw - 0.3);
      const bx = cx + Math.cos(a) * d, bz = cz + Math.sin(a) * d;
      const h = 5.5 + r() * 2.5, rad = 0.06 + r() * 0.045;
      const tilt = (r() - 0.5) * 0.12, tiltz = (r() - 0.5) * 0.12;
      const g = new THREE.CylinderGeometry(rad * 0.8, rad, h, 8, 1);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) * (h / 0.55) + r() * 0);
      B.add(bamboo, g, mat4(bx, h / 2, bz, tilt, r() * 6, tiltz));
      const top = new THREE.Vector3(bx - Math.sin(tiltz) * h * 0.5 * 0, h, bz);
      top.set(bx + Math.sin(-tiltz) * h * 0.5 + 0, h, bz + Math.sin(tilt) * h * 0.5);
      // leaf sprays: narrow drooping blades along the upper culm
      const nl = low ? 14 : 26;
      for (let k = 0; k < nl; k++) {
        const t = 0.5 + r() * 0.5;
        const la = r() * 6.28;
        const reach = 0.25 + r() * 0.35;
        foliage.push({
          x: bx + (top.x - bx) * t + Math.cos(la) * reach, y: h * t, z: bz + (top.z - bz) * t + Math.sin(la) * reach,
          sx: 0.34 + r() * 0.12, sy: 0.025, sz: 0.075, ry: -la, rx: (r() - 0.5) * 0.5, rz: -0.35 - r() * 0.4,
          color: new THREE.Color().setHSL(0.2 + r() * 0.06, 0.5, 0.24 + r() * 0.14),
        });
      }
    }
    colliders.push(box(cx - hw - 0.15, 0, cz - hw - 0.15, cx + hw + 0.15, 7.0, cz + hw + 0.15));
  }

  // ---------- Bonsai (centerpiece) ----------
  {
    // planter: glazed pot on feet with a lipped rim
    const pcx = (PLANTER.x0 + PLANTER.x1) / 2;
    const pw = PLANTER.x1 - PLANTER.x0, pd = PLANTER.z1 - PLANTER.z0;
    for (const fx of [-1, 1]) for (const fz of [-1, 1]) B.add(glaze, rbox(0.7, 0.2, 0.7, 0.06, 2), mat4(pcx + fx * (pw / 2 - 0.55), MID_H + 0.1, fz * (pd / 2 - 0.55)));
    B.add(glaze, rbox(pw - 0.2, 1.22, pd - 0.2, 0.18, 3), mat4(pcx, MID_H + 0.2 + 0.61, 0));
    for (const s of [-1, 1]) {
      B.add(glaze, rbox(pw, 0.22, 0.34, 0.09, 3), mat4(pcx, PLANTER.top - 0.11, s * (pd / 2 - 0.17)));
      B.add(glaze, rbox(0.34, 0.22, pd - 0.6, 0.09, 3), mat4(pcx + s * (pw / 2 - 0.17), PLANTER.top - 0.11, 0));
    }
    B.add(soil, new THREE.BoxGeometry(pw - 0.6, 0.05, pd - 0.6), mat4(pcx, PLANTER.top - 0.07, 0));
    colliders.push(box(PLANTER.x0, MID_H, PLANTER.z0, PLANTER.x1, PLANTER.top, PLANTER.z1));
    const r = rng(707);
    for (let i = 0; i < 26; i++) {
      const a = r() * 6.28, d = 0.9 + r() * 1.0;
      foliage.push({ x: 14.6 + Math.cos(a) * d * 1.0, y: PLANTER.top - 0.06, z: Math.sin(a) * d * 1.1, sx: 0.22 + r() * 0.16, sy: 0.12 + r() * 0.06, sz: 0.2 + r() * 0.16, ry: r() * 6, color: new THREE.Color().setHSL(0.28, 0.5, 0.08 + r() * 0.05) });
    }
    // trunk
    const tp = [V(14.7, 2.45, 0.1), V(14.95, 3.4, 0.35), V(14.55, 4.3, 0.1), V(13.95, 5.1, -0.3), V(13.55, 6.0, -0.1), V(13.75, 6.9, 0.3), V(14.2, 7.7, 0.1), V(14.4, 8.6, -0.2)];
    const trunk = new THREE.CatmullRomCurve3(tp);
    B.add(bark, taperTube(trunk, (s) => 0.82 * Math.pow(1 - s, 1.05) + 0.13 + 0.55 * Math.exp(-s * 22), low ? 32 : 56, low ? 10 : 16, 0.16, 3, 1.4));
    colliders.push(box(13.8, PLANTER.top, -0.85, 15.6, 4.7, 0.95));
    // surface roots
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.4;
      const c = new THREE.CatmullRomCurve3([V(14.7 + Math.cos(a) * 0.4, 3.0, 0.1 + Math.sin(a) * 0.4), V(14.7 + Math.cos(a) * 0.95, 2.72, 0.1 + Math.sin(a) * 0.95), V(14.7 + Math.cos(a) * 1.5, 2.6, 0.1 + Math.sin(a) * 1.5)]);
      B.add(bark, taperTube(c, (s) => 0.26 * (1 - s) + 0.05, 10, 8, 0.2, 10 + k, 1.0));
    }
    // branches + foliage pads
    const pads: [THREE.Vector3[], number, [number, number, number, number, number, number]][] = [
      [[V(13.95, 5.1, -0.3), V(12.6, 5.45, -0.6), V(11.1, 5.85, -0.35), V(9.7, 6.3, 0.2)], 0.36, [9.5, 6.55, 0.2, 2.3, 0.65, 1.9]],
      [[V(13.6, 5.9, -0.1), V(13.2, 6.15, -1.5), V(12.6, 6.55, -3.0)], 0.26, [12.4, 6.85, -3.2, 1.8, 0.55, 1.6]],
      [[V(13.85, 6.8, 0.3), V(14.6, 7.0, 1.6), V(15.2, 7.35, 2.8)], 0.24, [15.3, 7.65, 2.9, 1.7, 0.55, 1.5]],
      [[V(14.55, 4.4, 0.1), V(15.6, 4.85, -0.8), V(16.6, 5.35, -1.6)], 0.28, [16.7, 5.65, -1.8, 1.5, 0.5, 1.35]],
      [[V(13.6, 6.4, 0.1), V(12.6, 6.9, 1.4), V(11.6, 7.4, 2.4)], 0.22, [11.4, 7.7, 2.6, 1.6, 0.5, 1.4]],
      [[V(14.3, 7.9, 0.0), V(15.4, 8.2, -1.2), V(16.2, 8.5, -2.0)], 0.2, [16.3, 8.8, -2.2, 1.4, 0.5, 1.2]],
      [[V(14.4, 8.4, -0.2), V(14.35, 8.9, -0.1)], 0.16, [14.4, 9.15, -0.1, 2.1, 0.8, 1.9]],
    ];
    pads.forEach(([pts, r0, p], i) => {
      const c = new THREE.CatmullRomCurve3(pts);
      B.add(bark, taperTube(c, (s) => r0 * (1 - s * 0.7), low ? 12 : 20, low ? 7 : 10, 0.12, 20 + i, 1.2));
      pad(foliage, p[0], p[1], p[2], p[3], p[4], p[5], 800 + i, '#1d3d24', '#7fae4c', 0.78, low ? 1.0 : 1.7);
      // a lower, smaller sub-pad for depth
      pad(foliage, p[0] + (pts[pts.length - 1].x - p[0]) * 0.4 + 0.3, p[1] - 0.45, p[2] + 0.4, p[3] * 0.55, p[4] * 0.7, p[5] * 0.55, 900 + i, '#1b3521', '#4d7b3a', 0.85, low ? 0.6 : 1);
    });
    // bleached deadwood spike
    const jin = new THREE.CatmullRomCurve3([V(14.3, 8.3, -0.2), V(14.05, 9.5, 0.25), V(14.5, 10.4, 0.05)]);
    B.add(stoneB, taperTube(jin, (s) => 0.11 * (1 - s) + 0.015, 12, 6, 0.25, 77, 1));
  }

  // ---------- Blossom trees + hedges in the outer beds ----------
  {
    const r = rng(909);
    const trees: [number, number][] = [[-20.6, 15.2], [-20.6, -15.2], [20.6, 14.6], [20.6, -14.6]];
    trees.forEach(([x, z], i) => {
      const lean = x > 0 ? -1 : 1;
      const c = new THREE.CatmullRomCurve3([V(x, -0.1, z), V(x + lean * 0.3, 1.6, z + 0.2), V(x + lean * 0.2, 3.0, z - 0.2), V(x + lean * 0.7, 4.2, z)]);
      B.add(bark, taperTube(c, (s) => 0.32 * (1 - s) + 0.08 + 0.2 * Math.exp(-s * 18), 24, 10, 0.18, 40 + i, 1.2));
      const crowns: [number, number, number, number][] = [[lean * 0.6, 4.6, 0, 2.2], [lean * -0.9, 4.0, 1.1, 1.5], [lean * 1.6, 3.9, -1.0, 1.5], [lean * 0.2, 5.4, -0.5, 1.4]];
      crowns.forEach(([dx, y, dz, rad], k) => {
        const bc = new THREE.CatmullRomCurve3([V(x + lean * 0.4, 3.2, z), V(x + dx * 0.7, y - 0.6, z + dz * 0.7)]);
        B.add(bark, taperTube(bc, (s) => 0.12 * (1 - s) + 0.04, 8, 6, 0.1, 50 + i * 4 + k, 1));
        crown(foliage, x + dx, y, z + dz, rad, Math.round(rad * rad * (low ? 9 : 18)), 950 + i * 7 + k, '#b04f72', '#ffc9d8', 0.72);
      });
    });
    // hedges along the outer beds
    const hedgeAt = (x: number, z: number) => crown(foliage, x, 0.45, z, 0.9, low ? 3 : 5, Math.floor(r() * 1e6), '#1d3524', '#3f6a3c', 0.95);
    for (let a = -EDGE + 1; a <= EDGE - 1; a += low ? 2.4 : 1.5) {
      for (const s of [-1, 1]) {
        if (Math.abs(a) < 17.5 || true) {
          const near = (tx: number, tz: number) => trees.some(([px, pz]) => Math.hypot(px - tx, pz - tz) < 2.2);
          const o = 20.6 + (r() - 0.5) * 0.8;
          if (!near(a, s * o)) hedgeAt(a, s * o);
          if (Math.abs(a) < EDGE - 3 && !near(s * o, a)) hedgeAt(s * o, a);
        }
      }
    }
  }

  // ---------- Paper lantern strings ----------
  const paperHangs: { p: THREE.Vector3; axis: THREE.Vector3; ph: number; col: THREE.Color }[] = [];
  {
    const palette = [new THREE.Color(3.4, 0.9, 0.35), new THREE.Color(3.2, 1.7, 0.7), new THREE.Color(2.9, 2.3, 1.5)];
    const r = rng(1001);
    for (const sz of [-9, 9]) {
      const x0 = -WALL_IN - 0.35, x1 = WALL_IN + 0.35, yTop = 8.0, sag = 1.5;
      for (const x of [x0, x1]) {
        B.add(woodV, new THREE.CylinderGeometry(0.09, 0.13, yTop + 0.3, 10), mat4(x, (yTop + 0.3) / 2, sz));
        B.add(copper, new THREE.ConeGeometry(0.16, 0.3, 10), mat4(x, yTop + 0.42, sz));
      }
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        pts.push(V(x0 + (x1 - x0) * t, yTop - sag * (1 - Math.pow(2 * t - 1, 2)), sz));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      B.add(cord, new THREE.TubeGeometry(curve, 60, 0.018, 4, false));
      const n = 19;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        paperHangs.push({ p: curve.getPointAt(t), axis: V(1, 0, 0), ph: r() * 6.28, col: palette[Math.floor(r() * 3)] });
      }
    }
    for (const h of gateHangs) paperHangs.push({ p: h, axis: V(1, 0, 0), ph: r() * 6.28, col: palette[1] });
  }
  const plTex = paperLanternTex();
  const plMat = new THREE.MeshBasicMaterial({ map: plTex, color: '#ffffff' });
  const plGeo = paperLanternGeo();
  const paper = new THREE.InstancedMesh(plGeo, plMat, paperHangs.length);
  paperHangs.forEach((h, i) => paper.setColorAt(i, h.col));
  paper.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(paper);

  // ---------- Stone lanterns (instanced) ----------
  const lg = stoneLanternGeos();
  const lStone = new THREE.InstancedMesh(lg.stone, stoneB, lanterns.length);
  const shoji = shojiTex();
  const glowMat = new THREE.MeshBasicMaterial({ map: shoji, color: new THREE.Color(4.2, 2.3, 0.95) });
  const lGlow = new THREE.InstancedMesh(lg.glow, glowMat, lanterns.length);
  lanterns.forEach((l, i) => {
    const m = mat4(l.x, l.y, l.z, 0, l.ry, 0, l.s, l.s, l.s);
    lStone.setMatrixAt(i, m);
    lGlow.setMatrixAt(i, m);
  });
  lStone.castShadow = true;
  lStone.receiveShadow = true;
  root.add(lStone, lGlow);

  // ---------- Foliage (instanced) ----------
  const fGeo = blobGeo(low ? 1 : 2);
  const leafN = leafNormal(low ? 128 : 256);
  extraTex.push(leafN);
  const fMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.82, normalMap: leafN, normalScale: new THREE.Vector2(0.9, 0.9) });
  const fol = new THREE.InstancedMesh(fGeo, fMat, foliage.length);
  {
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), m = new THREE.Matrix4(), e = new THREE.Euler();
    foliage.forEach((b, i) => {
      e.set(b.rx ?? 0, b.ry, b.rz ?? 0, 'YXZ');
      q.setFromEuler(e);
      m.compose(p.set(b.x, b.y, b.z), q, s.set(b.sx, b.sy, b.sz));
      fol.setMatrixAt(i, m);
      fol.setColorAt(i, b.color);
    });
  }
  fol.castShadow = true;
  fol.receiveShadow = true;
  root.add(fol);

  const staticMeshes = B.build();

  // ---------- Lights ----------
  const keyDir = V(-0.7, 0.62, 0.36).normalize();
  const key = new THREE.DirectionalLight('#ffc19c', 3.2);
  key.position.copy(keyDir).multiplyScalar(48);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -26; sc.right = 26; sc.top = 24; sc.bottom = -24; sc.near = 12; sc.far = 90;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  root.add(key, key.target);
  const hemi = new THREE.HemisphereLight('#7aa6c8', '#4a3434', 1.25);
  root.add(hemi);
  const pls = bigLanterns.map(([x, y, z]) => {
    const l = new THREE.PointLight('#ffad62', 7, 11, 2);
    l.position.set(x, y + 1.9, z);
    root.add(l);
    return l;
  });

  // ---------- Sky / environment / fog ----------
  const sky = buildSky(quality);
  root.add(sky.group);
  const envRT = buildEnvironment(renderer);
  const fog = new THREE.Fog(SKY.fog.clone(), 40, 210);

  // ---------- Hazards ----------
  const phaseOf = (g: (typeof GEYSERS)[number]) => (t: number) => (t < g.offset ? -1 : (t - g.offset) % g.period);
  const hazards: Hazard[] = GEYSERS.map((g) => {
    const ph = phaseOf(g);
    return {
      center: g.pos.clone(),
      radius: GEYSER_R,
      yMin: g.pos.y - 0.5,
      yMax: g.pos.y + 2.6,
      damage: 40,
      down: 25,
      launch: 14,
      isWarning: (t: number) => { const p = ph(t); return p >= 0 && p < WARN; },
      isActive: (t: number) => { const p = ph(t); return p >= WARN && p < WARN + ACTIVE; },
    };
  });
  const timings: GeyserTiming[] = GEYSERS.map((g) => ({ pos: g.pos, phase: phaseOf(g), warn: WARN, active: ACTIVE }));
  const gfx = new GeyserFX(timings, quality, GEYSER_R);
  root.add(gfx.group);

  // ---------- Ambient FX ----------
  const fireflies = new Fireflies(low ? 36 : quality === 'medium' ? 70 : 100, [V(13, 2, 0), V(0, 0.6, 0), V(-14, 3.6, 0), V(-14, 1, 13), V(-14, 1, -13), V(9, 0.8, 9), V(9, 0.8, -9), V(-6, 0.6, 9), V(-6, 0.6, -9)], 7);
  root.add(fireflies.pool.points);
  const petals = new Petals(low ? 80 : quality === 'medium' ? 160 : 240);
  root.add(petals.mesh);

  // ---------- Animation ----------
  let simT = 0;
  const dummy = new THREE.Object3D();
  const hangM = new THREE.Matrix4(), tmpM = new THREE.Matrix4(), rotM = new THREE.Matrix4();
  const koiState = Array.from({ length: KOI }, (_, i) => ({ r: 0.9 + (i % 4) * 0.42, sp: (0.25 + (i % 3) * 0.08) * (i % 2 ? 1 : -1), ph: i * 1.7, wob: 0.3 + (i % 3) * 0.15 }));
  const koiPos = (k: (typeof koiState)[number], t: number, out: THREE.Vector3) => {
    const a = k.ph + t * k.sp;
    const rr = k.r + Math.sin(t * 0.4 + k.ph) * k.wob;
    return out.set(Math.cos(a) * rr * 1.1, -0.26 - (k.r % 0.2), Math.sin(a) * rr * 0.85);
  };
  const kp = V(0, 0, 0), kp2 = V(0, 0, 0);
  const sway = (time: number) => {
    paperHangs.forEach((h, i) => {
      const ang = Math.sin(time * 1.3 + h.ph) * 0.12 + Math.sin(time * 0.7 + h.ph * 2) * 0.05;
      const twist = time * 0.3 + h.ph;
      hangM.makeTranslation(h.p.x, h.p.y, h.p.z);
      rotM.makeRotationAxis(h.axis, ang);
      hangM.multiply(rotM);
      rotM.makeRotationY(twist);
      hangM.multiply(rotM);
      tmpM.makeTranslation(0, -0.36, 0);
      hangM.multiply(tmpM);
      paper.setMatrixAt(i, hangM);
    });
    paper.instanceMatrix.needsUpdate = true;
  };
  sway(0);

  const update = (time: number, dt: number) => {
    sky.skyMat.uniforms.time.value = time;
    // lantern flicker
    const f = 0.9 + Math.sin(time * 9.1) * 0.04 + Math.sin(time * 23.7) * 0.03;
    glowMat.color.setRGB(4.2 * f, 2.3 * f, 0.95 * f);
    pls.forEach((l, i) => (l.intensity = 7 * (0.92 + Math.sin(time * 8.3 + i * 2.1) * 0.05 + Math.sin(time * 17.9 + i) * 0.03)));
    sway(time);
    // koi
    koiState.forEach((k, i) => {
      koiPos(k, time, kp);
      koiPos(k, time + 0.05, kp2);
      dummy.position.copy(kp);
      dummy.lookAt(kp2.x, kp.y, kp2.z);
      dummy.rotateY(Math.sin(time * 6 + i) * 0.12);
      dummy.updateMatrix();
      koi.setMatrixAt(i, dummy.matrix);
    });
    koi.instanceMatrix.needsUpdate = true;
    ripple.offset.set(time * 0.012, time * 0.007);
    gfx.update(simT, Math.min(dt, 0.05), time);
    fireflies.update(time);
    petals.update(time, Math.min(dt, 0.05));
  };

  return {
    info: { id: 'garden', name: 'Lantern Terrace', subtitle: 'Rooftop Bonsai Garden', blurb: 'Stone terraces at dusk. Steam geysers launch anything standing on them.', music: 'garden', accent: '#7fe0a0' },
    root,
    colliders,
    hazards,
    spawns: [V(0, 0, 11), V(0, 0, -11)],
    halfX: HALF,
    halfZ: HALF,
    background: SKY.fog.clone(),
    environment: envRT.texture,
    fog,
    keyLight: key,
    tick(t: number) {
      simT = t;
    },
    update,
    dispose() {
      const mats = new Set<THREE.Material>();
      const geos = new Set<THREE.BufferGeometry>();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) geos.add(m.geometry);
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      });
      const texs = new Set<THREE.Texture>(extraTex);
      for (const m of mats) {
        for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) texs.add(v as THREE.Texture);
        const u = (m as THREE.ShaderMaterial).uniforms;
        if (u) for (const k in u) if (u[k].value && u[k].value.isTexture) texs.add(u[k].value);
        m.dispose();
      }
      geos.forEach((g) => g.dispose());
      texs.forEach((t) => t.dispose());
      extraDispose.forEach((d) => d.dispose());
      gfx.dispose();
      fireflies.dispose();
      petals.dispose();
      sky.dispose();
      envRT.dispose();
      void staticMeshes;
    },
  };
};
