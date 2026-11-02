import * as THREE from 'three';
import type { Rig, Side } from './rig';
import {
  PartBuilder, rbox, plate, armorShell, chamferBox, trap, cyl, sphere, lathe, torus, tube, xf, mirrorX, vents, piston, boltRing,
} from './kit';
import type { BodyDef } from '../data/parts';

/**
 * Upper-body builders, one per frame. Each frame has a distinct silhouette:
 *  - striker:  split tactical visor, layered pauldrons, twin back thrusters
 *  - ironclad: wide boxy hulk, sunken head with mono-rail eye, smokestacks
 *  - wisp:     slim body, narrow sensor array, swept wings
 *  - regent:   blade crest, shoulder blocks, armored boosters
 */

export interface FrameProportions {
  hipX: number;
  waistY: number;
  chestY: number;
  neckY: number;
  shoulderX: number;
  shoulderY: number;
  upperArm: number;
  forearm: number;
  /** Leg thickness multiplier. */
  bulk: number;
  /** Leg length multiplier. */
  legLen: number;
}

export const FRAME_PROPS: Record<BodyDef['frame'], FrameProportions> = {
  striker: { hipX: 0.15, waistY: 0.13, chestY: 0.3, neckY: 0.2, shoulderX: 0.4, shoulderY: 0.1, upperArm: 0.26, forearm: 0.3, bulk: 0.92, legLen: 1.22 },
  ironclad: { hipX: 0.19, waistY: 0.12, chestY: 0.32, neckY: 0.2, shoulderX: 0.52, shoulderY: 0.1, upperArm: 0.24, forearm: 0.33, bulk: 1.25, legLen: 1.16 },
  wisp: { hipX: 0.13, waistY: 0.16, chestY: 0.28, neckY: 0.19, shoulderX: 0.33, shoulderY: 0.09, upperArm: 0.27, forearm: 0.3, bulk: 0.78, legLen: 1.24 },
  regent: { hipX: 0.15, waistY: 0.15, chestY: 0.31, neckY: 0.21, shoulderX: 0.41, shoulderY: 0.11, upperArm: 0.27, forearm: 0.31, bulk: 0.96, legLen: 1.23 },
};

type B = PartBuilder;

/* -------------------------------- shared pieces ------------------------------- */

function pelvis(rig: Rig, b: B, wide = 1) {
  const h = rig.hips;
  b.add(h, 'dark', xf(chamferBox(0.34 * wide, 0.17, 0.26, 0.05), [0, 0.02, 0]));
  // hip joint balls
  for (const sx of [1, -1]) {
    b.add(h, 'joint', xf(sphere(0.085, 14, 10), [sx * rig.spec.hipX, -0.01, 0]));
    b.add(h, 'chrome', xf(cyl(0.05, 0.05, 0.05, 12), [sx * (rig.spec.hipX + 0.07), -0.01, 0], [0, 0, Math.PI / 2]));
  }
  // groin armor + skirt flaps (secondary motion)
  b.add(rig.flapF, 'primary', xf(trap(0.13, 0.2, 0.2, 0.05), [0, -0.1, 0.0], [-0.08, 0, 0]));
  b.add(rig.flapF, 'trim', xf(rbox(0.05, 0.12, 0.02, 0.006), [0, -0.09, 0.03]));
  rig.flapF.position.set(0, 0.04, 0.13);
  for (const [flap, sx] of [
    [rig.flapL, 1],
    [rig.flapR, -1],
  ] as const) {
    flap.position.set(sx * (rig.spec.hipX + 0.08), 0.06, 0);
    const g = plate([[-0.1, 0.02], [0.06, 0.02], [0.08, -0.14], [0.02, -0.2], [-0.1, -0.16]], 0.04, 0.01);
    b.add(flap, 'primary', xf(g, [sx * 0.01, 0, 0], [0, Math.PI / 2, 0]));
    b.add(flap, 'dark', xf(rbox(0.03, 0.05, 0.12, 0.01), [sx * 0.01, -0.02, 0.02]));
  }
}

function abdomen(rig: Rig, b: B, w = 0.26) {
  const wst = rig.waist;
  // segmented flex-joint stack
  for (let i = 0; i < 3; i++) {
    b.add(wst, i % 2 ? 'dark' : 'joint', xf(rbox(w - i * 0.015 + 0.02, 0.055, 0.2, 0.02), [0, -0.04 + i * 0.06, 0]));
  }
  b.add(wst, 'chrome', xf(cyl(0.035, 0.035, 0.18, 10), [0, 0.05, -0.04]));
  // ab plate
  b.add(wst, 'primary', xf(chamferBox(w * 0.72, 0.13, 0.05, 0.03), [0, 0.04, 0.1], [0.08, 0, 0]));
  b.add(wst, 'dark', xf(rbox(0.012, 0.11, 0.01, 0.003), [0, 0.04, 0.128], [0.08, 0, 0]));
}

