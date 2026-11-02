import * as THREE from 'three';
import type { Collider } from '../arena/types';
import { segmentHit } from './collision';

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/**
 * Third-person chase camera.
 * - Soft lock (default): mouse/stick orbit; when idle it drifts to keep the opponent framed ahead.
 * - Hard lock: yaw follows the player→opponent line, framing both robots.
 * Includes collision pull-in, trauma-based shake and a cinematic override.
 */
export class ChaseCamera {
  yaw = 0;
  pitch = 0.32;
  dist = 7.0;
  lock = false;
  shakeEnabled = true;
  private trauma = 0;
  private idleT = 0;
  private curDist = 7.6;
  private pivot = new THREE.Vector3();
  private look = new THREE.Vector3();
  private initialized = false;
  private fovKick = 0;
  /** Cinematic override: when set, camera eases to these. */
  cine: { pos: THREE.Vector3; look: THREE.Vector3; k: number } | null = null;
  private time = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  addTrauma(t: number) {
    if (!this.shakeEnabled) return;
    this.trauma = Math.min(0.6, this.trauma + t * 0.6);
  }
  kickFov(v: number) {
    if (!this.shakeEnabled) return;
    this.fovKick = Math.max(this.fovKick, v);
  }

  snapBehind(player: THREE.Vector3, enemy: THREE.Vector3) {
    this.yaw = Math.atan2(enemy.x - player.x, enemy.z - player.z);
    this.initialized = false;
  }

  update(dt: number, player: THREE.Vector3, enemy: THREE.Vector3, look: { dx: number; dy: number }, invertY: boolean, colliders: Collider[], playerAir: boolean) {
    this.time += dt;
    const toEnemy = Math.atan2(enemy.x - player.x, enemy.z - player.z);
    const lookActive = Math.abs(look.dx) + Math.abs(look.dy) > 0.0005;
    if (this.lock) {
      this.yaw = this.yaw + wrap(toEnemy - this.yaw) * (1 - Math.exp(-7 * dt));
      this.pitch = damp(this.pitch, 0.3, 4, dt);
      // mouse adds a small offset only
      this.yaw -= look.dx * 0.3;
    } else {
      this.yaw -= look.dx;
      this.pitch += (invertY ? -1 : 1) * look.dy * 0.8;
      if (lookActive) this.idleT = 0;
      else this.idleT += dt;
      // soft assist: after a moment without camera input, ease toward framing the enemy
      if (this.idleT > 0.9) {
        const d = wrap(toEnemy - this.yaw);
        const strength = Math.min(1, (this.idleT - 0.9) * 0.8) * 1.6;
        this.yaw += d * (1 - Math.exp(-strength * dt));
      }
    }
    this.yaw = wrap(this.yaw);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.15, 1.05);

    // distance grows a bit with separation so both stay on screen
    const sep = Math.hypot(enemy.x - player.x, enemy.z - player.z);
    const wantDist = this.dist + THREE.MathUtils.clamp((sep - 10) * 0.12, 0, 2.4);

    const pv = new THREE.Vector3(player.x, player.y + 1.55, player.z);
    if (!this.initialized) {
      this.pivot.copy(pv);
      this.curDist = wantDist;
    }
    // vertical follow lags a little more in the air (less bobbing)
    this.pivot.x = damp(this.pivot.x, pv.x, 14, dt);
    this.pivot.z = damp(this.pivot.z, pv.z, 14, dt);
    this.pivot.y = damp(this.pivot.y, pv.y, playerAir ? 5 : 10, dt);

    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const off = fwd.clone().multiplyScalar(-Math.cos(this.pitch)).add(new THREE.Vector3(0, Math.sin(this.pitch), 0));
    // collision: pull in if the boom hits geometry
    const desired = this.pivot.clone().addScaledVector(off, wantDist + 0.4);
    const hit = segmentHit(this.pivot, desired, colliders);
    let d = wantDist;
    if (hit) d = Math.max(1.6, hit.point.distanceTo(this.pivot) - 0.5);
    this.curDist = d < this.curDist ? damp(this.curDist, d, 25, dt) : damp(this.curDist, d, 3, dt);
    const camPos = this.pivot.clone().addScaledVector(off, this.curDist);
    camPos.y = Math.max(camPos.y, 0.4);

    // look point: ahead of the player, biased toward the enemy
    const enemyBias = this.lock ? 0.42 : 0.22;
    const lookTarget = new THREE.Vector3(
      THREE.MathUtils.lerp(this.pivot.x, enemy.x, enemyBias),
      THREE.MathUtils.lerp(this.pivot.y - 0.1, enemy.y + 1.2, enemyBias * 0.6),
      THREE.MathUtils.lerp(this.pivot.z, enemy.z, enemyBias),
    );
    if (!this.initialized) this.look.copy(lookTarget);
    this.look.lerp(lookTarget, 1 - Math.exp(-10 * dt));
    this.initialized = true;

    const cam = this.camera;
    if (this.cine) {
      // keep cinematic shots out of walls/cover: pull the camera toward the subject
      const want = this.cine.pos.clone();
      const ch = segmentHit(this.cine.look, want, colliders);
      if (ch) want.copy(ch.point).lerp(this.cine.look, 0.12).add(new THREE.Vector3(0, 0.6, 0));
      cam.position.lerp(want, 1 - Math.exp(-this.cine.k * dt));
      this.look.lerp(this.cine.look, 1 - Math.exp(-this.cine.k * dt));
    } else cam.position.copy(camPos);
    cam.lookAt(this.look);

    // shake (trauma²), smooth noise
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    if (s > 0.0001) {
      const t = this.time * 32;
      const n = (o: number) => Math.sin(t * 1.13 + o) * 0.6 + Math.sin(t * 2.37 + o * 2.1) * 0.4;
      cam.rotateX(n(1) * 0.045 * s);
      cam.rotateY(n(5) * 0.045 * s);
      cam.rotateZ(n(9) * 0.06 * s);
      cam.position.x += n(13) * 0.14 * s;
      cam.position.y += n(17) * 0.14 * s;
    }
    this.fovKick = Math.max(0, this.fovKick - dt * 4);
    const fov = 55 + this.fovKick * 10;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Camera-forward yaw used to convert stick input to world movement. */
  get moveYaw() {
    return this.yaw;
  }
}
