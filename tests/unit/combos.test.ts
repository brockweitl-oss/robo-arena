import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Fighter, emptyInput, type HitInfo } from '../../src/game/fighter';
import { World, SIM_DT, gunShotSpec, DAMAGE_SCALE } from '../../src/game/world';
import { comboBonus } from '../../src/game/combos';
import { DEFAULT_LOADOUT, resolveLoadout, PODS } from '../../src/data/parts';
import type { ArenaBuild } from '../../src/arena/types';
import { AIPilot } from '../../src/game/ai';

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function setup(gun = 'rail') {
  const arena = { info: { id: 'test' }, root: new THREE.Group(), colliders: [{ kind: 'box', min: v(-30, -1, -30), max: v(30, 0, 30) }],
    hazards: [], spawns: [v(0, 0, -5), v(0, 0, 5)], halfX: 28, halfZ: 28, tick() {} } as unknown as ArenaBuild;
  const a = new Fighter(0, resolveLoadout({ ...DEFAULT_LOADOUT, gun }));
  const b = new Fighter(1, resolveLoadout(DEFAULT_LOADOUT));
  a.pos.set(0, 0, -5); b.pos.set(0, 0, 5); b.yaw = Math.PI;
  const w = new World(arena, a, b); w.combatEnabled = true;
  return { a, b, w };
}
const tick = (w: World, n: number) => { for (let i = 0; i < n; i++) w.step([emptyInput(), emptyInput()]); };
const hit = (extra: Partial<HitInfo> = {}): HitInfo => ({ damage: 100, down: 0, dir: v(0, 0, 1), knock: 0, heavy: false, source: 'gun', ...extra });
function blast(w: World, b: Fighter, source: 'bomb' | 'pod' = 'bomb', prime = true) {
  w.explode(b.chestPoint().add(v(0, 0, -0.2)), 0, 20, 0, 2, 0xffffff, false, source, true, false, prime);
}
function shoot(w: World, a: Fighter, reflected = false) {
  (w as any).spawnShot(a, 0, false, 1);
  w.projectiles.at(-1)!.deflected = reflected;
  for (let n = 0; n < 30 && w.projectiles.length; n++) (w as any).stepProjectiles(SIM_DT);
}

