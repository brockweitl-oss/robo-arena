import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AimIndicator, skillLane } from '../../src/vfx/aimIndicator';
import { SkillEffects } from '../../src/vfx/skillEffects';
import { Fighter,emptyInput } from '../../src/game/fighter';
import { World, type Projectile } from '../../src/game/world';
import { DEFAULT_LOADOUT, resolveLoadout } from '../../src/data/parts';
import type { ArenaBuild, Collider } from '../../src/arena/types';
const v = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
function fixture(skill = 'lance') {
  const a = new Fighter(0,resolveLoadout({...DEFAULT_LOADOUT,skill})), b = new Fighter(1,resolveLoadout(DEFAULT_LOADOUT));
  a.pos.z=-5; b.pos.z=5;
  return {a,b};
}
describe('skill visual contracts',()=>{
  it('emitter handoff converges in80ms and status anchors follow rendered poses',()=>{
    const fx=new SkillEffects('low'),{a,b}=fixture();b.slowT=1;
    fx.syncStates([a,b],[v(2,2,2),v()], [v(),v(4,.2,5)],[v(),v(4,1.4,5)]);
    const shot={id:42,age:0,alive:true,owner:0,pos:v(),vel:v(0,0,70),spec:{look:'lance',radius:.32}} as Projectile;
    fx.syncProjectiles([shot]);const slot=(fx as any).slots[0];
    expect(slot.root.position.toArray()).toEqual([2,2,2]);
    shot.age=.08;shot.pos.set(0,0,5.6);fx.syncProjectiles([shot]);
    expect(slot.root.position.toArray()).toEqual(shot.pos.toArray());
    slot.core.geometry.computeBoundingBox();const bounds=slot.core.geometry.boundingBox;
    expect((bounds.max.x-bounds.min.x)*slot.core.scale.x).toBeCloseTo(.64);
    expect(slot.trail.visible).toBe(true);
    expect((fx as any).frost[1].position.toArray()).toEqual([4,1.15,5]);fx.dispose();
  });
  it('real reflected hook retains projectile identity and cannot produce a pull reel',()=>{
    for(const reflected of [false,true]) {
      const {a,b}=fixture('hook');
      const arena={info:{id:'test'},colliders:[],hazards:[],halfX:100,halfZ:100} as unknown as ArenaBuild;
      const world=new World(arena,a,b);if(reflected){b.yaw=Math.PI;b.setMode('charge');b.chargePhase=1;}
      (world as any).spawnSkill(a,null);
      for(let i=0;i<100&&world.projectiles.length;i++)(world as any).stepProjectiles(1/60);
      const hit=world.events.find(e=>e.type==='hit');expect(hit?.type).toBe('hit');
      if(hit?.type!=='hit')throw Error('missing skill hit');
      expect(hit.skillLook).toBe('hook');expect(hit.skillReflected).toBe(reflected);
      expect(hit.attacker).toBe(reflected?1:0);
      const fx=new SkillEffects('low');fx.syncStates([a,b]);
      fx.impact(hit.skillLook!,hit.attacker,hit.victim,hit.pos,!!hit.skillReflected||hit.ko||hit.knockdown);
      expect((fx as any).reels.some((r:any)=>r.cable.visible)).toBe(!reflected);fx.dispose();
    }
  });
  it('aim range and direction match the actual nonhoming skill launch, including elevated/away aim',()=>{
    const {a,b}=fixture(); b.pos.y=3;
    const arena={info:{id:'test'},colliders:[],hazards:[],halfX:100,halfZ:100} as unknown as ArenaBuild;
    for(const goal of [v(0,0,10),v(10,0,-5)]) {
      a.yaw=2.4;a.skillCd=0;a.recoveryTime=0;(a as any).aimHold=0;
      const lane=skillLane(a,b,goal,[]);
      const world=new World(arena,a,b);
      const floor:Collider={kind:'box',min:v(-100,-1,-100),max:v(100,0,100)};
      a.step(1/60,{...emptyInput(),skillPressed:true,skillTarget:goal.toArray() as [number,number,number]},b,[floor],100,100);
      for(let i=0;i<15&&!a.spawns.some(s=>s.kind==='skill');i++)a.step(1/60,emptyInput(),b,[floor],100,100);
      (world as any).spawnSkill(a,goal.toArray());
      const shot=world.projectiles[0];
      expect(lane.from.distanceTo(shot.pos)).toBeLessThan(.01);
      expect(lane.end.clone().sub(lane.from).normalize().distanceTo(shot.vel.clone().normalize())).toBeLessThan(1e-8);
      expect(lane.from.distanceTo(lane.end)).toBeCloseTo(a.lo.skill.range);
      expect(lane.width).toBe(a.lo.skill.radius*2);
    }
  });
  it('telegraph stops at the first solid and never paints beyond cover',()=>{
    const {a,b}=fixture(); const wall:Collider={kind:'box',min:v(-3,0,0),max:v(3,5,1)};
    const lane=skillLane(a,b,v(0,0,10),[wall]);
    expect(lane.obstructed).toBe(true); expect(lane.end.z).toBeCloseTo(0);
    const indicator=new AimIndicator(new THREE.Scene()); indicator.update(a,b,v(0,0,10),[wall],0);
    expect(indicator.group.children[0].scale.z).toBeCloseTo(Math.hypot(lane.end.x-lane.from.x,lane.end.z-lane.from.z));
    indicator.dispose();
  });
  it('live projectile/status sync reuses every GPU resource and clear hides all effects',()=>{
    const fx=new SkillEffects('low'),{a,b}=fixture();
    const resources=()=>{const ids=new Set<string>();fx.group.traverse(o=>{const m=o as THREE.Mesh;if(m.geometry)ids.add(m.geometry.uuid);if(m.material)for(const mat of Array.isArray(m.material)?m.material:[m.material])ids.add(mat.uuid)});return ids};
    // Visit all four kinds once so attached resource set includes each shared geometry.
    const projectile=(look:string,id:number)=>({id,age:0,alive:true,owner:0,pos:v(0,1,0),vel:v(0,0,40),spec:{look,radius:.5}} as Projectile);
    const list=['lance','wave','hook','frost'].map((look,id)=>projectile(look,id));
    fx.syncStates([a,b],[v(2,2,2),v(-2,2,-2)]);fx.syncProjectiles(list);
    const before=resources();
    for(let i=0;i<60;i++){b.slowT=1;fx.syncStates([a,b]);fx.syncProjectiles(list);fx.update(1/60);}
    expect(resources()).toEqual(before);
    expect((fx as any).frost[1].visible).toBe(true);
    b.slowT=0;fx.syncStates([a,b]);expect((fx as any).frost[1].visible).toBe(false);
    fx.impact('hook',0,1,b.chestPoint());expect((fx as any).reels[0].cable.visible).toBe(true);
    fx.update(.3);expect((fx as any).reels[0].cable.visible).toBe(false);
    fx.clear();expect(fx.group.children.every(o=>!o.visible)).toBe(true);fx.dispose();
  });
});
