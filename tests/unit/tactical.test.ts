import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Fighter, emptyInput, DASH_RECOVERY, type FighterInput } from '../../src/game/fighter';
import { World, SIM_DT, interceptTime, gunShotSpec } from '../../src/game/world';
import { AIPilot } from '../../src/game/ai';
import { DEFAULT_LOADOUT, resolveLoadout, PODS, type Loadout } from '../../src/data/parts';
import type { ArenaBuild } from '../../src/arena/types';

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function fixture(loadout: Partial<Loadout> = {}, seed = 1) {
  const arena: ArenaBuild = {
    info: { id: 'test', name: 'Test', subtitle: '', blurb: '', accent: '#fff', music: 'menu' },
    root: new THREE.Group(), colliders: [{ kind: 'box', min: v(-30, -1, -30), max: v(30, 0, 30) }], hazards: [],
    spawns: [v(0, 0, -8), v(0, 0, 8)], halfX: 28, halfZ: 28, background: new THREE.Color(), environment: null,
    fog: null, keyLight: new THREE.DirectionalLight(), tick() {}, update() {}, dispose() {},
  };
  const a = new Fighter(0, resolveLoadout({ ...DEFAULT_LOADOUT, ...loadout }));
  const b = new Fighter(1, resolveLoadout(DEFAULT_LOADOUT));
  a.pos.copy(arena.spawns[0]); b.pos.copy(arena.spawns[1]); b.yaw = Math.PI;
  const w = new World(arena, a, b, { seed }); w.combatEnabled = true;
  return { w, a, b };
}
const step = (w: World, n = 1, a: Partial<FighterInput> = {}, b: Partial<FighterInput> = {}) => {
  for (let i = 0; i < n; i++) w.step([{ ...emptyInput(), ...a }, { ...emptyInput(), ...b }]);
};

describe('Playtest 3 directional defense', () => {
  for (const phase of [0, 1]) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    it(`only protects the forward arc at yaw ${yaw}, phase ${phase}`, () => {
      for (const offset of [0, Math.PI / 2, Math.PI]) {
        const { a } = fixture(); a.yaw = yaw; a.setMode('charge'); a.chargePhase = phase;
        const travel = v(-Math.sin(yaw + offset), 0, -Math.cos(yaw + offset));
        const result = a.takeHit({ damage: 100, down: 10, knock: 0, heavy: false, source: 'gun', dir: travel });
        if (offset === 0) expect(phase === 0 ? result.parried : result.blocked).toBe(true);
        else { expect(result.parried).toBeUndefined(); expect(result.blocked).toBeUndefined(); expect(result.damage).toBe(100); }
      }
    });
  }
  it('rear projectile passes both deflection and fallback guard', () => {
    const { w, a, b } = fixture(); a.pos.set(0, 0, 0); b.pos.set(0, 0, -2);
    a.yaw = 0; a.setMode('charge'); a.chargePhase = 1;
    (w as any).spawnShot(b, 0, false, 1);
    // Isolate collision from the charge animator automatically turning toward its target.
    for (let i = 0; i < 12 && w.projectiles.length; i++) (w as any).stepProjectiles(SIM_DT);
    expect(a.hp).toBeLessThan(a.maxHp); expect(w.events.some(e => e.type === 'deflect')).toBe(false);
  });
  it('a steep overhead shot cannot bypass the vertical guard boundary through fallback parry', () => {
    const { w, a, b } = fixture(); a.pos.set(0, 0, 0); b.pos.set(0, 4, 3);
    a.yaw = 0; a.setMode('charge'); a.chargePhase = 0;
    (w as any).spawnShot(b, 0, false, 1);
    expect(a.facesIncoming(w.projectiles[0].vel)).toBe(false);
    for (let i = 0; i < 30 && w.projectiles.length; i++) (w as any).stepProjectiles(SIM_DT);
    expect(a.hp).toBeLessThan(a.maxHp); expect(a.stats.parries).toBe(0);
    expect(w.events.some(e => e.type === 'deflect')).toBe(false);
  });
});

