import * as THREE from 'three';
import { Buckets, mat4 } from './garden/geo';
import { studioEnvironment, rng } from '../render/textures';
import type { ArenaBuild, ArenaInfo, Collider } from './types';

export const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);

/** Shared construction rules: every playable solid is built from its collider dimensions. */
export class FieldKit {
  readonly root = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly textures: THREE.Texture[] = [];
  readonly materials: THREE.Material[] = [];
  readonly bucket = new Buckets(this.root);
  readonly animations: ((time:number,dt:number)=>void)[] = [];
  readonly key: THREE.DirectionalLight;
  readonly environment: THREE.Texture;
  readonly low: boolean;
  constructor(readonly renderer: THREE.WebGLRenderer, quality: string, readonly sky: number, sun: number, accent: number) {
    this.low=quality==='low';
    this.key=new THREE.DirectionalLight(sun,2.8);this.key.position.set(12,26,14);this.key.castShadow=!this.low;
    Object.assign(this.key.shadow.camera,{left:-27,right:27,top:27,bottom:-27,near:1,far:80});
    this.key.shadow.camera.updateProjectionMatrix();
    this.key.shadow.mapSize.set(2048,2048);this.key.shadow.normalBias=.025;this.key.shadow.bias=-.0001;
    this.root.add(this.key,new THREE.HemisphereLight(accent,0x18202a,.85));
    this.environment=studioEnvironment(renderer,{top:sky,bottom:0x171b23,key:sun,rim:accent,fill:accent,intensity:.65});
  }
  material(color:number,metalness=.3,roughness=.65,emissive?:number) {
    const m=new THREE.MeshStandardMaterial({color,metalness,roughness,emissive:emissive??0,emissiveIntensity:emissive?2:0});
    this.materials.push(m);this.bucket.register(m,.22,!emissive,true);return m;
  }
  add(g:THREE.BufferGeometry,m:THREE.Material,x=0,y=0,z=0,rx=0,ry=0,rz=0) {this.bucket.add(m,g,mat4(x,y,z,rx,ry,rz));}
  box(x:number,y:number,z:number,w:number,h:number,d:number,m:THREE.Material,solid=false) {
    this.add(new THREE.BoxGeometry(w,h,d),m,x,y,z);
    if(solid)this.colliders.push({kind:'box',min:V(x-w/2,y-h/2,z-d/2),max:V(x+w/2,y+h/2,z+d/2)});
  }
  ramp(x0:number,x1:number,z:number,width:number,height:number,dir:1|-1,m:THREE.Material) {
    const shape=new THREE.Shape();const len=x1-x0;
    shape.moveTo(0,0);shape.lineTo(len,0);shape.lineTo(len,dir===1?height:0);shape.lineTo(0,dir===1?0:height);shape.closePath();
    const g=new THREE.ExtrudeGeometry(shape,{depth:width,bevelEnabled:false});g.translate(x0,0,z-width/2);this.add(g,m);
    this.colliders.push({kind:'ramp',min:V(x0,0,z-width/2),max:V(x1,height,z+width/2),axis:'x',dir});
  }
  surfaceTexture(base:string,lines:string,style:'deck'|'sand'|'concrete') {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d')!;const random=rng(43);
    c.fillStyle=base;c.fillRect(0,0,512,512);
    for(let i=0;i<12000;i++){c.fillStyle=`rgba(${random()>.5?'255,255,255':'0,0,0'},${random()*.055})`;c.fillRect(random()*512,random()*512,2,2);}
    c.strokeStyle=lines;c.lineWidth=style==='sand'?1:3;
    if(style==='sand'){for(let y=0;y<512;y+=9){c.beginPath();for(let x=0;x<=512;x+=8){const yy=y+Math.sin(x/65+y)*3;x?c.lineTo(x,yy):c.moveTo(x,yy);}c.stroke();}}
    else for(let i=0;i<=512;i+=128){c.beginPath();c.moveTo(i,0);c.lineTo(i,512);c.moveTo(0,i);c.lineTo(512,i);c.stroke();if(style==='deck'){c.fillStyle='#151c25';for(let j=12;j<512;j+=128)c.fillRect(i+10,j,4,4);}}
    const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;this.textures.push(t);return t;
  }
  sign(text:string,color:string,width=6,height=1.3) {
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const c=canvas.getContext('2d')!;
    c.fillStyle='#0d1723';c.fillRect(0,0,1024,256);c.strokeStyle=color;c.lineWidth=8;c.strokeRect(8,8,1008,240);c.fillStyle=color;c.font='700 96px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(text,512,125,950);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;this.textures.push(map);
    const material=new THREE.MeshBasicMaterial({map});this.materials.push(material);
    return new THREE.Mesh(new THREE.PlaneGeometry(width,height),material);
  }
  /** Surface markings are flush visual overlays; they never introduce invisible cover. */
  markings(m:THREE.Material) {
    for(const side of [-1,1]) {
      for(let z=-15;z<=15;z+=2) this.box(side*2.8,.035,z,.08,.02,1.05,m);
      for(const z of [-13,13]) {this.box(0,.04,z,4,.025,.12,m);this.box(-2,.04,z-.6,.12,.025,1.2,m);this.box(2,.04,z-.6,.12,.025,1.2,m);}
      for(const z of [-7,7])for(let i=0;i<6;i++)this.box(side*5-1.35+i*.5,.03,z+side*1.4,.24,.025,.5,m);
    }
  }
  layout(floor:THREE.Material,platform:THREE.Material,cover:THREE.Material,trim:THREE.Material,span=12) {
    this.box(0,-.5,0,38,1,38,floor,true);
    for(const sx of [-1,1]){
      this.box(sx*18.5,1,0,1,2,38,platform,true);this.box(0,1,sx*18.5,36,2,1,platform,true);
      this.box(sx*12,1.5,0,6,3,span,platform,true);this.ramp(sx===1?5:-9,sx===1?9:-5,0,4,3,sx as 1|-1,platform);
      for(const edge of [-1,1]) this.box(sx*12+edge*2.9,3.015,0,.08,.03,span-.1,trim);
      for(const sz of [-1,1]){
        this.box(sx*5,1.0,sz*7,3,2,2,cover,true);
        this.box(sx*5,2.015,sz*7,2.9,.03,1.9,trim);
        for(let i=0;i<3;i++)this.box(sx*5-1+i,1,sz*8.008,.055,1.6,.018,trim);
      }
      for(let z=-15;z<=15;z+=3)this.box(sx*17.9,.015,z,.12,.03,1.2,trim);
    }
  }
  weather(kind:'rain'|'dust',color:number) {
    const count=this.low?0:kind==='rain'?1200:180;if(!count)return;
    const random=rng(82);const positions=new Float32Array(count*3);
    for(let i=0;i<count;i++)positions.set([(random()-.5)*42,random()*22,(random()-.5)*42],i*3);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));
    const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{time:{value:0},color:{value:new THREE.Color(color)},rain:{value:kind==='rain'?1:0}},
      vertexShader:`uniform float time,rain;varying float fade;void main(){vec3 p=position;if(rain>.5){p.y=mod(p.y-time*15.,22.);p.x+=sin(time*.2)*p.y*.08;}else{p.x=mod(p.x+time*2.+21.,42.)-21.;p.y=mod(p.y,5.)+.2;}vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;gl_PointSize=rain>.5?2.:clamp(70./-v.z,2.,14.);fade=rain>.5?.3:.09;}`,
      fragmentShader:`uniform vec3 color;uniform float rain;varying float fade;void main(){float d=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(color,fade*(1.-smoothstep(.1,1.,d)));}`});
    const points=new THREE.Points(g,m);points.frustumCulled=false;this.root.add(points);this.materials.push(m);this.animations.push(t=>m.uniforms.time.value=t);
  }
  finish(info:ArenaInfo):ArenaBuild {
    this.bucket.build();
    return {info,root:this.root,colliders:this.colliders,hazards:[],spawns:[V(0,0,13),V(0,0,-13)],halfX:17.5,halfZ:17.5,background:new THREE.Color(this.sky),environment:this.environment,fog:new THREE.FogExp2(this.sky,.012),keyLight:this.key,tick(){},update:(t,dt)=>this.animations.forEach(f=>f(t,dt)),dispose:()=>{
      const geos=new Set<THREE.BufferGeometry>();this.root.traverse(o=>{const m=o as THREE.Mesh;if(m.geometry)geos.add(m.geometry);});geos.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.textures.forEach(t=>t.dispose());this.key.shadow.map?.dispose();this.root.clear();
    }};
  }
}
