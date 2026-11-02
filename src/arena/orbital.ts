import { lightShafts } from '../render/lightShafts';
// Halo Deck — championship platform on an orbital ring station.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ArenaFactory, Collider, Hazard, BoxCollider } from './types';
import { panelMaps, glowSprite, studioEnvironment, decalTexture } from '../render/textures';
import {
  HALF,
  RAIL_SIDE,
  RAIL_CUT,
  DECK_SIDE,
  DECK_CUT,
  TEX_EXTENT,
  DAIS_HALF,
  DAIS_H,
  RAMP_X0,
  RAMP_X1,
  RAMP_HW,
  SPAWN_Z,
  COVER,
  COILS,
  COIL_R,
  COIL_WARN,
  COIL_FIRE,
  COIL_END,
  TOWER_D,
  BOOM_Y,
  BOOM_TIP,
  ELEV,
  coilPhase,
  coilActive,
  coilWarning,
  elevHeight,
  chamferPoly,
  type CoverDef,
} from './orbital/layout';
import { Batcher, M, plate, cutPlate, atlasQuad, wedge, perimeterStrip, polyCap } from './orbital/geo';
import { paintDeck, paintRamp, paintDaisTop, paintBanner, drawCrest, paintDecals } from './orbital/deckTex';
import { ArcBatch, coilOverlayMaterial, conduitMaterial, holoMaterial, fieldMaterial, shaftMaterial } from './orbital/fx';
import { buildBackdrop } from './orbital/sky';

const hdr = (r: number, g: number, b: number, k: number) => new THREE.Color(r, g, b).multiplyScalar(k);

