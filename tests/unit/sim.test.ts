import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { moveAndCollide, rampHeight, segmentHit, surfaceAt } from '../../src/game/collision';
import { Fighter, emptyInput, type FighterInput } from '../../src/game/fighter';
import { World, SIM_DT } from '../../src/game/world';
import { resolveLoadout, DEFAULT_LOADOUT, GUNS, BOMBS, PODS, BODIES, LEGS } from '../../src/data/parts';
import type { ArenaBuild, Collider } from '../../src/arena/types';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const floor: Collider = { kind: 'box', min: V(-30, -1, -30), max: V(30, 0, 30) };

function testArena(extra: Collider[] = []): ArenaBuild {
  return {
    info: { id: 't', name: 't', subtitle: '', blurb: '', music: 'menu', accent: '#fff' },
    root: new THREE.Group(), colliders: [floor, ...extra], hazards: [], spawns: [V(0, 0, 8), V(0, 0, -8)],
    halfX: 18, halfZ: 18, background: new THREE.Color(), environment: null, fog: null, keyLight: new THREE.DirectionalLight(),
    tick() {}, update() {}, dispose() {},
  };
}

function makeWorld(extra: Collider[] = []) {
  const a = new Fighter(0, resolveLoadout(DEFAULT_LOADOUT));
  const b = new Fighter(1, resolveLoadout(DEFAULT_LOADOUT));
  a.pos.set(0, 0, 8);
  b.pos.set(0, 0, -8);
  const w = new World(testArena(extra), a, b);
  w.combatEnabled = true;
  return { w, a, b };
}

const run = (w: World, n: number, ia: Partial<FighterInput> = {}, ib: Partial<FighterInput> = {}) => {
  for (let i = 0; i < n; i++) w.step([{ ...emptyInput(), ...ia }, { ...emptyInput(), ...ib }]);
};

