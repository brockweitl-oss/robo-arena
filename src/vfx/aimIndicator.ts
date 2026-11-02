import * as THREE from 'three';
import type { Fighter } from '../game/fighter';
import { groundHeightBelow } from '../game/collision';
import type { Collider } from '../arena/types';

/**
 * Ground indicators for manual aiming:
 *  - skill: a lane from the robot to the skill's max range, as wide as the shot
 *  - bomb: a ring at the landing point, sized to the blast radius
 * The enemy's skill lane also shows during its short cast (the telegraph to dodge).
 * Pooled meshes only; nothing is allocated per frame.
 */
export class AimIndicator {
  readonly group = new THREE.Group();
  private lane: THREE.Mesh;
  private laneMat: THREE.MeshBasicMaterial;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private dot: THREE.Mesh;
  private foeLane: THREE.Mesh;
  private foeLaneMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    const laneGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    const mk = (color: number, opacity: number) => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    });
    this.laneMat = mk(0xffffff, 0.28);
    this.lane = new THREE.Mesh(laneGeo, this.laneMat);
    this.foeLaneMat = mk(0xff3b3b, 0.32);
    this.foeLane = new THREE.Mesh(laneGeo, this.foeLaneMat);
    this.ringMat = mk(0xffffff, 0.55);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2), this.ringMat);
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16).rotateX(-Math.PI / 2), this.ringMat);
    for (const m of [this.lane, this.foeLane, this.ring, this.dot]) {
      m.renderOrder = 5;
      m.frustumCulled = false;
      m.visible = false;
      this.group.add(m);
    }
    scene.add(this.group);
  }

  /** Call once per rendered frame. `aim` is the player's manual aim (world point) when aiming. */
  update(me: Fighter, foe: Fighter, colliders: Collider[], time: number) {
    const aim = me.aiming ? me.aimPoint : null;
    const pulse = 0.85 + Math.sin(time * 14) * 0.15;
    this.lane.visible = this.ring.visible = this.dot.visible = false;
    if (aim && me.skillAimT >= 0) {
      const sk = me.lo.skill;
      this.laneTo(this.lane, me.pos, aim, sk.range, sk.radius * 2 + 0.5, colliders);
      this.laneMat.color.setHex(sk.color);
      this.laneMat.opacity = 0.3 * pulse;
      this.lane.visible = true;
    } else if (aim && me.bombAimT >= 0) {
      const b = me.lo.bomb;
      const y = groundHeightBelow(aim.x, aim.z, Math.max(me.pos.y, aim.y) + 4, colliders) + 0.05;
      const r = b.blastRadius + (b.count > 1 ? b.scatter * 0.6 : 0);
      this.ring.position.set(aim.x, y, aim.z);
      this.ring.scale.setScalar(r);
      this.dot.position.set(aim.x, y, aim.z);
      this.ringMat.color.setHex(b.color);
      this.ringMat.opacity = 0.6 * pulse;
      this.ring.visible = this.dot.visible = true;
    }
    // enemy telegraph during its cast
    this.foeLane.visible = false;
    if (foe.castT >= 0) {
      const sk = foe.lo.skill;
      const to = foe.castTarget ?? me.pos;
      this.laneTo(this.foeLane, foe.pos, to, sk.range, sk.radius * 2 + 0.5, colliders);
      this.foeLaneMat.opacity = 0.45 * pulse;
      this.foeLane.visible = true;
    }
  }

  private laneTo(m: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, range: number, width: number, colliders: Collider[]) {
    const yaw = Math.atan2(to.x - from.x, to.z - from.z);
    const y = groundHeightBelow(from.x, from.z, from.y + 0.5, colliders) + 0.06;
    m.position.set(from.x, y, from.z);
    m.rotation.set(0, yaw, 0);
    m.scale.set(width, 1, range);
  }

  dispose() {
    this.group.removeFromParent();
    for (const m of [this.lane, this.foeLane, this.ring, this.dot]) m.geometry.dispose();
    this.laneMat.dispose();
    this.ringMat.dispose();
    this.foeLaneMat.dispose();
  }
}
