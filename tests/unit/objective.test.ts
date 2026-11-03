import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Fighter, emptyInput, type FighterInput } from '../../src/game/fighter';
import { World, SIM_DT, type GameEvent } from '../../src/game/world';
import { AIPilot } from '../../src/game/ai';
import { OBJECTIVE, TACTICS, WALL, CRATE } from '../../src/game/tactics';
import { InputRecorder, InputPlayer, quantizeInput } from '../../src/game/replay';
import { objectiveEnabled } from '../../src/game/types';
import { DEFAULT_LOADOUT, resolveLoadout, type Loadout } from '../../src/data/parts';
import type { ArenaBuild, Collider } from '../../src/arena/types';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider => ({ kind: 'box', min: V(x0, y0, z0), max: V(x1, y1, z1) });

function arena(id = 'test', extra: Collider[] = []): ArenaBuild {
  return {
    info: { id, name: id, subtitle: '', blurb: '', music: 'menu', accent: '#fff' },
    root: new THREE.Group(), colliders: [box(-30, -1, -30, 30, 0, 30), ...extra], hazards: [], spawns: [V(0, 0, 11), V(0, 0, -11)],
    halfX: 18, halfZ: 18, background: new THREE.Color(), environment: null, fog: null, keyLight: new THREE.DirectionalLight(),
    tick() {}, update() {}, dispose() {},
  };
}

function setup(opts: { objective?: boolean; arenaId?: string; a?: Partial<Loadout>; b?: Partial<Loadout> } = {}) {
  const a = new Fighter(0, resolveLoadout({ ...DEFAULT_LOADOUT, ...opts.a }));
  const b = new Fighter(1, resolveLoadout({ ...DEFAULT_LOADOUT, ...opts.b }));
  const ar = arena(opts.arenaId);
  a.pos.copy(ar.spawns[0]);
  b.pos.copy(ar.spawns[1]);
  b.yaw = Math.PI;
  const w = new World(ar, a, b, { arenaId: opts.arenaId, objective: opts.objective ?? true, seed: 99 });
  w.combatEnabled = true;
  return { w, a, b };
}

/** Step with idle inputs, collecting objective events. */
function idle(w: World, ticks: number, log: GameEvent[] = []) {
  for (let i = 0; i < ticks; i++) {
    w.step([emptyInput(), emptyInput()]);
    for (const e of w.events) if (e.type === 'objective') log.push(e);
  }
  return log;
}
const sec = (s: number) => Math.round(s / SIM_DT);

describe('Overcharge Core schedule', () => {
  it('warns 5 s early, comes online at 20 s, expires after its window, then follows the fixed schedule', () => {
    const { w } = setup();
    const log: { phase: string; t: number }[] = [];
    for (let i = 0; i < sec(55); i++) {
      w.step([emptyInput(), emptyInput()]);
      for (const e of w.events) if (e.type === 'objective') log.push({ phase: e.phase, t: +(w.objective!.tick * SIM_DT).toFixed(3) });
    }
    expect(log).toEqual([
      { phase: 'warn', t: OBJECTIVE.firstAt - OBJECTIVE.warn },
      { phase: 'online', t: OBJECTIVE.firstAt },
      { phase: 'expire', t: OBJECTIVE.firstAt + OBJECTIVE.window },
      { phase: 'warn', t: OBJECTIVE.firstAt + OBJECTIVE.interval - OBJECTIVE.warn },
      { phase: 'online', t: OBJECTIVE.firstAt + OBJECTIVE.interval },
    ]);
  });

  it('counts combat time only (the intro does not advance the clock)', () => {
    const { w } = setup();
    w.combatEnabled = false;
    idle(w, sec(30));
    expect(w.objective!.tick).toBe(0);
    expect(w.objectiveIn()).toBeCloseTo(OBJECTIVE.firstAt, 5);
  });

  it('is off unless asked for; matches enable it everywhere except practice', () => {
    expect(setup({ objective: false }).w.objective).toBeNull();
    expect(objectiveEnabled({ mode: 'ladder' })).toBe(true);
    expect(objectiveEnabled({ mode: 'online' })).toBe(true);
    expect(objectiveEnabled({ mode: 'versus' })).toBe(true);
    expect(objectiveEnabled({ mode: 'practice' })).toBe(false);
    expect(objectiveEnabled({ mode: 'free', objective: false })).toBe(false);
    expect(objectiveEnabled({ mode: 'replay', objective: false })).toBe(false);
  });
});

