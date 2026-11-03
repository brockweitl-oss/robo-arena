import * as THREE from 'three';
import type { Projectile } from '../game/world';
import type { Fighter } from '../game/fighter';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type SkillLook = 'lance' | 'wave' | 'hook' | 'frost';
export const isSkillLook = (look: string): look is SkillLook => ['lance', 'wave', 'hook', 'frost'].includes(look);
const colors = { lance: 0xffc53a, wave: 0x7ab8ff, hook: 0xff7a3a, frost: 0x9ff0ff };
function harpoonGeometry() {
  const pieces = [new THREE.ConeGeometry(.65, 2, 4).rotateX(Math.PI / 2)];
  for (const side of [-1, 1]) pieces.push(new THREE.ConeGeometry(.32, .8, 4).rotateX(-Math.PI / 2).translate(side * .55, 0, -.2));
  const merged = mergeGeometries(pieces); for (const piece of pieces) piece.dispose(); return merged;
}
const material = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
const line = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage));
  const mesh = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: colors.hook, transparent: true, opacity: .8, depthWrite: false, toneMapped: false }));
  mesh.frustumCulled = false; return mesh;
};
function connect(mesh: THREE.Line, a: THREE.Vector3, b: THREE.Vector3) {
  const p = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true;
}

/** Fixed pools: no mesh, material, buffer or geometry creation in live sync. */
export class SkillEffects {
  readonly group = new THREE.Group();
  private geo = {
    lance: new THREE.ConeGeometry(1, 2, 8).rotateX(Math.PI / 2),
    wave: new THREE.PlaneGeometry(2, 2),
    hook: harpoonGeometry(),
    frost: new THREE.OctahedronGeometry(1),
  };
  private mats = { lance: material(colors.lance), hook: material(colors.hook), frost: material(colors.frost), wave: new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec2 vUv;uniform float time;void main(){float x=abs(vUv.x-.5)*2.;float y=abs(vUv.y-.5)*2.;float edge=smoothstep(.75,.98,max(x,y));float band=pow(.5+.5*sin(vUv.y*44.-time*14.+sin(vUv.x*15.)),6.);float fade=1.-smoothstep(.92,1.,max(x,y));gl_FragColor=vec4(vec3(.25,.65,1.3)*( .25+edge+band*.7),fade*(.12+edge*.65+band*.2));}',
  }) };
  private white = material(0xeefaff, .85);
  private frostMat = material(colors.frost, .22);
  private frostGeo = new THREE.IcosahedronGeometry(1, 0);
  private trailGeo = new THREE.ConeGeometry(1, 2, 6).rotateX(-Math.PI / 2);
  private slots: { id: number; owner: number; offset: THREE.Vector3; seen: boolean; root: THREE.Group; core: THREE.Mesh; edge: THREE.Mesh; trail: THREE.Mesh; cable: THREE.Line }[] = [];
  private frost: THREE.Mesh[] = [];
  private anchors = [new THREE.Vector3(), new THREE.Vector3()];
  private chests = [new THREE.Vector3(), new THREE.Vector3()];
  private reels = Array.from({ length: 4 }, () => ({ cable: line(), t: 0, owner: 0, victim: 1, end: new THREE.Vector3() }));
  private look = new THREE.Vector3();
  private time = 0;

  constructor(quality: 'low' | 'medium' | 'high') {
    for (let i = 0; i < (quality === 'low' ? 8 : 16); i++) {
      // Slots start on different skill materials so the match pre-compile covers every one (the
      // ion-wave shader otherwise compiled on its first cast, mid-fight).
      const kind = (['lance', 'hook', 'frost', 'wave'] as const)[i % 4];
      const root = new THREE.Group(), core = new THREE.Mesh(this.geo[kind], this.mats[kind]), edge = new THREE.Mesh(this.geo.lance, this.white), trail = new THREE.Mesh(this.trailGeo, material(0xffffff,.3)), cable = line();
      root.add(core, edge, trail); root.visible = cable.visible = false;
      this.group.add(root, cable); this.slots.push({ id: -1, owner: -1, offset: new THREE.Vector3(), seen: false, root, core, edge, trail, cable });
    }
    for (let id = 0; id < 2; id++) {
      const mesh = new THREE.Mesh(this.frostGeo, this.frostMat); mesh.scale.set(.67, 1.05, .61); mesh.visible = false;
      this.group.add(mesh); this.frost.push(mesh);
    }
    for (const reel of this.reels) { reel.cable.visible = false; this.group.add(reel.cable); }
  }

  /** Optional model anchors are world-space mount positions; physics stays untouched. */
  syncStates(fighters: readonly Fighter[], anchors?: readonly THREE.Vector3[], roots?: readonly THREE.Vector3[], chests?: readonly THREE.Vector3[]) {
    for (const f of fighters) {
      if (f.id < 0 || f.id > 1) continue;
      if (anchors?.[f.id]) this.anchors[f.id].copy(anchors[f.id]); else f.muzzlePoint(this.anchors[f.id]);
      if(chests?.[f.id]) this.chests[f.id].copy(chests[f.id]); else f.chestPoint(this.chests[f.id]);
      const frost = this.frost[f.id]; frost.visible = f.slowT > 0 && f.alive;
      frost.position.copy(roots?.[f.id] ?? f.pos); frost.position.y += .95; frost.rotation.y = f.yaw + Math.sin(this.time * 3) * .03;
    }
  }

  syncProjectiles(projectiles: readonly Projectile[]) {
    for (const slot of this.slots) slot.seen = false;
    for (const p of projectiles) {
      if (!p.alive || !isSkillLook(p.spec.look)) continue;
      let slot = this.slots.find(s => s.id === p.id);
      if (!slot) slot = this.slots.find(s => s.id < 0);
      if (!slot) continue;
      if(slot.id !== p.id || slot.owner !== p.owner) {
        slot.offset.copy(this.anchors[p.owner]).sub(p.pos).addScaledVector(p.vel,p.age);
        slot.owner=p.owner;
      }
      slot.id = p.id; slot.seen = true; slot.root.visible = true;
      const kind = p.spec.look, r = p.spec.radius;
      slot.core.geometry = this.geo[kind]; slot.core.material = this.mats[kind];
      slot.edge.geometry = this.geo[kind]; slot.edge.visible = kind !== 'wave';
      slot.root.position.copy(p.pos).addScaledVector(slot.offset,Math.max(0,1-p.age/.08)); this.look.copy(slot.root.position).add(p.vel); slot.root.lookAt(this.look);
      if (kind === 'wave') slot.core.scale.set(r, r, 1);
      else slot.core.scale.set(kind==='hook'?r/.87:r, kind==='hook'?r/.65:r, kind === 'lance' ? 1.35 : kind === 'hook' ? .65 : r*1.8);
      slot.edge.scale.copy(slot.core.scale).multiplyScalar(.42);
      slot.edge.rotation.z = kind === 'frost' ? this.time * 2 : Math.PI / 4;
      slot.trail.visible = kind !== 'wave';
      const trailLength=Math.min(2,p.vel.length()*.025);
      slot.trail.position.z=-trailLength;
      slot.trail.scale.set(r*.8,r*.8,trailLength);
      (slot.trail.material as THREE.MeshBasicMaterial).color.setHex(colors[kind]);
      slot.cable.visible = kind === 'hook';
      if (slot.cable.visible) connect(slot.cable, this.anchors[p.owner], slot.root.position);
    }
    for (const slot of this.slots) if (!slot.seen) { slot.id = -1; slot.root.visible = slot.cable.visible = false; }
  }

  impact(look: string, attacker: number, victim: number, pos: THREE.Vector3, denied = false) {
    if (denied || look !== 'hook' || attacker < 0 || attacker > 1 || victim < 0 || victim > 1) return;
    const reel = this.reels.find(r => r.t <= 0) ?? this.reels[0];
    reel.owner = attacker; reel.victim = victim; reel.end.copy(pos); reel.t = .28; reel.cable.visible = true;
    connect(reel.cable, this.anchors[attacker], pos);
  }

  update(dt: number) {
    this.time += dt; this.mats.wave.uniforms.time.value = this.time;
    this.frostMat.opacity = .16 + Math.sin(this.time * 8) * .035;
    for (const reel of this.reels) if (reel.t > 0) {
      reel.t = Math.max(0, reel.t - dt); reel.cable.visible = reel.t > 0;
      connect(reel.cable, this.anchors[reel.owner], this.chests[reel.victim]);
      (reel.cable.material as THREE.LineBasicMaterial).opacity = Math.min(1, reel.t / .1);
    }
  }
  clear() {
    for (const s of this.slots) { s.id = -1; s.root.visible = s.cable.visible = false; }
    for (const m of this.frost) m.visible = false;
    for (const r of this.reels) { r.t = 0; r.cable.visible = false; }
  }
  dispose() {
    this.group.removeFromParent(); Object.values(this.geo).forEach(g => g.dispose()); Object.values(this.mats).forEach(m => m.dispose());
    this.white.dispose(); this.frostGeo.dispose(); this.frostMat.dispose();
    this.trailGeo.dispose();for(const slot of this.slots)(slot.trail.material as THREE.Material).dispose();
    for (const cable of [...this.slots.map(s => s.cable), ...this.reels.map(r => r.cable)]) { cable.geometry.dispose(); (cable.material as THREE.Material).dispose(); }
  }
}
