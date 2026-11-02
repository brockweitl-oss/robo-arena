/**
 * Cosmetics catalog + the credits shop.
 *
 * Fairness rule: everything here is cosmetic. Nothing changes a stat, and the shop
 * NEVER sells parts. Parts come only from ladder / Rival+ unlocks.
 *
 * Cosmetic sources:
 *  - 'shop':        appears in the rotating daily stock (6 items, re-rolled from the date)
 *  - 'mastery':     granted by part mastery levels (see progression.ts), never sold
 *  - 'achievement': granted by an achievement, never sold
 */
import { ALL_PARTS, type Slot } from './parts';
import type { Paint } from './characters';

export type CosmeticKind = 'paint' | 'decal' | 'pose' | 'trail';

export interface Cosmetic {
  id: string;
  kind: CosmeticKind;
  name: string;
  /** Credits; only meaningful for source 'shop'. */
  price: number;
  source: 'shop' | 'mastery' | 'achievement';
  /** paint: the five zone colors (emblem/trail untouched). */
  paint?: Omit<Paint, 'emblem' | 'trail'>;
  /** decal: emblem text shown on the chest plate (1–3 characters). */
  decal?: string;
  /** trail: dash afterimage color. */
  trail?: number;
  /** pose: victory pose id (animator pose key). */
  pose?: string;
  /** Short flavor line. */
  blurb?: string;
}

export const KIND_LABEL: Record<CosmeticKind, string> = { paint: 'Paint Scheme', decal: 'Emblem Decal', pose: 'Victory Pose', trail: 'Dash Trail' };

const P = (primary: number, secondary: number, trim: number, dark: number, glow: number) => ({ primary, secondary, trim, dark, glow });

