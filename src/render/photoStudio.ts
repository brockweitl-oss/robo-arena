import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RobotModel } from '../robot/model';
import { Animator, type AnimSource } from '../robot/animator';
import { resolveLoadout, type Loadout } from '../data/parts';
import type { Paint } from '../data/characters';

const POSES = ['idle', 'run', 'strafe', 'back', 'air', 'hover', 'dash', 'fire', 'charge', 'down', 'getup', 'victory', 'defeat', 'flip'] as const;
type Pose = typeof POSES[number];
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag); e.className = cls; e.textContent = text; return e;
};

/** A self-contained photo studio. Owns and releases its renderer, controls and GPU resources. */
export class PhotoStudio {
  readonly root = el('section', 'photo-studio');
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bokeh: BokehPass;
  private output: OutputPass;
  private model: RobotModel;
  private animator: Animator;
  private stage = new THREE.Group();
  private environment: THREE.WebGLRenderTarget;
  private shadowLight: THREE.DirectionalLight;
  private raf = 0;
  private closed = false;
  private pose: Pose = 'idle';
  private time = 0;
  private playing = true;
  private last = performance.now();
  private keys = new Set<string>();
  private panel = el('aside', 'photo-panel');
  private status = el('div', 'photo-status', 'Drag to orbit · right-drag to pan · scroll to zoom');
  private source: AnimSource = {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, grounded: true, mode: 'ground', modeTime: 0,
    chargePhase: 0, hovering: false, aimTarget: null, aimWeight: 0, railCharge: 0, dashDir: new THREE.Vector3(0, 0, 1),
  };

  constructor(loadout: Loadout, paint: Paint, private onClose: () => void) {
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true'); this.root.setAttribute('aria-label', 'Photo studio');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.root.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x101720);
    this.scene.fog = new THREE.Fog(0x101720, 10, 30);
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, 0.04); this.scene.environment = this.environment.texture;
    room.dispose(); pmrem.dispose();
    this.shadowLight = new THREE.DirectionalLight(0xe4efff, 3.5);
    this.shadowLight.position.set(3, 6, 4); this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.set(1024, 1024);
    Object.assign(this.shadowLight.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
    this.shadowLight.shadow.normalBias = 0.02;
    const rim = new THREE.DirectionalLight(0x55bddf, 2.2); rim.position.set(-3, 3, -4);
    this.scene.add(this.shadowLight, rim, new THREE.HemisphereLight(0xc9d7ea, 0x26232a, 1.0));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(18, 64), new THREE.MeshStandardMaterial({ color: 0x222c38, metalness: 0.65, roughness: 0.42 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.025; floor.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.012, 6, 80), new THREE.MeshBasicMaterial({ color: 0x4cc7df }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -0.015;
    this.stage.add(floor, ring); this.scene.add(this.stage);
    this.model = new RobotModel(resolveLoadout(loadout), { ...paint }); this.animator = new Animator(this.model); this.scene.add(this.model.root);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.minDistance = 0.5; this.controls.maxDistance = 16;
    this.controls.maxPolarAngle = Math.PI * 0.95;
    this.resetCamera();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: this.camera.position.distanceTo(this.controls.target), aperture: 0.00015, maxblur: 0.012 });
    this.bokeh.enabled = false; this.composer.addPass(this.bokeh);
    this.output = new OutputPass(); this.composer.addPass(this.output);
    const heading = el('div', 'photo-heading', 'Photo studio');
    const sub = el('p', 'photo-sub', 'Frame your machine. Capture the moment.');
    const poses = el('select'); poses.setAttribute('aria-label', 'Pose');
    for (const pose of POSES) { const option = el('option', '', pose); option.value = pose; poses.append(option); }
    poses.onchange = () => { this.pose = poses.value as Pose; this.time = 0; this.animator = new Animator(this.model); this.advance(1 / 60); };
    const poseLabel = el('label', 'photo-control', 'Pose'); poseLabel.append(poses);
    const button = (label: string, action: () => void) => { const b = el('button', 'photo-button', label); b.type = 'button'; b.onclick = action; return b; };
    const play = button('Pause pose', () => { this.playing = !this.playing; play.textContent = this.playing ? 'Pause pose' : 'Animate pose'; });
    const exposure = this.slider('Exposure', 0.3, 2.5, 0.05, 1, v => this.renderer.toneMappingExposure = v);
    const depth = this.slider('Depth of field', 0, 1, 0.01, 0, v => { this.bokeh.enabled = v > 0; this.bokeh.materialBokeh.uniforms.aperture.value = v * 0.0015; });
    const focus = this.slider('Focus distance', 0.5, 12, 0.05, this.camera.position.distanceTo(this.controls.target), v => this.bokeh.materialBokeh.uniforms.focus.value = v);
    const reset = button('Reset camera', () => this.resetCamera());
    const hide = button('Hide controls · H', () => this.root.classList.toggle('photo-clean'));
    const capture = button('Save PNG · P', () => void this.capture()); capture.classList.add('photo-primary');
    const close = button('Back · Esc', () => this.close());
    this.panel.append(heading, sub, poseLabel, play, exposure, depth, focus, reset, hide, capture, close);
    const help = el('div', 'photo-help', 'H controls · P save PNG · Esc back');
    this.root.append(this.panel, this.status, help); document.body.append(this.root);
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('resize', this.resize); window.addEventListener('keydown', this.keyDown, true); window.addEventListener('keyup', this.keyUp, true); window.addEventListener('blur', this.clearKeys);
    this.resize(); close.focus(); this.tick();
  }

