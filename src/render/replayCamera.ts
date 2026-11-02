import * as THREE from 'three';
import type { Collider } from '../arena/types';
import { segmentHit } from '../game/collision';

export type ReplayCameraMode = 0 | 1 | 2 | 3;
const LABELS = ['1 · Player 1 POV', '2 · Player 2 POV', '3 · Broadcast', '4 · Free fly'];
/** Presentation only: never receives fighters or recorded inputs, only copied render positions. */
export class ReplayCamera {
  mode: ReplayCameraMode = 2;
  private initialized = false;
  private focus = new THREE.Vector3();
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private cleanup: (() => void) | null = null;
  private refresh: (() => void) | null = null;
  constructor(readonly camera: THREE.PerspectiveCamera, private colliders: Collider[]) {}

  setMode(mode: ReplayCameraMode) {
    if (mode === this.mode) return;
    this.mode = mode; this.initialized = false; this.keys.clear();
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y; this.pitch = e.x;
    this.refresh?.();
  }

  attach(parent: HTMLElement, canvas: HTMLElement) {
    this.cleanup?.();
    const panel = document.createElement('div');
    panel.dataset.replayCamera = 'true'; panel.setAttribute('aria-label', 'Replay camera');
    Object.assign(panel.style, { position: 'absolute', left: '50%', top: '120px', transform: 'translateX(-50%)', zIndex: '9', pointerEvents: 'auto', background: '#08131ee8', border: '1px solid #7193a7', padding: '8px', color: '#e8f5ff', font: '12px system-ui', textAlign: 'center', maxWidth: '95vw', width: 'max-content' });
    const buttons = LABELS.map((label, i) => {
      const b = document.createElement('button'); b.textContent = label;
      Object.assign(b.style, { margin: '2px', padding: '7px', cursor: 'pointer', color: 'inherit', border: '1px solid #7193a7' });
      b.onmousedown = (event) => event.preventDefault();
      b.onclick = (event) => { if (event.detail > 0) b.blur(); this.setMode(i as ReplayCameraMode); }; panel.append(b); return b;
    });
    const hint = document.createElement('div'); panel.append(hint); parent.append(panel);
    this.refresh = () => { buttons.forEach((b, i) => { b.setAttribute('aria-pressed', String(this.mode === i)); b.style.background = this.mode === i ? '#24536c' : '#14222d'; }); hint.textContent = this.mode === 3 ? 'WASD move · Q/E down/up · Shift faster · drag or captured mouse to look · Esc pause' : 'Keys 1–4 switch views · Esc pause'; };
    this.refresh();
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || (e.target as HTMLElement)?.isContentEditable) return;
      if (/^Digit[1-4]$/.test(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) this.setMode((Number(e.code.slice(-1)) - 1) as ReplayCameraMode); }
      if (this.mode === 3 && ['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); this.keys.add(e.code); }
    };
    const up = (e: KeyboardEvent) => { this.keys.delete(e.code); };
    const blur = () => this.keys.clear();
    const mouse = (e: MouseEvent) => {
      if (this.mode !== 3 || !(document.pointerLockElement === canvas || (e.buttons === 1 && e.target === canvas))) return;
      this.yaw -= e.movementX * .0025; this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * .0025, -1.4, 1.4);
    };
    window.addEventListener('keydown', key, true); window.addEventListener('keyup', up, true); window.addEventListener('blur', blur); window.addEventListener('mousemove', mouse);
    this.cleanup = () => { window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', blur); window.removeEventListener('mousemove', mouse); panel.remove(); this.keys.clear(); };
  }

  update(dt: number, p1: THREE.Vector3, p2: THREE.Vector3) {
    dt = Math.max(0, Math.min(.1, dt));
    const c = this.camera;
    if (this.mode === 3) {
      const desiredRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      c.quaternion.slerp(desiredRotation, 1 - Math.exp(-18 * dt));
      const velocity = new THREE.Vector3(Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')), 0, Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW'))).applyQuaternion(c.quaternion);
      velocity.y += Number(this.keys.has('KeyE')) - Number(this.keys.has('KeyQ'));
      const target = c.position.clone().addScaledVector(velocity.normalize(), dt * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 18 : 7));
      const hit = segmentHit(c.position, target, this.colliders);
      if (hit) target.copy(hit.point).addScaledVector(hit.normal, .2);
      target.y = Math.max(.35, target.y); c.position.copy(target); return;
    }
    const a = this.mode === 1 ? p2 : p1, b = this.mode === 1 ? p1 : p2;
    const target = this.mode === 2 ? p1.clone().add(p2).multiplyScalar(.5).add(new THREE.Vector3(0, 1.2, 0)) : a.clone().add(new THREE.Vector3(0, 1.5, 0));
    const direction = b.clone().sub(a); direction.y = 0;
    if (direction.lengthSq() < .001) direction.set(0, 0, 1); else direction.normalize();
    let desired: THREE.Vector3;
    if (this.mode === 2) {
      const sep = p1.distanceTo(p2);
      const halfFov = THREE.MathUtils.degToRad(c.fov / 2);
      const distance = Math.max(10, (sep * .5 + 3) / Math.tan(Math.min(halfFov, Math.atan(Math.tan(halfFov) * c.aspect))));
      desired = target.clone().add(new THREE.Vector3(.45, .72, 1).normalize().multiplyScalar(distance));
    } else desired = target.clone().addScaledVector(direction, -7.4).add(new THREE.Vector3(0, 3.2, 0));
    const hit = segmentHit(target, desired, this.colliders);
    if (hit) desired.copy(hit.point).lerp(target, .08);
    desired.y = Math.max(.35, desired.y);
    if (!this.initialized) { c.position.copy(desired); this.focus.copy(target); this.initialized = true; }
    else { c.position.lerp(desired, 1 - Math.exp(-8 * dt)); this.focus.lerp(target, 1 - Math.exp(-10 * dt)); }
    // Recheck the smoothed boom: interpolation around corners must not tunnel through cover.
    const blocked = segmentHit(this.focus, c.position, this.colliders);
    if (blocked) c.position.copy(blocked.point).lerp(this.focus, .08);
    c.lookAt(this.mode === 2 ? this.focus : this.focus.clone().addScaledVector(direction, 2));
  }
  dispose() { this.cleanup?.(); this.cleanup = null; this.refresh = null; this.keys.clear(); }
}
