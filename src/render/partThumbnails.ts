import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RobotModel } from '../robot/model';
import { DEFAULT_LOADOUT, resolveLoadout, type Slot } from '../data/parts';
import { PLAYER_PAINT } from '../data/characters';

const cache = new Map<string, string>();
/** One small offscreen context per garage visit. Cards render actual part geometry once, then use images. */
export class PartThumbnails {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1.5, 0.01, 100);
  private environment: THREE.WebGLRenderTarget | null = null;
  private disposed = false;
  private pending = new Set<number>();

  image(slot: Slot, id: string): HTMLImageElement {
    const image = document.createElement('img'); image.className = 'gp-thumb'; image.alt = `${id} ${slot} model`; image.width = 144; image.height = 96;
    // skill emitters have no mesh yet; the card shows its icon instead
    if (slot === 'skill') { image.hidden = true; return image; }
    const key = `${slot}:${id}`;
    if (cache.has(key)) { image.src = cache.get(key)!; return image; }
    const timer = window.setTimeout(() => {
      this.pending.delete(timer); if (this.disposed || !image.isConnected) return;
      try { const src = this.render(slot, id); cache.set(key, src); image.src = src; }
      catch { image.hidden = true; }
    }, 80 + this.pending.size * 55);
    this.pending.add(timer); return image;
  }
  private initialize() {
    if (this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(216, 144); this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, 0.04); this.scene.environment = this.environment.texture;
    room.dispose(); pmrem.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(2, 4, 5);
    this.scene.add(key, new THREE.HemisphereLight(0xb9d8f0, 0x343644, 2));
  }
  private render(slot: Slot, id: string) {
    this.initialize();
    const model = new RobotModel(resolveLoadout({ ...DEFAULT_LOADOUT, [slot]: id }), PLAYER_PAINT);
    const rig = model.rig; model.root.updateMatrixWorld(true);
    const subject = new THREE.Group();
    const nodes = slot === 'gun' ? [rig.gunMount] : slot === 'bomb' ? [rig.bombMount] : slot === 'pod' ? [rig.podMount] : slot === 'legs' ? [rig.thigh.L, rig.thigh.R] : [rig.waist];
    for (const node of nodes) {
      const world = node.matrixWorld.clone(); node.removeFromParent(); node.matrixAutoUpdate = false; node.matrix.copy(world); subject.add(node);
      if (slot === 'body') node.traverse(o => { if (['gun', 'bomb', 'pod'].includes(o.name)) o.visible = false; });
    }
    if (slot === 'gun') subject.rotation.z = 1.05;
    subject.updateMatrixWorld(true);
    const box = new THREE.Box3();
    subject.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) if (!parent.visible) return;
      object.geometry.computeBoundingBox();
      if (object.geometry.boundingBox) box.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    });
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    subject.position.sub(center); this.scene.add(subject);
    const radius = Math.max(size.x / this.camera.aspect, size.y, size.z) * 0.6;
    const distance = Math.max(0.4, radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    const angle = slot === 'gun' ? new THREE.Vector3(1.8, -0.25, 2.5) : slot === 'pod' ? new THREE.Vector3(2, 0.6, -3) : new THREE.Vector3(2, 0.8, 3);
    this.camera.position.copy(angle.normalize().multiplyScalar(distance)); this.camera.lookAt(0, 0, 0);
    this.renderer!.render(this.scene, this.camera);
    const url = this.renderer!.domElement.toDataURL('image/png'); this.scene.remove(subject); model.dispose(); return url;
  }
  dispose() {
    this.disposed = true; for (const timer of this.pending) clearTimeout(timer); this.pending.clear();
    this.environment?.dispose(); this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.renderer = null;
  }
}