function fist(rig: Rig, b: B, side: Side, scale = 1) {
  const h = rig.hand[side];
  const sx = side === 'L' ? 1 : -1;
  const s = scale;
  b.add(h, 'dark', xf(rbox(0.12 * s, 0.1 * s, 0.13 * s, 0.03), [0, -0.05 * s, 0.01]));
  // knuckles: three chunky fingers
  for (let i = 0; i < 3; i++) {
    b.add(h, 'joint', xf(rbox(0.035 * s, 0.07 * s, 0.05 * s, 0.012), [(-0.04 + i * 0.04) * s, -0.11 * s, 0.04 * s], [0.4, 0, 0]));
    b.add(h, 'trim', xf(rbox(0.036 * s, 0.03 * s, 0.03 * s, 0.008), [(-0.04 + i * 0.04) * s, -0.085 * s, 0.07 * s]));
  }
  b.add(h, 'joint', xf(rbox(0.04 * s, 0.06 * s, 0.04 * s, 0.012), [sx * 0.065 * s, -0.07 * s, 0.03 * s], [0.3, 0, sx * 0.3]));
  b.add(h, 'chrome', xf(cyl(0.025 * s, 0.025 * s, 0.13 * s, 10), [0, 0, 0], [0, 0, Math.PI / 2]));
}

function upperArm(rig: Rig, b: B, side: Side, r = 0.055, armor: 'sleeve' | 'none' = 'sleeve', mat: 'primary' | 'secondary' | 'dark' = 'dark') {
  const a = rig.arm[side];
  const sx = side === 'L' ? 1 : -1;
  const L = rig.spec.upperArm;
  b.add(a, 'joint', sphere(r * 1.45, 14, 10));
  b.add(a, 'dark', xf(cyl(r, r * 0.9, L * 0.9, 12), [0, -L * 0.5, 0]));
  // ribbed flex sleeve
  for (let i = 0; i < 3; i++) b.add(a, 'joint', xf(torus(r * 1.02, 0.012, 14, 6), [0, -L * (0.3 + i * 0.16), 0], [Math.PI / 2, 0, 0]));
  if (armor === 'sleeve') b.add(a, mat, xf(chamferBox(0.05, L * 0.6, 0.12, 0.02), [sx * (r + 0.02), -L * 0.45, 0]));
  const p = piston(new THREE.Vector3(0, -0.04, -r - 0.015), new THREE.Vector3(0, -L + 0.02, -r - 0.01), 0.016);
  b.add(a, 'dark', p.body);
  b.add(a, 'chrome', p.rod);
}

function forearm(rig: Rig, b: B, side: Side, o: { w: number; h: number; d: number; style: 'round' | 'block' | 'blade' | 'gauntlet' }) {
  const e = rig.elbow[side];
  const sx = side === 'L' ? 1 : -1;
  const L = rig.spec.forearm;
  // elbow joint drum
  b.add(e, 'joint', xf(cyl(0.065, 0.065, 0.12, 16), [0, 0, 0], [0, 0, Math.PI / 2]));
  b.add(e, 'chrome', xf(cyl(0.035, 0.035, 0.14, 10), [0, 0, 0], [0, 0, Math.PI / 2]));
  for (const g of boltRing(0.045, 6, 0.008, 0.01)) b.add(e, 'trim', xf(g, [sx * 0.065, 0, 0], [0, Math.PI / 2, 0]));
  const cy = -L * 0.52;
  if (o.style === 'round' || o.style === 'gauntlet') {
    b.add(e, 'primary', xf(rbox(o.w, o.h, o.d, 0.045, 3), [0, cy, 0]));
    // cuff stripe
    b.add(e, 'secondary', xf(rbox(o.w + 0.012, 0.045, o.d + 0.012, 0.02), [0, cy - o.h * 0.32, 0]));
    // outer armor ridge
    b.add(e, 'trim', xf(chamferBox(0.03, o.h * 0.7, o.d * 0.6, 0.012), [sx * (o.w / 2 + 0.008), cy + 0.02, 0]));
    for (const g of vents(o.w * 0.55, 0.08, 3, 0.012)) b.add(e, 'dark', xf(g, [0, cy + 0.05, -o.d / 2 - 0.002], [0, Math.PI, 0]));
    if (o.style === 'gauntlet') b.add(e, 'secondary', xf(trap(o.w * 0.9, o.w * 0.5, 0.1, o.d * 0.5, 0.01), [0, cy + o.h * 0.5 + 0.03, 0]));
  } else if (o.style === 'block') {
    b.add(e, 'primary', xf(chamferBox(o.w, o.h, o.d, 0.05, 0.015), [0, cy, 0]));
    b.add(e, 'dark', xf(rbox(o.w * 0.82, o.h * 0.25, o.d + 0.02, 0.015), [0, cy - o.h * 0.3, 0]));
    b.add(e, 'secondary', xf(chamferBox(o.w + 0.02, 0.06, o.d * 0.7, 0.02), [0, cy + o.h * 0.32, 0]));
    for (const g of boltRing(0.05, 4, 0.012, 0.012)) b.add(e, 'chrome', xf(g, [sx * (o.w / 2 + 0.004), cy, 0], [0, Math.PI / 2, 0]));
  } else {
    // blade: slim forearm with a swept fin
    b.add(e, 'primary', xf(rbox(o.w, o.h, o.d, 0.03, 2), [0, cy, 0]));
    b.add(e, 'secondary', xf(plate([[0, 0.12], [0.02, 0.12], [0.1, -0.14], [0.0, -0.06]], 0.02, 0.006), [sx * (o.w / 2), cy, 0], [0, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 0]));
    b.add(e, 'glow', xf(rbox(0.012, o.h * 0.6, 0.012, 0.004), [sx * (o.w / 2 + 0.002), cy, o.d / 2 - 0.02]));
  }
  for (let i = 0; i < 2; i++) {
    const w = o.w * (0.52 - i * 0.07);
    b.add(e, i === 0 ? 'primary' : 'trim', xf(armorShell([[-w, 0.05], [0, 0.075], [w, 0.05], [w * 0.7, -0.06], [0, -0.085], [-w * 0.7, -0.06]], 0.025, 0.018), [0, cy + 0.055 - i * 0.12, o.d / 2 + 0.02], [-0.1, 0, 0]));
  }
  // energy line
  b.add(e, 'glow', xf(rbox(0.004, o.h * 0.5, 0.006, 0.001), [o.w * 0.35, cy + 0.01, o.d / 2 + 0.04]));
  rig.hand[side].position.y = -L - 0.02;
}

