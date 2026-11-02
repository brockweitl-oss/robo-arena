// Visual-only effects: geyser steam/droplets, fireflies, drifting petals.
import * as THREE from 'three';
import { glowSprite, smokeSprite } from '../../render/textures';

const pVert = /* glsl */ `
attribute float aSize; attribute float aAlpha; attribute float aRot;
uniform float uScale;
varying float vA; varying float vR;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
  vA = aAlpha; vR = aRot;
}`;
const pFrag = /* glsl */ `
uniform sampler2D map; uniform vec3 color;
varying float vA; varying float vR;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vR), k = cos(vR);
  c = vec2(k*c.x - s*c.y, s*c.x + k*c.y) + 0.5;
  vec4 t = texture2D(map, c);
  float a = t.a * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(color * t.rgb, a);
}`;

const _v = new THREE.Vector2();

/** Simple CPU particle pool rendered as rotated, size-attenuated point sprites. */
export class PointPool {
  readonly points: THREE.Points;
  readonly n: number;
  pos: Float32Array;
  vel: Float32Array;
  age: Float32Array;
  life: Float32Array;
  s0: Float32Array;
  s1: Float32Array;
  a0: Float32Array;
  rot: Float32Array;
  rv: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  private cursor = 0;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  constructor(n: number, tex: THREE.Texture, color: THREE.Color, additive: boolean) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1e9);
    this.life = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.a0 = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.rv = new Float32Array(n);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, 0), 60);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, color: { value: color }, uScale: { value: 800 } },
      vertexShader: pVert,
      fragmentShader: pFrag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.onBeforeRender = (renderer, _s, camera) => {
      renderer.getDrawingBufferSize(_v);
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 55;
      this.mat.uniforms.uScale.value = (_v.y * 0.5) / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    };
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, a0: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.a0[i] = a0;
    this.rot[i] = Math.random() * 6.28;
    this.rv[i] = (Math.random() - 0.5) * 1.5;
  }
  step(dt: number, gravity: number, drag: number) {
    const k = Math.exp(-drag * dt);
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + gravity * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.rot[i] += this.rv[i] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      this.alpha[i] = this.a0[i] * Math.min(1, t * 6) * (1 - t) * (1 - t);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aRot.needsUpdate = true;
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

export interface GeyserTiming {
  pos: THREE.Vector3;
  phase(t: number): number; // seconds since the start of the current cycle, or -1 before the first
  warn: number;
  active: number;
}

/** Steam column, hissing wisps, droplets, glowing grate + floor ring per geyser. */
export class GeyserFX {
  readonly group = new THREE.Group();
  private steam: PointPool;
  private drops: PointPool;
  private acc: number[][];
  private rings: THREE.MeshBasicMaterial[] = [];
  private glows: THREE.MeshBasicMaterial[] = [];
  private lights: (THREE.PointLight | null)[] = [];
  private disposables: { dispose(): void }[] = [];
  constructor(private gs: GeyserTiming[], quality: 'low' | 'medium' | 'high', private radius: number) {
    const per = quality === 'low' ? 70 : quality === 'medium' ? 120 : 160;
    this.steam = new PointPool(per * gs.length, smokeSprite(128), new THREE.Color(0.92, 0.93, 0.96), false);
    this.drops = new PointPool((quality === 'low' ? 30 : 70) * gs.length, glowSprite(64, 0.4), new THREE.Color(1.6, 1.7, 1.9), true);
    this.group.add(this.steam.points, this.drops.points);
    this.acc = gs.map(() => [0, 0, 0]);
    const ringG = new THREE.RingGeometry(radius * 1.02, radius * 1.22, 48);
    ringG.rotateX(-Math.PI / 2);
    const glowG = new THREE.CircleGeometry(radius * 0.92, 32);
    glowG.rotateX(-Math.PI / 2);
    this.disposables.push(ringG, glowG, this.steam, this.drops);
    for (const g of gs) {
      const rm = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.75, 0.16), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 });
      const ring = new THREE.Mesh(ringG, rm);
      ring.position.copy(g.pos).setY(g.pos.y + 0.035);
      ring.renderOrder = 3;
      const gm = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.5, 0.6), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const glow = new THREE.Mesh(glowG, gm);
      glow.position.copy(g.pos).setY(g.pos.y - 0.12);
      this.group.add(ring, glow);
      this.rings.push(rm);
      this.glows.push(gm);
      this.disposables.push(rm, gm);
      this.lights.push(null);
    }
  }
  update(simT: number, dt: number, time: number) {
    const R = this.radius;
    for (let gi = 0; gi < this.gs.length; gi++) {
      const g = this.gs[gi];
      const ph = g.phase(simT);
      const warning = ph >= 0 && ph < g.warn;
      const active = ph >= g.warn && ph < g.warn + g.active;
      const after = ph >= g.warn + g.active && ph < g.warn + g.active + 1.6;
      const a = this.acc[gi];
      // ring + under-grate glow
      let ring = 0, glow = 0.06 + 0.03 * Math.sin(time * 1.3 + gi);
      if (warning) {
        const k = ph / g.warn;
        ring = (0.35 + 0.65 * k) * (0.6 + 0.4 * Math.sin(time * (14 + k * 16)));
        glow = 0.25 + 0.6 * k;
      } else if (active) {
        ring = 1;
        glow = 1;
      } else if (after) {
        const k = 1 - (ph - g.warn - g.active) / 1.6;
        ring = k * k * 0.5;
        glow = 0.06 + k * 0.6;
      }
      this.rings[gi].opacity = ring;
      this.glows[gi].opacity = glow;
      // emission
      const wispRate = warning ? 40 : after ? 18 : 3;
      a[0] += wispRate * dt;
      while (a[0] >= 1) {
        a[0] -= 1;
        const ang = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * R * 0.85;
        const strong = warning || after;
        this.steam.spawn(
          g.pos.x + Math.cos(ang) * rr, g.pos.y + 0.05, g.pos.z + Math.sin(ang) * rr,
          Math.cos(ang) * 0.4, (strong ? 1.6 : 0.6) + Math.random() * 1.4, Math.sin(ang) * 0.4,
          0.8 + Math.random() * 0.9, 0.35, strong ? 1.5 : 1.1, strong ? 0.32 : 0.1,
        );
      }
      if (active) {
        a[1] += 110 * dt;
        while (a[1] >= 1) {
          a[1] -= 1;
          const ang = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * R * 0.5;
          const up = 11 + Math.random() * 9;
          this.steam.spawn(
            g.pos.x + Math.cos(ang) * rr, g.pos.y + 0.1, g.pos.z + Math.sin(ang) * rr,
            Math.cos(ang) * 1.3, up, Math.sin(ang) * 1.3,
            0.9 + Math.random() * 0.8, 0.9, 3.6 + Math.random() * 1.5, 0.6,
          );
        }
        a[2] += 70 * dt;
        while (a[2] >= 1) {
          a[2] -= 1;
          const ang = Math.random() * 6.28, out = 1.5 + Math.random() * 3;
          this.drops.spawn(
            g.pos.x + Math.cos(ang) * 0.3, g.pos.y + 0.3, g.pos.z + Math.sin(ang) * 0.3,
            Math.cos(ang) * out, 7 + Math.random() * 9, Math.sin(ang) * out,
            1.0 + Math.random() * 0.6, 0.11, 0.06, 0.9,
          );
        }
      }
    }
    // steam: buoyant + drag (slows the column so it billows), droplets: gravity
    this.steam.step(dt, 0.6, 1.6);
    this.drops.step(dt, -18, 0.2);
  }
  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

