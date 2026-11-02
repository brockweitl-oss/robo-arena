import * as THREE from 'three';
import { FieldKit } from './fieldKit';
import type { ArenaFactory } from './types';
/** Flooded civic plaza; shallow water is cosmetic and never changes traction or aim. */
export const createSunken: ArenaFactory = ({renderer,quality}) => {
  const k=new FieldKit(renderer,quality,0x344c54,0xc2d6ce,0x86b5aa);k.root.name='arena-sunken';
  const stone=k.material(0x667573,.15,.72),floor=k.material(0x3a5256,.45,.38),cover=k.material(0x7e8b88,.1,.75),trim=k.material(0x8db4ab,.25,.5),dark=k.material(0x263b40,.4,.7),glass=k.material(0x2a6168,.75,.2),moss=k.material(0x3e6150,0,.95);
  floor.map=k.surfaceTexture('#456165','#253e43','concrete');stone.map=k.surfaceTexture('#77817b','#505f59','concrete');k.layout(floor,stone,cover,trim,16);
  for(const side of [-1,1]) {
    for(const z of [-7,7]) { for(let y=.3;y<1.9;y+=.4)k.box(side*5,y,z+1.012,3,.045,.025,dark);for(let x=-1;x<=1;x++)k.box(side*5+x,1,z+1.025,.04,1.8,.02,stone); }
    for(let z=-7;z<=7;z+=2) {k.box(side*12,2.8,z,6.02,.12,.08,dark);k.box(side*15.03,1.5,z,.06,2.5,.24,moss);}
    for(const z of [-11,11]) {k.box(side*11,1.36,z,5,.08,1.7,trim,true);k.box(side*11,.15,z,5.1,.3,1.7,stone,true);}
    for(let i=0;i<10;i++){const x=side*(19.2+i%3),z=(i-4.5)*3.7;const bush=new THREE.IcosahedronGeometry(.8,0);bush.scale(1,1.8,1);k.add(bush,moss,x,1.4,z);}
    for(let i=0;i<16;i++){const z=(i-7.5)*2.4;k.box(side*20,2.1,z,.4,.3,.7,stone);}
  }
  const water=new THREE.MeshPhysicalMaterial({color:0x315e67,roughness:.13,metalness:.65,transparent:true,opacity:.44,clearcoat:1,envMap:k.environment,envMapIntensity:1});k.materials.push(water);
  // Fine tangent-space ripples animate visually; no movement randomness or collision mismatch.
  const pixels=new Uint8Array(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4;pixels[i]=128+Math.round(18*Math.sin(x*.6+y*.2));pixels[i+1]=128+Math.round(12*Math.cos(y*.5-x*.3));pixels[i+2]=253;pixels[i+3]=255;}
  const normal=new THREE.DataTexture(pixels,64,64);normal.wrapS=normal.wrapT=THREE.RepeatWrapping;normal.repeat.set(10,10);normal.needsUpdate=true;k.textures.push(normal);water.normalMap=normal;water.normalScale.set(.2,.2);
  const surface=new THREE.Mesh(new THREE.PlaneGeometry(36,36),water);surface.rotation.x=-Math.PI/2;surface.position.y=.025;k.root.add(surface);k.animations.push(t=>{normal.offset.set(t*.007,t*.004);});
  for(const side of [-1,1]){
    // Toppled columns are actual rectangular cover, with identical visible and solid extents.
    for(const z of [-11,11]){k.box(side*11,.65,z,5,1.3,1.5,stone,true);for(let i=-2;i<=2;i++)k.box(side*11+i,.67,z+.76,.07,1.1,.025,dark);}
    for(let i=0;i<6;i++){const x=(i-2.5)*10,z=side*(26+(i%2)*7),height=12+(i%3)*7;
      k.box(x,height/2,z,6,height,5,dark);k.box(x+.3,height/2,z,5.5,height-.3,5.1,stone);
      for(let y=2;y<height-1;y+=2.5)for(let wx=-1.7;wx<=1.7;wx+=1.7)k.box(x+wx,y,z-side*2.58,1,1.6,.05,glass);
      k.box(x-2.8,height/2,z-side*2.62,.22,height,.06,moss);
    }
    const sign=k.sign('CIVIC  //  FLOODLINE','#a9d5c5',10,1.8);sign.position.set(0,5,side*21);sign.rotation.y=side>0?Math.PI:0;k.root.add(sign);
    for(let x=-16;x<=16;x+=8){k.box(x,2.8,side*19.6,.18,5.6,.18,dark);k.box(x+.4,5.5,side*19.6,1,.12,.4,trim);}
    for(const z of [-7,7]){k.box(side*5,2.03,z,3,.06,2,moss);}
  }
  return k.finish({id:'sunken',name:'Sunken District',subtitle:'Flooded civic plaza',blurb:'Shallow water, raised ruins and toppled towers. Symmetric routes reward deliberate positioning.',music:'garden',accent:'#85b7ac'});
};
