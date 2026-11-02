import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ReplayCamera } from '../../src/render/replayCamera';
import { toggleFullscreen } from '../../src/core/fullscreen';
const a = new THREE.Vector3(-4, 0, 0), b = new THREE.Vector3(4, 0, 0);
describe('replay spectator camera', () => {
  it('swaps POV without modifying positions or combat inputs', () => {
    const camera = new THREE.PerspectiveCamera(55, 16/9, .1, 300);
    const rig = new ReplayCamera(camera, []);
    rig.setMode(0); rig.update(1/60, a, b); const first = camera.position.clone();
    rig.setMode(1); rig.update(1/60, a, b);
    expect(first.x).toBeLessThan(a.x); expect(camera.position.x).toBeGreaterThan(b.x);
    expect(a.toArray()).toEqual([-4,0,0]); expect(b.toArray()).toEqual([4,0,0]);
  });
  it('frames both fighters in portrait and landscape broadcast', () => {
    for (const aspect of [16/9, 9/16]) {
      const camera = new THREE.PerspectiveCamera(55, aspect, .1, 300);
      const rig = new ReplayCamera(camera, []); rig.update(1/60, a, b); camera.updateMatrixWorld();
      for (const p of [a,b]) { const ndc = p.clone().add(new THREE.Vector3(0,1,0)).project(camera); expect(Math.abs(ndc.x)).toBeLessThan(.95); expect(Math.abs(ndc.y)).toBeLessThan(.95); }
    }
  });
  it('pulls the POV boom in before a solid wall', () => {
    const camera = new THREE.PerspectiveCamera();
    const rig = new ReplayCamera(camera, [{kind:'box',min:new THREE.Vector3(-8,0,-10),max:new THREE.Vector3(-7,10,10)}]);
    rig.setMode(0); rig.update(1/60,a,b); expect(camera.position.x).toBeGreaterThan(-7);
  });
  it('uses time based smoothing consistently at 30 and 120fps', () => {
    const sample = (fps:number) => {
      const camera = new THREE.PerspectiveCamera(); const rig = new ReplayCamera(camera, []);
      rig.update(1/60,a,b);
      for(let i=0;i<fps;i++) rig.update(1/fps,a.clone().addScalar(2),b.clone().addScalar(2));
      return camera.position;
    };
    expect(sample(30).distanceTo(sample(120))).toBeLessThan(.00001);
  });
});
describe('fullscreen requests', () => {
  it('enters, exits and handles policy rejection without throwing', async () => {
    let entered = 0, exited = 0;
    const doc = {fullscreenElement:null,documentElement:{requestFullscreen:async()=>{entered++;}},exitFullscreen:async()=>{exited++;}};
    expect(await toggleFullscreen(doc as unknown as Document)).toBe(true); expect(entered).toBe(1);
    doc.fullscreenElement = {} as any;
    expect(await toggleFullscreen(doc as unknown as Document)).toBe(true); expect(exited).toBe(1);
    doc.exitFullscreen = async()=>{throw new Error('Policy denied');};
    expect(await toggleFullscreen(doc as unknown as Document)).toBe(false);
  });
});
