import * as THREE from 'three';
import type { Rig, Side } from './rig';
import { PartBuilder, ridgeShell, armorLoft, petal, rbox, plate, armorShell, chamferBox, trap, cyl, sphere, torus, xf, vents, piston, boltRing, lathe } from './kit';
import type { MatKey } from './kit';
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
  // Leave at least 25 mm to the body centerline even on Titan/Anchor.
  // Scale complete thigh layers together so fitted seams stay on the shell.
  const thighWidth = Math.min(1, (rig.spec.hipX - .025) / (.119*k));
  const addTh = (mat: MatKey, g: THREE.BufferGeometry) => b.add(th,mat,g.scale(thighWidth,1,1));
  // Continuous wearable shells: generous muscle volume, tapered joint cuffs.
  addTh('joint',xf(cyl(.066*k,.060*k,T*.97,12),[0,-T*.49,0]));
  addTh('primary',armorLoft([
    [-T*.95,.067*k,.067*k],[-T*.82,.084*k,.084*k],
    [-T*.51,.108*k,.108*k,0,.006],[-T*.21,.119*k,.115*k],
    [-T*.07,.099*k,.094*k],[-T*.035,.078*k,.077*k],
  ],20));
  // Flush front lamella and lateral seam follow the enclosed thigh rather than float.
  addTh('secondary',xf(ridgeShell([[-.071*k,T*.29],[.071*k,T*.29],[.081*k,T*.08],[.049*k,-T*.32],[0,-T*.38],[-.049*k,-T*.32]],.014,.012),[0,-T*.47,.098*k]));
  addTh('trim',xf(plate([[-.007,T*.19],[.007,T*.19],[.006,-T*.19],[-.006,-T*.19]],.004,.001),[sx*.090*k,-T*.39,.070*k],[0,sx*.60,0]));
  // Short fitted rear cap breaks the uninterrupted oval without exposing the frame.
  addTh('dark',xf(ridgeShell([[-.055*k,T*.13],[.055*k,T*.13],[.061*k,0],[.040*k,-T*.18],[-.040*k,-T*.18],[-.061*k,0]],.008,.007),[0,-T*.35,-.102*k],[0,Math.PI,0]));
  addTh('secondary',xf(ridgeShell([[-.049*k,T*.115],[.049*k,T*.115],[.054*k,0],[.035*k,-T*.16],[-.035*k,-T*.16],[-.054*k,0]],.008,.007),[0,-T*.35,-.110*k],[0,Math.PI,0]));
  b.add(kn,'joint',xf(cyl(.071*k,.071*k,.150*k,16),[0,0,0],[0,0,Math.PI/2]));
  b.add(kn,'primary',xf(armorLoft([[-.064,.066*k,.064*k],[0,.084*k,.078*k],[.052,.074*k,.068*k]],16),[0,0,0]));
  b.add(kn,'secondary',xf(ridgeShell([[-.067*k,.049],[0,.077],[.067*k,.049],[.054*k,-.052],[0,-.087],[-.054*k,-.052]],.022,.014),[0,.004,.076*k]));
  // Calf is a closed shaped greave, with a deep rear muscle and narrow ankle.
  b.add(kn,'primary',armorLoft([
    [-S*.98,.060*k,.059*k],[-S*.86,.068*k,.069*k],
    [-S*.63,.091*k,.101*k,0,-.010],[-S*.36,.110*k,.120*k,0,-.016],
    [-S*.15,.098*k,.099*k],[-S*.075,.074*k,.075*k],
  ],20));
  b.add(kn,'secondary',xf(ridgeShell([[-.064*k,S*.30],[.064*k,S*.30],[.070*k,S*.10],[.041*k,-S*.36],[0,-S*.43],[-.041*k,-S*.36],[-.070*k,S*.10]],.018,.010),[0,-S*.50,.087*k]));
  b.add(kn,'glow',xf(plate([[-.003,S*.20],[.003,S*.20],[.003,-S*.17],[-.003,-S*.17]],.004,.001),[0,-S*.44,.110*k]));
  // Rear service hatch is inset visually into a broad armored calf.
  b.add(kn,'dark',xf(plate([[-.033*k,S*.12],[.033*k,S*.12],[.027*k,-S*.15],[-.027*k,-S*.15]],.006,.003),[0,-S*.41,-.135*k],[0,Math.PI,0]));
  b.add(kn,'secondary',xf(plate([[-.028*k,S*.10],[.028*k,S*.10],[.022*k,-S*.13],[-.022*k,-S*.13]],.006,.002),[0,-S*.41,-.141*k],[0,Math.PI,0]));
  for (const sign of [-1,1]) b.add(kn,'trim',xf(plate([[-.003,S*.075],[.003,S*.075],[.003,-S*.075],[-.003,-S*.075]],.003,.001),[sign*.025*k,-S*.40,-.146*k],[0,Math.PI,0]));
  const A=rig.spec.ankleH,F=rig.spec.footLen*(.9+k*.1);
  b.add(an,'joint',xf(cyl(.058*k,.058*k,.13*k,14),[0,0,0],[0,0,Math.PI/2]));
  // Enclosed boot with raised instep and substantial toe; never a skeletal toe paddle.
  b.add(an,'dark',xf(plate([[-.075*k,-F*.38],[.075*k,-F*.38],[.088*k,-F*.13],[.077*k,F*.42],[.049*k,F*.51],[-.049*k,F*.51],[-.077*k,F*.42],[-.088*k,-F*.13]],.028,.007),[0,-A+.014,F*.04],[-Math.PI/2,0,0]));
  b.add(an,'primary',xf(armorLoft([
    [-F*.17,.058*k,.033],[-F*.10,.079*k,.050],
    [0,.083*k,.058],[F*.25,.080*k,.040],[F*.43,.060*k,.025],
    [F*.47,.045*k,.018],
  ],20),[0,-A+.065,F*.04],[Math.PI/2,0,0]));
  b.add(an,'secondary',xf(armorLoft([[-.065,.064*k,.059*k],[-.012,.074*k,.072*k],[.040,.062*k,.059*k]],16),[0,0,.012]));
  b.add(an,'primary',xf(ridgeShell([[-.048*k,.048],[.048*k,.048],[.062*k,-.028],[.042*k,-.061],[-.042*k,-.061],[-.062*k,-.028]],.016,.009),[0,-.009,.075*k],[.32,0,0]));
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
  // Enclosed jump-suit thigh; reverse-joint dimensions remain unchanged.
  b.add(th,'primary',armorLoft([[-T*.94,.068*k,.067*k],[-T*.58,.100*k,.100*k],[-T*.20,.106*k,.105*k],[-T*.05,.080*k,.079*k]],20));
  b.add(th, 'dark', xf(cyl(0.06 * k, 0.05 * k, T * 0.9, 12), [0, -T * 0.5, 0]));
  b.add(th, 'primary', xf(ridgeShell([[-0.075, 0.1], [0, 0.13], [0.075, 0.1], [0.06, -0.1], [0, -0.13], [-0.06, -0.1]], 0.028, 0.045), [sx * 0.01, -T * 0.4, 0.065*k], [0, 0, 0], k));
  b.add(th, 'trim', xf(chamferBox(0.03, T * 0.5, 0.09, 0.012), [sx * 0.095 * k, -T * 0.4, 0.0]));
  b.add(th,'primary',xf(ridgeShell([[-.055*k,T*.28],[.055*k,T*.28],[.058*k,0],[.030*k,-T*.29],[-.030*k,-T*.29]],.014,.012),[0,-T*.43,-.055*k],[0,Math.PI,0]));
  const kn = rig.knee[side];
  b.add(kn, 'joint', xf(cyl(0.065 * k, 0.065 * k, 0.13 * k, 16), [0, 0, 0], [0, 0, Math.PI / 2]));
  b.add(kn, 'secondary', xf(plate([[-0.06, -0.05], [0.06, -0.05], [0.07, 0.04], [0, 0.09], [-0.07, 0.04]], 0.05, 0.012), [0, 0.0, 0.07 * k], [0.3, 0, 0], k));
  // Calf casing wraps the spring assembly; only its rear service strip remains visible.
  b.add(kn,'primary',armorLoft([[-S*.95,.057*k,.064*k],[-S*.70,.079*k,.082*k],[-S*.35,.100*k,.096*k],[-S*.08,.073*k,.075*k]],20));
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
  b.add(an, 'primary', xf(armorLoft([[-M*.46,.045*k,.050*k],[-M*.12,.071*k,.075*k],[M*.35,.057*k,.061*k],[M*.46,.044*k,.045*k]],14),[0,-M*.5,0]));
  const pp = piston(new THREE.Vector3(0, -0.02, -0.07), new THREE.Vector3(0, -M + 0.02, -0.05), 0.014);
  b.add(an, 'dark', pp.body);
  b.add(an, 'chrome', pp.rod);
  // Armored toe bridge encloses the splayed jump-foot mechanism.
  const ft = rig.hock[side];
  const A = rig.spec.ankleH;
  b.add(ft, 'joint', xf(sphere(0.05 * k, 12, 10), [0, 0, 0]));
  b.add(ft,'primary',xf(armorLoft([[-.09,.065*k,.035],[-.02,.098*k,.065],[.13,.105*k,.054],[.24,.076*k,.033],[.28,.045*k,.020]],20),[0,-A+.070,0],[Math.PI/2,0,0]));
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
    const k = bulk * (model === 'sprint' ? 0.90 : model === 'anchor' ? 1.22 : model === 'feather' ? 0.86 : 1);
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
