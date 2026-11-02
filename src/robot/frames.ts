import * as THREE from 'three';
import type { Rig, Side } from './rig';
import { PartBuilder, ridgeShell, armorLoft, petal, armorShell, plate, cyl, sphere, torus, lathe, tube, xf, piston, vents } from './kit';
import type { BodyDef } from '../data/parts';

/** Original compound-surface suits: narrow joints, swept armor, and real overlap.
 * Every joint/mount is the shared gameplay rig; no animated hierarchy is replaced. */
export interface FrameProportions {
  hipX: number; waistY: number; chestY: number; neckY: number;
  shoulderX: number; shoulderY: number; upperArm: number; forearm: number;
  bulk: number; legLen: number;
}
export const FRAME_PROPS: Record<BodyDef['frame'], FrameProportions> = {
  striker: { hipX: .135, waistY: .13, chestY: .3, neckY: .19, shoulderX: .32, shoulderY: .09, upperArm: .28, forearm: .30, bulk: .9, legLen: 1.22 },
  ironclad: { hipX: .18, waistY: .13, chestY: .3, neckY: .18, shoulderX: .43, shoulderY: .11, upperArm: .27, forearm: .34, bulk: 1.22, legLen: 1.27 },
  wisp: { hipX: .12, waistY: .15, chestY: .28, neckY: .19, shoulderX: .29, shoulderY: .08, upperArm: .28, forearm: .30, bulk: .76, legLen: 1.24 },
  regent: { hipX: .14, waistY: .14, chestY: .30, neckY: .19, shoulderX: .35, shoulderY: .10, upperArm: .29, forearm: .32, bulk: .95, legLen: 1.23 },
};
type Frame = BodyDef['frame'];
type B = PartBuilder;
const SIDES: Side[] = ['L', 'R'];

