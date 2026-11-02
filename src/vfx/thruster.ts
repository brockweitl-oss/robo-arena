import * as THREE from 'three';

/**
 * Plasma thruster plume: two nested additive cones with a scrolling-noise
 * fragment shader. `intensity` scales the length and brightness.
 * The plume points down the local -Y axis from its origin (the nozzle).
 */
const vert = /* glsl */ `
  uniform float uLen;
  uniform float uWidth;
  varying vec2 vUv;
  varying float vH;
  void main() {
    vUv = uv;
    vec3 p = position;
    // cone geometry is built with its tip at y=-1, base at y=0
    vH = -p.y;
    p.y *= uLen;
    p.xz *= uWidth * (1.0 - vH * 0.65);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColor;
  uniform vec3 uCore;
  uniform float uSeed;
  varying vec2 vUv;
  varying float vH;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
  }
  void main() {
    float t = uTime * 9.0 + uSeed * 13.0;
    float n = noise(vec2(vUv.x * 8.0, vH * 5.0 - t)) * 0.6 + noise(vec2(vUv.x * 17.0, vH * 11.0 - t * 1.7)) * 0.4;
    float fall = pow(1.0 - clamp(vH, 0.0, 1.0), 1.6);
    float a = fall * (0.55 + n * 0.65) * uIntensity;
    // Diamond shock pattern near the nozzle
    float shock = smoothstep(0.6, 1.0, sin(vH * 26.0 - uTime * 30.0) * 0.5 + 0.5) * (1.0 - vH) * 0.5;
    vec3 col = mix(uColor, uCore, clamp(fall * fall + shock, 0.0, 1.0));
    gl_FragColor = vec4(col * a * 2.6, a);
  }
`;

let coneGeo: THREE.BufferGeometry | null = null;
function getCone() {
  if (!coneGeo) {
    coneGeo = new THREE.CylinderGeometry(1, 0.05, 1, 16, 6, true);
    coneGeo.translate(0, -0.5, 0);
  }
  return coneGeo;
}

export class Thruster {
  readonly group = new THREE.Group();
  private outer: THREE.Mesh;
  private inner: THREE.Mesh;
  private matO: THREE.ShaderMaterial;
  private matI: THREE.ShaderMaterial;
  private glow: THREE.Mesh;
  intensity = 0;
  private shown = 0;

  constructor(color: number, width = 0.07, length = 0.5) {
    const mk = (c: THREE.Color, core: THREE.Color, w: number, l: number) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
          uColor: { value: c },
          uCore: { value: core },
          uLen: { value: l },
          uWidth: { value: w },
          uSeed: { value: Math.random() },
        },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
    const col = new THREE.Color(color);
    this.matO = mk(col, col.clone().lerp(new THREE.Color(1, 1, 1), 0.5), width, length);
    this.matI = mk(col.clone().lerp(new THREE.Color(1, 1, 1), 0.6), new THREE.Color(1, 1, 1), width * 0.5, length * 0.6);
    this.outer = new THREE.Mesh(getCone(), this.matO);
    this.inner = new THREE.Mesh(getCone(), this.matI);
    this.outer.frustumCulled = this.inner.frustumCulled = false;
    this.outer.renderOrder = this.inner.renderOrder = 5;
    // nozzle glow disc
    this.glow = new THREE.Mesh(
      new THREE.CircleGeometry(width * 0.9, 16),
      new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(4), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.glow.rotation.x = Math.PI / 2;
    this.glow.position.y = -0.005;
    this.group.add(this.outer, this.inner, this.glow);
    this.group.visible = false;
  }

  update(time: number, dt: number) {
    // Quick attack, slower release, plus flicker
    const k = this.intensity > this.shown ? 30 : 10;
    this.shown += (this.intensity - this.shown) * Math.min(1, dt * k);
    const flick = 0.85 + Math.random() * 0.3;
    const v = this.shown * flick;
    this.group.visible = v > 0.02;
    if (!this.group.visible) return;
    this.matO.uniforms.uTime.value = time;
    this.matI.uniforms.uTime.value = time;
    this.matO.uniforms.uIntensity.value = Math.min(1.2, v);
    this.matI.uniforms.uIntensity.value = Math.min(1.2, v * 1.1);
    const len = 0.35 + v * 0.75;
    this.outer.scale.set(1, len, 1);
    this.inner.scale.set(1, len, 1);
    (this.glow.material as THREE.MeshBasicMaterial).opacity = Math.min(1, v);
  }

  dispose() {
    this.matO.dispose();
    this.matI.dispose();
    (this.glow.material as THREE.Material).dispose();
    this.glow.geometry.dispose();
  }
}
