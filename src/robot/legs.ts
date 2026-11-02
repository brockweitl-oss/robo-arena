import * as THREE from 'three';
import type { Rig, Side } from './rig';
import { PartBuilder, rbox, plate, armorShell, chamferBox, trap, cyl, sphere, torus, xf, vents, piston, boltRing, lathe } from './kit';
import type { LegsDef } from '../data/parts';

export interface LegLengths {
  thigh: number;
  shin: number;
  ankleH: number;
  meta: number;
  footLen: number;
}

type VisualLeg = LegsDef['model'] | 'sprint' | 'anchor' | 'feather';

export function legLengths(model: VisualLeg, len: number): LegLengths {
  if (model === 'anchor') return { thigh: 0.38 * len, shin: 0.40 * len, ankleH: 0.11, meta: 0, footLen: 0.42 };
  if (model === 'feather') return { thigh: 0.4 * len, shin: 0.41 * len, ankleH: 0.11, meta: 0, footLen: 0.23 };
  if (model === 'sprint') return { thigh: 0.41 * len, shin: 0.4 * len, ankleH: 0.11, meta: 0, footLen: 0.30 };
  if (model === 'hopper') return { thigh: 0.3 * len, shin: 0.38 * len, ankleH: 0.11, meta: 0.26 * len, footLen: 0.36 };
  return { thigh: 0.4 * len, shin: 0.41 * len, ankleH: 0.11, meta: 0, footLen: 0.34 };
}

function footNozzle(rig: Rig, b: PartBuilder, parent: THREE.Object3D, p: [number, number, number], r: number) {
  const bell = lathe([[r * 0.5, 0.03], [r * 0.7, 0], [r, -0.04], [r * 0.9, -0.045], [r * 0.6, 0.0]], 16);
  b.add(parent, 'dark', xf(bell, p, [-0.6, 0, 0]));
  b.add(parent, 'glowHot', xf(cyl(r * 0.45, r * 0.45, 0.004, 12), [p[0], p[1] - 0.01, p[2] + 0.005], [-0.6, 0, 0]));
  rig.addNozzle(parent, [p[0], p[1] - 0.035, p[2] - 0.022], [-0.6, 0, 0], 'foot');
}

