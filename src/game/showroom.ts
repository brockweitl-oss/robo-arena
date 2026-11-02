import * as THREE from 'three';
import { RobotModel } from '../robot/model';
import { Animator, type AnimSource } from '../robot/animator';
import { resolveLoadout, type Loadout } from '../data/parts';
import { PLAYER_PAINT, rivalById, type Paint } from '../data/characters';
import { studioEnvironment, tileMaps, glowSprite } from '../render/textures';
import { ParticleSystem } from '../vfx/particles';

type Kind = 'title' | 'garage' | 'versus' | 'none';

interface Bot {
  key: string;
  model: RobotModel;
  anim: Animator;
  src: AnimSource;
}

function mkSrc(): AnimSource {
  return {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, grounded: true, mode: 'showcase', modeTime: 0, chargePhase: 0,
    hovering: false, aimTarget: null, aimWeight: 0, railCharge: 0, dashDir: new THREE.Vector3(0, 0, 1),
  };
}

/**
 * Menu backdrop scene: a lit showroom stage with the player's robot (and a rival for versus).
 */
export class Showroom {
  readonly scene = new THREE.Scene();
  private bots: Bot[] = [];
  private kind: Kind = 'none';
  private t = 0;
  private yaw = 0.5;
  private yawTarget = 0.5;
  private rect: { x: number; y: number; w: number; h: number } | null = null;
  private focus: string | null = null;
  private camPos = new THREE.Vector3(0, 1.6, 5.5);
  private camLook = new THREE.Vector3(0, 1, 0);
  private dust: ParticleSystem;
  private ring: THREE.Mesh;
  private rimL: THREE.SpotLight;
  private rimR: THREE.SpotLight;

