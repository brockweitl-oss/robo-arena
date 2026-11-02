// Dev viewer: viewer.html?arena=foundry  (orbit with mouse; ?cam=x,y,z&t=x,y,z for fixed shots; ?q=low|medium|high)
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GameRenderer } from '../render/renderer';
import { ARENA_FACTORIES } from '../arena';

import { robotView } from './robotview';

const params = new URLSearchParams(location.search);
if (params.get('robot') || params.get('paint') || params.get('anim')) {
  robotView(params);
} else arenaView();

function arenaView() {
const gr = new GameRenderer(document.body);
const q = (params.get('q') as any) || 'high';
const scene = new THREE.Scene();
gr.setScene(scene);
const arenaId = params.get('arena') || 'foundry';
const arena = ARENA_FACTORIES[arenaId]({ quality: q, renderer: gr.renderer });
scene.add(arena.root);
scene.background = arena.background;
scene.environment = arena.environment;
scene.fog = arena.fog;
gr.setQuality(q);

// Robot-sized stand-ins at spawns (2 m tall capsules) for scale.
for (const [i, s] of arena.spawns.entries()) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.1, 8, 16), new THREE.MeshStandardMaterial({ color: i ? 0x3399ff : 0xff5522, metalness: 0.3, roughness: 0.4 }));
  m.position.copy(s).add(new THREE.Vector3(0, 1, 0));
  m.castShadow = true;
  scene.add(m);
}
// Optional collider debug: ?debug=1
if (params.get('debug')) {
  for (const c of arena.colliders) {
    const size = c.max.clone().sub(c.min);
    const box = new THREE.Box3Helper(new THREE.Box3(c.min.clone(), c.max.clone()), c.kind === 'ramp' ? 0xffff00 : 0x00ff00);
    scene.add(box);
    void size;
  }
}
const cam = gr.camera;
const cp = params.get('cam');
const tp = params.get('t');
cam.position.set(...((cp ? cp.split(',').map(Number) : [0, 14, 24]) as [number, number, number]));
const controls = new OrbitControls(cam, gr.renderer.domElement);
controls.target.set(...((tp ? tp.split(',').map(Number) : [0, 1, 0]) as [number, number, number]));
controls.update();
const clock = new THREE.Timer(); clock.connect(document);
let simT = 0;
let acc = 0;
let frames = 0;
let fpsT = 0;
(window as any).__fps = 0;
function frame() {
  clock.update(); const dt = Math.min(clock.getDelta(), 0.1);
  acc += dt;
  while (acc >= 1 / 60) { arena.tick(simT, 1 / 60); simT += 1 / 60; acc -= 1 / 60; }
  arena.update(clock.getElapsed(), dt);
  controls.update();
  gr.render(dt);
  frames++; fpsT += dt;
  if (fpsT > 1) { (window as any).__fps = frames / fpsT; frames = 0; fpsT = 0; }
  requestAnimationFrame(frame);
}
(window as any).__ready = true;
frame();
}
