import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { panelMaps, rubberMaps, grimeMap } from '../render/textures';
import type { Paint } from '../data/characters';

/* ------------------------------------------------------------------ */
/* Geometry primitives                                                 */
/* ------------------------------------------------------------------ */

export type Geo = THREE.BufferGeometry;

export function rbox(w: number, h: number, d: number, r = 0.03, seg = 2): Geo {
  r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  return new RoundedBoxGeometry(w, h, d, seg, Math.max(0.001, r));
}

/**
 * Extruded 2D profile (in the XY plane) with a bevel; extrudes along Z and is
 * centered on Z. Great for armor plates with crisp, light-catching edges.
 */
export function plate(points: [number, number][], depth: number, bevel = 0.012, curveSeg = 1): Geo {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: curveSeg,
  });
  g.translate(0, 0, -depth / 2 + bevel);
  return g;
}

/** Faceted armor with a central ridge and depth taper, rather than a flat slab.
 * Profile points on the centreline form the ridge; bevels remain real geometry.
 */
export function armorShell(points: [number, number][], depth: number, ridge = 0.025): Geo {
  const g = plate(points, depth, 0.006);
  const a = g.getAttribute('position');
  const halfW = Math.max(...points.map(p => Math.abs(p[0])));
  const minY = Math.min(...points.map(p => p[1]));
  const height = Math.max(...points.map(p => p[1])) - minY;
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
    const taper = 0.72 + 0.28 * THREE.MathUtils.clamp((y - minY) / height, 0, 1);
    a.setZ(i, z * taper + ridge * Math.max(0, 1 - Math.abs(x) / halfW));
  }
  g.computeVertexNormals();
  return g;
}

/** Box with chamfered (45°) vertical edges, extruded along Z. w = x, h = y, d = z. */
export function chamferBox(w: number, h: number, d: number, c = 0.05, bevel = 0.01): Geo {
  const x = w / 2;
  const y = h / 2;
  c = Math.min(c, x * 0.9, y * 0.9);
  return plate(
    [
      [-x + c, -y],
      [x - c, -y],
      [x, -y + c],
      [x, y - c],
      [x - c, y],
      [-x + c, y],
      [-x, y - c],
      [-x, -y + c],
    ],
    d,
    bevel,
  );
}

/** Trapezoid prism: bottom width wb, top width wt, height h, depth d (extruded along Z). */
export function trap(wb: number, wt: number, h: number, d: number, bevel = 0.012): Geo {
  return plate(
    [
      [-wb / 2, -h / 2],
      [wb / 2, -h / 2],
      [wt / 2, h / 2],
      [-wt / 2, h / 2],
    ],
    d,
    bevel,
  );
}

export function cyl(rt: number, rb: number, h: number, seg = 20, open = false): Geo {
  return new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
}

export function sphere(r: number, ws = 20, hs = 14): Geo {
  return new THREE.SphereGeometry(r, ws, hs);
}

export function lathe(profile: [number, number][], seg = 24): Geo {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
}

export function torus(r: number, tube: number, seg = 24, tseg = 8): Geo {
  return new THREE.TorusGeometry(r, tube, tseg, seg);
}

export function tube(points: THREE.Vector3[], r: number, seg = 24): Geo {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, seg, r, 8, false);
}

/** Reverse triangle winding (needed after a mirroring transform). Returns a non-indexed geometry. */
export function flipWinding(g: Geo): Geo {
  const n = g.index ? g.toNonIndexed() : g;
  const pos = n.getAttribute('position');
  for (const attrName of Object.keys(n.attributes)) {
    const a = n.getAttribute(attrName) as THREE.BufferAttribute;
    const k = a.itemSize;
    const arr = a.array as any;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      for (let c = 0; c < k; c++) {
        const t = arr[(i + 1) * k + c];
        arr[(i + 1) * k + c] = arr[(i + 2) * k + c];
        arr[(i + 2) * k + c] = t;
      }
    }
    a.needsUpdate = true;
  }
  return n;
}

/** Apply a transform: position, euler (radians), scale. Negative scales are handled (winding fixed). */
export function xf(g: Geo, p: [number, number, number] = [0, 0, 0], r: [number, number, number] = [0, 0, 0], s: number | [number, number, number] = 1): Geo {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'XYZ'));
  const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
  m.compose(new THREE.Vector3(...p), q, sc);
  g.applyMatrix4(m);
  return sc.x * sc.y * sc.z < 0 ? flipWinding(g) : g;
}

/** Mirror a geometry across X (fixes winding). */
export function mirrorX(g: Geo): Geo {
  const c = g.clone();
  c.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  return flipWinding(c);
}

