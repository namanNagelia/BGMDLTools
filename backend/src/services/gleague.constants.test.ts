import { describe, expect, test } from "vitest";
import { callUpMinimumM, glAssignedContractM } from "./gleague.constants.js";

/**
 * Call-up pay scale (source: BGMDL #g-league_rules image, 1/30/22).
 * Minimum $M a called-up player must be paid, by OVR band and contract length.
 *
 *  OVR   | 2Y | 3Y | 4Y | 5Y
 *  55-56 |  1 |  3 |  5 |  7
 *  57-58 |  2 |  4 |  6 |  8
 *  59-60 |  4 |  7 | 10 | 13
 *  61    |  9 | 12 | 15 | 18
 *  62    | 10 | 13 | 16 | 19
 *  63    | 14 | 18 | 22 | 26
 *  64    | 15 | 19 | 23 | 27
 *  65+   | 21 | 25 | 29 | 33
 */
describe("callUpMinimumM", () => {
  test.each([
    [55, 2, 1],
    [56, 5, 7],
    [57, 3, 4],
    [58, 4, 6],
    [59, 2, 4],
    [60, 5, 13],
    [61, 3, 12],
    [62, 4, 16],
    [63, 2, 14],
    [64, 5, 27],
    [65, 2, 21],
    [72, 5, 33],
  ])("OVR %i on a %iY deal costs at least $%iM", (ovr, years, expected) => {
    expect(callUpMinimumM(ovr, years)).toBe(expected);
  });

  test("every band's minimum rises with contract length", () => {
    for (const ovr of [55, 57, 59, 61, 62, 63, 64, 65]) {
      const byYear = [2, 3, 4, 5].map((y) => callUpMinimumM(ovr, y));
      expect(byYear).toStrictEqual([...byYear].sort((a, b) => a - b));
    }
  });

  test("rejects a length outside the 2-5 year scale", () => {
    expect(() => callUpMinimumM(60, 1)).toThrow(/contract length/i);
    expect(() => callUpMinimumM(60, 6)).toThrow(/contract length/i);
  });

  // Rule 8.2: below 55 OVR a player is not eligible for a direct call-up at all,
  // so the scale has no entry for him and callers must gate on eligibility first.
  test("rejects an OVR below the bottom of the scale", () => {
    expect(() => callUpMinimumM(54, 2)).toThrow(/55/);
  });
});

/**
 * G-League pay scale (rule #8) — what an assigned player earns while down.
 * 50+ OVR: $2M+ | 45+ OVR: $0.75M+ | <45 OVR: minimum $0.25M.
 * Clamped to the GL contract range [$0.25M, $3M].
 */
describe("glAssignedContractM", () => {
  test.each([
    [54, 2],
    [50, 2],
    [49, 0.75],
    [45, 0.75],
    [44, 0.25],
    [30, 0.25],
  ])("OVR %i earns $%sM in the G-League", (ovr, expected) => {
    expect(glAssignedContractM(ovr)).toBe(expected);
  });

  test("never exceeds the G-League max contract", () => {
    for (let ovr = 20; ovr <= 54; ovr++) {
      expect(glAssignedContractM(ovr)).toBeLessThanOrEqual(3);
      expect(glAssignedContractM(ovr)).toBeGreaterThanOrEqual(0.25);
    }
  });
});
