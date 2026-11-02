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
  yaw += THREE.MathUtils.clamp(turn, -me.aimTurnRate / 60, me.aimTurnRate / 60);
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
  private mine: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private foe: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

  constructor(scene: THREE.Scene) {
    const mk = (color: number) => {
      const m = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.3 }, uT: { value: 0 }, uRange: { value: 20 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uT; uniform float uRange; varying vec2 vUv;
          void main(){
            float along = 1.0 - vUv.y;
            float ax = abs(vUv.x - 0.5) * 2.0;
            float edge = smoothstep(0.82, 0.97, ax) * (1.0 - smoothstep(0.97, 1.0, ax));
            float f = fract(along * uRange / 1.6 - ax * 0.35 - uT * 1.8);
            float chevron = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.18, 0.3, f)) * (1.0 - ax * 0.6);
            float fade = smoothstep(0.0, 0.06, along) * (1.0 - smoothstep(0.85, 1.0, along));
            float tip = smoothstep(0.94, 0.985, along) * (1.0 - smoothstep(0.985, 1.0, along));
            float a = (0.16 + edge * 1.2 + chevron * 0.75) * fade + tip * 1.6;
            gl_FragColor = vec4(uColor * a * uOpacity * 3.0, 1.0);
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
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
      const u = this.mine.material.uniforms;
      (u.uColor.value as THREE.Color).setHex(me.skillCd > 0 ? 0x8a8f99 : sk.color);
      u.uOpacity.value = (me.skillCd > 0 ? 0.35 : 1) * pulse * 0.4;
      u.uT.value = time;
    }
    this.foe.visible = foe.castT >= 0;
    if (this.foe.visible) {
      const sk = foe.lo.skill;
      const t = foe.castTarget;
      this.lane(this.foe, foe, me, t ? new THREE.Vector3(...t) : null, colliders);
      const fu = this.foe.material.uniforms;
      fu.uOpacity.value = (0.3 + .35 * (1 - Math.max(0, foe.castT) / sk.cast)) * pulse;
      fu.uT.value = time * 2;
    }
  }

  private lane(m: THREE.Mesh, me: Fighter, foe: Fighter, goal: THREE.Vector3 | null, colliders: Collider[]) {
    const { from, end, width } = skillLane(me, foe, goal, colliders);
    const y = groundHeightBelow(from.x, from.z, me.pos.y + 0.5, colliders) + 0.06;
    m.position.set(from.x, y, from.z);
    m.rotation.set(0, Math.atan2(end.x - from.x, end.z - from.z), 0);
    const len = Math.hypot(end.x - from.x, end.z - from.z);
    m.scale.set(width, 1, len);
    (m.material as THREE.ShaderMaterial).uniforms.uRange.value = len;
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
