/** Fixed-tick, nonstacking setup window. No random proc or extra crowd control. */
export const PRIMER_TICKS = 120;
export const PRIMER_ARM_TICKS = 21;
export const COMBO_DAMAGE_FRACTION = 0.15;
export const COMBO_DAMAGE_CAP = 18;
export type PrimerClearReason = 'expired' | 'dodge' | 'parry' | 'guard' | 'down' | 'death' | 'reset' | 'consumed';
export interface PrimerState {
  owner: number;
  remainingTicks: number;
  armTicks: number;
  /** Seconds, for presentation only. */
  remaining: number;
  duration: number;
  armed: boolean;
}
export const makePrimer = (owner: number): PrimerState => ({
  owner, remainingTicks: PRIMER_TICKS, armTicks: PRIMER_ARM_TICKS,
  remaining: PRIMER_TICKS / 60, duration: PRIMER_TICKS / 60, armed: false,
});
export const comboBonus = (baseDamage: number) => Math.min(COMBO_DAMAGE_CAP, Math.max(0, baseDamage) * COMBO_DAMAGE_FRACTION);
