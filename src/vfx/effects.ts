import * as THREE from 'three';
import { PoseSnapshot } from './poseSnapshot';
import { ParticleSystem } from './particles';
import { scorchSprite, glowSprite } from '../render/textures';
import type { Projectile, Bomb, Pod } from '../game/world';
import { buildPodMesh } from '../robot/weapons';
import type { RobotModel } from '../robot/model';

const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface Ring {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  r0: number;
  r1: number;
  active: boolean;
}
interface Decal {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  active: boolean;
}
interface Flash {
  light: THREE.PointLight;
  t: number;
  life: number;
  power: number;
}
interface Chunk {
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: THREE.Euler;
  rv: THREE.Vector3;
  s: number;
  t: number;
  life: number;
}
interface Ghost {
  group: THREE.Group;
  snapshot: PoseSnapshot;
  t: number;
  active: boolean;
  mat: THREE.ShaderMaterial;
}

/** Fresnel "hologram" material for dash afterimages. */
function ghostMaterial(color: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.0); gl_FragColor = vec4(uColor * (0.35 + f*2.2) * uAlpha, 1.0); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export class Effects {
  readonly group = new THREE.Group();
  readonly sparks: ParticleSystem;
  readonly smoke: ParticleSystem;
  private rings: Ring[] = [];
  private decals: Decal[] = [];
  private flashes: Flash[] = [];
  private chunks: Chunk[] = [];
  private chunkMesh: THREE.InstancedMesh;
  private projViews = new Map<number, { core: THREE.Mesh; halo: THREE.Sprite; last: THREE.Vector3 }>();
  private projPool: { core: THREE.Mesh; halo: THREE.Sprite }[] = [];
  private bombViews = new Map<number, THREE.Group>();
  private podViews = new Map<number, { g: THREE.Group; light: THREE.Mesh }>();
  private ghosts = new Map<RobotModel, Ghost[]>();
  private coreGeo = new THREE.SphereGeometry(1, 12, 8);
  private coreMats = new Map<number, THREE.MeshBasicMaterial>();
  private haloMats = new Map<number, THREE.SpriteMaterial>();
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48, 1);
  private time = 0;
  /** Projectiles currently simulated (for trail emission). */
  scale = 1;

  constructor(private scene: THREE.Scene, quality: 'low' | 'medium' | 'high') {
    const q = quality === 'low' ? 0.5 : quality === 'medium' ? 0.8 : 1;
    this.scale = q;
    this.sparks = new ParticleSystem(Math.round(4000 * q), 'add');
    this.smoke = new ParticleSystem(Math.round(900 * q), 'smoke');
    this.sparks.scale = q;
    this.smoke.scale = Math.max(0.6, q);
    this.group.add(this.sparks.mesh, this.smoke.mesh);
    scene.add(this.group);

    // shockwave rings
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(
        this.ringGeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      m.visible = false;
      m.renderOrder = 8;
      this.group.add(m);
      this.rings.push({ mesh: m, t: 0, life: 1, r0: 0, r1: 1, active: false });
    }
    // scorch decals
    const scorch = scorchSprite(256);
    const dGeo = new THREE.PlaneGeometry(1, 1);
    dGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(
        dGeo,
        new THREE.MeshBasicMaterial({ map: scorch, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, color: 0x000000 }),
      );
      m.visible = false;
      m.renderOrder = 2;
      this.group.add(m);
      this.decals.push({ mesh: m, t: 0, life: 1, active: false });
    }
    // light pool (fixed count avoids shader recompiles)
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 14, 2);
      this.group.add(l);
      this.flashes.push({ light: l, t: 1, life: 1, power: 0 });
    }
    // debris chunks
    const cg = new THREE.DodecahedronGeometry(0.09, 0);
    const cm = new THREE.MeshStandardMaterial({ color: 0x2a2c31, metalness: 0.6, roughness: 0.5, emissive: 0xff5a1a, emissiveIntensity: 0.6 });
    this.chunkMesh = new THREE.InstancedMesh(cg, cm, 160);
    this.chunkMesh.count = 0;
    this.chunkMesh.castShadow = false;
    this.chunkMesh.frustumCulled = false;
    this.group.add(this.chunkMesh);
  }

  private coreMat(color: number) {
    let m = this.coreMats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(6), toneMapped: true });
      this.coreMats.set(color, m);
    }
    return m;
  }
  private haloMat(color: number) {
    let m = this.haloMats.get(color);
    if (!m) {
      m = new THREE.SpriteMaterial({ map: glowSprite(64, 0.2), color: new THREE.Color(color).multiplyScalar(2.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      this.haloMats.set(color, m);
    }
    return m;
  }

  /* --------------------------------------------------------------- primitives */

  lightFlash(pos: THREE.Vector3, color: number, power: number, life: number) {
    let f = this.flashes[0];
    for (const x of this.flashes) if (x.t / x.life > f.t / f.life) f = x;
    f.light.position.copy(pos);
    f.light.color.set(color);
    f.t = 0;
    f.life = life;
    f.power = power;
  }

  ring(pos: THREE.Vector3, normal: THREE.Vector3, color: number, r0: number, r1: number, life: number, opacity = 1) {
    const r = this.rings.find((x) => !x.active) ?? this.rings[0];
    r.active = true;
    r.t = 0;
    r.life = life;
    r.r0 = r0;
    r.r1 = r1;
    r.mesh.visible = true;
    r.mesh.position.copy(pos);
    r.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const m = r.mesh.material as THREE.MeshBasicMaterial;
    m.color.set(color).multiplyScalar(3);
    m.userData.opacity = opacity;
  }

  scorch(pos: THREE.Vector3, size: number) {
    const d = this.decals.find((x) => !x.active) ?? this.decals.reduce((a, b) => (a.t > b.t ? a : b));
    d.active = true;
    d.t = 0;
    d.life = 9;
    d.mesh.visible = true;
    d.mesh.position.set(pos.x, pos.y + 0.025, pos.z);
    d.mesh.rotation.set(0, Math.random() * Math.PI * 2, 0);
    d.mesh.scale.setScalar(size);
  }

  debris(pos: THREE.Vector3, n: number, speed: number) {
    const count = Math.round(n * this.scale);
    for (let i = 0; i < count; i++) {
      if (this.chunks.length >= 160) this.chunks.shift();
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.5 + Math.random() * 0.7);
      this.chunks.push({
        p: pos.clone(),
        v: new THREE.Vector3(Math.cos(a) * s * 0.6, s * (0.6 + Math.random() * 0.6), Math.sin(a) * s * 0.6),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0),
        rv: new THREE.Vector3(Math.random() * 20 - 10, Math.random() * 20 - 10, 0),
        s: 0.6 + Math.random() * 1.1,
        t: 0,
        life: 1.2 + Math.random() * 0.8,
      });
    }
  }

  /* --------------------------------------------------------------- composite effects */

  muzzle(pos: THREE.Vector3, dir: THREE.Vector3, color: number, big = false) {
    const k = big ? 1.8 : 1;
    this.sparks.emit({ pos, count: 1, size: [0.55 * k, 0.6 * k], life: [0.06, 0.08], color: 0xffffff, color2: color, intensity: 3 });
    this.sparks.emit({ pos, count: 1, size: [0.9 * k, 1.0 * k], life: [0.08, 0.1], color, intensity: 2.2 });
    this.sparks.emit({ pos, count: big ? 14 : 6, dir, cone: 0.75, speed: [6, 16], size: [0.05, 0.08], life: [0.08, 0.18], color: 0xffffff, color2: color, intensity: 3, stretch: 0.03, drag: 4 });
    this.lightFlash(pos, color, big ? 30 : 12, 0.08);
  }

  impact(pos: THREE.Vector3, normal: THREE.Vector3, color: number, scale = 1) {
    this.sparks.emit({ pos, count: 1, size: [1.1 * scale, 1.3 * scale], life: [0.07, 0.1], color: 0xffffff, color2: color, intensity: 3 });
    this.sparks.emit({ pos, count: Math.round(14 * scale), dir: normal, cone: 0.35, speed: [5, 14], size: [0.05, 0.08], life: [0.2, 0.45], color: 0xfff2c0, color2: color, intensity: 3, stretch: 0.035, drag: 2, gravity: 14 });
    this.sparks.emit({ pos, count: 5, dir: normal, cone: 0.2, speed: [0.5, 2], size: [0.4, 0.6], grow: 1.8, life: [0.15, 0.25], color, intensity: 1.2 });
    this.smoke.emit({ pos, count: 2, dir: normal, speed: [0.3, 1], size: [0.4, 0.6], grow: 2.2, life: [0.5, 0.9], color: 0x6a6a70, alpha: 0.35, drag: 2, gravity: -0.6, spin: 1 });
    this.ring(pos.clone().addScaledVector(normal, 0.03), normal, color, 0.1, 0.8 * scale, 0.22, 0.8);
    this.lightFlash(pos, color, 8 * scale, 0.1);
    if (normal.y > 0.7) this.scorch(pos, 0.7 * scale);
  }

  hitSpark(pos: THREE.Vector3, dir: THREE.Vector3, color: number, heavy: boolean) {
    const k = heavy ? 1.7 : 1;
    this.sparks.emit({ pos, count: 1, size: [1.6 * k, 1.9 * k], life: [0.06, 0.09], color: 0xffffff, intensity: 4 });
    this.sparks.emit({ pos, count: Math.round(18 * k), dir, cone: 0.45, speed: [6, 18 * k], size: [0.05, 0.09], life: [0.2, 0.5], color: 0xffffff, color2: 0xffa040, intensity: 3.5, stretch: 0.04, drag: 2, gravity: 16 });
    this.sparks.emit({ pos, count: 6, speed: [1, 3], size: [0.35, 0.55], grow: 2, life: [0.12, 0.2], color, intensity: 2 });
    this.ring(pos, dir.clone().negate(), 0xffffff, 0.2, heavy ? 2.2 : 1.2, heavy ? 0.28 : 0.18, 0.9);
    this.lightFlash(pos, 0xfff0d0, heavy ? 30 : 14, 0.12);
    if (heavy) this.debris(pos, 4, 6);
  }

  explosion(pos: THREE.Vector3, radius: number, color: number, big: boolean, onGround: boolean) {
    const k = radius / 3;
    // 1) white-hot flash
    this.sparks.emit({ pos, count: 1, size: [radius * 1.5, radius * 1.8], life: [0.07, 0.1], color: 0xffffff, intensity: 2.5 });
    // 2) fireball: many overlapping additive puffs, color ramps from hot to deep
    this.sparks.emit({ pos, count: Math.round(26 * k), spread: radius * 0.25, speed: [1.5, 5.5 * k], size: [radius * 0.32, radius * 0.5], grow: 1.6, life: [0.25, 0.5], color: 0xffc060, color2: color, intensity: 1.5, drag: 4, gravity: -3, spin: 2 });
    // 3) smoke column
    this.smoke.emit({ pos, count: Math.round(14 * k), spread: radius * 0.3, speed: [1, 3.5 * k], size: [radius * 0.35, radius * 0.55], grow: 2.2, life: [1.0, 1.9], color: 0x2a2624, color2: 0x55504c, alpha: 0.5, drag: 2.5, gravity: -1.6, spin: 0.8 });
    // 4) sparks/embers
    this.sparks.emit({ pos, count: Math.round(40 * k), speed: [8, 20 * k], size: [0.06, 0.1], life: [0.4, 1.0], color: 0xfff0b0, color2: 0xff5a1a, intensity: 3.5, stretch: 0.03, drag: 1.2, gravity: 18 });
    // 5) shockwave ring(s)
    const n = onGround ? UP : new THREE.Vector3(0, 1, 0);
    this.ring(pos.clone().add(new THREE.Vector3(0, 0.08, 0)), n, color, 0.3, radius * 1.6, 0.35, 1);
    if (big) this.ring(pos.clone().add(new THREE.Vector3(0, 0.1, 0)), n, 0xffffff, 0.2, radius * 2.4, 0.5, 0.6);
    // 6) debris + light pulse + scorch
    this.debris(pos, big ? 14 : 8, big ? 11 : 8);
    this.lightFlash(pos.clone().add(new THREE.Vector3(0, 0.8, 0)), color, big ? 90 : 55, big ? 0.45 : 0.3);
    if (onGround) this.scorch(pos, radius * 1.3);
    // ground dust ring
    if (onGround) this.dustRing(pos, radius * 0.9, 16);
  }

  dustRing(pos: THREE.Vector3, r: number, n: number, color = 0x8a8478) {
    for (let i = 0; i < Math.round(n * Math.max(0.6, this.scale)); i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const d = new THREE.Vector3(Math.cos(a), 0.12, Math.sin(a));
      this.smoke.emit({ pos: pos.clone().addScaledVector(d, r * 0.25).setY(pos.y + 0.15), vel: d.clone().multiplyScalar(r * 3.2), count: 1, size: [0.35, 0.55], grow: 2.6, life: [0.45, 0.8], color, alpha: 0.42, drag: 5, gravity: -0.5, spin: 1 });
    }
  }

  footDust(pos: THREE.Vector3, strength = 1) {
    this.smoke.emit({ pos: pos.clone().setY(pos.y + 0.08), count: 2, speed: [0.3, 1.0], dir: UP, cone: 0.2, size: [0.18, 0.28], grow: 2.2, life: [0.35, 0.55], color: 0x8a8478, alpha: 0.28 * strength, drag: 4 });
  }

  knockdownBurst(pos: THREE.Vector3, color: number) {
    this.sparks.emit({ pos, count: 1, size: [5, 6], life: [0.12, 0.15], color: 0xffffff, intensity: 3 });
    this.sparks.emit({ pos, count: 50, speed: [8, 22], size: [0.07, 0.12], life: [0.4, 0.9], color: 0xffffff, color2: color, intensity: 3.5, stretch: 0.04, drag: 1.5, gravity: 10 });
    this.ring(pos, UP, color, 0.4, 5, 0.45, 1);
    this.ring(pos, new THREE.Vector3(0, 0.3, 1).normalize(), 0xffffff, 0.2, 3.5, 0.3, 0.8);
    this.lightFlash(pos, color, 80, 0.4);
    this.debris(pos, 10, 9);
  }

  thrusterPuff(pos: THREE.Vector3, color: number, dir: THREE.Vector3, k = 1) {
    this.sparks.emit({ pos, count: 1, vel: dir.clone().multiplyScalar(6 * k), speed: [0, 1.5], size: [0.12, 0.2], grow: 0.3, life: [0.12, 0.22], color: 0xffffff, color2: color, intensity: 2.5, drag: 3 });
  }

  dashBurst(pos: THREE.Vector3, dir: THREE.Vector3, color: number, ground: boolean) {
    const back = dir.clone().negate();
    this.sparks.emit({ pos, count: 14, dir: back, cone: 0.7, speed: [6, 14], size: [0.06, 0.1], life: [0.15, 0.3], color: 0xffffff, color2: color, intensity: 3, stretch: 0.04, drag: 3 });
    this.ring(pos.clone().addScaledVector(dir, -0.3), dir, color, 0.2, 1.6, 0.22, 0.9);
    if (ground) this.dustRing(pos, 1, 10);
  }

  /** Speed streak particles along a dash. */
  dashTrail(pos: THREE.Vector3, vel: THREE.Vector3, color: number) {
    this.sparks.emit({ pos: pos.clone().add(new THREE.Vector3(0, 1 + Math.random() * 0.6, 0)), spread: 0.35, count: 2, vel: vel.clone().multiplyScalar(-0.12), size: [0.04, 0.06], life: [0.12, 0.2], color: 0xffffff, color2: color, intensity: 2.5, stretch: 0.12 });
  }

  /** Burst of light when a pod/bomb pops out, or capsule opens. */
  burst(pos: THREE.Vector3, color: number, size = 1) {
    this.sparks.emit({ pos, count: 1, size: [2.5 * size, 3 * size], life: [0.1, 0.14], color: 0xffffff, intensity: 3 });
    this.sparks.emit({ pos, count: Math.round(36 * size), speed: [4, 12 * size], size: [0.06, 0.12], life: [0.3, 0.7], color: 0xffffff, color2: color, intensity: 3, stretch: 0.03, drag: 2, gravity: 6 });
    this.ring(pos, UP, color, 0.3, 4 * size, 0.4, 1);
    this.lightFlash(pos, color, 60 * size, 0.35);
  }

  /** Dodge (near miss) flourish. */
  dodgeFlash(pos: THREE.Vector3, color: number) {
    this.ring(pos, new THREE.Vector3(0, 0.2, 1).normalize(), color, 0.5, 2.2, 0.3, 0.9);
    this.sparks.emit({ pos, count: 10, speed: [2, 6], size: [0.08, 0.12], life: [0.25, 0.4], color: 0xffffff, color2: color, intensity: 2.6, drag: 3 });
  }

  /* --------------------------------------------------------------- live entities */

  syncProjectiles(list: Projectile[], dt: number) {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let v = this.projViews.get(p.id);
      if (!v) {
        const pooled = this.projPool.pop() ?? {
          core: new THREE.Mesh(this.coreGeo, this.coreMat(p.spec.color)),
          halo: new THREE.Sprite(this.haloMat(p.spec.color)),
        };
        pooled.core.material = this.coreMat(p.spec.coreColor ?? 0xffffff);
        pooled.halo.material = this.haloMat(p.spec.color);
        pooled.core.visible = pooled.halo.visible = true;
        this.group.add(pooled.core, pooled.halo);
        v = { ...pooled, last: p.pos.clone() };
        this.projViews.set(p.id, v);
      }
      const r = p.spec.radius;
      v.core.position.copy(p.pos);
      // stretch along velocity
      const sp = p.vel.length();
      v.core.scale.set(r * 0.55, r * 0.55, r * 0.55 + sp * 0.012);
      _v.copy(p.pos).add(p.vel);
      v.core.lookAt(_v);
      v.halo.position.copy(p.pos);
      v.halo.scale.setScalar(r * 6);
      // trail particles along the path since last frame
      const dist = v.last.distanceTo(p.pos);
      const steps = Math.min(6, Math.ceil(dist / 0.35));
      for (let i = 0; i < steps; i++) {
        _v.copy(v.last).lerp(p.pos, (i + 1) / steps);
        this.sparks.emit({ pos: _v, count: 1, size: [r * 1.6, r * 2.0], grow: 0.15, life: [0.12, 0.2], color: p.spec.color, intensity: 1.8, speed: [0, 0.4] });
      }
      v.last.copy(p.pos);
    }
    for (const [id, v] of this.projViews) {
      if (seen.has(id)) continue;
      v.core.visible = v.halo.visible = false;
      this.group.remove(v.core, v.halo);
      this.projPool.push({ core: v.core, halo: v.halo });
      this.projViews.delete(id);
    }
    void dt;
  }

  syncBombs(list: Bomb[], dt: number) {
    const seen = new Set<number>();
    for (const b of list) {
      seen.add(b.id);
      let g = this.bombViews.get(b.id);
      if (!g) {
        g = this.makeBomb(b.def.color, b.def.model === 'cluster' ? 0.13 : 0.2);
        this.group.add(g);
        this.bombViews.set(b.id, g);
      }
      g.position.copy(b.pos);
      g.rotation.x += b.spin.x * dt;
      g.rotation.y += b.spin.y * dt;
      const blink = (Math.sin(b.age * 30) > 0 ? 1 : 0.2) * 6;
      ((g.children[2] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(b.def.color).multiplyScalar(blink);
      if (Math.random() < 0.9) this.smoke.emit({ pos: b.pos, count: 1, size: [0.18, 0.26], grow: 2.4, life: [0.4, 0.7], color: 0x8a8580, alpha: 0.35, drag: 1.5, gravity: -0.5 });
      this.sparks.emit({ pos: b.pos, count: 1, size: [0.25, 0.35], life: [0.08, 0.14], color: b.def.color, intensity: 2 });
    }
    for (const [id, g] of this.bombViews) {
      if (seen.has(id)) continue;
      this.group.remove(g);
      ((g.children[2] as THREE.Mesh).material as THREE.Material).dispose();
      this.bombViews.delete(id);
    }
  }

  // Shared bomb geometry (unit radius, scaled per bomb) and per-color materials: no per-shot allocations.
  private bombGeo = { shell: new THREE.SphereGeometry(1, 16, 12), band: new THREE.TorusGeometry(1, 0.18, 8, 20), lamp: new THREE.SphereGeometry(0.32, 10, 8) };
  private bombShellMat = new THREE.MeshStandardMaterial({ color: 0x2b2d33, metalness: 0.7, roughness: 0.35 });
  private bombBandMats = new Map<number, THREE.MeshStandardMaterial>();

  private makeBomb(color: number, r: number) {
    const g = new THREE.Group();
    let bandMat = this.bombBandMats.get(color);
    if (!bandMat) this.bombBandMats.set(color, (bandMat = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.3 })));
    const shell = new THREE.Mesh(this.bombGeo.shell, this.bombShellMat);
    const band = new THREE.Mesh(this.bombGeo.band, bandMat);
    // the lamp material is animated per bomb, so it is owned by the bomb (no geometry allocation)
    const lamp = new THREE.Mesh(this.bombGeo.lamp, new THREE.MeshBasicMaterial({ color }));
    lamp.position.y = 0.9;
    g.scale.setScalar(r);
    shell.castShadow = true;
    g.add(shell, band, lamp);
    return g;
  }

  syncPods(list: Pod[], dt: number) {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let v = this.podViews.get(p.id);
      if (!v) {
        const g = buildPodMesh(p.def, null, 1.15);
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: p.def.color }));
        light.position.y = 0.16;
        g.add(light);
        this.group.add(g);
        v = { g, light };
        this.podViews.set(p.id, v);
        this.burst(p.pos, p.def.color, 0.35);
      }
      v.g.position.copy(p.pos);
      v.g.rotation.y = p.heading;
      if (p.def.model === 'mine') v.g.rotation.x += dt * 2;
      const trig = p.triggeredAt >= 0;
      const rate = trig ? 40 : 8;
      (v.light.material as THREE.MeshBasicMaterial).color.set(trig ? 0xffffff : p.def.color).multiplyScalar(Math.sin(p.age * rate) > 0 ? 7 : 1);
      if (trig) v.g.scale.setScalar(1.15 + Math.sin(p.age * 50) * 0.1);
      // small engine glow trail
      _v.set(-Math.sin(p.heading) * 0.2, 0, -Math.cos(p.heading) * 0.2).add(p.pos);
      this.sparks.emit({ pos: _v, count: 1, size: [0.12, 0.18], life: [0.1, 0.2], color: p.def.color, intensity: 2, speed: [0, 0.4] });
    }
    for (const [id, v] of this.podViews) {
      if (seen.has(id)) continue;
      this.group.remove(v.g);
      Effects.disposeGeometries(v.g);
      (v.light.material as THREE.Material).dispose();
      this.podViews.delete(id);
    }
  }

  /** Dispose geometries under a group (materials are shared/cached elsewhere). */
  static disposeGeometries(o: THREE.Object3D) {
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }

  /* --------------------------------------------------------------- dash afterimages */

  registerRobot(model: RobotModel, color: number) {
    const list: Ghost[] = [];
    for (let i = 0; i < 4; i++) {
      const mat = ghostMaterial(color);
      const group = new THREE.Group();
      const snapshot = new PoseSnapshot(model.meshes.filter(src => src.material !== model.mats.decal), mat);
      group.add(snapshot);
      group.visible = false;
      this.group.add(group);
      list.push({ group, snapshot, t: 0, active: false, mat });
    }
    this.ghosts.set(model, list);
  }

  afterimage(model: RobotModel) {
    const list = this.ghosts.get(model);
    if (!list) return;
    const g = list.find((x) => !x.active) ?? list.reduce((a, b) => (a.t > b.t ? a : b));
    model.root.updateMatrixWorld(true);
    g.snapshot.capture();
    g.t = 0;
    g.active = true;
    g.group.visible = true;
  }

  /* --------------------------------------------------------------- update */

  update(dt: number) {
    this.time += dt;
    this.sparks.update(dt);
    this.smoke.update(dt);
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const t = r.t / r.life;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - t, 3);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      { const mm = r.mesh.material as THREE.MeshBasicMaterial; mm.opacity = (1 - t) * (1 - t) * (mm.userData.opacity ?? 1); }
    }
    for (const d of this.decals) {
      if (!d.active) continue;
      d.t += dt;
      const t = d.t / d.life;
      if (t >= 1) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      (d.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, d.t * 8) * (1 - t * t) * 0.85;
    }
    for (const f of this.flashes) {
      f.t += dt;
      const t = Math.min(1, f.t / f.life);
      f.light.intensity = f.power * (1 - t) * (1 - t);
    }
    // debris
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let n = 0;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.t += dt;
      if (c.t > c.life) {
        this.chunks.splice(i, 1);
        continue;
      }
      c.v.y -= 22 * dt;
      c.p.addScaledVector(c.v, dt);
      if (c.p.y < 0.05 && c.v.y < 0) {
        c.p.y = 0.05;
        c.v.y *= -0.35;
        c.v.x *= 0.6;
        c.v.z *= 0.6;
      }
      c.r.x += c.rv.x * dt;
      c.r.y += c.rv.y * dt;
      q.setFromEuler(c.r);
      const sc = c.s * Math.min(1, (c.life - c.t) * 3);
      s.setScalar(sc);
      m.compose(c.p, q, s);
      this.chunkMesh.setMatrixAt(n++, m);
      if (Math.random() < 0.3 && c.t < 0.6) this.smoke.emit({ pos: c.p, count: 1, size: [0.08, 0.12], grow: 2, life: [0.3, 0.5], color: 0x555050, alpha: 0.3 });
    }
    this.chunkMesh.count = n;
    if (n) this.chunkMesh.instanceMatrix.needsUpdate = true;
    // ghosts
    for (const list of this.ghosts.values()) {
      for (const g of list) {
        if (!g.active) continue;
        g.t += dt;
        const a = 1 - g.t / 0.28;
        if (a <= 0) {
          g.active = false;
          g.group.visible = false;
          continue;
        }
        g.mat.uniforms.uAlpha.value = a * a * 0.8;
      }
    }
  }

  clear() {
    this.sparks.clear();
    this.smoke.clear();
    for (const [, v] of this.projViews) this.group.remove(v.core, v.halo);
    this.projViews.clear();
    for (const [, g] of this.bombViews) this.group.remove(g);
    this.bombViews.clear();
    for (const [, v] of this.podViews) this.group.remove(v.g);
    this.podViews.clear();
  }

  dispose() {
    this.clear();
    this.sparks.dispose();
    this.smoke.dispose();
    this.scene.remove(this.group);
    for (const m of this.coreMats.values()) m.dispose();
    for (const m of this.haloMats.values()) m.dispose();
    for (const list of this.ghosts.values()) for (const g of list) { g.mat.dispose(); g.snapshot.geometry.dispose(); }
    this.chunkMesh.dispose();
  }
}
