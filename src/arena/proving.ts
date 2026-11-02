import * as THREE from 'three';
import { FieldKit } from './fieldKit';
import { rockGeo } from './garden/geo';
import type { ArenaFactory } from './types';
/** Symmetric desert test range: two fortified berms with broad access ramps. */
export const createProving: ArenaFactory = ({renderer,quality}) => {
  const k=new FieldKit(renderer,quality,0xb4a18c,0xffe0ae,0xe6c293);k.root.name='arena-proving';k.key.intensity=3.3;
  const sand=k.material(0xb69d7b,0,.96),earth=k.material(0x86725d,.05,.92),concrete=k.material(0xaaa393,.1,.8),trim=k.material(0xd7c68b,.1,.7),dark=k.material(0x3e4b50,.55,.6),orange=k.material(0xaf5a32,.3,.6);
  sand.map=k.surfaceTexture('#b39a79','#9d866b','sand');concrete.map=k.surfaceTexture('#9d9686','#777264','concrete');
  k.layout(sand,earth,concrete,trim,10); k.markings(orange);
  for(const side of [-1,1]) {
    // Layered retaining walls and recessed ventilation grilles preserve the same solid berm volume.
    for(let y=.35;y<3;y+=.55) k.box(side*12,y,-5.015,6,.08,.03,dark);
    for(let z=-4;z<=4;z+=1.4)for(let y=.4;y<2.8;y+=.5)k.box(side*15.02,y,z,.035,.11,.8,concrete);
    for(const z of [-7,7])for(let i=-1;i<=1;i++){k.box(side*5+i,1.4,z+1.02,.55,.24,.035,dark);k.box(side*5+i,1.38,z+1.05,.45,.055,.02,trim);}
    for(let i=0;i<10;i++) { const g=rockGeo(21+i,1,.35);g.scale(2+(i%3),2+(i%4),3);k.add(g,earth,side*(24+(i%2)*5),1.2,(i-4.5)*6); }
  }
  // Revetment faces distinguish the upper berms from the sand floor.
  for(const side of [-1,1]){
    for(let z=-4;z<=4;z+=1.25){k.box(side*8.98,1.5,z,.12,3,.16,dark);k.box(side*15.02,1.5,z,.12,3,.16,dark);}
    for(const z of [-7,7]){k.box(side*5,1,z,3.02,.18,2.02,orange);for(let i=-1;i<=1;i++)k.box(side*5+i,1.65,z+1.015,.11,.55,.025,dark);}
    for(let x=-20;x<=20;x+=8){k.box(x,3.5,side*23,1,7,1,dark);k.box(x,6.8,side*23,2.7,.45,.7,trim);}
    const sign=k.sign('PROVING  //  RANGE 03','#e8c78a',11,2.2);sign.position.set(0,5,side*23);sign.rotation.y=side>0?Math.PI:0;k.root.add(sign);
    for(let i=0;i<9;i++){const x=(i-4)*11,z=side*(35+(i%3)*6);const g=new THREE.ConeGeometry(7+(i%3)*3,7+(i%4)*3,5);g.scale(1,.5,1.5);k.add(g,earth,x,1,z,0,i*.7,0);}
    // Antenna and range marker furniture remain outside the playable boundary.
    k.box(side*23,5,5,.4,10,.4,dark);k.add(new THREE.TorusGeometry(1.6,.07,6,24),trim,side*23,8.5,5,Math.PI/3,0,0);
    for(let z=-14;z<=14;z+=7){k.box(side*17.6,.055,z,.7,.11,1.6,orange);}
  }
  k.weather('dust',0xd9c5a6);
  return k.finish({id:'proving',name:'Proving Grounds',subtitle:'Desert combat range',blurb:'Fortified berms, open firing lanes and equal cover. Dust is cosmetic; the rules stay fixed.',music:'foundry',accent:'#d5af6c'});
};