function backNozzle(rig: Rig, b: B, parent: THREE.Object3D, p: [number, number, number], r: number, tilt: number) {
  // bell nozzle (lathe), opening along -Y, tilted back by `tilt`
  const bell = lathe([[r * 0.55, 0.06], [r * 0.6, 0.02], [r * 0.75, -0.02], [r, -0.08], [r * 0.93, -0.085], [r * 0.68, -0.03], [r * 0.5, 0.05]], 20);
  b.add(parent, 'dark', xf(bell, p, [tilt, 0, 0]));
  b.add(parent, 'chrome', xf(torus(r * 0.98, 0.008, 20, 6), [p[0], p[1] - 0.08 * Math.cos(tilt), p[2] - 0.08 * Math.sin(tilt)], [Math.PI / 2 + tilt, 0, 0]));
  b.add(parent, 'glowHot', xf(cyl(r * 0.5, r * 0.5, 0.005, 16), [p[0], p[1] - 0.02 * Math.cos(tilt), p[2] - 0.02 * Math.sin(tilt)], [tilt, 0, 0]));
  rig.addNozzle(parent, [p[0], p[1] - 0.08 * Math.cos(tilt), p[2] - 0.08 * Math.sin(tilt)], [tilt, 0, 0], 'back');
}

function emblem(rig: Rig, b: B, parent: THREE.Object3D, pos: [number, number, number], rotX: number, size: number) {
  const g = new THREE.PlaneGeometry(size, size);
  xf(g, pos, [rotX, 0, 0]);
  b.add(parent, 'decal', g);
}

/* --------------------------------- STRIKER ---------------------------------- */

