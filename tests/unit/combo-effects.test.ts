import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ComboEffects } from '../../src/vfx/comboEffects';

const mesh = (fx: ComboEffects, name: string) => fx.group.getObjectByName(name) as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
const states = (fx: ComboEffects, name: string) => mesh(fx, name).geometry.getAttribute('state') as THREE.InstancedBufferAttribute;
const ANCHOR = new THREE.Vector3(2, 2.4, -5);

describe('pooled combo presentation', () => {
  it('switches from open arming shape to closed armed shape on the exact gameplay tick', () => {
    const fx = new ComboEffects('medium');
    const state = states(fx, 'combo-target-markers');
    fx.updateMarker(0, ANCHOR, 100, 120, 0xffffff);
    expect(state.getY(0)).toBe(1);
    fx.updateMarker(0, ANCHOR, 99, 120, 0xffffff);
    expect(state.getY(0)).toBe(0);
    fx.updateMarker(1, ANCHOR, 119, 120, 0xffffff);
    expect(state.getY(0)).toBe(0); expect(state.getY(1)).toBe(1);
    fx.updateMarker(1, ANCHOR, 0, 120, 0xffffff);
    expect(state.getW(1)).toBe(0); expect(state.getY(1)).toBe(0);
    fx.dispose();
  });
  it('tracks two independent markers and hides each exactly when its prime expires', () => {
    const fx = new ComboEffects('medium');
    fx.updateMarker(0, ANCHOR, 1.5, 3, 0x55ccff);
    fx.updateMarker(1, ANCHOR, 2, 3, 0xffaa55);
    const marker = mesh(fx, 'combo-target-markers'), state = states(fx, 'combo-target-markers');
    expect(marker.visible).toBe(true); expect(state.getX(0)).toBe(.5); expect(state.getW(1)).toBe(1);
    fx.updateMarker(0, ANCHOR, 0, 3, 0x55ccff);
    expect(marker.visible).toBe(true); expect(state.getW(0)).toBe(0);
    fx.updateMarker(1, ANCHOR, -1, 3, 0xffaa55);
    expect(marker.visible).toBe(false); expect(state.getW(1)).toBe(0);
    fx.updateMarker(0, ANCHOR, 2, 0, 0x55ccff);
    expect(marker.visible).toBe(false); fx.dispose();
  });
  it('keeps geometry, material and buffer counts fixed under sustained combo traffic', () => {
    const fx = new ComboEffects('low'); const burst = mesh(fx, 'combo-event-bursts');
    const geometry = burst.geometry, material = burst.material, data = states(fx, 'combo-event-bursts').array;
    for (let i = 0; i < 1000; i++) { fx.prime(ANCHOR, 0x55ccff); fx.burst(ANCHOR, 0xffaa55); fx.update(.01); }
    expect(fx.capacity).toBe(4); expect(fx.group.children).toHaveLength(2);
    expect(burst.geometry).toBe(geometry); expect(burst.material).toBe(material);
    expect(states(fx, 'combo-event-bursts').array).toBe(data); expect(geometry.instanceCount).toBe(4);
    fx.update(1); expect(burst.visible).toBe(false); fx.dispose();
  });
  it('is deterministic and clears all pooled presentation between rounds', () => {
    const a = new ComboEffects('medium'), b = new ComboEffects('medium');
    for (const fx of [a, b]) { fx.prime(ANCHOR, 0x55ccff); fx.update(.1); fx.burst(ANCHOR, 0xffaa55); fx.update(.05); }
    expect(Array.from(states(a, 'combo-event-bursts').array)).toEqual(Array.from(states(b, 'combo-event-bursts').array));
    a.updateMarker(0, ANCHOR, 3, 3, 0xffffff); a.clear();
    expect(a.group.children.every(child => !child.visible)).toBe(true);
    expect(Array.from(states(a, 'combo-target-markers').array).filter((_, i) => i % 4 === 3)).toEqual([0, 0]);
    a.dispose(); b.dispose();
  });
  it('releases each owned geometry and material once and safely accepts repeated disposal', () => {
    const fx = new ComboEffects('high'); let geometryDisposals = 0, materialDisposals = 0;
    for (const child of fx.group.children as THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]) {
      child.geometry.addEventListener('dispose', () => geometryDisposals++);
      child.material.addEventListener('dispose', () => materialDisposals++);
    }
    fx.dispose(); fx.dispose();
    expect(geometryDisposals).toBe(2); expect(materialDisposals).toBe(2); expect(fx.group.children).toHaveLength(0);
  });
});
