import * as THREE from 'three';
import type { World } from '../game/world';
import { OBJECTIVE } from '../game/tactics';
import type { Effects } from './effects';

/**
 * Placeholder visuals for the Overcharge Core objective: a ground ring with one capture band
 * per side, a light column while it is online and a floating core. Four draw calls, no lights.
 * Gameplay reads only the sim (World.objective); Codex owns the final look (issue #60).
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uP0, uP1, uState, uTime, uContest;
uniform vec3 uC0, uC1, uBase;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  float a = atan(p.x, p.y) / 6.2831853 + 0.5;
  float on = step(1.5, uState);
  float warn = step(0.5, uState) * (1.0 - on);
  float pulse = 0.5 + 0.5 * sin(uTime * (warn > 0.5 ? 10.0 : 3.0));
  float edge = smoothstep(1.0, 0.975, d) * smoothstep(0.93, 0.955, d);
  float band0 = step(0.80, d) * step(d, 0.89);
  float band1 = step(0.69, d) * step(d, 0.78);
  // tick marks every 1/8 of the ring so progress reads as discrete steps
  float ticks = step(0.985, fract(a * 8.0 + 0.0075));
  vec3 base = mix(uBase, vec3(1.0, 0.25, 0.2), uContest * pulse);
  vec3 col = base * edge * (0.35 + 0.9 * on + warn * pulse);
  float al = edge * (0.2 + 0.7 * on + warn * 0.6 * pulse);
  float f0 = band0 * step(a, uP0) * (1.0 - ticks);
  float f1 = band1 * step(a, uP1) * (1.0 - ticks);
  col += uC0 * f0 * 2.2 + uC1 * f1 * 2.2;
  al += (f0 + f1) * 0.9;
  float track = (band0 + band1) * on;
  col += base * track * 0.12;
  al += track * 0.1;
  float disc = (1.0 - smoothstep(0.0, 0.75, d)) * (on * 0.09 + warn * 0.05 * pulse);
  col += base * disc;
  al += disc;
  gl_FragColor = vec4(col, clamp(al, 0.0, 1.0));
}`;

/** Additive glow that fades out toward the top of a cylinder (uv.y = 1 at the top). */
function fadeMaterial(color: number) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uOpacity;
void main() { float k = 1.0 - vUv.y; gl_FragColor = vec4(uColor, uOpacity * k * k); }`,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export class ObjectiveView {
  readonly group = new THREE.Group();
  private pad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** Slim beacon above the core and a low glowing rim at the pad edge. */
  private column: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private rim: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private core: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>;
  private time = 0;
  private flash = 0;

  /** colors[i] = the HUD colour of world fighter i. */
  constructor(private world: World, private fx: Effects, scene: THREE.Scene, private colors: [number, number]) {
    const o = world.objective!;
    const r = o.radius;
    this.pad = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 2, r * 2),
      new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: {
          uP0: { value: 0 }, uP1: { value: 0 }, uState: { value: 0 }, uTime: { value: 0 }, uContest: { value: 0 },
          uC0: { value: new THREE.Color(colors[0]) }, uC1: { value: new THREE.Color(colors[1]) }, uBase: { value: new THREE.Color(0xffd36a) },
        },
      }),
    );
    this.pad.rotation.x = -Math.PI / 2;
    this.pad.position.copy(o.pos).add(new THREE.Vector3(0, 0.05, 0));
    this.pad.renderOrder = 2;
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 12, 16, 1, true), fadeMaterial(0xffd36a));
    this.column.position.copy(o.pos).add(new THREE.Vector3(0, 3.1 + 6, 0));
    this.column.visible = true; // visible (at zero opacity) for the match shader pre-compile; update() hides it
    this.rim = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.7, 48, 1, true), fadeMaterial(0xffd36a));
    this.rim.position.copy(o.pos).add(new THREE.Vector3(0, 0.35, 0));
    this.rim.visible = true;
    this.core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34, 0),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd36a, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.3, flatShading: true }),
    );
    this.core.position.copy(o.pos).add(new THREE.Vector3(0, 3.1, 0));
    this.group.add(this.pad, this.column, this.rim, this.core);
    scene.add(this.group);
  }

  /** Capture burst in the capturer's colour. */
  captured(who: number) {
    const o = this.world.objective!;
    this.flash = 1;
    const c = this.colors[who];
    this.fx.burst(o.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), c, 1.2);
    this.fx.sparks.emit({ pos: o.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), count: 26, speed: [3, 8], size: [0.05, 0.1], life: [0.3, 0.7], color: c, intensity: 3, gravity: 8 });
  }

  update(dt: number) {
    this.time += dt;
    const w = this.world, o = w.objective!;
    const online = o.untilTick >= 0;
    const soon = !online && w.objectiveIn() <= OBJECTIVE.warn;
    const u = this.pad.material.uniforms;
    u.uTime.value = this.time;
    u.uState.value = online ? 2 : soon ? 1 : 0;
    u.uP0.value = o.meters[0] / OBJECTIVE.capture;
    u.uP1.value = o.meters[1] / OBJECTIVE.capture;
    u.uContest.value = o.contested ? 1 : 0;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.column.visible = this.rim.visible = online || soon || this.flash > 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * (soon ? 10 : 2.5));
    const tint = o.contested ? 0xff5a3a : 0xffd36a;
    for (const m of [this.column, this.rim]) m.material.uniforms.uColor.value.setHex(tint);
    this.column.material.uniforms.uOpacity.value = (online ? 0.45 + pulse * 0.2 : soon ? 0.3 * pulse : 0) + this.flash;
    this.rim.material.uniforms.uOpacity.value = (online ? 0.22 + pulse * 0.1 : soon ? 0.15 * pulse : 0) + this.flash * 0.5;
    this.core.rotation.y += dt * (online ? 2.4 : 0.6);
    this.core.position.y = o.pos.y + 3.1 + Math.sin(this.time * 1.8) * 0.12;
    this.core.material.emissiveIntensity = online ? 3 + pulse * 1.5 : soon ? 0.6 + pulse * 2 : 0.35;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const m of [this.pad, this.column, this.rim, this.core]) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}