function stride(rig: Rig, b: PartBuilder, side: Side, bulk: number) {
  const sx = side === 'L' ? 1 : -1;
  const T = rig.spec.thigh;
  const S = rig.spec.shin;
  const k = bulk;
  const th = rig.thigh[side];
  // Narrow structural thigh with two overlapping, tapered armor shells.
  b.add(th, 'dark', xf(cyl(0.047 * k, 0.04 * k, T * 0.93, 12), [0, -T * 0.48, 0]));
  const thighTop = armorShell([[-0.078, 0.1], [0, 0.13], [0.075, 0.08], [0.058, -0.12], [0, -0.16], [-0.06, -0.1]], 0.09, 0.025);
  b.add(th, 'primary', xf(thighTop, [sx * 0.008, -T * 0.29, 0.055], [-0.12, sx * 0.08, 0], [k, T / 0.43, k]));
  b.add(th, 'trim', xf(armorShell([[-0.06, 0.04], [0, 0.06], [0.055, 0.03], [0.045, -0.07], [0, -0.1], [-0.045, -0.06]], 0.05, 0.018), [0, -T * 0.7, 0.065], [0.15, 0, 0], k));
  b.add(th, 'chrome', xf(cyl(0.016, 0.016, T * 0.65, 10), [sx * 0.055 * k, -T * 0.5, -0.035]));
  b.add(th, 'glow', xf(rbox(0.004, T * 0.3, 0.005, 0.001), [sx * 0.045 * k, -T * 0.27, 0.11 * k], [-0.12, 0, 0]));
  // knee: joint drum + armored kneecap
  const kn = rig.knee[side];
  b.add(kn, 'joint', xf(cyl(0.07 * k, 0.07 * k, 0.14 * k, 16), [0, 0, 0], [0, 0, Math.PI / 2]));
  for (const g of boltRing(0.045 * k, 6, 0.009, 0.01)) b.add(kn, 'chrome', xf(g, [sx * 0.072 * k, 0, 0], [0, Math.PI / 2, 0]));
  b.add(kn, 'secondary', xf(plate([[-0.07, -0.06], [0.07, -0.06], [0.08, 0.05], [0, 0.1], [-0.08, 0.05]], 0.06, 0.014), [0, 0.01, 0.075 * k], [0.25, 0, 0], k));
  // Swept calf and overlapping shin scales expose a dark mechanical spine.
  b.add(kn, 'dark', xf(cyl(0.052 * k, 0.04 * k, S * 0.88, 12), [0, -S * 0.5, 0]));
  const calf = lathe([[0.035, -S * 0.87], [0.065, -S * 0.7], [0.085, -S * 0.35], [0.07, -S * 0.15], [0.04, -S * 0.1]], 10);
  b.add(kn, 'trim', xf(calf, [0, 0, -0.035], [0, 0, 0], [k, 1, k]));
  for (let i = 0; i < 3; i++) {
    const w = (0.095 - i * 0.012) * k;
    b.add(kn, 'primary', xf(armorShell([[-w, 0.045], [0, 0.065], [w, 0.04], [w * 0.7, -0.055], [0, -0.075], [-w * 0.75, -0.05]], 0.025, 0.014), [0, -S * (0.28 + i * 0.22), (0.12 - i * 0.02) * k], [-0.13 + i * 0.06, 0, 0]));
    b.add(kn, 'glow', xf(rbox(w * 0.6, 0.004, 0.005, 0.001), [sx * w * 0.35, -S * (0.28 + i * 0.22) + 0.038, (0.14 - i * 0.02) * k], [0, 0, -sx * 0.18]));
  }
  // calf thruster + piston
  b.add(kn, 'dark', xf(chamferBox(0.12 * k, S * 0.42, 0.06, 0.02), [0, -S * 0.45, -0.1 * k]));
  for (const g of vents(0.09 * k, S * 0.3, 4, 0.01)) b.add(kn, 'dark', xf(g, [0, -S * 0.45, -0.13 * k], [0, Math.PI, 0]));
  const p = piston(new THREE.Vector3(sx * -0.08 * k, -0.03, -0.03), new THREE.Vector3(sx * -0.08 * k, -S + 0.04, -0.02), 0.015);
  b.add(kn, 'dark', p.body);
  b.add(kn, 'chrome', p.rod);
  // ankle + compact armored foot
  const an = rig.ankle[side];
  const A = rig.spec.ankleH;
  const F = rig.spec.footLen * (0.9 + k * 0.1);
  b.add(an, 'joint', xf(sphere(0.065 * k, 14, 10), [0, 0, 0]));
  b.add(an, 'dark', xf(cyl(0.075 * k, 0.09 * k, 0.05, 14), [0, -A * 0.35, 0]));
  // Separate heel, sloped instep and tapered toe over a continuous sole.
  b.add(an, 'dark', xf(chamferBox(0.15 * k, 0.075, F * 0.35, 0.025), [0, -A + 0.05, -F * 0.22]));
  b.add(an, 'primary', xf(armorShell([[-0.085 * k, -0.045], [0, -0.065], [0.085 * k, -0.045], [0.075 * k, 0.09], [0, 0.12], [-0.075 * k, 0.09]], 0.065, 0.02), [0, -A + 0.08, F * 0.06], [-Math.PI / 2 - 0.22, 0, 0]));
  b.add(an, 'secondary', xf(armorShell([[-0.08 * k, -0.035], [0.08 * k, -0.035], [0.065 * k, 0.06], [0, 0.085], [-0.065 * k, 0.06]], 0.05, 0.008), [0, -A + 0.045, F * 0.35], [-Math.PI / 2, 0, 0]));
  b.add(an, 'joint', xf(chamferBox(0.18 * k, 0.022, F * 0.95, 0.035, 0.004), [0, -A + 0.011, F * 0.07]));
  footNozzle(rig, b, an, [0, -A + 0.06, -F * 0.33], 0.04);
}