/** Fireflies: wandering additive sparks with a slow blink. */
export class Fireflies {
  readonly pool: PointPool;
  private seeds: Float32Array;
  private anchors: Float32Array;
  constructor(count: number, anchors: THREE.Vector3[], spread: number) {
    this.pool = new PointPool(count, glowSprite(64, 0.3), new THREE.Color(3.4, 2.9, 1.0), true);
    this.seeds = new Float32Array(count * 4);
    this.anchors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = anchors[i % anchors.length];
      this.anchors[i * 3] = a.x + (Math.random() - 0.5) * spread;
      this.anchors[i * 3 + 1] = a.y + Math.random() * 2.5;
      this.anchors[i * 3 + 2] = a.z + (Math.random() - 0.5) * spread;
      for (let k = 0; k < 4; k++) this.seeds[i * 4 + k] = Math.random() * 100;
      this.pool.age[i] = 0;
      this.pool.life[i] = 1e9;
    }
  }
  update(time: number) {
    const p = this.pool;
    for (let i = 0; i < p.n; i++) {
      const s = this.seeds[i * 4], s2 = this.seeds[i * 4 + 1], s3 = this.seeds[i * 4 + 2], s4 = this.seeds[i * 4 + 3];
      p.pos[i * 3] = this.anchors[i * 3] + Math.sin(time * 0.31 + s) * 1.6 + Math.sin(time * 0.77 + s2) * 0.6;
      p.pos[i * 3 + 1] = this.anchors[i * 3 + 1] + Math.sin(time * 0.53 + s3) * 0.7;
      p.pos[i * 3 + 2] = this.anchors[i * 3 + 2] + Math.cos(time * 0.27 + s2) * 1.6 + Math.cos(time * 0.91 + s) * 0.5;
      const blink = Math.max(0, Math.sin(time * (0.9 + (s4 % 1) * 0.8) + s4));
      p.alpha[i] = Math.pow(blink, 3) * 0.95;
      p.size[i] = 0.09 + blink * 0.08;
    }
    const g = p.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
  dispose() {
    this.pool.dispose();
  }
}

