/**
 * Guided first match: a step machine that advances when the player performs each action.
 *
 * Driven only by simulation ticks and fighter events (never wall-clock time), so a replay of
 * the guided match re-runs it identically. The rival holds its attacks until the guard /
 * parry lesson, then fights normally. Every step also times out, so ignoring the prompts
 * never stalls the match.
 */
import type { Action } from '../core/input';

export type GuideStepId = 'move' | 'dash' | 'fire' | 'bomb' | 'charge' | 'parry' | 'finish';

export interface GuideStep {
  id: GuideStepId;
  title: string;
  /** Prompt text; {key} is replaced with the bound key / button. */
  text: string;
  /** Gamepad wording when it differs (mouse-only aiming, etc). */
  padText?: string;
  /** Binding shown as the key glyph. */
  action: Action | 'move';
  /** Sim seconds before the step advances on its own. */
  timeout: number;
}

export const GUIDE_STEPS: readonly GuideStep[] = [
  { id: 'move', title: 'Move', text: 'Walk around the arena. The camera keeps the rival in front of you.', action: 'move', timeout: 16 },
  { id: 'dash', title: 'Dash', text: 'Press {key} to dash. Dashing is your main dodge.', action: 'dash', timeout: 16 },
  { id: 'fire', title: 'Fire', text: 'Press {key} to fire your gun. It aims itself at the rival.', action: 'gun', timeout: 16 },
  { id: 'bomb', title: 'Bomb', text: 'Press {key} to lob a bomb over cover. Hold it to steer the landing marker with the mouse, release to throw.', padText: 'Press {key} to lob a bomb. It arcs over cover and lands on the rival.', action: 'bomb', timeout: 20 },
  { id: 'charge', title: 'Charge & Guard', text: 'Press {key} for a charge attack. While it winds up you are guarding: shots from the front bounce off.', action: 'charge', timeout: 18 },
  { id: 'parry', title: 'Parry', text: 'The rival attacks now. Press {key} just before a hit lands to parry: it leaves them wide open.', action: 'charge', timeout: 28 },
  { id: 'finish', title: 'Win the Fight', text: 'You know the basics. Knock the rival out!', action: 'gun', timeout: 6 },
];

/** Fighter event types that complete a step. */
const COMPLETES: Partial<Record<GuideStepId, string[]>> = {
  dash: ['dash'],
  fire: ['fire'],
  bomb: ['bomb'],
  charge: ['chargeStart'],
  parry: ['parry'],
};

export class Guide {
  index = 0;
  stepT = 0;
  private moved = 0;
  /** Steps finished by doing them (vs timing out). */
  readonly done: GuideStepId[] = [];
  /** Set when the current step changed this tick (for the view). */
  changed = true;
  /** Last step completed by the player this tick (for a "nice" flash). */
  justDone: GuideStepId | null = null;

  get step(): GuideStep | null {
    return GUIDE_STEPS[this.index] ?? null;
  }
  get finished(): boolean {
    return this.index >= GUIDE_STEPS.length;
  }
  /** The rival may attack from the parry lesson on. */
  get rivalArmed(): boolean {
    const i = GUIDE_STEPS.findIndex((s) => s.id === 'parry');
    return this.index >= i;
  }

  private advance(byPlayer: boolean) {
    const s = this.step;
    if (!s) return;
    if (byPlayer) { this.done.push(s.id); this.justDone = s.id; }
    this.index++;
    this.stepT = 0;
    this.moved = 0;
    this.changed = true;
  }

  /** One simulation tick: `dist` is how far the player moved this tick (XZ). */
  tick(dt: number, dist: number) {
    const s = this.step;
    if (!s) return;
    this.stepT += dt;
    if (s.id === 'move') {
      this.moved += dist;
      if (this.moved >= 4) { this.advance(true); return; }
    }
    if (this.stepT >= s.timeout) this.advance(false);
  }

  /** A fighter event performed by the player. */
  onEvent(type: string) {
    const s = this.step;
    if (!s) return;
    if (COMPLETES[s.id]?.includes(type)) this.advance(true);
  }
}