function hopper(rig: Rig, b: PartBuilder, side: Side, bulk: number) {
  const sx = side === 'L' ? 1 : -1;
  const T = rig.spec.thigh;
  const S = rig.spec.shin;
  const M = rig.spec.meta;
  const k = bulk * 1.3;
  const th = rig.thigh[side];
  // compact thigh with heavy muscle-armor
  b.add(th, 'dark', xf(cyl(0.06 * k, 0.05 * k, T * 0.9, 12), [0, -T * 0.5, 0]));
  b.add(th, 'primary', xf(armorShell([[-0.075, 0.1], [0, 0.13], [0.075, 0.1], [0.06, -0.1], [0, -0.13], [-0.06, -0.1]], 0.12, 0.025), [sx * 0.01, -T * 0.4, 0.025], [0, 0, 0], k));
  b.add(th, 'trim', xf(chamferBox(0.03, T * 0.5, 0.09, 0.012), [sx * 0.095 * k, -T * 0.4, 0.0]));
  const kn = rig.knee[side];
  b.add(kn, 'joint', xf(cyl(0.065 * k, 0.065 * k, 0.13 * k, 16), [0, 0, 0], [0, 0, Math.PI / 2]));
  b.add(kn, 'secondary', xf(plate([[-0.06, -0.05], [0.06, -0.05], [0.07, 0.04], [0, 0.09], [-0.07, 0.04]], 0.05, 0.012), [0, 0.0, 0.07 * k], [0.3, 0, 0], k));
  // long shin with exposed spring coil
  b.add(kn, 'dark', xf(cyl(0.035, 0.035, S * 0.92, 10), [0, -S * 0.5, -0.02]));
  for (let i = 0; i < 9; i++) b.add(kn, 'chrome', xf(torus(0.055 * k, 0.009, 16, 6), [0, -S * (0.2 + i * 0.07), -0.02], [Math.PI / 2, 0, 0]));
  b.add(kn, 'primary', xf(trap(0.15 * k, 0.11 * k, S * 0.8, 0.09, 0.016), [0, -S * 0.48, 0.07 * k], [Math.PI, 0, 0]));
  b.add(kn, 'dark', xf(chamferBox(0.1 * k, S * 0.5, 0.06, 0.02), [0, -S * 0.45, -0.09 * k]));
  b.add(kn, 'glow', xf(rbox(0.01, S * 0.4, 0.008, 0.003), [0, -S * 0.48, 0.1 * k]));
  // hock (reverse joint)
  const an = rig.ankle[side];
  b.add(an, 'joint', xf(cyl(0.06 * k, 0.06 * k, 0.13 * k, 14), [0, 0, 0], [0, 0, Math.PI / 2]));
  b.add(an, 'secondary', xf(sphere(0.055 * k, 12, 10), [0, 0.0, -0.05], [0, 0, 0], [1, 1, 1.2]));
  // metatarsal strut
  b.add(an, 'primary', xf(chamferBox(0.1 * k, M * 0.85, 0.11 * k, 0.025), [0, -M * 0.5, 0]));
  const pp = piston(new THREE.Vector3(0, -0.02, -0.07), new THREE.Vector3(0, -M + 0.02, -0.05), 0.014);
  b.add(an, 'dark', pp.body);
  b.add(an, 'chrome', pp.rod);
  // splayed three-toe foot
  const ft = rig.hock[side];
  const A = rig.spec.ankleH;
  b.add(ft, 'joint', xf(sphere(0.05 * k, 12, 10), [0, 0, 0]));
  b.add(ft, 'dark', xf(rbox(0.14 * k, 0.08, 0.14, 0.03), [0, -A + 0.045, 0.0]));
  for (const [ang, len] of [[0, 0.32], [0.45, 0.25], [-0.45, 0.25]] as [number, number][]) {
    const toe = xf(rbox(0.075 * k, 0.09, len, 0.03, 2), [0, -A + 0.035, len / 2], [0, ang, 0]);
    b.add(ft, 'primary', toe);
    b.add(ft, 'secondary', xf(trap(0.06 * k, 0.03, 0.05, 0.04, 0.008), [Math.sin(ang) * len, -A + 0.04, Math.cos(ang) * len], [Math.PI / 2, ang, 0]));
  }
  b.add(ft, 'primary', xf(rbox(0.06 * k, 0.06, 0.12, 0.02), [0, -A + 0.03, -0.1]));
  footNozzle(rig, b, ft, [0, -A + 0.07, -0.06], 0.035);
}