describe('Playtest 3 action commitment', () => {
  it('charge cooldown survives parry interruption', () => {
    const { w, a } = fixture(); step(w, 1, { chargePressed: true });
    expect(a.chargeCd).toBeGreaterThan(a.st.chargeCooldown);
    a.parriedBy(); step(w, 40);
    expect(a.chargeCd).toBeGreaterThan(0); step(w, 1, { chargePressed: true });
    expect(a.mode).not.toBe('charge');
  });
  it('charge cooldown survives heavy-hit interruption', () => {
    const { w, a } = fixture(); step(w, 1, { chargePressed: true });
    a.takeHit({ damage: 20, down: 20, dir: v(0, 0, 1), knock: 3, heavy: true, source: 'gun' });
    expect(a.mode).toBe('stagger'); expect(a.chargeCd).toBeGreaterThan(0);
    step(w, 25); step(w, 1, { chargePressed: true }); expect(a.mode).not.toBe('charge');
  });
  it('airborne rail commitment brakes carried momentum even when the movement stick is released', () => {
    const { w, a } = fixture({ gun: 'rail' });
    a.pos.y = 8; a.grounded = false; a.setMode('air'); a.vel.set(20, 0, 0);
    step(w, 1, { gunPressed: true });
    expect(Math.hypot(a.vel.x, a.vel.z)).toBeLessThanOrEqual(a.runSpeed * 0.12 * 0.9 + 1e-6);
  });
  it('a dash has a real recharge and a punishable recovery window', () => {
    const { w, a } = fixture(); step(w, 1, { dashPressed: true, moveX: 1 });
    step(w, 20); expect(a.recoveryTime).toBeGreaterThan(0); expect(a.recoveryTime).toBeLessThanOrEqual(DASH_RECOVERY);
    expect(a.dashCharges).toBe(0); expect(a.canDash).toBe(false);
    const shots = a.stats.shots; step(w, 1, { gunPressed: true, gunHeld: true }); expect(a.stats.shots).toBe(shots);
    step(w, 60); expect(a.canDash).toBe(true);
  });
  it('one perfect dodge cannot repeatedly refund mobility across a burst', () => {
    const { w, a } = fixture(); step(w, 1, { dashPressed: true, moveX: 1 });
    a.perfectDodge(); const cooldown = a.dashCd; a.perfectDodge(); a.perfectDodge();
    expect(a.stats.dodges).toBe(1); expect(a.dashCharges).toBe(0); expect(a.dashCd).toBe(cooldown);
  });
  it('rail windup cannot be bypassed with a dash or jump, and ends in recovery', () => {
    const { w, a } = fixture({ gun: 'rail' }); step(w, 1, { gunPressed: true });
    expect(a.attackCommitted).toBe(true);
    step(w, 1, { dashPressed: true, jumpPressed: true, moveX: 1 });
    expect(a.mode).toBe('ground'); expect(a.dashCharges).toBe(1);
    step(w, 32); expect(a.stats.shots).toBe(1); expect(a.recoveryTime).toBeGreaterThan(0);
  });
});

