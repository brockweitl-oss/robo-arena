// Crucible Yard — industrial foundry floor at night. Steel deck, two raised catwalks with ramps,
// ingot-crate cover and a crane platform that shuttles across the arena on a timed path.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ArenaFactory, BoxCollider, Collider, RampCollider } from './types';
import { glowSprite, panelMaps, grimeMap, smokeSprite, studioEnvironment, rng } from '../render/textures';
import {
  TexKit,
  deckMaps,
  hazardMaps,
  lavaMap,
  pourMap,
  furnaceMap,
  crateMaps,
  gratingMaps,
  treadMaps,
  grilleMaps,
  brickMaps,
  corrugatedMaps,
  windowsMap,
  skyTexture,
  signTexture,
  warnPlate,
  floorDecal,
  clerestoryMap,
  flowMap,
} from './foundry/tex';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(V(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)).clone(), V(sx, sy, sz));
}
const RB = (w: number, h: number, d: number, r = 0.05, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
const BX = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const CY = (rt: number, rb: number, h: number, seg = 16, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);

/** Rewrite UVs by world-space box projection (dominant normal axis). */
function worldUV(g: THREE.BufferGeometry, s: number) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = n.getX(i);
    const ny = n.getY(i);
    const nz = n.getZ(i);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = x;
      v = -z;
    } else if (ax >= az) {
      u = -z * Math.sign(nx);
      v = y;
    } else {
      u = x * Math.sign(nz);
      v = y;
    }
    uv[i * 2] = u * s;
    uv[i * 2 + 1] = v * s;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Collects static geometry per material and merges it into one mesh per material. */
class Batch {
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private shadow = new Map<THREE.Material, [boolean, boolean]>();
  noCast = false;
  cfg(m: THREE.Material, cast: boolean, receive: boolean) {
    this.shadow.set(m, [cast, receive]);
  }
  add(mat: THREE.Material, geo: THREE.BufferGeometry, m?: THREE.Matrix4, uvScale?: number, color?: THREE.Color) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (m) g.applyMatrix4(m);
    if (uvScale) worldUV(g, uvScale);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if ((mat as THREE.MeshStandardMaterial).vertexColors) {
      const c = color ?? new THREE.Color(1, 1, 1);
      const n = g.attributes.position.count;
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        a[i * 3] = c.r;
        a[i * 3 + 1] = c.g;
        a[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    g.morphAttributes = {};
    g.clearGroups();
    let list = this.groups.get(mat);
    if (!list) this.groups.set(mat, (list = []));
    list.push(g);
  }
  build(parent: THREE.Object3D) {
    for (const [mat, geos] of this.groups) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      const [cast, receive] = this.shadow.get(mat) ?? [true, true];
      mesh.castShadow = cast && !this.noCast;
      mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
    }
    this.groups.clear();
  }
}