function striker(rig: Rig, b: B) {
  pelvis(rig, b);
  abdomen(rig, b, 0.22);
  const c = rig.chest;
  // Chest core: broad V-taper hull
  b.add(c, 'dark', armorShell([[-0.105,-0.17],[0.105,-0.17],[0.275,0.02],[0.24,0.15],[0.1,0.19],[-0.1,0.19],[-0.24,0.15],[-0.275,0.02]],0.25,0.035));
  // Independently swept pectoral shells overlap the recessed central chassis.
  for (const sx of [-1, 1]) {
    const pec = armorShell([[-0.105,0.07],[-0.04,0.125],[0.095,0.075],[0.12,-0.02],[0.035,-0.09],[-0.09,-0.065]],0.085,0.045);
    b.add(c,'primary',xf(pec,[sx*0.145,0.055,0.105],[-0.12,sx*0.24,-sx*0.12],[sx,1,1]));
    b.add(c,'secondary',xf(armorShell([[-0.09,0.045],[-0.03,0.075],[0.09,0.035],[0.075,-0.005],[-0.07,-0.015]],0.025,0.02),[sx*0.145,0.105,0.17],[-0.2,sx*0.24,-sx*0.12],[sx,1,1]));
    b.add(c,'trim',xf(armorShell([[-0.07,0.02],[0.09,0.02],[0.045,-0.06],[-0.045,-0.09]],0.025,0.02),[sx*0.13,-0.075,0.15],[0.15,sx*0.2,0],[sx,1,1]));
  }
  // center reactor
  b.add(c, 'dark', xf(cyl(0.065, 0.075, 0.04, 6), [0, 0.02, 0.18], [Math.PI / 2, 0, 0]));
  b.add(c, 'glowHot', xf(cyl(0.035, 0.035, 0.02, 6), [0, 0.02, 0.2], [Math.PI / 2, 0, 0]));
  b.add(c, 'chrome', xf(torus(0.07, 0.008, 6, 4), [0, 0.02, 0.2], [0, 0, Math.PI / 6]));
  // lower chest plate with emblem
  b.add(c, 'trim', xf(chamferBox(0.3, 0.07, 0.04, 0.025), [0, -0.12, 0.165]));
  emblem(rig, b, c, [0.15, 0.06, 0.205], -0.06, 0.09);
  // side vents
  for (const sx of [1, -1]) for (const g of vents(0.07, 0.1, 3, 0.012)) b.add(c, 'dark', xf(g, [sx * 0.29, 0.04, 0.05], [0, sx * Math.PI / 2, 0]));
  // collar ring + neck
  b.add(c, 'dark', xf(cyl(0.12, 0.14, 0.06, 16), [0, 0.2, -0.01]));
  b.add(rig.neck, 'joint', xf(cyl(0.055, 0.065, 0.1, 12), [0, 0.03, 0]));
  // backpack
  const bk = rig.back;
  bk.position.set(0, 0.03, -0.17);
  b.add(bk, 'dark', xf(chamferBox(0.36, 0.3, 0.14, 0.06), [0, 0, -0.05]));
  b.add(bk, 'primary', xf(chamferBox(0.2, 0.24, 0.06, 0.04), [0, 0.02, -0.13]));
  for (const g of vents(0.14, 0.12, 4, 0.015)) b.add(bk, 'dark', xf(g, [0, 0.03, -0.165], [0, Math.PI, 0]));
  for (const sx of [1, -1]) {
    // swept fins
    b.add(bk, 'secondary', xf(plate([[0, 0], [0.16, 0.2], [0.18, 0.18], [0.06, -0.06]], 0.02, 0.006), [sx * 0.14, 0.06, -0.1], [0, 0, 0], [sx, 1, 1]));
    backNozzle(rig, b, bk, [sx * 0.11, -0.13, -0.1], 0.06, -0.5);
  }
  rig.podMount.position.set(0, 0.2, -0.12);
  rig.bombMount.position.set(0.26, 0.24, -0.06);

  // --- Head ---
  const h = rig.head;
  b.add(h, 'primary', xf(chamferBox(0.22, 0.24, 0.28, 0.05, 0.009), [0, 0.15, 0]));
  // brow ridge
  b.add(h, 'primary', xf(trap(0.25, 0.21, 0.05, 0.1, 0.012), [0, 0.215, 0.11], [-0.25, 0, 0]));
  // visor band
  b.add(h, 'visor', xf(chamferBox(0.205, 0.03, 0.06, 0.012, 0.004), [0, 0.15, 0.115]));
  for (const sx of [1, -1]) {
    // slanted eyes
    b.add(h, 'glowHot', xf(plate([[0, 0], [0.062, 0.012], [0.058, 0.025], [0.005, 0.022]], 0.01, 0.002), [sx * 0.012, 0.135, 0.156], [0, 0, 0], [sx, 1, 1]));
    // cheek guards
    b.add(h, 'trim', xf(chamferBox(0.04, 0.1, 0.16, 0.015), [sx * 0.123, 0.1, 0.04]));
    // ear sensor pods
    b.add(h, 'dark', xf(cyl(0.05, 0.055, 0.05, 14), [sx * 0.135, 0.16, -0.02], [0, 0, Math.PI / 2]));
    b.add(h, 'secondary', xf(cyl(0.032, 0.032, 0.056, 12), [sx * 0.14, 0.16, -0.02], [0, 0, Math.PI / 2]));
  }
  // mouth guard
  b.add(h, 'dark', xf(trap(0.12, 0.2, 0.07, 0.07, 0.01), [0, 0.07, 0.11]));
  for (const g of vents(0.08, 0.04, 2, 0.008)) b.add(h, 'chrome', xf(g, [0, 0.07, 0.148]));
  // Swept dorsal blade follows the helmet rather than flaring into a V-fin.
  b.add(h, 'secondary', xf(plate([[-0.11, 0], [0.09, 0], [-0.04, 0.065], [-0.14, 0.08]], 0.025, 0.004), [0, 0.27, 0], [0, Math.PI / 2, 0]));
  // Split faceplate and offset tactical sensor.
  for (const sx of [-1, 1]) {
    b.add(h, 'primary', xf(plate([[0.012, 0.03], [0.082, 0.07], [0.09, 0.13], [0.025, 0.11]], 0.025, 0.005), [0, 0, 0.156], [0, 0, 0], [sx, 1, 1]));
  }
  b.add(h, 'trim', xf(chamferBox(0.055, 0.035, 0.22, 0.012), [0, 0.278, -0.015]));
  b.add(h, 'dark', xf(chamferBox(0.035, 0.09, 0.055, 0.01), [-0.15, 0.22, -0.04]));
  b.add(h, 'glow', xf(cyl(0.009, 0.009, 0.006, 8), [-0.15, 0.24, -0.009], [Math.PI / 2, 0, 0]));
  rig.lockPoint.position.set(0, 0.32, 0);

  // --- Arms ---
  for (const side of ['L', 'R'] as Side[]) {
    const sx = side === 'L' ? 1 : -1;
    const pad = rig.pad[side];
    // Three overlapping plates leave a visible dark undercut at each edge.
    for (let i = 0; i < 3; i++) {
      b.add(pad, i === 0 ? 'secondary' : 'primary', xf(armorShell([[-0.1,0.025],[-0.055,0.095],[0.085,0.075],[0.14,-0.025],[0.1,-0.075],[-0.09,-0.045]],0.18-i*0.025,0.04),[sx*(0.015+i*0.025),0.055-i*0.065,0],[0.14+i*0.1,0,-sx*0.22],[sx*(1-i*0.08),1,1]));
    }
    b.add(pad, 'dark', xf(chamferBox(0.13, 0.09, 0.11, 0.025), [sx * 0.04, -0.03, -0.035]));
    upperArm(rig, b, side, 0.055, 'none');
    forearm(rig, b, side, { w: 0.145, h: 0.28, d: 0.16, style: 'block' });
    fist(rig, b, side);
  }
}

