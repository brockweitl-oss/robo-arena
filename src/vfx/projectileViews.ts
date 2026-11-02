import * as THREE from 'three';
import type { Projectile } from '../game/world';
import type { ParticleSystem } from './particles';
import { glowSprite } from '../render/textures';

/**
 * Per-weapon projectile visuals: a shaped head per `spec.look` plus a camera-facing
 * ribbon trail that lingers briefly after the shot dies. Everything is pooled; a
 * projectile costs 2–3 draw calls (head, halo, ribbon).
 */

const N = 22;

const RIBBON_VERT = /* glsl */ `
  attribute vec3 aTan;
  attribute float aSide;
  attribute float aU;
  uniform float uWidth;
  uniform float uTail;
  varying float vU;
  varying float vSide;
  void main() {
    vec3 viewDir = normalize(cameraPosition - position);
    vec3 t = length(aTan) > 1e-5 ? normalize(aTan) : vec3(0.0, 0.0, 1.0);
    vec3 side = cross(t, viewDir);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
    float w = uWidth * mix(1.0, uTail, aU);
    vU = aU;
    vSide = aSide;
    gl_Position = projectionMatrix * viewMatrix * vec4(position + side * aSide * w * 0.5, 1.0);
  }
`;
const RIBBON_FRAG = /* glsl */ `
  uniform vec3 uHead;
  uniform vec3 uTailColor;
  uniform float uFade;
  uniform float uFalloff;
  varying float vU;
  varying float vSide;
  void main() {
    float along = pow(clamp(1.0 - vU, 0.0, 1.0), uFalloff);
    float edge = 1.0 - vSide * vSide;
    float core = smoothstep(0.55, 1.0, edge);
    vec3 col = mix(uTailColor, uHead, along) + vec3(core * along * 0.9);
    gl_FragColor = vec4(col * along * edge * uFade, 1.0);
  }
`;