const SHOP_ITEMS: Cosmetic[] = [
  // paint schemes
  { id: 'paint:ember', kind: 'paint', name: 'Ember Rush', price: 300, source: 'shop', paint: P(0x2a1c18, 0xff5a1f, 0xffc36a, 0x17110f, 0xff8a3a), blurb: 'Charcoal plate, molten edges.' },
  { id: 'paint:glacier', kind: 'paint', name: 'Glacier', price: 300, source: 'shop', paint: P(0xe8f4ff, 0x5fb8ff, 0x24364f, 0x1a2433, 0x9ff0ff), blurb: 'Clean white armor with ice-blue seams.' },
  { id: 'paint:verdant', kind: 'paint', name: 'Verdant Ops', price: 250, source: 'shop', paint: P(0x3d5a36, 0xc9b27a, 0x1f241c, 0x232a20, 0xb8ff6a), blurb: 'Field green and desert tan.' },
  { id: 'paint:noir', kind: 'paint', name: 'Noir Chrome', price: 450, source: 'shop', paint: P(0x16181d, 0x8a919e, 0xe6e9ef, 0x0d0e11, 0xff2e63), blurb: 'Black steel, crimson eyes.' },
  { id: 'paint:sunset', kind: 'paint', name: 'Boulevard', price: 350, source: 'shop', paint: P(0xff7aa8, 0x6a3cff, 0xffe9a8, 0x2a1b3d, 0x4ef0ff), blurb: 'Neon city pastel.' },
  { id: 'paint:hazard', kind: 'paint', name: 'Hazard Crew', price: 250, source: 'shop', paint: P(0xf2c230, 0x1d1d1f, 0x5b5b60, 0x262628, 0xff9c1a), blurb: 'Industrial yellow and black.' },
  { id: 'paint:royal', kind: 'paint', name: 'Royal Guard', price: 500, source: 'shop', paint: P(0x1c2a6b, 0xd9b04a, 0xf3ead2, 0x111733, 0x7ab6ff), blurb: 'Navy and gold parade armor.' },
  { id: 'paint:toxic', kind: 'paint', name: 'Toxin', price: 350, source: 'shop', paint: P(0x2b2f36, 0x7dff3a, 0x9aa3b0, 0x16191d, 0x7dff3a), blurb: 'Gunmetal with a reactive green glow.' },
  { id: 'paint:sakura', kind: 'paint', name: 'Petal Drift', price: 400, source: 'shop', paint: P(0xf6e8ec, 0xe26d8f, 0x5a3440, 0x2b1d23, 0xffb3cf), blurb: 'Soft white with blossom pink.' },
  { id: 'paint:abyss', kind: 'paint', name: 'Abyssal', price: 600, source: 'shop', paint: P(0x0d2b3a, 0x13c6b3, 0x93fff0, 0x061820, 0x3affd8), blurb: 'Deep-sea teal with bioluminescent trim.' },
  // decals
  { id: 'decal:ace', kind: 'decal', name: 'ACE', price: 200, source: 'shop', decal: 'ACE' },
  { id: 'decal:00', kind: 'decal', name: 'Double Zero', price: 150, source: 'shop', decal: '00' },
  { id: 'decal:77', kind: 'decal', name: 'Lucky 77', price: 150, source: 'shop', decal: '77' },
  { id: 'decal:vx', kind: 'decal', name: 'VX Unit', price: 200, source: 'shop', decal: 'VX' },
  { id: 'decal:zr', kind: 'decal', name: 'Zero-R', price: 200, source: 'shop', decal: 'ZR' },
  { id: 'decal:k9', kind: 'decal', name: 'K9 Squad', price: 250, source: 'shop', decal: 'K9' },
  { id: 'decal:x', kind: 'decal', name: 'Crossmark', price: 150, source: 'shop', decal: 'X' },
  { id: 'decal:99', kind: 'decal', name: 'Ninety-Nine', price: 150, source: 'shop', decal: '99' },
  // victory poses
  { id: 'pose:salute', kind: 'pose', name: 'Salute', price: 350, source: 'shop', pose: 'salute', blurb: 'Crisp and professional.' },
  { id: 'pose:flex', kind: 'pose', name: 'Power Flex', price: 400, source: 'shop', pose: 'flex', blurb: 'Show off the servos.' },
  { id: 'pose:spin', kind: 'pose', name: 'Barrel Spin', price: 450, source: 'shop', pose: 'spin', blurb: 'Twirl the gun, holster it.' },
  { id: 'pose:kneel', kind: 'pose', name: 'Knight Kneel', price: 500, source: 'shop', pose: 'kneel', blurb: 'A gracious winner.' },
  { id: 'pose:point', kind: 'pose', name: 'Call Out', price: 350, source: 'shop', pose: 'point', blurb: 'You. Next.' },
  { id: 'pose:boost', kind: 'pose', name: 'Thruster Hop', price: 600, source: 'shop', pose: 'boost', blurb: 'A celebratory jet hop.' },
  // trails
  { id: 'trail:cyan', kind: 'trail', name: 'Ion Cyan', price: 200, source: 'shop', trail: 0x37e8ff },
  { id: 'trail:gold', kind: 'trail', name: 'Gold Rush', price: 400, source: 'shop', trail: 0xffd36a },
  { id: 'trail:violet', kind: 'trail', name: 'Violet Arc', price: 300, source: 'shop', trail: 0xb36bff },
  { id: 'trail:crimson', kind: 'trail', name: 'Crimson', price: 300, source: 'shop', trail: 0xff3b52 },
  { id: 'trail:lime', kind: 'trail', name: 'Lime Volt', price: 250, source: 'shop', trail: 0x9dff4a },
  { id: 'trail:white', kind: 'trail', name: 'White Noise', price: 200, source: 'shop', trail: 0xf2f6ff },
];

const ACHIEVEMENT_ITEMS: Cosmetic[] = [
  { id: 'paint:champion', kind: 'paint', name: 'Crown Plate', price: 0, source: 'achievement', paint: P(0xf3ead2, 0xd9a63a, 0x1a1a22, 0x14141a, 0xffd36a), blurb: 'Awarded to circuit champions.' },
  { id: 'decal:crown', kind: 'decal', name: 'Crown', price: 0, source: 'achievement', decal: 'K1', blurb: 'Awarded to circuit champions.' },
  { id: 'trail:flawless', kind: 'trail', name: 'Flawless White', price: 0, source: 'achievement', trail: 0xffffff, blurb: 'Win with 90% HP left.' },
  { id: 'decal:parry', kind: 'decal', name: 'Parry Master', price: 0, source: 'achievement', decal: 'PM', blurb: 'Land 25 parries.' },
];

/* ------------------------------------------------------------------ mastery cosmetics */

/** Mastery reward kind per level (level 1 is the starting level; no reward). */
export const MASTERY_REWARD: Record<number, CosmeticKind> = { 2: 'paint', 3: 'decal', 4: 'trail', 5: 'paint' };