/* --------------------------------- IRONCLAD --------------------------------- */

function ironclad(rig: Rig, b: B) {
  pelvis(rig, b, 1.25);
  abdomen(rig, b, 0.28);
  const c = rig.chest;
  // Huge boxy hull
  b.add(c, 'primary', xf(chamferBox(0.72, 0.4, 0.44, 0.09, 0.025), [0, 0.02, 0]));
  b.add(c, 'secondary', xf(chamferBox(0.5, 0.14, 0.06, 0.04), [0, 0.12, 0.215]));
  // hazard chevrons on chest plate
  for (let i = 0; i < 4; i++) b.add(c, 'dark', xf(plate([[0, 0], [0.04, 0], [0.07, 0.06], [0.03, 0.06]], 0.02, 0.004), [-0.13 + i * 0.07, 0.09, 0.245]));
  // grille
  b.add(c, 'dark', xf(rbox(0.4, 0.14, 0.05, 0.02), [0, -0.08, 0.205]));
  for (const g of vents(0.36, 0.11, 5, 0.012)) b.add(c, 'chrome', xf(g, [0, -0.08, 0.232]));
  b.add(c, 'glow', xf(rbox(0.3, 0.012, 0.01, 0.004), [0, -0.15, 0.232]));
  emblem(rig, b, c, [-0.25, 0.12, 0.25], 0, 0.1);
  // armored collar that hides the neck — head sits low
  b.add(c, 'trim', xf(chamferBox(0.42, 0.12, 0.34, 0.05), [0, 0.22, -0.02]));
  b.add(rig.neck, 'joint', xf(cyl(0.07, 0.08, 0.06, 12), [0, 0.0, 0]));
  rig.neck.position.y = 0.2;
  // smokestacks
  const bk = rig.back;
  bk.position.set(0, 0.02, -0.22);
  b.add(bk, 'dark', xf(chamferBox(0.5, 0.34, 0.16, 0.06), [0, 0, -0.06]));
  for (const sx of [1, -1]) {
    b.add(bk, 'dark', xf(cyl(0.055, 0.06, 0.42, 14), [sx * 0.16, 0.24, -0.12]));
    b.add(bk, 'chrome', xf(torus(0.058, 0.01, 14, 6), [sx * 0.16, 0.42, -0.12], [Math.PI / 2, 0, 0]));
    b.add(bk, 'secondary', xf(cyl(0.062, 0.062, 0.05, 14), [sx * 0.16, 0.12, -0.12]));
    b.add(bk, 'glowHot', xf(cyl(0.04, 0.04, 0.005, 12), [sx * 0.16, 0.445, -0.12]));
    backNozzle(rig, b, bk, [sx * 0.15, -0.16, -0.1], 0.07, -0.45);
  }
  rig.podMount.position.set(0, 0.24, -0.1);
  rig.bombMount.position.set(0.3, 0.28, -0.06);

  const h = rig.head;
  // low dome head with mono-eye rail
  b.add(h, 'primary', xf(rbox(0.3, 0.17, 0.27, 0.07, 3), [0, 0.07, 0.04]));
  b.add(h, 'dark', xf(rbox(0.27, 0.06, 0.06, 0.02), [0, 0.07, 0.16]));
  b.add(h, 'glowHot', xf(rbox(0.06, 0.03, 0.02, 0.01), [0.04, 0.07, 0.185]));
  b.add(h, 'glow', xf(rbox(0.22, 0.008, 0.01, 0.003), [0, 0.07, 0.185]));
  b.add(h, 'secondary', xf(chamferBox(0.08, 0.05, 0.28, 0.015), [0, 0.165, 0.03]));
  for (const sx of [1, -1]) b.add(h, 'trim', xf(chamferBox(0.04, 0.12, 0.2, 0.015), [sx * 0.165, 0.07, 0.04]));
  rig.lockPoint.position.set(0, 0.3, 0);
  const ant = rig.addAntenna(h, [-0.12, 0.15, -0.06], [-0.2, 0, 0.15]);
  b.add(ant, 'chrome', xf(cyl(0.008, 0.012, 0.24, 6), [0, 0.12, 0]));
  b.add(ant, 'glow', xf(sphere(0.014, 8, 6), [0, 0.24, 0]));

  for (const side of ['L', 'R'] as Side[]) {
    const sx = side === 'L' ? 1 : -1;
    const pad = rig.pad[side];
    // massive block pauldrons with vents
    b.add(pad, 'primary', xf(chamferBox(0.3, 0.24, 0.32, 0.07, 0.02), [sx * 0.08, 0.05, 0]));
    b.add(pad, 'secondary', xf(chamferBox(0.31, 0.06, 0.33, 0.03), [sx * 0.08, 0.13, 0]));
    for (const g of vents(0.18, 0.1, 3, 0.012)) b.add(pad, 'dark', xf(g, [sx * 0.235, 0.0, 0], [0, sx * Math.PI / 2, 0]));
    for (const g of boltRing(0.1, 6, 0.012, 0.014)) b.add(pad, 'chrome', xf(g, [sx * 0.08, 0.05, 0.165]));
    upperArm(rig, b, side, 0.07, 'sleeve');
    forearm(rig, b, side, { w: 0.22, h: 0.32, d: 0.22, style: 'block' });
    fist(rig, b, side, 1.3);
  }
}