/** A world-space ribbon following a moving point (newest point first). */
class Ribbon {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private pts = new Float32Array(N * 3);
  private n = 0;
  private pos: THREE.BufferAttribute;
  private tan: THREE.BufferAttribute;
  private u: THREE.BufferAttribute;
  maxLen = 4;

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tan = new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.u = new THREE.BufferAttribute(new Float32Array(N * 2), 1).setUsage(THREE.DynamicDrawUsage);
    const side = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; }
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    g.setAttribute('position', this.pos);
    g.setAttribute('aTan', this.tan);
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aU', this.u);
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uWidth: { value: 0.3 }, uTail: { value: 0.2 }, uHead: { value: new THREE.Color() }, uTailColor: { value: new THREE.Color() },
        uFade: { value: 1 }, uFalloff: { value: 1.4 },
      },
      vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
  }

  reset(p: THREE.Vector3) {
    this.n = 1;
    this.pts[0] = p.x; this.pts[1] = p.y; this.pts[2] = p.z;
  }

  /** Move the head; add a new segment once it has travelled far enough. */
  follow(p: THREE.Vector3) {
    const seg = this.maxLen / (N - 1);
    const P = this.pts;
    const dx = p.x - P[3], dy = p.y - P[4], dz = p.z - P[5];
    if (this.n < 2 || dx * dx + dy * dy + dz * dz > seg * seg) {
      P.copyWithin(3, 0, (N - 1) * 3);
      this.n = Math.min(N, this.n + 1);
    }
    P[0] = p.x; P[1] = p.y; P[2] = p.z;
  }

  rebuild() {
    const P = this.pts, pos = this.pos.array as Float32Array, tan = this.tan.array as Float32Array, U = this.u.array as Float32Array;
    let acc = 0;
    for (let i = 0; i < this.n; i++) {
      if (i > 0) acc += Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 1] - P[i * 3 - 2], P[i * 3 + 2] - P[i * 3 - 1]);
      const a = Math.max(0, i - 1), b = Math.min(this.n - 1, i + 1);
      const tx = P[a * 3] - P[b * 3], ty = P[a * 3 + 1] - P[b * 3 + 1], tz = P[a * 3 + 2] - P[b * 3 + 2];
      const u = Math.min(1, acc / this.maxLen);
      for (let s = 0; s < 2; s++) {
        const k = (i * 2 + s) * 3;
        pos[k] = P[i * 3]; pos[k + 1] = P[i * 3 + 1]; pos[k + 2] = P[i * 3 + 2];
        tan[k] = tx; tan[k + 1] = ty; tan[k + 2] = tz;
        U[i * 2 + s] = u;
      }
    }
    this.pos.needsUpdate = this.tan.needsUpdate = this.u.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, Math.max(0, this.n - 1) * 6);
  }

  /** Collapse the tail toward the head (after the shot dies). */
  shrink(k: number) {
    const P = this.pts;
    for (let i = 1; i < this.n; i++) for (let c = 0; c < 3; c++) P[i * 3 + c] += (P[c] - P[i * 3 + c]) * k;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

interface Style {
  width: number; tail: number; len: number; falloff: number; linger: number;
  head: 'bolt' | 'spear' | 'pellet' | 'wall' | 'harpoon' | 'shard';
  headLen: number; halo: number; sparks: number;
}
const STYLES: Record<Projectile['spec']['look'], Style> = {
  blaster: { width: 0.22, tail: 0.15, len: 2.6, falloff: 1.6, linger: 0.12, head: 'bolt', headLen: 0.75, halo: 0.6, sparks: 0 },
  scatter: { width: 0.14, tail: 0.1, len: 1.2, falloff: 1.8, linger: 0.08, head: 'pellet', headLen: 0.35, halo: 0.4, sparks: 0 },
  rail: { width: 0.34, tail: 0.6, len: 9, falloff: 0.7, linger: 0.4, head: 'spear', headLen: 1.8, halo: 0.9, sparks: 2 },
  beam: { width: 0.5, tail: 0.35, len: 5, falloff: 1, linger: 0.25, head: 'bolt', headLen: 1.4, halo: 1.0, sparks: 1 },
  homer: { width: 0.2, tail: 0.1, len: 3.2, falloff: 1.3, linger: 0.18, head: 'bolt', headLen: 0.55, halo: 0.55, sparks: 0 },
  turret: { width: 0.12, tail: 0.1, len: 1.4, falloff: 1.8, linger: 0.08, head: 'pellet', headLen: 0.3, halo: 0.35, sparks: 0 },
  lance: { width: 0.5, tail: 0.5, len: 11, falloff: 0.6, linger: 0.5, head: 'spear', headLen: 2.6, halo: 0.8, sparks: 3 },
  wave: { width: 0.9, tail: 0.6, len: 3, falloff: 1.2, linger: 0.2, head: 'wall', headLen: 1, halo: 0.9, sparks: 2 },
  hook: { width: 0.16, tail: 0.3, len: 2, falloff: 1.5, linger: 0.1, head: 'harpoon', headLen: 1.6, halo: 0.4, sparks: 1 },
  frost: { width: 0.36, tail: 0.25, len: 4.5, falloff: 1.1, linger: 0.3, head: 'shard', headLen: 1.8, halo: 0.55, sparks: 2 },
};

interface View {
  ribbon: Ribbon;
  head: THREE.Object3D;
  headKind: Style['head'];
  halo: THREE.Sprite;
  cable: THREE.Mesh | null;
  style: Style;
  dying: number;
  color: number;
  owner: number;
  spin: number;
  /** Skill shots leave the emitter mount, then blend onto the simulated path. */
  offset: THREE.Vector3 | null;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

export class ProjectileViews {
  readonly group = new THREE.Group();
  private views = new Map<number, View>();
  private ribbons: Ribbon[] = [];
  private heads = new Map<Style['head'], THREE.Object3D[]>();
  private halos: THREE.Sprite[] = [];
  private cables: THREE.Mesh[] = [];
  private geo: Record<string, THREE.BufferGeometry>;
  private mats = new Map<string, THREE.Material>();
  private haloTex = glowSprite(64, 0.2);
  private wallMat: THREE.ShaderMaterial;
  private t = 0;

  constructor(private sparks: ParticleSystem, private smoke: ParticleSystem) {
    // unit-length heads along +Z, scaled per style
    const bolt = new THREE.CapsuleGeometry(0.5, 1, 4, 10).rotateX(Math.PI / 2).scale(0.22, 0.22, 0.5);
    const spear = new THREE.ConeGeometry(0.5, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5).scale(0.18, 0.18, 1);
    const spearTail = new THREE.CylinderGeometry(0.035, 0.08, 1, 6).rotateX(Math.PI / 2).translate(0, 0, -0.5);
    const pellet = new THREE.SphereGeometry(0.5, 8, 6).scale(0.4, 0.4, 0.9);
    const shard = new THREE.OctahedronGeometry(0.5, 0).scale(0.32, 0.32, 1.1);
    const harpoon = new THREE.ConeGeometry(0.5, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.25).scale(0.32, 0.32, 0.7);
    const barbs = new THREE.TorusGeometry(0.22, 0.04, 4, 6).translate(0, 0, -0.05);
    const shaft = new THREE.CylinderGeometry(0.05, 0.05, 1, 6).rotateX(Math.PI / 2).translate(0, 0, -0.5).scale(1, 1, 0.8);
    // ion wall: a vertical arc facing the travel direction (+Z), unit height/width
    const wall = new THREE.PlaneGeometry(2, 1, 20, 1);
    { // gentle crescent: edges sweep back
      const wp = wall.getAttribute('position');
      for (let i = 0; i < wp.count; i++) { const x = wp.getX(i); wp.setZ(i, -x * x * 0.35); }
      wall.computeVertexNormals();
    }
    this.geo = { bolt, spear, spearTail, pellet, shard, harpoon, barbs, shaft, wall, cable: new THREE.CylinderGeometry(0.025, 0.025, 1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.5) };
    this.wallMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uT: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uT; varying vec2 vUv;
        void main(){
          float sx = sin(vUv.x * 3.14159);
          float fx = pow(sx, 1.5);
          // bright crest along the top and bottom, flowing horizontal ion bands between
          float crest = pow(1.0 - abs(vUv.y - 0.5) * 2.0, 0.6);
          float rim = smoothstep(0.78, 1.0, abs(vUv.y - 0.5) * 2.0) * (1.0 - smoothstep(0.97, 1.0, abs(vUv.y - 0.5) * 2.0));
          float flow = 0.5 + 0.5 * sin(vUv.y * 18.0 + uT * 22.0 + sin(vUv.x * 7.0 - uT * 5.0) * 1.6);
          float n = sin(vUv.x * 37.0 + uT * 13.0) * sin(vUv.y * 23.0 - uT * 17.0);
          float arc = pow(max(0.0, n), 10.0);
          float a = fx * (crest * (0.18 + flow * 0.35) + rim * 1.4 + arc * 0.9);
          vec3 c = uColor * (0.9 + flow * 0.5) + vec3(0.7, 0.85, 1.0) * (rim + arc) * 0.8;
          gl_FragColor = vec4(c * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
  }

  private glow(color: number, k: number) {
    const key = `g${color}:${k}`;
    let m = this.mats.get(key);
    if (!m) this.mats.set(key, (m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) })));
    return m;
  }
  private metal() {
    let m = this.mats.get('metal');
    if (!m) this.mats.set('metal', (m = new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.85, roughness: 0.3, emissive: 0x1a0d06 })));
    return m;
  }
  private ice() {
    let m = this.mats.get('ice');
    if (!m) this.mats.set('ice', (m = new THREE.MeshStandardMaterial({ color: 0xbff6ff, metalness: 0.1, roughness: 0.08, emissive: 0x4fd8ff, emissiveIntensity: 2.2, transparent: true, opacity: 0.92 })));
    return m;
  }

  private makeHead(kind: Style['head'], core: number, color: number): THREE.Object3D {
    const g = new THREE.Group();
    const G = this.geo;
    switch (kind) {
      case 'bolt': g.add(new THREE.Mesh(G.bolt, this.glow(core, 7))); break;
      case 'pellet': g.add(new THREE.Mesh(G.pellet, this.glow(core, 7))); break;
      case 'spear': g.add(new THREE.Mesh(G.spear, this.glow(core, 9)), new THREE.Mesh(G.spearTail, this.glow(color, 5))); break;
      case 'shard': {
        const shell = new THREE.Mesh(G.shard, this.glow(color, 1.6));
        shell.scale.setScalar(1.3);
        g.add(new THREE.Mesh(G.shard, this.ice()), shell);
        break;
      }
      case 'harpoon': {
        const glow = new THREE.Mesh(G.harpoon, this.glow(color, 2.2));
        glow.scale.setScalar(1.25);
        g.add(new THREE.Mesh(G.harpoon, this.metal()), new THREE.Mesh(G.barbs, this.metal()), new THREE.Mesh(G.shaft, this.metal()), glow);
        break;
      }
      case 'wall': g.add(new THREE.Mesh(G.wall, this.wallMat)); break;
    }
    g.traverse((o) => { o.frustumCulled = false; });
    return g;
  }

  private take<T>(pool: T[], make: () => T) {
    return pool.pop() ?? make();
  }

  /** `anchors[owner]` = muzzle world position (harpoon cable origin). */
  sync(list: Projectile[], dt: number, anchors: THREE.Vector3[]) {
    this.t += dt;
    this.wallMat.uniforms.uT.value = this.t;
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let v = this.views.get(p.id);
      const style = STYLES[p.spec.look] ?? STYLES.blaster;
      if (!v) {
        const ribbon = this.take(this.ribbons, () => new Ribbon());
        ribbon.maxLen = style.len;
        ribbon.reset(p.pos);
        const u = ribbon.mesh.material.uniforms;
        u.uWidth.value = style.head === 'wall' ? p.spec.radius * 1.4 : style.width;
        u.uTail.value = style.tail;
        u.uFalloff.value = style.falloff;
        u.uFade.value = 1;
        (u.uHead.value as THREE.Color).set(p.spec.coreColor ?? 0xffffff).lerp(new THREE.Color(p.spec.color), 0.35).multiplyScalar(2.2);
        (u.uTailColor.value as THREE.Color).set(p.spec.color).multiplyScalar(1.4);
        const pool = this.heads.get(style.head) ?? [];
        this.heads.set(style.head, pool);
        const head = pool.pop() ?? this.makeHead(style.head, p.spec.coreColor ?? 0xffffff, p.spec.color);
        const halo = this.take(this.halos, () => new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
        halo.material.color.set(p.spec.color).multiplyScalar(1.3);
        let cable: THREE.Mesh | null = null;
        if (style.head === 'harpoon') {
          cable = this.take(this.cables, () => new THREE.Mesh(this.geo.cable, this.glow(0xff9a4a, 3)));
          cable.frustumCulled = false;
          this.group.add(cable);
        }
        head.visible = halo.visible = true;
        this.group.add(ribbon.mesh, head, halo);
        const anchor = p.spec.skill ? anchors[p.owner] : undefined;
        const offset = anchor ? anchor.clone().sub(p.pos).addScaledVector(p.vel, p.age) : null;
        v = { ribbon, head, headKind: style.head, halo, cable, style, dying: 0, color: p.spec.color, owner: p.owner, spin: 0, offset };
        if (offset) ribbon.reset(_p.copy(p.pos).add(offset));
        this.views.set(p.id, v);
        // re-tint pooled head glow for this shot (bolts/pellets/spears share cached materials by color)
        if (style.head !== 'wall' && style.head !== 'harpoon' && style.head !== 'shard') {
          const meshes = head.children as THREE.Mesh[];
          meshes[0].material = this.glow(p.spec.coreColor ?? 0xffffff, style.head === 'spear' ? 9 : 7);
          if (meshes[1]) meshes[1].material = this.glow(p.spec.color, 5);
        }
        if (style.head === 'wall') this.wallMat.uniforms.uColor.value.set(p.spec.color);
      }
      _p.copy(p.pos);
      if (v.offset) _p.addScaledVector(v.offset, Math.max(0, 1 - p.age / 0.08));
      v.ribbon.follow(_p);
      v.ribbon.rebuild();
      // head orientation and size
      v.head.position.copy(_p);
      _a.copy(p.vel).normalize();
      if (_a.lengthSq() > 0.5) v.head.quaternion.setFromUnitVectors(Z, _a);
      const r = p.spec.radius;
      if (v.headKind === 'wall') {
        // the wall stands upright, centred on the shot, as wide as its hitbox
        _b.set(p.vel.x, 0, p.vel.z).normalize();
        if (_b.lengthSq() > 0.5) v.head.quaternion.setFromUnitVectors(Z, _b);
        v.head.scale.set(r * 1.15, 1.7, r);
        v.head.position.y -= 0.15;
      } else if (v.headKind === 'shard') {
        v.spin += dt * 14;
        v.head.rotateZ(v.spin);
        v.head.scale.setScalar(v.style.headLen);
      } else if (v.headKind === 'harpoon') v.head.scale.setScalar(v.style.headLen);
      else v.head.scale.set(1, 1, v.style.headLen).multiplyScalar(v.headKind === 'pellet' ? Math.max(0.6, r * 3) : 1);
      v.halo.position.copy(_p);
      v.halo.scale.setScalar(v.style.halo * (0.9 + Math.sin(this.t * 40 + p.id) * 0.1));
      if (v.cable) {
        const from = anchors[p.owner];
        if (from) {
          v.cable.position.copy(from);
          _b.copy(_p).sub(from);
          const len = _b.length();
          if (len > 1e-3) v.cable.quaternion.setFromUnitVectors(Z, _b.divideScalar(len));
          v.cable.scale.set(1, 1, len);
        }
      }
      // shed particles
      if (v.style.sparks > 0) {
        const n = Math.round(v.style.sparks * (v.headKind === 'wall' ? 2 : 1));
        for (let i = 0; i < n; i++) {
          _b.copy(p.pos);
          if (v.headKind === 'wall') { _b.x += (Math.random() - 0.5) * r * 2; _b.y += (Math.random() - 0.5) * 1.2; }
          this.sparks.emit({ pos: _b, count: 1, speed: [1, v.headKind === 'spear' ? 5 : 3], vel: _a.clone().multiplyScalar(-4), size: [0.04, 0.07], life: [0.15, 0.35], color: 0xffffff, color2: p.spec.color, intensity: 3, stretch: 0.05, drag: 3 });
        }
      }
      if (v.headKind === 'shard' && Math.random() < 0.7) this.smoke.emit({ pos: p.pos, count: 1, size: [0.25, 0.35], grow: 2.2, life: [0.4, 0.7], color: 0xcff6ff, alpha: 0.32, drag: 3, spin: 1 });
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      // the head disappears at once; the ribbon collapses and fades over `linger`
      if (v.dying === 0) {
        v.head.visible = v.halo.visible = false;
        this.group.remove(v.head, v.halo);
        (this.heads.get(v.headKind) ?? []).push(v.head);
        this.halos.push(v.halo);
        if (v.cable) { this.group.remove(v.cable); this.cables.push(v.cable); v.cable = null; }
      }
      v.dying += dt;
      const k = 1 - v.dying / Math.max(0.05, v.style.linger);
      if (k <= 0) {
        this.group.remove(v.ribbon.mesh);
        this.ribbons.push(v.ribbon);
        this.views.delete(id);
        continue;
      }
      v.ribbon.shrink(Math.min(1, dt * 6));
      v.ribbon.rebuild();
      v.ribbon.mesh.material.uniforms.uFade.value = k * k;
    }
  }

  clear() {
    for (const [, v] of this.views) {
      this.group.remove(v.ribbon.mesh, v.head, v.halo);
      this.ribbons.push(v.ribbon);
      if (v.cable) this.group.remove(v.cable);
    }
    this.views.clear();
  }

  dispose() {
    this.clear();
    const all = new Set<Ribbon>(this.ribbons);
    for (const r of all) r.dispose();
    for (const g of Object.values(this.geo)) g.dispose();
    for (const m of this.mats.values()) m.dispose();
    for (const h of this.halos) h.material.dispose();
    this.wallMat.dispose();
  }
}
