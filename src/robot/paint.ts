import type { Paint } from '../data/characters';

/** Optional visual extensions preserve compatibility with old rivals and saves. */
export interface VisualPaint extends Paint {
  finish?: 'gloss' | 'matte' | 'metal' | 'chrome' | 'carbon';
  wear?: number; flame?: number; trail?: number; decal?: 'unit' | 'chevron' | 'cross' | 'none';
}