  constructor(renderer: THREE.WebGLRenderer) {
    const s = this.scene;
    s.background = new THREE.Color(0x0c0f15);
    s.environment = studioEnvironment(renderer, { intensity: 1 });
    s.fog = new THREE.Fog(0x0c0f15, 9, 26);
    const key = new THREE.DirectionalLight(0xfff0dc, 3.4);
    key.position.set(4, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -5;
    sc.right = sc.top = 5;
    key.shadow.normalBias = 0.02;
    this.rimL = new THREE.SpotLight(0xff6a1f, 60, 20, 0.5, 0.6);
    this.rimL.position.set(-5, 4, -4);
    this.rimR = new THREE.SpotLight(0x37e8ff, 60, 20, 0.5, 0.6);
    this.rimR.position.set(5, 4, -4);
    s.add(key, this.rimL, this.rimR, this.rimL.target, this.rimR.target, new THREE.HemisphereLight(0x8899bb, 0x15161a, 0.5));
    // stage: textured pedestal disc with glowing rim
    const t = tileMaps({ base: '#23272f', alt: '#1f232a', tiles: 6, size: 1024, line: '#121418' });
    t.map.repeat.set(3, 3);
    t.normal.repeat.set(3, 3);
    t.rough.repeat.set(3, 3);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughnessMap: t.rough, metalness: 0.5, roughness: 0.6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.85, 0.22, 64), new THREE.MeshStandardMaterial({ color: 0x2c313b, metalness: 0.8, roughness: 0.3 }));
    ped.position.y = 0.11;
    ped.receiveShadow = true;
    ped.castShadow = true;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.78, 0.025, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a1f).multiplyScalar(4) }));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.2;
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: glowSprite(128, 0.05), color: 0x1d4a66, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.set(0, 3, -6);
    s.add(floor, ped, this.ring, halo);
    this.dust = new ParticleSystem(300, 'add');
    s.add(this.dust.mesh);
  }

  private makeBot(lo: Loadout, paint: Paint): Bot {
    const key = JSON.stringify(lo) + JSON.stringify(paint);
    const model = new RobotModel(resolveLoadout(lo), paint);
    const anim = new Animator(model);
    this.scene.add(model.root);
    return { key, model, anim, src: mkSrc() };
  }

  set(kind: Kind, opts: { loadout?: Loadout; paint?: Paint; rivalId?: string; previewRect?: { x: number; y: number; w: number; h: number } } = {}) {
    const wanted: { lo: Loadout; paint: Paint }[] = [];
    if (kind !== 'none' && opts.loadout) wanted.push({ lo: opts.loadout, paint: opts.paint ?? PLAYER_PAINT });
    if (kind === 'versus' && opts.rivalId) {
      const r = rivalById(opts.rivalId);
      wanted.push({ lo: r.loadout, paint: r.paint });
    }
    // rebuild only what changed
    const next: Bot[] = [];
    wanted.forEach((w, i) => {
      const key = JSON.stringify(w.lo) + JSON.stringify(w.paint);
      const cur = this.bots[i];
      if (cur && cur.key === key) next.push(cur);
      else {
        if (cur) this.removeBot(cur);
        const b = this.makeBot(w.lo, w.paint);
        b.anim.event({ type: 'land', strength: 0.6 });
        next.push(b);
      }
    });
    for (let i = wanted.length; i < this.bots.length; i++) this.removeBot(this.bots[i]);
    this.bots = next;
    if (kind !== this.kind) {
      this.t = 0;
      if (kind === 'garage') this.yaw = this.yawTarget = 0.45;
    }
    this.kind = kind;
    this.rect = opts.previewRect ?? null;
    if (kind === 'versus' && this.bots.length === 2) {
      this.bots[0].src.pos.set(-1.4, 0, 0);
      this.bots[0].src.yaw = 0.55;
      this.bots[1].src.pos.set(1.4, 0, 0);
      this.bots[1].src.yaw = -0.55;
    } else if (this.bots[0]) {
      this.bots[0].src.pos.set(0, 0.22, 0);
    }
  }

  private removeBot(b: Bot) {
    this.scene.remove(b.model.root);
    b.model.dispose();
  }

  rotate(d: number) {
    this.yawTarget += d;
  }

  setFocus(slot: string | null) {
    this.focus = slot;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, viewW: number, viewH: number) {
    this.t += dt;
    const t = this.t;
    if (Math.random() < 0.5) {
      this.dust.emit({ pos: new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 0.5, (Math.random() - 0.5) * 6), vel: new THREE.Vector3(0, 0.25, 0), count: 1, size: [0.03, 0.05], life: [3, 6], color: Math.random() < 0.5 ? 0xff8a4a : 0x6ad8ff, intensity: 1.4, drag: 0.1 });
    }
    this.dust.update(dt);
    this.yaw += (this.yawTarget - this.yaw) * Math.min(1, dt * 8);
    (this.ring.material as THREE.MeshBasicMaterial).color.setScalar(0).add(new THREE.Color(0xff6a1f).multiplyScalar(3 + Math.sin(t * 2) * 1));
    this.ring.visible = this.kind !== 'versus';
    for (const b of this.bots) {
      if (this.kind === 'title') b.src.yaw = 0.35 + Math.sin(t * 0.25) * 0.2;
      else if (this.kind === 'garage') b.src.yaw = this.yaw;
      b.src.modeTime = t;
      b.src.mode = 'showcase';
      b.src.aimTarget = this.kind === 'versus' ? (b === this.bots[0] ? this.bots[1]?.src.pos.clone().setY(1.3) ?? null : this.bots[0].src.pos.clone().setY(1.3)) : null;
      b.src.aimWeight = 0;
      b.anim.update(b.src, dt);
      b.model.update(t, dt);
    }
    // camera
    camera.clearViewOffset();
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.kind === 'title') {
      const a = t * 0.12 + 0.6;
      pos = new THREE.Vector3(Math.sin(a) * 5.8, 1.5 + Math.sin(t * 0.3) * 0.25, Math.cos(a) * 5.8);
      look = new THREE.Vector3(0, 1.05, 0);
      // frame the robot in the right third, clear of the centered logo
      camera.setViewOffset(viewW, viewH, -viewW * 0.27, viewH * 0.02, viewW, viewH);
    } else if (this.kind === 'garage') {
      const focusOff: Record<string, [number, number, number]> = {
        gun: [-0.6, 1.1, 0.3], bomb: [0.4, 1.8, 0], pod: [0, 1.7, -0.3], body: [0, 1.4, 0], legs: [0, 0.6, 0],
      };
      const f = this.focus ? focusOff[this.focus] : null;
      look = f ? new THREE.Vector3(f[0] * 0.35, f[1] * 0.4 + 0.65, 0) : new THREE.Vector3(0, 1.15, 0);
      pos = new THREE.Vector3(0, 1.45, f ? 4.9 : 5.6);
      // shift the projection so the robot appears centered in the preview rect
      if (this.rect && this.rect.w > 10) {
        const cx = this.rect.x + this.rect.w / 2;
        const cy = this.rect.y + this.rect.h / 2;
        camera.setViewOffset(viewW, viewH, viewW / 2 - cx, viewH / 2 - cy, viewW, viewH);
      }
    } else {
      pos = new THREE.Vector3(0, 1.5, 5.6);
      look = new THREE.Vector3(0, 1.1, 0);
    }
    if (t < 0.05) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
    }
    this.camPos.lerp(pos, 1 - Math.exp(-dt * 4));
    this.camLook.lerp(look, 1 - Math.exp(-dt * 4));
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
    if (camera.fov !== 40) {
      camera.fov = 40;
      camera.updateProjectionMatrix();
    }
  }
}
