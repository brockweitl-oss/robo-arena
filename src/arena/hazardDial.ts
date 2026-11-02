import * as THREE from 'three';
/** Constant boundary and filling countdown share the simulation's exact hazard phase. */
export class HazardDial {
  private mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  constructor(root:THREE.Object3D,pos:THREE.Vector3,radius:number,private progress:(time:number)=>number) {
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
      uniforms:{progress:{value:0}},
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`varying vec2 vUv;uniform float progress;void main(){vec2 p=(vUv-.5)*2.;float r=length(p);float ring=smoothstep(.94,.965,r)*(1.-smoothstep(.985,1.,r));float a=fract(atan(p.x,p.y)/6.2831853+1.);float filled=step(a,progress);float ticks=step(.72,fract(a*16.))*smoothstep(.84,.86,r)*(1.-smoothstep(.9,.92,r));vec3 c=mix(vec3(.95,.56,.14),vec3(1.,.12,.04),step(.999,progress));float alpha=ring*(.18+filled*.7)+ticks*(.12+progress*.5);gl_FragColor=vec4(c,alpha);}`});
    this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(radius*2,radius*2),material);this.mesh.rotation.x=-Math.PI/2;this.mesh.position.copy(pos).y+=.045;root.add(this.mesh);
  }
  update(time:number){this.mesh.material.uniforms.progress.value=this.progress(time);}
  dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