function nozzle(rig: Rig, b: B, parent: THREE.Object3D, p: [number, number, number], radius: number, tilt = -.35) {
  const bell = lathe([[radius*.5,.05],[radius*.55,.015],[radius,-.07],[radius*.85,-.08],[radius*.58,-.015]], 16);
  b.add(parent,'dark',xf(bell,p,[tilt,0,0]));
  // Outer lip shares the exit transform with the inner ring and exhaust anchor.
  b.add(parent,'trim',xf(torus(radius*1.08,.009,16,5),[p[0],p[1]-.07*Math.cos(tilt),p[2]-.07*Math.sin(tilt)],[Math.PI/2+tilt,0,0]));
  b.add(parent,'chrome',xf(torus(radius*.92,.006,16,5),[p[0],p[1]-.07*Math.cos(tilt),p[2]-.07*Math.sin(tilt)],[Math.PI/2+tilt,0,0]));
  b.add(parent,'glowHot',xf(cyl(radius*.46,radius*.46,.008,12),[p[0],p[1]-.025,p[2]],[tilt,0,0]));
  rig.addNozzle(parent,[p[0],p[1]-.07*Math.cos(tilt),p[2]-.07*Math.sin(tilt)],[tilt,0,0],'back');
}
function joint(b:B,p:THREE.Object3D,r:number,w:number) {
  b.add(p,'joint',xf(cyl(r,r,w,16),[0,0,0],[0,0,Math.PI/2]));
  for (const sx of [-1,1]) b.add(p,'chrome',xf(cyl(r*.56,r*.56,.009,12),[sx*w*.51,0,0],[0,0,Math.PI/2]));
}
function base(rig:Rig,b:B,frame:Frame) {
  const heavy=frame==='ironclad', k=heavy?1.2:frame==='wisp'?.88:1;
  b.add(rig.hips,'dark',armorLoft([[-.075,.13*k,.085],[0,.19*k,.115],[.09,.125*k,.09]],16));
  for (const sx of [-1,1]) b.add(rig.hips,'joint',xf(sphere(.07,12,10),[sx*rig.spec.hipX,0,0]));
  // Flexible torso with three individually curved abdominal scales.
  b.add(rig.waist,'joint',armorLoft([[-.08,.105*k,.075],[.06,.095*k,.078],[.19,.135*k,.09]],12));
  for(let i=0;i<3;i++) for(const sx of [-1,1]) b.add(rig.waist,i===2?'trim':'primary',xf(ridgeShell([[.008,.015],[.08*k,.055],[.07*k,-.012],[.012,-.05]],.018,.012),[0,.14-i*.065,.075],[.08,-sx*.16,0],[sx,1,1]));
  for(const sx of [-1,1]) {
    const hyd=piston(new THREE.Vector3(sx*.105*k,-.06,-.07),new THREE.Vector3(sx*.16*k,.19,-.09),heavy?.021:.012);
    b.add(rig.waist,'dark',hyd.body);b.add(rig.waist,'chrome',hyd.rod);
  }
  // Rear waist lamellae protect the spine while the side hydraulics remain exposed.
  for(let i=0;i<3;i++) b.add(rig.waist,i===1?'secondary':'primary',xf(ridgeShell([[-.065*k,.025],[.065*k,.025],[.05*k,-.015],[0,-.036],[-.05*k,-.015]],.016,.008),[0,.145-i*.057,-.095],[0,Math.PI,0]));
  rig.flapF.position.set(0,.025,.105);
  b.add(rig.flapF,'primary',xf(ridgeShell([[-.075*k,.045],[.075*k,.045],[.035*k,-.11],[0,-.145],[-.035*k,-.11]],.025,.012),[0,-.01,0],[-.12,0,0]));
  for(const [flap,sx] of [[rig.flapL,1],[rig.flapR,-1]] as const) {
    flap.position.set(sx*(rig.spec.hipX+.035),.04,0);
    b.add(flap,'primary',xf(ridgeShell([[-.055*k,.065],[.055*k,.045],[.075*k,-.10],[.015*k,-.16],[-.045*k,-.08]],.025,.018),[sx*.02,-.04,0],[0,sx*Math.PI/2,-sx*.18]));
  }
}
function helmet(rig:Rig,b:B,frame:Frame) {
  const h=rig.head, heavy=frame==='ironclad', slim=frame==='wisp';
  const w=heavy?.115:slim?.080:.091;
  // Low forward brow and swept crown establish a small angular helmet, not an egg.
  b.add(h,'dark',armorLoft([[.025,w*.32,.045,0,.025],[.085,w*.83,.075],[.17,w,.085],[.235,w*.6,.058,0,-.025]],10));
  for(const sx of [-1,1]) {
    b.add(h,'primary',xf(ridgeShell([[.008,.23],[w*.55,.25],[w,.16],[w*.65,.11],[.015,.145]],.018,.014),[0,0,.065],[.13,-sx*.25,0],[sx,1,1]));
    b.add(h,'secondary',xf(ridgeShell([[w*.60,.12],[w*1.20,.19],[w*1.04,.065],[w*.58,.035]],.015,.008),[0,0,.025],[0,-sx*.32,0],[sx,1,1]));
    b.add(h,'visor',xf(ridgeShell([[.006,.14],[w*.88,.165],[w*.63,.11],[.014,.09]],.009,.004),[0,0,.093],[0,-sx*.15,0],[sx,1,1]));
    b.add(h,'glowHot',xf(plate([[.008,.136],[w*.82,.159],[w*.70,.145],[.014,.117]],.004,.001),[0,0,.105],[0,-sx*.15,0],[sx,1,1]));
    b.add(h,'primary',xf(ridgeShell([[.012,.10],[w*.66,.11],[w*.54,.045],[.012,.008]],.018,.012),[0,0,.086],[0,-sx*.18,0],[sx,1,1]));
    b.add(h,'chrome',xf(cyl(.017,.017,.008,10),[sx*w,.10,-.025],[0,0,Math.PI/2]));
  }
  b.add(h,'trim',xf(ridgeShell([[-.012,.075],[0,.018],[.012,.075],[0,.13]],.012,.01),[0,0,.101]));
  b.add(h,'primary',xf(ridgeShell([[-.025,.245],[.025,.245],[.035,.19],[0,.14],[-.035,.19]],.018,.012),[0,0,.070],[.14,0,0]));
  // Rear cranial shell and exposed neck actuators retain volume in side/back views.
  b.add(h,'primary',xf(ridgeShell([[-w*.65,.20],[w*.65,.20],[w*.72,.11],[w*.35,.055],[-w*.35,.055],[-w*.72,.11]],.02,.014),[0,0,-.067],[0,Math.PI,0]));
  b.add(h,'dark',xf(plate([[-.026,.075],[.026,.075],[.021,.14],[-.021,.14]],.005,.001),[0,0,-.087],[0,Math.PI,0]));
  for(const sx of [-1,1]) {
    const p=piston(new THREE.Vector3(sx*.032,-.05,-.022),new THREE.Vector3(sx*.036,.055,-.04),.008);
    b.add(rig.neck,'dark',p.body);b.add(rig.neck,'chrome',p.rod);
  }
  if(frame==='regent') b.add(h,'secondary',xf(ridgeShell([[-.045,.16],[.015,.21],[.045,.40],[-.017,.32]],.019,.009),[0,0,-.025],[0,Math.PI/2,0]));
  else if(slim) b.add(h,'primary',xf(ridgeShell([[-.025,.15],[.035,.22],[.09,.30],[.015,.27]],.014,.009),[0,0,-.055],[0,Math.PI/2,0]));
  if(heavy) for(const sx of [-1,1]) b.add(rig.neck,'dark',xf(ridgeShell([[-.035,-.025],[.035,-.025],[.025,.10],[-.025,.08]],.065,.01),[sx*.12,.03,0],[0,sx*.4,0]));
  rig.lockPoint.position.set(0,.28,0);
}
function arm(rig:Rig,b:B,side:Side,frame:Frame) {
  const sx=side==='L'?1:-1, heavy=frame==='ironclad', slim=frame==='wisp', paladin=frame==='regent';
  const a=rig.arm[side], e=rig.elbow[side], pad=rig.pad[side], hand=rig.hand[side];
  const u=rig.spec.upperArm,f=rig.spec.forearm,k=heavy?1.5:slim?.8:1;
  joint(b,a,.065*k,.105*k);
  b.add(a,'dark',xf(armorLoft([[-u*.88,.038*k,.04*k],[-u*.5,.055*k,.055*k],[-u*.14,.045*k,.05*k]]),[0,0,0]));
  b.add(a,'primary',xf(ridgeShell([[-.042*k,.065],[.045*k,.055],[.032*k,-.07],[0,-.10],[-.035*k,-.055]],.018,.01),[sx*.014,-u*.43,.045],[0,-sx*.12,sx*.09]));
  joint(b,e,.053*k,.115*k);
  b.add(e,'dark',xf(armorLoft([[-f*.95,.032*k,.034*k,0,.01],[-f*.68,.045*k,.045*k,0,.01],[-f*.22,.055*k,.055*k],[.015,.043*k,.045*k]],12),[0,0,0]));
  b.add(e,'secondary',xf(ridgeShell([[-.025*k,.08],[.025*k,.09],[.04*k,-.04],[0,-.13],[-.02*k,-.06]],.018,.01),[sx*.06*k,-f*.42,.03*k],[0,sx*.9,0]));
  if(heavy) for(const dx of [-1,1]) {
    const p=piston(new THREE.Vector3(dx*.085,.01,-.04),new THREE.Vector3(dx*.07,-f*.85,-.04),.018);
    b.add(e,'dark',p.body);b.add(e,'chrome',p.rod);
  }
  if(slim) { nozzle(rig,b,e,[sx*.075,-f*.6,-.035],.026,0); }
  b.add(e,'glow',xf(plate([[-.008,-.07],[.008,-.07],[.006,.07],[-.006,.07]],.005,.001),[sx*.035,-f*.4,.1*k]));
  // Three swept shells overlap around the exposed ball joint. The pointed lower
  // edge, rather than added greebles, carries the class silhouette.
  const sw=heavy?.34:slim?.22:paladin?.35:.28;
  const cap: [number,number][] = heavy
    ? [[-.09,-.03],[.16,-.055],[sw*.68,.09],[sw*.32,.18],[-.10,.12]]
    : [[-.09,.035],[.06,.16],[sw*.64,.12],[sw*.88,-.015],[.015,.015]];
  b.add(pad,'dark',xf(armorLoft([[-.10,.07,.085],[.045,.10,.105],[.10,.065,.065]],10),[sx*.025,0,0]));
  b.add(pad,'primary',xf(ridgeShell(cap,heavy?.07:.038,heavy?.025:.014),[sx*.015,.025,.035],[.12,sx*.38,0],[sx,1,1]));
  b.add(pad,'primary',xf(ridgeShell([[-.05,.055],[sw*.48,.09],[sw*.75,-.13],[sw*.12,-.035]],.03,.018),[sx*.035,-.035,.055],[.12,sx*.25,-sx*.12],[sx,1,1]));
  b.add(pad,'secondary',xf(ridgeShell([[0,.07],[sw*.32,.12],[sw*.67,-.19],[sw*.19,-.08]],.025,.014),[sx*.045,-.025,-.025],[0,sx*.45,-sx*.1],[sx,1,1]));
  if(!heavy) {
    b.add(pad,'trim',xf(plate([[.025,.10],[sw*.53,.077],[sw*.51,.071],[.03,.094]],.004,.001),[sx*.015,.025,.071],[.12,sx*.38,0],[sx,1,1]));
    b.add(pad,'chrome',xf(cyl(.006,.006,.005,6),[sx*.045,.09,.076],[Math.PI/2,0,0]));
  }
  if(paladin) b.add(pad,'trim',xf(ridgeShell([[0,0],[.09,.04],[.18,-.25],[.055,-.15]],.025,.014),[sx*.10,-.06,-.035],[0,sx*.35,0],[sx,1,1]));
  if(heavy) {
    for(const x of [-.025,.08]) b.add(pad,'chrome',xf(cyl(.013,.013,.01,6),[sx*x,.07,.11],[Math.PI/2,0,0]));
    for(const g of vents(.09,.04,3,.006)) b.add(pad,'dark',xf(g,[sx*.07,.04,.117]));
  }
  // Split gauntlet shells taper into a slim exposed wrist.
  b.add(e,'primary',xf(ridgeShell([[-.065*k,.055],[.06*k,.08],[.055*k,-.13],[.012*k,-.24],[-.04*k,-.13]],.024,.022),[sx*.02,-.015,.08*k],[0,-sx*.16,-sx*.08]));
  // Compact articulated glove with separate fingers, no mitten block.
  hand.position.y=-f-.015;
  b.add(hand,'dark',xf(petal(.10*k,.11,.09*k),[0,-.045,.005]));
  for(let j=0;j<3;j++) b.add(hand,'joint',xf(armorLoft([[-.09,.012*k,.019],[-.03,.016*k,.025],[0,.012*k,.022]],8),[(j-1)*.03*k,-.02,.028],[.2,0,0]));
  b.add(hand,'primary',xf(petal(.075*k,.07,.026),[0,-.035,.055]));
}
function chest(rig:Rig,b:B,frame:Frame) {
  const heavy=frame==='ironclad', slim=frame==='wisp', paladin=frame==='regent', c=rig.chest;
  const w=heavy?.34:slim?.225:paladin?.28:.26,d=heavy?.19:slim?.115:.14;
  b.add(c,'dark',armorLoft([[-.19,w*.32,d*.58],[-.06,w*.62,d*.82],[.09,w*.94,d],[.17,w*.8,d*.72],[.20,w*.4,d*.5]],12));
  if(heavy) b.add(c,'primary',xf(ridgeShell([[-.27,.105],[.27,.105],[.25,-.09],[.12,-.18],[-.12,-.18],[-.25,-.09]],.045,.015),[0,0,d*.58]));
  for(const sx of [-1,1]) {
    // Sloping clavicle blade and successive floating rib blades converge into a keel.
    b.add(c,'primary',xf(ridgeShell([[.012,.115],[w*.58,.185],[w*.98,.105],[w*.64,.035],[.07,-.035]],heavy?.055:.035,heavy?.024:.016),[0,0,d*.78],[-.08,-sx*.22,0],[sx,1,1]));
    b.add(c,'secondary',xf(ridgeShell([[.025,.13],[w*.63,.19],[w*.83,.15],[w*.58,.125]],.015,.009),[0,.006,d*.85],[0,-sx*.22,0],[sx,1,1]));
    if(!heavy) b.add(c,'dark',xf(plate([[.085,.105],[w*.68,.125],[w*.62,.111],[.088,.094]],.004,.001),[0,0,d+.01],[0,-sx*.22,0],[sx,1,1]));
    for(let i=0;i<2;i++) b.add(c,i?'trim':'primary',xf(ridgeShell([[.055,.015],[w*.75,.075],[w*.72,-.015],[.045,-.10]],.022,.018),[0,-.04-i*.075,d*.72-i*.014],[0,-sx*.38,0],[sx,1,1]));
    const p=piston(new THREE.Vector3(sx*w*.44,-.17,-d*.35),new THREE.Vector3(sx*w*.88,.085,-d*.4),heavy?.024:.012);
    b.add(c,'dark',p.body);b.add(c,'chrome',p.rod);
    if(heavy) for(const g of vents(.09,.065,3,.008)) b.add(c,'trim',xf(g,[sx*w*.7,.04,d*.91],[0,-sx*.28,0]));
  }
  const keel: [number,number][] = heavy ? [[-.05,.10],[.05,.10],[.043,-.10],[0,-.18],[-.043,-.10]] : [[-.035,.075],[0,.035],[.035,.075],[.018,-.10],[0,-.18],[-.018,-.10]];
  b.add(c,'primary',xf(ridgeShell([[-.11,.145],[.11,.145],[.06,.065],[0,.025],[-.06,.065]],.022,.018),[0,0,d+.016]));
  // Split narrow center shell leaves the luminous inner channel readable at gameplay scale.
  b.add(c,'dark',xf(plate(keel,.025,.004),[0,0,d+.012]));
  b.add(c,'glowHot',xf(plate([[-.010,.02],[.010,.02],[.007,-.08],[0,-.135],[-.007,-.08]],.006,.001),[0,0,d+.035]));
  if(heavy) {
    b.add(c,'trim',xf(plate([[-.057,.055],[.057,.055],[.057,-.095],[0,-.145],[-.057,-.095]],.035,.007),[0,-.005,d+.035]));
    b.add(c,'dark',xf(plate([[-.040,.041],[.040,.041],[.040,-.084],[0,-.12],[-.040,-.084]],.012,.003),[0,-.005,d+.057]));
    for(let i=0;i<5;i++) b.add(c,'glowHot',xf(plate([[-.025,0],[.025,0],[.025,.009],[-.025,.009]],.004,.001),[0,-.075+i*.023,d+.066]));
  }
  b.add(c,'decal',xf(new THREE.PlaneGeometry(.045,.045),[w*.45,.125,d+.025],[-.08,.1,0]));
  b.add(c,'trim',xf(torus(.07,.013,14,5),[0,.18,-.02],[Math.PI/2,0,0]));
  b.add(rig.neck,'joint',xf(cyl(.035,.047,.08,12),[0,.015,0]));
}
function backpack(rig:Rig,b:B,frame:Frame) {
  const heavy=frame==='ironclad', slim=frame==='wisp', paladin=frame==='regent', bk=rig.back;
  bk.position.set(0,.025,-(heavy?.17:.13));
  b.add(bk,'dark',xf(armorLoft([[-.17,heavy?.13:.075,.045],[.04,heavy?.16:.09,.06],[.17,.055,.035]],10),[0,0,-.04]));
  for(let i=0;i<3;i++) b.add(bk,'trim',xf(ridgeShell([[-.075,.04],[.075,.04],[.045,-.025],[0,-.06],[-.045,-.025]],.018,.009),[0,.10-i*.085,-.10],[0,Math.PI,0]));
  for(const sx of [-1,1]) {
    const x=sx*(heavy?.18:slim?.12:.105);
    // Overlapping scapular shells turn the back into a readable armored surface
    // without enclosing the central pod dock or the nozzle's exhaust path.
    const spread=heavy?1.25:slim?.88:1;
    b.add(bk,'primary',xf(ridgeShell([[.015,.155],[.17*spread,.17],[.23*spread,.055],[.14*spread,-.01],[.035,.045]],.028,.014),[0,.025,-.105],[0,Math.PI,0],[sx,1,1]));
    b.add(bk,'primary',xf(ridgeShell([[.025,.055],[.16*spread,.09],[.18*spread,-.045],[.08*spread,-.16],[.03,-.075]],.025,.012),[0,-.035,-.13],[0,Math.PI,0],[sx,1,1]));
    b.add(bk,'dark',xf(armorLoft([[-.17,.038,.04],[-.08,.052,.05],[.12,.042,.045],[.18,.025,.03]],12),[x,0,-.07],[slim?-.25:-.1,0,-sx*.12]));
    b.add(bk,'primary',xf(ridgeShell([[-.045,.17],[.045,.13],[.065,-.06],[.02,-.15],[-.045,-.10]],.025,.015),[x,0,-.12],[slim?-.25:-.1,Math.PI,-sx*.12]));
    nozzle(rig,b,bk,[x,-.13,-.08],heavy?.085:slim?.06:.055,-.45);
    if(slim) {
      // Three separate flight feathers with swept tips and exposed root hinges.
      for(let i=0;i<3;i++) {
        const wing=rig.addDangler(bk,[sx*.13,.08-i*.055,-.04-i*.025]);
        b.add(wing,i===1?'secondary':'primary',xf(armorShell([[0,-.04],[.12,-.01],[.42-i*.065,.3-i*.025],[.32-i*.05,.30-i*.025],[.08,.045]],.026,.012),[0,0,0],[0,-sx*.28,0],[sx,1,1]));
        b.add(wing,'glow',xf(plate([[.12,.03],[.32-i*.05,.24-i*.025],[.3-i*.05,.20-i*.025],[.12,.02]],.005,.001),[0,0,.02],[0,-sx*.28,0],[sx,1,1]));
      }
      b.add(bk,'joint',tube([new THREE.Vector3(sx*.04,.13,0),new THREE.Vector3(sx*.18,-.02,-.08),new THREE.Vector3(sx*.06,-.13,0)],.009,12));
    } else if(paladin) {
      b.add(bk,'primary',xf(armorShell([[0,-.22],[.10,-.08],[.18,.30],[.08,.23]],.07,.018),[sx*.12,.015,-.05],[0,-sx*.3,0],[sx,1,1]));
    } else if(heavy) {
      for(let i=0;i<4;i++) b.add(bk,'dark',xf(cyl(.05,.05,.015,12),[x,.025+i*.035,-.12],[Math.PI/2,0,0]));
    }
  }
  rig.podMount.position.set(0,.17,-.10);
  rig.bombMount.position.set(heavy?.27:.235,.21,-.075);
}
export function buildFrame(frame:Frame,rig:Rig,b:B) {
  base(rig,b,frame);chest(rig,b,frame);helmet(rig,b,frame);backpack(rig,b,frame);
  for(const side of SIDES) arm(rig,b,side,frame);
}
