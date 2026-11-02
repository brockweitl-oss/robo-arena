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
            float fade = smoothstep(0.0, 0.06, along) * (1.0 - smoothstep(0.8, 1.0, along));
            float tip = smoothstep(0.93, 0.985, along) * (1.0 - smoothstep(0.985, 1.0, along));
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
      this.lane(this.mine, me.pos, goal.x, goal.z, sk.range, sk.radius * 2 + 0.5, colliders);
      const u = this.mine.material.uniforms;
      (u.uColor.value as THREE.Color).setHex(me.skillCd > 0 ? 0x8a8f99 : sk.color);
      u.uOpacity.value = (me.skillCd > 0 ? 0.35 : 1) * pulse * 0.4;
      u.uT.value = time;
      u.uRange.value = sk.range;
    }
    this.foe.visible = foe.castT >= 0;
    if (this.foe.visible) {
      const sk = foe.lo.skill;
      const t = foe.castTarget;
      this.lane(this.foe, foe.pos, t ? t[0] : me.pos.x, t ? t[2] : me.pos.z, sk.range, sk.radius * 2 + 0.5, colliders);
      const fu = this.foe.material.uniforms;
      fu.uOpacity.value = 0.6 * pulse;
      fu.uT.value = time * 2;
      fu.uRange.value = sk.range;
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
