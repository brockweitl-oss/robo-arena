import { expect, it } from 'vitest';
import * as THREE from 'three';
import { Animator, type AnimSource } from '../../src/robot/animator';
import { Rig } from '../../src/robot/rig';
import type { RobotModel } from '../../src/robot/model';
import { DEFAULT_LOADOUT, resolveLoadout, type Loadout } from '../../src/data/parts';

function fixture(gun: Loadout['gun'] = 'pulse') {
  const rig = new Rig({ hipY: 1, hipX: .16, thigh: .45, shin: .45, ankleH: .1, meta: 0, waistY: .12, chestY: .15, neckY: .25, shoulderX: .3, shoulderY: .2, upperArm: .3, forearm: .3, scale: 1, footLen: .25 });
  const model = { rig, loadout: resolveLoadout({ ...DEFAULT_LOADOUT, gun }), barrel: new THREE.Group(), launcher: new THREE.Group(), setCharge() {} } as unknown as RobotModel;
  const animator = new Animator(model);
  const source: AnimSource = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, grounded: true, mode: 'ground', modeTime: 0, chargePhase: 0, hovering: false, aimTarget: new THREE.Vector3(0, 1.4, 10), aimWeight: 1, railCharge: 0, dashDir: new THREE.Vector3(0, 0, 1) };
  const step = (n: number) => { for (let i = 0; i < n; i++) { source.modeTime += 1 / 60; animator.update(source, 1 / 60); } };
  step(90);
  return { animator, source, rig, step };
}

it('precision release moves the torso more than pulse without moving the simulation root', () => {
  const pulse = fixture(), rail = fixture('rail');
  pulse.animator.event({ type: 'fire' }); rail.animator.event({ type: 'fire' });
  pulse.step(3); rail.step(3);
  expect(Math.abs(rail.rig.chest.rotation.x)).toBeGreaterThan(Math.abs(pulse.rig.chest.rotation.x) * 2);
  expect(rail.rig.root.position.equals(rail.source.pos)).toBe(true);
  rail.rig.root.updateMatrixWorld(true);
  for (const side of ['L', 'R'] as const) {
    const q = rail.rig.ankle[side].getWorldQuaternion(new THREE.Quaternion());
    expect(q.angleTo(rail.rig.root.quaternion)).toBeLessThan(.0001);
  }
});

it('combo response is deterministic, finite and settles without changing the fighter source', () => {
  const a = fixture('beam'), b = fixture('beam');
  for (const f of [a, b]) { f.animator.event({ type: 'combo', role: 'target' }); f.step(120); }
  expect(a.rig.chest.quaternion.toArray()).toEqual(b.rig.chest.quaternion.toArray());
  expect(a.rig.chest.rotation.x).toBeLessThan(.05);
  expect(a.source.vel.length()).toBe(0);
  a.rig.root.traverse(node => expect(node.matrixWorld.elements.every(Number.isFinite)).toBe(true));
});
