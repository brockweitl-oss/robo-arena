import * as THREE from 'three';

/** One draw call for a frozen articulated pose. Buffers are allocated once per pool slot. */
export class PoseSnapshot extends THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  private sources: { mesh: THREE.Mesh; offset: number }[] = [];
  private poseNormalMatrix = new THREE.Matrix3();
  private point = new THREE.Vector3();
  constructor(meshes: THREE.Mesh[], material: THREE.ShaderMaterial) {
    const geometry = new THREE.BufferGeometry();
    let vertices = 0;
    const indices: number[] = [];
    for (const mesh of meshes) {
      const g = mesh.geometry;
      const count = g.attributes.position.count;
      if (g.index) for (let i = 0; i < g.index.count; i++) indices.push(g.index.getX(i) + vertices);
      else for (let i = 0; i < count; i++) indices.push(i + vertices);
      vertices += count;
    }
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage));
    super(geometry, material);
    this.frustumCulled = false;
    let offset = 0;
    for (const mesh of meshes) {
      this.sources.push({ mesh, offset });
      offset += mesh.geometry.attributes.position.count;
    }
  }
  capture() {
    const positions = this.geometry.attributes.position as THREE.BufferAttribute;
    const normals = this.geometry.attributes.normal as THREE.BufferAttribute;
    for (const { mesh, offset } of this.sources) {
      const source = mesh.geometry.attributes.position;
      const normal = mesh.geometry.attributes.normal;
      this.poseNormalMatrix.getNormalMatrix(mesh.matrixWorld);
      for (let i = 0; i < source.count; i++) {
        this.point.fromBufferAttribute(source, i).applyMatrix4(mesh.matrixWorld);
        positions.setXYZ(offset + i, this.point.x, this.point.y, this.point.z);
        this.point.fromBufferAttribute(normal, i).applyNormalMatrix(this.poseNormalMatrix);
        normals.setXYZ(offset + i, this.point.x, this.point.y, this.point.z);
      }
    }
    positions.needsUpdate = normals.needsUpdate = true;
  }
}

