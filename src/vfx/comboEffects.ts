import * as THREE from 'three';

type Quality = 'low' | 'medium' | 'high';
type QuadMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

const VERTEX = /* glsl */ `
  attribute vec3 anchor;
  attribute vec3 tint;
  attribute vec4 state;
  varying vec2 vUv;
  varying vec3 vTint;
  varying vec4 vState;
  void main() {
    vUv = uv; vTint = tint; vState = state;
    vec4 center = modelViewMatrix * vec4(anchor, 1.0);
    center.xy += position.xy * state.z;
    gl_Position = projectionMatrix * center;
    if (state.w < .5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const MARKER_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vTint;
  varying vec4 vState;
  void main() {
    if (vState.w < .5) discard;
    vec2 p = (vUv - .5) * 2.0;
    float r = length(p);
    float diamond = abs(p.x) + abs(p.y);
    // A hollow diamond and four corner notches remain recognizable without color.
    float badge = (1.0 - smoothstep(.025, .065, abs(diamond - .48)));
    float notches = (1.0 - smoothstep(.025, .06, abs(diamond - .70))) * step(.20, abs(p.x)) * step(.20, abs(p.y));
    float angle = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
    float arc = (1.0 - smoothstep(.018, .05, abs(r - .88)));
    float remaining = step(angle, vState.x);
    float center = (1.0 - smoothstep(.025, .06, min(abs(p.x), abs(p.y)))) * (1.0 - smoothstep(.12, .17, r));
    // Arming is an open, dashed outline; armed closes into a solid diamond.
    // Shape changes independently of the supplied color.
    float armed = 1.0 - vState.y;
    float dash = step(.38, fract(angle * 12.0));
    arc *= mix(dash, 1.0, armed);
    float alpha = max(max(badge * .78 * armed, notches * .92), max(arc * (.14 + remaining * .76), center * .8 * armed));
    if (alpha < .015) discard;
    gl_FragColor = vec4(vTint * 1.45, alpha);
  }
`;

const BURST_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vTint;
  varying vec4 vState;
  uniform float rays;
  void main() {
    if (vState.w < .5) discard;
    vec2 p = (vUv - .5) * 2.0;
    float r = length(p), age = vState.x;
    float diamond = abs(p.x) + abs(p.y);
    float alpha;
    if (vState.y < .5) {
      // Prime: a small contracting diamond, not an explosion.
      float radius = mix(.90, .34, age);
      float edge = 1.0 - smoothstep(.025, .065, abs(diamond - radius));
      float inner = 1.0 - smoothstep(.018, .04, abs(diamond - radius * .68));
      alpha = max(edge, inner * .38) * (1.0 - age);
    } else {
      // Detonation: separated outward streaks, leaving the center and target readable.
      float angle = atan(p.y, p.x);
      float spoke = pow(max(0.0, cos(angle * rays)), 20.0);
      float head = .22 + age * .70;
      float tail = max(.07, head - .23 * (1.0 - age));
      float ray = spoke * smoothstep(tail, tail + .05, r) * (1.0 - smoothstep(head - .04, head, r));
      float wave = (1.0 - smoothstep(.015, .045, abs(r - head * .72))) * .35;
      float core = (1.0 - smoothstep(.025, .13, diamond)) * max(0.0, 1.0 - age * 5.0);
      alpha = max(max(ray, wave), core) * pow(1.0 - age, .65);
    }
    if (alpha < .015) discard;
    gl_FragColor = vec4(vTint * (vState.y < .5 ? 1.5 : 2.2), alpha * .9);
  }
