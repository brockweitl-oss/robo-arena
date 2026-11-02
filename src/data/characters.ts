import type { Loadout } from './parts';

/** Paint scheme applied to a robot frame. Colors are hex ints. */
export interface Paint {
  primary: number;
  secondary: number;
  trim: number;
  dark: number;
  glow: number;
  /** Optional decal number/emblem drawn on the chest. */
  emblem: string;
  /** Optional dash-afterimage trail color (cosmetic; rendered by effects when supported). */
  trail?: number;
}

export type AIPersonality = 'rookie' | 'rusher' | 'bomber' | 'duelist' | 'trickster' | 'champion';

export interface Rival {
  id: string;
  pilot: string;
  robotName: string;
  title: string;
  loadout: Loadout;
  paint: Paint;
  ai: AIPersonality;
  /** 0..1 skill: reaction time, aim leading, dodge frequency. */
  skill: number;
  arena: string;
  intro: string;
  taunt: string;
  defeatLine: string;
  /** Parts granted to the player on first win. */
  unlocks: string[];
}

export const PLAYER_PAINT: Paint = {
  primary: 0xf4f1ea,
  secondary: 0xff6a1f,
  trim: 0x23262e,
  dark: 0x2a2d35,
  glow: 0x37e8ff,
  emblem: '07',
};

export const PLAYER_ROBOT_NAME = 'Kestrel';

export const RIVALS: Rival[] = [
  {
    id: 'dex',
    pilot: 'Dex Marrow',
    robotName: 'Bricktop',
    title: 'Yard Brawler',
    loadout: { gun: 'pulse', bomb: 'mortar', pod: 'seeker', body: 'ironclad', legs: 'stride' },
    paint: { primary: 0x5f7f3a, secondary: 0xe8c23a, trim: 0x2b2a24, dark: 0x30322b, glow: 0xffd23a, emblem: '22' },
    ai: 'rookie',
    skill: 0.25,
    arena: 'foundry',
    intro: "First match of the season? Don't cry when Bricktop flattens you. I just charge in. Works every time.",
    taunt: 'Stand still!',
    defeatLine: 'Okay... maybe charging in doesn’t work every time.',
    unlocks: ['gun:scatter', 'legs:hopper'],
  },
  {
    id: 'mira',
    pilot: 'Mira Osei',
    robotName: 'Lark',
    title: 'Sky Artillerist',
    loadout: { gun: 'pulse', bomb: 'cluster', pod: 'mine', body: 'wisp', legs: 'hopper' },
    paint: { primary: 0x7b5cff, secondary: 0xf2f0ff, trim: 0x2a2440, dark: 0x2c2840, glow: 0xff7ae6, emblem: '03' },
    ai: 'bomber',
    skill: 0.45,
    arena: 'garden',
    intro: 'You fight on the ground. I fight from the sky. Try to keep up while my bombs rain on you.',
    taunt: 'Look up!',
    defeatLine: 'You read my arcs. Take Lark’s cluster rig. You earned it.',
    unlocks: ['bomb:cluster', 'body:wisp'],
  },
  {
    id: 'vance',
    pilot: 'Vance Ito',
    robotName: 'Cobalt',
    title: 'Mirror Duelist',
    loadout: { gun: 'scatter', bomb: 'mortar', pod: 'seeker', body: 'striker', legs: 'stride' },
    paint: { primary: 0x1d2e5c, secondary: 0x36c6ff, trim: 0xd9dde6, dark: 0x1a1f2c, glow: 0x9cf2ff, emblem: '11' },
    ai: 'duelist',
    skill: 0.6,
    arena: 'foundry',
    intro: 'Same frame as yours. Same parts, almost. So it comes down to who moves better. Ready?',
    taunt: 'Too slow.',
    defeatLine: 'Clean. Your dash timing is better than mine. Not for long.',
    unlocks: ['pod:mine', 'body:ironclad'],
  },
  {
    id: 'hex',
    pilot: 'Juno Hex',
    robotName: 'Jinx',
    title: 'Trap Artist',
    loadout: { gun: 'rail', bomb: 'cluster', pod: 'mine', body: 'wisp', legs: 'stride' },
    paint: { primary: 0x15a37a, secondary: 0x111418, trim: 0xd6ff3a, dark: 0x16191c, glow: 0x6dffb2, emblem: '13' },
    ai: 'trickster',
    skill: 0.75,
    arena: 'garden',
    intro: 'Every inch of this arena is mine. Mines, bombs, one rail shot. You will walk right into it.',
    taunt: 'Gotcha.',
    defeatLine: 'You walked around every trap. Annoying. Here, take the Lance.',
    unlocks: ['gun:rail'],
  },
  {
    id: 'sable',
    pilot: 'Sable Raine',
    robotName: 'Sovereign',
    title: 'Reigning Champion',
    loadout: { gun: 'pulse', bomb: 'mortar', pod: 'seeker', body: 'regent', legs: 'stride' },
    paint: { primary: 0x1a1a22, secondary: 0xd9a63a, trim: 0xf0e6cf, dark: 0x111116, glow: 0xff3a5c, emblem: '01' },
    ai: 'champion',
    skill: 1.0,
    arena: 'orbital',
    intro: 'Four wins, rookie. Impressive. But this is Halo Deck, and Sovereign has never lost here.',
    taunt: 'Kneel.',
    defeatLine: 'So this is what losing feels like. The crown is yours, Kestrel.',
    unlocks: ['body:regent'],
  },
];

export function rivalById(id: string): Rival {
  return RIVALS.find((r) => r.id === id) ?? RIVALS[0];
}
