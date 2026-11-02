import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paintRingWindows } from './deckTex';
import { rng } from '../../render/textures';

export const SUN_DIR = new THREE.Vector3(0.58, 0.2, -0.79).normalize();
// Planet: center direction (unit), angular radius 85 deg (|C| = 1, radius = sin(rho)).
export const PLANET_C = new THREE.Vector3(-Math.cos((27 * Math.PI) / 180), -Math.sin((27 * Math.PI) / 180), 0.0).normalize();
export const PLANET_RHO = (70 * Math.PI) / 180;

const NOISE = /* glsl */ `
float h3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a*n3(p); p = p*2.03 + vec3(1.7,9.2,3.1); a *= 0.5; } return s; }
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++){ s += a*n3(p); p = p*2.03 + vec3(1.7,9.2,3.1); a *= 0.5; } return s*1.143; }
`;

function skyDome(quality: string): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSun: { value: SUN_DIR },
      uPC: { value: PLANET_C },
      uPR: { value: Math.sin(PLANET_RHO) },
      uTime: { value: 0 },
    },
    defines: { HQ: quality === 'low' ? 0 : 1 },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = position; vec4 p = projectionMatrix*vec4(mat3(viewMatrix)*position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uPC; uniform float uPR, uTime;
      varying vec3 vDir;
      ${NOISE}
      void main(){
        vec3 d = normalize(vDir);
        vec3 col = vec3(0.003,0.005,0.014);
        // nebula wash along a band
        vec3 bandN = normalize(vec3(0.3, 0.62, 0.72));
        float bd = dot(d, bandN);
        float band = exp(-bd*bd*4.0);
        float n1 = fbm3(d*2.4 + vec3(4.0));
        #if HQ
        float n2 = fbm(d*5.2 + n1*1.6);
        #else
        float n2 = fbm3(d*5.2 + n1*1.6);
        #endif
        float neb = smoothstep(0.35, 0.9, n1*0.65 + n2*0.55);
        float dust = smoothstep(0.45, 0.75, fbm3(d*9.0 + 2.0));
        col += mix(vec3(0.06,0.018,0.13), vec3(0.015,0.05,0.14), n2) * neb * band * 0.75 * (1.0 - dust*0.6);
        col += vec3(0.2,0.05,0.24) * pow(smoothstep(0.55, 0.95, n2), 3.0) * band * 0.45;
        col += vec3(0.006,0.01,0.03) * band;
        // sun + glare
        float sd = max(dot(d, uSun), 0.0);
        col += vec3(1.0,0.93,0.86) * (smoothstep(0.99975, 0.99988, sd)*40.0 + pow(sd, 900.0)*2.5 + pow(sd, 90.0)*0.18 + pow(sd, 10.0)*0.025);
        vec3 sR = normalize(cross(uSun, vec3(0.0,1.0,0.0)));
        vec3 sU = cross(sR, uSun);
        float sx = dot(d, sR); float sy = dot(d, sU);
        col += vec3(0.55,0.72,1.0) * exp(-abs(sy)*320.0) * exp(-abs(sx)*5.0) * step(0.0, dot(d, uSun)) * 0.7;
        // planet
        float b = dot(d, uPC);
        float disc = b*b - (1.0 - uPR*uPR);
        if (disc > 0.0 && b > 0.0) {
          float t = b - sqrt(disc);
          vec3 P = d*t;
          vec3 N = (P - uPC)/uPR;
          float ang = uTime*0.003;
          mat3 rot = mat3(cos(ang),0.0,sin(ang), 0.0,1.0,0.0, -sin(ang),0.0,cos(ang));
          vec3 q = rot*N;
          vec3 wq = q*10.0 + vec3(fbm3(q*6.0), fbm3(q*6.0 + 7.3), fbm3(q*6.0 + 3.1))*1.8;
          float c = fbm(wq);
          float land = smoothstep(0.575, 0.6, c);
          float coast = smoothstep(0.5, 0.575, c)*(1.0 - land);
          vec3 ocean = mix(vec3(0.003,0.012,0.045), vec3(0.01,0.05,0.11), coast + 0.3*fbm3(q*40.0));
          float biome = fbm3(q*30.0 + 3.0);
          vec3 ground = mix(vec3(0.02,0.045,0.025), vec3(0.085,0.07,0.045), smoothstep(0.35, 0.7, biome));
          ground *= 0.7 + 0.6*fbm3(q*90.0);
          vec3 alb = mix(ocean, ground, land);
          #if HQ
          float cn = fbm(q*24.0 + vec3(fbm3(q*8.0 + uTime*0.004))*2.5);
          #else
          float cn = fbm3(q*24.0 + vec3(fbm3(q*8.0))*2.5);
          #endif
          float cl = smoothstep(0.54, 0.66, cn + 0.12*(n3(q*260.0) - 0.5));
          float ndl = dot(N, uSun);
          float day = smoothstep(-0.1, 0.35, ndl);
          vec3 surf = mix(alb*day*1.3, vec3(0.62,0.68,0.78)*day, cl*0.85);
          vec3 refl = reflect(d, N);
          surf += vec3(1.0,0.9,0.75) * pow(max(dot(refl, uSun), 0.0), 40.0) * (1.0 - land) * (1.0 - cl) * 0.6;
          float city = smoothstep(0.62, 0.8, n3(q*420.0)) * smoothstep(0.45, 0.7, n3(q*90.0)) * land;
          surf += vec3(1.0,0.58,0.24) * city * (1.0 - smoothstep(-0.2, 0.02, ndl)) * 1.6 * (1.0 - cl*0.85);
          float below = asin(uPR) - acos(clamp(b, -1.0, 1.0)); // radians below the limb
          float haze = exp(-below*9.0);
          float sunlit = smoothstep(-0.3, 0.45, ndl);
          vec3 atm = mix(vec3(0.05,0.12,0.32), vec3(0.32,0.62,1.0), exp(-below*40.0));
          surf = mix(surf, atm*(0.08 + 1.0*sunlit), clamp(haze*0.92, 0.0, 1.0));
          surf += vec3(0.35,0.65,1.0) * exp(-below*120.0) * (0.25 + 1.1*sunlit);
          surf += vec3(0.8,0.35,0.6) * exp(-pow(ndl*6.0, 2.0)) * 0.05 * haze;
          col = surf;
        } else {
          float angD = acos(clamp(b, -1.0, 1.0)) - asin(uPR);
          vec3 limbN = normalize(d - uPC*b);
          float sunlit = smoothstep(-0.45, 0.5, dot(limbN, uSun));
          float x = max(angD, 0.0);
          float hz = exp(-x*55.0)*(0.25 + 1.2*sunlit) + exp(-x*12.0)*0.12*(0.2 + sunlit);
          col = col*(1.0 - exp(-x*30.0)*0.8) + vec3(0.3,0.6,1.0)*hz + vec3(0.5,0.3,0.9)*exp(-x*18.0)*0.05;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
  m.frustumCulled = false;
  m.renderOrder = 1000; // after opaque world: only uncovered pixels pay for the shader
  return m;
}

function starfield(count: number): THREE.Points {
  const r = rng(1337);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = r() * 2 - 1;
    const a = r() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * s, u, Math.sin(a) * s], i * 3);
    const big = r() < 0.04;
    const b = big ? 1.4 + r() * 2.2 : 0.18 + r() * r() * 0.8;
    const tint = r();
    const c = tint < 0.3 ? [0.75, 0.85, 1.0] : tint < 0.5 ? [1.0, 0.85, 0.7] : [0.95, 0.95, 1.0];
    col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    size[i] = big ? 2.6 + r() * 1.5 : 1.3 + r() * 1.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uPC: { value: PLANET_C }, uCos: { value: Math.cos(PLANET_RHO + 0.03) }, uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aCol; attribute float aSize; uniform vec3 uPC; uniform float uCos, uTime, uPx; varying vec3 vC;
      void main(){
        vec3 d = normalize(position);
        float hide = step(uCos, dot(d, uPC));
        float tw = 0.75 + 0.25*sin(uTime*(1.5 + fract(position.x*91.0)*3.0) + position.z*300.0);
        vC = aCol*tw*(1.0 - hide);
        vec4 p = projectionMatrix*vec4(mat3(viewMatrix)*d, 1.0);
        gl_Position = p.xyww;
        gl_PointSize = aSize*uPx*(1.0 - hide);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      void main(){ float l = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, l); gl_FragColor = vec4(vC*a*a, 1.0); }`,
  });
  const p = new THREE.Points(g, mat);
  p.frustumCulled = false;
  p.renderOrder = 1001;
  return p;
}

/** Attach a mesh to the camera position (infinitely distant parallax-free backdrop). */
function attachToCamera(o: THREE.Object3D, local: THREE.Matrix4) {
  o.frustumCulled = false;
  o.matrixAutoUpdate = false;
  o.onBeforeRender = (_r, _s, cam) => {
    o.matrixWorld.copy(local);
    const e = o.matrixWorld.elements;
    e[12] += cam.position.x;
    e[13] += cam.position.y;
    e[14] += cam.position.z;
  };
}

function ringStation(quality: string, disposables: { dispose(): void }[]): THREE.Group {
  const R = 300;
  const W = 22;
  const T = 7;
  const seg = quality === 'low' ? 160 : 300;
  const g = new THREE.Group();
  const win = paintRingWindows();
  win.map.repeat.set(36, 1);
  win.emissive.repeat.set(36, 1);
  const inner = new THREE.MeshStandardMaterial({
    map: win.map,
    emissiveMap: win.emissive,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: 1.3,
    metalness: 0.4,
    roughness: 0.55,
    side: THREE.BackSide,
  });
  const shell = new THREE.MeshStandardMaterial({ color: 0x4a515c, metalness: 0.6, roughness: 0.45 });
  const lights = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.85, 1.0).multiplyScalar(5) });
  disposables.push(win.map, win.emissive, inner, shell, lights);

  const geos: THREE.BufferGeometry[] = [];
  const innerG = new THREE.CylinderGeometry(R, R, W, seg, 1, true);
  const outerG = new THREE.CylinderGeometry(R + T, R + T, W, seg, 1, true);
  const rimTop = new THREE.RingGeometry(R - 0.01, R + T + 0.01, seg, 1);
  rimTop.rotateX(-Math.PI / 2);
  rimTop.translate(0, W / 2, 0);
  const rimBot = new THREE.RingGeometry(R - 0.01, R + T + 0.01, seg, 1);
  rimBot.rotateX(Math.PI / 2);
  rimBot.translate(0, -W / 2, 0);
  // ribs + rim walls (raised parapets on both edges)
  const nR = quality === 'low' ? 36 : 72;
  const rib = new THREE.BoxGeometry(3.5, W + 6, 5);
  const wall = new THREE.BoxGeometry(2, 4, (2 * Math.PI * R) / nR + 0.3);
  const ribs: THREE.BufferGeometry[] = [];
  const lamp: THREE.BufferGeometry[] = [];
  const lampG = new THREE.BoxGeometry(0.6, 0.6, 3.0);
  for (let i = 0; i < nR; i++) {
    const a = (i / nR) * Math.PI * 2;
    const m = new THREE.Matrix4().makeRotationY(-a);
    m.setPosition(Math.cos(a) * (R - 0.8), 0, Math.sin(a) * (R - 0.8));
    ribs.push(rib.clone().applyMatrix4(m));
    for (const y of [W / 2 + 1.2, -W / 2 - 1.2]) {
      const m2 = new THREE.Matrix4().makeRotationY(-a + Math.PI / 2);
      const a2 = a + Math.PI / nR;
      m2.setPosition(Math.cos(a2) * (R + 1), y, Math.sin(a2) * (R + 1));
      ribs.push(wall.clone().applyMatrix4(m2));
    }
    if (i % 2 === 0) {
      const m3 = new THREE.Matrix4().makeRotationY(-a);
      m3.setPosition(Math.cos(a) * (R - 2.1), W / 2 + 2.2, Math.sin(a) * (R - 2.1));
      lamp.push(lampG.clone().applyMatrix4(m3));
      const m4 = m3.clone();
      m4.setPosition(Math.cos(a) * (R - 2.1), -W / 2 - 2.2, Math.sin(a) * (R - 2.1));
      lamp.push(lampG.clone().applyMatrix4(m4));
    }
  }
  geos.push(outerG, rimTop, rimBot);
  const shellG = mergeGeometries([...geos.map((x) => x.toNonIndexed()), ...ribs.map((x) => x.toNonIndexed())], false)!;
  const lampMerged = mergeGeometries(lamp.map((x) => x.toNonIndexed()), false)!;
  for (const x of [...geos, ...ribs, ...lamp, rib, wall, lampG]) x.dispose();
  disposables.push(innerG, shellG, lampMerged);

  const meshes = [new THREE.Mesh(innerG, inner), new THREE.Mesh(shellG, shell), new THREE.Mesh(lampMerged, lights)];
  // Orientation: ring axis tilted so the arc rises from the horizon ahead and sweeps overhead.
  // Ring center sits along -axis from the viewer, so the ring traces a big arc in the sky.
  const axis = new THREE.Vector3(-0.75, 0.45, 0.08).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  const local = new THREE.Matrix4().compose(axis.clone().multiplyScalar(-52), q, new THREE.Vector3(1, 1, 1));
  for (const m of meshes) {
    attachToCamera(m, local);
    g.add(m);
  }
  return g;
}

/** Sleek transport ship (hull, wings, engine glow) merged into 3 meshes. */
function makeShip(mats: { hull: THREE.Material; dark: THREE.Material; glow: THREE.Material }, scale: number): THREE.Group {
  const grp = new THREE.Group();
  const prof = [
    [0, -3],
    [0.5, -2.9],
    [0.75, -2],
    [0.85, 0.6],
    [0.6, 2.4],
    [0.25, 3.3],
    [0, 3.5],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const hull = new THREE.LatheGeometry(prof, 10);
  hull.rotateX(Math.PI / 2); // nose along +z
  hull.scale(1, 0.7, 1);
  const ws = new THREE.Shape();
  ws.moveTo(0.4, -2);
  ws.lineTo(3.4, -2.6);
  ws.lineTo(3.6, -2.0);
  ws.lineTo(0.6, 1.2);
  ws.closePath();
  const wing = new THREE.ExtrudeGeometry(ws, { depth: 0.12, bevelEnabled: false });
  wing.rotateX(Math.PI / 2);
  const wingL = wing.clone().scale(-1, 1, 1);
  const fin = new THREE.BoxGeometry(0.1, 1.1, 1.5).translate(0, 0.8, -2.2);
  const eng = new THREE.CylinderGeometry(0.35, 0.42, 1.6, 10).rotateX(Math.PI / 2);
  const engines = [eng.clone().translate(1.1, -0.1, -2.4), eng.clone().translate(-1.1, -0.1, -2.4)];
  const glowG = [
    new THREE.CircleGeometry(0.3, 12).rotateY(Math.PI).translate(1.1, -0.1, -3.22),
    new THREE.CircleGeometry(0.3, 12).rotateY(Math.PI).translate(-1.1, -0.1, -3.22),
    new THREE.BoxGeometry(0.6, 0.08, 0.3).translate(0, 0.42, 1.6),
  ];
  const mk = (list: THREE.BufferGeometry[], mat: THREE.Material) => {
    const merged = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)).map((x) => {
      for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') x.deleteAttribute(k);
      return x;
    }), false)!;
    const m = new THREE.Mesh(merged, mat);
    grp.add(m);
  };
  mk([hull, wing, wingL], mats.hull);
  mk([fin, ...engines], mats.dark);
  mk(glowG, mats.glow);
  grp.scale.setScalar(scale);
  return grp;
}

export interface SpaceBackdrop {
  group: THREE.Group;
  update(time: number): void;
  dispose(): void;
}

export function buildBackdrop(quality: string): SpaceBackdrop {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const sky = skyDome(quality);
  const stars = starfield(quality === 'low' ? 1200 : 2600);
  group.add(sky, stars);
  disposables.push(sky.geometry, sky.material as THREE.Material, stars.geometry, stars.material as THREE.Material);
  group.add(ringStation(quality, disposables));

  // Ships drifting past at a distance.
  const hull = new THREE.MeshStandardMaterial({ color: 0xc9d0da, metalness: 0.3, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f37, metalness: 0.7, roughness: 0.4 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.75, 1.0).multiplyScalar(6) });
  disposables.push(hull, dark, glow);
  const ships: { o: THREE.Group; a: THREE.Vector3; b: THREE.Vector3; T: number; off: number }[] = [];
  const shipDefs = [
    { a: new THREE.Vector3(-260, 38, -150), b: new THREE.Vector3(260, 58, -190), T: 140, off: 30, s: 2.4 },
    { a: new THREE.Vector3(240, 18, 120), b: new THREE.Vector3(-240, 44, 170), T: 170, off: 100, s: 3.2 },
    { a: new THREE.Vector3(-120, 70, 200), b: new THREE.Vector3(160, 30, -260), T: 120, off: 10, s: 1.6 },
  ];
  for (const d of quality === 'low' ? shipDefs.slice(0, 1) : shipDefs) {
    const o = makeShip({ hull, dark, glow }, d.s);
    group.add(o);
    ships.push({ o, a: d.a, b: d.b, T: d.T, off: d.off });
  }
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && ships.some((s) => s.o === m.parent)) disposables.push(m.geometry);
  });

  const tmp = new THREE.Vector3();
  return {
    group,
    update(time: number) {
      (sky.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      const sm = stars.material as THREE.ShaderMaterial;
      sm.uniforms.uTime.value = time;
      sm.uniforms.uPx.value = Math.min(window.devicePixelRatio || 1, 2);
      for (const s of ships) {
        const u = ((time + s.off) % s.T) / s.T;
        s.o.position.lerpVectors(s.a, s.b, u);
        s.o.position.y += Math.sin(time * 0.2 + s.off) * 2;
        tmp.subVectors(s.b, s.a).add(s.o.position);
        s.o.lookAt(tmp);
        s.o.rotateZ(Math.sin(time * 0.15 + s.off) * 0.08);
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