export function buildLegs(model: VisualLeg, rig: Rig, b: PartBuilder, bulk: number) {
  for (const side of ['L', 'R'] as Side[]) {
    const sx = side === 'L' ? 1 : -1;
    const k = bulk * (model === 'sprint' ? 0.76 : model === 'anchor' ? 1.22 : model === 'feather' ? 0.72 : 1);
    (model === 'hopper' ? hopper : stride)(rig, b, side, k);
    if (model === 'sprint') {
      b.add(rig.knee[side], 'secondary', xf(armorShell([[-0.05,0.08],[0,0.13],[0.05,0.08],[0.028,-0.22],[0,-0.3],[-0.028,-0.22]],0.035,0.022),[0,-0.12,0.13*k]));
      b.add(rig.ankle[side], 'chrome', xf(plate([[-0.035,-0.08],[0.035,-0.08],[0.022,0.16],[0,0.2],[-0.022,0.16]],0.025,0.004),[0,-0.08,0.05],[-Math.PI/2,0,0]));
      footNozzle(rig,b,rig.ankle[side],[0,-0.025,-0.12],0.055);
      b.add(rig.knee[side], 'secondary', xf(plate([[0, 0.1], [0.055, -0.14], [0.02, -0.3], [-0.02, -0.1]], 0.025, 0.005), [sx * 0.11 * k, -0.1, -0.02], [0, sx * Math.PI / 2, 0]));
    } else if (model === 'anchor') {
      // Wide stabilizer skids and exposed hydraulic braces; teeth end at the sole.
      for (const dx of [-1, 1]) {
        const x = dx * 0.2 * k;
        b.add(rig.ankle[side], 'primary', xf(chamferBox(0.12, 0.065, 0.31, 0.025), [x, -0.075, 0.025]));
        b.add(rig.ankle[side], 'dark', xf(chamferBox(0.28*k,0.05,0.08,0.015),[dx*0.1*k,-0.035,0.02]));
        for (const z of [-0.08,0.13]) b.add(rig.ankle[side], 'chrome', xf(plate([[-0.035,0.04],[0.035,0.04],[0.018,-0.035],[-0.018,-0.035]],0.05,0.004),[x,-0.07,z]));
        const hydraulic=piston(new THREE.Vector3(dx*0.105*k,-0.05,-0.03),new THREE.Vector3(dx*0.13*k,-rig.spec.shin+0.05,-0.03),0.024);
        b.add(rig.knee[side],'dark',hydraulic.body);b.add(rig.knee[side],'chrome',hydraulic.rod);
      }
      b.add(rig.knee[side], 'secondary', xf(armorShell([[-0.13,0.08],[0.13,0.08],[0.11,-0.16],[0,-0.23],[-0.11,-0.16]],0.065,0.025),[0,-0.13,0.14*k]));
    } else if (model === 'feather') {
      for (let i = 0; i < 3; i++) {
        const parent=rig.knee[side], at: [number,number,number]=[sx*0.075,-0.13-i*0.085,-0.05];
        b.add(parent, 'primary', xf(plate([[0,0.04],[0.24,0.14],[0.19,-0.025],[0,-0.06]],0.018,0.004),at,[0,-sx*0.6,0],[sx,1,1]));
        b.add(parent, 'glow', xf(plate([[0.05,0.04],[0.22,0.11],[0.18,0.055],[0.06,0.015]],0.006,0.002),[at[0],at[1],at[2]+0.015],[0,-sx*0.6,0],[sx,1,1]));
      }
      footNozzle(rig, b, rig.knee[side], [sx * 0.1, -0.32, -0.08], 0.035);
    }
  }
}
