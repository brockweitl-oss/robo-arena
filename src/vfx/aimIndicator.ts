import * as THREE from 'three';
import type { Fighter } from '../game/fighter';
import { groundHeightBelow, segmentHit } from '../game/collision';
import type { Collider } from '../arena/types';

/** Mirrors spawnSkill's trajectory; ground lane shows the projectile width, not aim assist. */
export function skillLane(me: Fighter, foe: Fighter, goal: THREE.Vector3 | null, colliders: Collider[]) {
  const targetYaw = Math.atan2(foe.pos.x - me.pos.x, foe.pos.z - me.pos.z);
  let yaw = goal ? Math.atan2(goal.x - me.pos.x, goal.z - me.pos.z) : targetYaw;
  // Fighter faces its cast target, then resumes aimHold facing on the release
  // tick before World reads the muzzle. Mirror that fixed-step presentation.
  const turn = Math.atan2(Math.sin(targetYaw - yaw), Math.cos(targetYaw - yaw));
  yaw += THREE.MathUtils.clamp(turn, -(me.grounded ? 22 : 10) / 60, (me.grounded ? 22 : 10) / 60);
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const from = new THREE.Vector3(me.pos.x - c * .42 + s * .55, me.pos.y + 1.3, me.pos.z + s * .42 + c * .55), chest = foe.chestPoint();
  const dir = goal ? new THREE.Vector3(goal.x - from.x, chest.y - from.y, goal.z - from.z) : chest.sub(from);
  if (goal) {
    const flat = Math.hypot(dir.x, dir.z), toFoe = foe.pos.clone().sub(me.pos).setY(0).normalize();
    if (flat > .001 && (dir.x * toFoe.x + dir.z * toFoe.z) / flat < .8) dir.y = 0;
  }
  if (dir.lengthSq() < 1e-6) dir.set(Math.sin(me.yaw), 0, Math.cos(me.yaw));
  dir.normalize();
  const end = from.clone().addScaledVector(dir, me.lo.skill.range), hit = segmentHit(from, end, colliders);
  if (hit) end.copy(hit.point);
  return { from, end, width: me.lo.skill.radius * 2, obstructed: !!hit };
}

/**
 * Ground lanes for skill shots:
 *  - the player's lane while aiming (to the skill's max range, as wide as the shot)
 *  - the enemy's lane during its short cast (the telegraph to dodge)
 * Two pooled meshes; no GPU resources are allocated per frame.
 */
export class AimIndicator {
  readonly group = new THREE.Group();
  private geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
  private texture: THREE.DataTexture;
  private mine: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private foe: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  constructor(scene: THREE.Scene) {
    const pixels = new Uint8Array(64 * 128 * 4);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const edge = x < 2 || x > 61 || y > 124;
      const dash = Math.abs(x - 31.5) < 1.5 && y % 16 < 9;
      const chevron = Math.abs(Math.abs(x - 31.5) - (y % 32) * .5) < 1 && y % 32 < 24;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = edge ? 255 : dash ? 200 : chevron ? 115 : 30;
    }
    this.texture = new THREE.DataTexture(pixels, 64, 128); this.texture.needsUpdate = true;
    this.texture.magFilter = THREE.LinearFilter;
    const mk = (color: number) => {
      const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
        color, map: this.texture, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      }));
      m.renderOrder = 5;
      m.frustumCulled = false;
      m.visible = false;
      this.group.add(m);
      return m;
    };
    this.mine = mk(0xffffff);
    this.foe = mk(0xff3b3b);
    scene.add(this.group);
  }

  /** `goal` is the player's current aim point while aiming a skill (null = not aiming). */
  update(me: Fighter, foe: Fighter, goal: THREE.Vector3 | null, colliders: Collider[], time: number) {
    const pulse = 0.85 + Math.sin(time * 14) * 0.15;
    this.mine.visible = !!goal;
    if (goal) {
      const sk = me.lo.skill;
      this.lane(this.mine, me, foe, goal, colliders);
      this.mine.material.color.setHex(sk.color);
      this.mine.material.opacity = (me.skillCd > 0 ? 0.22 : 0.8) * pulse;
    }
    this.foe.visible = foe.castT >= 0;
    if (this.foe.visible) {
      const sk = foe.lo.skill;
      const t = foe.castTarget;
      this.lane(this.foe, foe, me, t ? new THREE.Vector3(...t) : null, colliders);
      this.foe.material.opacity = (0.3 + .35 * (1 - Math.max(0, foe.castT) / sk.cast)) * pulse;
    }
  }

  private lane(m: THREE.Mesh, me: Fighter, foe: Fighter, goal: THREE.Vector3 | null, colliders: Collider[]) {
    const { from, end, width } = skillLane(me, foe, goal, colliders);
    const y = groundHeightBelow(from.x, from.z, me.pos.y + 0.5, colliders) + 0.06;
    m.position.set(from.x, y, from.z);
    m.rotation.set(0, Math.atan2(end.x - from.x, end.z - from.z), 0);
    m.scale.set(width, 1, Math.hypot(end.x - from.x, end.z - from.z));
  }

  hide() {
    this.mine.visible = this.foe.visible = false;
  }

  dispose() {
    this.group.removeFromParent();
    this.geo.dispose();
    this.texture.dispose();
    this.mine.material.dispose();
    this.foe.material.dispose();
  }
}
