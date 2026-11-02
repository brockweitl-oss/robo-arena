import * as THREE from 'three';
import type { Rig, Side } from './rig';
import { PartBuilder, armorLoft, petal, armorShell, plate, cyl, sphere, torus, lathe, tube, xf, piston, vents } from './kit';
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
  for(let i=0;i<3;i++) b.add(rig.waist,i===2?'trim':'primary',xf(armorShell([[-.08*k,.025],[.08*k,.025],[.07*k,-.025],[0,-.04],[-.07*k,-.025]],.025,.014),[0,.14-i*.065,.085],[.1,0,0]));
  for(const sx of [-1,1]) {
    const hyd=piston(new THREE.Vector3(sx*.105*k,-.06,-.07),new THREE.Vector3(sx*.16*k,.19,-.09),heavy?.021:.012);
    b.add(rig.waist,'dark',hyd.body);b.add(rig.waist,'chrome',hyd.rod);
  }
  rig.flapF.position.set(0,.025,.105);
  b.add(rig.flapF,'primary',xf(petal(.17*k,.19,.045,.02),[0,-.06,0],[-.12,0,0]));
  for(const [flap,sx] of [[rig.flapL,1],[rig.flapR,-1]] as const) {
    flap.position.set(sx*(rig.spec.hipX+.035),.04,0);
    b.add(flap,'primary',xf(petal(.14*k,.22,.055,.025),[sx*.02,-.08,0],[0,sx*Math.PI/2,-sx*.18]));
  }
}
function helmet(rig:Rig,b:B,frame:Frame) {
  const h=rig.head, heavy=frame==='ironclad', slim=frame==='wisp';
  const w=heavy?.125:slim?.086:.103, z=heavy?.12:.105;
  // An actual swept cranium with a sloping crown, not a chamfered cube.
  b.add(h,'primary',armorLoft([[.035,w*.62,z*.57,0,.022],[.1,w,z*.94],[.19,w*.96,z],[.255,w*.58,z*.66,0,-.026],[.27,w*.2,z*.22,0,-.035]],20));
  b.add(h,'visor',xf(petal(w*1.66,.10,.038,-.012),[0,.158,z*.91],[.15,0,0]));
  if(heavy) {
    b.add(h,'glowHot',xf(plate([[-.075,0],[.075,0],[.067,.015],[-.067,.015]],.006,.002),[0,.167,.121]));
    // Sunken helmet with a protective collar instead of a huge head.
    for(const sx of [-1,1]) b.add(rig.neck,'trim',xf(petal(.085,.19,.12),[sx*.13,.035,0],[0,0,-sx*.18]));
  } else {
    for(const sx of [-1,1]) {
      b.add(h,'glowHot',xf(plate([[.012,0],[w*.82,.018],[w*.72,.025],[.017,.014]],.005,.001),[0,.155,.123],[0,0,0],[sx,1,1]));
      b.add(h,'primary',xf(armorShell([[.008,-.02],[w*.67,-.005],[w*.83,.055],[.025,.04]],.018,.007),[0,.07,.11],[0,0,0],[sx,1,1]));
    }
  }
  for(const sx of [-1,1]) {
    b.add(h,'trim',xf(petal(.045,.14,.08),[sx*w*.96,.12,-.005],[0,0,-sx*.14]));
    b.add(h,'chrome',xf(cyl(.023,.023,.012,12),[sx*w*1.12,.16,-.015],[0,0,Math.PI/2]));
  }
  if(frame==='regent') {
    // Single swept blade and asymmetric sensor spar: original, not a V-fin.
    b.add(h,'secondary',xf(plate([[-.065,0],[.035,.03],[.055,.22],[-.018,.14]],.022,.004),[0,.22,-.005],[0,Math.PI/2,0]));
    const antenna=rig.addAntenna(h,[-.105,.19,-.035],[0,0,.12]);
    b.add(antenna,'chrome',xf(cyl(.005,.009,.2,8),[0,.1,0]));
  } else if(slim) b.add(h,'secondary',xf(petal(.045,.2,.07),[0,.20,-.035],[.55,0,0]));
  else if(!heavy) b.add(h,'trim',xf(petal(.038,.15,.035),[0,.235,-.05],[Math.PI/2,0,0]));
  rig.lockPoint.position.set(0,.31,0);
  // Offset optical rangefinder: three recessed lenses in one mechanical cheek housing.
  const sensorX = -w * 1.04;
  b.add(h,'dark',xf(armorShell([[-.025,-.045],[.025,-.035],[.025,.045],[-.018,.05]],.025,.004),[sensorX,.14,.065],[0,-.55,0]));
  for (let i=0;i<3;i++) {
    b.add(h,'chrome',xf(torus(.009,.003,10,4),[sensorX,.114+i*.022,.093],[0,-.55,0]));
    b.add(h,i===1?'glow':'visor',xf(cyl(.006,.006,.005,10),[sensorX-.002,.114+i*.022,.095],[Math.PI/2,-.55,0]));
  }
}
function arm(rig:Rig,b:B,side:Side,frame:Frame) {
  const sx=side==='L'?1:-1, heavy=frame==='ironclad', slim=frame==='wisp', paladin=frame==='regent';
  const a=rig.arm[side], e=rig.elbow[side], pad=rig.pad[side], hand=rig.hand[side];
  const u=rig.spec.upperArm,f=rig.spec.forearm,k=heavy?1.5:slim?.8:1;
  joint(b,a,.065*k,.105*k);
  b.add(a,'dark',xf(armorLoft([[-u*.88,.038*k,.04*k],[-u*.5,.055*k,.055*k],[-u*.14,.045*k,.05*k]]),[0,0,0]));
  b.add(a,'primary',xf(petal(.115*k,u*.65,.11*k,.025),[sx*.014,-u*.43,.025],[0,0,sx*.09]));
  joint(b,e,.053*k,.115*k);
  b.add(e,'primary',xf(armorLoft([[-f*.95,.045*k,.045*k,0,.01],[-f*.68,.07*k,.065*k,0,.01],[-f*.22,.085*k,.08*k],[.015,.055*k,.06*k]],16),[0,0,0]));
  b.add(e,'secondary',xf(armorShell([[-.06*k,.09],[.06*k,.09],[.045*k,-.055],[0,-.11],[-.045*k,-.055]],.025,.016),[0,-f*.43,.08*k],[-.15,0,0]));
  if(heavy) for(const dx of [-1,1]) {
    const p=piston(new THREE.Vector3(dx*.085,.01,-.04),new THREE.Vector3(dx*.07,-f*.85,-.04),.018);
    b.add(e,'dark',p.body);b.add(e,'chrome',p.rod);
  }
  if(slim) { nozzle(rig,b,e,[sx*.075,-f*.6,-.035],.026,0); }
  b.add(e,'glow',xf(plate([[-.008,-.07],[.008,-.07],[.006,.07],[-.006,.07]],.005,.001),[sx*.035,-f*.4,.1*k]));
  // Pressed shoulder shell: a broad crown, a cut lower corner, and a separate overlapping cap.
  const sw=heavy?.36:slim?.18:paladin?.30:.245, sh=heavy?.27:.19, sd=heavy?.32:slim?.18:.235;
  if(paladin) b.add(pad,'primary',xf(armorShell([[-.11,-.07],[.075,-.105],[.18,-.015],[.12,.125],[-.1,.10]],.25,.025),[sx*.025,.015,-.005],[.08,sx*.14,0],[sx,1,1]));
  else {
    const pos: [number,number,number] = [sx*(heavy?.045:.025),.015,-.005];
    const rot: [number,number,number] = [.05,0,-sx*(heavy?.1:.25)];
    // A true recessed casing split follows the curved cross-section, rather than a floating decal.
    b.add(pad,'dark',xf(armorLoft([[-sh*.13,sw*.47,sd*.43],[sh*.09,sw*.46,sd*.42]],10),pos,rot,[sx,1,1]));
    b.add(pad,'primary',xf(armorLoft([[-sh*.48,sw*.27,sd*.27,sw*.09,0],[-sh*.12,sw*.49,sd*.45],[-.008,sw*.48,sd*.445]],10),pos,rot,[sx,1,1]));
    b.add(pad,'primary',xf(armorLoft([[.009,sw*.478,sd*.442],[sh*.23,sw*.46,sd*.43],[sh*.40,sw*.29,sd*.30,-sw*.07,-.01]],10),pos,rot,[sx,1,1]));
    if (heavy) for (const x of [-.075,.075]) b.add(pad,'chrome',xf(cyl(.012,.012,.009,6),[sx*.045+x,-.035,sd*.40],[Math.PI/2,0,0]));
  }
  if(paladin) b.add(pad,'secondary',xf(armorShell([[-.1,.015],[.10,.04],[.155,-.015],[.10,-.035],[-.08,-.025]],.08,.012),[sx*.03,.1,.07],[.18,0,0],[sx,1,1]));
  else b.add(pad,'secondary',xf(armorShell([[-sw*.42,.023],[sw*.20,.035],[sw*.43,.005],[sw*.32,-.02],[-sw*.38,-.014]],sd*.52,.009),[sx*.025,.092,-sd*.15],[.08,0,-sx*.20],[sx,1,1]));
  if(heavy || paladin) {
    b.add(pad,'trim',xf(armorShell([[-sw*.19,.014],[sw*.19,.014],[sw*.16,-.018],[-sw*.16,-.018]],.007,.001),[sx*.025,.02,sd*.46],[0,0,-sx*.28]));
    for(const g of vents(sw*.26,.024,2,.004)) b.add(pad,'dark',xf(g,[sx*.025,.02,sd*.48],[0,0,-sx*.28]));
  }
  // Fine casing split crosses the gauntlet above the wrist.
  b.add(e,'dark',xf(armorShell([[-.047*k,.008],[.047*k,.008],[.042*k,-.008],[-.042*k,-.008]],.005,.001),[0,-f*.72,.069*k]));
  if(heavy || paladin) {
    b.add(pad,'primary',xf(petal(sw*.64,.17,.07,.035),[sx*sw*.32,-.075,.01],[0,sx*.4,-sx*.2]));
    for(const dx of [-1,1]) {b.add(pad,'dark',xf(cyl(.025,.025,.018,12),[sx*.02+dx*.052,.015,-sd*.48],[Math.PI/2,0,0]));b.add(pad,'glow',xf(cyl(.012,.012,.02,10),[sx*.02+dx*.052,.015,-sd*.49],[Math.PI/2,0,0]));}
  }
  if(paladin) b.add(pad,'secondary',xf(plate([[-.03,-.02],[.08,.01],[.17,.19],[.05,.13]],.035,.008),[sx*.08,.015,-.05],[0,0,0],[sx,1,1]));
  // Compact articulated glove with separate fingers, no mitten block.
  hand.position.y=-f-.015;
  b.add(hand,'dark',xf(petal(.10*k,.11,.09*k),[0,-.045,.005]));
  for(let j=0;j<3;j++) b.add(hand,'joint',xf(armorLoft([[-.09,.012*k,.019],[-.03,.016*k,.025],[0,.012*k,.022]],8),[(j-1)*.03*k,-.02,.028],[.2,0,0]));
  b.add(hand,'primary',xf(petal(.075*k,.07,.026),[0,-.035,.055]));
}
function chest(rig:Rig,b:B,frame:Frame) {
  const heavy=frame==='ironclad', slim=frame==='wisp', paladin=frame==='regent', c=rig.chest;
  const w=heavy?.36:slim?.235:paladin?.285:.275, d=heavy?.21:slim?.12:.155;
  // Continuous compound hull, narrow at waist, powerful at clavicle, swept spine.
  b.add(c,'dark',armorLoft([[-.18,w*.38,d*.63,0,-.005],[-.07,w*.68,d*.85],[.08,w*.96,d],[.17,w*.86,d*.8,0,-.015],[.20,w*.46,d*.6,0,-.025]],20));
  for(const sx of [-1,1]) {
    // Broad folded breastplate with a clipped lower edge; the curved hull remains exposed beneath.
    if(paladin) b.add(c,'primary',xf(armorShell([[.025,-.12],[.19,-.11],[.28,.06],[.23,.145],[.055,.10]],.085,.035),[0,0,d*.6],[-.12,-sx*.14,0],[sx,1,1]));
    else b.add(c,'primary',xf(armorShell([[.035,-.105],[w*.55,-.13],[w*.91,-.045],[w*.94,.10],[w*.60,.145],[.045,.10]],heavy?.072:.052,heavy?.026:.02),[0,0,d*.65],[-.10,-sx*.18,0],[sx,1,1]));
    b.add(c,'secondary',xf(armorShell([[.045,.125],[w*.62,.17],[w*.91,.13],[w*.87,.095],[w*.58,.12],[.05,.085]],.025,.009),[0,0,d*.78],[-.12,-sx*.18,0],[sx,1,1]));
    // Floating side ribs reveal recessed structural bands.
    for(let i=0;i<2;i++) b.add(c,i?'trim':'primary',xf(petal(w*.45,.105,.065,.018),[sx*w*(.63-i*.13),-.08-i*.055,d*.55],[-.05,-sx*.55,sx*.23]));
    const p=piston(new THREE.Vector3(sx*w*.65,-.13,-d*.5),new THREE.Vector3(sx*w*.9,.1,-d*.45),heavy?.022:.012);
    b.add(c,'dark',p.body); b.add(c,'chrome',p.rod);
  }
  // Sculpted sternum bridges the paired pectorals; layered edges and recessed
  // intake mouths read as manufactured plates rather than soft organic lobes.
  b.add(c,'primary',xf(armorShell([[-.055,-.15],[.055,-.15],[.08,.09],[.045,.16],[-.045,.16],[-.08,.09]],.04,.018),[0,-.005,d*.88]));
  for(const sx of [-1,1]) {
    const vx=sx*w*.63,vy=.04,vz=d+.035;
    b.add(c,'dark',xf(armorShell([[-.035,-.044],[.035,-.034],[.045,.04],[-.03,.05]],.009,.002),[vx,vy,vz],[-.12,-sx*.20,-sx*.28]));
    for(const g of vents(.05,.065,4,.006)) b.add(c,'chrome',xf(g,[vx,vy,vz+.008],[-.12,-sx*.20,-sx*.28]));
    b.add(c,'trim',xf(plate([[-.065,.0],[.06,-.012],[.062,-.02],[-.065,-.008]],.007,.001),[sx*w*.48,.11,d*.97],[-.1,-sx*.2,-sx*.25]));
    if(paladin) b.add(c,'secondary',xf(armorShell([[.035,.15],[w*.92,.12],[w*.78,.055],[.07,.01]],.025,.016),[0,0,d*.77],[0,-sx*.08,0],[sx,1,1]));
  }
  // Reactor shaped differently for each class, restrained emissive intensity.
  if(heavy) {
    b.add(c,'trim',xf(cyl(.087,.095,.04,20),[0,.015,d+.022],[Math.PI/2,0,0]));
    b.add(c,'chrome',xf(torus(.07,.009,20,6),[0,.015,d+.047]));
    b.add(c,'glowHot',xf(cyl(.046,.046,.012,16),[0,.015,d+.045],[Math.PI/2,0,0]));
    for(const sx of [-1,1]) for(let i=0;i<3;i++) b.add(c,'secondary',xf(plate([[-.012,-.035],[.012,-.035],[.026,.035],[.002,.035]],.006,.001),[sx*(.22+i*.018),.05,d*.98],[0,-sx*.3,0]));
  } else {
    const core=paladin?[[-.035,-.045],[.035,-.045],[.048,.035],[0,.065],[-.048,.035]]:slim?[[-.015,-.075],[.015,-.075],[.022,.05],[-.022,.05]]:[[-.044,0],[0,-.05],[.044,0],[0,.05]];
    b.add(c,'trim',xf(plate(core as [number,number][],.03,.006),[0,.005,d+.025]));
    b.add(c,'glowHot',xf(plate(core as [number,number][],.015,.003),[0,.005,d+.044],[0,0,0],.65));
  }
  b.add(c,'decal',xf(new THREE.PlaneGeometry(.065,.065),[.075,.11,d+.02],[-.14,.08,0]));
  b.add(c,'trim',xf(torus(.085,.018,16,6),[0,.18,-.025],[Math.PI/2,0,0]));
  b.add(rig.neck,'joint',xf(cyl(.045,.055,.08,12),[0,.015,0]));
}
function backpack(rig:Rig,b:B,frame:Frame) {
  const heavy=frame==='ironclad', slim=frame==='wisp', paladin=frame==='regent', bk=rig.back;
  bk.position.set(0,.025,-(heavy?.17:.13));
  b.add(bk,'trim',xf(petal(heavy?.35:.22,.32,.12),[0,-.015,-.055],[0,Math.PI,0]));
  for(const sx of [-1,1]) {
    const x=sx*(heavy?.18:slim?.12:.105);
    b.add(bk,'primary',xf(armorLoft([[-.17,.045,.045],[-.08,.07,.065],[.12,.055,.055],[.18,.028,.035]],14),[x,0,-.07],[slim?-.25:-.1,0,-sx*.12]));
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
