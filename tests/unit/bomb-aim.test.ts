import { expect, it } from 'vitest';
import * as THREE from 'three';
import { plannedBomb, BOMB_GRAVITY } from '../../src/game/bombAim';
import { Fighter, emptyInput } from '../../src/game/fighter';
import { resolveLoadout, DEFAULT_LOADOUT } from '../../src/data/parts';
import { InputRecorder, InputPlayer, quantizeInput } from '../../src/game/replay';
import type { Collider } from '../../src/arena/types';
import type { ArenaBuild } from '../../src/arena/types';
import { World, SIM_DT } from '../../src/game/world';
const v = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const floor: Collider = {kind:'box',min:v(-100,-1,-100),max:v(100,0,100)};

it('a high-speed bomb hits cover before an enemy behind it, without direct-hit guard break', () => {
  const a = new Fighter(0, resolveLoadout(DEFAULT_LOADOUT));
  const b = new Fighter(1, resolveLoadout(DEFAULT_LOADOUT)); b.pos.set(0,0,2);
  const wall: Collider = {kind:'box',min:v(-3,0,0),max:v(3,4,.2)};
  const arena = { info:{id:'test'}, colliders:[floor,wall], hazards:[], halfX:30,halfZ:30 } as unknown as ArenaBuild;
  const world = new World(arena,a,b);
  const calls: unknown[][]=[];
  world.explode = (...args) => { calls.push(args); };
  world.bombs.push({id:1,owner:0,def:a.lo.bomb,pos:v(0,1.2,-3),vel:v(0,0,600),bounces:0,age:0,alive:true,spin:v(),target:v(0,0,2)});
  (world as any).stepBombs(SIM_DT);
  expect(calls).toHaveLength(1);
  expect((calls[0][0] as THREE.Vector3).z).toBeCloseTo(-.1); // outward impact offset
  expect(calls[0][9]).not.toBe(true);
});

it('planned trajectory arrives exactly on an elevated surface with the actual integrator', () => {
  const f = new Fighter(0, resolveLoadout(DEFAULT_LOADOUT));
  const platform: Collider = {kind:'box',min:v(5,0,5),max:v(10,3,10)};
  const p = plannedBomb(f,v(7,3,7),[floor,platform]);
  const pos=p.from.clone(), vel=p.velocity.clone();
  for(let i=0;i<Math.round(p.flightTime*60);i++){vel.y-=BOMB_GRAVITY/60;pos.addScaledVector(vel,1/60);}
  expect(pos.distanceTo(p.target)).toBeLessThan(1e-8);
  expect(p.target.y).toBe(3); expect(p.obstructed).toBe(false);
});

it('range clamp resamples terrain and first wall impact warns before the selected landing', () => {
  const f = new Fighter(0,resolveLoadout(DEFAULT_LOADOUT));
  const p = plannedBomb(f,v(90,20,0),[floor]);
  expect(p.target.y).toBe(0); expect(p.target.clone().sub(p.from).setY(0).length()).toBeCloseTo(f.lo.bomb.range);
  const wall: Collider={kind:'box',min:v(2,0,-5),max:v(3,20,5)};
  const blocked=plannedBomb(f,v(10,0,0),[floor,wall]);
  expect(blocked.obstructed).toBe(true); expect(blocked.firstImpact!.x).toBeCloseTo(2);
});

it('replays preserve quantized cursor targets and clear targets on subsequent automatic input', () => {
  const recorder=new InputRecorder();
  const input=quantizeInput({...emptyInput(),bombTarget:[12.123,3.456,-9.999]});
  recorder.push(input);recorder.push(input);recorder.push(emptyInput());
  const player=new InputPlayer(recorder.encode());
  expect(player.next().bombTarget).toEqual(input.bombTarget);
  expect(player.next().bombTarget).toEqual(input.bombTarget);
  expect(player.next().bombTarget).toBeUndefined();
  expect(quantizeInput({...emptyInput(),bombTarget:[NaN,0,0]}).bombTarget).toBeUndefined();
  expect(quantizeInput({...emptyInput(),bombTarget:[999,0,-999]}).bombTarget).toEqual([256,0,-256]);
});
