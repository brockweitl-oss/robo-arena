import * as THREE from 'three';
import type { Rig, Side } from './rig';
import { PartBuilder, armorLoft, petal, rbox, plate, armorShell, chamferBox, trap, cyl, sphere, torus, xf, vents, piston, boltRing, lathe } from './kit';
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
  const sx=side==='L'?1:-1, T=rig.spec.thigh,S=rig.spec.shin,k=bulk;
  const th=rig.thigh[side],kn=rig.knee[side],an=rig.ankle[side];
  b.add(th,'joint',xf(cyl(.046*k,.041*k,T*.92,12),[0,-T*.48,0]));
  // Curved muscle shell narrows toward the exposed knee joint.
  b.add(th,'primary',armorLoft([[-T*.87,.045*k,.045*k,0,.005],[-T*.57,.069*k,.07*k],[-T*.22,.09*k,.095*k,0,-.006],[-T*.08,.063*k,.06*k]],16));
  b.add(th,'secondary',xf(armorShell([[-.04*k,T*.2],[.04*k,T*.2],[.032*k,-T*.12],[0,-T*.25],[-.032*k,-T*.12]],.015,.009),[sx*.024,-T*.35,.086*k],[-.13,0,sx*.09]));
  const hyd=piston(new THREE.Vector3(sx*.066*k,-.05,-.045),new THREE.Vector3(sx*.05*k,-T*.88,-.03),.013);
  b.add(th,'dark',hyd.body);b.add(th,'chrome',hyd.rod);
  b.add(kn,'joint',xf(cyl(.055*k,.055*k,.125*k,16),[0,0,0],[0,0,Math.PI/2]));
  for(const x of [-1,1]) b.add(kn,'chrome',xf(cyl(.026,.026,.012,12),[x*.065*k,0,0],[0,0,Math.PI/2]));
  b.add(kn,'secondary',xf(petal(.14*k,.16,.065),[0,.015,.065*k],[.12,0,0]));
  // A long swept greave with an elliptical cross-section: smooth calf into slim ankle.
  b.add(kn,'primary',armorLoft([[-S*.93,.044*k,.048*k,0,.01],[-S*.73,.064*k,.068*k,0,.012],[-S*.34,.091*k,.105*k,0,-.01],[-S*.13,.068*k,.07*k]],18));
  b.add(kn,'trim',xf(petal(.115*k,S*.68,.03,.03),[0,-S*.50,.087*k],[-.08,0,0]));
  b.add(kn,'primary',xf(petal(.08*k,S*.60,.035,.015),[0,-S*.47,.105*k],[-.08,0,0]));
  b.add(kn,'glow',xf(plate([[-.004,-S*.17],[.004,-S*.17],[.004,S*.15],[-.004,S*.15]],.005,.001),[sx*.022,-S*.45,.129*k],[-.08,0,0]));
  const pistonBack=piston(new THREE.Vector3(sx*.055*k,-.04,-.066),new THREE.Vector3(sx*.045*k,-S*.88,-.04),.012);
  b.add(kn,'dark',pistonBack.body);b.add(kn,'chrome',pistonBack.rod);
  const A=rig.spec.ankleH,F=rig.spec.footLen*(.9+k*.1);
  b.add(an,'joint',sphere(.05*k,12,10));
  // Tapered boot follows an instep rather than a rectangular shoe silhouette.
  b.add(an,'dark',xf(petal(.15*k,F*.91,.042),[0,-A+.021,F*.10],[-Math.PI/2,0,0]));
  b.add(an,'primary',xf(armorLoft([[-F*.45,.035*k,.018],[-F*.25,.067*k,.038],[0,.075*k,.055],[F*.22,.060*k,.042],[F*.45,.04*k,.018]],16),[0,-A+.064,F*.09],[-Math.PI/2,0,0]));
  b.add(an,'secondary',xf(petal(.11*k,F*.32,.028),[0,-A+.052,F*.33],[-Math.PI/2,0,0]));
  footNozzle(rig,b,an,[0,-A+.065,-F*.28],.034);
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
  b.add(kn, 'primary', xf(armorLoft([[-S*.4,.035*k,.025],[-S*.12,.072*k,.05],[S*.32,.05*k,.035],[S*.4,.025*k,.02]],14), [0,-S*.48,.07*k]));
  b.add(kn, 'dark', xf(petal(.095*k,S*.54,.06,.02),[0,-S*.45,-.09*k],[0,Math.PI,0]));
  b.add(kn, 'glow', xf(rbox(0.01, S * 0.4, 0.008, 0.003), [0, -S * 0.48, 0.1 * k]));
  // hock (reverse joint)
  const an = rig.ankle[side];
  b.add(an, 'joint', xf(cyl(0.06 * k, 0.06 * k, 0.13 * k, 14), [0, 0, 0], [0, 0, Math.PI / 2]));
  b.add(an, 'secondary', xf(sphere(0.055 * k, 12, 10), [0, 0.0, -0.05], [0, 0, 0], [1, 1, 1.2]));
  // metatarsal strut
  b.add(an, 'primary', xf(armorLoft([[-M*.42,.03*k,.035*k],[-M*.12,.052*k,.056*k],[M*.35,.037*k,.04*k],[M*.42,.025*k,.025*k]],14),[0,-M*.5,0]));
  const pp = piston(new THREE.Vector3(0, -0.02, -0.07), new THREE.Vector3(0, -M + 0.02, -0.05), 0.014);
  b.add(an, 'dark', pp.body);
  b.add(an, 'chrome', pp.rod);
  // splayed three-toe foot
  const ft = rig.hock[side];
  const A = rig.spec.ankleH;
  b.add(ft, 'joint', xf(sphere(0.05 * k, 12, 10), [0, 0, 0]));
  b.add(ft, 'dark', xf(rbox(0.14 * k, 0.08, 0.14, 0.03), [0, -A + 0.045, 0.0]));
  for (const [ang, len] of [[0, 0.32], [0.45, 0.25], [-0.45, 0.25]] as [number, number][]) {
    const toe = xf(petal(.073*k,len,.07,.015),[Math.sin(ang)*len*.45,-A+.04,Math.cos(ang)*len*.45],[-Math.PI/2,0,-ang]);
    b.add(ft, 'primary', toe);
    b.add(ft, 'secondary', xf(trap(0.06 * k, 0.03, 0.05, 0.04, 0.008), [Math.sin(ang) * len, -A + 0.04, Math.cos(ang) * len], [Math.PI / 2, ang, 0]));
  }
  b.add(ft, 'primary', xf(petal(.06*k,.13,.05),[0,-A+.03,-.08],[-Math.PI/2,0,0]));
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
