import * as THREE from 'three';

/**
 * Volumetric-looking fireballs: a noise-displaced sphere whose temperature ramps from
 * white-hot through orange to smoky red as it expands and cools. HDR cores feed bloom.
 * Small fixed pool; the oldest is recycled.
 */
const VERT = /* glsl */ `
  uniform float uT;
  uniform float uSeed;
  varying vec3 vN;
  varying vec3 vV;
  varying float vNoise;
  varying vec3 vP;
  float n3(vec3 p) {
    return sin(p.x * 1.7 + sin(p.y * 2.3 + uSeed)) * sin(p.y * 1.9 + sin(p.z * 2.1 + uSeed * 1.3)) * sin(p.z * 2.2 + sin(p.x * 1.6 - uSeed));
  }
  void main() {
    vec3 p = normalize(position);
    float t = uT * 3.0;
    float n = n3(p * 2.4 + vec3(0.0, -t, 0.0)) * 0.7 + n3(p * 6.5 + vec3(t, 0.0, uSeed)) * 0.3 + n3(p * 13.0 - vec3(0.0, t * 2.0, 0.0)) * 0.12;
    vNoise = n;
    vP = p;
    vec3 pos = p * (1.0 + n * 0.28);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vN = normalize(normalMatrix * p);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform float uT;
  uniform float uSeed;
  uniform vec3 uTint;
  varying vec3 vN;
  varying vec3 vV;
  varying float vNoise;
  varying vec3 vP;
  float h3(vec3 p) {
    return sin(p.x * 1.7 + sin(p.y * 2.3 + uSeed)) * sin(p.y * 1.9 + sin(p.z * 2.1 + uSeed * 1.3)) * sin(p.z * 2.2 + sin(p.x * 1.6 - uSeed));
  }
  void main() {
    float facing = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
    // fine turbulence per fragment so the surface breaks into hot cells and dark smoke
    float fine = h3(vP * 9.0 + vec3(0.0, -uT * 6.0, 0.0)) * 0.5 + h3(vP * 19.0 + vec3(uT * 4.0, 0.0, 0.0)) * 0.25;
    float temp = (1.0 - uT * 1.3) * (0.35 + 0.65 * facing) + vNoise * 0.35 + fine * 0.35;
    vec3 smoke = vec3(0.035, 0.028, 0.025);
    vec3 red = vec3(0.75, 0.09, 0.015);
    vec3 orange = mix(vec3(2.1, 0.55, 0.05), uTint * 1.6, 0.25);
    vec3 hot = vec3(3.4, 2.0, 0.55);
    vec3 c = temp > 0.72 ? mix(orange, hot, (temp - 0.72) / 0.28)
           : temp > 0.42 ? mix(red, orange, (temp - 0.42) / 0.3)
           : temp > 0.15 ? mix(smoke, red, (temp - 0.15) / 0.27) : smoke;
    float alpha = (1.0 - smoothstep(0.45, 1.0, uT)) * smoothstep(0.0, 0.45, facing + vNoise * 0.25 + fine * 0.2) * 0.92;
    gl_FragColor = vec4(c, alpha);
    #include <colorspace_fragment>
  }
`;

interface Ball { mesh: THREE.Mesh<THREE.IcosahedronGeometry, THREE.ShaderMaterial>; t: number; life: number; r: number; rise: number; active: boolean }

export class Fireballs {
  readonly group = new THREE.Group();
  private balls: Ball[] = [];
  private geo: THREE.IcosahedronGeometry;

  constructor(count: number, detail: number) {
    this.geo = new THREE.IcosahedronGeometry(1, detail);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 }, uSeed: { value: 0 }, uTint: { value: new THREE.Color() } },
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, toneMapped: false,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 7;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.balls.push({ mesh, t: 0, life: 1, r: 1, rise: 0, active: false });
    }
  }

  spawn(pos: THREE.Vector3, radius: number, tint: number, life = 0.6) {
    const b = this.balls.find((x) => !x.active) ?? this.balls.reduce((a, c) => (a.t / a.life > c.t / c.life ? a : c));
    b.active = true;
    b.t = 0;
    b.life = life;
    b.r = radius;
    b.rise = radius * 0.6;
    b.mesh.visible = true;
    b.mesh.position.copy(pos);
    b.mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    b.mesh.material.uniforms.uSeed.value = Math.random() * 10;
    (b.mesh.material.uniforms.uTint.value as THREE.Color).set(tint);
  }

  update(dt: number) {
    for (const b of this.balls) {
      if (!b.active) continue;
      b.t += dt;
      const t = b.t / b.life;
      if (t >= 1) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - t, 3);
      b.mesh.scale.setScalar(b.r * (0.55 + 0.6 * Math.sqrt(e)));
      b.mesh.position.y += b.rise * dt;
      b.mesh.material.uniforms.uT.value = t;
    }
  }

  clear() {
    for (const b of this.balls) { b.active = false; b.mesh.visible = false; }
  }

  dispose() {
    this.geo.dispose();
    for (const b of this.balls) b.mesh.material.dispose();
  }
}