/* ----------------------------------- WISP ----------------------------------- */

function wisp(rig: Rig, b: B) {
  pelvis(rig, b, 0.85);
  abdomen(rig, b, 0.2);
  const c = rig.chest;
  // slim teardrop chest
  b.add(c, 'primary', armorShell([[-0.075,-0.16],[0.075,-0.16],[0.18,0.03],[0.17,0.15],[0.06,0.19],[-0.06,0.19],[-0.17,0.15],[-0.18,0.03]],0.22,0.035));
  b.add(c, 'secondary', xf(plate([[0, 0.17], [0.12, 0.12], [0.06, -0.12], [0, -0.15], [-0.06, -0.12], [-0.12, 0.12]], 0.04, 0.01), [0, 0, 0.135]));
  b.add(c, 'glowHot', xf(plate([[0, 0.08], [0.03, 0.0], [0, -0.08], [-0.03, 0]], 0.012, 0.003), [0, 0.02, 0.16]));
  emblem(rig, b, c, [0.13, 0.08, 0.145], 0, 0.07);
  b.add(c, 'dark', xf(cyl(0.08, 0.1, 0.05, 14), [0, 0.19, -0.01]));
  b.add(rig.neck, 'joint', xf(cyl(0.04, 0.05, 0.12, 10), [0, 0.04, 0]));
  // wings
  const bk = rig.back;
  bk.position.set(0, 0.06, -0.14);
  b.add(bk, 'dark', xf(chamferBox(0.24, 0.24, 0.1, 0.05), [0, 0, -0.03]));
  for (const sx of [1, -1]) {
    const wingRoot = rig.addDangler(bk, [sx * 0.1, 0.05, -0.06]);
    wingRoot.userData.stiff = 0.6;
    // Three separated airfoils sweep out from a visible mechanical spar.
    b.add(wingRoot,'dark',xf(chamferBox(0.4,0.025,0.035,0.01),[sx*0.19,0.12,0],[0,0,sx*0.65]));
    for (let i=0;i<3;i++) {
      const points: [number,number][]=[[0,0],[0.28-i*0.025,0.2],[0.34-i*0.025,0.2],[0.21-i*0.02,0.045],[0.025,-0.045]];
      b.add(wingRoot,i===0?'secondary':'primary',xf(armorShell(points,0.025,0.012),[sx*(0.08+i*0.07),0.12-i*0.07,-i*0.035],[0.3,-sx*0.5,0],[sx,1,1]));
      b.add(wingRoot,'glow',xf(plate([[0.05,0.01],[0.25-i*0.02,0.15],[0.27-i*0.02,0.15],[0.065,0.005]],0.004,0.001),[sx*(0.08+i*0.07),0.12-i*0.07,-i*0.035+0.02],[0.3,-sx*0.5,0],[sx,1,1]));
    }
    backNozzle(rig, b, bk, [sx * 0.07, -0.12, -0.06], 0.05, -0.55);
  }
  rig.podMount.position.set(0, 0.16, -0.08);
  rig.bombMount.position.set(0.2, 0.22, -0.04);

  const h = rig.head;
  // Narrow flight helmet with a recessed horizontal sensor array.
  b.add(h, 'primary', xf(chamferBox(0.24, 0.23, 0.29, 0.055, 0.008), [0, 0.13, 0]));
  b.add(h, 'dark', xf(chamferBox(0.225, 0.052, 0.04, 0.014), [0, 0.145, 0.145]));
  b.add(h, 'visor', xf(chamferBox(0.19, 0.034, 0.012, 0.008), [0, 0.145, 0.17]));
  for (const sx of [-1, 1]) b.add(h, 'glow', xf(chamferBox(0.052, 0.012, 0.008, 0.003), [sx * 0.058, 0.146, 0.18]));
  // swept crest
  b.add(h, 'secondary', xf(plate([[0, 0], [0.03, 0.02], [-0.25, 0.1], [-0.27, 0.08]], 0.02, 0.006), [0, 0.25, 0.05], [0, Math.PI / 2, 0]));
  for (const sx of [1, -1]) b.add(h, 'trim', xf(chamferBox(0.03, 0.08, 0.12, 0.012), [sx * 0.13, 0.11, 0.0]));
  rig.lockPoint.position.set(0, 0.32, 0);
  for (const sx of [1, -1]) {
    const ant = rig.addAntenna(h, [sx * 0.11, 0.2, -0.04], [-0.9, 0, -sx * 0.25]);
    b.add(ant, 'chrome', xf(cyl(0.005, 0.008, 0.24, 6), [0, 0.12, 0]));
    b.add(ant, 'glow', xf(sphere(0.01, 8, 6), [0, 0.24, 0]));
  }

  for (const side of ['L', 'R'] as Side[]) {
    const sx = side === 'L' ? 1 : -1;
    const pad = rig.pad[side];
    // blade pauldron
    b.add(pad, 'primary', xf(plate([[-0.1, -0.04], [0.12, -0.06], [0.2, 0.1], [-0.02, 0.08]], 0.17, 0.015), [sx * 0.04, 0.04, 0], [0, 0, 0], [sx, 1, 1]));
    b.add(pad, 'secondary', xf(plate([[0.12, -0.06], [0.22, 0.13], [0.2, 0.1]], 0.12, 0.006), [sx * 0.04, 0.04, 0], [0, 0, 0], [sx, 1, 1]));
    upperArm(rig, b, side, 0.045, 'sleeve', 'primary');
    forearm(rig, b, side, { w: 0.12, h: 0.25, d: 0.13, style: 'blade' });
    fist(rig, b, side, 0.85);
  }
}

