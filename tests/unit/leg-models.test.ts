import {FRAME_PROPS} from '../../src/robot/frames';
import {expect,it} from 'vitest';
import * as THREE from 'three';
import {buildLegs,legLengths} from '../../src/robot/legs';
import {Rig} from '../../src/robot/rig';
import {rigSpecFor} from '../../src/robot/model';
import {PartBuilder,type MatSet} from '../../src/robot/kit';
import {DEFAULT_LOADOUT,resolveLoadout} from '../../src/data/parts';
for(const body of ['striker','wisp','regent','ironclad']) for(const legs of ['stride','hopper','sprint','anchor','feather']) {
 it(`${body}/${legs} preserves finite leg geometry and rig mounting`,()=>{
  const lo=resolveLoadout({...DEFAULT_LOADOUT,body,legs}), rig=new Rig(rigSpecFor(lo)), b=new PartBuilder();
  const joints=['thigh','knee','ankle','hock'] as const;
  const before=joints.flatMap(j=>['L','R'].map(s=>rig[j][s as 'L'|'R'].position.toArray()));
  buildLegs(lo.legs.model,rig,b,FRAME_PROPS[lo.body.frame].bulk);
  expect(joints.flatMap(j=>['L','R'].map(s=>rig[j][s as 'L'|'R'].position.toArray()))).toEqual(before);
  const mat=new THREE.MeshBasicMaterial(); const mats=Object.fromEntries(['primary','secondary','trim','dark','joint','chrome','glow','visor','glowHot','decal'].map(k=>[k,mat])) as unknown as MatSet;
  const meshes=b.build(mats);rig.root.updateMatrixWorld(true);
  for(const m of meshes){expect(Array.from(m.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);expect(Array.from(m.geometry.getAttribute('normal').array).every(Number.isFinite)).toBe(true);m.geometry.dispose();}
  expect(meshes.length).toBeLessThan(65);mat.dispose();
 });
}
it('keeps authored leg lengths stable',()=>{
 expect(legLengths('stride',1)).toEqual({thigh:.4,shin:.41,ankleH:.11,meta:0,footLen:.34});
 expect(legLengths('hopper',1)).toEqual({thigh:.3,shin:.38,ankleH:.11,meta:.26,footLen:.36});
});