function partColor(slot: Slot, id: string): number {
  const p = ALL_PARTS[slot][id] as { color?: number } | undefined;
  if (p && typeof p.color === 'number') return p.color;
  // bodies / legs have no color: derive a hue from the id
  let hsh = 2166136261;
  for (const c of `${slot}:${id}`) hsh = Math.imul(hsh ^ c.charCodeAt(0), 16777619);
  return hslToHex(((hsh >>> 0) % 360) / 360, 0.75, 0.55);
}
function hslToHex(hh: number, s: number, l: number): number {
  const f = (n: number) => {
    const k = (n + hh * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}
function shade(c: number, k: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const m = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return (m(r) << 16) | (m(g) << 8) | m(b);
}
function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

/** Cosmetic id unlocked by reaching `level` of mastery on a part ("slot:id"). */
export function masteryCosmeticId(partKey: string, level: number): string | null {
  const kind = MASTERY_REWARD[level];
  return kind ? `m:${partKey}:${level}` : null;
}

function buildMasteryItems(): Cosmetic[] {
  const out: Cosmetic[] = [];
  for (const slot of Object.keys(ALL_PARTS) as Slot[]) {
    for (const [id, part] of Object.entries(ALL_PARTS[slot])) {
      const key = `${slot}:${id}`;
      const c = partColor(slot, id);
      const ini = initials(part.name);
      out.push(
        { id: `m:${key}:2`, kind: 'paint', name: `${part.name} Tint`, price: 0, source: 'mastery', paint: P(shade(c, -0.55), c, shade(c, 0.7), shade(c, -0.8), shade(c, 0.35)), blurb: `${part.name} mastery 2` },
        { id: `m:${key}:3`, kind: 'decal', name: `${ini} Badge`, price: 0, source: 'mastery', decal: ini, blurb: `${part.name} mastery 3` },
        { id: `m:${key}:4`, kind: 'trail', name: `${part.name} Trail`, price: 0, source: 'mastery', trail: shade(c, 0.2), blurb: `${part.name} mastery 4` },
        { id: `m:${key}:5`, kind: 'paint', name: `${part.name} Master`, price: 0, source: 'mastery', paint: P(0x15161b, c, 0xffd36a, 0x0c0d10, shade(c, 0.45)), blurb: `${part.name} mastery 5` },
      );
    }
  }
  return out;
}

export const COSMETICS: Record<string, Cosmetic> = Object.fromEntries(
  [...SHOP_ITEMS, ...ACHIEVEMENT_ITEMS, ...buildMasteryItems()].map((c) => [c.id, c]),
);

export function cosmetic(id: string): Cosmetic | undefined {
  return COSMETICS[id];
}

/* ------------------------------------------------------------------ daily rotation */

export const STOCK_SIZE = 6;
/** Stock composition: 2 paint, 2 decal, 1 pose, 1 trail. */
const STOCK_MIX: [CosmeticKind, number][] = [['paint', 2], ['decal', 2], ['pose', 1], ['trail', 1]];

export function hashString(s: string): number {
  let hsh = 2166136261;
  for (let i = 0; i < s.length; i++) hsh = Math.imul(hsh ^ s.charCodeAt(i), 16777619);
  return hsh >>> 0;
}
/** mulberry32 PRNG seeded from a string. */
export function seededRng(seed: string): () => number {
  let a = hashString(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local-calendar date key, e.g. "2026-11-01". */
export function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The 6 cosmetic ids on sale for a given date key. Same date → same stock for everyone. */
export function dailyStock(day: string): string[] {
  const rng = seededRng(`shop:${day}`);
  const out: string[] = [];
  for (const [kind, n] of STOCK_MIX) {
    const pool = SHOP_ITEMS.filter((c) => c.kind === kind).map((c) => c.id);
    for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

/** Whether a shop id could ever be a part ("slot:id" of a real part). Used as a hard guard. */
export function isPartKey(id: string): boolean {
  const [slot, pid] = id.split(':') as [Slot, string];
  return !!ALL_PARTS[slot]?.[pid];
}

export interface Wallet {
  credits: number;
  cosmetics: { owned: string[] };
}

export type BuyResult = { ok: true } | { ok: false; reason: 'not-in-stock' | 'owned' | 'credits' | 'not-for-sale' };

/** Buy a cosmetic from today's stock. Mutates the wallet on success. */
export function buyCosmetic(w: Wallet, id: string, day: string): BuyResult {
  const c = COSMETICS[id];
  if (!c || c.source !== 'shop' || isPartKey(id)) return { ok: false, reason: 'not-for-sale' };
  if (!dailyStock(day).includes(id)) return { ok: false, reason: 'not-in-stock' };
  if (w.cosmetics.owned.includes(id)) return { ok: false, reason: 'owned' };
  if (w.credits < c.price) return { ok: false, reason: 'credits' };
  w.credits -= c.price;
  w.cosmetics.owned.push(id);
  return { ok: true };
}

/** Milliseconds until the stock re-rolls (next local midnight). */
export function msUntilRestock(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}