/** Flat-shaded convex polygon (fan) with outward-facing winding. */
function poly(pts: THREE.Vector3[], outward: THREE.Vector3): THREE.BufferGeometry {
  const a = pts[0];
  const n = new THREE.Vector3().subVectors(pts[1], a).cross(new THREE.Vector3().subVectors(pts[2], a));
  const ordered = n.dot(outward) < 0 ? [a, ...pts.slice(1).reverse()] : pts;
  const pos: number[] = [];
  for (let i = 1; i < ordered.length - 1; i++) pos.push(...ordered[0].toArray(), ...ordered[i].toArray(), ...ordered[i + 1].toArray());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Cylinder between two points. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = CY(r, r, d.length(), seg, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Layout constants
const HALF = 18;
const UP = 3.0; // catwalk / crane deck height
const SPAWN_Z = 11.5;
const CRANE_A = 9.6; // crane centre travels x in [-A, A]
const CRANE_PAUSE = 2.6;
const CRANE_TRAVEL = 5.2;
const CRANE_CYCLE = 2 * (CRANE_PAUSE + CRANE_TRAVEL);
const CRANE_HX = 2.0;
const CRANE_HZ = 2.25;
const CRANE_BOTTOM = 2.25;
const RAIL_Y = 13.4; // gantry rail centre height
const RAIL_Z = 2.8;

/** Crane centre x and velocity as a pure function of sim time (eased ping-pong with dwell). */
function craneAt(t: number): [number, number] {
  const A = CRANE_A;
  let p = (((t + CRANE_PAUSE + CRANE_TRAVEL / 2) % CRANE_CYCLE) + CRANE_CYCLE) % CRANE_CYCLE;
  const ease = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * u);
  const speed = (u: number) => ((2 * A * 0.5 * Math.PI * Math.sin(Math.PI * u)) / CRANE_TRAVEL);
  if (p < CRANE_PAUSE) return [-A, 0];
  p -= CRANE_PAUSE;
  if (p < CRANE_TRAVEL) return [-A + 2 * A * ease(p / CRANE_TRAVEL), speed(p / CRANE_TRAVEL)];
  p -= CRANE_TRAVEL;
  if (p < CRANE_PAUSE) return [A, 0];
  p -= CRANE_PAUSE;
  return [A - 2 * A * ease(p / CRANE_TRAVEL), -speed(p / CRANE_TRAVEL)];
}

export const createFoundry: ArenaFactory = (opts) => {
  const { quality, renderer } = opts;
  const low = quality === 'low';
  const pScale = quality === 'high' ? 1 : quality === 'medium' ? 0.75 : 0.4;
  const root = new THREE.Group();
  root.name = 'foundry';
  const kit = new TexKit();
  const ownedMats: THREE.Material[] = [];
  const ownedGeos: THREE.BufferGeometry[] = [];
  const R = rng(1337);

  // ------------------------------------------------------------------ textures & materials
  const deck = deckMaps(kit);
  const haz = hazardMaps(kit);
  const crateT = crateMaps(kit);
  const grat = gratingMaps(kit);
  const tread = treadMaps(kit);
  const grille = grilleMaps(kit);
  const brick = brickMaps(kit);
  const corr = corrugatedMaps(kit);
  const lavaT = lavaMap(kit, 7);
  const lavaT2 = lavaMap(kit, 19, 128, 0.08);
  const lavaFlow = flowMap(kit, 31);
  const clerT = clerestoryMap(kit);
  const pourT = pourMap(kit);
  const furnT = furnaceMap(kit);
  const winT = windowsMap(kit);
  const skyT = skyTexture(kit);
  const signT = signTexture(kit, 'CRUCIBLE YARD', 'FOUNDRY FLOOR 3  ·  HOT METAL ZONE');
  const warnT = warnPlate(kit, 'MOLTEN', 'METAL  ·  KEEP CLEAR');
  const warnT2 = warnPlate(kit, 'CRANE', 'OVERHEAD LOAD');
  const decalT = floorDecal(kit, HALF * 2, SPAWN_Z, CRANE_A);
  const pnl = panelMaps(14, 512, 1);
  const pnlFine = panelMaps(23, 512, 2);
  const grime = grimeMap(8, 512, 1.2);

  const std = (p: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial(p);
    ownedMats.push(m);
    return m;
  };
  const basic = (p: THREE.MeshBasicMaterialParameters) => {
    const m = new THREE.MeshBasicMaterial(p);
    ownedMats.push(m);
    return m;
  };
  const hdr = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);

  const mat = {
    deck: std({ map: deck.map, normalMap: deck.normal, roughnessMap: deck.rough, roughness: 0.95, metalness: 0.45, normalScale: new THREE.Vector2(0.9, 0.9), envMapIntensity: 0.7 }),
    outer: std({ map: deck.map, normalMap: deck.normal, roughnessMap: deck.rough, color: 0x55524f, roughness: 1, metalness: 0.3, envMapIntensity: 0.4 }),
    hazard: std({ map: haz.map, roughnessMap: haz.rough, roughness: 0.85, metalness: 0.15, normalMap: pnlFine.normal, normalScale: new THREE.Vector2(0.3, 0.3) }),
    steel: std({ color: 0x3a434d, normalMap: pnl.normal, roughnessMap: pnl.rough, roughness: 0.9, metalness: 0.55, envMapIntensity: 0.8 }),
    steelMid: std({ color: 0x59636e, normalMap: pnlFine.normal, roughnessMap: grime, roughness: 0.75, metalness: 0.6, normalScale: new THREE.Vector2(0.5, 0.5) }),
    yellow: std({ color: 0xc58a1c, roughnessMap: grime, roughness: 0.7, metalness: 0.25, normalMap: pnlFine.normal, normalScale: new THREE.Vector2(0.35, 0.35) }),
    iron: std({ color: 0x2a2c30, roughnessMap: grime, roughness: 0.8, metalness: 0.7, normalMap: pnl.normal, normalScale: new THREE.Vector2(0.4, 0.4) }),
    ironDS: std({ color: 0x2c2b2c, roughnessMap: grime, roughness: 0.75, metalness: 0.75, normalMap: pnl.normal, normalScale: new THREE.Vector2(0.5, 0.5), side: THREE.DoubleSide }),
    grating: std({ map: grat.map, normalMap: grat.normal, roughnessMap: grat.rough, roughness: 0.9, metalness: 0.6 }),
    tread: std({ color: 0x9a9a9a, map: tread.map, normalMap: tread.normal, roughnessMap: tread.rough, roughness: 0.85, metalness: 0.65 }),
    grille: std({ map: grille.map, normalMap: grille.normal, roughnessMap: grille.rough, roughness: 0.8, metalness: 0.55 }),
    crate: std({ map: crateT.map, normalMap: crateT.normal, roughnessMap: crateT.rough, roughness: 0.9, metalness: 0.35, vertexColors: true }),
    brick: std({ map: brick.map, normalMap: brick.normal, roughnessMap: brick.rough, roughness: 1, metalness: 0 }),
    wall: std({ map: corr.map, normalMap: corr.normal, roughnessMap: corr.rough, roughness: 0.85, metalness: 0.5, envMapIntensity: 0.5 }),
    ingot: std({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.8, roughnessMap: grime, envMapIntensity: 1.3 }),
    ingotHot: std({ color: 0x3a2018, roughness: 0.6, metalness: 0.4, emissive: 0xff3a00, emissiveIntensity: 1.6, emissiveMap: lavaFlow }),
    glowAmber: basic({ color: hdr(0xffa045, 4.5) }),
    glowSodium: basic({ color: hdr(0xffb060, 6) }),
    lamp: basic({ color: hdr(0xffe0b0, 3) }),
    lava: basic({ map: lavaFlow, color: hdr(0xffffff, 3.2) }),
    clerestory: basic({ map: clerT, color: hdr(0xffffff, 0.9) }),
    lavaPool: basic({ map: lavaT2, color: hdr(0xffffff, 1.6) }),
    pour: basic({ map: pourT, color: hdr(0xffffff, 5.5) }),
    furnace: basic({ map: furnT, color: hdr(0xffffff, 3.2) }),
    blinkRed: basic({ color: hdr(0xff2010, 6) }),
    blinkAmber: basic({ color: hdr(0xffa020, 6) }),
    windows: basic({ map: winT, color: hdr(0xffffff, 1.6) }),
    silhouette: std({ color: 0x15171c, roughness: 1, metalness: 0.2 }),
    sign: basic({ map: signT, color: hdr(0xffffff, 2.6), transparent: true, depthWrite: false }),
    warn: std({ map: warnT, roughness: 0.7, metalness: 0.1 }),
    warn2: std({ map: warnT2, roughness: 0.7, metalness: 0.1 }),
    decal: std({ map: decalT, transparent: true, depthWrite: false, roughness: 0.75, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    shell: std({ color: 0x5a4c44, normalMap: pnl.normal, roughnessMap: grime, roughness: 0.9, metalness: 0.35, side: THREE.DoubleSide, normalScale: new THREE.Vector2(0.6, 0.6) }),
    chain: std({ color: 0x4a4c50, roughness: 0.45, metalness: 0.9 }),
  };
  for (const t of [mat.lava.map!, mat.lavaPool.map!]) t.wrapS = t.wrapT = THREE.RepeatWrapping;

  const B = new Batch();
  // Emissive / background materials don't need shadows.
  for (const m of [mat.clerestory, mat.glowAmber, mat.glowSodium, mat.lamp, mat.lava, mat.lavaPool, mat.pour, mat.furnace, mat.blinkRed, mat.blinkAmber, mat.windows, mat.sign]) B.cfg(m, false, false);
  for (const m of [mat.outer, mat.wall, mat.brick, mat.silhouette, mat.decal, mat.hazard, mat.grating, mat.tread]) B.cfg(m, false, true);
  B.cfg(mat.deck, false, true);
  B.cfg(mat.ironDS, false, true);
  B.cfg(mat.shell, false, true);

  // ------------------------------------------------------------------ colliders
  const colliders: Collider[] = [];
  const box = (min: THREE.Vector3, max: THREE.Vector3): BoxCollider => {
    const c: BoxCollider = { kind: 'box', min, max };
    colliders.push(c);
    return c;
  };
  colliders.push({ kind: 'box', min: V(-22, -1, -22), max: V(22, 0, 22) });

  /** Box collider in side-space (side 1 is rotated 180 deg about Y). */
  const sideBox = (flip: boolean, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
    flip ? box(V(-x1, y0, -z1), V(-x0, y1, -z0)) : box(V(x0, y0, z0), V(x1, y1, z1));

  // ------------------------------------------------------------------ deck floor & perimeter
  const floorSpan = HALF * 2 + 1.2; // deck extends under the curb
  {
    const g = new THREE.PlaneGeometry(floorSpan, floorSpan);
    g.rotateX(-Math.PI / 2);
    B.add(mat.deck, g, undefined, 1 / 8);
    // plinth skirt
    for (const [x, z, w, d] of [
      [0, -HALF - 0.6, floorSpan + 0.2, 0.2],
      [0, HALF + 0.6, floorSpan + 0.2, 0.2],
      [-HALF - 0.6, 0, 0.2, floorSpan + 0.2],
      [HALF + 0.6, 0, 0.2, floorSpan + 0.2],
    ])
      B.add(mat.iron, BX(w, 0.62, d), M(x, -0.3, z), 1 / 2);
    // painted markings
    const dg = new THREE.PlaneGeometry(HALF * 2, HALF * 2);
    dg.rotateX(-Math.PI / 2);
    dg.translate(0, 0.004, 0);
    B.add(mat.decal, dg);
    // hazard band along the edge
    const bw = 0.55;
    for (const [x, z, w, d] of [
      [0, -HALF + bw / 2, HALF * 2, bw],
      [0, HALF - bw / 2, HALF * 2, bw],
      [-HALF + bw / 2, 0, bw, HALF * 2 - bw * 2],
      [HALF - bw / 2, 0, bw, HALF * 2 - bw * 2],
    ]) {
      const hg = new THREE.PlaneGeometry(w, d);
      hg.rotateX(-Math.PI / 2);
      hg.translate(x, 0.006, z);
      B.add(mat.hazard, hg, undefined, 1 / 0.9);
    }
    // curb
    for (const [x, z, w, d] of [
      [0, -HALF - 0.3, floorSpan, 0.6],
      [0, HALF + 0.3, floorSpan, 0.6],
      [-HALF - 0.3, 0, 0.6, floorSpan - 1.2],
      [HALF + 0.3, 0, 0.6, floorSpan - 1.2],
    ])
      B.add(mat.steel, RB(w, 0.45, d, 0.06), M(x, 0.225, z), 1 / 3);
    // outer ground
    const og = new THREE.PlaneGeometry(170, 170);
    og.rotateX(-Math.PI / 2);
    og.translate(0, -0.6, 0);
    B.add(mat.outer, og, undefined, 1 / 8);
  }

  // Railings: posts are instanced, rails merged.
  const posts: THREE.Matrix4[] = [];
  const railing = (a: THREE.Vector3, b: THREE.Vector3, h = 1.1, spacing = 2.2, endPost = true) => {
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.round(len / spacing));
    for (let i = 0; i <= n; i++) {
      if (i === n && !endPost) break;
      const p = a.clone().lerp(b, i / n);
      posts.push(M(p.x, p.y + h / 2, p.z, 0, 0, 0, 1, h, 1));
    }
    for (const f of [1, 0.55]) B.add(mat.yellow, rod(a.clone().setY(a.y + h * f), b.clone().setY(b.y + h * f), f === 1 ? 0.05 : 0.035, 8));
    // toe board
    const mid = a.clone().lerp(b, 0.5);
    const rm = new THREE.Matrix4().lookAt(a, b, V(0, 1, 0));
    rm.setPosition(mid.x, mid.y + 0.07, mid.z);
    B.add(mat.steelMid, BX(0.04, 0.14, len), rm, 1);
  };
  const CY0 = 0.45; // curb top
  const E = HALF + 0.3;
  railing(V(-E, CY0, -E), V(E, CY0, -E));
  railing(V(-E, CY0, E), V(E, CY0, E));
  railing(V(-E, CY0, -E), V(-E, CY0, -7.4));
  railing(V(-E, CY0, 13.4), V(-E, CY0, E));
  railing(V(E, CY0, -E), V(E, CY0, -13.4));
  railing(V(E, CY0, 7.4), V(E, CY0, E));

  // Warning plates on the north / south railings (face inward).
  for (const [x, z, ry, m] of [
    [-6, -E + 0.06, 0, mat.warn],
    [7, -E + 0.06, 0, mat.warn2],
    [6, E - 0.06, Math.PI, mat.warn],
    [-7, E - 0.06, Math.PI, mat.warn2],
  ] as [number, number, number, THREE.Material][]) {
    B.add(m, new THREE.PlaneGeometry(1.1, 0.55), M(x, CY0 + 0.78, z, 0, ry, 0));
    B.add(mat.steelMid, BX(1.16, 0.6, 0.03), M(x, CY0 + 0.78, z + (ry ? 0.02 : -0.02), 0, ry, 0));
  }

  // Corner pillars with beacons.
  const blinkRedGeo: [THREE.BufferGeometry, THREE.Matrix4][] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (HALF + 0.3);
      const z = sz * (HALF + 0.3);
      B.add(mat.iron, RB(1.0, 2.4, 1.0, 0.08), M(x, 1.2, z), 1 / 2);
      B.add(mat.hazard, BX(1.02, 0.5, 1.02), M(x, 1.75, z), 1 / 0.9);
      B.add(mat.steelMid, RB(1.2, 0.18, 1.2, 0.05), M(x, 2.45, z), 1);
      blinkRedGeo.push([new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(x, 2.54, z)]);
    }

  // ------------------------------------------------------------------ per-side structures
  const ingotMats: THREE.Matrix4[] = [];
  const hotIngotMats: THREE.Matrix4[] = [];
  const crateTints = [new THREE.Color(0.62, 0.3, 0.2), new THREE.Color(0.36, 0.42, 0.34), new THREE.Color(0.34, 0.4, 0.48), new THREE.Color(0.55, 0.52, 0.48)];
  const crate = (sm: THREE.Matrix4, x: number, y: number, z: number, w: number, h: number, d: number, tint: number) => {
    B.add(mat.crate, RB(w, h, d, 0.06, 2), sm.clone().multiply(M(x, y + h / 2, z)), undefined, crateTints[tint % crateTints.length]);
  };

  const buildSide = (flip: boolean) => {
    const sm = flip ? M(0, 0, 0, 0, Math.PI, 0) : new THREE.Matrix4();
    const T = (m: THREE.Matrix4) => sm.clone().multiply(m);
    const P = (x: number, y: number, z: number) => V(x, y, z).applyMatrix4(sm);
    // ---- catwalk x[-18,-12], z[-7,7], y[0,3]
    sideBox(flip, -HALF, 0, -7, -12, UP, 7);
    B.add(mat.steel, BX(5.85, UP - 0.3, 13.9), T(M(-15.05, (UP - 0.3) / 2, 0)), 1 / 3);
    B.add(mat.grating, RB(6, 0.3, 14, 0.04), T(M(-15, UP - 0.15, 0)), 1);
    // fascia hazard stripes
    B.add(mat.hazard, new THREE.PlaneGeometry(14, 0.3), T(M(-11.995, UP - 0.15, 0, 0, Math.PI / 2, 0)), 1 / 0.9);
    B.add(mat.hazard, new THREE.PlaneGeometry(6, 0.3), T(M(-15, UP - 0.15, -7.005, 0, Math.PI, 0)), 1 / 0.9);
    B.add(mat.hazard, new THREE.PlaneGeometry(1, 0.3), T(M(-12.5, UP - 0.15, 7.005, 0, 0, 0)), 1 / 0.9);
    // amber edge light under the lip
    B.add(mat.glowAmber, BX(0.05, 0.05, 13.6), T(M(-12.04, UP - 0.36, 0)));
    B.add(mat.glowAmber, BX(5.6, 0.05, 0.05), T(M(-15.1, UP - 0.36, -7.04)));
    // under-deck beam
    B.add(mat.steelMid, BX(0.25, 0.25, 13.9), T(M(-12.18, UP - 0.45, 0)), 1);
    B.add(mat.steelMid, BX(5.8, 0.25, 0.25), T(M(-15.1, UP - 0.45, -6.85)), 1);
    // base sill
    B.add(mat.steelMid, BX(0.22, 0.22, 13.9), T(M(-12.13, 0.11, 0)), 1);
    B.add(mat.steelMid, BX(5.8, 0.22, 0.22), T(M(-15.1, 0.11, -6.88)), 1);
    // columns + grilles + bracing on the inner face
    const cz = [-6.8, -3.4, 0, 3.4, 6.8];
    for (const z of cz) {
      B.add(mat.steelMid, BX(0.24, UP - 0.3, 0.36), T(M(-12.13, (UP - 0.3) / 2, z)), 1);
      B.add(mat.steelMid, BX(0.08, UP - 0.3, 0.5), T(M(-12.04, (UP - 0.3) / 2, z)), 1);
    }
    for (let i = 0; i < cz.length - 1; i++) {
      const z0 = cz[i] + 0.25;
      const z1 = cz[i + 1] - 0.25;
      const w = z1 - z0;
      const hh = UP - 0.8;
      B.add(mat.grille, new THREE.PlaneGeometry(w, hh), T(M(-12.12, 0.22 + hh / 2, (z0 + z1) / 2, 0, Math.PI / 2, 0)), 1);
      const L = Math.hypot(w, hh);
      const a = Math.atan2(hh, w);
      for (const s of [1, -1]) B.add(mat.steelMid, BX(0.04, 0.1, L), T(M(-12.06, 0.22 + hh / 2, (z0 + z1) / 2, s * a, 0, 0)), 1);
    }
    // end face (z = -7)
    for (const x of [-17.75, -14.9]) B.add(mat.steelMid, BX(0.36, UP - 0.3, 0.24), T(M(x, (UP - 0.3) / 2, -6.88)), 1);
    for (const [x0, x1] of [
      [-17.5, -15.15],
      [-14.65, -12.3],
    ]) {
      const w = x1 - x0;
      const hh = UP - 0.8;
      B.add(mat.grille, new THREE.PlaneGeometry(w, hh), T(M((x0 + x1) / 2, 0.22 + hh / 2, -6.95, 0, Math.PI, 0)), 1);
    }
    // catwalk railing (outer edge) and lamp posts
    railing(P(-17.75, UP, -6.95), P(-17.75, UP, 6.95));
    for (const z of [-5, 5]) {
      const base = P(-18.45, UP - 0.6, z);
      const top = P(-18.45, UP + 4.6, z);
      B.add(mat.iron, rod(base, top, 0.09, 10), undefined, 1);
      B.add(mat.iron, RB(0.6, 0.3, 0.3, 0.04), T(M(-18.2, UP - 0.25, z)), 1);
      const arm = P(-17.6, UP + 4.5, z);
      B.add(mat.iron, rod(top.clone().setY(top.y - 0.1), arm, 0.06, 8), undefined, 1);
      B.add(mat.iron, RB(0.7, 0.18, 0.45, 0.05), T(M(-17.45, UP + 4.42, z)), 1);
      B.add(mat.glowSodium, BX(0.55, 0.03, 0.32), T(M(-17.45, UP + 4.32, z)));
    }
    // ---- ramp x[-18,-13], z[7,13], rises toward -z
    const rx0 = -18;
    const rx1 = -13;
    colliders.push(
      flip
        ? ({ kind: 'ramp', min: V(-rx1, 0, -13), max: V(-rx0, UP, -7), axis: 'z', dir: 1 } as RampCollider)
        : ({ kind: 'ramp', min: V(rx0, 0, 7), max: V(rx1, UP, 13), axis: 'z', dir: -1 } as RampCollider),
    );
    const out = (x: number, y: number, z: number) => V(x, y, z).transformDirection(sm);
    B.add(mat.tread, poly([P(rx0, 0, 13), P(rx1, 0, 13), P(rx1, UP, 7), P(rx0, UP, 7)], out(0, 1, 0.5)), undefined, 1 / 0.6);
    B.add(mat.steel, poly([P(rx1, 0, 13), P(rx1, UP, 7), P(rx1, 0, 7)], out(1, 0, 0)), undefined, 1 / 3);
    B.add(mat.hazard, poly([P(rx1 + 0.002, 0, 13), P(rx1 + 0.002, 0.35, 13), P(rx1 + 0.002, UP, 7.0), P(rx1 + 0.002, UP - 0.35, 7.0)], out(1, 0, 0)), undefined, 1 / 0.9);
    const slope = Math.atan2(UP, 6);
    const sl = Math.hypot(UP, 6);
    for (const x of [rx1 + 0.07]) B.add(mat.yellow, BX(0.14, 0.1, sl), T(M(x, UP / 2 + 0.03, 10, slope, 0, 0)), 1);
    for (const f of [0.22, 0.5, 0.78]) {
      const z = 7 + 6 * f;
      const y = UP * (1 - f);
      B.add(mat.glowAmber, BX(4.4, 0.02, 0.08), T(M(-15.6, y + 0.012, z, slope, 0, 0)));
    }
    // ramp railing along the wall
    railing(P(-17.75, UP, 6.95), P(-17.75, 0, 13), 1.1, 2.2);

    // ---- cover
    // A: crate stack at (-6, 4.5)
    sideBox(flip, -7.3, 0, 3.2, -4.7, 2.0, 5.8);
    crate(sm, -6, 0, 4.5, 2.6, 1.0, 2.6, flip ? 0 : 1);
    crate(sm, -6, 1.0, 4.5, 2.5, 1.0, 2.5, flip ? 2 : 0);
    // B: ingot pallet at (6.5, 5.5), 3.8 x 1.5 x 1.8
    sideBox(flip, 4.6, 0, 4.6, 8.4, 1.5, 6.4);
    B.add(mat.iron, RB(3.8, 0.2, 1.8, 0.04), T(M(6.5, 0.1, 5.5)), 1);
    for (const x of [5.2, 6.5, 7.8]) B.add(mat.steelMid, BX(0.2, 0.2, 1.78), T(M(x, 0.1, 5.5)), 1);
    const layers = 6;
    const lh = 1.3 / layers;
    for (let l = 0; l < layers; l++) {
      const y = 0.2 + lh * (l + 0.5);
      const top = l === layers - 1;
      const pick = (i: number, j: number) => (top && (i + j + (flip ? 1 : 0)) % 3 === 0 ? hotIngotMats : ingotMats);
      if (l % 2 === 0) {
        for (let i = 0; i < 4; i++)
          for (let j = 0; j < 4; j++) pick(i, j).push(T(M(6.5 - 1.35 + i * 0.9, y, 5.5 - 0.675 + j * 0.45, 0, Math.PI / 2, 0, 1, lh / 0.2, 1)));
      } else {
        for (let i = 0; i < 8; i++)
          for (let j = 0; j < 2; j++) pick(i, j).push(T(M(6.5 - 1.575 + i * 0.45, y, 5.5 - 0.45 + j * 0.9, 0, 0, 0, 1, lh / 0.2, 1)));
      }
    }
    for (const x of [5.4, 7.6]) B.add(mat.iron, BX(0.07, 1.32, 1.84), T(M(x, 0.86, 5.5)), 1);
    // C: corner tower at (-14.5, -13)
    sideBox(flip, -16, 0, -14.5, -13, 2.6, -11.5);
    crate(sm, -14.5, 0, -13, 3, 1.3, 3, flip ? 1 : 3);
    crate(sm, -14.5, 1.3, -13, 2.9, 1.3, 2.9, flip ? 3 : 0);
    // step crate beside the catwalk
    sideBox(flip, -11.9, 0, -6.5, -10.1, 1.5, -4.5);
    crate(sm, -11, 0, -5.5, 1.8, 1.5, 2.0, flip ? 2 : 1);
    // bollards
    for (const bx of [-9.5, 9.5]) {
      sideBox(flip, bx - 0.4, 0, 9.1, bx + 0.4, 1.1, 9.9);
      B.add(mat.iron, RB(0.7, 1.0, 0.7, 0.08), T(M(bx, 0.5, 9.5)), 1);
      B.add(mat.hazard, BX(0.72, 0.2, 0.72), T(M(bx, 0.7, 9.5)), 1 / 0.9);
      B.add(mat.iron, RB(0.8, 0.12, 0.8, 0.04), T(M(bx, 1.04, 9.5)), 1);
      B.add(mat.steelMid, RB(0.9, 0.06, 0.9, 0.02), T(M(bx, 0.03, 9.5)), 1);
    }
  };
  buildSide(false);
  buildSide(true);

  // Ingots (instanced): trapezoid bars.
  const ingotShape = new THREE.Shape();
  ingotShape.moveTo(-0.2, -0.1);
  ingotShape.lineTo(0.2, -0.1);
  ingotShape.lineTo(0.16, 0.1);
  ingotShape.lineTo(-0.16, 0.1);
  ingotShape.closePath();
  const ingotGeo = new THREE.ExtrudeGeometry(ingotShape, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 1 });
  ingotGeo.translate(0, 0, -0.4);
  ownedGeos.push(ingotGeo);
  const instanced = (geo: THREE.BufferGeometry, m: THREE.Material, list: THREE.Matrix4[], cast = true, parent: THREE.Object3D = root) => {
    const im = new THREE.InstancedMesh(geo, m, list.length);
    list.forEach((x, i) => im.setMatrixAt(i, x));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = cast;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    parent.add(im);
    return im;
  };
  instanced(ingotGeo, mat.ingot, ingotMats);
  instanced(ingotGeo, mat.ingotHot, hotIngotMats);

  // ------------------------------------------------------------------ gantry (static)
  for (const z of [-RAIL_Z, RAIL_Z]) {
    const L = 54;
    B.add(mat.yellow, RB(L, 0.08, 0.5, 0.02), M(0, RAIL_Y + 0.3, z), 1);
    B.add(mat.yellow, BX(L, 0.5, 0.08), M(0, RAIL_Y, z), 1);
    B.add(mat.yellow, RB(L, 0.08, 0.5, 0.02), M(0, RAIL_Y - 0.3, z), 1);
    B.add(mat.steelMid, BX(L, 0.06, 0.12), M(0, RAIL_Y + 0.37, z), 1);
    // stiffeners
    for (let x = -26; x <= 26; x += 2) B.add(mat.yellow, BX(0.04, 0.5, 0.42), M(x, RAIL_Y, z), 1);
  }
  for (const sx of [-1, 1]) {
    const x = sx * 25;
    for (const z of [-RAIL_Z, RAIL_Z]) {
      const legH = RAIL_Y - 0.34 + 0.6;
      B.add(mat.yellow, RB(0.8, legH, 0.8, 0.06), M(x, legH / 2 - 0.6, z), 1 / 2);
      B.add(mat.hazard, BX(0.82, 1.2, 0.82), M(x, 0.2, z), 1 / 0.9);
      B.add(mat.iron, RB(1.4, 0.3, 1.4, 0.05), M(x, -0.45, z), 1);
    }
    B.add(mat.yellow, RB(1.0, 0.7, RAIL_Z * 2 + 1, 0.06), M(x, RAIL_Y - 0.7, 0), 1);
    for (const y0 of [1.5, 7.2]) {
      B.add(mat.yellow, rod(V(x, y0, -RAIL_Z), V(x, y0 + 5.2, RAIL_Z), 0.12, 8));
      B.add(mat.yellow, rod(V(x, y0, RAIL_Z), V(x, y0 + 5.2, -RAIL_Z), 0.12, 8));
    }
    // end stops
    for (const z of [-RAIL_Z, RAIL_Z]) B.add(mat.hazard, BX(0.4, 0.7, 0.6), M(sx * 22, RAIL_Y + 0.05, z), 1 / 0.9);
    blinkRedGeo.push([new THREE.SphereGeometry(0.22, 12, 8), M(x, RAIL_Y + 1.3, 0)]);
    // crane-zone sign on the leg
    B.add(mat.warn2, new THREE.PlaneGeometry(1.6, 0.8), M(x - sx * 0.41, 4.2, RAIL_Z, 0, -sx * Math.PI / 2, 0));
    B.add(mat.warn2, new THREE.PlaneGeometry(1.6, 0.8), M(x - sx * 0.41, 4.2, -RAIL_Z, 0, -sx * Math.PI / 2, 0));
  }
  // underslung lamps along the rails
  for (const x of [-15, -5, 5, 15])
    for (const z of [-RAIL_Z, RAIL_Z]) {
      B.add(mat.iron, RB(0.9, 0.2, 0.5, 0.05), M(x, RAIL_Y - 0.45, z), 1);
      B.add(mat.lamp, BX(0.75, 0.03, 0.36), M(x, RAIL_Y - 0.56, z));
    }

  // ------------------------------------------------------------------ crane (moving)
  const crane = new THREE.Group();
  crane.name = 'crane';
  root.add(crane);
  const CB = new Batch();
  for (const m of [mat.clerestory, mat.glowAmber, mat.lamp]) CB.cfg(m, false, false);
  {
    const top = UP;
    CB.add(mat.yellow, RB(CRANE_HX * 2, 0.5, CRANE_HZ * 2, 0.07), M(0, top - 0.25, 0), 1);
    const tg = new THREE.PlaneGeometry(CRANE_HX * 2 - 0.3, CRANE_HZ * 2 - 0.3);
    tg.rotateX(-Math.PI / 2);
    tg.translate(0, top + 0.003, 0);
    CB.add(mat.tread, tg, undefined, 1 / 0.6);
    // hazard bands on all four sides
    for (const [x, z, w, ry] of [
      [0, CRANE_HZ + 0.003, CRANE_HX * 2 - 0.15, 0],
      [0, -CRANE_HZ - 0.003, CRANE_HX * 2 - 0.15, Math.PI],
      [CRANE_HX + 0.003, 0, CRANE_HZ * 2 - 0.15, Math.PI / 2],
      [-CRANE_HX - 0.003, 0, CRANE_HZ * 2 - 0.15, -Math.PI / 2],
    ])
      CB.add(mat.hazard, new THREE.PlaneGeometry(w, 0.28), M(x, top - 0.25, z, 0, ry, 0), 1 / 0.9);
    // edge glow strips
    for (const z of [-1, 1]) CB.add(mat.glowAmber, BX(CRANE_HX * 2 - 0.4, 0.04, 0.04), M(0, top - 0.47, z * (CRANE_HZ - 0.02)));
    for (const x of [-1, 1]) CB.add(mat.glowAmber, BX(0.04, 0.04, CRANE_HZ * 2 - 0.4), M(x * (CRANE_HX - 0.02), top - 0.47, 0));
    // skids
    for (const x of [-1.3, 1.3]) CB.add(mat.iron, RB(0.32, 0.25, CRANE_HZ * 2, 0.04), M(x, CRANE_BOTTOM + 0.125, 0), 1);
    // corner lugs
    for (const x of [-1, 1]) for (const z of [-1, 1]) CB.add(mat.iron, RB(0.26, 0.16, 0.26, 0.04), M(x * (CRANE_HX - 0.18), top + 0.08, z * (CRANE_HZ - 0.18)), 1);
    // spreader frame
    const sy = 9.6;
    for (const x of [-1, 1]) CB.add(mat.yellow, RB(0.32, 0.36, CRANE_HZ * 2 + 0.2, 0.04), M(x * (CRANE_HX - 0.18), sy, 0), 1);
    for (const z of [-1, 1]) CB.add(mat.yellow, RB(CRANE_HX * 2 - 0.3, 0.36, 0.32, 0.04), M(0, sy, z * (CRANE_HZ - 0.18)), 1);
    // slings to hook block
    const hookY = 10.9;
    for (const x of [-1, 1]) for (const z of [-1, 1]) CB.add(mat.iron, rod(V(x * (CRANE_HX - 0.18), sy + 0.15, z * (CRANE_HZ - 0.18)), V(x * 0.2, hookY, z * 0.15), 0.04, 6));
    CB.add(mat.yellow, RB(0.7, 0.8, 0.5, 0.08), M(0, hookY + 0.3, 0), 1);
    CB.add(mat.iron, CY(0.28, 0.28, 0.56, 16).rotateZ(Math.PI / 2), M(0, hookY + 0.45, 0), 1);
    // cables up to the trolley
    for (const x of [-0.18, 0.18]) CB.add(mat.chain, rod(V(x, hookY + 0.7, 0), V(x * 1.6, RAIL_Y + 0.6, 0), 0.03, 6));
    // trolley
    CB.add(mat.yellow, RB(2.4, 0.8, RAIL_Z * 2 + 1.0, 0.08), M(0, RAIL_Y + 0.95, 0), 1);
    CB.add(mat.iron, CY(0.4, 0.4, RAIL_Z * 2 - 0.6, 20).rotateX(Math.PI / 2), M(0, RAIL_Y + 1.6, 0), 1);
    for (const x of [-0.85, 0.85]) for (const z of [-RAIL_Z, RAIL_Z]) CB.add(mat.iron, CY(0.24, 0.24, 0.16, 16).rotateX(Math.PI / 2), M(x, RAIL_Y + 0.56, z), 1);
    CB.add(mat.hazard, BX(2.42, 0.3, 0.02), M(0, RAIL_Y + 0.95, RAIL_Z + 0.51), 1 / 0.9);
    CB.add(mat.hazard, BX(2.42, 0.3, 0.02), M(0, RAIL_Y + 0.95, -RAIL_Z - 0.51), 1 / 0.9);
    CB.add(mat.lamp, BX(1.6, 0.03, 0.6), M(0, RAIL_Y + 0.54, 0));
  }
  CB.build(crane);
  // chains (instanced links)
  const linkGeo = new THREE.TorusGeometry(0.07, 0.022, 5, 10);
  linkGeo.scale(1, 1.55, 1);
  ownedGeos.push(linkGeo);
  const links: THREE.Matrix4[] = [];
  for (const x of [-1, 1])
    for (const z of [-1, 1]) {
      const cx = x * (CRANE_HX - 0.18);
      const cz = z * (CRANE_HZ - 0.18);
      let i = 0;
      for (let y = UP + 0.3; y < 9.45; y += 0.17, i++) links.push(M(cx, y, cz, 0, i % 2 ? Math.PI / 2 : 0, 0));
    }
  instanced(linkGeo, mat.chain, links, true, crane);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat.blinkAmber);
  beacon.position.set(0.8, RAIL_Y + 1.35, 0);
  ownedGeos.push(beacon.geometry);
  crane.add(beacon);

  const craneCol = box(V(-CRANE_HX, CRANE_BOTTOM, -CRANE_HZ), V(CRANE_HX, UP, CRANE_HZ));
  craneCol.vel = V();
  const setCrane = (t: number) => {
    const [x, vx] = craneAt(t);
    craneCol.min.set(x - CRANE_HX, CRANE_BOTTOM, -CRANE_HZ);
    craneCol.max.set(x + CRANE_HX, UP, CRANE_HZ);
    craneCol.vel!.set(vx, 0, 0);
    crane.position.x = x;
  };
  setCrane(0);

  const G = new Batch();
  G.noCast = true;
  // ------------------------------------------------------------------ background: north (crucibles, launder, furnaces)
  const blinkAmberGeo: [THREE.BufferGeometry, THREE.Matrix4][] = [];
  // Molten launder channel just outside the north rail.
  const LZ = -23.4;
  G.add(mat.brick, BX(56, 1.6, 2.6), M(0, 0.2, LZ), 1 / 4);
  for (const dz of [-1.15, 1.15]) G.add(mat.iron, RB(56, 0.2, 0.3, 0.04), M(0, 1.08, LZ + dz), 1);
  {
    const lg = new THREE.PlaneGeometry(56, 2.0);
    lg.rotateX(-Math.PI / 2);
    lg.translate(0, 1.02, LZ);
    const uv = lg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 10, uv.getY(i) * 0.6);
    G.add(mat.lava, lg);
  }
  for (let x = -26; x <= 26; x += 4) G.add(mat.iron, RB(0.3, 1.45, 2.9, 0.04), M(x, 0.125, LZ), 1);

  // Crucibles (lathe) on trunnion stands.
  const crucProfile = [
    [0, -1.6],
    [1.5, -1.6],
    [1.9, -1.45],
    [2.1, -1.0],
    [2.25, 0.4],
    [2.3, 1.3],
    [2.5, 1.38],
    [2.55, 1.6],
    [2.2, 1.62],
    [2.0, 1.4],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const crucGeo = new THREE.LatheGeometry(crucProfile, 40);
  const pours: { lip: THREE.Vector3; land: THREE.Vector3 }[] = [];
  const crucible = (px: number, py: number, pz: number, theta: number, sc: number, landY: number, dir: number) => {
    const cm = M(px, py, pz, 0, 0, -dir * theta, sc, sc, sc);
    G.add(mat.shell, crucGeo.clone(), cm, 1 / 2);
    for (const y of [-0.8, 0.5]) G.add(mat.iron, new THREE.TorusGeometry(2.22 + (y > 0 ? 0.06 : -0.02), 0.11, 6, 40).rotateX(Math.PI / 2).translate(0, y, 0), cm);
    // molten surface inside the lip
    G.add(mat.lavaPool, new THREE.CircleGeometry(2.2, 32).rotateX(-Math.PI / 2).translate(0, 0.9, 0), cm);
    // spout lip
    G.add(mat.iron, RB(0.9, 0.3, 1.2, 0.08).translate(2.45, 1.5, 0), cm, 1);
    // cantilevered trunnion from a single back pillar
    const half = 2.3 * sc + 0.9;
    const bz = pz - half;
    G.add(mat.iron, CY(0.38 * sc, 0.38 * sc, half, 16).rotateX(Math.PI / 2), M(px, py, pz - half / 2), 1);
    G.add(mat.iron, CY(1.6 * sc, 1.6 * sc, 0.3, 28).rotateX(Math.PI / 2), M(px, py, pz - 2.3 * sc - 0.35), 1);
    G.add(mat.yellow, CY(0.5 * sc, 0.5 * sc, 0.34, 16).rotateX(Math.PI / 2), M(px, py, pz - 2.3 * sc - 0.35), 1);
    G.add(mat.steel, RB(2.0, py + 1.8, 1.4, 0.1), M(px, (py + 1.8) / 2 - 0.6, bz), 1 / 2);
    G.add(mat.yellow, RB(2.3, 0.5, 1.7, 0.06), M(px, py + 1.0, bz), 1);
    G.add(mat.hazard, BX(2.02, 1.0, 1.42), M(px, 0.2, bz), 1 / 0.9);
    for (const s of [-1, 1]) G.add(mat.steelMid, rod(V(px + s * 0.9, -0.6, bz - 3), V(px + s * 0.8, py - 2, bz - 0.5), 0.14, 8));
    const lip = V(2.75, 1.6, 0).applyMatrix4(cm);
    const land = V(lip.x + dir * (lip.y - landY) * 0.42, landY, pz);
    pours.push({ lip, land });
  };
  crucible(-11, 9.2, LZ, 1.15, 1.0, 1.02, 1);
  crucible(17, 11.4, -27, 1.05, 1.3, 3.0, -1);
  // ladle catching crucible B's pour
  {
    const lp = pours[1].land;
    const ladle = new THREE.LatheGeometry(
      [
        [0, -1.9],
        [1.4, -1.9],
        [1.8, -1.5],
        [2.0, 1.6],
        [2.2, 1.75],
        [2.2, 1.95],
        [1.9, 1.9],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      36,
    );
    const ly = lp.y - 1.75;
    G.add(mat.ironDS, ladle, M(lp.x, ly, lp.z), 1 / 2);
    G.add(mat.lavaPool, new THREE.CircleGeometry(1.92, 32).rotateX(-Math.PI / 2), M(lp.x, ly + 1.7, lp.z));
    for (const s of [-1, 1]) G.add(mat.iron, CY(0.3, 0.3, 0.6, 12).rotateZ(Math.PI / 2), M(lp.x + s * 2.3, ly + 1.0, lp.z), 1);
    G.add(mat.yellow, RB(5.4, 0.5, 2.6, 0.06), M(lp.x, -0.45, lp.z), 1);
  }
  // Pour streams (tubes) — animated texture.
  const pourMeshes: THREE.Mesh[] = [];
  for (const p of pours) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const s = i / 12;
      pts.push(V(p.lip.x + (p.land.x - p.lip.x) * s, p.lip.y + (p.land.y - p.lip.y) * s * s, p.lip.z + (p.land.z - p.lip.z) * s));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tg = new THREE.TubeGeometry(curve, 32, 0.22, 10, false);
    // taper: thinner at the bottom
    const pos = tg.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ring = Math.floor(i / 11);
      const s = ring / 32;
      const c = curve.getPointAt(Math.min(1, s));
      const k = 1 - s * 0.45;
      pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * k, c.y + (pos.getY(i) - c.y) * k, c.z + (pos.getZ(i) - c.z) * k);
    }
    const m = new THREE.Mesh(tg, mat.pour);
    ownedGeos.push(tg);
    root.add(m);
    pourMeshes.push(m);
    // impact glow
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSprite(128, 0.15), color: hdr(0xff7a20, 2.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    ownedMats.push(gl.material);
    gl.position.copy(p.land).setY(p.land.y + 0.4);
    gl.scale.setScalar(5.5);
    root.add(gl);
  }

  // Furnace bank + back wall (north).
  const furnaceBank = (zFront: number, dirZ: number, mouths: number[]) => {
    const depth = 6;
    const zc = zFront + (dirZ * -depth) / 2;
    G.add(mat.brick, BX(76, 10, depth), M(0, 4.4, zc), 1 / 4);
    G.add(mat.iron, RB(76.4, 0.6, depth + 0.4, 0.06), M(0, 9.6, zc), 1);
    for (const x of mouths) {
      // arched mouth (glow plane) + cast iron frame
      const sh = new THREE.Shape();
      sh.moveTo(-2.2, 0);
      sh.lineTo(2.2, 0);
      sh.lineTo(2.2, 3.2);
      sh.absarc(0, 3.2, 2.2, 0, Math.PI, false);
      sh.lineTo(-2.2, 0);
      const glow = new THREE.ShapeGeometry(sh, 16);
      // remap UVs to 0..1 for the gradient
      const uv = glow.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + 2.2) / 4.4, uv.getY(i) / 5.4);
      G.add(mat.furnace, glow, M(x, -0.6, zFront + dirZ * 0.02, 0, dirZ > 0 ? 0 : Math.PI, 0));
      const frame = new THREE.Shape();
      frame.moveTo(-3.0, 0);
      frame.lineTo(3.0, 0);
      frame.lineTo(3.0, 3.2);
      frame.absarc(0, 3.2, 3.0, 0, Math.PI, false);
      frame.lineTo(-3.0, 0);
      const hole = new THREE.Path();
      hole.moveTo(-2.2, 0);
      hole.lineTo(-2.2, 3.2);
      hole.absarc(0, 3.2, 2.2, Math.PI, 0, true);
      hole.lineTo(2.2, 0);
      hole.lineTo(-2.2, 0);
      frame.holes.push(hole);
      const fg = new THREE.ExtrudeGeometry(frame, { depth: 0.5, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2, curveSegments: 16 });
      G.add(mat.iron, fg, M(x, -0.6, zFront + (dirZ > 0 ? 0 : 0), 0, dirZ > 0 ? 0 : Math.PI, 0), 1 / 2);
      // hood above the mouth
      G.add(mat.iron, RB(7.2, 0.8, 1.6, 0.1), M(x, 7.4, zFront + dirZ * 0.6), 1 / 2);
      blinkAmberGeo.push([new THREE.SphereGeometry(0.16, 10, 6), M(x + 3.2, 7.4, zFront + dirZ * 1.4)]);
    }
    // the wall above
    G.add(mat.wall, BX(80, 28, 0.6), M(0, 13.4, zFront - dirZ * (depth + 0.3)), 1 / 4);
    // pipes
    for (const [y, r] of [
      [12.5, 0.55],
      [14.2, 0.35],
      [25.5, 0.7],
    ]) {
      const z = zFront - dirZ * (depth - r - 0.2);
      G.add(mat.iron, CY(r, r, 80, 14).rotateZ(Math.PI / 2), M(0, y, z), 1 / 2);
      for (let x = -36; x <= 36; x += 6) G.add(mat.steelMid, CY(r + 0.08, r + 0.08, 0.3, 14).rotateZ(Math.PI / 2), M(x, y, z), 1);
    }
    for (const x of [-30, -14, 14, 30]) G.add(mat.iron, CY(0.4, 0.4, 12, 12), M(x, 15.6, zFront - dirZ * (depth - 1.0)), 1 / 2);
  };
  furnaceBank(-38, 1, [-22, 0, 22]);
  // clerestory windows + pilasters on all four walls
  for (const [x, z, ry, len] of [
    [0, -43.95, 0, 70],
    [0, 43.95, Math.PI, 70],
    [-37.95, 0, Math.PI / 2, 78],
    [37.95, 0, -Math.PI / 2, 78],
  ] as [number, number, number, number][]) {
    const wg = new THREE.PlaneGeometry(len, 3.4);
    const uv = wg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 16));
    G.add(mat.clerestory, wg, M(x, 24.5, z, 0, ry, 0));
    for (let o = -len / 2 + 2; o <= len / 2 - 2; o += 12) {
      if (Math.abs(z) > 40 && Math.abs(o) < 12) continue;
      const m = M(x, 0, z, 0, ry, 0).multiply(M(o, 13.4, 0.3));
      G.add(mat.steelMid, BX(0.9, 28, 0.6), m, 1 / 2);
    }
  }
  furnaceBank(38, -1, [-18, 0, 18]);
  // glowing sign above the north furnaces
  G.add(mat.sign, new THREE.PlaneGeometry(22, 5.5), M(0, 19.5, -44 + 0.32 + 0.02));
  G.add(mat.sign, new THREE.PlaneGeometry(16, 4), M(0, 19.0, 44 - 0.32 - 0.02, 0, Math.PI, 0));

  // Side walls with fans.
  const fans: THREE.Mesh[] = [];
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0.2, -0.12);
  bladeShape.quadraticCurveTo(1.4, -0.55, 2.2, -0.2);
  bladeShape.quadraticCurveTo(2.3, 0.25, 1.8, 0.38);
  bladeShape.quadraticCurveTo(1.0, 0.4, 0.2, 0.12);
  bladeShape.closePath();
  const bladeParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.04, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1, curveSegments: 6 });
    g.rotateX(0.35);
    g.rotateZ((i * Math.PI) / 3);
    bladeParts.push(g.index ? g.toNonIndexed() : g);
  }
  const hub = CY(0.35, 0.35, 0.3, 16).rotateX(Math.PI / 2);
  bladeParts.push(hub.toNonIndexed());
  for (const g of bladeParts) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  const bladeGeo = mergeGeometries(bladeParts)!;
  ownedGeos.push(bladeGeo);
  const fanGlow = basic({ color: hdr(0xff6a20, 1.8) });
  G.cfg(fanGlow, false, false);
  for (const sx of [-1, 1]) {
    const x = sx * 38.3;
    G.add(mat.wall, BX(0.6, 28, 88), M(x, 13.4, 0), 1 / 4);
    for (const [y, r] of [
      [5.5, 0.6],
      [6.8, 0.4],
    ])
      G.add(mat.iron, CY(r, r, 80, 14).rotateX(Math.PI / 2), M(x - sx * 1.2, y, 0), 1 / 2);
    for (const z of [-12, 14]) {
      const y = 11;
      const fx = x - sx * 0.35;
      G.add(mat.iron, new THREE.TorusGeometry(2.6, 0.28, 10, 40).rotateY(Math.PI / 2), M(fx, y, z), 1 / 2);
      G.add(fanGlow, new THREE.CircleGeometry(2.5, 32).rotateY(-sx * Math.PI / 2), M(x - sx * 0.31, y, z));
      for (let i = 0; i < 4; i++) G.add(mat.iron, BX(0.06, 0.08, 5.0), M(fx - sx * 0.25, y, z, (i * Math.PI) / 4, 0, 0), 1);
      const fan = new THREE.Mesh(bladeGeo, mat.iron);
      fan.position.set(fx - sx * 0.05, y, z);
      fan.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
      root.add(fan);
      fans.push(fan);
    }
    // wall-mounted catwalk with lights
    G.add(mat.grating, BX(1.6, 0.15, 80), M(x - sx * 1.1, 9.0, 0), 1);
    for (let z = -36; z <= 36; z += 9) {
      G.add(mat.iron, RB(0.5, 0.25, 0.4, 0.05), M(x - sx * 0.5, 16, z), 1);
      G.add(mat.glowSodium, BX(0.04, 0.12, 0.3), M(x - sx * 0.76, 15.9, z));
    }
  }

  // Chimneys & distant silhouettes.
  const chimney = (x: number, z: number, h: number, r: number) => {
    const prof = [
      [r * 1.3, 0],
      [r * 1.15, 1.5],
      [r, 3],
      [r * 0.8, h],
      [r * 0.92, h + 0.4],
      [r * 0.92, h + 1.4],
      [r * 0.78, h + 1.5],
    ].map(([a, b]) => new THREE.Vector2(a, b));
    G.add(mat.silhouette, new THREE.LatheGeometry(prof, 20), M(x, -0.6, z));
    for (let y = 6; y < h; y += 7) G.add(mat.iron, new THREE.TorusGeometry(r * (1 - (0.2 * y) / h) + 0.05, 0.12, 6, 20).rotateX(Math.PI / 2), M(x, y, z));
    blinkRedGeo.push([new THREE.SphereGeometry(0.4, 10, 6), M(x + r * 0.9, h + 0.9, z)]);
    blinkRedGeo.push([new THREE.SphereGeometry(0.4, 10, 6), M(x - r * 0.9, h + 0.9, z)]);
    return V(x, h + 1.5, z);
  };
  const chimneyTops = [chimney(-26, -54, 44, 2.6), chimney(4, -62, 54, 3.2), chimney(30, -52, 40, 2.4), chimney(-22, 56, 46, 2.8), chimney(24, 60, 50, 3.0)];
  if (!low) {
    for (const [x, z, w, h, d] of [
      [-48, -70, 18, 34, 14],
      [44, -76, 22, 40, 16],
      [-56, 62, 20, 30, 16],
      [52, 70, 18, 36, 18],
      [0, -88, 30, 26, 10],
      [-70, 0, 14, 32, 30],
      [70, -10, 14, 28, 30],
    ]) {
      G.add(mat.silhouette, BX(w, h, d), M(x, h / 2 - 0.6, z));
      const face = new THREE.PlaneGeometry(w * 0.8, h * 0.75);
      // face toward arena centre
      const ang = Math.atan2(-x, -z);
      const fd = V(Math.sin(ang), 0, Math.cos(ang));
      const ext = Math.abs(fd.x) > Math.abs(fd.z) ? w / 2 : d / 2;
      const snap = Math.abs(fd.x) > Math.abs(fd.z) ? V(Math.sign(fd.x), 0, 0) : V(0, 0, Math.sign(fd.z));
      const fx = x + snap.x * (ext + 0.05);
      const fz = z + snap.z * (ext + 0.05);
      G.add(mat.windows, face, M(fx, h * 0.5, fz, 0, Math.atan2(snap.x, snap.z), 0));
    }
  }

  // Southern casting line: conveyor of ingot moulds, cooling as they travel.
  const CZ = 21.4;
  G.add(mat.iron, BX(76, 0.7, 2.2), M(0, -0.25, CZ), 1 / 2);
  G.add(mat.yellow, BX(76, 0.12, 0.12), M(0, 0.16, CZ - 1.15), 1);
  G.add(mat.yellow, BX(76, 0.12, 0.12), M(0, 0.16, CZ + 1.15), 1);
  for (let x = -36; x <= 36; x += 1.2) G.add(mat.steelMid, CY(0.1, 0.1, 2.0, 8).rotateX(Math.PI / 2), M(x, 0.12, CZ), 1);
  const moldCount = low ? 18 : 26;
  const moldSpacing = 76 / moldCount;
  const moldGeo = RB(1.5, 0.45, 1.6, 0.06);
  const moldTopGeo = new THREE.PlaneGeometry(1.2, 1.3).rotateX(-Math.PI / 2);
  ownedGeos.push(moldGeo, moldTopGeo);
  const moldMat = mat.iron;
  const moldTopMat = basic({ color: 0xffffff, map: lavaFlow });
  const molds = new THREE.InstancedMesh(moldGeo, moldMat, moldCount);
  const moldTops = new THREE.InstancedMesh(moldTopGeo, moldTopMat, moldCount);
  molds.castShadow = false;
  molds.receiveShadow = true;
  for (let i = 0; i < moldCount; i++) moldTops.setColorAt(i, new THREE.Color(1, 1, 1));
  root.add(molds, moldTops);
  // tundish pouring onto the line at x = -26
  {
    const tx = -26;
    G.add(mat.ironDS, new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.9, 0), new THREE.Vector2(1.3, 1.2), new THREE.Vector2(1.4, 1.3), new THREE.Vector2(1.2, 1.3)], 24), M(tx, 4.5, CZ), 1 / 2);
    G.add(mat.lavaPool, new THREE.CircleGeometry(1.2, 24).rotateX(-Math.PI / 2), M(tx, 5.7, CZ));
    G.add(mat.pour, CY(0.12, 0.09, 4.0, 10, true), M(tx, 2.5, CZ));
    for (const s of [-1, 1]) G.add(mat.yellow, RB(0.4, 6.4, 0.4, 0.04), M(tx + s * 1.7, 2.6, CZ + 1.4), 1);
    G.add(mat.yellow, RB(3.8, 0.4, 0.5, 0.04), M(tx, 5.8, CZ + 1.4), 1);
    pours.push({ lip: V(tx, 4.5, CZ), land: V(tx, 0.5, CZ) });
  }

  // Swaying hook hanging over the southern yard.
  const hook = new THREE.Group();
  hook.position.set(14, 24, 28);
  root.add(hook);
  {
    const HB = new Batch();
    HB.add(mat.yellow, RB(1.2, 1.2, 0.9, 0.1), M(0, -11.5, 0), 1);
    const hs = new THREE.TorusGeometry(0.55, 0.16, 8, 20, Math.PI * 1.4);
    HB.add(mat.iron, hs, M(0, -12.7, 0, 0, 0, Math.PI * 0.8), 1);
    HB.build(hook);
    const hl: THREE.Matrix4[] = [];
    for (let i = 0, y = 0; y > -11; y -= 0.17, i++) hl.push(M(0, y, 0, 0, i % 2 ? Math.PI / 2 : 0, 0));
    instanced(linkGeo, mat.chain, hl, false, hook);
  }
  G.add(mat.yellow, BX(76, 0.6, 0.12), M(0, 24.4, 28), 1);
  G.add(mat.yellow, BX(76, 0.08, 0.5), M(0, 24.7, 28), 1);

  // Blinking lights (two merged meshes).
  const blinkMesh = (list: [THREE.BufferGeometry, THREE.Matrix4][], m: THREE.Material) => {
    const geos = list.map(([g, mm]) => {
      const n = g.index ? g.toNonIndexed() : g;
      n.applyMatrix4(mm);
      for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
      return n;
    });
    const merged = mergeGeometries(geos)!;
    ownedGeos.push(merged);
    const mesh = new THREE.Mesh(merged, m);
    root.add(mesh);
  };
  blinkMesh(blinkRedGeo, mat.blinkRed);
  blinkMesh(blinkAmberGeo, mat.blinkAmber);

  B.build(root);
  G.build(root);

  // ------------------------------------------------------------------ particles
  const emberTex = glowSprite(64, 0.2);
  const emberCount = Math.round(520 * pScale);
  const ePos = new Float32Array(emberCount * 3);
  const eCol = new Float32Array(emberCount * 3);
  const eVel = new Float32Array(emberCount * 3);
  const eLife = new Float32Array(emberCount);
  const eMax = new Float32Array(emberCount);
  const sources = [
    ...pours.map((p) => ({ c: p.land, r: 1.2, w: 4 })),
    { c: V(0, 1.1, LZ), r: 26, w: 3, line: true },
    { c: V(0, 0.8, CZ), r: 30, w: 1.5, line: true },
    { c: V(0, 0.5, -37.2), r: 24, w: 0.6, line: true },
    { c: V(0, 0.5, 37.2), r: 20, w: 0.4, line: true },
  ];
  const wsum = sources.reduce((a, s) => a + s.w, 0);
  const spawnEmber = (i: number, initial: boolean) => {
    let pick = Math.random() * wsum;
    let s = sources[0];
    for (const q of sources) {
      pick -= q.w;
      if (pick <= 0) {
        s = q;
        break;
      }
    }
    const line = (s as { line?: boolean }).line;
    ePos[i * 3] = s.c.x + (Math.random() * 2 - 1) * s.r;
    ePos[i * 3 + 1] = s.c.y + Math.random() * 0.5;
    ePos[i * 3 + 2] = s.c.z + (line ? (Math.random() - 0.5) * 1.6 : (Math.random() * 2 - 1) * s.r);
    eVel[i * 3] = (Math.random() - 0.5) * 0.8;
    eVel[i * 3 + 1] = 0.7 + Math.random() * 1.8;
    eVel[i * 3 + 2] = (Math.random() - 0.5) * 0.8 + 0.25;
    eMax[i] = 1.5 + Math.random() * 3.0;
    eLife[i] = initial ? Math.random() * eMax[i] : 0;
    const hot = Math.random();
    eCol[i * 3] = 4.0 + hot * 2;
    eCol[i * 3 + 1] = 1.2 + hot * 1.6;
    eCol[i * 3 + 2] = 0.25 + hot * 0.3;
  };
  for (let i = 0; i < emberCount; i++) spawnEmber(i, true);
  const eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  const eColAttr = new THREE.BufferAttribute(new Float32Array(emberCount * 3), 3);
  eGeo.setAttribute('color', eColAttr);
  ownedGeos.push(eGeo);
  const eMat = new THREE.PointsMaterial({ map: emberTex, size: 0.16, sizeAttenuation: true, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  ownedMats.push(eMat);
  const embers = new THREE.Points(eGeo, eMat);
  embers.frustumCulled = false;
  root.add(embers);

  // Sparks at pour impacts: fast, gravity, short-lived.
  const sparkCount = Math.round(260 * pScale);
  const sPos = new Float32Array(sparkCount * 3);
  const sVel = new Float32Array(sparkCount * 3);
  const sLife = new Float32Array(sparkCount);
  const sMax = new Float32Array(sparkCount);
  const sCol = new THREE.BufferAttribute(new Float32Array(sparkCount * 3), 3);
  const spawnSpark = (i: number) => {
    const p = pours[i % pours.length].land;
    sPos[i * 3] = p.x;
    sPos[i * 3 + 1] = p.y + 0.1;
    sPos[i * 3 + 2] = p.z;
    const a = Math.random() * Math.PI * 2;
    const sp = 1.5 + Math.random() * 4;
    sVel[i * 3] = Math.cos(a) * sp;
    sVel[i * 3 + 1] = 2 + Math.random() * 5;
    sVel[i * 3 + 2] = Math.sin(a) * sp;
    sMax[i] = 0.4 + Math.random() * 0.9;
    sLife[i] = Math.random() * sMax[i];
  };
  for (let i = 0; i < sparkCount; i++) spawnSpark(i);
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute('color', sCol);
  ownedGeos.push(sGeo);
  const sMat = new THREE.PointsMaterial({ map: emberTex, size: 0.12, sizeAttenuation: true, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  ownedMats.push(sMat);
  const sparks = new THREE.Points(sGeo, sMat);
  sparks.frustumCulled = false;
  root.add(sparks);

  // Smoke / heat haze plumes.
  const smokeCount = low ? 0 : Math.round(40 * pScale);
  const kPos = new Float32Array(Math.max(1, smokeCount) * 3);
  const kLife = new Float32Array(Math.max(1, smokeCount));
  const kSrc: THREE.Vector3[] = [];
  const smokeSources = [...pours.map((p) => p.land), V(-22, 7, -37), V(0, 7, -37), V(22, 7, -37), V(0, 7, 37), ...chimneyTops];
  for (let i = 0; i < smokeCount; i++) {
    kSrc.push(smokeSources[i % smokeSources.length]);
    kLife[i] = Math.random();
  }
  const kGeo = new THREE.BufferGeometry();
  kGeo.setAttribute('position', new THREE.BufferAttribute(kPos, 3));
  ownedGeos.push(kGeo);
  const kMat = new THREE.PointsMaterial({ map: smokeSprite(128), size: 9, sizeAttenuation: true, color: 0x3a2e2a, transparent: true, opacity: 0.32, depthWrite: false });
  ownedMats.push(kMat);
  const smoke = new THREE.Points(kGeo, kMat);
  smoke.frustumCulled = false;
  if (smokeCount) root.add(smoke);

  // ------------------------------------------------------------------ lights
  const keyLight = new THREE.DirectionalLight(0xffb070, 2.6);
  keyLight.position.set(-9, 22, -24);
  keyLight.target.position.set(0, 0, 0);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  const sc = keyLight.shadow.camera;
  sc.left = -25;
  sc.right = 25;
  sc.top = 22;
  sc.bottom = -22;
  sc.near = 4;
  sc.far = 75;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.03;
  root.add(keyLight, keyLight.target);
  const fill = new THREE.DirectionalLight(0x6f9cff, 0.75);
  fill.position.set(16, 14, 22);
  root.add(fill);
  const hemi = new THREE.HemisphereLight(0x4a6a98, 0x2c1a10, 0.7);
  root.add(hemi);
  const pl1 = new THREE.PointLight(0xff7a28, 140, 40, 2);
  pl1.position.copy(pours[0].land).add(V(0, 1.5, 1.5));
  const pl2 = new THREE.PointLight(0xff6a20, 160, 40, 2);
  pl2.position.copy(pours[1].land).add(V(0, 1.5, 2));
  const pl3 = new THREE.PointLight(0xff7a30, 90, 34, 2);
  pl3.position.set(-4, 2.0, CZ);
  root.add(pl1, pl2, pl3);

  const environment = studioEnvironment(renderer, { top: 0x2a3a52, bottom: 0x24140c, key: 0xffa060, rim: 0x5a8cff, fill: 0xff6a20, intensity: 0.55 });
  const fog = new THREE.Fog(0x1d1820, 34, 120);

  // ------------------------------------------------------------------ animation
  const tmpM = new THREE.Matrix4();
  const tmpC = new THREE.Color();
  let lastTime = 0;
  const update = (time: number, dt: number) => {
    lastTime = time;
    // molten surfaces
    (mat.lava.map as THREE.Texture).offset.x = time * 0.08;
    (mat.lavaPool.map as THREE.Texture).offset.set(time * 0.02, time * 0.013);
    (mat.pour.map as THREE.Texture).offset.x = -time * 2.2;
    const fl = 1 + 0.12 * Math.sin(time * 13.1) + 0.08 * Math.sin(time * 29.7) + 0.05 * Math.sin(time * 4.3);
    mat.pour.color.copy(hdr(0xffffff, 5.5 * fl));
    pl1.intensity = 140 * (0.9 + 0.1 * Math.sin(time * 11.3) + 0.06 * Math.sin(time * 23.1));
    pl2.intensity = 160 * (0.9 + 0.1 * Math.sin(time * 9.7 + 1) + 0.06 * Math.sin(time * 19.3));
    pl3.intensity = 90 * (0.92 + 0.08 * Math.sin(time * 7.1 + 2));
    mat.furnace.color.setScalar(3.0 + 0.35 * Math.sin(time * 2.1) + 0.15 * Math.sin(time * 7.7));
    mat.ingotHot.emissiveIntensity = 1.5 + 0.15 * Math.sin(time * 1.3);
    // blinkers
    const bR = Math.sin(time * Math.PI * 1.0) > 0.2 ? 6 : 0.25;
    const bA = Math.sin(time * Math.PI * 1.6 + 1) > 0 ? 6 : 0.3;
    mat.blinkRed.color.copy(hdr(0xff2010, bR));
    mat.blinkAmber.color.copy(hdr(0xffa020, bA));
    // fans
    for (let i = 0; i < fans.length; i++) fans[i].rotateZ(dt * (2.2 + i * 0.35));
    // swaying hook
    hook.rotation.z = Math.sin(time * 0.55) * 0.035;
    hook.rotation.x = Math.sin(time * 0.37 + 1) * 0.025;
    // casting line
    for (let i = 0; i < moldCount; i++) {
      const x = -38 + ((i * moldSpacing + time * 0.6) % 76);
      tmpM.makeTranslation(x, 0.45, CZ);
      molds.setMatrixAt(i, tmpM);
      tmpM.makeTranslation(x, 0.68, CZ);
      const heat = THREE.MathUtils.clamp(1 - (x + 26) / 50, 0, 1) * (x > -26 ? 1 : 0);
      tmpC.setRGB(0.05 + heat * 3.2, 0.03 + heat * 1.3, 0.02 + heat * 0.3);
      moldTops.setMatrixAt(i, tmpM);
      moldTops.setColorAt(i, tmpC);
    }
    molds.instanceMatrix.needsUpdate = true;
    moldTops.instanceMatrix.needsUpdate = true;
    if (moldTops.instanceColor) moldTops.instanceColor.needsUpdate = true;
    // embers
    const ec = eColAttr.array as Float32Array;
    for (let i = 0; i < emberCount; i++) {
      eLife[i] += dt;
      if (eLife[i] > eMax[i]) spawnEmber(i, false);
      const k = i * 3;
      const sway = Math.sin(time * 2.1 + i * 0.7) * 1.1;
      ePos[k] += (eVel[k] + sway) * dt;
      ePos[k + 1] += eVel[k + 1] * dt;
      ePos[k + 2] += eVel[k + 2] * dt;
      const u = eLife[i] / eMax[i];
      const a = Math.min(1, u * 6) * (1 - u) * (0.7 + 0.3 * Math.sin(time * 9 + i));
      ec[k] = eCol[k] * a;
      ec[k + 1] = eCol[k + 1] * a;
      ec[k + 2] = eCol[k + 2] * a;
    }
    (eGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    eColAttr.needsUpdate = true;
    // sparks
    const sc2 = sCol.array as Float32Array;
    for (let i = 0; i < sparkCount; i++) {
      sLife[i] += dt;
      if (sLife[i] > sMax[i]) {
        spawnSpark(i);
        sLife[i] = 0;
      }
      const k = i * 3;
      sVel[k + 1] -= 9.8 * dt;
      sPos[k] += sVel[k] * dt;
      sPos[k + 1] += sVel[k + 1] * dt;
      sPos[k + 2] += sVel[k + 2] * dt;
      const a = 1 - sLife[i] / sMax[i];
      sc2[k] = 6 * a;
      sc2[k + 1] = 3.2 * a * a;
      sc2[k + 2] = 0.8 * a * a * a;
    }
    (sGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    sCol.needsUpdate = true;
    // smoke
    if (smokeCount) {
      for (let i = 0; i < smokeCount; i++) {
        kLife[i] += dt * 0.06;
        if (kLife[i] > 1) kLife[i] -= 1;
        const s = kSrc[i];
        const u = kLife[i];
        kPos[i * 3] = s.x + Math.sin(i * 2.3) * 2 + u * 5;
        kPos[i * 3 + 1] = s.y + 1 + u * 16;
        kPos[i * 3 + 2] = s.z + Math.cos(i * 1.7) * 2;
      }
      (kGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  };
  update(0, 0);

  return {
    info: {
      id: 'foundry',
      name: 'Crucible Yard',
      subtitle: 'Foundry Floor 3',
      blurb: 'Molten light, steel catwalks and a crane platform that never stops moving.',
      music: 'foundry',
      accent: '#ff7a2f',
    },
    root,
    colliders,
    hazards: [],
    spawns: [V(0, 0, SPAWN_Z), V(0, 0, -SPAWN_Z)],
    halfX: HALF,
    halfZ: HALF,
    background: skyT,
    environment,
    fog,
    keyLight,
    tick(t: number) {
      setCrane(t);
    },
    update,
    dispose() {
      void lastTime;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      for (const g of ownedGeos) g.dispose();
      crucGeo.dispose();
      for (const m of ownedMats) m.dispose();
      kit.dispose();
      root.clear();
    },
  };
};
