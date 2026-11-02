import { describe, expect, it } from 'vitest';
import { defaultSave, migrateSave } from '../../src/core/save';
import { encodeBuild, decodeBuild, crc16 } from '../../src/data/buildcode';
import { DEFAULT_LOADOUT } from '../../src/data/parts';
import { PLAYER_PAINT, type Paint } from '../../src/data/characters';

const custom: Paint = { ...PLAYER_PAINT, finish: 'carbon', wear: 0.45, flame: 0x1199ff, trail: 0xff5511, decal: 'chevron' };
const encodeBytes = (bytes: number[]) => {
  const crc = crc16(bytes); bytes.push(crc >> 8, crc & 255);
  return 'RA-' + btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

describe('garage paint and build slots', () => {
  it('keeps finish, wear, thrusters and decals across saving and loading a preset', () => {
    const save = defaultSave(); save.paint = { ...custom };
    save.presets[3] = { name: 'Carbon pressure build', loadout: { ...save.loadout }, paint: { ...custom } };
    const restored = migrateSave(JSON.parse(JSON.stringify(save)));
    expect(restored.paint).toEqual(custom);
    expect(restored.presets).toEqual(save.presets);
    expect(restored.presets).toHaveLength(5);
  });
  it('repairs invalid paint and prevents saved presets from bypassing part unlocks', () => {
    const restored = migrateSave({ paint: { finish: 'unknown', decal: 'unknown', wear: 5, flame: -1 }, presets: [
      { name: 'x'.repeat(100), loadout: { ...DEFAULT_LOADOUT, gun: 'rail', body: 'constructor' }, paint: custom },
      null, null, null, null, { name: 'excess' },
    ] });
    expect(restored.paint.finish).toBeUndefined(); expect(restored.paint.decal).toBeUndefined();
    expect(restored.paint.wear).toBe(1); expect(restored.paint.flame).toBe(0);
    expect(restored.presets).toHaveLength(5);
    expect(restored.presets[0]?.loadout).toEqual(DEFAULT_LOADOUT);
    expect(restored.presets[0]?.name).toHaveLength(40);
    expect(restored.presets[0]?.paint).toEqual(custom);
  });
  it('adds empty slots when upgrading older saves', () => {
    expect(migrateSave({ version: 1 }).presets).toEqual([null, null, null, null, null]);
  });
});

describe('paint in share codes', () => {
  it('shares all finish-studio fields with the build', () => {
    const result = decodeBuild(encodeBuild(DEFAULT_LOADOUT, custom));
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.build.loadout).toEqual(DEFAULT_LOADOUT); expect(result.build.paint).toEqual(custom); }
  });
  it('continues to import legacy playtest-2 codes', () => {
    const legacy = [1, 0, 0, 0, 0, 0];
    for (const key of ['primary', 'secondary', 'trim', 'dark', 'glow'] as const) {
      const color = PLAYER_PAINT[key]; legacy.push(color >> 16 & 255, color >> 8 & 255, color & 255);
    }
    legacy.push(0, 2, 48, 55);
    const result = decodeBuild(encodeBytes(legacy));
    expect(result).toEqual({ ok: true, build: { loadout: DEFAULT_LOADOUT, paint: PLAYER_PAINT } });
  });
  it('rejects invalid finish bytes even when the checksum is valid', () => {
    const code = encodeBuild(DEFAULT_LOADOUT, { ...PLAYER_PAINT, finish: 'chrome' });
    const raw = code.slice(3).replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Array.from(atob(raw), c => c.charCodeAt(0)).slice(0, -2);
    bytes[22] = 99;
    expect(decodeBuild(encodeBytes(bytes)).ok).toBe(false);
  });
});
