import type { ArenaFactory, ArenaInfo } from './types';
import { createFoundry } from './foundry';
import { createGarden } from './garden';
import { createOrbital } from './orbital';
import { createHangar } from './hangar';
import { createProving } from './proving';
import { createSunken } from './sunken';

export const ARENA_FACTORIES: Record<string, ArenaFactory> = {
  foundry: createFoundry,
  garden: createGarden,
  orbital: createOrbital,
  hangar: createHangar,
  proving: createProving,
  sunken: createSunken,
};

export const ARENA_IDS = ['foundry', 'garden', 'orbital', 'hangar', 'proving', 'sunken'] as const;
export type ArenaId = (typeof ARENA_IDS)[number];

/** Menu metadata without building geometry. Keep in sync with each arena's info. */
export const ARENA_INFO: Record<ArenaId, ArenaInfo> = {
  foundry: { id: 'foundry', name: 'Crucible Yard', subtitle: 'Foundry Floor 3', blurb: 'Molten light, steel catwalks and a crane platform that never stops moving.', music: 'foundry', accent: '#ff7a2f' },
  garden: { id: 'garden', name: 'Lantern Terrace', subtitle: 'Rooftop Bonsai Garden', blurb: 'Stone terraces at dusk. Pressure vents have fixed timing and clear countdowns.', music: 'garden', accent: '#7fe0a0' },
  hangar: { id:'hangar',name:'Rain Hangar',subtitle:'Night maintenance sector',blurb:'Rain-washed service decks, mirrored cover and an overhead gantry.',music:'foundry',accent:'#77cde2' },
  proving: { id:'proving',name:'Proving Grounds',subtitle:'Desert combat range',blurb:'Fortified berms and open firing lanes. Cosmetic dust, fixed rules.',music:'foundry',accent:'#d5af6c' },
  sunken: { id:'sunken',name:'Sunken District',subtitle:'Flooded civic plaza',blurb:'Shallow water, raised ruins and symmetrical cover routes.',music:'garden',accent:'#85b7ac' },
  orbital: { id: 'orbital', name: 'Halo Deck', subtitle: 'Orbital Ring Platform', blurb: 'A championship stage above the planet. Arc coils electrify the deck.', music: 'orbital', accent: '#7aa8ff' },
};