describe('Playtest 3 predictable weapons and opponents', () => {
  it('a fast shot cannot damage a pod or activate a switch through thin cover', () => {
    const { w, a, b } = fixture({ gun: 'rail' }); b.pos.z = 20;
    w.colliders.push({ kind: 'box', min: v(-2, 0, 0), max: v(2, 4, 0.2) });
    const pod = { id: 999, owner: 1, def: PODS.seeker, pos: v(0, 1.2, 0.4), vel: v(), age: 1, hp: 40, alive: true, triggeredAt: -1, heading: 0, actT: 0 };
    const trap = { index: 0, pos: v(8, 0, 8), sw: v(0, 1.2, 0.4), armedAt: -1, readyAt: 0, owner: -1 };
    w.pods.push(pod); w.traps.push(trap);
    (w as any).makeProjectile(0, { ...gunShotSpec(a), homing: 0, speed: 600 }, v(0, 1.2, -3), v(0, 0, 600), 1);
    (w as any).stepProjectiles(SIM_DT);
    expect(pod.hp).toBe(40); expect(trap.armedAt).toBe(-1); expect(w.projectiles.length).toBe(0);
  });
  it('a shot passing through a perfect dodge still stops at the wall behind it that same tick', () => {
    const { w, a, b } = fixture({ gun: 'rail' }); b.pos.set(0, 0, 0); b.dashIframe = 0.1;
    w.colliders.push({ kind: 'box', min: v(-2, 0, 1), max: v(2, 4, 1.2) });
    (w as any).makeProjectile(0, { ...gunShotSpec(a), homing: 0, speed: 600 }, v(0, 1.2, -3), v(0, 0, 600), 1);
    (w as any).stepProjectiles(SIM_DT);
    expect(b.hp).toBe(b.maxHp); expect(b.stats.dodges).toBe(1); expect(w.projectiles.length).toBe(0);
  });
  it('simultaneous lethal projectiles produce a draw instead of a player-slot advantage', () => {
    const { w, a, b } = fixture(); a.hp = b.hp = 1;
    step(w, 1, { gunPressed: true }, { gunPressed: true });
    for (let i = 0; i < 60 && w.koLoser < 0; i++) step(w);
    expect(a.hp).toBe(0); expect(b.hp).toBe(0); expect(w.koLoser).toBe(2);
    expect(w.events.some(e => e.type === 'ko' && e.loser === 2)).toBe(true);
  });
  it('knockdown credit belongs to the attacker and is separate from knockdowns received', () => {
    const { w, a, b } = fixture();
    w.applyHit(b, a.id, { damage: 1, down: 120, dir: v(0, 0, 1), knock: 1, heavy: true, source: 'gun' }, b.chestPoint(), 0);
    expect(a.stats.knockdowns).toBe(1); expect(a.stats.knockdownsTaken).toBe(0);
    expect(b.stats.knockdowns).toBe(0); expect(b.stats.knockdownsTaken).toBe(1);
  });
  it('primary gun accuracy excludes unrelated bomb and pod damage', () => {
    const { w, a, b } = fixture(); step(w, 1, { gunPressed: true }); step(w, 70);
    expect(a.stats.gunProjectiles).toBe(3); expect(a.stats.gunHits).toBeGreaterThan(0);
    const gunHits = a.stats.gunHits, gunDamage = a.stats.gunDamage;
    w.applyHit(b, a.id, { damage: 30, down: 1, dir: v(0, 0, 1), knock: 0, heavy: false, source: 'bomb' }, b.chestPoint(), 0);
    expect(a.stats.gunHits).toBe(gunHits); expect(a.stats.gunDamage).toBe(gunDamage);
  });
  it('precision intercept leads a moving target mathematically', () => {
    const target = v(0, 0, 18), velocity = v(8, 0, 0), speed = 110;
    const t = interceptTime(target, velocity, speed);
    expect(target.clone().addScaledVector(velocity, t).length()).toBeCloseTo(speed * t, 6);
  });
  it('AI behavior is seed-independent but personalities choose different movement', () => {
    const { w, a, b } = fixture();
    const one = new AIPilot('bomber', 0.8, 1), two = new AIPilot('bomber', 0.8, 999);
    expect(one.think(w, a, b)).toEqual(two.think(w, a, b));
    expect(new AIPilot('rusher', 0.8).think(w, a, b)).not.toEqual(new AIPilot('bomber', 0.8).think(w, a, b));
  });
});

describe('3.0 integration decisions (owner-approved)', () => {
  it('hit-stop is brief and presses during it are not lost', () => {
    const { w, a, b } = fixture();
    w.applyHit(b, a.id, { damage: 50, down: 10, dir: v(0, 0, 1), knock: 2, heavy: true, source: 'gun' }, b.chestPoint(), 0);
    expect(b.hitstop).toBeGreaterThan(0);
    expect(b.hitstop).toBeLessThanOrEqual(0.1);
    // a press made during a hit-stop is applied when the robot unfreezes
    const f = fixture();
    step(f.w, 5);
    f.b.hitstop = 0.05;
    step(f.w, 1, {}, { jumpPressed: true, jumpHeld: true });
    for (let i = 0; i < 8; i++) step(f.w, 1, {}, { jumpHeld: true });
    expect(f.b.grounded).toBe(false);
  });
  it('airborne gun shots are deterministic for a given seed', () => {
    const run = () => {
      const { w, a } = fixture({}, 77);
      a.pos.y = 5; a.grounded = false; a.setMode('air');
      step(w, 1, { gunPressed: true, gunHeld: true });
      for (let i = 0; i < 3; i++) step(w);
      return w.projectiles.map((p) => p.vel.toArray().map((x) => x.toFixed(4)));
    };
    expect(run()).toEqual(run());
  });
});