export const createOrbital: ArenaFactory = ({ quality, renderer }) => {
  const low = quality === 'low';
  const root = new THREE.Group();
  root.name = 'arena:orbital';
  if (!low) {
    const shafts = lightShafts(0x89cbff, [[-20, 20, -20], [20, 20, 20]], 20);
    root.add(shafts);
  }
  const ownTextures: THREE.Texture[] = [];
  const own = <T extends THREE.Texture>(t: T) => (ownTextures.push(t), t);

  // ---------------------------------------------------------------- materials
  const pGun = panelMaps(11, 512, 1);
  const pCer = panelMaps(23, 512, 0);
  const gun = new THREE.MeshStandardMaterial({
    color: 0x4a525e,
    metalness: 0.75,
    roughness: 0.4,
    normalMap: pGun.normal,
    roughnessMap: pGun.rough,
    normalScale: new THREE.Vector2(0.7, 0.7),
  });
  const gunDark = new THREE.MeshStandardMaterial({
    color: 0x262b33,
    metalness: 0.65,
    roughness: 0.48,
    normalMap: pGun.normal,
    roughnessMap: pGun.rough,
    normalScale: new THREE.Vector2(0.5, 0.5),
  });
  const ceramic = new THREE.MeshStandardMaterial({
    color: 0x9ea7b4,
    metalness: 0.05,
    roughness: 0.3,
    normalMap: pCer.normal,
    normalScale: new THREE.Vector2(0.35, 0.35),
  });
  const copper = new THREE.MeshStandardMaterial({ color: 0xa8643c, metalness: 1, roughness: 0.28 });
  const trimCyan = new THREE.MeshBasicMaterial({ color: hdr(0.25, 0.85, 1.0, 4.5) });
  const trimViolet = new THREE.MeshBasicMaterial({ color: hdr(0.6, 0.32, 1.0, 4) });
  const trimDim = new THREE.MeshBasicMaterial({ color: hdr(0.25, 0.7, 1.0, 1.6) });
  const lampMat = new THREE.MeshBasicMaterial({ color: hdr(0.85, 0.92, 1.0, 9) });
  const beaconMat = new THREE.MeshBasicMaterial({ color: hdr(0.7, 0.35, 1.0, 5) });

  const deckTex = paintDeck(low ? 1024 : 2048);
  for (const t of Object.values(deckTex)) own(t);
  const floorMat = new THREE.MeshStandardMaterial({
    map: deckTex.map,
    emissiveMap: deckTex.emissive,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: 2.4,
    normalMap: deckTex.normal,
    roughnessMap: deckTex.orm,
    metalnessMap: deckTex.orm,
    roughness: 1,
    metalness: 1,
    envMapIntensity: 0.85,
  });
  const rampTex = paintRamp();
  for (const t of Object.values(rampTex)) own(t);
  const rampMat = new THREE.MeshStandardMaterial({
    map: rampTex.map,
    emissiveMap: rampTex.emissive,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: 2.4,
    normalMap: rampTex.normal,
    metalness: 0.7,
    roughness: 0.42,
  });
  const daisTex = paintDaisTop();
  for (const t of Object.values(daisTex)) own(t);
  const daisTopMat = new THREE.MeshStandardMaterial({
    map: daisTex.map,
    emissiveMap: daisTex.emissive,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: 2.6,
    normalMap: daisTex.normal,
    metalness: 0.7,
    roughness: 0.4,
  });
  const bannerWide = own(paintBanner('wide'));
  const bannerTall = own(paintBanner('tall'));
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x0b0e14,
    metalness: 0.2,
    roughness: 0.15,
    emissive: new THREE.Color(1, 1, 1),
    emissiveMap: bannerWide,
    emissiveIntensity: 1.6,
  });

  const S = new Batcher(); // static, shadow casting
  const SN = new Batcher(); // static, no shadows (emissive trims, far props)

  // ---------------------------------------------------------------- deck
  const deckPoly = chamferPoly(DECK_SIDE, DECK_CUT);
  const railPoly = chamferPoly(RAIL_SIDE, RAIL_CUT);
  const floorMesh = new THREE.Mesh(polyCap(deckPoly, 0, true, TEX_EXTENT * 2, TEX_EXTENT), floorMat);
  floorMesh.receiveShadow = true;
  root.add(floorMesh);
  S.add(ceramic, perimeterStrip(deckPoly, [
    [0, 0],
    [0.14, -0.1],
    [0.14, -0.36],
  ], 3));
  SN.add(trimCyan, perimeterStrip(deckPoly, [
    [0.145, -0.42],
    [0.145, -0.5],
  ]));
  S.add(gun, perimeterStrip(deckPoly, [
    [0.14, -0.56],
    [0.14, -1.2],
    [-0.4, -1.6],
  ], 2));
  S.add(gunDark, polyCap(chamferPoly(DECK_SIDE - 0.4, DECK_CUT - 0.56), -1.6, false));
  // keel: inverted octagonal frustum with light bands
  {
    const keel = new THREE.CylinderGeometry(19.2, 6.5, 8, 8, 1).rotateY(Math.PI / 8);
    S.add(gunDark, keel, M(0, -5.6, 0), 3);
    const keelR = (y: number) => 19.2 - ((-1.6 - y) / 8) * 12.7;
    for (const [y, mat] of [
      [-3.0, trimCyan],
      [-6.4, trimViolet],
    ] as const) {
      const r = keelR(y) + 0.06;
      const band = new THREE.CylinderGeometry(r, r - 0.1, 0.1, 8, 1, true).rotateY(Math.PI / 8);
      SN.add(mat, band, M(0, y, 0));
    }
    // structural ribs down the keel corners + running lights
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
      const r0 = keelR(-1.8) * 0.985;
      const r1 = keelR(-9.4) * 0.985;
      const p0 = new THREE.Vector3(Math.cos(a) * r0, -1.8, Math.sin(a) * r0);
      const p1 = new THREE.Vector3(Math.cos(a) * r1, -9.4, Math.sin(a) * r1);
      const L = p0.distanceTo(p1);
      const rib = new THREE.BoxGeometry(0.5, L, 0.7);
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p0.clone().sub(p1).normalize());
      const rq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      S.add(gun, rib, new THREE.Matrix4().compose(mid, q.multiply(rq), new THREE.Vector3(1, 1, 1)), 2);
      for (const t of [0.25, 0.55, 0.85]) {
        const p = p0.clone().lerp(p1, t);
        p.x += Math.cos(a) * 0.3;
        p.z += Math.sin(a) * 0.3;
        SN.add(i % 2 ? trimViolet : trimCyan, new THREE.SphereGeometry(0.12, 8, 6), M(p.x, p.y, p.z));
      }
    }
    const nozzle = new THREE.CylinderGeometry(3.2, 4.2, 1.6, 16).translate(0, -10.4, 0);
    S.add(gun, nozzle, undefined, 2);
    SN.add(trimCyan, new THREE.CircleGeometry(2.9, 24).rotateX(Math.PI / 2).translate(0, -11.25, 0));
  }

  // ---------------------------------------------------------------- energy barrier rail
  {
    const postG = new RoundedBoxGeometry(0.26, 1.55, 0.26, 2, 0.05);
    const capG = new RoundedBoxGeometry(0.36, 0.12, 0.36, 2, 0.03);
    const baseG = new RoundedBoxGeometry(0.5, 0.1, 0.5, 2, 0.03);
    const bandG = new THREE.BoxGeometry(0.28, 0.06, 0.28);
    const n = railPoly.length;
    for (let i = 0; i < n; i++) {
      const a = railPoly[i];
      const b = railPoly[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const k = Math.max(1, Math.round(L / 3.3));
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (let j = 0; j < k; j++) {
        const t = j / k;
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[1] + (b[1] - a[1]) * t;
        S.add(gunDark, postG, M(x, 0.78, z, -ang), 1);
        S.add(ceramic, capG, M(x, 1.6, z, -ang), 1);
        S.add(gun, baseG, M(x, 0.05, z, -ang), 1);
        SN.add(trimCyan, bandG, M(x, 1.25, z, -ang));
      }
    }
    const a = 0.035;
    SN.add(trimCyan, perimeterStrip(railPoly, [
      [-a, 1.44 - a],
      [-a, 1.44 + a],
      [a, 1.44 + a],
      [a, 1.44 - a],
      [-a, 1.44 - a],
    ]));
    SN.add(trimViolet, perimeterStrip(railPoly, [
      [-0.03, 0.12],
      [-0.03, 0.17],
      [0.03, 0.17],
      [0.03, 0.12],
      [-0.03, 0.12],
    ]));
    const field = new THREE.Mesh(perimeterStrip(railPoly, [
      [0, 0],
      [0, 1.44],
    ]), fieldMaterial(new THREE.Color(0.3, 0.75, 1.0), 0.55));
    field.renderOrder = 5;
    root.add(field);
  }

  // ---------------------------------------------------------------- central dais
  {
    const h = DAIS_H;
    const hw = DAIS_HALF;
    S.add(gunDark, new RoundedBoxGeometry(hw * 2 - 0.1, h - 0.02, hw * 2 - 0.1, 2, 0.05), M(0, (h - 0.02) / 2, 0), 2);
    // ceramic face plates: four faces
    const plateH = 1.7;
    const plateY = 1.18;
    for (const [nx, nz] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const ry = Math.atan2(nx, nz); // plate +z -> face normal
      const spots = nz !== 0 ? [-2.25, 0, 2.25] : [-2.75, 2.75];
      const w = nz !== 0 ? 2.05 : 1.05;
      for (const s of spots) {
        const g = cutPlate(w, plateH, 0.05, Math.min(w, plateH) * 0.3, 0.04);
        const px = nx * (hw - 0.05) + (nz !== 0 ? s : 0);
        const pz = nz * (hw - 0.05) + (nx !== 0 ? s : 0);
        S.add(ceramic, g, M(px, plateY, pz, ry), 2);
        // plate accent line
        SN.add(trimDim, new THREE.BoxGeometry(w * 0.6, 0.04, 0.012), M(px + nx * 0.056, plateY + plateH / 2 - 0.25, pz + nz * 0.056, ry));
      }
      // top lip trim and kick strip
      SN.add(trimCyan, new THREE.BoxGeometry(hw * 2 - 0.12, 0.06, 0.02), M(nx * (hw - 0.04), h - 0.16, nz * (hw - 0.04), ry));
      SN.add(trimViolet, new THREE.BoxGeometry(hw * 2 - 0.12, 0.05, 0.02), M(nx * (hw - 0.04), 0.13, nz * (hw - 0.04), ry));
    }
    for (const [x, z] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      SN.add(trimCyan, new THREE.BoxGeometry(0.05, h - 0.5, 0.05), M(x * (hw - 0.02), h / 2, z * (hw - 0.02)));
    const top = new THREE.PlaneGeometry(hw * 2, hw * 2).rotateX(-Math.PI / 2).translate(0, h, 0);
    const topMesh = new THREE.Mesh(top, daisTopMat);
    topMesh.receiveShadow = true;
    root.add(topMesh);
    // ramps (+x and -x)
    for (const sgn of [1, -1]) {
      const w = wedge(sgn * RAMP_X0, sgn * RAMP_X1, -RAMP_HW, RAMP_HW, h);
      const rm = new THREE.Mesh(w.top, rampMat);
      rm.receiveShadow = true;
      rm.castShadow = true;
      root.add(rm);
      S.add(ceramic, w.sides, undefined, 2);
      // side kick strips along the slope
      for (const zs of [-1, 1]) {
        const len = RAMP_X1 - RAMP_X0;
        const slope = Math.atan2(h, len);
        const bar = new THREE.BoxGeometry(Math.hypot(len, h) - 0.4, 0.04, 0.02);
        SN.add(trimViolet, bar, M(sgn * (RAMP_X0 + len / 2), h / 2 - 0.35, zs * (RAMP_HW + 0.008), 0, 0, sgn * -slope));
      }
    }
  }

  // ---------------------------------------------------------------- cover
  const decalTex = own(paintDecals());
  const decalMat = new THREE.MeshStandardMaterial({ map: decalTex, alphaTest: 0.5, metalness: 0.1, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  let decalIdx = 0;
  const addCover = (c: CoverDef) => {
    const { cx, cz, sx, sz, h } = c;
    S.add(gunDark, new RoundedBoxGeometry(sx - 0.1, h - 0.1, sz - 0.1, 2, 0.04), M(cx, (h - 0.1) / 2, cz), 2);
    S.add(gun, new RoundedBoxGeometry(sx, 0.14, sz, 2, 0.04), M(cx, h - 0.082, cz), 2);
    S.add(ceramic, cutPlate(sx - 0.34, sz - 0.34, 0.03, Math.min(sx, sz) * 0.22, 0.03, 0.008), M(cx, h - 0.03, cz, 0, -Math.PI / 2), 2);
    S.add(gun, new RoundedBoxGeometry(sx, 0.16, sz, 2, 0.03), M(cx, 0.08, cz), 2);
    // faces: [normal x, normal z, face width]
    const faces: [number, number, number][] = [
      [0, 1, sx],
      [0, -1, sx],
      [1, 0, sz],
      [-1, 0, sz],
    ];
    for (const [nx, nz, fw] of faces) {
      const ry = Math.atan2(nx, nz);
      const half = nz !== 0 ? sz / 2 : sx / 2;
      const fx = cx + nx * (half - 0.05);
      const fz = cz + nz * (half - 0.05);
      const big = fw >= 2 || c.kind === 'post';
      const ph = h - 0.62;
      if (big) {
        const isScreen = c.kind === 'barrier' && Math.sign(nz) === -Math.sign(cz);
        if (isScreen) {
          const g = new THREE.PlaneGeometry(fw - 0.5, ph - 0.1);
          S.add(gunDark, plate(fw - 0.3, ph, 0.03, 0.14), M(fx, 0.3 + ph / 2, fz, ry), 2);
          const scr = new THREE.Mesh(g, screenMat);
          scr.position.set(fx + nx * 0.032, 0.3 + ph / 2, fz + nz * 0.032);
          scr.rotation.y = ry;
          root.add(scr);
        } else {
          const pw = fw - 0.3;
          S.add(ceramic, cutPlate(pw, ph, 0.05, Math.min(pw, ph) * 0.28, 0.04), M(fx, 0.3 + ph / 2, fz, ry), 2);
          // dark accent band across the lower plate
          S.add(gunDark, new THREE.BoxGeometry(pw * 0.62, 0.09, 0.012), M(fx + nx * 0.055 - Math.cos(ry) * pw * 0.12, 0.3 + ph * 0.22, fz + nz * 0.055 + Math.sin(ry) * pw * 0.12, ry));
          if (c.kind !== 'post') SN.add(trimCyan, new THREE.BoxGeometry(Math.min(pw * 0.55, 1.4), 0.045, 0.012), M(fx + nx * 0.056 + Math.cos(ry) * pw * 0.15, h - 0.48, fz + nz * 0.056 - Math.sin(ry) * pw * 0.15, ry));
          if (fw >= 2) {
            const ds = Math.min(0.62, ph * 0.45);
            S.add(decalMat, atlasQuad(ds, ds, decalIdx++ % 8, 4, 2), M(fx + nx * 0.054 - Math.cos(ry) * (pw / 2 - ds / 2 - 0.22), 0.3 + ph * 0.58, fz + nz * 0.054 + Math.sin(ry) * (pw / 2 - ds / 2 - 0.22), ry));
          }
        }
      }
      if (!big || c.kind === 'post') {
        if (!big) S.add(ceramic, cutPlate(fw - 0.36, ph, 0.04, 0.12, 0.03), M(fx, 0.3 + ph / 2, fz, ry), 2);
        SN.add(trimViolet, new THREE.BoxGeometry(0.05, ph - 0.3, 0.012), M(fx + nx * (big ? 0.058 : 0.048), 0.3 + ph / 2, fz + nz * (big ? 0.058 : 0.048), ry));
      }
    }
  };
  for (const c of COVER) addCover(c);

  // ---------------------------------------------------------------- corner towers (floodlights + coil emitters)
  const coilGlowMats: THREE.MeshBasicMaterial[] = [];
  const electrodeMats: THREE.MeshBasicMaterial[] = [];
  const electrodeSprites: THREE.Sprite[] = [];
  const shaftMats: THREE.ShaderMaterial[] = [];
  const glowTex = glowSprite(128, 0.2);
  const tipPos: THREE.Vector3[] = [];
  const towerRingPos: THREE.Vector3[] = [];
  for (const coil of COILS) {
    const sx = Math.sign(coil.x);
    const sz = Math.sign(coil.z);
    const tx = sx * TOWER_D;
    const tz = sz * TOWER_D;
    const diag = Math.atan2(-sx, -sz); // yaw facing the arena center
    // bastion pad
    S.add(gun, new THREE.CylinderGeometry(2.55, 2.75, 1.75, 8).rotateY(Math.PI / 8), M(tx, -0.725, tz), 2);
    S.add(ceramic, new THREE.CylinderGeometry(2.6, 2.6, 0.1, 8).rotateY(Math.PI / 8), M(tx, 0.1, tz), 2);
    S.add(gunDark, new THREE.CylinderGeometry(2.2, 2.2, 0.06, 8).rotateY(Math.PI / 8), M(tx, 0.16, tz), 2);
    SN.add(trimCyan, new THREE.CylinderGeometry(2.62, 2.62, 0.05, 8, 1, true).rotateY(Math.PI / 8), M(tx, -0.2, tz));
    // column + fins
    S.add(gun, new THREE.CylinderGeometry(0.5, 0.82, 14, 8).rotateY(Math.PI / 8), M(tx, 7.15, tz), 2);
    for (let i = 0; i < 4; i++) {
      const a = diag + Math.PI / 4 + (i * Math.PI) / 2;
      const fin = new THREE.BoxGeometry(0.14, 7.5, 0.7);
      S.add(ceramic, fin, M(tx + Math.sin(a) * 0.82, 10.6, tz + Math.cos(a) * 0.82, a), 2);
      S.add(ceramic, new THREE.BoxGeometry(0.16, 1.6, 1.1), M(tx + Math.sin(a) * 0.9, 1.0, tz + Math.cos(a) * 0.9, a), 2);
    }
    // coil stack
    const glowM = new THREE.MeshBasicMaterial({ color: hdr(0.6, 0.32, 1.0, 1.5) });
    coilGlowMats.push(glowM);
    const glowGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const y = 2.4 + i * 0.75;
      const ring = new THREE.TorusGeometry(1.08, 0.14, 8, 28).rotateX(Math.PI / 2);
      S.add(copper, ring, M(tx, y, tz));
      if (i < 5) glowGeos.push(new THREE.TorusGeometry(0.95, 0.05, 6, 28).rotateX(Math.PI / 2).translate(tx, y + 0.375, tz));
      towerRingPos.push(new THREE.Vector3(tx, y, tz));
    }
    {
      const b = new Batcher();
      for (const g of glowGeos) b.add(glowM, g);
      b.build(root, false, false);
    }
    // boom arm toward the zone
    const d0 = TOWER_D * Math.SQRT2;
    const d1 = BOOM_TIP * Math.SQRT2;
    const len = d0 - d1;
    const mid = (d0 + d1) / 2 / Math.SQRT2;
    S.add(gun, new RoundedBoxGeometry(0.42, 0.42, len, 2, 0.06), M(sx * mid, BOOM_Y, sz * mid, diag), 2);
    S.add(ceramic, new RoundedBoxGeometry(0.5, 0.12, len * 0.7, 2, 0.04), M(sx * mid, BOOM_Y + 0.26, sz * mid, diag), 2);
    // brace
    {
      const a = new THREE.Vector3(tx, BOOM_Y - 2.2, tz);
      const b = new THREE.Vector3(sx * (mid - 0.4), BOOM_Y - 0.1, sz * (mid - 0.4));
      const L = a.distanceTo(b);
      const g = new THREE.CylinderGeometry(0.09, 0.09, L, 6);
      const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      S.add(gunDark, g, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    }
    // electrode tip
    const tip = new THREE.Vector3(sx * BOOM_TIP, BOOM_Y - 0.55, sz * BOOM_TIP);
    tipPos.push(tip);
    S.add(gunDark, new THREE.CylinderGeometry(0.12, 0.2, 0.6, 8), M(tip.x, BOOM_Y - 0.25, tip.z));
    for (let i = 0; i < 3; i++) S.add(copper, new THREE.TorusGeometry(0.34 - i * 0.07, 0.05, 6, 18).rotateX(Math.PI / 2), M(tip.x, BOOM_Y - 0.3 - i * 0.12, tip.z));
    const em = new THREE.MeshBasicMaterial({ color: hdr(0.65, 0.4, 1.0, 3) });
    electrodeMats.push(em);
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 2), em);
    ball.position.copy(tip);
    root.add(ball);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr(0.6, 0.35, 1, 1.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    spr.position.copy(tip);
    spr.scale.setScalar(1.6);
    root.add(spr);
    electrodeSprites.push(spr);
    // floodlight head (aimed at the arena, pitched down)
    {
      const head = new THREE.Matrix4().compose(
        new THREE.Vector3(tx, 14.6, tz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, diag, 0, 'YXZ')),
        new THREE.Vector3(1, 1, 1),
      );
      const at = (x: number, y: number, z: number, ry = 0, rx = 0) => new THREE.Matrix4().multiplyMatrices(head, M(x, y, z, ry, rx));
      S.add(gun, new RoundedBoxGeometry(2.8, 1.7, 0.55, 2, 0.08), at(0, 0, 0), 2);
      S.add(ceramic, new RoundedBoxGeometry(3.0, 0.16, 0.7, 2, 0.05), at(0, 0.92, 0.02), 2);
      S.add(gunDark, new THREE.BoxGeometry(0.4, 1.0, 0.8), at(0, -0.6, -0.5));
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < 3; c++) {
          const lx = (c - 1) * 0.86;
          const ly = (r - 0.5) * 0.72;
          S.add(gunDark, new THREE.CylinderGeometry(0.36, 0.36, 0.14, 16).rotateX(Math.PI / 2), at(lx, ly, 0.3));
          SN.add(lampMat, new THREE.CircleGeometry(0.29, 16), at(lx, ly, 0.38));
        }
      const lampWorld = new THREE.Vector3(0, 0, 0.6).applyMatrix4(head);
      const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr(0.6, 0.75, 1, 0.9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      fl.position.copy(lampWorld);
      fl.scale.set(5.5, 3.6, 1);
      root.add(fl);
      // beacon
      SN.add(beaconMat, new THREE.SphereGeometry(0.16, 10, 8), M(tx, 15.75, tz));
    }
  }

  // ---------------------------------------------------------------- coil floor overlays + conduits
  const overlayMats: THREE.ShaderMaterial[] = [];
  const conduitMats: THREE.ShaderMaterial[] = [];
  for (const c of COILS) {
    const m = coilOverlayMaterial(COIL_R);
    overlayMats.push(m);
    const s = COIL_R * 1.35 * 2;
    const ov = new THREE.Mesh(new THREE.PlaneGeometry(s, s), m);
    ov.rotation.x = -Math.PI / 2;
    ov.position.set(c.x, 0.012, c.z);
    ov.renderOrder = 4;
    root.add(ov);
    const d0 = 5.9 * Math.SQRT2 * 0.72;
    const d1 = Math.hypot(c.x, c.z) - COIL_R - 0.2;
    const cm = conduitMaterial();
    conduitMats.push(cm);
    const cd = new THREE.Mesh(new THREE.PlaneGeometry(d1 - d0, 0.7), cm);
    const ang = Math.atan2(c.z, c.x);
    cd.rotation.set(-Math.PI / 2, 0, 0);
    cd.rotation.order = 'YXZ';
    cd.rotation.y = -ang;
    const dm = (d0 + d1) / 2;
    cd.position.set(Math.cos(ang) * dm, 0.012, Math.sin(ang) * dm);
    cd.renderOrder = 4;
    root.add(cd);
  }

  // ---------------------------------------------------------------- elevator (hard-light lift)
  const lift = new THREE.Group();
  root.add(lift);
  const liftTop = new THREE.Group();
  lift.add(liftTop);
  let liftCols: THREE.Mesh;
  const pistons: { seg: THREE.Mesh; collar: THREE.Mesh }[] = [];
  let liftField: THREE.Mesh;
  const liftFieldMat = fieldMaterial(new THREE.Color(0.45, 0.55, 1.0), 0.75);
  {
    const hw = ELEV.half;
    const b = new Batcher();
    b.add(gun, new RoundedBoxGeometry(hw * 2, 0.25, hw * 2, 2, 0.05), M(0, -0.125, 0), 2);
    b.add(ceramic, plate(hw * 2 - 0.6, hw * 2 - 0.6, 0.012, 0.3, 0.004), M(0, -0.012, 0, 0, -Math.PI / 2), 2);
    b.add(gunDark, plate(hw * 2 - 1.1, hw * 2 - 1.1, 0.014, 0.25, 0.004), M(0, -0.011, 0, 0, -Math.PI / 2), 2);
    for (const [nx, nz] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ])
      b.add(trimCyan, new THREE.BoxGeometry(hw * 2 - 0.2, 0.05, 0.02), M(nx * (hw + 0.005), -0.13, nz * (hw + 0.005), Math.atan2(nx, nz)));
    b.add(trimViolet, new THREE.CylinderGeometry(0.5, 0.5, 0.006, 24), M(0, 0.001, 0));
    b.add(trimViolet, new THREE.TorusGeometry(1.15, 0.05, 6, 32).rotateX(Math.PI / 2), M(0, -0.26, 0));
    b.add(gunDark, new THREE.CylinderGeometry(1.25, 1.25, 0.08, 24), M(0, -0.29, 0), 2);
    b.build(liftTop, true, true);
    // corner columns (unit height, scaled)
    const cg = new Batcher();
    for (const [x, z] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      cg.add(gunDark, new THREE.BoxGeometry(0.24, 1, 0.24), M(x * (hw - 0.12), 0.5, z * (hw - 0.12)));
    liftCols = cg.build(lift, true, false)[0];
    for (let i = 0; i < 3; i++) {
      const r = 0.95 - i * 0.18;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 20).translate(0, 0.5, 0), i === 1 ? ceramic : gun);
      seg.castShadow = true;
      const collar = new THREE.Mesh(new THREE.TorusGeometry(r + 0.03, 0.045, 6, 24).rotateX(Math.PI / 2), trimCyan);
      lift.add(seg, collar);
      pistons.push({ seg, collar });
    }
    const walls = new THREE.BoxGeometry(hw * 2 - 0.02, 1, hw * 2 - 0.02).translate(0, 0.5, 0);
    // remove top/bottom faces (groups 2 and 3 in BoxGeometry)
    const idx = walls.index!.array as ArrayLike<number>;
    const keep: number[] = [];
    for (const gr of walls.groups) if (gr.materialIndex !== 2 && gr.materialIndex !== 3) for (let i = gr.start; i < gr.start + gr.count; i++) keep.push(idx[i]);
    walls.setIndex(keep);
    walls.clearGroups();
    liftField = new THREE.Mesh(walls, liftFieldMat);
    liftField.renderOrder = 5;
    lift.add(liftField);
    lift.position.set(ELEV.cx, 0, ELEV.cz);
  }

  // ---------------------------------------------------------------- holograms
  const holoMats: THREE.ShaderMaterial[] = [];
  {
    for (const sz of [1, -1]) {
      const m = holoMaterial(bannerWide, new THREE.Color(1, 1, 1), 2.0);
      holoMats.push(m);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(16, 5), m);
      p.position.set(0, 9.4, sz * 25.5);
      p.rotation.y = sz > 0 ? Math.PI : 0;
      p.renderOrder = 7;
      root.add(p);
      for (const y of [6.65, 12.15]) {
        SN.add(gun, new RoundedBoxGeometry(16.8, 0.28, 0.5, 2, 0.08), M(0, y, sz * 25.5), 2);
        SN.add(trimCyan, new THREE.BoxGeometry(16.2, 0.05, 0.52), M(0, y + (y < 9 ? 0.15 : -0.15), sz * 25.5));
      }
      for (const x of [-8.6, 8.6]) SN.add(gunDark, new RoundedBoxGeometry(0.5, 6.2, 0.6, 2, 0.08), M(x, 9.4, sz * 25.5), 2);
    }
    for (const sx of [1, -1])
      for (const sz of [1, -1]) {
        const m = holoMaterial(bannerTall, new THREE.Color(1, 1, 1), 1.8);
        holoMats.push(m);
        const p = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 8), m);
        p.position.set(sx * 24.2, 8.5, sz * 8.5);
        p.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
        p.renderOrder = 7;
        root.add(p);
        for (const y of [4.25, 12.75]) {
          SN.add(gun, new RoundedBoxGeometry(0.5, 0.3, 3.7, 2, 0.08), M(sx * 24.2, y, sz * 8.5), 2);
          SN.add(trimCyan, new THREE.BoxGeometry(0.52, 0.05, 3.3), M(sx * 24.2, y + (y < 8 ? 0.16 : -0.16), sz * 8.5));
        }
      }
  }
  // central crest hologram with rotating rings
  const crestTex = own(
    decalTexture((g, s) => {
      g.clearRect(0, 0, s, s);
      const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      rg.addColorStop(0, 'rgba(80,160,255,0.25)');
      rg.addColorStop(1, 'rgba(80,160,255,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, s, s);
      drawCrest(g, s / 2, s / 2, s * 0.42);
    }, 512),
  );
  const crestMat = holoMaterial(crestTex, new THREE.Color(1, 1, 1), 2.2);
  holoMats.push(crestMat);
  const crest = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), crestMat);
  crest.position.set(0, 9.3, 0);
  crest.renderOrder = 7;
  root.add(crest);
  const ringMat = new THREE.MeshBasicMaterial({ color: hdr(0.3, 0.8, 1.0, 3.2) });
  const ringMat2 = new THREE.MeshBasicMaterial({ color: hdr(0.6, 0.35, 1.0, 3.0) });
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.03, 6, 96), ringMat);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(2.85, 0.022, 6, 96), ringMat2);
  ringA.position.copy(crest.position);
  ringB.position.copy(crest.position);
  root.add(ringA, ringB);
  {
    const sm = shaftMaterial(new THREE.Color(0.35, 0.75, 1.0), 0.09);
    shaftMats.push(sm);
    const H = 9.3 - DAIS_H - 0.4;
    const cone = new THREE.CylinderGeometry(0.3, 2.0, H, 24, 1, true).rotateX(Math.PI);
    const beam = new THREE.Mesh(cone, sm);
    beam.position.set(0, DAIS_H + H / 2, 0);
    beam.renderOrder = 6;
    root.add(beam);
  }

  // ---------------------------------------------------------------- broadcast drones
  const drones: THREE.Group[] = [];
  {
    const tally = new THREE.MeshBasicMaterial({ color: hdr(1.0, 0.15, 0.1, 6) });
    for (let i = 0; i < (low ? 1 : 2); i++) {
      const d = new THREE.Group();
      const b = new Batcher();
      b.add(ceramic, new RoundedBoxGeometry(0.8, 0.45, 1.0, 2, 0.12), undefined, 1);
      b.add(gunDark, new THREE.CylinderGeometry(0.17, 0.2, 0.35, 12).rotateX(Math.PI / 2), M(0, -0.05, 0.6));
      b.add(trimCyan, new THREE.CircleGeometry(0.12, 12), M(0, -0.05, 0.78));
      for (const [x, z] of [
        [0.62, 0.45],
        [-0.62, 0.45],
        [0.62, -0.45],
        [-0.62, -0.45],
      ]) {
        b.add(gun, new THREE.TorusGeometry(0.26, 0.035, 6, 18).rotateX(Math.PI / 2), M(x, 0.12, z));
        b.add(gunDark, new THREE.BoxGeometry(0.4, 0.05, 0.08), M(x * 0.6, 0.1, z * 0.7, Math.atan2(x, z)));
      }
      b.add(tally, new THREE.SphereGeometry(0.06, 8, 6), M(0.25, 0.25, 0.4));
      b.build(d, false, false);
      root.add(d);
      drones.push(d);
    }
  }

  S.build(root, true, true);
  SN.build(root, false, false);

  // ---------------------------------------------------------------- lights
  const keyDir = new THREE.Vector3(0.5, 0.92, -0.6).normalize();
  const keyLight = new THREE.DirectionalLight(0xd2e0ff, 3.0);
  keyLight.position.copy(keyDir).multiplyScalar(60);
  keyLight.target.position.set(0, 0, 0);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  const sc = keyLight.shadow.camera;
  sc.left = -27;
  sc.right = 27;
  sc.top = 27;
  sc.bottom = -27;
  sc.near = 20;
  sc.far = 100;
  keyLight.shadow.bias = -0.0003;
  keyLight.shadow.normalBias = 0.025;
  root.add(keyLight, keyLight.target);
  const rim = new THREE.DirectionalLight(0xb070ff, 1.5);
  rim.position.set(-30, 18, 34);
  root.add(rim);
  root.add(new THREE.HemisphereLight(0x5c78c0, 0x1c1530, 0.6));
  const flash = new THREE.PointLight(0xc8a8ff, 0, 18, 2);
  flash.position.set(0, 2, 0);
  root.add(flash);
  const daisLight = new THREE.PointLight(0x5fd8ff, 5, 11, 2);
  daisLight.position.set(0, DAIS_H + 1.8, 0);
  root.add(daisLight);

  // ---------------------------------------------------------------- space backdrop
  const backdrop = buildBackdrop(quality);
  root.add(backdrop.group);

  // ---------------------------------------------------------------- arcs + impact flash
  const arcs = new ArcBatch(low ? 500 : 900);
  root.add(arcs.mesh);
  const impact = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr(0.7, 0.55, 1, 3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  impact.visible = false;
  root.add(impact);

  // ---------------------------------------------------------------- environment
  const environment = studioEnvironment(renderer, {
    top: 0x31457a,
    bottom: 0x07080f,
    key: 0xd8e6ff,
    rim: 0xa070ff,
    fill: 0x3a5cff,
    intensity: 0.9,
  });

  // ---------------------------------------------------------------- collision
  const colliders: Collider[] = [
    { kind: 'box', min: new THREE.Vector3(-22, -2, -22), max: new THREE.Vector3(22, 0, 22) },
    { kind: 'box', min: new THREE.Vector3(-DAIS_HALF, 0, -DAIS_HALF), max: new THREE.Vector3(DAIS_HALF, DAIS_H, DAIS_HALF) },
    { kind: 'ramp', min: new THREE.Vector3(RAMP_X0, 0, -RAMP_HW), max: new THREE.Vector3(RAMP_X1, DAIS_H, RAMP_HW), axis: 'x', dir: -1 },
    { kind: 'ramp', min: new THREE.Vector3(-RAMP_X1, 0, -RAMP_HW), max: new THREE.Vector3(-RAMP_X0, DAIS_H, RAMP_HW), axis: 'x', dir: 1 },
  ];
  for (const c of COVER)
    colliders.push({
      kind: 'box',
      min: new THREE.Vector3(c.cx - c.sx / 2, 0, c.cz - c.sz / 2),
      max: new THREE.Vector3(c.cx + c.sx / 2, c.h, c.cz + c.sz / 2),
    });
  const liftCol: BoxCollider = {
    kind: 'box',
    min: new THREE.Vector3(ELEV.cx - ELEV.half, 0, ELEV.cz - ELEV.half),
    max: new THREE.Vector3(ELEV.cx + ELEV.half, ELEV.lo, ELEV.cz + ELEV.half),
    vel: new THREE.Vector3(),
  };
  colliders.push(liftCol);

  const hazards: Hazard[] = COILS.map((c) => ({
    center: new THREE.Vector3(c.x, 0, c.z),
    radius: COIL_R,
    yMin: -0.5,
    yMax: 1.4,
    damage: 60,
    down: 35,
    launch: 6,
    isActive: (t: number) => coilActive(t, c.k),
    isWarning: (t: number) => coilWarning(t, c.k),
  }));

  const applyLift = (h: number) => {
    liftTop.position.y = h;
    const colH = Math.max(0.001, h - 0.25);
    liftCols.scale.y = colH;
    liftField.scale.y = colH;
    liftCols.visible = liftField.visible = h - 0.25 > 0.03;
    const len = h - 0.25 - 0.3;
    for (let i = 0; i < 3; i++) {
      const p = pistons[i];
      const segLen = Math.max(0.001, len / 3 + 0.12);
      p.seg.position.y = (i * len) / 3;
      p.seg.scale.y = segLen;
      p.collar.position.y = (i * len) / 3 + 0.04;
      p.seg.visible = p.collar.visible = len > 0.05;
    }
  };
  applyLift(ELEV.lo);

  // ---------------------------------------------------------------- per-frame
  let simT = 0;
  let arcTimer = 0;
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  return {
    info: {
      id: 'orbital',
      name: 'Halo Deck',
      subtitle: 'Orbital Ring Platform',
      blurb: 'A championship stage above the planet. Arc coils electrify the deck.',
      music: 'orbital',
      accent: '#7aa8ff',
    },
    root,
    colliders,
    hazards,
    spawns: [new THREE.Vector3(0, 0, SPAWN_Z), new THREE.Vector3(0, 0, -SPAWN_Z)],
    halfX: HALF,
    halfZ: HALF,
    background: new THREE.Color(0x02030a),
    environment,
    fog: null,
    keyLight,
    tick(t: number, dt: number) {
      simT = t;
      const { h, v } = elevHeight(t + dt);
      liftCol.max.y = h;
      liftCol.vel!.set(0, v, 0);
    },
    update(time: number, dt: number) {
      backdrop.update(time);
      applyLift(liftCol.max.y);
      liftFieldMat.uniforms.uTime.value = time;
      for (const m of holoMats) m.uniforms.uTime.value = time;
      for (const m of shaftMats) m.uniforms.uTime.value = time;
      crest.rotation.y = time * 0.4;
      ringA.rotation.set(Math.PI / 2 - 0.42 + Math.sin(time * 0.3) * 0.08, time * 0.5, 0, 'YXZ');
      ringB.rotation.set(Math.PI / 2 + 0.3 + Math.cos(time * 0.25) * 0.08, -time * 0.35, 0, 'YXZ');
      beaconMat.color.setRGB(0.7, 0.35, 1.0).multiplyScalar(Math.sin(time * 3) > 0.6 ? 7 : 0.6);
      for (const [i, d] of drones.entries()) {
        const a = time * (0.07 + i * 0.02) + i * Math.PI;
        const r = 25 + Math.sin(time * 0.2 + i) * 2;
        d.position.set(Math.cos(a) * r, 10.5 + Math.sin(time * 0.6 + i * 2) * 1.2 + i * 2, Math.sin(a) * r);
        d.lookAt(0, 2, 0);
      }

      // coils
      arcTimer -= dt;
      const regen = arcTimer <= 0;
      if (regen) {
        arcTimer = 1 / 28;
        arcs.begin();
      }
      let flashI = 0;
      let impactOn = false;
      for (let i = 0; i < COILS.length; i++) {
        const c = COILS[i];
        const p = coilPhase(simT, c.k);
        const w = p >= COIL_WARN && p < COIL_FIRE ? (p - COIL_WARN) / (COIL_FIRE - COIL_WARN) : 0;
        const aRaw = p >= COIL_FIRE && p < COIL_END ? (p - COIL_FIRE) / (COIL_END - COIL_FIRE) : -1;
        const a = aRaw >= 0 ? (1 - aRaw * aRaw * 0.7) * (0.75 + 0.25 * Math.random()) : 0;
        // after-glow right after discharge
        const after = p >= COIL_END && p < COIL_END + 0.6 ? 1 - (p - COIL_END) / 0.6 : 0;
        overlayMats[i].uniforms.uTime.value = time;
        overlayMats[i].uniforms.uWarn.value = w;
        overlayMats[i].uniforms.uAct.value = Math.max(a, after * 0.25);
        conduitMats[i].uniforms.uTime.value = time;
        conduitMats[i].uniforms.uWarn.value = w;
        conduitMats[i].uniforms.uAct.value = a;
        const pulse = 0.5 + 0.5 * Math.sin(time * (16 + 20 * w));
        coilGlowMats[i].color.copy(hdr(0.6, 0.32, 1.0, 1.2 + w * (2 + 4 * pulse) + a * 8 + after * 2));
        electrodeMats[i].color.copy(hdr(0.7, 0.45, 1.0, 2.5 + w * 6 * pulse + a * 14));
        const es = electrodeSprites[i];
        es.scale.setScalar(1.4 + w * 1.6 * pulse + a * 4.5);
        es.material.color.copy(hdr(0.6, 0.35, 1, 1.2 + w * 2 + a * 4));
        const tip = tipPos[i];
        if (w > 0 || a > 0) {
          flash.position.set(c.x, a > 0 ? 2.2 : 1.0, c.z);
          flashI = Math.max(flashI, a > 0 ? 160 * a : 10 * w * pulse);
        }
        if (a > 0) {
          impactOn = true;
          impact.position.set(c.x, 0.6, c.z);
          impact.scale.setScalar(5.5 + Math.random() * 2.5);
        }
        if (!regen) continue;
        if (w > 0) {
          // crackles along the zone rim
          const n = 1 + Math.floor(w * 5);
          for (let k = 0; k < n; k++) {
            const a0 = Math.random() * Math.PI * 2;
            const a1 = a0 + (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.5);
            const rr = COIL_R - 0.05 + Math.random() * 0.15;
            tmpA.set(c.x + Math.cos(a0) * rr, 0.05, c.z + Math.sin(a0) * rr);
            tmpB.set(c.x + Math.cos(a1) * rr, 0.05 + Math.random() * 0.1, c.z + Math.sin(a1) * rr);
            arcs.bolt(tmpA, tmpB, { segs: 6, amp: 0.22, width: 0.05, bright: 0.6 + w });
          }
          // tower coil chatter
          for (let k = 0; k < 1 + Math.floor(w * 3); k++) {
            const ri = i * 6 + Math.floor(Math.random() * 5);
            const r0 = towerRingPos[ri];
            const r1 = towerRingPos[ri + 1];
            const an = Math.random() * Math.PI * 2;
            tmpA.set(r0.x + Math.cos(an) * 1.1, r0.y, r0.z + Math.sin(an) * 1.1);
            const an2 = an + (Math.random() - 0.5) * 0.8;
            tmpB.set(r1.x + Math.cos(an2) * 1.1, r1.y, r1.z + Math.sin(an2) * 1.1);
            arcs.bolt(tmpA, tmpB, { segs: 4, amp: 0.12, width: 0.04, bright: 0.9 + w });
          }
          // leader reaching down from the electrode near the end of the telegraph
          if (w > 0.55 && Math.random() < 0.7) {
            const f = ((w - 0.55) / 0.45) * 0.55;
            tmpB.set(c.x, 0, c.z).sub(tip).multiplyScalar(f).add(tip);
            tmpB.x += (Math.random() - 0.5) * 0.8;
            tmpB.z += (Math.random() - 0.5) * 0.8;
            arcs.bolt(tip, tmpB, { segs: 7, amp: 0.35, width: 0.06, bright: 0.9 });
          }
        }
        if (a > 0) {
          const strike = tmpB.set(c.x + (Math.random() - 0.5) * 1.6, 0.02, c.z + (Math.random() - 0.5) * 1.6).clone();
          arcs.bolt(tip, strike, { segs: 16, amp: 0.85, width: 0.24, bright: 1.6, branches: 3 });
          if (Math.random() < 0.6) arcs.bolt(tip, tmpA.set(c.x + (Math.random() - 0.5) * 3, 0.02, c.z + (Math.random() - 0.5) * 3), { segs: 12, amp: 0.7, width: 0.12, bright: 1.1, branches: 1 });
          // ground spider arcs to the rim
          for (let k = 0; k < 6; k++) {
            const an = Math.random() * Math.PI * 2;
            const rr = COIL_R * (0.65 + Math.random() * 0.35);
            tmpA.set(c.x + Math.cos(an) * rr, 0.04, c.z + Math.sin(an) * rr);
            arcs.bolt(strike, tmpA, { segs: 7, amp: 0.3, width: 0.08, bright: 1.1 });
          }
          // tower column discharge
          const ri = i * 6 + Math.floor(Math.random() * 5);
          const r0 = towerRingPos[ri];
          const an = Math.random() * Math.PI * 2;
          tmpA.set(r0.x + Math.cos(an) * 1.1, r0.y, r0.z + Math.sin(an) * 1.1);
          arcs.bolt(tmpA, tip, { segs: 8, amp: 0.4, width: 0.07, bright: 1.0 });
        }
      }
      if (regen) arcs.end();
      flash.intensity = flashI;
      impact.visible = impactOn;
    },
    dispose() {
      arcs.dispose();
      backdrop.dispose();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
      for (const t of ownTextures) t.dispose();
      keyLight.shadow.map?.dispose();
    },
  };
};
