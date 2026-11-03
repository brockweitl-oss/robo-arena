import { describe, it, expect, beforeEach } from 'vitest';
import { emptyInput } from '../../src/game/fighter';
import { quantizeInput, saveReplay, loadReplays, RULESET_VERSION, InputRecorder, type Replay } from '../../src/game/replay';
import { encodeInput, decodeInput, sanitizeHello, sanitizeStart } from '../../src/net/online';
import { sameInput } from '../../src/net/rollback';
import { migrateSave, loadSave, writeSave, defaultSave } from '../../src/core/save';
import { DEFAULT_LOADOUT } from '../../src/data/parts';
import { PLAYER_PAINT } from '../../src/data/characters';

/** Minimal Storage with an optional byte quota (throws like a full browser store). */
class MemStorage {
  data = new Map<string, string>();
  constructor(public quota = Infinity) {}
  get used() { let n = 0; for (const [k, v] of this.data) n += k.length + v.length; return n; }
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) {
    const prev = this.data.get(k);
    if (this.used - (prev ? k.length + prev.length : 0) + k.length + v.length > this.quota) throw new DOMException('full', 'QuotaExceededError');
    this.data.set(k, String(v));
  }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}
const g = globalThis as unknown as { localStorage: MemStorage };

describe('relayed input decoding (untrusted)', () => {
  it('round-trips honest quantized inputs exactly', () => {
    const i = quantizeInput({ ...emptyInput(), moveX: 0.73, moveZ: -1, gunHeld: true, gunPressed: true, faceTarget: true, bombPressed: true, bombTarget: [3.1, 0.2, -7.77], skillPressed: true, skillTarget: [1, 2, 3] });
    const back = decodeInput(JSON.parse(JSON.stringify(encodeInput(i))));
    expect(sameInput(back, i)).toBe(true);
    expect(back.moveX).toBe(i.moveX);
  });

  it('clamps doctored values instead of letting them drive the sim', () => {
    const d = decodeInput({ moveX: 5, moveZ: 'x', gunHeld: 1, dashPressed: 'yes', jumpPressed: true, bombTarget: [1e9, NaN, 0], skillTarget: [1, 2, 3], hp: 9999 } as unknown as Record<string, unknown>);
    expect(d.moveX).toBe(1);
    expect(d.moveZ).toBe(0);
    expect(d.gunHeld).toBe(false);
    expect(d.dashPressed).toBe(false);
    expect(d.jumpPressed).toBe(true);
    expect(d.bombTarget).toBeUndefined();
    // a skill target without the press is dropped (quantizeInput does the same)
    expect(d.skillTarget).toBeUndefined();
    expect(Object.keys(d)).not.toContain('hp');
    expect(decodeInput(null as unknown as Record<string, unknown>)).toEqual(emptyInput());
  });

  it('cleans hostile builds in peer hellos and start messages', () => {
    const h = sanitizeHello({ name: '<b>x</b>'.repeat(5), loadout: { gun: 'constructor', bomb: '__proto__', body: 'striker', legs: 7 }, paint: { primary: 'red', glow: 0x112233, wear: 9, finish: 'gold' }, arena: { x: 1 }, rating: 'high', ranked: true });
    expect(h.loadout).toEqual({ ...DEFAULT_LOADOUT, body: 'striker' });
    expect(h.paint.primary).toBe(PLAYER_PAINT.primary);
    expect(h.paint.glow).toBe(0x112233);
    expect(h.paint.wear).toBe(1);
    expect(h.paint.finish).toBeUndefined();
    expect(h.name.length).toBeLessThanOrEqual(16);
    expect(h.name).not.toMatch(/[<>]/);
    expect(h.arena).toBeUndefined();
    expect(h.rating).toBeUndefined();
    expect(h.ranked).toBe(true);
    const st = sanitizeStart({ t: 'start', seed: 'x', players: [null] });
    expect(st.players).toHaveLength(2);
    expect(st.players[1].loadout).toEqual(DEFAULT_LOADOUT);
    expect(st.seed).toBe(1);
    // an honest hello passes unchanged
    const honest = { name: 'Ace', loadout: { ...DEFAULT_LOADOUT }, paint: { ...PLAYER_PAINT }, arena: 'foundry', rating: 1100 };
    expect(sanitizeHello(honest)).toEqual(honest);
  });
});

