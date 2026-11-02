import * as THREE from 'three';
import { Pass } from 'postprocessing';

/** Reconstruct view normals from scene depth, without drawing every mech a second time. */
export class DepthNormalsPass extends Pass {
  private target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  private material: THREE.ShaderMaterial;
  constructor(camera: THREE.PerspectiveCamera) {
    super('DepthNormals');
    this.needsSwap = false;
    this.needsDepthTexture = true;
    this.material = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { depthMap: { value: null }, inverseProjection: { value: camera.projectionMatrixInverse }, texel: { value: new THREE.Vector2() } },
      vertexShader: `varying vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: `uniform sampler2D depthMap;uniform mat4 inverseProjection;uniform vec2 texel;varying vec2 vUv;
        vec3 unproject(vec2 uv){float d=texture2D(depthMap,uv).r;vec4 p=inverseProjection*vec4(uv*2.-1.,d*2.-1.,1.);return p.xyz/p.w;}
        void main(){
          vec3 c=unproject(vUv),l=unproject(vUv-vec2(texel.x,0.)),r=unproject(vUv+vec2(texel.x,0.));
          vec3 b=unproject(vUv-vec2(0.,texel.y)),t=unproject(vUv+vec2(0.,texel.y));
          vec3 dx=abs(c.z-l.z)<abs(r.z-c.z)?c-l:r-c;
          vec3 dy=abs(c.z-b.z)<abs(t.z-c.z)?c-b:t-c;
          vec3 n=normalize(cross(dx,dy));gl_FragColor=vec4(n*.5+.5,1.);
        }`,
    });
    this.fullscreenMaterial = this.material;
  }
  get texture() { return this.target.texture; }
  setDepthTexture(texture: THREE.Texture) { this.material.uniforms.depthMap.value = texture; }
  setSize(width: number, height: number) {
    this.target.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2)));
    this.material.uniforms.texel.value.set(1 / width, 1 / height);
  }
  render(renderer: THREE.WebGLRenderer) {
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
  }
  dispose() { this.target.dispose(); this.material.dispose(); }
}
