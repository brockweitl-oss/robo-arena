// Geometry helpers: material buckets merged into one mesh each, world-space box UVs, displaced rocks, tapered tubes.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { fbm3, noise3 } from './noise';

/** Strip to position/normal/uv and make sure the geometry is indexed so it can be merged with anything. */
export function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

/** Re-project UVs from world position along the dominant normal axis (box projection). */
export function boxUV(g: THREE.BufferGeometry, scale: number, offset = 0) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u: number, v: number;
    if (ay >= ax && ay >= az) { u = x; v = z; }
    else if (ax >= az) { u = z; v = y; }
    else { u = x; v = y; }
    uv[i * 2] = u * scale + offset;
    uv[i * 2 + 1] = v * scale + offset * 0.7;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Collects world-space geometries per material and merges them into single meshes. */
export class Buckets {
  private map = new Map<THREE.Material, { list: THREE.BufferGeometry[]; uvScale: number | null; cast: boolean; receive: boolean }>();
  constructor(private root: THREE.Object3D) {}
  register(mat: THREE.Material, uvScale: number | null, cast = true, receive = true) {
    this.map.set(mat, { list: [], uvScale, cast, receive });
  }
  add(mat: THREE.Material, g: THREE.BufferGeometry, m?: THREE.Matrix4, uvOffset = 0) {
    const b = this.map.get(mat);
    if (!b) throw new Error('unregistered bucket');
    if (m) g.applyMatrix4(m);
    prep(g);
    if (b.uvScale !== null) boxUV(g, b.uvScale, uvOffset);
    b.list.push(g);
  }
  build(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [mat, b] of this.map) {
      if (!b.list.length) continue;
      const merged = mergeGeometries(b.list, false)!;
      for (const g of b.list) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export function mat4(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.clone().compose(_p, _q, _s);
}

export function rbox(w: number, h: number, d: number, r = 0.05, seg = 2): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
}

/** Organic rock: displaced, slightly faceted sphere. Unit radius before scaling. */
export function rockGeo(seed: number, detail = 3, rough = 0.28, flatBottom = true): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = fbm3(x * 1.3 + seed * 3.1, y * 1.3, z * 1.3, 4, seed) - 0.5;
    const facet = Math.round(noise3(x * 2.2, y * 2.2, z * 2.2, seed + 5) * 3) / 3 - 0.5;
    let k = 1 + n * rough * 2 + facet * rough * 0.35;
    let ny = y * k;
    if (flatBottom && ny < -0.35) ny = -0.35 + (ny + 0.35) * 0.15;
    p.setXYZ(i, x * k, ny, z * k);
    uv[i * 2] = ((Math.atan2(z, x) / (Math.PI * 2) + 0.5) * 3);
    uv[i * 2 + 1] = (Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI) * 2;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Tube with tapering radius + gnarl bumps (for trunks/branches). UV: u around, v along (meters/vScale). */
export function taperTube(
  curve: THREE.Curve<THREE.Vector3>,
  radius: (s: number) => number,
  segs = 48,
  radial = 12,
  gnarl = 0.12,
  seed = 1,
  vScale = 1.5,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const len = curve.getLength();
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    curve.getPointAt(s, P);
    const r0 = radius(s);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      N.set(0, 0, 0).addScaledVector(frames.normals[i], ca).addScaledVector(frames.binormals[i], sa).normalize();
      const bump = 1 + (fbm3(ca * 1.5 + seed, sa * 1.5, s * len * 1.2, 3, seed) - 0.5) * gnarl * 2;
      const r = r0 * bump;
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
      nor.push(N.x, N.y, N.z);
      uv.push(j / radial, (s * len) / vScale);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Wedge (right-triangle prism): the top surface rises along +x from y=0 at x=0 to y=h at x=len; width along z centered. */
export function wedgeGeo(len: number, h: number, w: number, base = 0): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -base);
  s.lineTo(len, -base);
  s.lineTo(len, h);
  s.lineTo(0, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  g.translate(0, 0, -w / 2);
  return g;
}