`;

function quads(count: number, fragmentShader: string, uniforms: Record<string, THREE.IUniform> = {}): QuadMesh {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setAttribute('anchor', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('tint', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('state', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage));
  geometry.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERTEX, fragmentShader, transparent: true, depthWrite: false,
    depthTest: true, blending: THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 9;
  return mesh;
}

/**
 * At most two extra draws: two persistent target markers and a bounded event pool.
 * No timers, random numbers, textures, lights, per-event meshes or simulation effects.
 * Marker positions are exact world anchors supplied by Match (normally above the head).
 */
export class ComboEffects {
  readonly group = new THREE.Group();
  private readonly markers = quads(2, MARKER_FRAGMENT);
  private readonly bursts: QuadMesh;
  private readonly ages: Float32Array;
  private readonly lifetimes: Float32Array;
  private readonly markerOn = [false, false];
  private readonly color = new THREE.Color();
  private cursor = 0;
  private disposed = false;
  readonly capacity: number;

  constructor(quality: Quality) {
    this.capacity = quality === 'low' ? 4 : 8;
    this.ages = new Float32Array(this.capacity); this.ages.fill(1);
    this.lifetimes = new Float32Array(this.capacity);
    this.bursts = quads(this.capacity, BURST_FRAGMENT, { rays: { value: quality === 'low' ? 4 : 8 } });
    this.markers.name = 'combo-target-markers'; this.bursts.name = 'combo-event-bursts';
    this.group.name = 'combo-effects'; this.group.add(this.markers, this.bursts);
  }

  updateMarker(id: 0 | 1, pos: THREE.Vector3, remaining: number, duration: number, color: number) {
    if (this.disposed || (id !== 0 && id !== 1)) return;
    const on = Number.isFinite(remaining) && Number.isFinite(duration) && remaining > 0 && duration > 0;
    this.markerOn[id] = on;
    const fraction = on ? Math.min(1, remaining / duration) : 0;
    // Gameplay arms after 21 of the 120 prime ticks have elapsed.
    const arming = on && fraction > .825;
    this.write(this.markers, id, pos, color, fraction, arming ? 1 : 0, .82, on);
    this.markers.visible = this.markerOn[0] || this.markerOn[1];
  }

  prime(pos: THREE.Vector3, color: number) { this.trigger(pos, color, false); }
  burst(pos: THREE.Vector3, color: number) { this.trigger(pos, color, true); }

  private trigger(pos: THREE.Vector3, color: number, detonate: boolean) {
    if (this.disposed) return;
    const slot = this.cursor++ % this.capacity;
    this.ages[slot] = 0; this.lifetimes[slot] = detonate ? .42 : .28;
    this.write(this.bursts, slot, pos, color, 0, detonate ? 1 : 0, detonate ? 2.4 : 1.25, true);
    this.bursts.visible = true;
  }

  private write(mesh: QuadMesh, slot: number, pos: THREE.Vector3, color: number, age: number, kind: number, size: number, active: boolean) {
    const anchor = mesh.geometry.getAttribute('anchor') as THREE.InstancedBufferAttribute;
    const tint = mesh.geometry.getAttribute('tint') as THREE.InstancedBufferAttribute;
    const state = mesh.geometry.getAttribute('state') as THREE.InstancedBufferAttribute;
    anchor.setXYZ(slot, pos.x, pos.y, pos.z); anchor.needsUpdate = true;
    this.color.set(color); tint.setXYZ(slot, this.color.r, this.color.g, this.color.b); tint.needsUpdate = true;
    state.setXYZW(slot, age, kind, size, active ? 1 : 0); state.needsUpdate = true;
  }

  update(dt: number) {
    if (this.disposed) return;
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const state = this.bursts.geometry.getAttribute('state') as THREE.InstancedBufferAttribute;
    let any = false;
    for (let i = 0; i < this.capacity; i++) {
      if (state.getW(i) === 0) continue;
      this.ages[i] += elapsed;
      const age = Math.min(1, this.ages[i] / this.lifetimes[i]);
      state.setX(i, age); state.setW(i, age < 1 ? 1 : 0); any ||= age < 1;
    }
    state.needsUpdate = true; this.bursts.visible = any;
  }

  clear() {
    this.markerOn[0] = this.markerOn[1] = false;
    for (const mesh of [this.markers, this.bursts]) {
      const state = mesh.geometry.getAttribute('state') as THREE.InstancedBufferAttribute;
      for (let i = 0; i < state.count; i++) state.setW(i, 0);
      state.needsUpdate = true; mesh.visible = false;
    }
    this.ages.fill(1); this.lifetimes.fill(0); this.cursor = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.clear(); this.group.removeFromParent();
    for (const mesh of [this.markers, this.bursts]) { mesh.geometry.dispose(); mesh.material.dispose(); }
    this.group.clear();
  }
}