  private slider(name: string, min: number, max: number, step: number, value: number, change: (value: number) => void) {
    const row = el('label', 'photo-control', name); const input = el('input'); input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value); input.setAttribute('aria-label', name);
    const initial = Number(input.value); change(initial);
    const readout = el('output', '', initial.toFixed(2)); input.oninput = () => { const v = Number(input.value); readout.value = v.toFixed(2); change(v); };
    row.append(input, readout); return row;
  }
  private resetCamera() { this.camera.position.set(2.8, 1.7, 3.8); this.controls.target.set(0, 1, 0); this.controls.update(); }
  private resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h); this.composer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  };
  private keyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) { if (e.code !== 'Escape' && e.code !== 'Tab') return; }
    if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); return; }
    if (e.code === 'Tab') {
      e.preventDefault(); e.stopImmediatePropagation(); this.root.classList.remove('photo-clean');
      const controls = Array.from(this.panel.querySelectorAll<HTMLElement>('button, input, select'));
      const index = controls.indexOf(document.activeElement as HTMLElement); controls[(index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus(); return;
    }
    if (e.code === 'KeyH' && !e.repeat) this.root.classList.toggle('photo-clean');
    if (e.code === 'KeyP' && !e.repeat) void this.capture();
    this.keys.add(e.code);
    if (['KeyH', 'KeyP', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  private clearKeys = () => this.keys.clear();
  private keyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private advance(dt: number) {
    const s = this.source, t = this.time;
    s.pos.set(0, 0, 0); s.vel.set(0, 0, 0); s.mode = 'ground'; s.grounded = true; s.hovering = false; s.modeTime = t; s.aimTarget = null; s.aimWeight = 0;
    this.model.setThrust(0, 0);
    switch (this.pose) {
      case 'run': s.vel.z = 7; break;
      case 'strafe': s.vel.x = 6; s.aimTarget = new THREE.Vector3(0, 1.2, 8); s.aimWeight = 1; break;
      case 'back': s.vel.z = -5; break;
      case 'air': s.mode = 'air'; s.grounded = false; s.pos.y = 0.5; s.vel.y = Math.sin(t * 2) * 5; break;
      case 'hover': s.mode = 'air'; s.grounded = false; s.hovering = true; s.pos.y = 0.5; this.model.setThrust(1, 0.8); break;
      case 'dash': s.mode = 'dash'; s.vel.z = 22; this.model.setThrust(1, 0.5); break;
      case 'fire': s.aimTarget = new THREE.Vector3(0, 1.2, 8); s.aimWeight = 1; if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) this.animator.event({ type: 'fire' }); break;
      case 'charge': s.mode = 'charge'; s.modeTime = t % 1.5; s.chargePhase = s.modeTime < 0.3 ? 0 : s.modeTime < 0.6 ? 1 : 2; break;
      case 'down': s.mode = 'down'; s.modeTime = Math.min(t, 1); break;
      case 'getup': s.mode = 'getup'; s.modeTime = Math.min(t, 0.55); break;
      case 'victory': s.mode = 'victory'; break;
      case 'defeat': s.mode = 'defeat'; break;
      case 'flip': s.mode = 'air'; s.grounded = false; s.pos.y = 0.8; if (Math.floor(t / 1.2) !== Math.floor((t - dt) / 1.2)) this.animator.event({ type: 'airjump' }); break;
    }
    this.animator.update(s, dt); this.model.update(t, dt);
  }
  private tick = () => {
    if (this.closed) return;
    const now = performance.now(), dt = Math.min((now - this.last) / 1000, 0.05); this.last = now;
    if (this.playing) { this.time += dt; this.advance(dt); }
    const move = new THREE.Vector3(); this.camera.getWorldDirection(move); move.y = 0; move.normalize();
    const side = new THREE.Vector3().crossVectors(move, this.camera.up).normalize();
    const delta = new THREE.Vector3();
    if (this.keys.has('KeyW')) delta.add(move); if (this.keys.has('KeyS')) delta.sub(move);
    if (this.keys.has('KeyD')) delta.add(side); if (this.keys.has('KeyA')) delta.sub(side);
    if (this.keys.has('KeyE')) delta.y++; if (this.keys.has('KeyQ')) delta.y--;
    delta.multiplyScalar(dt * 2); this.camera.position.add(delta); this.controls.target.add(delta);
    this.controls.update(); this.composer.render(dt); this.raf = requestAnimationFrame(this.tick);
  };
  private async capture() {
    if (this.closed) return;
    this.composer.render(0);
    const blob = await new Promise<Blob | null>(resolve => this.renderer.domElement.toBlob(resolve, 'image/png'));
    if (!blob || this.closed) return;
    const url = URL.createObjectURL(blob); const a = el('a'); a.href = url; a.download = `robo-arena-${this.pose}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); this.status.textContent = 'PNG saved · image contains no interface';
  }
  close() {
    if (this.closed) return; this.closed = true; cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize); window.removeEventListener('keydown', this.keyDown, true); window.removeEventListener('keyup', this.keyUp, true); window.removeEventListener('blur', this.clearKeys);
    this.controls.dispose(); this.model.dispose();
    this.stage.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    this.shadowLight.shadow.map?.dispose(); this.bokeh.dispose(); this.output.dispose(); this.composer.dispose(); this.environment.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.root.remove(); this.onClose();
  }
}
