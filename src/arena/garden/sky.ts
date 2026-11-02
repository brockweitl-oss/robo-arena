// Dusk sky dome, moon, layered mountain silhouettes, distant city rooftops, and a matching PMREM environment.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../../render/textures';
import { fbm3 } from './noise';
import { moonTex, windowTex } from './tex';

export const SKY = {
  zenith: new THREE.Color('#08263a'),
  mid: new THREE.Color('#1c7088'),
  pink: new THREE.Color('#e3869a'),
  horizon: new THREE.Color('#ffb48a'),
  glow: new THREE.Color('#ff8a48'),
  fog: new THREE.Color('#87697a'),
};
export const SUN_DIR = new THREE.Vector3(-1, 0.18, 0.35).normalize();
export const MOON_DIR = new THREE.Vector3(0.5, 0.2, -0.84).normalize();

const skyVert = /* glsl */ `
varying vec3 vP;
void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const skyFrag = /* glsl */ `
uniform vec3 cZen; uniform vec3 cMid; uniform vec3 cPink; uniform vec3 cHor; uniform vec3 cGlow;
uniform vec3 sunDir; uniform vec3 moonDir; uniform float time; uniform float stars; uniform vec3 cFog;
varying vec3 vP;
float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s += a*vn(p); p *= 2.07; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vP);
  float h = d.y;
  float hp = max(h, 0.0);
  float az = max(dot(normalize(d.xz + 1e-5), normalize(sunDir.xz)), 0.0);
  vec3 col = mix(cHor, cPink, smoothstep(0.0, 0.07, hp));
  col = mix(col, cMid, smoothstep(0.05, 0.26, hp));
  col = mix(col, cZen, smoothstep(0.24, 0.8, hp));
  col += cGlow * pow(az, 3.0) * exp(-hp * 6.0) * 0.85;
  // the moon side of the sky is cooler
  float maz = max(dot(normalize(d.xz + 1e-5), normalize(moonDir.xz)), 0.0);
  col = mix(col, col * vec3(0.78, 0.86, 1.08), pow(maz, 2.0) * (1.0 - smoothstep(0.0, 0.5, hp)) * 0.6);
  // streaky dusk clouds
  vec2 cp = d.xz / (hp + 0.09);
  float c = fbm(vec3(cp.x * 0.55 + time * 0.004, cp.y * 1.9, 3.0));
  c = smoothstep(0.52, 0.78, c) * smoothstep(0.015, 0.06, hp) * (1.0 - smoothstep(0.18, 0.42, hp));
  vec3 cloudLit = mix(cPink * 1.15, cGlow * 1.1, pow(az, 2.0) * 0.8);
  vec3 cloudCol = mix(cMid * 0.75, cloudLit, 0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.25, hp)));
  col = mix(col, cloudCol, c * 0.75);
  // stars
  vec3 sp = floor(d * 260.0);
  float st = step(0.9972, hash(sp)) * smoothstep(0.22, 0.6, h) * stars;
  col += st * (0.55 + 0.45 * sin(time * 2.0 + hash(sp + 3.0) * 40.0)) * 0.9;
  // moon halo
  float md = max(dot(d, moonDir), 0.0);
  col += vec3(0.55, 0.65, 0.85) * (pow(md, 90.0) * 0.5 + pow(md, 10.0) * 0.08);
  // below horizon: hazy dusk murk
  if (h < 0.0) col = mix(cHor, cFog, smoothstep(0.0, -0.06, h));
  gl_FragColor = vec4(col, 1.0);
}`;

export function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      cZen: { value: SKY.zenith },
      cMid: { value: SKY.mid },
      cPink: { value: SKY.pink },
      cHor: { value: SKY.horizon },
      cGlow: { value: SKY.glow },
      sunDir: { value: SUN_DIR },
      moonDir: { value: MOON_DIR },
      time: { value: 0 },
      stars: { value: 1 },
      cFog: { value: SKY.fog },
    },
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

export interface SkyParts {
  group: THREE.Group;
  skyMat: THREE.ShaderMaterial;
  dispose(): void;
}

export function buildSky(quality: 'low' | 'medium' | 'high'): SkyParts {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const skyMat = skyMaterial();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(320, 48, 24), skyMat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);
  disposables.push(dome.geometry, skyMat);

  // Moon: bright disc (blooms) + soft halo.
  const mt = moonTex();
  const moonMat = new THREE.MeshBasicMaterial({ map: mt, color: new THREE.Color(4.2, 4.0, 3.6), transparent: true, fog: false, depthWrite: false });
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), moonMat);
  moon.position.copy(MOON_DIR).multiplyScalar(290);
  moon.lookAt(0, 0, 0);
  moon.renderOrder = -9;
  group.add(moon);
  disposables.push(mt, moonMat, moon.geometry);

  // Mountains: 3 ring layers, vertex colored, fog does the aerial perspective.
  const layers = [
    { r: 280, base: 16, amp: 40, col: '#3e4f6a', seed: 1, freq: 3, haze: 0.62 },
    { r: 230, base: 4, amp: 30, col: '#2e3a54', seed: 2, freq: 5, haze: 0.42 },
    { r: 190, base: -6, amp: 18, col: '#232b40', seed: 3, freq: 8, haze: 0.22 },
  ];
  const mgeos: THREE.BufferGeometry[] = [];
  const segs = quality === 'low' ? 96 : 192;
  for (const L of layers) {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const c = new THREE.Color(L.col).lerp(SKY.horizon, L.haze * 0.55);
    const cTop = c.clone().lerp(SKY.pink, 0.15);
    const cBot = new THREE.Color(L.col).lerp(SKY.fog, 0.35 + L.haze * 0.6);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = Math.cos(a), z = Math.sin(a);
      const n = fbm3(x * L.freq * 0.5 + 10, z * L.freq * 0.5, L.seed, 5, L.seed);
      const ridge = 1 - Math.abs(fbm3(x * L.freq + 4, z * L.freq, L.seed + 9, 3, L.seed) * 2 - 1);
      const hgt = L.base + (n * 0.75 + ridge * 0.35) * L.amp - 14;
      pos.push(x * L.r, hgt, z * L.r, x * L.r, -30, z * L.r);
      col.push(cTop.r, cTop.g, cTop.b, cBot.r, cBot.g, cBot.b);
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    mgeos.push(g);
  }
  const mg = mergeGeometries(mgeos)!;
  mgeos.forEach((g) => g.dispose());
  const mMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
  const mountains = new THREE.Mesh(mg, mMat);
  mountains.renderOrder = -8;
  group.add(mountains);
  disposables.push(mg, mMat);

  // Distant city: instanced blocks with lit windows + hip roofs; a couple of tiered towers.
  const r = rng(808);
  const count = quality === 'low' ? 110 : 240;
  const boxG = new THREE.BoxGeometry(1, 1, 1);
  boxG.translate(0, 0.5, 0);
  const roofG = new THREE.ConeGeometry(0.78, 1, 4, 1);
  roofG.rotateY(Math.PI / 4);
  roofG.translate(0, 0.5, 0);
  const wt = windowTex();
  const bMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, emissive: '#ffffff', emissiveMap: wt, emissiveIntensity: 1.6 });
  const rMat = new THREE.MeshStandardMaterial({ color: '#2a2d36', roughness: 0.7, metalness: 0.1 });
  const extraTiers = 2 * 5;
  const blocks = new THREE.InstancedMesh(boxG, bMat, count + extraTiers);
  const roofs = new THREE.InstancedMesh(roofG, rMat, count + extraTiers);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
  let bi = 0, ri = 0;
  const cols = ['#1c2030', '#2a2226', '#3a2e2c', '#202a30', '#302832'].map((c) => new THREE.Color(c));
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const far = i % 2 === 0;
    const rad = far ? 85 + r() * 85 : 50 + r() * 40;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const w = 7 + r() * 12, d = 7 + r() * 12;
    const top = far ? -12 + r() * 10 + (rad - 85) * 0.06 : -24 + r() * 12;
    const base = -90;
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a + (r() - 0.5) * 0.5);
    P.set(x, base, z);
    S.set(w, top - base, d);
    M.compose(P, Q, S);
    blocks.setColorAt(bi, cols[Math.floor(r() * cols.length)]);
    blocks.setMatrixAt(bi++, M);
    if (r() < 0.75) {
      P.set(x, top, z);
      S.set(w * 1.15, 2 + r() * 3, d * 1.15);
      M.compose(P, Q, S);
      roofs.setMatrixAt(ri++, M);
    }
  }
  // Two tiered towers on the skyline (silhouettes against the horizon glow).
  for (const [tx, tz, tiers] of [[-130, 70, 5], [105, -140, 5]] as const) {
    let y = -24;
    for (let k = 0; k < tiers; k++) {
      const w = 12 - k * 1.6;
      const h = 7;
      Q.identity();
      P.set(tx, k === 0 ? -90 : y, tz);
      S.set(w * 0.7, k === 0 ? y + h + 90 : h, w * 0.7);
      M.compose(P, Q, S);
      blocks.setColorAt(bi, cols[0]);
      blocks.setMatrixAt(bi++, M);
      y += h;
      P.set(tx, y - 0.5, tz);
      S.set(w * 1.5, 3.2, w * 1.5);
      M.compose(P, Q, S);
      roofs.setMatrixAt(ri++, M);
    }
  }
  blocks.count = bi;
  roofs.count = ri;
  group.add(blocks, roofs);
  disposables.push(boxG, roofG, wt, bMat, rMat);

  return {
    group,
    skyMat,
    dispose() {
      disposables.forEach((d) => d.dispose());
      blocks.dispose();
      roofs.dispose();
    },
  };
}

/** PMREM environment from a dusk sky + warm lantern glints so robot metals pick up the mood. */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene();
  const mat = skyMaterial();
  mat.uniforms.stars.value = 0;
  // In the PMREM cube camera the dome must be inside the far plane: use a regular projection.
  mat.vertexShader = 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
  const geo = new THREE.SphereGeometry(40, 48, 24);
  scene.add(new THREE.Mesh(geo, mat));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(39, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color('#2a2226') }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3;
  scene.add(ground);
  const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3, 1.2) });
  const lg = new THREE.SphereGeometry(0.6, 12, 8);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4;
    const m = new THREE.Mesh(lg, warm);
    m.position.set(Math.cos(a) * 12, 0.5 + (i % 2) * 2.5, Math.sin(a) * 12);
    scene.add(m);
  }
  const moonM = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 3.6) }));
  moonM.position.copy(MOON_DIR).multiplyScalar(36);
  scene.add(moonM);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.035);
  pm.dispose();
  geo.dispose();
  mat.dispose();
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  warm.dispose();
  lg.dispose();
  moonM.geometry.dispose();
  (moonM.material as THREE.Material).dispose();
  return rt;
}
