import * as THREE from 'three';

/** Reused aim geometry: the arc is the same fixed-step trajectory used by the throw. */
export class BombAimView {
  readonly group = new THREE.Group();
  private positions = new Float32Array(256 * 3);
  private distances = new Float32Array(256);
  private pathGeometry = new THREE.BufferGeometry();
  private lineMaterial = new THREE.LineDashedMaterial({ color: 0xffd36a, dashSize: .18, gapSize: .1, transparent: true, opacity: .85, depthWrite: false });
  private ringGeometry = new THREE.RingGeometry(.97, 1, 64);
  private ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false });
  private ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
  private path: THREE.Line;
  constructor(scene: THREE.Scene) {
    this.pathGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.pathGeometry.setAttribute('lineDistance', new THREE.BufferAttribute(this.distances, 1).setUsage(THREE.DynamicDrawUsage));
    this.path = new THREE.Line(this.pathGeometry, this.lineMaterial);
    this.path.frustumCulled = false;
    this.ring.rotation.x = -Math.PI / 2;
    this.group.add(this.path, this.ring);
    this.group.visible = false;
    scene.add(this.group);
  }
  show(points: THREE.Vector3[], landing: THREE.Vector3, radius: number, obstructed: boolean) {
    this.group.visible = true;
    const n = Math.min(256, points.length);
    for (let i = 0; i < n; i++) {
      points[i].toArray(this.positions, i * 3);
      this.distances[i] = i ? this.distances[i - 1] + points[i].distanceTo(points[i - 1]) : 0;
    }
    this.pathGeometry.setDrawRange(0, n);
    this.pathGeometry.attributes.position.needsUpdate = true;
    this.pathGeometry.attributes.lineDistance.needsUpdate = true;
    const color = obstructed ? 0xff6b55 : 0xffd36a;
    this.ringMaterial.color.setHex(color); this.lineMaterial.color.setHex(color);
    this.ring.position.copy(landing); this.ring.position.y += .04;
    this.ring.scale.setScalar(radius);
  }
  hide() { this.group.visible = false; }
  dispose() {
    this.group.removeFromParent();
    this.pathGeometry.dispose(); this.lineMaterial.dispose();
    this.ringGeometry.dispose(); this.ringMaterial.dispose();
  }
}
