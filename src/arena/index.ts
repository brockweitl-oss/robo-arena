import type { ArenaFactory, ArenaInfo } from './types';
import { createFoundry } from './foundry';
import { createGarden } from './garden';
import { createOrbital } from './orbital';

export const ARENA_FACTORIES: Record<string, ArenaFactory> = {
  foundry: createFoundry,
  garden: createGarden,
  orbital: createOrbital,
};

export const ARENA_IDS = ['foundry', 'garden', 'orbital'] as const;
export type ArenaId = (typeof ARENA_IDS)[number];

/** Menu metadata without building geometry. Keep in sync with each arena's info. */
export const ARENA_INFO: Record<ArenaId, ArenaInfo> = {
  foundry: { id: 'foundry', name: 'Crucible Yard', subtitle: 'Foundry Floor 3', blurb: 'Molten light, steel catwalks and a crane platform that never stops moving.', music: 'foundry', accent: '#ff7a2f' },
  garden: { id: 'garden', name: 'Lantern Terrace', subtitle: 'Rooftop Bonsai Garden', blurb: 'Stone terraces at dusk. Steam geysers launch anything standing on them.', music: 'garden', accent: '#7fe0a0' },
  orbital: { id: 'orbital', name: 'Halo Deck', subtitle: 'Orbital Ring Platform', blurb: 'A championship stage above the planet. Arc coils electrify the deck.', music: 'orbital', accent: '#7aa8ff' },
};
