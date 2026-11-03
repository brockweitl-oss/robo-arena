import * as THREE from 'three';

/** Bounded panel debris for crates and shattered guards: one instanced draw. */
export class PanelDebris {
  readonly mesh: THREE.InstancedMesh;
  private cursor = 0;
  private matrix = new THREE.Matrix4();
  private quaternion = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private slots = Array.from({ length: 64 }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), rotation: new THREE.Euler(), age: 99, life: 1, size: 1, floor: 0 }));
  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.08), new THREE.MeshStandardMaterial({ metalness: 0.65, roughness: 0.4 }), 64);
    this.mesh.frustumCulled = false;
    // Allocate per-instance colour now: created lazily on the first burst it switched the shader
    // variant mid-fight (≈200 ms stall on the first guard break).
    const white = new THREE.Color(0xffffff);
    for (let i = 0; i < 64; i++) this.mesh.setColorAt(i, white);
    this.mesh.count = 0;
  }
  burst(pos: THREE.Vector3, color: number, count = 12, size = 0.35) {
    for (let i = 0; i < count; i++) {
      const index = this.cursor++ % this.slots.length;
      const s = this.slots[index], a = i * 2.39996;
      s.p.copy(pos); s.v.set(Math.cos(a) * (2 + Math.random() * 3), 3 + Math.random() * 4, Math.sin(a) * (2 + Math.random() * 3));
      s.rotation.set(a, a * 2, a * 0.5); s.age = 0; s.life = 0.7 + Math.random() * 0.5; s.size = size * (0.5 + Math.random()); s.floor = pos.y - 0.8;
      this.mesh.setColorAt(index, new THREE.Color(color));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt: number) {
    let visible = false;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]; s.age += dt;
      const alive = s.age < s.life;
      if (alive) {
        visible = true; s.v.y -= dt * 13; s.p.addScaledVector(s.v, dt); s.rotation.x += dt * 5; s.rotation.y += dt * 3;
        if (s.p.y < s.floor) { s.p.y = s.floor; s.v.y = Math.abs(s.v.y) * 0.25; }
      }
      this.scale.setScalar(alive ? s.size * Math.min(1, (s.life - s.age) * 5) : 0);
      this.matrix.compose(s.p, this.quaternion.setFromEuler(s.rotation), this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.count = visible ? this.slots.length : 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { for (const s of this.slots) s.age = 99; this.mesh.count = 0; }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.dispose(); }
}

export function landingMaterial(enemy: boolean) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { progress: { value: 0 }, tint: { value: new THREE.Color(enemy ? 0xff6550 : 0x55cce9) } },
    vertexShader: `varying vec2 vP;void main(){vP=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vP;uniform float progress;uniform vec3 tint;
      void main(){float r=length(vP);float a=(atan(vP.y,vP.x)+3.141593)/6.283185;
      float edge=1.-smoothstep(.012,.025,abs(r-.96));
      float tick=(1.-smoothstep(.012,.02,abs(fract(a*12.)-.5)))*step(.86,r)*step(r,.98);
      float sweep=step(a,progress)*(1.-smoothstep(.012,.023,abs(r-.88)));
      float center=(1.-smoothstep(.015,.028,min(abs(vP.x),abs(vP.y))))*step(r,.12);
      float alpha=max(max(edge*.45,tick*.65),max(sweep*.65,center*.6));
      gl_FragColor=vec4(tint*(1.+progress*.35),alpha);}`,
  });
}
