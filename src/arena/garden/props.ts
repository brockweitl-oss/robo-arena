// Prop geometry for Lantern Terrace: stone lanterns, paper lanterns, wooden gate frames, foliage pads, koi.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../../render/textures';
import { Buckets, boxUV, mat4, prep, rbox } from './geo';
import { fbm3 } from './noise';

export interface Blob {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  ry: number;
  rx?: number;
  rz?: number;
  color: THREE.Color;
}

const lathe = (pts: [number, number][], segs: number) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);

/** Stone lantern (original hex design), base at y=0, ~2.9 m tall. Stone part + glowing firebox core. */
export function stoneLanternGeos(): { stone: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, m?: THREE.Matrix4) => {
    if (m) g.applyMatrix4(m);
    parts.push(prep(g));
  };
  add(new THREE.CylinderGeometry(0.6, 0.7, 0.28, 6), mat4(0, 0.14, 0));
  add(new THREE.CylinderGeometry(0.47, 0.56, 0.14, 6), mat4(0, 0.35, 0));
  add(lathe([[0.0, 0.42], [0.27, 0.42], [0.25, 0.47], [0.2, 0.55], [0.18, 0.9], [0.19, 1.2], [0.25, 1.28], [0.27, 1.36], [0, 1.36]], 14));
  add(new THREE.CylinderGeometry(0.56, 0.34, 0.24, 6), mat4(0, 1.48, 0));
  add(new THREE.CylinderGeometry(0.43, 0.43, 0.06, 6), mat4(0, 1.62, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(rbox(0.1, 0.5, 0.1, 0.02, 1), mat4(Math.sin(a) * 0.37, 1.89, Math.cos(a) * 0.37, 0, a, 0));
  }
  add(new THREE.CylinderGeometry(0.46, 0.44, 0.07, 6), mat4(0, 2.17, 0));
  // roof: hex with an upturned eave lip
  add(lathe([[0.0, 2.6], [0.12, 2.57], [0.3, 2.45], [0.55, 2.3], [0.82, 2.2], [0.95, 2.24], [0.97, 2.19], [0.9, 2.14], [0.45, 2.18], [0.0, 2.18]], 6));
  add(lathe([[0, 2.58], [0.1, 2.6], [0.13, 2.67], [0.12, 2.72], [0.07, 2.8], [0.025, 2.88], [0, 2.92]], 10));
  const stone = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  boxUV(stone, 1.1);
  const glow = new THREE.CylinderGeometry(0.335, 0.335, 0.48, 6, 1, true);
  glow.translate(0, 1.89, 0);
  const cap = new THREE.CylinderGeometry(0.335, 0.335, 0.02, 6);
  cap.translate(0, 1.66, 0);
  const g2 = mergeGeometries([prep(glow), prep(cap)])!;
  glow.dispose();
  cap.dispose();
  return { stone, glow: g2 };
}

/** Paper lantern: ribbed ellipsoid + tiny cord on top (cord samples the dark cap band). Center at origin. */
export function paperLanternGeo(): THREE.BufferGeometry {
  const pts: [number, number][] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const y = -0.2 + (i / N) * 0.4;
    let r = 0.17 * Math.sqrt(Math.max(0, 1 - Math.pow(y / 0.215, 2)));
    r = Math.max(r, 0.085);
    if (i === 0 || i === N) r = 0.085;
    pts.push([r * (1 + (i % 2 ? 0.025 : 0)), y]);
  }
  pts.unshift([0, -0.2]);
  pts.push([0, 0.2]);
  const body = prep(lathe(pts, 14));
  const cord = prep(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4, 1, true));
  cord.translate(0, 0.28, 0);
  const uv = cord.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.995);
  const g = mergeGeometries([body, cord])!;
  body.dispose();
  cord.dispose();
  return g;
}

/** Clumpy foliage blob: displaced icosphere (unit radius), with uv for a leafy normal map. */
export function blobGeo(detail = 2): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (fbm3(x * 1.8, y * 1.8, z * 1.8, 3, 61) - 0.5) * 0.55;
    p.setXYZ(i, x * k, y * k * (y < 0 ? 0.7 : 1), z * k);
    uv[i * 2] = Math.atan2(z, x) / Math.PI + 1;
    uv[i * 2 + 1] = y * 1.2 + 1;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Scatter a cloud-pad of foliage blobs (bonsai style: flat bottom, domed top). */
export function pad(
  out: Blob[],
  cx: number, cy: number, cz: number,
  rx: number, ry: number, rz: number,
  seed: number, dark: string, light: string, size = 1, density = 1,
) {
  const r = rng(seed);
  const n = Math.round((rx * rz * 5.5 + 5) * density);
  const cd = new THREE.Color(dark), cl = new THREE.Color(light);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 0.9;
    const dome = 1 - d * d;
    const lift = (0.15 + r() * 0.85) * dome;
    const s = (0.42 + r() * 0.3) * (0.75 + 0.35 * dome) * size;
    const c = cd.clone().lerp(cl, Math.min(1, 0.15 + lift * 0.85 + (r() - 0.5) * 0.2));
    out.push({
      x: cx + Math.cos(a) * d * rx,
      y: cy + (lift - 0.25) * ry,
      z: cz + Math.sin(a) * d * rz,
      sx: s * 1.15, sy: s * 0.8, sz: s * 1.15,
      ry: r() * 6.28,
      color: c,
    });
  }
}