describe('Overcharge Core capture', () => {
  const online = () => {
    const s = setup();
    idle(s.w, sec(OBJECTIVE.firstAt));
    expect(s.w.objective!.untilTick).toBeGreaterThan(0);
    return s;
  };

  it('a lone robot captures in 2.0 s and gets skill ready + Overdrive', () => {
    const { w, a, b } = online();
    a.pos.set(0, 0, 0.5);
    a.skillCd = 5;
    const log = idle(w, sec(OBJECTIVE.capture) - 1);
    expect(log.some(e => e.type === 'objective' && e.phase === 'capture')).toBe(false);
    expect(w.objective!.meters[0]).toBeGreaterThan(OBJECTIVE.capture - 0.05);
    idle(w, 1, log);
    const cap = log.find(e => e.type === 'objective' && e.phase === 'capture');
    expect(cap && cap.type === 'objective' && cap.who).toBe(0);
    expect(a.skillCd).toBe(0);
    expect(a.buffs.overdrive).toBeCloseTo(OBJECTIVE.overdrive, 5);
    expect(a.damageMul).toBeGreaterThan(1);
    expect(a.stats.captures).toBe(1);
    expect(b.buffs.overdrive).toBe(0);
    // captured: offline until the next scheduled activation, meters reset
    expect(w.objective!.untilTick).toBe(-1);
    expect(w.objective!.meters).toEqual([0, 0]);
    expect(w.objectiveIn()).toBeCloseTo(OBJECTIVE.firstAt + OBJECTIVE.interval - w.objective!.tick * SIM_DT, 5);
  });

  it('contested = both meters frozen; the leaver loses ground', () => {
    const { w, a, b } = online();
    a.pos.set(0, 0, 0.8);
    idle(w, sec(1));
    const m = w.objective!.meters[0];
    expect(m).toBeCloseTo(1, 5);
    b.pos.set(0, 0, -0.8);
    idle(w, sec(3));
    expect(w.objective!.contested).toBe(true);
    expect(w.objective!.meters[0]).toBe(m);
    expect(w.objective!.meters[1]).toBe(0);
    // B leaves: A resumes and finishes the remaining second
    b.pos.set(0, 0, -10);
    const log = idle(w, sec(1) + 1);
    expect(log.some(e => e.type === 'objective' && e.phase === 'capture' && e.who === 0)).toBe(true);
  });

  it('progress decays slowly off the pad', () => {
    const { w, a } = online();
    a.pos.set(0, 0, 0.5);
    idle(w, sec(1.5));
    a.pos.set(0, 0, 8);
    idle(w, sec(1));
    expect(w.objective!.meters[0]).toBeCloseTo(1.5 - OBJECTIVE.decay, 5);
    idle(w, sec(5));
    expect(w.objective!.meters[0]).toBe(0);
  });

  it('a knocked-down robot neither captures nor contests', () => {
    const { w, a, b } = online();
    a.pos.set(0, 0, 0.5);
    b.pos.set(0, 0, -0.5);
    b.setMode('down');
    idle(w, 2);
    expect(w.onObjective(b)).toBe(false);
    expect(w.objective!.contested).toBe(false);
    expect(w.objective!.meters[0]).toBeGreaterThan(0);
  });

  it('nobody standing on it: expires with no reward', () => {
    const { w, a, b } = online();
    const log = idle(w, sec(OBJECTIVE.window) + 1);
    expect(log.map(e => e.type === 'objective' && e.phase)).toEqual(['expire']);
    expect(a.buffs.overdrive + b.buffs.overdrive).toBe(0);
  });
});

