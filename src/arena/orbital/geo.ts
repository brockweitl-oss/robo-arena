import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Compose a transform matrix (rotation order YXZ). */
export function M(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** Box-projected world-space UVs (per triangle dominant axis). Geometry must be non-indexed. */
export function boxUV(g: THREE.BufferGeometry, scale: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(_p.subVectors(a, b));
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      let u = 0;
      let w = 0;
      if (ay >= ax && ay >= az) {
        u = v.x;
        w = v.z;
      } else if (ax >= az) {
        u = v.z;
        w = v.y;
      } else {
        u = v.x;
        w = v.y;
      }
      uv[(i + k) * 2] = u / scale;
      uv[(i + k) * 2 + 1] = w / scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Collects geometry per material and merges it into one mesh per material. */
export class Batcher {
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, geo: THREE.BufferGeometry, matrix?: THREE.Matrix4, uvScale = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (uvScale > 0) boxUV(g, uvScale);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    let list = this.groups.get(mat);
    if (!list) this.groups.set(mat, (list = []));
    list.push(g);
  }
  build(parent: THREE.Object3D, cast = true, receive = true): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.groups) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      const transparent = mat.transparent || (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial;
      mesh.castShadow = cast && !mat.transparent;
      mesh.receiveShadow = receive && !transparent;
      parent.add(mesh);
      out.push(mesh);
    }
    this.groups.clear();
    return out;
  }
}

/** Chamfered rectangle plate extruded along +z (back face at z = 0), centered on x/y. */
export function plate(w: number, h: number, d: number, ch = 0.1, bevel = 0.012): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x = w / 2 - bevel;
  const y = h / 2 - bevel;
  const c = Math.min(ch, x * 0.9, y * 0.9);
  s.moveTo(-x + c, -y);
  s.lineTo(x - c, -y);
  s.lineTo(x, -y + c);
  s.lineTo(x, y - c);
  s.lineTo(x - c, y);
  s.lineTo(-x + c, y);
  s.lineTo(-x, y - c);
  s.lineTo(-x, -y + c);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, d - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.translate(0, 0, bevel);
  return g;
}

