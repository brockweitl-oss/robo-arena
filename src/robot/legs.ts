import * as THREE from 'three';
import type { Rig, Side } from './rig';
import { PartBuilder, rbox, plate, chamferBox, trap, cyl, sphere, torus, xf, vents, piston, boltRing, lathe } from './kit';
import type { LegsDef } from '../data/parts';

export interface LegLengths {
  thigh: number;
  shin: number;
  ankleH: number;
  meta: number;
  footLen: number;
}

export function legLengths(model: LegsDef['model'], len: number): LegLengths {
  if (model === 'hopper') return { thigh: 0.3 * len, shin: 0.38 * len, ankleH: 0.11, meta: 0.26 * len, footLen: 0.44 };
  return { thigh: 0.4 * len, shin: 0.41 * len, ankleH: 0.11, meta: 0, footLen: 0.42 };
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
  // thigh: inner frame + chunky armor shell
  b.add(th, 'dark', xf(cyl(0.06 * k, 0.055 * k, T * 0.9, 12), [0, -T * 0.5, 0]));
  b.add(th, 'primary', xf(rbox(0.16 * k, T * 0.62, 0.18 * k, 0.045, 3), [sx * 0.012, -T * 0.42, 0.01]));
  b.add(th, 'trim', xf(chamferBox(0.03, T * 0.42, 0.1 * k, 0.012), [sx * (0.08 * k + 0.012), -T * 0.42, 0.01]));
  for (const g of vents(0.08 * k, 0.07, 3, 0.01)) b.add(th, 'dark', xf(g, [sx * 0.012, -T * 0.3, 0.1 * k]));
  // knee: joint drum + armored kneecap
  const kn = rig.knee[side];
  b.add(kn, 'joint', xf(cyl(0.07 * k, 0.07 * k, 0.14 * k, 16), [0, 0, 0], [0, 0, Math.PI / 2]));
  for (const g of boltRing(0.045 * k, 6, 0.009, 0.01)) b.add(kn, 'chrome', xf(g, [sx * 0.072 * k, 0, 0], [0, Math.PI / 2, 0]));
  b.add(kn, 'secondary', xf(plate([[-0.07, -0.06], [0.07, -0.06], [0.08, 0.05], [0, 0.1], [-0.08, 0.05]], 0.06, 0.014), [0, 0.01, 0.075 * k], [0.25, 0, 0], k));
  // shin: flared armor shell widening to the ankle
  b.add(kn, 'primary', xf(trap(0.17 * k, 0.21 * k, S * 0.78, 0.2 * k, 0.022), [0, -S * 0.5, 0.01], [Math.PI, 0, 0]));
  b.add(kn, 'secondary', xf(chamferBox(0.1 * k, S * 0.4, 0.03, 0.02), [0, -S * 0.42, 0.11 * k]));
  b.add(kn, 'glow', xf(rbox(0.012, S * 0.3, 0.008, 0.003), [0, -S * 0.42, 0.128 * k]));
  // calf thruster + piston
  b.add(kn, 'dark', xf(chamferBox(0.12 * k, S * 0.42, 0.06, 0.02), [0, -S * 0.45, -0.1 * k]));
  for (const g of vents(0.09 * k, S * 0.3, 4, 0.01)) b.add(kn, 'dark', xf(g, [0, -S * 0.45, -0.13 * k], [0, Math.PI, 0]));
  const p = piston(new THREE.Vector3(sx * -0.08 * k, -0.03, -0.03), new THREE.Vector3(sx * -0.08 * k, -S + 0.04, -0.02), 0.015);
  b.add(kn, 'dark', p.body);
  b.add(kn, 'chrome', p.rod);
  // ankle + oversized foot
  const an = rig.ankle[side];
  const A = rig.spec.ankleH;
  const F = rig.spec.footLen * (0.9 + k * 0.1);
  b.add(an, 'joint', xf(sphere(0.065 * k, 14, 10), [0, 0, 0]));
  b.add(an, 'dark', xf(cyl(0.075 * k, 0.09 * k, 0.05, 14), [0, -A * 0.35, 0]));
  b.add(an, 'primary', xf(rbox(0.21 * k, 0.1, F * 0.72, 0.035, 3), [0, -A + 0.06, F * 0.12]));
  b.add(an, 'secondary', xf(chamferBox(0.22 * k, 0.085, 0.12, 0.03, 0.012), [0, -A + 0.05, F * 0.45], [Math.PI / 2, 0, 0]));
  b.add(an, 'dark', xf(rbox(0.19 * k, 0.09, 0.13, 0.03), [0, -A + 0.055, -F * 0.25]));
  b.add(an, 'joint', xf(rbox(0.22 * k, 0.025, F * 1.02, 0.01), [0, -A + 0.0125, F * 0.08]));
  b.add(an, 'trim', xf(chamferBox(0.03, 0.06, F * 0.5, 0.012), [sx * 0.105 * k, -A + 0.07, F * 0.1]));
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
  b.add(th, 'primary', xf(sphere(0.11 * k, 16, 12), [sx * 0.01, -T * 0.4, 0.01], [0, 0, 0], [0.85, 1.25, 1]));
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

export function buildLegs(model: LegsDef['model'], rig: Rig, b: PartBuilder, bulk: number) {
  for (const side of ['L', 'R'] as Side[]) (model === 'hopper' ? hopper : stride)(rig, b, side, bulk);
}