/** Box-projected UVs (dominant normal axis) so texel density is consistent across parts. */
export function boxUV(g: Geo, scale: number): Geo {
  const pos = g.getAttribute('position');
  let nor = g.getAttribute('normal');
  if (!nor) {
    g.computeVertexNormals();
    nor = g.getAttribute('normal');
  }
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let u: number;
    let v: number;
    if (nx >= ny && nx >= nz) {
      u = z;
      v = y;
    } else if (ny >= nx && ny >= nz) {
      u = x;
      v = z;
    } else {
      u = x;
      v = y;
    }
    uv[i * 2] = u * scale + 0.37;
    uv[i * 2 + 1] = v * scale + 0.61;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

export type MatKey = 'primary' | 'secondary' | 'trim' | 'dark' | 'joint' | 'chrome' | 'glow' | 'visor' | 'glowHot' | 'decal';

export type MatSet = Record<MatKey, THREE.Material>;

export function makeMaterials(paint: Paint, seed = 1): MatSet {
  const panel = panelMaps(seed, 512, 1);
  const panelFine = panelMaps(seed + 50, 512, 2);
  const rub = rubberMaps(256);
  const grime = grimeMap(seed + 9, 512, 0.8);

  const painted = (color: number, rough = 0.36) =>
    new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.28,
      roughness: rough,
      roughnessMap: panel.rough,
      normalMap: panel.normal,
      normalScale: new THREE.Vector2(0.12, 0.12),
      clearcoat: 0.25,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.1,
    });

  const glowColor = new THREE.Color(paint.glow);
  const mats: MatSet = {
    primary: painted(paint.primary, 0.48),
    secondary: painted(paint.secondary, 0.44),
    trim: new THREE.MeshPhysicalMaterial({
      color: paint.trim,
      metalness: 0.55,
      roughness: 0.3,
      normalMap: panelFine.normal,
      normalScale: new THREE.Vector2(0.15, 0.15),
      clearcoat: 0.4,
      envMapIntensity: 1.1,
    }),
    dark: new THREE.MeshStandardMaterial({
      color: paint.dark,
      metalness: 0.75,
      roughness: 0.42,
      roughnessMap: grime,
      normalMap: panelFine.normal,
      normalScale: new THREE.Vector2(0.18, 0.18),
      envMapIntensity: 1,
    }),
    joint: new THREE.MeshStandardMaterial({
      color: 0x1b1c21,
      metalness: 0.1,
      roughness: 0.78,
      normalMap: rub.normal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: rub.rough,
    }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xa6b1c0, metalness: 0.92, roughness: 0.28, envMapIntensity: 1.3 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: glowColor, emissiveIntensity: 3.2, roughness: 0.4 }),
    glowHot: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: glowColor.clone().lerp(new THREE.Color(1, 1, 1), 0.35), emissiveIntensity: 6, roughness: 0.4 }),
    visor: new THREE.MeshPhysicalMaterial({
      color: 0x05070a,
      metalness: 0.2,
      roughness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      emissive: glowColor,
      emissiveIntensity: 0.18,
      envMapIntensity: 1.6,
    }),
    decal: new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, roughness: 0.4, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 }),
  };
  return mats;
}

/* ------------------------------------------------------------------ */
/* Builder: collects geometry per (joint, material), merges at the end */
/* ------------------------------------------------------------------ */

export class PartBuilder {
  private buckets = new Map<THREE.Object3D, Map<MatKey, Geo[]>>();
  /** Texture density: UV units per meter. */
  uvScale = 1.05;

  add(joint: THREE.Object3D, mat: MatKey, g: Geo) {
    let b = this.buckets.get(joint);
    if (!b) this.buckets.set(joint, (b = new Map()));
    let list = b.get(mat);
    if (!list) b.set(mat, (list = []));
    list.push(g);
  }

  /** Add a geometry and its X-mirror (for symmetric parts on a centered joint). */
  addSym(joint: THREE.Object3D, mat: MatKey, g: Geo) {
    this.add(joint, mat, g);
    this.add(joint, mat, mirrorX(g));
  }

  build(mats: MatSet, opts: { castShadow?: boolean } = {}): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [joint, b] of this.buckets) {
      for (const [key, list] of b) {
        const prepared = list.map((g) => {
          let n = g.index ? g.toNonIndexed() : g;
          for (const a of Object.keys(n.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'uv') n.deleteAttribute(a);
          if (!n.getAttribute('normal')) n.computeVertexNormals();
          if (key !== 'decal') boxUV(n, this.uvScale);
          else if (!n.getAttribute('uv')) boxUV(n, 1);
          return n;
        });
        const merged = prepared.length === 1 ? prepared[0] : mergeGeometries(prepared, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, mats[key]);
        mesh.castShadow = opts.castShadow !== false && key !== 'glow' && key !== 'glowHot' && key !== 'decal';
        mesh.receiveShadow = key !== 'glow' && key !== 'glowHot';
        mesh.name = `${joint.name}:${key}`;
        mesh.userData.matKey = key;
        joint.add(mesh);
        meshes.push(mesh);
        for (const g of list) if (g !== merged) g.dispose();
      }
    }
    this.buckets.clear();
    return meshes;
  }
}

/** Ring of small bolt heads around a circle (for joints). */
export function boltRing(r: number, n: number, boltR = 0.012, h = 0.012): Geo[] {
  const out: Geo[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(xf(cyl(boltR, boltR, h, 6), [Math.cos(a) * r, Math.sin(a) * r, 0], [Math.PI / 2, 0, 0]));
  }
  return out;
}

/** A row of vent slats in the XY plane facing +Z. */
export function vents(w: number, h: number, n: number, depth = 0.02): Geo[] {
  const out: Geo[] = [];
  for (let i = 0; i < n; i++) {
    const y = -h / 2 + ((i + 0.5) / n) * h;
    out.push(xf(rbox(w, (h / n) * 0.45, depth, 0.004, 1), [0, y, 0], [-0.35, 0, 0]));
  }
  return out;
}

/** Hydraulic piston between two points (cylinder + chrome rod). */
export function piston(a: THREE.Vector3, b: THREE.Vector3, r = 0.022): { body: Geo; rod: Geo } {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const mid1 = a.clone().addScaledVector(dir, 0.3);
  const mid2 = a.clone().addScaledVector(dir, 0.75);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  const body = xf(cyl(r, r, len * 0.6, 10), mid1.toArray() as any, [e.x, e.y, e.z]);
  const rod = xf(cyl(r * 0.55, r * 0.55, len * 0.5, 8), mid2.toArray() as any, [e.x, e.y, e.z]);
  return { body, rod };
}