/** Solid wedge (ramp): high end (height h) at x0, low end (0) at x1. Returns top surface and sides separately. */
export function wedge(x0: number, x1: number, z0: number, z1: number, h: number): { top: THREE.BufferGeometry; sides: THREE.BufferGeometry } {
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const A = P(x0, h, z0);
  const B = P(x0, h, z1);
  const C = P(x1, 0, z1);
  const D = P(x1, 0, z0);
  const E = P(x0, 0, z0);
  const F = P(x0, 0, z1);
  const cen = new THREE.Vector3((x0 * 2 + x1) / 3, h / 3, (z0 + z1) / 2);
  const build = (tris: THREE.Vector3[][], topUV: boolean) => {
    const pos: number[] = [];
    const uv: number[] = [];
    for (const t of tris) {
      const n = new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0]));
      const mid = new THREE.Vector3().add(t[0]).add(t[1]).add(t[2]).multiplyScalar(1 / 3);
      const tt = n.dot(mid.sub(cen)) < 0 ? [t[0], t[2], t[1]] : t;
      for (const v of tt) {
        pos.push(v.x, v.y, v.z);
        if (topUV) uv.push((v.z - z0) / (z1 - z0), Math.abs(v.x - x1) / Math.abs(x0 - x1));
        else uv.push(0, 0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  return {
    top: build([[A, B, C], [A, C, D]], true),
    sides: build([[A, D, E], [B, F, C], [A, E, F], [A, F, B]], false),
  };
}

/**
 * Strip swept around a closed convex polygon (x,z pairs) with a 2D profile of (outwardOffset, y) points.
 * Uses mitred corners. u = perimeter distance / uScale, v = profile index fraction.
 */
export function perimeterStrip(
  pts: [number, number][],
  profile: [number, number][],
  uScale = 1,
): THREE.BufferGeometry {
  const n = pts.length;
  const edgeN: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const d = new THREE.Vector2(b[0] - a[0], b[1] - a[1]).normalize();
    const nn = new THREE.Vector2(d.y, -d.x);
    const mid = new THREE.Vector2((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    if (nn.dot(mid) < 0) nn.negate();
    edgeN.push(nn);
  }
  const miter: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const np = edgeN[(i - 1 + n) % n];
    const nx = edgeN[i];
    const m = new THREE.Vector2().addVectors(np, nx).normalize();
    m.multiplyScalar(1 / Math.max(0.2, m.dot(nx)));
    miter.push(m);
  }
  const pos: number[] = [];
  const uv: number[] = [];
  let dist = 0;
  const at = (i: number, k: number) => {
    const p = pts[i % n];
    const m = miter[i % n];
    const [o, y] = profile[k];
    return new THREE.Vector3(p[0] + m.x * o, y, p[1] + m.y * o);
  };
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const en = edgeN[i];
    for (let k = 0; k < profile.length - 1; k++) {
      const p00 = at(i, k);
      const p01 = at(i, k + 1);
      const p10 = at(i + 1, k);
      const p11 = at(i + 1, k + 1);
      const dOut = profile[k + 1][0] - profile[k][0];
      const dy = profile[k + 1][1] - profile[k][1];
      const expect = new THREE.Vector3(en.x * -dy, dOut, en.y * -dy);
      const u0 = dist / uScale;
      const u1 = (dist + L) / uScale;
      const v0 = k / (profile.length - 1);
      const v1 = (k + 1) / (profile.length - 1);
      const quad: [THREE.Vector3, number, number][][] = [
        [
          [p00, u0, v0],
          [p10, u1, v0],
          [p11, u1, v1],
        ],
        [
          [p00, u0, v0],
          [p11, u1, v1],
          [p01, u0, v1],
        ],
      ];
      for (const tri of quad) {
        const nrm = new THREE.Vector3()
          .subVectors(tri[1][0], tri[0][0])
          .cross(new THREE.Vector3().subVectors(tri[2][0], tri[0][0]));
        const t = nrm.dot(expect) < 0 ? [tri[0], tri[2], tri[1]] : tri;
        for (const [p, u, v] of t) {
          pos.push(p.x, p.y, p.z);
          uv.push(u, v);
        }
      }
    }
    dist += L;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Horizontal polygon cap (y = const), facing up (or down). uv = world xz / scale. */
export function polyCap(pts: [number, number][], y: number, up = true, uvScale = 1, uvOffset = 0): THREE.BufferGeometry {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2); // shape (x, y) -> (x, 0, -y) = (x, 0, z)
  g.translate(0, y, 0);
  if (!up) {
    g.rotateX(Math.PI);
    g.translate(0, 2 * y, 0); // mirror back to height y (rotation flips y and z; z symmetric for our polys)
  }
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + uvOffset) / uvScale;
    uv[i * 2 + 1] = 1 - (pos.getZ(i) + uvOffset) / uvScale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Angular plate: large chamfers on top-left and bottom-right corners, small ones elsewhere. Back face at z = 0. */
export function cutPlate(w: number, h: number, d: number, big = 0.3, small = 0.05, bevel = 0.012): THREE.BufferGeometry {
  const x = w / 2 - bevel;
  const y = h / 2 - bevel;
  const b = Math.min(big, x * 0.8, y * 0.8);
  const s = Math.min(small, x * 0.4, y * 0.4);
  const sh = new THREE.Shape();
  sh.moveTo(-x + s, -y);
  sh.lineTo(x - b, -y);
  sh.lineTo(x, -y + b);
  sh.lineTo(x, y - s);
  sh.lineTo(x - s, y);
  sh.lineTo(-x + b, y);
  sh.lineTo(-x, y - b);
  sh.lineTo(-x, -y + s);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: Math.max(0.001, d - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.translate(0, 0, bevel);
  return g;
}

/** PlaneGeometry whose UVs map to cell (i) of a cols x rows atlas. */
export function atlasQuad(w: number, h: number, i: number, cols: number, rows: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const cx = i % cols;
  const cy = Math.floor(i / cols);
  for (let k = 0; k < uv.count; k++) {
    uv.setXY(k, (cx + uv.getX(k)) / cols, 1 - (cy + 1 - uv.getY(k)) / rows);
  }
  return g;
}
