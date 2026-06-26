/**
 * BGMDL Free Agency value calculation constants.
 * Source: league FA rules document.
 */

export const VALUE_KEYS = [
  "market",
  "legacy",
  "playingTime",
  "winning",
  "loyalty",
  "money",
  "length",
] as const;
export type ValueKey = (typeof VALUE_KEYS)[number];

/** Base multipliers per value (matches sheet column headers). */
export const MULTIPLIERS: Record<ValueKey, number> = {
  market: 1.0,
  legacy: 1.0,
  playingTime: 1.1,
  winning: 1.3,
  loyalty: 1.3,
  money: 2.0,
  length: 1.4,
};

/** 10M/20M elimination filter — runs before Hayato. */
export const TEN_M_PER_YEAR = 10; // $M/yr
export const TWENTY_M_TOTAL = 20; // $M total

/** Money bonus: +0.1 for each full $2M difference vs the lowest offer. */
export const MONEY_BONUS_INCREMENT_M = 2;
export const MONEY_BONUS_STEP = 0.1;

/** RFA money: +1.0 to base multiplier (2.0 → 3.0). */
export const RFA_MONEY_BONUS = 1.0;

/** Loyalty: base × (yearsOnTeam / 3) rounded to nearest tenth. */
export const LOYALTY_YEARS_DIVISOR = 3;
export function loyaltyYearsMultiplier(years: number): number {
  return Math.round((years / LOYALTY_YEARS_DIVISOR) * 10) / 10;
}

/** Free Agent Protection penalty — applied per offer. */
export const FAP_PENALTY = 5; // total points subtracted
