import * as THREE from 'three';
import type { Rig } from './rig';
import { PartBuilder, rbox, plate, chamferBox, cyl, sphere, torus, xf, vents, lathe, boltRing } from './kit';
import type { GunDef, BombDef, PodDef } from '../data/parts';
import type { MatSet } from './kit';

// Accept the new visual keys before the gameplay catalog lands.
type VisualGun = Omit<GunDef, 'model'> & { model: GunDef['model'] | 'beam' | 'homer' };
type VisualBomb = Omit<BombDef, 'model'> & { model: BombDef['model'] | 'napalm' | 'bouncer' };
type VisualPod = Omit<PodDef, 'model'> & { model: PodDef['model'] | 'turret' | 'interceptor' };

/**
 * Weapon visuals. The gun hangs off the right elbow with its barrel along local -Y
 * (the arm points at the target when aiming). Bomb launchers sit on the left
 * shoulder, pods dock on the back. Each returns extra nodes the animator drives.
 */

export interface WeaponNodes {
  /** Recoiling barrel group. */
  barrel: THREE.Group;
  /** Charge glow mesh (rail) — scaled by charge amount. */
  chargeGlow: THREE.Mesh | null;
  /** Bomb launcher pivot (pitches up when firing). */
  launcher: THREE.Group;
  /** Visible pod(s) docked on the back; hidden while the pod is on cooldown. */
  podDock: THREE.Group;
}

