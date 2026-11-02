import * as THREE from 'three';
import type { Rig, Side } from './rig';
import { PartBuilder, ridgeShell, armorLoft, petal, rbox, plate, armorShell, chamferBox, trap, cyl, sphere, torus, xf, vents, piston, boltRing, lathe } from './kit';
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
  const T = rig.spec.thigh, S = rig.spec.shin, k = bulk;
  const th = rig.thigh[side], kn = rig.knee[side], an = rig.ankle[side];
  // Dark load-bearing frame stays visible at the hip, inner thigh and knee.
  b.add(th, 'joint', xf(cyl(.042*k, .034*k, T*.90, 12), [0,-T*.47,-.012]));
  b.add(th, 'chrome', xf(cyl(.052*k,.052*k,.11*k,12),[0,-T*.075,0],[0,0,Math.PI/2]));
  const thighProfile: [number,number][] = [[-.067*k,T*.32],[.055*k,T*.34],[.085*k,T*.16],[.045*k,-T*.30],[.005*k,-T*.40],[-.049*k,-T*.22],[-.078*k,T*.08]];
  b.add(th,'primary',xf(ridgeShell(thighProfile,.022,.027),[sx*.012,-T*.46,.043*k],[0,sx*.12,0]));
  // Separate outer plate overlaps the crown without closing the exposed mechanical gap.
  b.add(th,'secondary',xf(ridgeShell([[-.028*k,T*.24],[.035*k,T*.28],[.048*k,T*.05],[.005*k,-T*.29],[-.033*k,-T*.17]],.016,.018),[sx*.072*k,-T*.40,.016],[0,sx*.75,sx*-.06]));
  b.add(th,'trim',xf(plate([[-.009,T*.16],[.012,T*.18],[.009,-T*.11],[-.006,-T*.20]],.005,.002),[sx*.052*k,-T*.44,.079*k],[0,sx*.16,0]));
  const hyd = piston(new THREE.Vector3(sx*.062*k,-.05,-.045),new THREE.Vector3(sx*.048*k,-T*.88,-.03),.013);
  b.add(th,'dark',hyd.body); b.add(th,'chrome',hyd.rod);
  // Rear armor covers the structural core while the outer hydraulic remains serviceable.
  b.add(th,'primary',xf(ridgeShell([[-.052*k,T*.27],[.052*k,T*.27],[.061*k,T*.08],[.036*k,-T*.29],[0,-T*.35],[-.036*k,-T*.29]],.014,.010),[-sx*.010*k,-T*.47,-.052*k],[0,Math.PI,0]));
  b.add(th,'secondary',xf(plate([[-.025*k,T*.12],[.025*k,T*.12],[.019*k,-T*.12],[-.019*k,-T*.12]],.006,.002),[-sx*.010*k,-T*.43,-.071*k],[0,Math.PI,0]));
  b.add(kn,'joint',xf(cyl(.052*k,.052*k,.124*k,16),[0,0,0],[0,0,Math.PI/2]));
  for (const x of [-1,1]) {
    b.add(kn,'chrome',xf(cyl(.029,.029,.012,12),[x*.065*k,0,0],[0,0,Math.PI/2]));
    b.add(kn,'dark',xf(cyl(.013,.013,.014,10),[x*.072*k,0,0],[0,0,Math.PI/2]));
  }
  // Two distinct floating knee layers: angular shield above a narrow dark hinge.
  b.add(kn,'dark',xf(ridgeShell([[-.064*k,.053],[0,.086],[.064*k,.053],[.043*k,-.075],[0,-.105],[-.043*k,-.075]],.018,.014),[0,.005,.047*k]));
  b.add(kn,'secondary',xf(ridgeShell([[-.048*k,.052],[0,.080],[.048*k,.052],[.034*k,-.048],[0,-.125],[-.034*k,-.048]],.014,.010),[0,.018,.073*k],[-.08,0,0]));
  b.add(kn,'primary',xf(ridgeShell([[-.030*k,.015],[.030*k,.015],[.021*k,-.055],[0,-.11],[-.021*k,-.055]],.010,.007),[0,-.070,.063*k]));
  // Split greave plates surround a recessed luminous channel; no smooth boot-like calf.
  b.add(kn,'joint',xf(cyl(.033*k,.044*k,S*.84,12),[0,-S*.49,-.008]));
  b.add(kn,'dark',xf(ridgeShell([[-.043*k,S*.31],[.043*k,S*.31],[.026*k,-S*.34],[-.026*k,-S*.34]],.014,.008),[0,-S*.50,.051*k]));
  for (const sideSign of [-1,1]) {
    const points: [number,number][] = [[.014*k,S*.37],[.057*k,S*.39],[.081*k,S*.17],[.051*k,-S*.29],[.018*k,-S*.39],[.010*k,-S*.12]];
    // Reverse winding after mirroring so every shell remains front-facing.
    const mirrored = points.map(([x,y]) => [x*sideSign,y] as [number,number]);
    if (sideSign < 0) mirrored.reverse();
    b.add(kn,sideSign === sx ? 'primary' : 'secondary',xf(ridgeShell(mirrored,.016,.012),[0,-S*.52,.049*k],[0,sideSign*.12,0]));
  }
  b.add(kn,'glow',xf(plate([[-.004,S*.23],[.004,S*.23],[.004,-S*.19],[0,-S*.27],[-.004,-S*.19]],.004,.001),[0,-S*.49,.071*k]));
  const rear = piston(new THREE.Vector3(sx*.055*k,-.04,-.066),new THREE.Vector3(sx*.045*k,-S*.88,-.04),.012);
  b.add(kn,'dark',rear.body); b.add(kn,'chrome',rear.rod);
  // Two rear calf flanks leave a deliberate central channel, not a fully bare endoskeleton.
  for (const sign of [-1,1]) {
    b.add(kn,'primary',xf(ridgeShell([[-.020*k,S*.27],[.020*k,S*.31],[.029*k,S*.12],[.018*k,-S*.28],[-.013*k,-S*.32],[-.022*k,-S*.10]],.012,.008),[sign*.028*k,-S*.50,-.050*k],[0,Math.PI+sign*.17,0]));
  }
  const A = rig.spec.ankleH, F = rig.spec.footLen*(.9+k*.1);
  b.add(an,'joint',xf(cyl(.043*k,.043*k,.105*k,14),[0,0,0],[0,0,Math.PI/2]));
  // A low sole with independent heel/toe armor and a mechanical instep bridge.
  b.add(an,'dark',xf(plate([[-.052*k,-F*.40],[.052*k,-F*.40],[.062*k,-F*.20],[.052*k,F*.28],[.030*k,F*.46],[-.030*k,F*.46],[-.052*k,F*.28],[-.062*k,-F*.20]],.021,.004),[0,-A+.011,F*.09],[-Math.PI/2,0,0]));
  b.add(an,'secondary',xf(chamferBox(.092*k,.045,F*.18,.012),[0,-A+.033,-F*.22]));
  b.add(an,'primary',xf(ridgeShell([[-.048*k,-F*.18],[.048*k,-F*.18],[.052*k,F*.10],[.026*k,F*.31],[-.026*k,F*.31],[-.052*k,F*.10]],.014,.012),[0,-A+.030,F*.19],[-Math.PI/2,0,0]));
  b.add(an,'primary',xf(ridgeShell([[-.038*k,.055],[.038*k,.055],[.045*k,-.025],[.025*k,-.065],[-.025*k,-.065],[-.045*k,-.025]],.012,.009),[0,-.013,.052*k],[.36,0,0]));
  for (const x of [-1,1]) b.add(an,'chrome',xf(cyl(.018,.018,.008,10),[x*.057*k,-.008,0],[0,0,Math.PI/2]));
  // Existing mount/angle preserved exactly for procedural thruster animation.
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
  b.add(th, 'primary', xf(ridgeShell([[-0.075, 0.1], [0, 0.13], [0.075, 0.1], [0.06, -0.1], [0, -0.13], [-0.06, -0.1]], 0.028, 0.045), [sx * 0.01, -T * 0.4, 0.065*k], [0, 0, 0], k));
  b.add(th, 'trim', xf(chamferBox(0.03, T * 0.5, 0.09, 0.012), [sx * 0.095 * k, -T * 0.4, 0.0]));
  b.add(th,'primary',xf(ridgeShell([[-.055*k,T*.28],[.055*k,T*.28],[.058*k,0],[.030*k,-T*.29],[-.030*k,-T*.29]],.014,.012),[0,-T*.43,-.055*k],[0,Math.PI,0]));
  const kn = rig.knee[side];
  b.add(kn, 'joint', xf(cyl(0.065 * k, 0.065 * k, 0.13 * k, 16), [0, 0, 0], [0, 0, Math.PI / 2]));
  b.add(kn, 'secondary', xf(plate([[-0.06, -0.05], [0.06, -0.05], [0.07, 0.04], [0, 0.09], [-0.07, 0.04]], 0.05, 0.012), [0, 0.0, 0.07 * k], [0.3, 0, 0], k));
  // long shin with exposed spring coil
  b.add(kn, 'dark', xf(cyl(0.035, 0.035, S * 0.92, 10), [0, -S * 0.5, -0.02]));
  for (let i = 0; i < 9; i++) b.add(kn, 'chrome', xf(torus(0.055 * k, 0.009, 16, 6), [0, -S * (0.2 + i * 0.07), -0.02], [Math.PI / 2, 0, 0]));
  b.add(kn, 'primary', xf(ridgeShell([[-.025*k,S*.4],[.025*k,S*.4],[.072*k,S*.12],[.035*k,-S*.4],[-.035*k,-S*.4],[-.072*k,S*.12]],.02,.035), [0,-S*.48,.047*k]));
  b.add(kn, 'dark', xf(petal(.095*k,S*.54,.06,.02),[0,-S*.45,-.09*k],[0,Math.PI,0]));
  b.add(kn, 'glow', xf(rbox(0.01, S * 0.4, 0.008, 0.003), [0, -S * 0.48, 0.080 * k]));
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
