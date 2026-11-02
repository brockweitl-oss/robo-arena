import * as THREE from 'three';
import { FieldKit } from './fieldKit';
import { rockGeo } from './garden/geo';
import type { ArenaFactory } from './types';

/** Fixed combat layout; all additional detailing is flush surface treatment or outside the boundary. */
export const createProving: ArenaFactory = ({renderer,quality}) => {
  const k=new FieldKit(renderer,quality,0xa6b4b8,0xffe3ba,0x90aabd);
  k.root.name='arena-proving';k.key.intensity=3.1;
  const sand=k.material(0xd2b88e,0,.98),earth=k.material(0x657273,.08,.9),concrete=k.material(0xb7bcb4,.05,.88);
  const trim=k.material(0xd4cec0,.12,.8),dark=k.material(0x283d46,.45,.72),rock=k.material(0x9b8164,0,.98);
  sand.map=k.surfaceTexture('#c9b18a','#b59b76','sand');
  concrete.map=k.surfaceTexture('#c1c4b8','#a1aaa4','concrete');
  // This is the entire playable collision layout. Keep its call and dimensions stable.
  k.layout(sand,earth,concrete,trim,10);
  // Flush markings use a separate non-shadow-casting bucket, never physical cover.
  const paint=k.material(0xc39b58,0,1);k.bucket.register(paint,null,false,true);
  for(const side of [-1,1]) {
    // Large recessed-looking steel/concrete bays replace hairline grille noise.
    for(const zFace of [-5,5]) {
      for(let i=0;i<3;i++) {
        const x=side*12+(i-1)*1.94;
        k.box(x,1.52,zFace,1.80,2.58,.008,concrete);
        k.box(x,2.58,zFace+(zFace>0?.006:-.006),1.55,.11,.006,dark);
        k.box(x,1.32,zFace+(zFace>0?.008:-.008),1.45,.025,.006,earth);
        for(const dx of [-.69,.69]) k.box(x+dx,.43,zFace+(zFace>0?.01:-.01),.12,.15,.006,trim);
      }
    }
    // Vertical faces and deck caps stay within the original rectangular berm silhouette.
    for(const edge of [-1,1])for(let z=-3.75;z<=3.75;z+=2.5) {
      k.box(side*12+edge*2.999,1.5,z,.008,2.62,2.34,concrete);
      k.box(side*12+edge*3.005,2.62,z,.006,.10,2.12,dark);
    }
    k.box(side*12,3.018,0,5.78,.012,9.75,dark);
    for(const z of [-4.65,4.65])k.box(side*12,3.027,z,5.65,.008,.11,paint);
    // Wear follows the actual 3:4 ramp slope; no rails or false walkable additions.
    for(let x=5.3;x<8.9;x+=.48) {
      const strip=new THREE.PlaneGeometry(.12,3.65).rotateX(-Math.PI/2);
      k.add(strip,paint,side*x,(x-5)*.75+.016,0,0,0,side*Math.atan(.75));
    }
    for(const z of [-7,7]) {
      k.box(side*5,1.02,z+1.005,2.72,.38,.008,dark);
      k.box(side*5,1.02,z-1.005,2.72,.38,.008,dark);
      for(const face of [-1,1])for(const dx of [-1.1,1.1])k.box(side*5+dx,1.03,z+face*1.011,.14,.22,.004,paint);
    }
    // A few broad, faded range boundaries make the firing lanes legible.
    for(const z of [-13,13]){
      k.box(side*4,.016,z,3.1,.008,.13,paint);
      k.box(side*5.5,.016,z-side*.7,.13,.008,1.5,paint);
    }
    for(let i=0;i<10;i++) {const g=rockGeo(21+i,1,.35);g.scale(2+(i%3),2+(i%4),3);k.add(g,rock,side*(24+(i%2)*5),1.2,(i-4.5)*6);}
  }
  // One coherent range gantry per end, entirely beyond the playable boundary.
  for(const side of [-1,1]) {
    const z=side*23;
    for(const x of [-17,-8,8,17]) {
      k.box(x,3.7,z,.7,7.4,.8,dark);
      k.box(x,1.1,z,.95,2.2,1.05,concrete);
      k.box(x,7.2,z,1.25,.28,1.15,trim);
    }
    k.box(0,6.75,z,35,.42,.58,dark);
    k.box(0,7.35,z,35,.18,.35,trim);
    for(const x of [-12.5,12.5]) {
      const brace=new THREE.BoxGeometry(8.9,.22,.3);
      k.add(brace,dark,x,5,z,0,0,(x<0?1:-1)*.36);
    }
    const sign=k.sign('PROVING  //  RANGE 03','#d1b779',12,1.55);sign.position.set(0,5.9,z-side*.46);sign.rotation.y=side>0?Math.PI:0;k.root.add(sign);
    for(let i=0;i<9;i++){const x=(i-4)*11,back=side*(35+(i%3)*6);const g=new THREE.ConeGeometry(7+(i%3)*3,7+(i%4)*3,5);g.scale(1,.5,1.5);k.add(g,rock,x,1,back,0,i*.7,0);}
    k.box(side*23,5,5,.32,10,.32,dark);k.add(new THREE.TorusGeometry(1.6,.07,6,24),trim,side*23,8.5,5,Math.PI/3,0,0);
  }
  k.weather('dust',0xd9c5a6);
  return k.finish({id:'proving',name:'Proving Grounds',subtitle:'Desert combat range',blurb:'Fortified berms, open firing lanes and equal cover. Dust is cosmetic; the rules stay fixed.',music:'foundry',accent:'#d5af6c'});
};