export function buildGun(def: VisualGun, rig: Rig, b: PartBuilder, glowMat: THREE.Material): { barrel: THREE.Group; chargeGlow: THREE.Mesh | null } {
  const m = rig.gunMount;
  const F = rig.spec.forearm;
  m.position.set(-0.115, -F * 0.45, 0.0);
  const barrel = new THREE.Group();
  barrel.name = 'barrel';
  m.add(barrel);
  let chargeGlow: THREE.Mesh | null = null;
  if (def.model === 'beam') {
    b.add(m, 'dark', chamferBox(0.13, 0.29, 0.16, 0.035));
    b.add(m, 'secondary', xf(chamferBox(0.14, 0.09, 0.17, 0.025), [0, 0.09, 0]));
    b.add(barrel, 'dark', xf(cyl(0.044, 0.044, 0.48, 12), [0, -0.34, 0.02]));
    for (let i = 0; i < 4; i++) {
      const y = -0.18 - i * 0.12;
      b.add(barrel, 'chrome', xf(torus(0.072 - i * 0.006, 0.013, 16, 6), [0, y, 0.02], [Math.PI / 2, 0, 0]));
      b.add(barrel, 'glow', xf(torus(0.052 - i * 0.006, 0.005, 16, 5), [0, y - 0.016, 0.02], [Math.PI / 2, 0, 0]));
    }
    for (const sx of [-1, 1]) b.add(barrel, 'primary', xf(chamferBox(0.035, 0.47, 0.08, 0.015), [sx * 0.075, -0.34, 0.02]));
    chargeGlow = new THREE.Mesh(cyl(0.022, 0.022, 0.43, 12), glowMat);
    chargeGlow.position.set(0, -0.37, 0.02);
    chargeGlow.scale.y = 0.001;
    barrel.add(chargeGlow);
    rig.muzzle.position.set(0, -0.63, 0.02);
  } else if (def.model === 'homer') {
    b.add(m, 'dark', chamferBox(0.12, 0.27, 0.13, 0.03));
    for (const sx of [-1, 1]) {
      b.add(barrel, 'primary', xf(chamferBox(0.085, 0.35, 0.105, 0.023), [sx * 0.085, -0.16, 0]));
      b.add(barrel, 'dark', xf(cyl(0.033, 0.033, 0.31, 12), [sx * 0.085, -0.18, 0]));
      b.add(barrel, 'chrome', xf(torus(0.034, 0.008, 12, 6), [sx * 0.085, -0.34, 0], [Math.PI / 2, 0, 0]));
      b.add(barrel, 'glowHot', xf(cyl(0.022, 0.022, 0.006, 10), [sx * 0.085, -0.338, 0]));
      b.add(barrel, 'secondary', xf(chamferBox(0.09, 0.045, 0.11, 0.012), [sx * 0.085, -0.08, 0]));
    }
    rig.muzzle.position.set(0, -0.37, 0);
  } else if (def.model === 'blaster') {
    // receiver hugging the forearm
    b.add(m, 'dark', xf(chamferBox(0.09, 0.28, 0.14, 0.03), [0, 0, 0]));
    b.add(m, 'secondary', xf(chamferBox(0.095, 0.08, 0.145, 0.02), [0, 0.06, 0]));
    b.add(m, 'trim', xf(rbox(0.05, 0.12, 0.05, 0.012), [-0.06, -0.02, -0.02]));
    for (const g of vents(0.08, 0.1, 3, 0.012)) b.add(m, 'chrome', xf(g, [-0.047, -0.03, 0.0], [0, -Math.PI / 2, 0]));
    // barrel with heat-sink fins
    b.add(barrel, 'dark', xf(cyl(0.035, 0.04, 0.22, 16), [0, -0.24, 0.02]));
    for (let i = 0; i < 4; i++) b.add(barrel, 'chrome', xf(cyl(0.048, 0.048, 0.012, 16), [0, -0.17 - i * 0.035, 0.02]));
    b.add(barrel, 'trim', xf(lathe([[0.03, 0], [0.046, -0.01], [0.05, -0.05], [0.04, -0.06], [0.028, -0.055]], 16), [0, -0.33, 0.02]));
    b.add(barrel, 'glowHot', xf(cyl(0.022, 0.022, 0.01, 12), [0, -0.385, 0.02]));
    rig.muzzle.position.set(0, -0.41, 0.02);
  } else if (def.model === 'scatter') {
    b.add(m, 'dark', xf(chamferBox(0.1, 0.24, 0.16, 0.03), [0, 0.02, 0]));
    b.add(m, 'secondary', xf(chamferBox(0.105, 0.06, 0.165, 0.02), [0, 0.1, 0]));
    // fan of five barrels
    b.add(barrel, 'dark', xf(plate([[-0.13, 0], [0.13, 0], [0.09, 0.14], [-0.09, 0.14]], 0.06, 0.012), [0, -0.12, 0.02], [Math.PI / 2, 0, 0]));
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.22;
      const x = Math.sin(a) * 0.12;
      b.add(barrel, 'chrome', xf(cyl(0.018, 0.022, 0.1, 10), [x, -0.27 - Math.cos(a) * 0.01, 0.02], [0, 0, a]));
      b.add(barrel, 'glowHot', xf(cyl(0.012, 0.012, 0.008, 8), [x * 1.12, -0.322, 0.02], [0, 0, a]));
    }
    b.add(barrel, 'trim', xf(rbox(0.26, 0.03, 0.08, 0.01), [0, -0.21, 0.02]));
    rig.muzzle.position.set(0, -0.34, 0.02);
  } else {
    // rail lance: long split rails with coil rings
    b.add(m, 'dark', xf(chamferBox(0.1, 0.3, 0.14, 0.03), [0, 0.02, 0]));
    b.add(m, 'secondary', xf(chamferBox(0.105, 0.05, 0.145, 0.02), [0, 0.12, 0]));
    for (const sx of [1, -1]) {
      b.add(barrel, 'dark', xf(chamferBox(0.025, 0.55, 0.05, 0.01), [sx * 0.035, -0.4, 0.02]));
      b.add(barrel, 'chrome', xf(rbox(0.01, 0.5, 0.012, 0.003), [sx * 0.02, -0.4, 0.02]));
    }
    for (let i = 0; i < 4; i++) b.add(barrel, 'trim', xf(torus(0.05, 0.012, 16, 6), [0, -0.2 - i * 0.11, 0.02], [Math.PI / 2, 0, 0]));
    const cg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 8), glowMat);
    cg.position.set(0, -0.4, 0.02);
    cg.scale.set(1, 0.001, 1);
    barrel.add(cg);
    chargeGlow = cg;
    rig.muzzle.position.set(0, -0.7, 0.02);
  }
  return { barrel, chargeGlow };
}