/* ---------------------------------- REGENT ---------------------------------- */

function regent(rig: Rig, b: B) {
  pelvis(rig, b, 1.05);
  abdomen(rig, b, 0.22);
  const c = rig.chest;
  // knightly cuirass with gold trim
  b.add(c, 'primary', plate([[-0.11, -0.18], [0.11, -0.18], [0.3, -0.02], [0.3, 0.13], [0.15, 0.21], [-0.15, 0.21], [-0.3, 0.13], [-0.3, -0.02]], 0.36, 0.025));
  const gold = plate([[0, 0.21], [0.15, 0.21], [0.3, 0.13], [0.3, 0.1], [0.14, 0.17], [0, 0.0], [-0.14, 0.17], [-0.3, 0.1], [-0.3, 0.13], [-0.15, 0.21]], 0.04, 0.01);
  b.add(c, 'secondary', xf(gold, [0, 0, 0.17]));
  b.add(c, 'secondary', xf(plate([[0, 0.0], [0.05, -0.08], [0, -0.17], [-0.05, -0.08]], 0.04, 0.01), [0, 0, 0.17]));
  b.add(c, 'glowHot', xf(plate([[0, 0.05], [0.03, 0], [0, -0.05], [-0.03, 0]], 0.012, 0.003), [0, -0.07, 0.195]));
  emblem(rig, b, c, [-0.16, 0.0, 0.185], 0, 0.08);
  b.add(c, 'dark', xf(cyl(0.11, 0.13, 0.06, 16), [0, 0.21, -0.01]));
  b.add(rig.neck, 'joint', xf(cyl(0.05, 0.06, 0.1, 12), [0, 0.03, 0]));
  const bk = rig.back;
  bk.position.set(0, 0.04, -0.17);
  b.add(bk, 'dark', xf(chamferBox(0.34, 0.3, 0.12, 0.06), [0, 0, -0.04]));
  b.add(bk, 'secondary', xf(chamferBox(0.36, 0.04, 0.13, 0.015), [0, 0.13, -0.04]));
  for (const sx of [1, -1]) {
    backNozzle(rig, b, bk, [sx * 0.1, -0.13, -0.09], 0.055, -0.5);
    // Armored booster nacelles replace the decorative hanging cape.
    b.add(bk, 'primary', xf(chamferBox(0.15, 0.42, 0.18, 0.035), [sx * 0.2, -0.015, -0.09], [-0.12, 0, 0]));
    for (const g of vents(0.09, 0.17, 5, 0.01)) b.add(bk, 'dark', xf(g, [sx * 0.2, 0.035, -0.19], [0, Math.PI, 0]));
    backNozzle(rig, b, bk, [sx * 0.2, -0.21, -0.11], 0.065, -0.3);
  }
  rig.podMount.position.set(0, 0.2, -0.1);
  rig.bombMount.position.set(0.26, 0.25, -0.06);

  const h = rig.head;
  // helm with T-visor and crown
  b.add(h, 'primary', xf(chamferBox(0.25, 0.25, 0.28, 0.045, 0.008), [0, 0.15, 0]));
  b.add(h, 'visor', xf(rbox(0.22, 0.045, 0.06, 0.015), [0, 0.16, 0.12]));
  b.add(h, 'visor', xf(rbox(0.05, 0.11, 0.06, 0.015), [0, 0.11, 0.12]));
  b.add(h, 'glowHot', xf(rbox(0.18, 0.012, 0.01, 0.004), [0, 0.16, 0.152]));
  b.add(h, 'secondary', xf(chamferBox(0.28, 0.035, 0.29, 0.01), [0, 0.26, 0]));
  // Original staggered blade cluster with rearward-raked outer fins.
  for (const sx of [-1, 1]) b.add(h, 'secondary', xf(plate([[-0.02, 0], [0.02, 0], [0.04, 0.1], [0.025, 0.13]], 0.025, 0.004), [sx * 0.085, 0.25, -0.04], [0.25, sx * 0.25, sx * 0.18], [sx, 1, 1]));
  // Central blade, integrated into the armored brow.
  b.add(h, 'secondary', xf(plate([[-0.035, 0], [0.035, 0], [0.01, 0.17], [-0.025, 0.13]], 0.1, 0.006), [0, 0.27, -0.01]));
  for (const sx of [1, -1]) b.add(h, 'trim', xf(plate([[0, 0], [0.12, 0.0], [0.18, 0.1], [0.02, 0.05]], 0.02, 0.006), [sx * 0.13, 0.13, -0.04], [0, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 0]));
  rig.lockPoint.position.set(0, 0.45, 0);

  for (const side of ['L', 'R'] as Side[]) {
    const sx = side === 'L' ? 1 : -1;
    const pad = rig.pad[side];
    b.add(pad, 'primary', xf(armorShell([[-0.06, 0], [0.09, -0.015], [0.14, 0.17], [0.06, 0.13]], 0.06, 0.015), [sx * 0.13, 0.08, -0.08], [0.2, 0, 0], [sx, 1, 1]));
    // Rectilinear shoulder armor with inset vernier exhausts.
    b.add(pad, 'dark', xf(chamferBox(0.27, 0.21, 0.29, 0.04, 0.009), [sx * 0.07, 0.04, 0]));
    for (let i=0;i<2;i++) b.add(pad,'primary',xf(armorShell([[-0.12,0.045],[-0.075,0.09],[0.12,0.07],[0.155,-0.02],[0.095,-0.065],[-0.11,-0.045]],0.035,0.025),[sx*0.07,0.065-i*0.105,0.17-i*0.018],[-0.12,sx*0.15,-sx*0.1],[sx,1,1]));
    b.add(pad, 'secondary', xf(chamferBox(0.3, 0.055, 0.33, 0.018), [sx * 0.07, 0.14, 0]));
    b.add(pad, 'dark', xf(chamferBox(0.18, 0.11, 0.02, 0.018), [sx * 0.07, 0.025, -0.17]));
    for (const dx of [-0.045, 0.045]) {
      b.add(pad, 'chrome', xf(torus(0.027, 0.007, 12, 5), [sx * 0.07 + dx, 0.025, -0.185]));
      b.add(pad, 'glow', xf(cyl(0.015, 0.015, 0.008, 10), [sx * 0.07 + dx, 0.025, -0.184], [Math.PI / 2, 0, 0]));
    }
    upperArm(rig, b, side, 0.05, 'sleeve', 'primary');
    forearm(rig, b, side, { w: 0.15, h: 0.27, d: 0.16, style: 'gauntlet' });
    fist(rig, b, side, 1.0);
  }
}

