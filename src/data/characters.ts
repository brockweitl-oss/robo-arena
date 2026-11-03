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
  finish?: 'gloss' | 'matte' | 'metal' | 'chrome' | 'carbon';
  wear?: number;
  flame?: number;
  decal?: 'unit' | 'chevron' | 'cross' | 'none';
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
  /** Counter-hint shown after losing to this rival. */
  hint?: string;
  /** Part key suggested after a loss (e.g. 'legs:hopper'). */
  suggest?: string;
  /** Rival+ (post-story remix). */
  plus?: boolean;
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
    hint: 'Bricktop charges in a straight line. Hold your charge to guard: a well-timed guard parries the ram and leaves him wide open.',
    suggest: 'legs:hopper',
    pilot: 'Dex Marrow',
    robotName: 'Bricktop',
    title: 'Yard Brawler',
    loadout: { gun: 'pulse', bomb: 'mortar', pod: 'seeker', body: 'ironclad', legs: 'stride', skill: 'hook' },
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
    hint: 'Lark bombs from the air. Watch the red landing rings, dash out of them, then punish her when she lands.',
    suggest: 'gun:scatter',
    pilot: 'Mira Osei',
    robotName: 'Lark',
    title: 'Sky Artillerist',
    loadout: { gun: 'homer', bomb: 'cluster', pod: 'mine', body: 'wisp', legs: 'hopper', skill: 'wave' },
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
    hint: 'Cobalt closes for a scatter burst. Keep him outside shotgun range, then punish his committed shot or charge recovery.',
    suggest: 'body:wisp',
    pilot: 'Vance Ito',
    robotName: 'Cobalt',
    title: 'Close-Quarters Duelist',
    loadout: { gun: 'scatter', bomb: 'mortar', pod: 'seeker', body: 'striker', legs: 'stride', skill: 'frost' },
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
    hint: 'Jinx lays mines and charges rail shots. Watch for the muzzle glint, then dash sideways. Shoot down her mines before they arm.',
    suggest: 'pod:mine',
    pilot: 'Juno Hex',
    robotName: 'Jinx',
    title: 'Trap Artist',
    loadout: { gun: 'rail', bomb: 'cluster', pod: 'mine', body: 'wisp', legs: 'stride', skill: 'lance' },
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
    hint: 'Sovereign charges a beam behind a defense drone. Bait the beam, break line of sight, then punish its recovery. The drone cannot stop bombs.',
    suggest: 'body:ironclad',
    pilot: 'Sable Raine',
    robotName: 'Sovereign',
    title: 'Reigning Champion',
    loadout: { gun: 'beam', bomb: 'mortar', pod: 'interceptor', body: 'regent', legs: 'stride', skill: 'wave' },
    paint: { primary: 0x1a1a22, secondary: 0xd9a63a, trim: 0xf0e6cf, dark: 0x111116, glow: 0xff3a5c, emblem: '01' },
    ai: 'champion',
    // story final: a step below Sovereign EX (1.0) so the ladder ends on a beatable peak
    skill: 0.9,
    arena: 'orbital',
    intro: 'Four wins, rookie. Impressive. But this is Halo Deck, and Sovereign has never lost here.',
    taunt: 'Kneel.',
    defeatLine: 'So this is what losing feels like. The crown is yours, Kestrel.',
    unlocks: ['body:regent'],
  },
];

/**
 * Rival+ (unlocked after the champion): the same pilots with sharper AI and
 * remixed builds that use the 2.0 parts. Each win unlocks the parts they use.
 */
export const RIVALS_PLUS: Rival[] = [
  {
    ...RIVALS[0], id: 'dex+', plus: true, robotName: 'Bricktop EX', title: 'Yard Bulwark', skill: 0.7, arena: 'garden',
    loadout: { gun: 'scatter', bomb: 'napalm', pod: 'turret', body: 'ironclad', legs: 'anchor', skill: 'hook' },
    intro: "New season, new rig. Anchor legs, a turret and a fire pot. Bricktop doesn't move any more, and doesn't need to.",
    defeatLine: 'Fine. Take the Anchor legs. Maybe you can make them work.',
    unlocks: ['legs:anchor', 'bomb:napalm'],
    hint: 'Bricktop EX holds ground. Stay out of the fire pool, kill the turret, and fight him from above.', suggest: 'legs:hopper',
  },
  {
    ...RIVALS[1], id: 'mira+', plus: true, robotName: 'Lark EX', title: 'Storm Artillerist', skill: 0.7, arena: 'orbital',
    loadout: { gun: 'homer', bomb: 'cluster', pod: 'mine', body: 'wisp', legs: 'feather', skill: 'frost' },
    intro: 'Feather legs. I barely touch the ground now. Good luck catching me.',
    defeatLine: "You caught me mid-air. Here, Feather legs and the Homer. They'll suit you.",
    unlocks: ['legs:feather', 'gun:homer'],
    hint: "Lark EX's curving shots lose a straight dash. Dash in a line, not sideways.", suggest: 'pod:interceptor',
  },
  {
    ...RIVALS[2], id: 'vance+', plus: true, robotName: 'Cobalt EX', title: 'Afterimage', skill: 0.8, arena: 'garden',
    loadout: { gun: 'pulse', bomb: 'bouncer', pod: 'seeker', body: 'striker', legs: 'sprint', skill: 'wave' },
    intro: "Two dash charges. I'll be behind you before your shot lands.",
    defeatLine: "I couldn't out-dash you. The Sprint legs and Skip Grenade are yours.",
    unlocks: ['legs:sprint', 'bomb:bouncer'],
    hint: 'Cobalt EX baits a dash, then dashes again. Guard when he closes; he relies on getting in point-blank.', suggest: 'gun:scatter',
  },
  {
    ...RIVALS[3], id: 'hex+', plus: true, robotName: 'Jinx EX', title: 'Lockdown', skill: 0.85, arena: 'foundry',
    loadout: { gun: 'beam', bomb: 'cluster', pod: 'turret', body: 'wisp', legs: 'stride', skill: 'lance' },
    intro: "A beam that charges as long as I like and a turret watching your back door. Walk carefully.",
    defeatLine: 'Okay, you can read a charge glint. The Beam and Tripod are yours.',
    unlocks: ['gun:beam', 'pod:turret'],
    hint: 'A charging beam glows. Dash the instant it fires, or guard to parry it straight back.', suggest: 'legs:sprint',
  },
  {
    ...RIVALS[4], id: 'sable+', plus: true, robotName: 'Sovereign EX', title: 'Undisputed', skill: 1.0, arena: 'orbital',
    loadout: { gun: 'rail', bomb: 'mortar', pod: 'interceptor', body: 'regent', legs: 'sprint', skill: 'lance' },
    intro: 'You took my crown once. The Aegis drone eats your shots now, and every rail hit knocks you flat.',
    defeatLine: "Twice. You're the real thing. The Aegis drone is yours, Champion.",
    unlocks: ['pod:interceptor'],
    hint: 'The Aegis drone shoots down shots near Sovereign. Overwhelm it with bombs and pods, or bait the rail and punish its recovery.', suggest: 'pod:mine',
  },
];

export function rivalById(id: string): Rival {
  return RIVALS.find((r) => r.id === id) ?? RIVALS_PLUS.find((r) => r.id === id) ?? RIVALS[0];
}