export function buildBomb(def: VisualBomb, rig: Rig, b: PartBuilder): THREE.Group {
  const mount = rig.bombMount;
  const launcher = new THREE.Group();
  launcher.name = 'launcher';
  mount.add(launcher);
  // base turret ring
  b.add(mount, 'dark', xf(cyl(0.08, 0.09, 0.05, 16), [0, -0.01, 0]));
  for (const g of boltRing(0.07, 6, 0.008, 0.01)) b.add(mount, 'chrome', xf(g, [0, 0.016, 0], [-Math.PI / 2, 0, 0]));
  launcher.rotation.x = -0.5; // tubes angle forward-up by default
  launcher.position.y = 0.03;
  if (def.model === 'napalm') {
    b.add(launcher, 'dark', xf(chamferBox(0.18, 0.12, 0.18, 0.03), [0, 0.06, 0]));
    b.add(launcher, 'primary', xf(cyl(0.075, 0.075, 0.29, 12), [0, 0.2, 0]));
    for (const y of [0.11, 0.29]) b.add(launcher, 'secondary', xf(cyl(0.083, 0.083, 0.03, 12), [0, y, 0]));
    b.add(launcher, 'dark', xf(cyl(0.057, 0.057, 0.04, 12), [0, 0.355, 0]));
    b.add(launcher, 'glowHot', xf(cyl(0.04, 0.04, 0.006, 12), [0, 0.378, 0]));
    for (const sx of [-1, 1]) b.add(launcher, 'chrome', xf(chamferBox(0.018, 0.2, 0.025, 0.005), [sx * 0.08, 0.2, 0]));
    rig.bombMuzzle.position.set(0, 0.39, 0);
  } else if (def.model === 'bouncer') {
    b.add(launcher, 'dark', xf(cyl(0.12, 0.12, 0.19, 16), [0, 0.13, 0], [0, 0, Math.PI / 2]));
    for (const sx of [-1, 1]) b.add(launcher, 'secondary', xf(cyl(0.125, 0.125, 0.025, 16), [sx * 0.1, 0.13, 0], [0, 0, Math.PI / 2]));
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      b.add(launcher, 'chrome', xf(chamferBox(0.16, 0.025, 0.025, 0.006), [0, 0.13 + Math.cos(a) * 0.12, Math.sin(a) * 0.12], [a, 0, 0]));
    }
    b.add(launcher, 'dark', xf(cyl(0.055, 0.065, 0.14, 12), [0, 0.3, 0]));
    b.add(launcher, 'glowHot', xf(cyl(0.038, 0.038, 0.005, 12), [0, 0.373, 0]));
    rig.bombMuzzle.position.set(0, 0.39, 0);
  } else if (def.model === 'mortar') {
    b.add(launcher, 'dark', xf(cyl(0.075, 0.085, 0.28, 18), [0, 0.13, 0], [0, 0, 0]));
    b.add(launcher, 'secondary', xf(cyl(0.088, 0.088, 0.06, 18), [0, 0.08, 0]));
    b.add(launcher, 'chrome', xf(torus(0.072, 0.012, 18, 6), [0, 0.27, 0], [Math.PI / 2, 0, 0]));
    b.add(launcher, 'glowHot', xf(cyl(0.055, 0.055, 0.005, 14), [0, 0.255, 0]));
    b.add(launcher, 'trim', xf(chamferBox(0.04, 0.16, 0.06, 0.012), [0.085, 0.12, 0]));
    rig.bombMuzzle.position.set(0, 0.32, 0);
  } else {
    b.add(launcher, 'dark', xf(chamferBox(0.2, 0.2, 0.09, 0.03), [0, 0.1, 0]));
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.06;
      b.add(launcher, 'chrome', xf(cyl(0.025, 0.025, 0.22, 12), [x, 0.12, 0.0]));
      b.add(launcher, 'glowHot', xf(cyl(0.017, 0.017, 0.005, 10), [x, 0.232, 0]));
    }
    b.add(launcher, 'secondary', xf(chamferBox(0.22, 0.04, 0.1, 0.012), [0, 0.03, 0]));
    rig.bombMuzzle.position.set(0, 0.28, 0);
  }
  // keep muzzle following the launcher pivot
  launcher.add(rig.bombMuzzle);
  return launcher;
}

export function buildPodDock(def: VisualPod, rig: Rig, b: PartBuilder, glowMat: THREE.Material): THREE.Group {
  const mount = rig.podMount;
  b.add(mount, 'dark', xf(chamferBox(0.16, 0.06, 0.12, 0.02), [0, -0.02, 0]));
  const dock = new THREE.Group();
  dock.name = 'podDock';
  mount.add(dock);
  if (def.model === 'seeker' || def.model === 'turret' || def.model === 'interceptor') {
    const pod = buildPodMesh(def, glowMat, 0.75);
    pod.position.set(0, 0.08, -0.02);
    dock.add(pod);
  } else {
    for (const sx of [1, -1]) {
      const pod = buildPodMesh(def, glowMat, 0.7);
      pod.position.set(sx * 0.12, 0.06, -0.02);
      dock.add(pod);
    }
  }
  return dock;
}

const podMatCache = new Map<number, THREE.Material[]>();

