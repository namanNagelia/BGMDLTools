import { describe, expect, test } from "vitest";
import { applySignedContract } from "./export.service.js";

describe("applySignedContract", () => {
  test("v75: replaces the FA asking deal in the contracts history", () => {
    const p = {
      contracts: [
        { start: 2183, amounts: [1200, 1200] },
        { start: 2188, amounts: [9970, 9970, 9970, 9970] },
      ],
    };
    applySignedContract(p, 2187, 15, 1);
    expect(p.contracts).toEqual([
      { start: 2183, amounts: [1200, 1200] },
      { start: 2188, amounts: [15000] },
    ]);
    expect("contract" in p).toBe(false);
  });

  test("legacy: writes the single contract field", () => {
    const p: { contract?: { amount?: number; exp?: number } } = { contract: { amount: 9970, exp: 2191 } };
    applySignedContract(p, 2187, 15, 1);
    expect(p.contract).toEqual({ amount: 15000, exp: 2188 });
  });
});