export function buildFrame(frame: BodyDef['frame'], rig: Rig, b: PartBuilder) {
  ({ striker, ironclad, wisp, regent })[frame](rig, b);
  const heavy = frame === 'ironclad';
  for (const sx of [-1, 1]) {
    const x = sx * (heavy ? 0.27 : frame === 'wisp' ? 0.16 : 0.23);
    const z = heavy ? 0.235 : frame === 'wisp' ? 0.155 : 0.195;
    // Separated lower-rib armor exposes the chassis between plates.
    for (let i = 0; i < 3; i++) b.add(rig.chest, i === 2 ? 'trim' : 'primary', xf(chamferBox(heavy ? 0.15 : 0.1, 0.045, 0.045, 0.012, 0.004), [x - sx * i * 0.022, -0.04 - i * 0.055, z], [0, sx * 0.18, 0]));
    const p = piston(new THREE.Vector3(sx * 0.12, -0.11, -0.1), new THREE.Vector3(sx * 0.21, 0.12, -0.12), heavy ? 0.025 : 0.014);
    b.add(rig.waist, 'dark', p.body);
    b.add(rig.waist, 'chrome', p.rod);
    if (frame === 'wisp') {
      const side = sx > 0 ? 'L' : 'R';
      b.add(rig.elbow[side], 'dark', xf(chamferBox(0.065, 0.17, 0.065, 0.018), [sx * 0.085, -0.13, -0.04]));
      backNozzle(rig, b, rig.elbow[side], [sx * 0.085, -0.22, -0.04], 0.028, 0);
      for (let i = 0; i < 2; i++) b.add(rig.back, 'joint', tube([new THREE.Vector3(sx * 0.08, 0.09, -0.08), new THREE.Vector3(sx * (0.14 + i * 0.018), -0.02, -0.12), new THREE.Vector3(sx * 0.08, -0.13, -0.06)], 0.008, 10));
    }
  }
  if (heavy) {
    b.add(rig.chest, 'dark', xf(cyl(0.095, 0.095, 0.045, 12), [0, 0.015, 0.25], [Math.PI / 2, 0, 0]));
    b.add(rig.chest, 'chrome', xf(torus(0.08, 0.012, 16, 6), [0, 0.015, 0.28]));
    b.add(rig.chest, 'glowHot', xf(cyl(0.057, 0.057, 0.008, 12), [0, 0.015, 0.277], [Math.PI / 2, 0, 0]));
  }
}