/** Ellipsoid crown of blobs (blossom trees, shrubs). */
export function crown(out: Blob[], cx: number, cy: number, cz: number, rad: number, n: number, seed: number, dark: string, light: string, size = 1) {
  const r = rng(seed);
  const cd = new THREE.Color(dark), cl = new THREE.Color(light);
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, a = r() * Math.PI * 2;
    const rr = Math.cbrt(r()) * rad;
    const sq = Math.sqrt(1 - u * u);
    const y = u * rr * 0.7;
    const s = (0.45 + r() * 0.35) * size;
    out.push({
      x: cx + Math.cos(a) * sq * rr,
      y: cy + y,
      z: cz + Math.sin(a) * sq * rr,
      sx: s, sy: s * 0.85, sz: s,
      ry: r() * 6.28,
      color: cd.clone().lerp(cl, Math.min(1, Math.max(0, 0.5 + y / rad + (r() - 0.5) * 0.3))),
    });
  }
}

export interface GateMats {
  woodV: THREE.Material;
  woodH: THREE.Material;
  copper: THREE.Material;
  stone: THREE.Material;
  roof: THREE.Material;
}

/**
 * Wooden gate frame (original design): two tapered posts on stone footings, a tie beam
 * and a swept top beam with copper end caps. axis = direction the beams run.
 * Returns the hanging point for a center lantern.
 */
export function gate(b: Buckets, m: GateMats, cx: number, y0: number, cz: number, axis: 'x' | 'z', half: number, H: number): THREE.Vector3 {
  const ry = axis === 'x' ? 0 : Math.PI / 2;
  const base = new THREE.Matrix4().compose(new THREE.Vector3(cx, y0, cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
  const at = (x: number, y: number, z: number, rx = 0, ryy = 0, rz = 0) => base.clone().multiply(mat4(x, y, z, rx, ryy, rz));
  for (const s of [-1, 1]) {
    b.add(m.stone, rbox(0.78, 0.32, 0.78, 0.06), at(s * half, 0.16, 0));
    b.add(m.woodV, new THREE.CylinderGeometry(0.2, 0.24, H - 0.32, 16), at(s * half, 0.32 + (H - 0.32) / 2, 0));
    b.add(m.copper, new THREE.CylinderGeometry(0.26, 0.26, 0.1, 16), at(s * half, 0.37, 0));
    // wedge pegs through the tie beam
    b.add(m.woodH, rbox(0.12, 0.34, 0.5, 0.02, 1), at(s * half, H - 0.95, 0));
  }
  // tie beam
  b.add(m.woodH, rbox(half * 2 + 0.7, 0.26, 0.2, 0.03), at(0, H - 0.95, 0));
  // lintel (straight, thick) sitting on the posts
  b.add(m.woodH, rbox(half * 2 + 1.1, 0.3, 0.42, 0.04), at(0, H - 0.15, 0));
  // knee braces between posts and lintel
  for (const s of [-1, 1]) {
    b.add(m.woodH, rbox(0.95, 0.14, 0.14, 0.02, 1), at(s * (half - 0.38), H - 0.62, 0, 0, 0, s * 0.78));
    b.add(m.copper, new THREE.CylinderGeometry(0.255, 0.255, 0.12, 16), at(s * half, H - 1.35, 0));
  }
  // small pitched tile roof over the lintel, with copper ridge caps
  const RL = half * 2 + 1.7;
  for (const s of [-1, 1]) b.add(m.roof, rbox(RL, 0.09, 0.62, 0.03, 1), at(0, H + 0.13, s * 0.25, s * 0.42, 0, 0));
  b.add(m.roof, rbox(RL + 0.05, 0.13, 0.16, 0.04, 2), at(0, H + 0.27, 0));
  for (const s of [-1, 1]) b.add(m.copper, rbox(0.18, 0.24, 0.24, 0.04, 1), at(s * (RL / 2 + 0.04), H + 0.3, 0));
  // central plaque strut
  b.add(m.woodV, rbox(0.42, 0.55, 0.12, 0.03), at(0, H - 0.6, 0));
  return new THREE.Vector3(0, H - 1.08, 0).applyMatrix4(base);
}

/** Koi: body + forked tail, oriented along +z. */
export function koiGeo(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(1, 12, 8);
  body.scale(0.085, 0.055, 0.28);
  const tail = new THREE.ConeGeometry(0.09, 0.18, 4);
  tail.rotateX(-Math.PI / 2);
  tail.scale(1, 0.25, 1);
  tail.translate(0, 0, -0.33);
  const fins = new THREE.BoxGeometry(0.28, 0.008, 0.06);
  fins.translate(0, -0.02, 0.08);
  const g = mergeGeometries([prep(body), prep(tail), prep(fins)])!;
  body.dispose();
  tail.dispose();
  fins.dispose();
  return g;
}
