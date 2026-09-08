/**
 * BGMDL G-League constants.
 * Source: #g-league_rules (Mr. Mickey, 10/30/20 + call-up scale image 1/30/22).
 *
 * Money is in $M throughout this module. BBGM stores contract amounts in
 * thousands, so multiply by 1000 on the way into an export.
 */

/** BBGM sentinel tids. Verified against both BGMDL exports. */
export const BBGM_TID = {
  FREE_AGENT: -1,
  UNDRAFTED: -2,
  /** Retired — also what we use to park a player who is out of his league. */
  INACTIVE: -3,
} as const;

/** Assignment criteria (rule #2). All must hold. */
export const MAX_ASSIGN_OVR = 54;
export const MAX_ASSIGN_AGE = 26;
export const MAX_ASSIGN_SALARY_M = 5;

/** Minimum OVR for a direct call-up (rule 8.2), and the floor of the pay scale. */
export const MIN_CALLUP_OVR = 55;

/** Roster limits (rule #7). The GL export's gameAttributes agree: 5 / 7. */
export const GL_MIN_ROSTER = 5;
export const GL_MAX_ROSTER = 7;
export const GL_HOARD_LIMIT = 10;
export const GL_MAX_ASSIGNED = 5;

/** G-League contract bounds — matches the GL export's gameAttributes. */
export const GL_MIN_CONTRACT_M = 0.25;
export const GL_MAX_CONTRACT_M = 3;

/** Legal call-up contract lengths. */
export const CALLUP_YEARS = [2, 3, 4, 5] as const;

/**
 * Call-up pay scale — minimum $M by OVR band and contract length.
 * Bands are [minOvr, maxOvr] inclusive; the last band is open-ended.
 */
const CALLUP_SCALE: Array<{ min: number; max: number; byYear: Record<number, number> }> = [
  { min: 55, max: 56, byYear: { 2: 1, 3: 3, 4: 5, 5: 7 } },
  { min: 57, max: 58, byYear: { 2: 2, 3: 4, 4: 6, 5: 8 } },
  { min: 59, max: 60, byYear: { 2: 4, 3: 7, 4: 10, 5: 13 } },
  { min: 61, max: 61, byYear: { 2: 9, 3: 12, 4: 15, 5: 18 } },
  { min: 62, max: 62, byYear: { 2: 10, 3: 13, 4: 16, 5: 19 } },
  { min: 63, max: 63, byYear: { 2: 14, 3: 18, 4: 22, 5: 26 } },
  { min: 64, max: 64, byYear: { 2: 15, 3: 19, 4: 23, 5: 27 } },
  { min: 65, max: Infinity, byYear: { 2: 21, 3: 25, 4: 29, 5: 33 } },
];

/** Minimum $M a called-up player must be paid at this OVR and contract length. */
export function callUpMinimumM(ovr: number, years: number): number {
  if (!(CALLUP_YEARS as readonly number[]).includes(years)) {
    throw new Error(`Illegal call-up contract length: ${years}y (must be 2-5)`);
  }
  const band = CALLUP_SCALE.find((b) => ovr >= b.min && ovr <= b.max);
  if (!band) {
    throw new Error(
      `No call-up pay scale for ${ovr} OVR — minimum for a call-up is ${MIN_CALLUP_OVR}`,
    );
  }
  return band.byYear[years];
}

/**
 * What an assigned player earns while in the G-League (rule #8 pay scale).
 * Clamped to the GL contract range.
 */
export function glAssignedContractM(ovr: number): number {
  const raw = ovr >= 50 ? 2 : ovr >= 45 ? 0.75 : GL_MIN_CONTRACT_M;
  return Math.min(GL_MAX_CONTRACT_M, Math.max(GL_MIN_CONTRACT_M, raw));
}

/** $M → BBGM's thousands. */
export const toBbgmAmount = (millions: number): number => Math.round(millions * 1000);
/** BBGM's thousands → $M. */
export const fromBbgmAmount = (amount: number): number => amount / 1000;
