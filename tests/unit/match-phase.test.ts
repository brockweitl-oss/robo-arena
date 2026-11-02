import { describe, it, expect, vi } from 'vitest';
vi.mock('../../src/core/telemetry', () => ({ track: vi.fn() }));
vi.mock('../../src/audio/audio', () => ({ audio: { play: vi.fn() } }));
import { Match } from '../../src/game/match';
import { GUARD_DOT } from '../../src/game/fighter';

describe('match transitions and guard presentation', () => {
  for (const frameSeconds of [1 / 30, 1 / 15, 1 / 10]) {
    it(`enables controls independently of render frame duration ${frameSeconds}`, () => {
      const m = Object.create(Match.prototype) as any;
      m.host = { input: { enabled: false, lastDevice: 'kbm', requestLock: vi.fn() }, hud: { el: { classList: { toggle: vi.fn() } }, announce: vi.fn(), showHint: vi.fn() } };
      m.world = { combatEnabled: false }; m.sides = [{ fighter: { locked: true } }, { fighter: { locked: true } }];
      m.readySteps = 0;
      m.setPhase('ready'); expect(m.host.input.enabled).toBe(true);
      m.phaseT = frameSeconds; m.updatePhase(frameSeconds);
      expect(m.host.input.requestLock).toHaveBeenCalledTimes(1);
      m.readySteps = 66; m.host.input.enabled = false; m.beginSimulationStep();
      expect(m.phase).toBe('fight'); expect(m.host.input.enabled).toBe(true);
      expect(m.sides.every((s: any) => !s.fighter.locked)).toBe(true);
    });
  }
  it('unlocks on tick 67 for both 60fps and 15fps render batches', () => {
    const simulate = (batch: number) => {
      const m = Object.create(Match.prototype) as any;
      m.host = { input: { enabled: false }, hud: { el: { classList: { toggle: vi.fn() } }, announce: vi.fn() } };
      m.world = { combatEnabled: false };
      m.sides = [{ fighter: { locked: true } }, { fighter: { locked: true } }];
      m.phase = 'ready'; m.readySteps = 0; m.phaseT = 0; m.arena = { hazards: [] };
      const combat: boolean[] = [];
      for (let frame = 0; frame < 120 / batch; frame++) {
        m.updatePhase(batch / 60);
        for (let tick = 0; tick < batch; tick++) {
          m.beginSimulationStep();
          combat.push(m.world.combatEnabled);
          if (m.phase === 'ready') m.readySteps++;
        }
      }
      return combat;
    };
    const sixty = simulate(1), fifteen = simulate(4);
    expect(fifteen).toEqual(sixty);
    expect(sixty.indexOf(true)).toBe(66);
  });
  it('all shield vertices lie inside the actual circular forward guard cone', () => {
    const mesh = Match.makeShield(0x37e8ff), pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i) + 0.65;
      expect(z / Math.hypot(x, y, z)).toBeGreaterThanOrEqual(GUARD_DOT - 1e-6);
    }
    mesh.geometry.dispose(); mesh.material.dispose();
  });
});