describe('deterministic primer and detonator contract', () => {
  it('clean utility damage primes once, arms at21ticks, expires at120 without refresh', () => {
    const { w, b } = setup(); blast(w, b);
    expect(b.primer).toMatchObject({ owner: 0, remainingTicks: 120, armed: false });
    tick(w, 20); expect(b.primer?.armed).toBe(false);
    blast(w, b, 'pod'); expect(b.primer?.remainingTicks).toBe(100);
    tick(w, 1); expect(b.primer?.armed).toBe(true);
    tick(w, 98); expect(b.primer?.remainingTicks).toBe(1);
    tick(w, 1); expect(b.primer).toBeNull();
    expect(w.events.some(e => e.type === 'primerClear' && e.reason === 'expired')).toBe(true);
  });
  it('real rail consumes once and awards only the capped extra damage', () => {
    const { w, a, b } = setup(); blast(w, b); tick(w, 21);
    const hp = b.hp; shoot(w, a);
    expect(hp - b.hp).toBe(Math.round(a.lo.gun.damage * DAMAGE_SCALE + comboBonus(a.lo.gun.damage * DAMAGE_SCALE)));
    expect(b.primer).toBeNull(); expect(a.stats.combos).toBe(1);
    expect(w.events.filter(e => e.type === 'combo')).toHaveLength(1);
    expect(a.stats.comboDamage).toBeLessThanOrEqual(18);
  });
  it('early precision damage does not consume the unarmed setup', () => {
    const { w, a, b } = setup(); blast(w, b); shoot(w, a);
    expect(b.primer).not.toBeNull(); expect(a.stats.combos).toBe(0);
  });
  it('beam requires75% power; pulse, turret and returned rounds cannot detonate', () => {
    const { a } = setup('beam');
    expect(gunShotSpec(a, 0.74).comboDetonator).toBe(false);
    expect(gunShotSpec(a, 0.75).comboDetonator).toBe(true);
    expect(gunShotSpec(setup('pulse').a).comboDetonator).toBe(false);
    const s = setup(); blast(s.w, s.b); tick(s.w, 21); shoot(s.w, s.a, true);
    expect(s.a.stats.combos).toBe(0); expect(s.b.primer).not.toBeNull();
  });
  it('knockdown keeps its normal damage plus a separately capped18HP payoff', () => {
    const { b } = setup(); b.prime(0); b.primer!.armed = true; b.down = b.endurance - 1;
    const r = b.takeHit(hit({ damage: 120, down: 1, comboBonus: 18 }));
    expect(r.damage).toBe(168); expect(r.comboBonus).toBe(18); expect(r.knockdown).toBe(true);
    expect(b.primer).toBeNull();
  });
  it('partial shield mitigation also reduces bonus, rather than amplifying tiny penetration', () => {
    const { b } = setup(); b.prime(0); b.primer!.armed = true; b.buffs.shield = 100;
    const r = b.takeHit(hit({ damage: 120, comboBonus: 18 }));
    expect(r.damage).toBe(23); expect(r.comboBonus).toBe(3);
  });
  it('bonus adds no down, velocity or stagger compared with the same ordinary impact', () => {
    const a = setup().b, b = setup().b; b.prime(0); b.primer!.armed = true;
    a.takeHit(hit()); b.takeHit(hit({ comboBonus: 30 }));
    expect(b.down).toBe(a.down); expect(b.mode).toBe(a.mode); expect(b.vel.toArray()).toEqual(a.vel.toArray());
  });
  for (const defense of ['parry', 'guard', 'dodge', 'shield'] as const) it(`${defense} denies combo damage`, () => {
    const { b } = setup(); b.prime(0); b.primer!.armed = true;
    if (defense === 'dodge') b.perfectDodge();
    else if (defense === 'shield') b.buffs.shield = 200;
    else { b.setMode('charge'); b.chargePhase = defense === 'parry' ? 0 : 1; }
    const r = b.takeHit(hit({ comboBonus: 30 }));
    expect(r.comboDetonated).not.toBe(true);
    if (defense !== 'shield') expect(b.primer).toBeNull();
  });
  it('frontal projectile deflection clears setup before the fallback damage path', () => {
    const { w, a, b } = setup(); b.prime(0); b.primer!.armed = true;
    b.setMode('charge'); b.chargePhase = 1; shoot(w, a);
    expect(b.primer).toBeNull(); expect(w.events.some(e => e.type === 'deflect')).toBe(true);
    expect(a.stats.combos).toBe(0);
  });
  it('blocked, absorbed, lethal and knockdown utility impacts cannot prime', () => {
    for (const condition of ['blocked', 'absorbed', 'lethal', 'down'] as const) {
      const { w, b } = setup();
      if (condition === 'blocked') { b.setMode('charge'); b.chargePhase = 1; }
      if (condition === 'absorbed') b.buffs.shield = 100;
      if (condition === 'lethal') b.hp = 1;
      if (condition === 'down') b.down = b.endurance;
      blast(w, b); expect(b.primer).toBeNull();
    }
  });
  it('shot-down and chain pod blasts are excluded; ordinary pod blast primes', () => {
    for (const shotDown of [true, false]) {
      const { w, b } = setup();
      const pod = { alive: true, pos: b.chestPoint(), owner: 0, def: { ...PODS.seeker, damage: 20, down: 0 } };
      (w as any).detonatePod(pod, shotDown);
      expect(!!b.primer).toBe(!shotDown);
    }
  });
  it('down, death, getup and a new world clear status', () => {
    for (const mode of ['down', 'getup'] as const) { const { b } = setup(); b.prime(0); b.setMode(mode); expect(b.primer).toBeNull(); }
    const { w, a, b } = setup(); b.prime(0); b.hp = 1; b.takeHit(hit()); expect(b.primer).toBeNull();
    a.prime(1); new World(w.arena, a, b); expect(a.primer).toBeNull();
  });
  it('lethal combo uses one ordinary KO attribution and one damage event', () => {
    const { w, a, b } = setup(); b.prime(0); b.primer!.armed = true; b.hp = 110;
    w.applyHit(b, 0, hit({ damage: 100 / DAMAGE_SCALE, comboBonus: 30 }), b.chestPoint(), 0xffffff);
    expect(b.hp).toBe(0); expect(w.koLoser).toBe(1); expect(a.stats.combos).toBe(1);
    expect(w.events.filter(e => e.type === 'ko')).toHaveLength(1);
    expect(w.events.filter(e => e.type === 'hit')).toHaveLength(1);
  });
  it('AI uses delayed primer observations rather than reacting to a new mark immediately', () => {
    const { w, a, b } = setup();
    const ai = new AIPilot('champion', 1);
    a.gunCd = 1; // setup is allowed during a real reload, never instead of a ready shot
    // Build observation history before the first decision gate.
    for (let i = 0; i < 59; i++) { w.time = i / 60; ai.think(w, a, b); }
    b.prime(0); b.primer!.armed = true;
    w.time = 59 / 60;
    const immediate = ai.think(w, a, b);
    expect(immediate.podPressed || immediate.bombPressed).toBe(true);
    expect(immediate.gunPressed).toBe(false);
    a.gunCd = 0;
    let fired = false;
    for (let i = 60; i < 90; i++) { w.time = i / 60; fired ||= ai.think(w, a, b).gunPressed; }
    expect(fired).toBe(true);
  });
});
