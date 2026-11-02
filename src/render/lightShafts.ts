import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Soft visible shafts from exterior lamps; no extra lights or shadow maps. */
export function lightShafts(color: number, positions: [number, number, number][], height = 18) {
  const parts = positions.map(([x, y, z]) => new THREE.CylinderGeometry(0.18, 3.8, height, 16, 1, true).translate(x, y - height / 2, z));
  const geometry = mergeGeometries(parts)!;
  parts.forEach(g => g.dispose());
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { tint: { value: new THREE.Color(color) } },
    vertexShader: `varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
      void main(){vUv=uv;vec4 p=modelViewMatrix*vec4(position,1.);vNormal=normalMatrix*normal;vView=-p.xyz;gl_Position=projectionMatrix*p;}`,
    fragmentShader: `uniform vec3 tint;varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
      void main(){float side=pow(abs(dot(normalize(vNormal),normalize(vView))),1.7);
      float fade=smoothstep(0.,.25,vUv.y)*(1.-smoothstep(.75,1.,vUv.y));
      gl_FragColor=vec4(tint*side*fade*.055,1.);}`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'atmospheric-light-shafts';
  return mesh;
}
