import type { SaveData, Settings } from '../core/save';
import type { MatchConfig, MatchResult } from '../game/types';
import type { Loadout } from '../data/parts';
import type { Paint } from '../data/characters';
import type { MusicTrack, SfxName } from '../audio/audio';

/**
 * What the game shell (src/game/game.ts) provides to the menu layer (src/ui/menus.ts).
 * Menus are DOM overlays above the full-window WebGL canvas.
 */
export interface MenuHost {
  /** Mutable save data. Call persist() after changing it. */
  readonly save: SaveData;
  persist(): void;
  /** Apply audio volumes, graphics quality, etc. (call after editing save.settings). */
  applySettings(s: Settings): void;

  /**
   * Run a battle. Menus must hide themselves first (the HUD is owned by the host).
   * Resolves when the round ends (after the KO/time-up slow-mo and victory pose),
   * or when the player quits from the pause menu (result.quit = true).
   * The host shows the pause menu itself by calling MenuLayer.showPause().
   */
  startMatch(cfg: MatchConfig): Promise<MatchResult>;

  /**
   * 3D backdrop behind the menus:
   *  - 'title':    cinematic slow orbit around the player's robot on a pedestal
   *  - 'garage':   showroom; the robot is shown at `previewRect` (CSS px rect where the robot should appear centered), rotatable
   *  - 'versus':   player robot vs rival robot facing off (for the rival intro / free-battle confirm)
   *  - 'none'
   */
  setBackdrop(kind: 'title' | 'garage' | 'versus' | 'none', opts?: {
    loadout?: Loadout;
    paint?: Paint;
    rivalId?: string;
    previewRect?: { x: number; y: number; w: number; h: number };
  }): void;
  /** Rotate the garage preview by a yaw delta (radians), e.g. from drag. */
  rotatePreview(dYaw: number): void;
  /** Highlight a slot on the garage preview (camera nudges toward it): 'gun'|'bomb'|'pod'|'body'|'legs'|null. */
  focusPreview(slot: string | null): void;
  /** Photo studio owns rendering while open; keep the menu scene suspended. */
  suspendBackdrop?(suspended: boolean): void;

  sfx(name: SfxName): void;
  music(track: MusicTrack): void;
}

/** What the menu layer exposes to the host. */
export interface MenuLayer {
  /** First screen after boot. */
  showTitle(): void;
  /** Pause overlay during a match. Resolve with the chosen action. */
  showPause(): Promise<'resume' | 'restart' | 'quit'>;
  hidePause(): void;
  /** Whether a menu currently captures gamepad/keyboard navigation. */
  readonly active: boolean;
}
