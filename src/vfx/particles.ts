import * as THREE from 'three';
import { glowSprite, smokeSprite } from '../render/textures';

/**
 * CPU-simulated, GPU-instanced billboard particles. One draw call per system.
 * Particles can be velocity-stretched (sparks, streaks) or round (glows, smoke).
 */

export interface EmitOpts {
  pos: THREE.Vector3;
  count?: number;
  /** Base velocity added to every particle. */
  vel?: THREE.Vector3;
  /** Random velocity: direction sphere/hemisphere scaled by speed range. */
  speed?: [number, number];
  /** Bias random directions toward this normal (hemisphere). */
  dir?: THREE.Vector3;
  /** 0 = sphere, 1 = tight cone around dir. */
  cone?: number;
  /** Random position jitter radius. */
  spread?: number;
  life?: [number, number];
  size?: [number, number];
  /** End size multiplier. */
  grow?: number;
  color?: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  /** HDR brightness multiplier (additive). */
  intensity?: number;
  alpha?: number;
  drag?: number;
  gravity?: number;
  /** Velocity stretch factor (0 = round). */
  stretch?: number;
  spin?: number;
}

const VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iCol;
  attribute vec3 iVel;
  attribute vec2 iSize; // size, rotation
  varying vec2 vUv;
  varying vec4 vCol;
  void main() {
    vUv = uv;
    vCol = iCol;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    vec2 q = position.xy * iSize.x;
    vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
    float sl = length(vv.xy);
    if (sl > 0.001) {
      // stretched along screen-space velocity
      vec2 d = vv.xy / sl;
      vec2 n = vec2(-d.y, d.x);
      float len = iSize.x * 0.5 + sl;
      q = d * position.y * len * 2.0 + n * position.x * iSize.x * 0.5;
    } else {
      float c = cos(iSize.y), s = sin(iSize.y);
      q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    }
    mv.xy += q;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec4 vCol;
  void main() {
    vec4 t = texture2D(map, vUv);
    gl_FragColor = vec4(vCol.rgb * t.rgb, vCol.a * t.a);
    #include <colorspace_fragment>
  }
`;

export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private max: number;
  private n = 0;
  // sim arrays
  private p: Float32Array;
  private v: Float32Array;
  private life: Float32Array;
  private age: Float32Array;
  private size: Float32Array; // start, end
  private c0: Float32Array;
  private c1: Float32Array;
  private a: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private stretch: Float32Array;
  private rot: Float32Array; // rot, spin
  // gpu
  private iPos: THREE.InstancedBufferAttribute;
  private iCol: THREE.InstancedBufferAttribute;
  private iVel: THREE.InstancedBufferAttribute;
  private iSize: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  scale = 1;

  constructor(max: number, kind: 'add' | 'smoke') {
    this.max = max;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.size = new Float32Array(max * 2);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.stretch = new Float32Array(max);
    this.rot = new Float32Array(max * 2);
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos);
    g.setAttribute('iCol', this.iCol);
    g.setAttribute('iVel', this.iVel);
    g.setAttribute('iSize', this.iSize);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: kind === 'add' ? glowSprite(64, 0.12) : smokeSprite(128) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: kind === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = kind === 'add' ? 10 : 9;
  }

  get count() {
    return this.n;
  }

  emit(o: EmitOpts) {
    const count = Math.max(1, Math.round((o.count ?? 1) * this.scale));
    const c0 = new THREE.Color(o.color ?? 0xffffff);
    const c1 = new THREE.Color(o.color2 ?? o.color ?? 0xffffff);
    const k = o.intensity ?? 1;
    c0.multiplyScalar(k);
    c1.multiplyScalar(k);
    const sp = o.speed ?? [0, 0];
    const lf = o.life ?? [0.5, 0.8];
    const sz = o.size ?? [0.2, 0.3];
    const dir = o.dir;
    const cone = o.cone ?? 0;
    for (let c = 0; c < count; c++) {
      if (this.n >= this.max) this.kill(0); // recycle oldest slot
      const i = this.n++;
      const spread = o.spread ?? 0;
      this.p[i * 3] = o.pos.x + (Math.random() - 0.5) * 2 * spread;
      this.p[i * 3 + 1] = o.pos.y + (Math.random() - 0.5) * 2 * spread;
      this.p[i * 3 + 2] = o.pos.z + (Math.random() - 0.5) * 2 * spread;
      // random direction
      let x = Math.random() * 2 - 1;
      let y = Math.random() * 2 - 1;
      let z = Math.random() * 2 - 1;
      let l = Math.hypot(x, y, z) || 1;
      x /= l;
      y /= l;
      z /= l;
      if (dir) {
        if (x * dir.x + y * dir.y + z * dir.z < 0) {
          x = -x;
          y = -y;
          z = -z;
        }
        x = x * (1 - cone) + dir.x * cone;
        y = y * (1 - cone) + dir.y * cone;
        z = z * (1 - cone) + dir.z * cone;
        l = Math.hypot(x, y, z) || 1;
        x /= l;
        y /= l;
        z /= l;
      }
      const s = sp[0] + Math.random() * (sp[1] - sp[0]);
      this.v[i * 3] = x * s + (o.vel?.x ?? 0);
      this.v[i * 3 + 1] = y * s + (o.vel?.y ?? 0);
      this.v[i * 3 + 2] = z * s + (o.vel?.z ?? 0);
      this.life[i] = lf[0] + Math.random() * (lf[1] - lf[0]);
      this.age[i] = 0;
      const s0 = sz[0] + Math.random() * (sz[1] - sz[0]);
      this.size[i * 2] = s0;
      this.size[i * 2 + 1] = s0 * (o.grow ?? 1);
      this.c0[i * 3] = c0.r;
      this.c0[i * 3 + 1] = c0.g;
      this.c0[i * 3 + 2] = c0.b;
      this.c1[i * 3] = c1.r;
      this.c1[i * 3 + 1] = c1.g;
      this.c1[i * 3 + 2] = c1.b;
      this.a[i] = o.alpha ?? 1;
      this.drag[i] = o.drag ?? 0;
      this.grav[i] = o.gravity ?? 0;
      this.stretch[i] = o.stretch ?? 0;
      this.rot[i * 2] = Math.random() * Math.PI * 2;
      this.rot[i * 2 + 1] = (Math.random() - 0.5) * 2 * (o.spin ?? 0);
    }
  }

  private kill(i: number) {
    const j = --this.n;
    if (i === j) return;
    const cp = (arr: Float32Array, k: number) => {
      for (let q = 0; q < k; q++) arr[i * k + q] = arr[j * k + q];
    };
    cp(this.p, 3);
    cp(this.v, 3);
    cp(this.life, 1);
    cp(this.age, 1);
    cp(this.size, 2);
    cp(this.c0, 3);
    cp(this.c1, 3);
    cp(this.a, 1);
    cp(this.drag, 1);
    cp(this.grav, 1);
    cp(this.stretch, 1);
    cp(this.rot, 2);
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(i);
        i--;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= d;
      this.v[i * 3 + 1] = this.v[i * 3 + 1] * d - this.grav[i] * dt;
      this.v[i * 3 + 2] *= d;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.rot[i * 2] += this.rot[i * 2 + 1] * dt;
    }
    const P = this.iPos.array as Float32Array;
    const C = this.iCol.array as Float32Array;
    const V = this.iVel.array as Float32Array;
    const S = this.iSize.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i];
      P[i * 3] = this.p[i * 3];
      P[i * 3 + 1] = this.p[i * 3 + 1];
      P[i * 3 + 2] = this.p[i * 3 + 2];
      // fade in quickly, out smoothly
      const fade = Math.min(1, t * 12) * (1 - t) * (1 - t * 0.3);
      C[i * 4] = this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * t;
      C[i * 4 + 1] = this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * t;
      C[i * 4 + 2] = this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * t;
      C[i * 4 + 3] = this.a[i] * fade;
      const st = this.stretch[i];
      V[i * 3] = this.v[i * 3] * st;
      V[i * 3 + 1] = this.v[i * 3 + 1] * st;
      V[i * 3 + 2] = this.v[i * 3 + 2] * st;
      S[i * 2] = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * t;
      S[i * 2 + 1] = this.rot[i * 2];
    }
    this.geo.instanceCount = this.n;
    if (this.n > 0) {
      this.iPos.needsUpdate = true;
      this.iCol.needsUpdate = true;
      this.iVel.needsUpdate = true;
      this.iSize.needsUpdate = true;
      this.iPos.clearUpdateRanges();
      this.iPos.addUpdateRange(0, this.n * 3);
      this.iCol.clearUpdateRanges();
      this.iCol.addUpdateRange(0, this.n * 4);
      this.iVel.clearUpdateRanges();
      this.iVel.addUpdateRange(0, this.n * 3);
      this.iSize.clearUpdateRanges();
      this.iSize.addUpdateRange(0, this.n * 2);
    }
  }

  clear() {
    this.n = 0;
    this.geo.instanceCount = 0;
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
