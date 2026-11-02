/**
 * Build share codes: loadout + paint packed into a short URL-safe string.
 *
 * Layout (bytes, then base64url without padding, prefixed "RA-"):
 *   [0]      version (1)
 *   [1..5]   part index per slot (gun, bomb, pod, body, legs) in catalog insertion order
 *            (new parts must be APPENDED to the catalog so old codes keep decoding)
 *   [6..20]  primary, secondary, trim, dark, glow (3 bytes each, RGB)
 *   [21]     flags: bit0 = trail color present
 *   [22..24] trail color (only when flag bit0)
 *   [n]      emblem length (0..3), then emblem bytes (printable ASCII)
 *   [last 2] CRC-16/CCITT of everything before it
 *
 * Decoding is strict: a code must re-encode to exactly itself, so any corruption
 * (bad checksum, unknown part, junk characters, wrong length) is rejected.
 */
import { ALL_PARTS, type Loadout, type Slot } from './parts';
import type { Paint } from './characters';

export const BUILD_CODE_VERSION = 1;
const PREFIX = 'RA-';
const SLOT_ORDER: Slot[] = ['gun', 'bomb', 'pod', 'body', 'legs'];
const COLORS = ['primary', 'secondary', 'trim', 'dark', 'glow'] as const;

export interface Build {
  loadout: Loadout;
  paint: Paint;
}

export type DecodeResult = { ok: true; build: Build } | { ok: false; error: string };

export function crc16(bytes: ArrayLike<number>, len = bytes.length): number {
  let crc = 0xffff;
  for (let i = 0; i < len; i++) {
    crc ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function toB64url(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 2 < bytes.length ? 4 : i + 1 < bytes.length ? 3 : 2;
    for (let k = 0; k < chars; k++) out += B64[(n >> (18 - 6 * k)) & 63];
  }
  return out;
}
function fromB64url(s: string): number[] | null {
  if (s.length % 4 === 1) return null;
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const chunk = s.slice(i, i + 4);
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const c = chunk[k];
      const v = c === undefined ? 0 : B64.indexOf(c);
      if (v < 0) return null;
      n |= v << (18 - 6 * k);
    }
    out.push((n >> 16) & 255);
    if (chunk.length > 2) out.push((n >> 8) & 255);
    if (chunk.length > 3) out.push(n & 255);
  }
  return out;
}

const partIds = (slot: Slot) => Object.keys(ALL_PARTS[slot]);

export function encodeBuild(loadout: Loadout, paint: Paint): string {
  const bytes: number[] = [BUILD_CODE_VERSION];
  for (const s of SLOT_ORDER) bytes.push(Math.max(0, partIds(s).indexOf(loadout[s])));
  for (const k of COLORS) {
    const c = paint[k] >>> 0;
    bytes.push((c >> 16) & 255, (c >> 8) & 255, c & 255);
  }
  const hasTrail = typeof paint.trail === 'number';
  bytes.push(hasTrail ? 1 : 0);
  if (hasTrail) {
    const t = paint.trail! >>> 0;
    bytes.push((t >> 16) & 255, (t >> 8) & 255, t & 255);
  }
  const em = [...(paint.emblem ?? '')].filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 127).slice(0, 3);
  bytes.push(em.length, ...em.map((ch) => ch.charCodeAt(0)));
  const crc = crc16(bytes);
  bytes.push(crc >> 8, crc & 255);
  return PREFIX + toB64url(bytes);
}

export function decodeBuild(code: string): DecodeResult {
  const raw = code.trim();
  if (!raw.toUpperCase().startsWith(PREFIX)) return { ok: false, error: 'Not a Robo Arena build code.' };
  const body = raw.slice(PREFIX.length);
  const bytes = fromB64url(body);
  if (!bytes || bytes.length < 25) return { ok: false, error: 'Code is too short or has invalid characters.' };
  const crc = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
  if (crc16(bytes, bytes.length - 2) !== crc) return { ok: false, error: 'Checksum mismatch — the code is damaged.' };
  if (bytes[0] !== BUILD_CODE_VERSION) return { ok: false, error: `Unsupported code version ${bytes[0]}.` };
  let i = 1;
  const loadout = {} as Loadout;
  for (const s of SLOT_ORDER) {
    const id = partIds(s)[bytes[i++]];
    if (!id) return { ok: false, error: `Unknown ${s} part in code.` };
    loadout[s] = id;
  }
  const paint = { emblem: '' } as Paint;
  for (const k of COLORS) {
    paint[k] = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    i += 3;
  }
  const flags = bytes[i++];
  if (flags & ~1) return { ok: false, error: 'Unknown flags in code.' };
  if (flags & 1) {
    paint.trail = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    i += 3;
  }
  const n = bytes[i++];
  if (n === undefined || n > 3 || i + n !== bytes.length - 2) return { ok: false, error: 'Code length is wrong.' };
  paint.emblem = String.fromCharCode(...bytes.slice(i, i + n));
  const build = { loadout, paint };
  // strict: the code must be canonical (rejects altered padding bits etc.)
  if (encodeBuild(loadout, paint) !== PREFIX + body) return { ok: false, error: 'Code is not canonical — the code is damaged.' };
  return { ok: true, build };
}

/**
 * Merge an imported build into the player's current loadout, keeping the current part for
 * every slot whose imported part is locked. Returns the new loadout and the locked part keys.
 */
export function applyImportedLoadout(current: Loadout, imported: Loadout, unlocked: string[]): { loadout: Loadout; locked: string[] } {
  const loadout = { ...current };
  const locked: string[] = [];
  for (const s of SLOT_ORDER) {
    const key = `${s}:${imported[s]}`;
    if (ALL_PARTS[s][imported[s]] && unlocked.includes(key)) loadout[s] = imported[s];
    else locked.push(key);
  }
  return { loadout, locked };
}
