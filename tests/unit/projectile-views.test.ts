import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';

// glowSprite draws to a 2D canvas; the views only need a texture handle, so no browser is required.
vi.mock('../../src/render/textures', () => ({ glowSprite: () => new THREE.Texture() }));

import { ProjectileViews } from '../../src/vfx/projectileViews';
import type { ParticleSystem } from '../../src/vfx/particles';
import type { Projectile } from '../../src/game/world';
import { World } from '../../src/game/world';
import { Fighter } from '../../src/game/fighter';
import { DEFAULT_LOADOUT, SKILLS, resolveLoadout } from '../../src/data/parts';
import type { ArenaBuild } from '../../src/arena/types';

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const particles = () => ({ emit() {} }) as unknown as ParticleSystem;
const views = () => new ProjectileViews(particles(), particles());
let nextId = 1;
function shot(look: Projectile['spec']['look'], opts: Partial<Projectile> = {}, spec: Partial<Projectile['spec']> = {}): Projectile {
  const sk = SKILLS[look];
  return {
    id: nextId++, age: 0, alive: true, owner: 0, pos: v(0, 1, 0), vel: v(0, 0, 40),
    spec: { look, radius: sk?.radius ?? 0.2, color: sk?.color ?? 0x66ccff, coreColor: sk?.coreColor ?? 0xffffff, skill: !!sk, ...spec },
    ...opts,
  } as Projectile;
}
const priv = (pv: ProjectileViews) => pv as unknown as {
  views: Map<number, { head: THREE.Object3D; halo: THREE.Sprite; cable: THREE.Mesh | null; ribbon: { mesh: THREE.Mesh }; owner: number; offset: THREE.Vector3 | null }>;
  heads: Map<string, THREE.Object3D[]>; halos: THREE.Sprite[]; cables: THREE.Mesh[]; ribbons: { mesh: THREE.Mesh }[];
};
const ribbonPts = (r: unknown) => (r as { pts: Float32Array; n: number });
function pooled(pv: ProjectileViews) {
  const p = priv(pv);
  return { heads: [...p.heads.values()].flat(), halos: [...p.halos], cables: [...p.cables], ribbons: [...p.ribbons] };
}
const unique = (a: unknown[]) => new Set(a).size === a.length;

afterEach(() => vi.restoreAllMocks());

describe('ProjectileViews pooling', () => {
  it('clear pools live head/halo/cable exactly once, even when a dying view head was reused', () => {
    const pv = views();
    const anchors = [v(2, 2, 2), v(-2, 2, -2)];
    const sprites = new Set<THREE.SpriteMaterial>();
    const note = () => pv.group.traverse((o) => { if ((o as THREE.Sprite).isSprite) sprites.add((o as THREE.Sprite).material); });
    const first = ['lance', 'wave', 'hook', 'frost', 'blaster'].map((l) => shot(l as Projectile['spec']['look']));
    pv.sync(first, 1 / 60, anchors); note();
    const lanceHead = priv(pv).views.get(first[0].id)!.head;
    const hookCable = priv(pv).views.get(first[2].id)!.cable!;
    expect(hookCable).toBeTruthy();
    // lance + hook die (ribbons linger); a zero-dt frame must not pool their heads twice
    pv.sync([first[1], first[3], first[4]], 0, anchors);
    pv.sync([first[1], first[3], first[4]], 0, anchors);
    expect(unique(pooled(pv).heads)).toBe(true);
    expect(pooled(pv).cables).toEqual([hookCable]);
    // a new lance reuses the dying lance's head while the old ribbon still lingers
    const second = shot('lance');
    pv.sync([first[1], first[3], first[4], second], 1 / 60, anchors); note();
    expect(priv(pv).views.get(second.id)!.head).toBe(lanceHead);
    expect(priv(pv).views.get(first[0].id)).toBeTruthy();

    pv.clear();
    expect(pv.group.children.filter((o) => o.visible)).toEqual([]);
    expect(pv.group.children).toEqual([]);
    const after = pooled(pv);
    for (const list of Object.values(after)) expect(unique(list)).toBe(true);
    expect(after.heads.filter((h) => h === lanceHead)).toHaveLength(1);
    expect(after.halos).toHaveLength(sprites.size);
    expect(after.ribbons).toHaveLength(6); // 5 first shots + the second lance

    pv.clear(); // idempotent
    expect(pooled(pv)).toEqual(after);

    // reuse: the same workload allocates nothing new
    const sizes = (s: typeof after) => [s.heads.length, s.halos.length, s.cables.length, s.ribbons.length];
    const known = new Set<unknown>([...after.heads, ...after.halos, ...after.cables, ...after.ribbons.map((r) => r.mesh)]);
    // (the second lance reused the first lance's head/halo, so five heads exist in total)
    expect(after.heads).toHaveLength(5);
    const again = ['lance', 'wave', 'hook', 'frost', 'blaster'].map((l) => shot(l as Projectile['spec']['look']));
    pv.sync(again, 1 / 60, anchors); note();
    for (const o of pv.group.children) expect(known.has(o), `${o.type}`).toBe(true);
    pv.clear();
    expect(sizes(pooled(pv))).toEqual(sizes(after));
    expect(sprites.size).toBe(after.halos.length);

    // dispose frees every allocated sprite material exactly once
    const disposed = new Map<THREE.SpriteMaterial, number>();
    vi.spyOn(THREE.SpriteMaterial.prototype, 'dispose').mockImplementation(function (this: THREE.SpriteMaterial) {
      disposed.set(this, (disposed.get(this) ?? 0) + 1);
    });
    pv.sync(again.slice(0, 2), 1 / 60, anchors); // live views at dispose time are released too
    pv.dispose();
    expect(disposed.size).toBe(sprites.size);
    for (const m of sprites) expect(disposed.get(m)).toBe(1);
  });
});