/** Drifting blossom petals and a few autumn leaves (instanced, double-sided). */
export class Petals {
  readonly mesh: THREE.InstancedMesh;
  private st: Float32Array;
  private n: number;
  private geo: THREE.BufferGeometry;
  private mat: THREE.MeshStandardMaterial;
  private dummy = new THREE.Object3D();
  constructor(count: number) {
    this.n = count;
    // a small cupped petal
    const g = new THREE.PlaneGeometry(0.12, 0.085, 2, 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.abs(p.getX(i)) * 0.35);
    g.computeVertexNormals();
    this.geo = g;
    this.mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, side: THREE.DoubleSide, emissive: '#3a1420', emissiveIntensity: 0.6 });
    this.mesh = new THREE.InstancedMesh(g, this.mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.st = new Float32Array(count * 8);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      this.reset(i, true);
      const leaf = Math.random() < 0.08;
      c.set(leaf ? (Math.random() < 0.5 ? '#d8743a' : '#c9a040') : Math.random() < 0.5 ? '#ffc2d4' : '#f7a7bf');
      this.mesh.setColorAt(i, c);
    }
  }
  private reset(i: number, anywhere: boolean) {
    const s = this.st;
    s[i * 8] = (Math.random() - 0.5) * 44;
    s[i * 8 + 1] = anywhere ? Math.random() * 12 : 10 + Math.random() * 3;
    s[i * 8 + 2] = (Math.random() - 0.5) * 44;
    s[i * 8 + 3] = 0.5 + Math.random() * 0.6; // fall speed
    s[i * 8 + 4] = Math.random() * 100; // phase
    s[i * 8 + 5] = 0.6 + Math.random() * 1.4; // flutter freq
    s[i * 8 + 6] = Math.random() * 6.28;
    s[i * 8 + 7] = Math.random() * 6.28;
  }
  update(time: number, dt: number) {
    const s = this.st, d = this.dummy;
    const windX = 0.9 + Math.sin(time * 0.13) * 0.4, windZ = 0.25 + Math.sin(time * 0.09 + 1) * 0.3;
    for (let i = 0; i < this.n; i++) {
      const o = i * 8;
      const ph = s[o + 4], f = s[o + 5];
      s[o] += (windX + Math.sin(time * f + ph) * 0.7) * dt;
      s[o + 1] -= s[o + 3] * dt * (0.7 + 0.3 * Math.sin(time * f * 1.3 + ph));
      s[o + 2] += (windZ + Math.cos(time * f * 0.8 + ph) * 0.5) * dt;
      s[o + 6] += dt * f * 2.1;
      s[o + 7] += dt * f * 1.4;
      if (s[o + 1] < 0.02 || s[o] > 24) this.reset(i, false);
      d.position.set(s[o], s[o + 1], s[o + 2]);
      d.rotation.set(s[o + 6], s[o + 7], ph);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
