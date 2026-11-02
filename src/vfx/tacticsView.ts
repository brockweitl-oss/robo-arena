import { landingMaterial } from './combatDetails';
import * as THREE from 'three';
import type { World, Crate, Trap, Pickup, FireZone, Bomb } from '../game/world';
import { CRATE, TRAP, PICKUP } from '../game/tactics';
import { chamferBox, rbox, xf } from '../robot/kit';
import { panelMaps, decalTexture } from '../render/textures';
import type { Effects } from './effects';

/**
 * Visuals for arena tactics: destructible crates, trap pads + switches, pick-ups,
 * napalm fire zones and bomb landing telegraphs.
 * Baseline implementation by Claude; Codex owns visual polish (AGENTS.md V6).
 */

const PICKUP_COLOR = { shield: 0x37e8ff, overdrive: 0xff3b5c, speed: 0x9dff4a };

function stripeTexture() {
  return decalTexture((g, s) => {
    g.fillStyle = '#1b1d22';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#f2b51c';
    for (let i = -s; i < s * 2; i += 48) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 24, 0);
      g.lineTo(i + 24 - s, s);
      g.lineTo(i - s, s);
      g.fill();
    }
  }, 256, 'hazard-stripe');
}

export class TacticsView {
  readonly group = new THREE.Group();
  private crates = new Map<number, THREE.Group>();
  private pads: { trap: Trap; ring: THREE.Mesh; disc: THREE.Mesh; sw: THREE.Group; swCore: THREE.Mesh; column: THREE.Mesh }[] = [];
  private pickups = new Map<number, THREE.Group>();
  private fires = new Map<number, THREE.Mesh>();
  private markers = new Map<number, THREE.Mesh>();
  private crateMat: THREE.MeshStandardMaterial;
  private stripeMat: THREE.MeshStandardMaterial;
  private markerGeo = new THREE.PlaneGeometry(2, 2);
  private time = 0;

  constructor(private world: World, private fx: Effects, scene: THREE.Scene) {
    scene.add(this.group);
    const pm = panelMaps(31, 512, 1);
    this.crateMat = new THREE.MeshStandardMaterial({ color: 0x5a6270, metalness: 0.55, roughness: 0.5, normalMap: pm.normal, roughnessMap: pm.rough, normalScale: new THREE.Vector2(0.15, 0.15) });
    this.stripeMat = new THREE.MeshStandardMaterial({ map: stripeTexture(), metalness: 0.3, roughness: 0.6 });
    for (const c of world.crates) this.makeCrate(c);
    for (const t of world.traps) this.makePad(t);
  }