describe('collision', () => {
  it('lands on the floor and reports grounded', () => {
    const p = V(0, 3, 0);
    const v = V(0, 0, 0);
    let grounded = false;
    for (let i = 0; i < 120 && !grounded; i++) {
      v.y -= 34 * SIM_DT;
      grounded = moveAndCollide(p, v, SIM_DT, 0.5, 2, [floor], false, 18, 18).grounded;
    }
    expect(grounded).toBe(true);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it('blocks walking through a tall box', () => {
    const wall: Collider = { kind: 'box', min: V(-2, 0, 2), max: V(2, 3, 3) };
    const p = V(0, 0, 0);
    for (let i = 0; i < 60; i++) moveAndCollide(p, V(0, 0, 10), SIM_DT, 0.5, 2, [floor, wall], true, 18, 18);
    expect(p.z).toBeLessThanOrEqual(1.5 + 1e-6);
  });

  it('walks up a ramp', () => {
    const ramp: Collider = { kind: 'ramp', min: V(-2, 0, 2), max: V(2, 3, 8), axis: 'z', dir: 1 };
    expect(rampHeight(ramp as any, 0, 5)).toBeCloseTo(1.5);
    const p = V(0, 0, 0);
    let g = true;
    for (let i = 0; i < 70; i++) g = moveAndCollide(p, V(0, -1, 8), SIM_DT, 0.5, 2, [floor, ramp], g, 18, 18).grounded;
    expect(p.z).toBeGreaterThan(6);
    expect(p.y).toBeGreaterThan(2);
  });

  it('clamps to arena bounds', () => {
    const p = V(17.9, 0, 0);
    moveAndCollide(p, V(50, 0, 0), SIM_DT, 0.5, 2, [floor], true, 18, 18);
    expect(p.x).toBeLessThanOrEqual(17.5);
  });

  it('segment hits a box with the right normal', () => {
    const box: Collider = { kind: 'box', min: V(-1, 0, -1), max: V(1, 2, 1) };
    const h = segmentHit(V(0, 1, 5), V(0, 1, -5), [box]);
    expect(h).not.toBeNull();
    expect(h!.point.z).toBeCloseTo(1);
    expect(h!.normal.z).toBe(1);
    expect(surfaceAt(box, 0, 0)).toBe(2);
  });
});

describe('fighter', () => {
  it('jumps, double-jumps and lands', () => {
    const { w, a } = makeWorld();
    run(w, 2);
    expect(a.grounded).toBe(true);
    run(w, 1, { jumpPressed: true, jumpHeld: true });
    expect(a.grounded).toBe(false);
    run(w, 15);
    const y1 = a.pos.y;
    run(w, 1, { jumpPressed: true });
    run(w, 10);
    expect(a.pos.y).toBeGreaterThan(y1);
    run(w, 120);
    expect(a.grounded).toBe(true);
    expect(a.mode).toBe('ground');
  });

  it('buffers a jump pressed just before landing', () => {
    const { w, a } = makeWorld();
    a.pos.y = 0.4;
    a.grounded = false;
    a.setMode('air');
    run(w, 1, { jumpPressed: true });
    run(w, 8);
    expect(a.vel.y).toBeGreaterThan(0);
  });

  it('dashes faster than running', () => {
    const { w, a } = makeWorld();
    run(w, 1, { moveX: 1, dashPressed: true });
    expect(a.mode).toBe('dash');
    expect(Math.abs(a.vel.x)).toBeGreaterThan(a.runSpeed * 1.5);
  });

  it('knocks down when the down gauge fills, then is invulnerable', () => {
    const { a } = makeWorld();
    const dir = V(0, 0, -1);
    let knocked = false;
    for (let i = 0; i < 10 && a.mode !== 'down'; i++) {
      a.hitstop = 0;
      knocked = a.takeHit({ damage: 30, down: 20, dir, knock: 2, heavy: false, source: 'gun' }).knockdown;
    }
    expect(a.mode).toBe('down');
    expect(knocked).toBe(true);
    expect(a.isInvulnerable).toBe(true);
    const hp = a.hp;
    expect(a.takeHit({ damage: 50, down: 10, dir, knock: 2, heavy: false, source: 'gun' }).applied).toBe(false);
    expect(a.hp).toBe(hp);
  });

  it('reports KO at zero HP', () => {
    const { a } = makeWorld();
    const r = a.takeHit({ damage: 99999, down: 0, dir: V(1, 0, 0), knock: 1, heavy: true, source: 'bomb' });
    expect(r.ko).toBe(true);
    expect(a.hp).toBe(0);
  });

  it('allows exactly one grounded knockdown punish without resetting recovery or adding launch', () => {
    const { w, a } = makeWorld();
    const hit = { damage: 40, down: 999, dir: V(1, 0, 0), knock: 10, heavy: true, source: 'gun' as const };
    a.takeHit(hit);
    for (let i = 0; i < 120 && a.isInvulnerable; i++) run(w, 1);
    expect(a.mode).toBe('down'); expect(a.grounded).toBe(true);
    const before = a.snapshot(), hp = a.hp, velocity = a.vel.clone();
    expect(a.takeHit({ ...hit, tick: true, source: 'fire' }).applied).toBe(false);
    expect(a.takeHit({ ...hit, launch: 20 }).damage).toBe(40);
    expect(a.hp).toBe(hp - 40); expect(a.mode).toBe('down'); expect(a.vel).toEqual(velocity);
    expect(a.takeHit(hit).applied).toBe(false);
    a.restore(before);
    expect(a.takeHit(hit).damage).toBe(40); // rollback restores the unused opening
    run(w, 50);
    expect(a.mode).toBe('getup');
    expect(a.takeHit(hit).applied).toBe(false);
  });

  it('one grounded punish can KO without generating a second knockdown', () => {
    const { w, a } = makeWorld();
    const hit = { damage: 20, down: 999, dir: V(1, 0, 0), knock: 2, heavy: true, source: 'gun' as const };
    a.takeHit(hit);
    for (let i = 0; i < 120 && a.isInvulnerable; i++) run(w, 1);
    a.hp = 10;
    const r = a.takeHit(hit);
    expect(r.ko).toBe(true); expect(r.knockdown).toBe(false); expect(a.hp).toBe(0);
  });

  it('deployment timing and collision-safe steering replay identically after rollback', () => {
    const { w, a, b } = makeWorld();
    w.combatEnabled = false;
    for (const f of [a, b]) { f.locked = true; f.launchTick = 0; }
    const before = w.snapshot();
    const deploy = () => {
      for (let i = 0; i < 66; i++) run(w, 1,
        { moveX: 1, jumpPressed: i === 51, gunHeld: true },
        { moveX: -1, jumpPressed: i === 10 || i === 51, gunHeld: true });
      expect(a.stats.shots + b.stats.shots).toBe(0);
      expect(a.launchPerfect).toBe(true); expect(b.launchPerfect).toBe(false);
      expect(a.pos.x).toBeCloseTo(-b.pos.x);
      expect(a.pos.x).toBeLessThan(3);
      a.locked = b.locked = false; w.combatEnabled = true;
      run(w, 1);
      expect(a.recoveryTime).toBe(0); expect(b.recoveryTime).toBeGreaterThan(0.3);
      return w.digest();
    };
    const digest = deploy(); w.restore(before); expect(deploy()).toBe(digest);
  });

  it('a buffered attack cannot hide a robot after deployment completes', () => {
    const { w, a } = makeWorld();
    a.launchTick = 66; a.deployed = false; a.launchPerfect = false;
    run(w, 30, { bombPressed: true });
    expect(a.deployed).toBe(true);
    expect(w.bombs.length).toBeGreaterThan(0);
    expect(a.recoveryTime).toBeGreaterThan(0);
  });
});

describe('new weapon roles', () => {
  const armed = (gun: string) => {
    const a = new Fighter(0, resolveLoadout({ ...DEFAULT_LOADOUT, gun }));
    const b = new Fighter(1, resolveLoadout(DEFAULT_LOADOUT));
    a.pos.set(0, 0, 8); b.pos.set(0, 0, -8);
    const w = new World(testArena(), a, b); w.combatEnabled = true;
    return { w, a, b };
  };
  it('Needle emits four narrow non-homing darts from one committed trigger', () => {
    const { w, a, b } = armed('needle');
    run(w, 1, { gunPressed: true });
    expect(a.attackCommitted).toBe(true);
    run(w, 20); expect(a.stats.shots).toBe(0);
    run(w, 80);
    expect(a.stats.shots).toBe(4); expect(b.hp).toBeLessThan(b.maxHp);
    expect(a.lo.gun.homing).toBe(0); expect(a.lo.gun.radius).toBeLessThan(GUNS.pulse.radius);
  });
  it('Nova rewards holding with a larger, slower, interceptable shot', () => {
    const shot = (ticks: number) => {
      const { w, a } = armed('nova');
      run(w, ticks, { gunPressed: true, gunHeld: true });
      expect(a.stats.shots).toBe(0);
      run(w, 1);
      expect(a.stats.shots).toBe(1);
      return w.projectiles[0].spec;
    };
    const low = shot(25), full = shot(67);
    expect(full.damage).toBeGreaterThan(low.damage); expect(full.radius).toBeGreaterThan(low.radius);
    expect(full.speed).toBeLessThan(GUNS.pulse.speed); expect(full.pierce).toBe(false);
  });
});

describe('world combat', () => {
  it('a gun burst damages the opponent', () => {
    const { w, b } = makeWorld();
    run(w, 1, { gunPressed: true, gunHeld: true });
    run(w, 90);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('cover blocks shots', () => {
    const wall: Collider = { kind: 'box', min: V(-3, 0, -1), max: V(3, 4, 1) };
    const { w, b } = makeWorld([wall]);
    run(w, 1, { gunPressed: true, gunHeld: true });
    run(w, 90);
    expect(b.hp).toBe(b.maxHp);
  });

  it('bombs arc over cover and explode near the target', () => {
    const wall: Collider = { kind: 'box', min: V(-3, 0, -1), max: V(3, 2, 1) };
    const { w, b } = makeWorld([wall]);
    let exploded = false;
    run(w, 1, { bombPressed: true });
    for (let i = 0; i < 150; i++) {
      run(w, 1);
      if (w.events.some((e) => e.type === 'explosion')) exploded = true;
    }
    expect(exploded).toBe(true);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('pods hunt the target', () => {
    const { w, b } = makeWorld();
    run(w, 1, { podPressed: true });
    run(w, 60 * 6);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('is deterministic for identical inputs', () => {
    const go = () => {
      const { w, a, b } = makeWorld();
      for (let i = 0; i < 300; i++)
        w.step([
          { ...emptyInput(), moveX: Math.sin(i * 0.1), gunPressed: i % 40 === 0, gunHeld: true, bombPressed: i === 100 },
          { ...emptyInput(), moveZ: Math.cos(i * 0.07), jumpPressed: i % 70 === 0 },
        ]);
      return [a.pos.toArray(), b.pos.toArray(), a.hp, b.hp];
    };
    expect(go()).toEqual(go());
  });
});

describe('part catalog', () => {
  it('has the required part counts with sane stats', () => {
    expect(Object.keys(GUNS).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(BOMBS).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(PODS).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(BODIES).length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(LEGS).length).toBeGreaterThanOrEqual(1);
    for (const g of Object.values(GUNS)) expect(g.damage * g.burst * g.pellets).toBeGreaterThan(0);
    for (const b of Object.values(BODIES)) expect(b.hp).toBeGreaterThanOrEqual(800);
  });
});

describe('play-test 1 fixes', () => {
  it('emits knockdown events raised during combat', () => {
    const { w, b } = makeWorld();
    b.down = 99;
    let seen = false;
    run(w, 1, { gunPressed: true, gunHeld: true });
    for (let i = 0; i < 90 && !seen; i++) {
      run(w, 1);
      seen = w.events.some((e) => e.type === 'fighter' && e.who === 1 && e.ev.type === 'knockdown');
    }
    expect(seen).toBe(true);
  });

  it('perfect dodge: a dash at the right moment lets shots pass through', () => {
    const { w, a, b } = makeWorld();
    a.pos.set(0, 0, 3);
    b.pos.set(0, 0, -3);
    run(w, 1, {}, { gunPressed: true, gunHeld: true });
    let perfect = false;
    for (let i = 0; i < 40; i++) {
      a.dashIframe = 0.1; // hold the dodge window open
      run(w, 1);
      if (w.events.some((e) => e.type === 'dodge' && e.perfect)) perfect = true;
    }
    expect(perfect).toBe(true);
    expect(a.hp).toBe(a.maxHp);
  });

  it('charge guard deflects frontal shots back at the shooter', () => {
    const { w, a, b } = makeWorld();
    a.pos.set(0, 0, 6);
    b.pos.set(0, 0, -6);
    a.yaw = Math.PI; // face the shooter (-z)
    run(w, 1, { chargePressed: true }, { gunPressed: true, gunHeld: true });
    let deflected = false;
    for (let i = 0; i < 25; i++) {
      run(w, 1);
      if (w.events.some((e) => e.type === 'deflect')) deflected = true;
    }
    expect(deflected).toBe(true);
    expect(a.hp).toBe(a.maxHp);
  });

  it('charge guard turns blast damage into chip damage without flinching', () => {
    const { a } = makeWorld();
    a.yaw = Math.PI; // face the source of the +Z incoming blast
    a.setMode('charge');
    a.chargePhase = 1;
    const r = a.takeHit({ damage: 100, down: 50, dir: new THREE.Vector3(0, 0, 1), knock: 6, heavy: true, source: 'bomb' });
    expect(r.blocked).toBe(true);
    expect(a.hp).toBe(a.maxHp - 30);
    expect(a.mode).toBe('charge');
  });
});

describe('G1 review regressions (Codex, PR #17)', () => {
  it('melee parry: defender takes no damage and the attacker is staggered', () => {
    const { w, a, b } = makeWorld();
    a.pos.set(0, 0, 1.2);
    b.pos.set(0, 0, -0.2);
    a.yaw = Math.PI; // a faces b
    b.yaw = 0;
    // attacker mid-lunge, defender just started its guard (parry window)
    a.setMode('charge');
    a.chargePhase = 1;
    b.setMode('charge');
    b.chargePhase = 0;
    const hp = b.hp;
    run(w, 1);
    expect(b.hp).toBe(hp);
    expect(a.mode).toBe('stagger');
    expect(w.events.some((e) => e.type === 'clash')).toBe(false);
  });

  it('napalm on a raised deck does not burn robots below it', () => {
    const deck: Collider = { kind: 'box', min: V(-4, 0, -4), max: V(4, 3, 4) };
    const { w, a, b } = makeWorld([deck]);
    b.pos.set(0, 0, 6); // ground level, outside the deck but inside the fire radius horizontally
    (w as any).fires.push({ id: 999, owner: 0, pos: V(0, 3, 4.2), radius: 3, until: 10, nextTick: 0, def: { radius: 3, time: 10, tick: 0.5, damage: 20, down: 5 }, color: 0 });
    const hp = b.hp;
    run(w, 40);
    expect(b.hp).toBe(hp);
    void a;
  });

  it('charge beam fired in the air pays the 1.15x air cooldown', () => {
    const lo = { ...DEFAULT_LOADOUT, gun: 'beam' };
    const mk = (air: boolean) => {
      const a = new Fighter(0, resolveLoadout(lo));
      const b = new Fighter(1, resolveLoadout(DEFAULT_LOADOUT));
      a.pos.set(0, air ? 6 : 0, 8);
      b.pos.set(0, 0, -8);
      const w = new World(testArena(), a, b);
      w.combatEnabled = true;
      if (air) { a.grounded = false; a.setMode('air'); }
      w.step([{ ...emptyInput(), gunPressed: true, gunHeld: true }, emptyInput()]);
      for (let i = 0; i < 20; i++) w.step([{ ...emptyInput(), gunHeld: true }, emptyInput()]);
      // release while still airborne
      w.step([emptyInput(), emptyInput()]);
      return a.gunCd;
    };
    const ground = mk(false);
    const air = mk(true);
    expect(air).toBeGreaterThan(ground * 1.1);
  });
});

describe('G5 replays + grades', () => {
  it('a recorded match replays to the identical final state', async () => {
    const { InputRecorder, InputPlayer, quantizeInput } = await import('../../src/game/replay');
    const { AIPilot } = await import('../../src/game/ai');
    const play = (record: InstanceType<typeof InputRecorder> | null, player: InstanceType<typeof InputPlayer> | null) => {
      const a = new Fighter(0, resolveLoadout(DEFAULT_LOADOUT));
      const b = new Fighter(1, resolveLoadout({ ...DEFAULT_LOADOUT, gun: 'homer', legs: 'sprint' }));
      a.pos.set(0, 0, 8);
      b.pos.set(0, 0, -8);
      const w = new World(testArena(), a, b, { seed: 777 });
      w.combatEnabled = true;
      const ai = new AIPilot('duelist', 0.8, 4242);
      for (let i = 0; i < 1200; i++) {
        let pin: FighterInput;
        if (player) pin = player.next();
        else {
          // deterministic pseudo-human input
          pin = { ...emptyInput(), moveX: Math.sin(i * 0.05), moveZ: Math.cos(i * 0.031), jumpPressed: i % 97 === 0, jumpHeld: i % 97 < 20, dashPressed: i % 61 === 0, gunPressed: i % 45 === 0, gunHeld: i % 45 < 5, bombPressed: i % 200 === 50, podPressed: i % 300 === 10, chargePressed: i % 150 === 75, faceTarget: i % 400 < 200 };
          quantizeInput(pin);
          record!.push(pin);
        }
        w.step([pin, ai.think(w, b, a)]);
      }
      return [a.pos.toArray().map((v) => v.toFixed(4)), b.pos.toArray().map((v) => v.toFixed(4)), a.hp, b.hp, w.time.toFixed(3)];
    };
    const rec = new InputRecorder();
    const original = play(rec, null);
    const replayed = play(null, new InputPlayer(rec.encode()));
    expect(replayed).toEqual(original);
  });

  it('grades reward clean, fast wins and cap losses at C', async () => {
    const { gradeMatch } = await import('../../src/game/grades');
    const base = { config: { mode: 'free', playerLoadout: DEFAULT_LOADOUT, rivalId: 'dex', arenaId: 'foundry' } as any, finish: 'ko' as const, playerMaxHp: 1000, rivalHp: 0, rivalMaxHp: 1000 };
    const stats = (o: Partial<{ dodges: number; parries: number; knockdowns: number }>) => ({ damageDealt: 0, hits: 0, knockdowns: o.knockdowns ?? 0, shots: 0, dodges: o.dodges ?? 0, parries: o.parries ?? 0 });
    const great = gradeMatch({ ...base, outcome: 'win', time: 35, playerHp: 950, player: stats({ dodges: 6, parries: 2, knockdowns: 3 }), rival: stats({}) });
    const scrappy = gradeMatch({ ...base, outcome: 'win', time: 115, playerHp: 80, player: stats({}), rival: stats({}) });
    const loss = gradeMatch({ ...base, outcome: 'lose', time: 60, playerHp: 0, player: stats({ dodges: 20 }), rival: stats({ knockdowns: 5 }) });
    expect(great.grade).toBe('S');
    expect(scrappy.grade).toBe('C');
    expect(loss.grade).toBe('C');
  });
});

describe('G5 review regressions (Codex, PR #20)', () => {
  it('rejects malformed or tampered replays', async () => {
    const { validateReplay, InputRecorder, RULESET_VERSION } = await import('../../src/game/replay');
    const rec = new InputRecorder();
    for (let i = 0; i < 120; i++) rec.push({ ...emptyInput(), moveX: i % 2 ? 1 : 0 });
    const good = { v: 1, rulesVersion: RULESET_VERSION, config: { mode: 'free', playerLoadout: { ...DEFAULT_LOADOUT }, rivalId: 'dex', arenaId: 'foundry' }, worldSeed: 5, aiSeed: 9, streams: [rec.encode()], frames: 120, date: new Date().toISOString(), aimAssist: 1 };
    expect(validateReplay(good)).toBe(true);
    expect(validateReplay({ ...good, rulesVersion: 2 })).toBe(false);
    expect(validateReplay({ ...good, rulesVersion: undefined })).toBe(false);
    expect(validateReplay({ v: 1, config: {}, streams: [] })).toBe(false);
    expect(validateReplay({ ...good, streams: ['!!notbase64'] })).toBe(false);
    expect(validateReplay({ ...good, frames: 999999 })).toBe(false);
    expect(validateReplay({ ...good, frames: 500 })).toBe(false); // stream shorter than claimed
    expect(validateReplay({ ...good, config: { ...good.config, rivalId: 'nobody' } })).toBe(false);
    expect(validateReplay({ ...good, config: { ...good.config, playerLoadout: { ...DEFAULT_LOADOUT, gun: 'laser9000' } } })).toBe(false);
    expect(validateReplay({ ...good, worldSeed: -1 })).toBe(false);
    expect(validateReplay({ ...good, aimAssist: 5 })).toBe(false);
  });
});

describe('replay validation hardening (Codex, PR #20 final)', () => {
  it('rejects inherited keys and invalid versus paint', async () => {
    const { validateReplay, InputRecorder, RULESET_VERSION } = await import('../../src/game/replay');
    const mk = () => { const r = new InputRecorder(); for (let i = 0; i < 60; i++) r.push(emptyInput()); return r.encode(); };
    const good = { v: 1, rulesVersion: RULESET_VERSION, config: { mode: 'free', playerLoadout: { ...DEFAULT_LOADOUT }, rivalId: 'dex', arenaId: 'foundry' }, worldSeed: 5, aiSeed: 9, streams: [mk()], frames: 60, date: new Date().toISOString(), aimAssist: 1 };
    expect(validateReplay(good)).toBe(true);
    expect(validateReplay({ ...good, rulesVersion: 2 })).toBe(false);
    expect(validateReplay({ ...good, rulesVersion: undefined })).toBe(false);
    expect(validateReplay({ ...good, config: { ...good.config, arenaId: 'constructor' } })).toBe(false);
    expect(validateReplay({ ...good, config: { ...good.config, playerLoadout: { ...DEFAULT_LOADOUT, gun: 'constructor' } } })).toBe(false);
    const paint = { primary: 1, secondary: 2, trim: 3, dark: 4, glow: 5, emblem: '01' };
    const vs = { ...good, streams: [mk(), mk()], config: { ...good.config, mode: 'versus', versus: { p2Loadout: { ...DEFAULT_LOADOUT }, p2Paint: paint, p2Name: 'P2' } } };
    expect(validateReplay(vs)).toBe(true);
    expect(validateReplay({ ...vs, config: { ...vs.config, versus: { ...vs.config.versus, p2Paint: undefined } } })).toBe(false);
    expect(validateReplay({ ...vs, config: { ...vs.config, versus: { ...vs.config.versus, p2Paint: { ...paint, glow: 'red' } } } })).toBe(false);
  });
});
