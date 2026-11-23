import { describe, expect, test } from "vitest";
import { buildTeamPayrolls } from "./fa.service.js";

describe("buildTeamPayrolls", () => {
  const teams = [{ tid: 0, abbrev: "NOP", region: "New Orleans", name: "Pelicans" }];

  test("reads the v75 contracts history (latest entry)", () => {
    const players = [
      { pid: 1, tid: 0, contracts: [{ start: 2185, amounts: [5000] }, { start: 2191, amounts: [33000, 33000] }] },
    ];
    const [nop] = buildTeamPayrolls({ teams, players }, 2191);
    expect(nop.totalSalaryMillions).toBe(33);
    expect(nop.roster[0].contractExp).toBe(2192);
  });

  test("still reads the legacy contract field", () => {
    const players = [{ pid: 1, tid: 0, contract: { amount: 1500, exp: 2193 } }];
    const [nop] = buildTeamPayrolls({ teams, players }, 2191);
    expect(nop.totalSalaryMillions).toBe(1.5);
    expect(nop.roster[0].contractExp).toBe(2193);
  });
});