  private makeCrate(c: Crate) {
    const g = new THREE.Group();
    const s = CRATE.size;
    const body = new THREE.Mesh(chamferBox(s, s, s, 0.12, 0.03), this.crateMat);
    body.position.y = s / 2;
    const band = new THREE.Mesh(xf(rbox(s + 0.03, 0.18, s + 0.03, 0.02), [0, s * 0.72, 0]), this.stripeMat);
    const band2 = new THREE.Mesh(xf(rbox(s + 0.03, 0.18, s + 0.03, 0.02), [0, s * 0.28, 0]), this.stripeMat);
    for (const m of [body, band, band2]) {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    g.position.copy(c.pos);
    g.userData.hp = c.hp;
    this.group.add(g);
    this.crates.set(c.id, g);
  }

  private makePad(trap: Trap) {
    const R = TRAP.radius;
    const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.975, R, 64), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(trap.pos).add(new THREE.Vector3(0, 0.03, 0));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R * 0.9, 48), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.copy(ring.position);
    // switch: floating faceted target on a short mast
    const sw = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 1.2, 8), new THREE.MeshStandardMaterial({ color: 0x2a2d35, metalness: 0.8, roughness: 0.35 }));
    mast.position.y = -0.6;
    const swCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd23a, emissiveIntensity: 3, metalness: 0.4, roughness: 0.3, flatShading: true }));
    sw.add(mast, swCore);
    sw.position.copy(trap.sw);
    // eruption column
    const column = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.85, R, 4, 32, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd23a).multiplyScalar(3), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    column.position.copy(trap.pos).add(new THREE.Vector3(0, 2, 0));
    column.visible = false;
    this.group.add(ring, disc, sw, column);
    this.pads.push({ trap, ring, disc, sw, swCore, column });
  }

  crateHit(c: Crate) {
    const g = this.crates.get(c.id);
    if (g) g.userData.shake = 0.15;
  }

  crateBreak(c: Crate) {
    const g = this.crates.get(c.id);
    if (!g) return;
    const center = c.pos.clone().add(new THREE.Vector3(0, CRATE.size / 2, 0));
    this.fx.panels.burst(center, 0x8b959f, 14, 0.45);
    this.fx.sparks.emit({ pos: center, count: 20, speed: [3, 7], size: [0.04, 0.08], life: [0.2, 0.5], color: 0xffd693, intensity: 2.5, gravity: 10 });
    this.fx.smoke.emit({ pos: center, count: 7, speed: [1, 3], size: [0.3, 0.5], grow: 2, life: [0.4, 0.8], color: 0x5b626a, alpha: 0.3 });
    g.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) mesh.geometry.dispose(); });
    this.group.remove(g);
    this.crates.delete(c.id);
  }

  pickupTaken(p: Pickup) {
    this.fx.burst(p.pos.clone(), PICKUP_COLOR[p.kind], 0.8);
  }

  update(dt: number) {
    this.time += dt;
    const w = this.world;
    // crate hit shake
    for (const [id, g] of this.crates) {
      const c = w.crates.find((x) => x.id === id);
      const sh = (g.userData.shake as number) ?? 0;
      if (sh > 0) {
        g.userData.shake = sh - dt;
        g.position.set(c!.pos.x + (Math.random() - 0.5) * sh, c!.pos.y, c!.pos.z + (Math.random() - 0.5) * sh);
      }
      if (c && sh <= 0) g.position.copy(c.pos);
    }
    // pads & switches
    for (const p of this.pads) {
      const st = w.trapState(p.trap);
      const ready = st === 0 && w.time >= p.trap.readyAt;
      const ringMat = p.ring.material as THREE.MeshBasicMaterial;
      const discMat = p.disc.material as THREE.MeshBasicMaterial;
      const colMat = p.column.material as THREE.MeshBasicMaterial;
      const coreMat = p.swCore.material as THREE.MeshStandardMaterial;
      p.sw.rotation.y += dt * (st === 1 ? 8 : 1.2);
      p.swCore.position.y = Math.sin(this.time * 2) * 0.08;
      if (st === 1) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 30);
        ringMat.color.set(0xff3b3b);
        ringMat.opacity = 0.6 + pulse * 0.4;
        discMat.color.set(0xff3b3b);
        discMat.opacity = 0.04 + pulse * 0.06;
        coreMat.emissive.set(0xff3b3b);
        coreMat.emissiveIntensity = 6;
        p.column.visible = false;
        if (Math.random() < 0.5) this.fx.sparks.emit({ pos: p.trap.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.1, (Math.random() - 0.5) * 3)), count: 1, vel: new THREE.Vector3(0, 3, 0), size: [0.08, 0.12], life: [0.2, 0.4], color: 0xffd23a, intensity: 3 });
      } else if (st === 2) {
        p.column.visible = true;
        colMat.opacity = 0.12 + Math.random() * 0.08;
        p.column.scale.set(1, 1 + Math.random() * 0.2, 1);
        ringMat.opacity = 1;
      } else {
        p.column.visible = false;
        ringMat.color.set(ready ? 0xffd23a : 0x55565c);
        ringMat.opacity = ready ? 0.3 + Math.sin(this.time * 2) * 0.06 : 0.15;
        discMat.opacity = ready ? 0.025 : 0.01;
        coreMat.emissive.set(ready ? 0xffd23a : 0x333333);
        coreMat.emissiveIntensity = ready ? 3 : 0.4;
      }
    }
    // pick-ups
    const seenP = new Set<number>();
    for (const pk of w.pickups) {
      seenP.add(pk.id);
      let g = this.pickups.get(pk.id);
      if (!g) {
        g = new THREE.Group();
        const col = PICKUP_COLOR[pk.kind];
        const core = new THREE.Mesh(pk.kind === 'shield' ? new THREE.IcosahedronGeometry(0.42, 1) : pk.kind === 'overdrive' ? new THREE.OctahedronGeometry(0.48) : new THREE.ConeGeometry(0.3, 0.8, 3), new THREE.MeshStandardMaterial({ color: 0x0b0b0b, emissive: col, emissiveIntensity: 1.8, metalness: 0.2, roughness: 0.2, flatShading: true }));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.018, 6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(3) }));
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.5, 6, 16, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.5), transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.y = 3;
        g.add(core, ring, beam);
        g.position.copy(pk.pos);
        this.group.add(g);
        this.pickups.set(pk.id, g);
        this.fx.burst(pk.pos.clone(), col, 0.6);
      }
      g.rotation.y += dt * 2;
      g.children[1].rotation.x = this.time * 1.7;
      g.position.y = pk.pos.y + Math.sin(this.time * 2.5) * 0.15;
      const left = pk.until - w.time;
      g.visible = left > 3 || Math.floor(this.time * 8) % 2 === 0;
      void PICKUP;
    }
    for (const [id, g] of this.pickups) if (!seenP.has(id)) {
      this.group.remove(g);
      g.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
      this.pickups.delete(id);
    }
    // fire zones
    const seenF = new Set<number>();
    for (const z of w.fires) {
      seenF.add(z.id);
      let m = this.fires.get(z.id);
      if (!m) m = this.makeFire(z);
      const left = z.until - w.time;
      (m.material as THREE.MeshBasicMaterial).opacity = Math.min(0.5, left * 0.5) * (0.8 + Math.random() * 0.2);
      if (Math.random() < 0.9) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * z.radius;
        const p = z.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r));
        this.fx.sparks.emit({ pos: p, count: 2, vel: new THREE.Vector3(0, 2.5, 0), speed: [0, 0.8], size: [0.35, 0.6], grow: 0.4, life: [0.3, 0.6], color: 0xffd27a, color2: z.color, intensity: 2.2 });
        if (Math.random() < 0.2) this.fx.smoke.emit({ pos: p.add(new THREE.Vector3(0, 0.6, 0)), count: 1, vel: new THREE.Vector3(0, 1.5, 0), size: [0.4, 0.6], grow: 2, life: [0.8, 1.2], color: 0x2a2624, alpha: 0.35 });
      }
    }
    for (const [id, m] of this.fires) if (!seenF.has(id)) {
      this.group.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this.fires.delete(id);
    }
    // bomb landing telegraphs
    const seenB = new Set<number>();
    for (const b of w.bombs) {
      seenB.add(b.id);
      let m = this.markers.get(b.id);
      if (!m) m = this.makeMarker(b);
      const flight = b.def.flightTime;
      const k = Math.min(1, b.age / flight);
      const r = b.def.blastRadius;
      m.scale.setScalar(r);
      m.position.set(b.target.x, b.target.y + 0.04, b.target.z);
      (m.material as THREE.ShaderMaterial).uniforms.progress.value = k;
      m.visible = b.def.model !== 'bouncer' || b.bounces === b.def.bounces;
    }
    for (const [id, m] of this.markers) if (!seenB.has(id)) {
      this.group.remove(m);
      (m.material as THREE.Material).dispose();
      this.markers.delete(id);
    }
  }

  private makeFire(z: FireZone) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(z.radius, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(z.color).multiplyScalar(2.5), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(z.pos).add(new THREE.Vector3(0, 0.05, 0));
    this.group.add(m);
    this.fires.set(z.id, m);
    this.fx.scorch(z.pos, z.radius * 2);
    return m;
  }

  private makeMarker(b: Bomb) {
    const m = new THREE.Mesh(this.markerGeo, landingMaterial(b.owner === 1));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 3;
    this.group.add(m);
    this.markers.set(b.id, m);
    return m;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    const geometries = new Set<THREE.BufferGeometry>([this.markerGeo]);
    const materials = new Set<THREE.Material>([this.crateMat, this.stripeMat]);
    this.group.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(mat);
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    this.group.clear(); this.crates.clear(); this.pickups.clear(); this.fires.clear(); this.markers.clear();
  }
}