/** Standalone pod mesh: used both for the docked pod and the in-flight drone. */
export function buildPodMesh(def: VisualPod, glowMat: THREE.Material | null, scale = 1): THREE.Group {
  let mats = podMatCache.get(def.color);
  if (!mats) {
    mats = [
      new THREE.MeshPhysicalMaterial({ color: 0x2a2d35, metalness: 0.7, roughness: 0.35, clearcoat: 0.5 }),
      new THREE.MeshPhysicalMaterial({ color: def.color, metalness: 0.3, roughness: 0.3, clearcoat: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: def.color, emissiveIntensity: 5 }),
      new THREE.MeshStandardMaterial({ color: 0xd4d8e0, metalness: 1, roughness: 0.2 }),
    ];
    podMatCache.set(def.color, mats);
  }
  const [dark, paint, glow, chrome] = mats;
  const g = new THREE.Group();
  if (def.model === 'turret' || def.model === 'interceptor') {
    const b = new PartBuilder();
    const mats: MatSet = { primary: paint, secondary: paint, trim: chrome, chrome, dark, joint: dark, glow: glowMat ?? glow, glowHot: glowMat ?? glow, visor: dark, decal: paint };
    if (def.model === 'turret') {
      b.add(g, 'dark', xf(cyl(0.07, 0.1, 0.1, 12), [0, 0.02, 0]));
      b.add(g, 'primary', xf(chamferBox(0.2, 0.1, 0.17, 0.03), [0, 0.1, 0]));
      b.add(g, 'chrome', xf(cyl(0.021, 0.03, 0.22, 12), [0, 0.1, 0.16], [Math.PI / 2, 0, 0]));
      b.add(g, 'glow', xf(cyl(0.015, 0.015, 0.006, 10), [0, 0.1, 0.275], [Math.PI / 2, 0, 0]));
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3;
        b.add(g, 'dark', xf(chamferBox(0.04, 0.045, 0.22, 0.012), [Math.sin(a) * 0.11, -0.05, Math.cos(a) * 0.11], [-0.25, a, 0]));
        b.add(g, 'chrome', xf(chamferBox(0.07, 0.025, 0.08, 0.012), [Math.sin(a) * 0.2, -0.08, Math.cos(a) * 0.2], [0, a, 0]));
      }
    } else {
      b.add(g, 'primary', chamferBox(0.16, 0.09, 0.23, 0.035));
      b.add(g, 'glow', xf(chamferBox(0.075, 0.025, 0.016, 0.006), [0, 0, 0.125]));
      for (const sx of [-1, 1]) {
        b.add(g, 'dark', xf(chamferBox(0.21, 0.025, 0.09, 0.015), [sx * 0.13, 0, -0.025], [0, -sx * 0.25, 0]));
        b.add(g, 'chrome', xf(torus(0.062, 0.014, 16, 6), [sx * 0.22, 0, -0.025], [Math.PI / 2, 0, 0]));
        b.add(g, 'glow', xf(cyl(0.039, 0.039, 0.008, 12), [sx * 0.22, -0.012, -0.025]));
        b.add(g, 'dark', xf(cyl(0.014, 0.018, 0.14, 10), [sx * 0.06, -0.04, 0.13], [Math.PI / 2, 0, 0]));
      }
    }
    b.build(mats);
    g.scale.setScalar(scale);
    return g;
  }
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = mat !== glow;
    g.add(m);
    return m;
  };
  if (def.model === 'seeker') {
    add(new THREE.SphereGeometry(0.13, 20, 14), paint);
    add(xf(new THREE.CylinderGeometry(0.135, 0.135, 0.05, 20), [0, 0, 0]), dark);
    add(xf(new THREE.SphereGeometry(0.05, 14, 10), [0, 0, 0.115]), glowMat ?? glow).scale.set(1, 1, 0.5);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      add(xf(plate([[0, 0], [0.09, 0.02], [0.1, -0.03], [0, -0.06]], 0.015, 0.004), [Math.cos(a) * 0.11, Math.sin(a) * 0.11, -0.06], [0, Math.PI / 2, a], 1), dark);
    }
    add(xf(new THREE.CylinderGeometry(0.03, 0.05, 0.06, 12), [0, 0, -0.14], [Math.PI / 2, 0, 0]), chrome);
  } else {
    add(new THREE.IcosahedronGeometry(0.11, 1), paint);
    const spikeGeo = new THREE.ConeGeometry(0.025, 0.08, 8);
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const pos = ico.getAttribute('position');
    const seen = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
      const key = v.toArray().map((n) => n.toFixed(2)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const s = new THREE.Mesh(spikeGeo, dark);
      s.position.copy(v).multiplyScalar(0.12);
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
      g.add(s);
    }
    add(new THREE.TorusGeometry(0.115, 0.012, 8, 24), glowMat ?? glow).rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(0.04, 10, 8), glowMat ?? glow);
  }
  g.scale.setScalar(scale);
  return g;
}