describe('Overcharge Core determinism and replays', () => {
  const fight = (seconds: number, inputs?: (i: number, w: World, a: Fighter, b: Fighter) => FighterInput) => {
    const { w, a, b } = setup({ arenaId: 'hangar', b: { gun: 'rail', legs: 'sprint' } });
    const ia = new AIPilot('champion', 0.8, 3);
    const ib = new AIPilot('duelist', 0.8, 5);
    const events: string[] = [];
    for (let i = 0; i < sec(seconds) && w.koLoser < 0; i++) {
      const pa = inputs ? inputs(i, w, a, b) : ia.think(w, a, b);
      w.step([pa, ib.think(w, b, a)]);
      for (const e of w.events) if (e.type === 'objective') events.push(`${w.objective!.tick}:${e.phase}:${e.who}`);
    }
    return { state: [a.pos.toArray(), b.pos.toArray(), a.hp, b.hp, a.stats.captures, b.stats.captures, w.objective!.meters.slice(), w.time], events };
  };

  it('two worlds with the same inputs stay identical (AI contests the core)', () => {
    const x = fight(90), y = fight(90);
    expect(y).toEqual(x);
    expect(x.events.some(e => e.includes(':online:'))).toBe(true);
    // the AI actually fights over it: at least one activation is captured rather than expiring
    expect(x.events.filter(e => e.includes(':capture:')).length).toBeGreaterThan(0);
  });

  it('a recorded match with captures plays back exactly', () => {
    const rec = new InputRecorder();
    const pilot = new AIPilot('champion', 0.8, 3);
    const original = fight(90, (_i, w, a, b) => {
      const inp = quantizeInput({ ...pilot.think(w, a, b) });
      rec.push(inp);
      return inp;
    });
    const player = new InputPlayer(rec.encode());
    const replayed = fight(90, () => player.next());
    expect(original.events.filter(e => e.includes(':capture:')).length).toBeGreaterThan(0);
    expect(replayed).toEqual(original);
  });
});

describe('breakable cover', () => {
  it('every arena layout has two point-symmetric barricades and a core point', () => {
    for (const [id, lay] of Object.entries(TACTICS)) {
      expect(lay.walls?.length, id).toBe(2);
      const [[x0, z0], [x1, z1]] = lay.walls!;
      expect([x0 + x1, z0 + z1], id).toEqual([0, 0]);
      expect(lay.objective, id).toBeDefined();
    }
  });

  it('barricades collide exactly at their visual size, take more hits than crates and stay broken', () => {
    const { w } = setup({ arenaId: 'hangar' });
    const walls = w.crates.filter(c => c.kind === 'wall');
    expect(walls).toHaveLength(2);
    const c = walls[0];
    expect(c.collider.max.clone().sub(c.collider.min).toArray().map(v => +v.toFixed(6))).toEqual([WALL.w, WALL.h, WALL.d]);
    expect(c.hp).toBeGreaterThan(CRATE.hp);
    const n = w.colliders.length;
    (w as any).damageCrate(c, c.hp + 1, c.pos);
    expect(c.alive).toBe(false);
    expect(w.colliders.length).toBe(n - 1);
    expect(w.colliders.includes(c.collider)).toBe(false);
    idle(w, sec(60));
    expect(c.alive).toBe(false);
    expect(w.colliders.includes(c.collider)).toBe(false);
  });

  it('a blast next to the end of a long wall still damages it', () => {
    const { w } = setup({ arenaId: 'hangar' });
    const c = w.crates.find(k => k.kind === 'wall')!;
    const end = V(c.collider.max.x + 0.5, c.pos.y + 0.5, c.pos.z);
    (w as any).explode(end, 0, 50, 0, 1.0, 0xffffff, false, 'bomb');
    expect(c.hp).toBeLessThan(c.maxHp);
  });
});
