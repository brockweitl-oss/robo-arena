import * as THREE from 'three';
import type { SkillDef } from '../data/parts';
import type { Rig } from './rig';
import { PartBuilder, chamferBox, cyl, torus, plate, tube, xf } from './kit';

/** Right shoulder auxiliary emitter. Local +Z is the launch axis; no gameplay geometry. */
export function buildSkill(def: SkillDef, rig: Rig, b: PartBuilder) {
  const m = rig.skillMount;
  m.position.set(-rig.spec.shoulderX * .92, rig.spec.shoulderY + (rig.spec.shoulderX > .4 ? .18 : .14), -.12);
  const add = (mat: Parameters<PartBuilder['add']>[1], geo: THREE.BufferGeometry, pos: [number,number,number] = [0,0,0], rot: [number,number,number] = [0,0,0]) => b.add(m, mat, xf(geo,pos,rot));
  add('dark', chamferBox(.15,.12,.23,.025), [0,-.065,-.04]);
  add('chrome', cyl(.045,.045,.18,12),[0,-.03,-.04],[0,0,Math.PI/2]);
  add('secondary',chamferBox(.13,.11,.23,.025),[0,.02,0]);
  if (def.model === 'lance') {
    add('dark',cyl(.043,.063,.43,12),[0,.025,.24],[Math.PI/2,0,0]);
    for (const x of [-1,1]) {
      add('primary',plate([[-.045,-.1],[.045,-.08],[.035,.31],[.005,.39],[-.025,.31]],.035,.008),[x*.062,.025,.16],[Math.PI/2,0,0]);
      add('chrome',chamferBox(.018,.025,.25,.005),[x*.057,.065,.25]);
    }
    for (const z of [.14,.28,.42]) add('chrome',torus(.049,.008,12,5),[0,.025,z]);
    add('glowHot',cyl(.027,.027,.014,12),[0,.025,.463],[Math.PI/2,0,0]);
    rig.skillMuzzle.position.set(0,.025,.57);
  } else if (def.model === 'wave') {
    for (const side of [-1,1]) {
      add('primary',plate([[0,-.08],[side*.17,-.02],[side*.19,.15],[side*.055,.26],[0,.16]],.035,.009),[0,.025,.08],[Math.PI/2,0,0]);
      add('glowHot',chamferBox(.018,.02,.16,.005),[side*.12,.045,.2],[0,side*.3,0]);
      add('dark',chamferBox(.055,.045,.12,.01),[side*.11,.07,.01]);
    }
    add('chrome',torus(.05,.009,16,5),[0,.025,.25]);
    add('glowHot',cyl(.034,.034,.015,16),[0,.025,.253],[Math.PI/2,0,0]);
    rig.skillMuzzle.position.set(0,.025,.28);
  } else if (def.model === 'hook') {
    add('dark',cyl(.075,.075,.15,16),[0,.025,-.09],[0,0,Math.PI/2]);
    for (const x of [-.085,.085]) add('chrome',cyl(.09,.09,.015,16),[x,.025,-.09],[0,0,Math.PI/2]);
    for (let x=-.055;x<.06;x+=.022) add('dark',torus(.071,.008,16,5),[x,.025,-.09],[0,Math.PI/2,0]);
    add('dark',chamferBox(.08,.075,.32,.015),[0,.025,.17]);
    add('chrome',cyl(.018,.018,.35,10),[0,.035,.22],[Math.PI/2,0,0]);
    for (const side of [-1,1]) add('chrome',plate([[0,.11],[side*.07,.04],[side*.045,.15],[0,.23]],.018,.004),[0,.035,.25],[Math.PI/2,0,0]);
    add('dark',tube([new THREE.Vector3(.08,.02,-.09),new THREE.Vector3(.105,-.03,.04),new THREE.Vector3(.04,.01,.15)],.009,12));
    add('glowHot',chamferBox(.035,.014,.055,.003),[0,.07,.1]);
    rig.skillMuzzle.position.set(0,.035,.5);
  } else {
    for (const x of [-.064,.064]) {
      add('secondary',cyl(.035,.035,.2,12),[x,.025,-.02],[Math.PI/2,0,0]);
      for(const z of [-.08,.05]) add('chrome',torus(.038,.007,12,5),[x,.025,z]);
      add('glowHot',chamferBox(.012,.014,.13,.003),[x,.06,-.02]);
    }
    add('dark',cyl(.057,.067,.2,12),[0,.025,.19],[Math.PI/2,0,0]);
    for (let i=0;i<4;i++) add('chrome',torus(.06-i*.006,.008,12,5),[0,.025,.13+i*.045]);
    add('glowHot',cyl(0,.026,.14,6),[0,.025,.34],[Math.PI/2,0,0]);
    rig.skillMuzzle.position.set(0,.025,.42);
  }
  return m;
}