describe('save robustness', () => {
  beforeEach(() => { g.localStorage = new MemStorage(); });

  it('types and ranges every setting', () => {
    const s = migrateSave({ settings: { master: 'loud', sfx: 7, music: -1, sensitivity: NaN, quality: 'ultra', invertY: 'yes', cameraShake: true } });
    expect(s.settings.master).toBe(defaultSave().settings.master);
    expect(s.settings.sfx).toBe(1);
    expect(s.settings.music).toBe(0);
    expect(s.settings.sensitivity).toBe(1);
    expect(s.settings.quality).toBe('medium');
    expect(s.settings.invertY).toBe(false);
    expect(s.settings.cameraShake).toBe(true);
  });

  it('keeps a copy of an unreadable save before it is overwritten', () => {
    g.localStorage.setItem('robo-arena-save-v1', '{"credits": 900, "unlo');
    const s = loadSave();
    expect(s.credits).toBe(0);
    writeSave(s);
    expect(g.localStorage.getItem('robo-arena-save-corrupt')).toBe('{"credits": 900, "unlo');
  });

  it('frees replays and the telemetry mirror when storage is full, so progress still saves', () => {
    const save = defaultSave();
    save.credits = 1234;
    const size = JSON.stringify(save).length;
    g.localStorage = new MemStorage(size + 40_000);
    g.localStorage.setItem('robo-arena-replays', 'x'.repeat(30_000));
    g.localStorage.setItem('robo-arena-telemetry', 'y'.repeat(9_000));
    expect(writeSave(save)).toBe(true);
    expect(JSON.parse(g.localStorage.getItem('robo-arena-save-v1')!).credits).toBe(1234);
  });
});

describe('local replay list', () => {
  beforeEach(() => { g.localStorage = new MemStorage(); });

  const mk = (seed: number, frames = 600): Replay => {
    const rec = new InputRecorder();
    for (let i = 0; i < frames; i++) rec.push(quantizeInput({ ...emptyInput(), moveX: (i % 50) / 50 }));
    return {
      v: 1, rulesVersion: RULESET_VERSION, worldSeed: seed, aiSeed: 7, frames, date: new Date(1700000000000 + seed * 1000).toISOString(), aimAssist: 1,
      streams: [rec.encode()], config: { mode: 'free', rivalId: 'dex', arenaId: 'foundry', playerLoadout: { ...DEFAULT_LOADOUT } } as unknown as Replay['config'],
    };
  };

  it('drops unplayable old-version entries and duplicates, newest first', () => {
    g.localStorage.setItem('robo-arena-replays', JSON.stringify([{ ...mk(1), rulesVersion: 1 }, mk(2)]));
    saveReplay(mk(3));
    saveReplay(mk(3));
    const raw = JSON.parse(g.localStorage.getItem('robo-arena-replays')!);
    expect(raw.map((r: Replay) => r.worldSeed)).toEqual([3, 2]);
    expect(loadReplays()).toHaveLength(2);
  });

  it('drops the oldest until the newest fits a full store', () => {
    const one = JSON.stringify(mk(1)).length;
    g.localStorage = new MemStorage(one * 3.5);
    for (let s = 1; s <= 6; s++) saveReplay(mk(s));
    const list = loadReplays();
    expect(list[0].worldSeed).toBe(6);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.length).toBeLessThanOrEqual(3);
  });

  it('survives a corrupt list', () => {
    g.localStorage.setItem('robo-arena-replays', '{oops');
    saveReplay(mk(9));
    expect(loadReplays().map((r) => r.worldSeed)).toEqual([9]);
  });
});
