import * as THREE from 'three';
import type { Fighter } from '../game/fighter';
import { groundHeightBelow } from '../game/collision';
import type { Collider } from '../arena/types';

/**
 * Ground lanes for skill shots:
 *  - the player's lane while aiming (to the skill's max range, as wide as the shot)
 *  - the enemy's lane during its short cast (the telegraph to dodge)
 * Two pooled meshes; nothing is allocated per frame.
 */
export class AimIndicator {
  readonly group = new THREE.Group();
  private geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
  private mine: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private foe: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  constructor(scene: THREE.Scene) {
    const mk = (color: number) => {
      const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
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
      this.lane(this.mine, me.pos, goal.x, goal.z, sk.range, sk.radius * 2 + 0.5, colliders);
      this.mine.material.color.setHex(sk.color);
      this.mine.material.opacity = (me.skillCd > 0 ? 0.12 : 0.32) * pulse;
    }
    this.foe.visible = foe.castT >= 0;
    if (this.foe.visible) {
      const sk = foe.lo.skill;
      const t = foe.castTarget;
      this.lane(this.foe, foe.pos, t ? t[0] : me.pos.x, t ? t[2] : me.pos.z, sk.range, sk.radius * 2 + 0.5, colliders);
      this.foe.material.opacity = 0.45 * pulse;
    }
  }

  private lane(m: THREE.Mesh, from: THREE.Vector3, tx: number, tz: number, range: number, width: number, colliders: Collider[]) {
    const y = groundHeightBelow(from.x, from.z, from.y + 0.5, colliders) + 0.06;
    m.position.set(from.x, y, from.z);
    m.rotation.set(0, Math.atan2(tx - from.x, tz - from.z), 0);
    m.scale.set(width, 1, range);
  }

  hide() {
    this.mine.visible = this.foe.visible = false;
  }

  dispose() {
    this.group.removeFromParent();
    this.geo.dispose();
    this.mine.material.dispose();
    this.foe.material.dispose();
  }
}