/** World-space transverse extent of a head (meshes only; the halo sprite is decorative bloom). */
function measure(head: THREE.Object3D, dir: THREE.Vector3) {
  head.updateMatrixWorld(true);
  const d = dir.clone().normalize();
  const up = v(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(up, d).normalize();
  let radial = 0, along = 0, horiz = 0, vert = 0;
  const w = new THREE.Vector3();
  head.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      w.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).sub(head.position);
      const a = w.dot(d);
      along = Math.max(along, Math.abs(a));
      radial = Math.max(radial, w.clone().addScaledVector(d, -a).length());
      horiz = Math.max(horiz, Math.abs(w.dot(side)));
      vert = Math.max(vert, Math.abs(w.dot(up)));
    }
  });
  return { diameter: radial * 2, length: along, width: horiz * 2, height: vert * 2 };
}

describe('ProjectileViews skill sizes', () => {
  it('skill heads are exactly 2*spec.radius across, with distinct per-style length', () => {
    const pv = views();
    const lengths: Record<string, number> = {};
    for (const look of ['lance', 'wave', 'hook', 'frost'] as const) {
      const r = resolveLoadout({ ...DEFAULT_LOADOUT, skill: look }).skill.radius;
      expect(r).toBe(SKILLS[look].radius);
      const vel = look === 'wave' ? v(12, 0, 23) : v(9, 4, 40);
      const p = shot(look, { vel, age: 0.2 });
      for (let i = 0; i < 7; i++) pv.sync([p], 1 / 60, []); // several frames: frost spins
      const view = priv(pv).views.get(p.id)!;
      const m = measure(view.head, vel);
      if (look === 'wave') {
        expect(m.width).toBeCloseTo(2 * r, 6);
        expect(m.height).toBeCloseTo(2 * r, 6);
        expect(view.head.position.distanceTo(p.pos)).toBeLessThan(1e-9);
      } else expect(m.diameter).toBeCloseTo(2 * r, 6);
      // the halo is a camera-facing bloom sprite, not part of the solid silhouette
      expect(view.halo.isSprite).toBe(true);
      lengths[look] = m.length;
    }
    expect(lengths.lance).toBeGreaterThan(lengths.hook);
    expect(lengths.lance).toBeGreaterThan(4 * SKILLS.lance.radius);
    expect(new Set(Object.values(lengths).map((l) => l.toFixed(3))).size).toBe(4);
    pv.dispose();
  });

  it('ordinary gun heads keep their style scale', () => {
    const pv = views();
    const rail = shot('rail', {}, { radius: 0.3 });
    const blaster = shot('blaster', {}, { radius: 0.2 });
    pv.sync([rail, blaster], 1 / 60, []);
    expect(priv(pv).views.get(rail.id)!.head.scale.toArray()).toEqual([1, 1, 1.8]);
    expect(priv(pv).views.get(blaster.id)!.head.scale.toArray()).toEqual([1, 1, 0.75]);
    pv.dispose();
  });
});

