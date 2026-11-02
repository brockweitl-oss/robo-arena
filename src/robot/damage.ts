import * as THREE from 'three';
import { ParticleSystem } from '../vfx/particles';
import { scorchSprite } from '../render/textures';
import { plate } from './kit';
import type { RobotModel } from './model';

/** Fixed-capacity presentation effects. Nothing here changes collision or HP. */
export class DamageVisuals {
  private readonly scars = new THREE.Group();
  private readonly loose = new THREE.Group();
  private readonly sparks = new ParticleSystem(32, 'add');
  private readonly smoke = new ParticleSystem(32, 'smoke');
  private readonly fx = new THREE.Group();
  private readonly position = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 0.6, 0);
  private readonly scarMat = new THREE.MeshBasicMaterial({ map: scorchSprite(128), color: 0x17110f, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  private readonly crackMat = new THREE.LineBasicMaterial({ color: 0x131820 });
  private sparkTimer = 0;
  private smokeTimer = 0;
  private hp = 1;
  private readonly eyeGlow: THREE.MeshStandardMaterial;

  constructor(private readonly model: RobotModel) {
    this.eyeGlow = (model.mats.glowHot as THREE.MeshStandardMaterial).clone();
    model.rig.head.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material === model.mats.glowHot) mesh.material = this.eyeGlow;
    });
    const frame = model.loadout.body.frame;
    const z = frame === 'ironclad' ? 0.26 : frame === 'wisp' ? 0.175 : 0.21;
    for (const sx of [-1, 1]) {
      const scar = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.22), this.scarMat);
      scar.position.set(sx * 0.12, sx * 0.035, z);
      scar.rotation.z = sx * 0.6;
      this.scars.add(scar);
    }
    const points = [
      [-0.19, 0.13, z + 0.004], [-0.12, 0.08, z + 0.004],
      [-0.12, 0.08, z + 0.004], [-0.15, 0.02, z + 0.004],
      [-0.15, 0.02, z + 0.004], [-0.08, -0.04, z + 0.004],
      [-0.12, 0.08, z + 0.004], [-0.05, 0.1, z + 0.004],
    ];
    const cracks = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p as [number, number, number]))), this.crackMat);
    this.scars.add(cracks);
    model.rig.chest.add(this.scars);
    const panel = new THREE.Mesh(plate([[-0.07, 0], [0.07, 0], [0.06, -0.17], [-0.035, -0.2], [-0.07, -0.12]], 0.025, 0.005), model.mats.primary);
    panel.castShadow = true;
    this.loose.add(panel);
    this.loose.position.set(0.13, -0.03, z + 0.035);
    model.rig.chest.add(this.loose);
    this.fx.add(this.sparks.mesh, this.smoke.mesh);
    this.scars.visible = this.loose.visible = false;
  }

  setFraction(hp: number) {
    this.hp = Number.isFinite(hp) ? THREE.MathUtils.clamp(hp, 0, 1) : 1;
    this.scars.visible = this.hp < 0.5;
    this.loose.visible = this.hp < 0.25;
    this.scarMat.opacity = this.hp < 0.25 ? 0.82 : 0.55;
    if (this.hp >= 0.5) {
      this.sparks.clear(); this.smoke.clear();
      this.sparkTimer = this.smokeTimer = 0;
      this.fx.removeFromParent();
    }
  }

  update(time: number, dt: number) {
    this.eyeGlow.emissiveIntensity = 6 * this.model.power;
    const parent = this.model.root.parent;
    if (this.hp < 0.5 && parent) {
      if (this.fx.parent !== parent) parent.add(this.fx);
      this.model.rig.chest.getWorldPosition(this.position);
      parent.worldToLocal(this.position);
      this.position.y += 0.06;
      this.sparkTimer -= dt;
      if (this.sparkTimer <= 0) {
        this.sparks.emit({ pos: this.position, count: 3, speed: [0.4, 1.3], life: [0.1, 0.28], size: [0.012, 0.025], color: 0xffa44a, intensity: 3, gravity: 2, stretch: 0.08 });
        this.sparkTimer = 0.65 + 0.2 * Math.sin(time * 1.7);
      }
      this.smokeTimer -= dt;
      if (this.hp < 0.25 && this.smokeTimer <= 0) {
        this.smoke.emit({ pos: this.position, count: 1, vel: this.up, speed: [0.03, 0.12], life: [0.7, 1.3], size: [0.05, 0.09], grow: 3, color: 0x34343a, alpha: 0.34, drag: 0.1 });
        this.smokeTimer = 0.1;
      }
      this.loose.rotation.set(0.2 + Math.sin(time * 6) * 0.12, 0.1, -0.22 + Math.sin(time * 4) * 0.08);
      const flicker = this.hp < 0.25 && Math.sin(time * 19) * Math.sin(time * 7) > 0.55 ? 0.12 : 1;
      (this.model.mats.visor as THREE.MeshPhysicalMaterial).emissiveIntensity *= flicker;
      this.eyeGlow.emissiveIntensity *= flicker;
    }
    this.fx.visible = this.model.root.visible;
    this.sparks.update(dt); this.smoke.update(dt);
  }

  dispose() {
    this.fx.removeFromParent(); this.scars.removeFromParent(); this.loose.removeFromParent();
    this.scars.traverse(o => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
    this.loose.traverse(o => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
    this.eyeGlow.dispose(); this.scarMat.dispose(); this.crackMat.dispose(); this.sparks.dispose(); this.smoke.dispose();
  }
}
