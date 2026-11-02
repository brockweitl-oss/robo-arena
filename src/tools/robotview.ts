// Dev robot viewer: viewer.html?robot=striker&legs=stride&paint=player&anim=idle&cam=x,y,z
// anim: idle | run | strafe | back | air | hover | dash | fire | charge | down | getup | victory | defeat | flip
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GameRenderer } from '../render/renderer';
import { RobotModel } from '../robot/model';
import { Animator, type AnimSource } from '../robot/animator';
import { resolveLoadout, DEFAULT_LOADOUT } from '../data/parts';
import { PLAYER_PAINT, RIVALS } from '../data/characters';
import { studioEnvironment, tileMaps } from '../render/textures';

export function robotView(params: URLSearchParams) {
  const gr = new GameRenderer(document.body);
  const scene = new THREE.Scene();
  gr.setScene(scene);
  const quality = params.get('q');
  gr.setQuality(quality === 'low' || quality === 'medium' ? quality : 'high');
  scene.background = new THREE.Color(0x1b1f27);
  scene.environment = studioEnvironment(gr.renderer, { intensity: 1 });
  scene.fog = new THREE.Fog(0x1b1f27, 12, 30);
  const key = new THREE.DirectionalLight(0xfff1e0, 3.2);
  key.position.set(4, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -4;
  key.shadow.camera.right = key.shadow.camera.top = 4;
  key.shadow.normalBias = 0.02;
  const rim = new THREE.DirectionalLight(0x66ccff, 2.2);
  rim.position.set(-5, 3, -5);
  scene.add(key, rim, new THREE.HemisphereLight(0xa0b4cc, 0x202024, 0.6));
  const t = tileMaps({ base: '#2a2f38', alt: '#272b33', tiles: 8, size: 1024 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 64), new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughnessMap: t.rough, metalness: 0.4, roughness: 0.7 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const rivalId = params.get('paint');
  const rival = RIVALS.find((r) => r.id === rivalId);
  const lo = resolveLoadout({
    ...(rival ? rival.loadout : DEFAULT_LOADOUT),
    ...(params.get('robot') ? { body: params.get('robot')! } : {}),
    ...(params.get('legs') ? { legs: params.get('legs')! } : {}),
    ...(params.get('gun') ? { gun: params.get('gun')! } : {}),
    ...(params.get('bomb') ? { bomb: params.get('bomb')! } : {}),
    ...(params.get('pod') ? { pod: params.get('pod')! } : {}),
    ...(params.get('skill') ? { skill: params.get('skill')! } : {}),
  });
  const model = new RobotModel(lo, rival ? rival.paint : PLAYER_PAINT);
  scene.add(model.root);
  const anim = new Animator(model);
  const mode = params.get('anim') || 'idle';
  const src: AnimSource = {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, grounded: true, mode: 'ground', modeTime: 0, chargePhase: 0,
    hovering: false, aimTarget: null, aimWeight: 0, railCharge: 0, dashDir: new THREE.Vector3(0, 0, 1),
  };
  const target = new THREE.Vector3(0, 1.2, 8);

  const cam = gr.camera;
  const cp = params.get('cam');
  cam.position.set(...((cp ? cp.split(',').map(Number) : [2.6, 1.7, 3.6]) as [number, number, number]));
  const controls = new OrbitControls(cam, gr.renderer.domElement);
  controls.target.set(0, 1.0, 0);
  controls.update();
  const timer = new THREE.Timer();
  timer.connect(document);
  let t0 = 0;
  let frames = 0;
  let fpsT = 0;
  const loopT = Number(params.get('t') || 0);
  function frame() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    t0 += dt;
    const tt = loopT > 0 ? t0 % loopT : t0;
    src.modeTime = tt;
    src.aimTarget = null;
    src.aimWeight = 0;
    src.vel.set(0, 0, 0);
    src.mode = 'ground';
    src.grounded = true;
    src.hovering = false;
    src.pos.set(0, 0, 0);
    switch (mode) {
      case 'run': src.vel.set(0, 0, lo.body.runSpeed); break;
      case 'walk': src.vel.set(0, 0, 3); break;
      case 'strafe': src.vel.set(lo.body.runSpeed, 0, 0); src.aimTarget = target; src.aimWeight = 1; break;
      case 'back': src.vel.set(0, 0, -lo.body.runSpeed * 0.8); src.aimTarget = target; src.aimWeight = 1; break;
      case 'air': src.mode = 'air'; src.grounded = false; src.vel.set(0, Math.sin(t0 * 2) * 8, 4); src.pos.y = 0.6; break;
      case 'hover': src.mode = 'air'; src.grounded = false; src.hovering = true; src.vel.set(0, -0.8, 3); src.pos.y = 0.6; model.setThrust(1, 0.8); break;
      case 'dash': src.mode = 'dash'; src.vel.set(0, 0, 24); model.setThrust(1, 0.5); break;
      case 'fire': src.aimTarget = target; src.aimWeight = 1; if (Math.floor(t0 * 3) !== Math.floor((t0 - dt) * 3)) anim.event({ type: 'fire' }); break;
      case 'aim': src.aimTarget = target; src.aimWeight = 1; break;
      case 'charge': {
        src.mode = 'charge';
        const ch = lo.body.charge;
        const cycle = ch.windup + ch.lunge + ch.recover + .35;
        const t = tt % cycle;
        src.chargePhase = t < ch.windup ? 0 : t < ch.windup + ch.lunge ? 1 : 2;
        src.modeTime = t - (src.chargePhase === 0 ? 0 : src.chargePhase === 1 ? ch.windup : ch.windup + ch.lunge);
        break;
      }
      case 'down': src.mode = 'down'; src.grounded = tt > 0.4; break;
      case 'getup': src.mode = 'getup'; src.modeTime = Math.min(tt, 0.55); break;
      case 'victory': src.mode = 'victory'; break;
      case 'defeat': src.mode = 'defeat'; break;
      case 'flip': src.mode = 'air'; src.grounded = false; src.pos.y = 0.8; if (Math.floor(t0 / 1.2) !== Math.floor((t0 - dt) / 1.2)) anim.event({ type: 'airjump' }); break;
    }
    anim.update(src, dt);
    model.update(t0, dt);
    controls.update();
    gr.render(dt);
    frames++;
    fpsT += dt;
    if (fpsT > 1) {
      (window as any).__fps = frames / fpsT;
      frames = 0;
      fpsT = 0;
    }
    requestAnimationFrame(frame);
  }
  frame();
  (window as any).__ready = true;
  (window as any).__info = () => {
    let tris = 0;
    let meshes = 0;
    model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        meshes++;
        const g = m.geometry;
        tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      }
    });
    return { meshes, tris, calls: gr.renderer.info.render.calls };
  };
}