describe('ProjectileViews emitter handoff and reflection', () => {
  it('a shot already reflected before its first render has no emitter offset or cable', () => {
    const pv = views();
    const p = shot('hook', { owner: 1, deflected: true, age: 0, pos: v(3, 1, 4), vel: v(0, 0, -48) });
    pv.sync([p], 1 / 30, [v(-5, 2, -5), v(8, 2, 8)]);
    const view = priv(pv).views.get(p.id)!;
    expect(view.offset).toBeNull();
    expect(view.cable).toBeNull();
    expect(view.head.position.toArray()).toEqual(p.pos.toArray());
    pv.dispose();
  });
  it('blends from the emitter for 80ms, then a reflection restarts at the sim bounce point', () => {
    const pv = views();
    const anchors = [v(2, 2, 2), v(9, 9, 9)];
    const p = shot('lance', { vel: v(0, 0, 70) });
    pv.sync([p], 1 / 60, anchors);
    const view = priv(pv).views.get(p.id)!;
    expect(view.head.position.toArray()).toEqual([2, 2, 2]);
    p.age = 0.04; p.pos.set(0, 1, 2.8);
    pv.sync([p], 1 / 60, anchors);
    // offset = anchor - spawn pos = (2, 1, 2), half applied at 40ms
    expect(view.head.position.distanceTo(v(1, 1.5, 3.8))).toBeLessThan(1e-9);
    p.age = 0.08; p.pos.set(0, 1, 5.6);
    pv.sync([p], 1 / 60, anchors);
    expect(view.head.position.toArray()).toEqual(p.pos.toArray());

    // world.ts reflection: owner flips, age resets, position snaps to the shield hit
    p.owner = 1; p.age = 0; p.pos.set(0.3, 1.1, 8); p.vel.set(1, 0, -77);
    pv.sync([p], 1 / 60, anchors);
    expect(view.owner).toBe(1);
    expect(view.offset).toBeNull();
    expect(view.head.position.distanceTo(p.pos)).toBeLessThan(1e-9);
    const rb = ribbonPts(view.ribbon);
    for (let i = 0; i < rb.n; i++) expect(v(rb.pts[i * 3], rb.pts[i * 3 + 1], rb.pts[i * 3 + 2]).distanceTo(p.pos)).toBeLessThan(1e-6); // Float32 ribbon buffer
    const fwd = v(0, 0, 1).applyQuaternion(view.head.quaternion);
    expect(fwd.distanceTo(p.vel.clone().normalize())).toBeLessThan(1e-6);
    for (let i = 1; i <= 4; i++) {
      p.age = i / 60; p.pos.addScaledVector(p.vel, 1 / 60);
      pv.sync([p], 1 / 60, anchors);
      expect(view.head.position.distanceTo(p.pos)).toBeLessThan(1e-9);
    }
    pv.dispose();
  });

  it('a real World shield reflection keeps the hook head on the sim path and drops its cable', () => {
    const a = new Fighter(0, resolveLoadout({ ...DEFAULT_LOADOUT, skill: 'hook' })), b = new Fighter(1, resolveLoadout(DEFAULT_LOADOUT));
    a.pos.z = -5; b.pos.z = 5;
    const arena = { info: { id: 'test' }, colliders: [], hazards: [], halfX: 100, halfZ: 100 } as unknown as ArenaBuild;
    const world = new World(arena, a, b);
    b.yaw = Math.PI; b.setMode('charge'); b.chargePhase = 1;
    const pv = views();
    const anchors = [v(0.6, 1.6, -4.6), v(-0.6, 1.6, 4.6)];
    (world as unknown as { spawnSkill(f: Fighter, t: null): void }).spawnSkill(a, null);
    const p = world.projectiles[0];
    pv.sync(world.projectiles, 1 / 60, anchors);
    const view = priv(pv).views.get(p.id)!;
    expect(view.cable).toBeTruthy();
    let reflected = false;
    for (let i = 0; i < 100 && world.projectiles.includes(p); i++) {
      (world as unknown as { stepProjectiles(dt: number): void }).stepProjectiles(1 / 60);
      if (!world.projectiles.includes(p)) break;
      pv.sync(world.projectiles, 1 / 60, anchors);
      if (p.owner === 1) {
        if (!reflected) {
          reflected = true;
          expect(p.age).toBeLessThan(1 / 60 + 1e-9);
          expect(view.cable).toBeNull();
        }
        expect(view.head.position.distanceTo(p.pos)).toBeLessThan(1e-9);
        expect(view.head.position.distanceTo(anchors[1])).toBeGreaterThan(0.2);
        const fwd = v(0, 0, 1).applyQuaternion(view.head.quaternion);
        expect(fwd.distanceTo(p.vel.clone().normalize())).toBeLessThan(1e-6);
      }
    }
    expect(reflected).toBe(true);
    pv.dispose();
  });
});
