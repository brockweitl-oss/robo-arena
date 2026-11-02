import { expect, it } from 'vitest';
import * as THREE from 'three';
import { buildSkill } from '../../src/robot/skills';
import { Rig } from '../../src/robot/rig';
import { rigSpecFor } from '../../src/robot/model';
import { PartBuilder, type MatSet } from '../../src/robot/kit';
import { DEFAULT_LOADOUT, resolveLoadout } from '../../src/data/parts';

for (const body of ['striker','wisp','regent','ironclad']) for (const skill of ['lance','wave','hook','frost']) {
  it(`${body}/${skill} has a finite compact emitter and independent forward muzzle`, () => {
    const lo=resolveLoadout({...DEFAULT_LOADOUT,body,skill}), rig=new Rig(rigSpecFor(lo)), builder=new PartBuilder();
    const material=new THREE.MeshBasicMaterial();
    const mats=Object.fromEntries(['primary','secondary','trim','dark','joint','chrome','glow','visor','glowHot','decal'].map(k=>[k,material])) as unknown as MatSet;
    const gunBefore=rig.muzzle.position.clone();
    buildSkill(lo.skill,rig,builder); const meshes=builder.build(mats);
    rig.root.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(rig.skillMount), size=bounds.getSize(new THREE.Vector3());
    expect(meshes.length).toBeLessThanOrEqual(5);
    expect(size.x).toBeLessThan(.45);expect(size.z).toBeLessThan(.75);
    expect(bounds.max.y).toBeLessThan(2.2);
    expect(rig.skillMuzzle.position.z).toBeGreaterThan(.2);
    expect(rig.muzzle.position.equals(gunBefore)).toBe(true);
    for(const mesh of meshes){expect([...mesh.geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true);mesh.geometry.dispose();}
    material.dispose();
  });
}
