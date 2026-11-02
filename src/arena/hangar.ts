import * as THREE from 'three';
import { FieldKit, V } from './fieldKit';
import type { ArenaFactory } from './types';

/** Night maintenance hangar: two service decks, clear center lane and sheltered cover. */
export const createHangar: ArenaFactory = ({renderer,quality}) => {
  const k=new FieldKit(renderer,quality,0x08131f,0xa9c9e8,0x5c90bd);k.root.name='arena-hangar';k.key.intensity=3.2;k.key.position.set(3,14,6);k.root.add(new THREE.AmbientLight(0xb5d5e7,.65));
  const steel=k.material(0x506373,.55,.43),floor=k.material(0x617782,.45,.25),cover=k.material(0x476171,.7,.37),dark=k.material(0x111d2b,.7,.55);
  const cyan=k.material(0x6dbbca,.2,.4,0x2c8ba5),amber=k.material(0xca8740,.2,.45,0x9e4d14);
  floor.map=k.surfaceTexture('#344754','#13212b','deck');
  k.layout(floor,steel,cover,cyan,14); k.markings(amber);
  for(const side of [-1,1]) {
    for(let z=-6;z<=6;z+=2) {k.box(side*12,1.5,z,6.02,.07,.09,dark);k.box(side*9.01,1.5,z,.035,2.4,.13,cyan);}
    for(const z of [-7,7]) {k.box(side*5,1,z,3.02,.16,2.02,dark);for(let i=-1;i<=1;i++)k.box(side*5+i,1.72,z+1.015,.35,.14,.025,amber);}
    for(let z=-12;z<=12;z+=12){k.add(new THREE.TorusGeometry(2.1,.16,8,24),steel,side*20.3,10,z,0,Math.PI/2);for(let a=0;a<8;a++) {const vane=new THREE.BoxGeometry(.12,3.6,.3);k.add(vane,dark,side*20.2,10,z,a*Math.PI/4,0,0);}}
  }
  // Every playable cover block comes from FieldKit's collider dimensions; gantry is overhead scenery.
  for(const side of [-1,1]) {
    for(let z=-16;z<=16;z+=8){k.box(side*19.8,8,z,1.1,16,1.1,steel);k.box(0,15.6,z,41,.7,.7,steel);k.box(side*19.15,7,z,.06,6,.3,cyan);}
    k.box(side*21,7,0,.8,14,40,dark);
    for(let z=-15;z<=15;z+=5){k.box(side*20.5,5,z,.15,6,3.6,cover);k.box(side*20.35,8.2,z,.18,.12,3.6,amber);}
    const sign=k.sign('DOCK  //  07','#98d8ed',9,2.1);sign.position.set(0,9,side*20.55);sign.rotation.y=side>0?Math.PI:0;k.root.add(sign);
    k.box(0,18.5,side*21,42,3,.8,steel);
    for(const x of [-12,-4,4,12]){k.box(x,3,side*20.6,5,6,.3,dark);k.box(x,5.8,side*20.4,4.2,.12,.08,cyan);}
  }
  const gantry=new THREE.Group();const beam=new THREE.Mesh(new THREE.BoxGeometry(37,.8,1.6),cover);gantry.add(beam);
  const trolley=new THREE.Mesh(new THREE.BoxGeometry(3,1.2,2.2),steel);trolley.position.y=-.8;gantry.add(trolley);
  const cable=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,4,6),dark);cable.position.y=-3.2;gantry.add(cable);
  const hook=new THREE.Mesh(new THREE.TorusGeometry(.35,.085,6,12,Math.PI*1.4),amber);hook.position.y=-5.25;gantry.add(hook);
  gantry.position.y=17;k.root.add(gantry);k.animations.push(t=>{gantry.position.z=Math.sin(t*.075)*11;trolley.position.x=cable.position.x=hook.position.x=Math.sin(t*.11)*8;});
  const puddle=new THREE.MeshPhysicalMaterial({color:0x3b6b85,metalness:.9,roughness:.055,transparent:true,opacity:.65,clearcoat:1,envMap:k.environment,envMapIntensity:1.3});k.materials.push(puddle);
  for(const x of [-8,8])for(const z of [-11,11]){const m=new THREE.Mesh(new THREE.CircleGeometry(2.1,32),puddle);m.rotation.x=-Math.PI/2;m.scale.y=.55;m.position.set(x,.018,z);k.root.add(m);}
  k.weather('rain',0xaad7f5);
  return k.finish({id:'hangar',name:'Rain Hangar',subtitle:'Night maintenance sector',blurb:'Rain-washed service decks and mirrored cover. A gantry moves safely overhead.',music:'foundry',accent:'#77cde2'});
};
