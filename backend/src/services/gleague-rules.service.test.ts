import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildLeagueCtx,
  checkAffiliateRoster,
  checkAssignEligibility,
  callUpFloorM,
  checkCallUp,
  checkCallUpContract,
  checkRelease,
  detectForcedCallUps,
  projectRoster,
  isRookieContract,
  playerAge,
  playerOvr,
  resolveCallUpContract,
  topDraftClassPids,
  type BbgmPlayer,
} from "./gleague-rules.service.js";

const main = JSON.parse(
  readFileSync(new URL("./__fixtures__/main-postdraft.fixture.json", import.meta.url), "utf8"),
) as { gameAttributes: Record<string, unknown>; players: BbgmPlayer[] };

const ctx = buildLeagueCtx(main);
const byPid = (pid: number) => main.players.find((p) => p.pid === pid)!;

describe("player accessors", () => {
  test("reads OVR from the most recent ratings row", () => {
    expect(playerOvr(byPid(17335), ctx.season)).toBe(52); // Chevy Smith
  });

  test("derives age from birth year and season", () => {
    expect(playerAge(byPid(17335), ctx.season)).toBe(24);
  });
});

describe("buildLeagueCtx", () => {
  test("reads season and rookie contract lengths off gameAttributes", () => {
    expect(ctx.season).toBe(2187);
    expect(ctx.rookieContractLengths).toStrictEqual([4, 3]);
  });
});

describe("isRookieContract", () => {
  // David Leary: 2186 r1p4, contract exp 2190 == 2186 + 4y round-1 scale.
  test("recognises a first-round rookie deal running its scale length", () => {
    expect(isRookieContract(byPid(17637), ctx)).toBe(true);
  });

  // J.D. Waters: draft.round 0 — undrafted, so never on a rookie deal.
  test("an undrafted player is not on a rookie contract", () => {
    expect(isRookieContract(byPid(17337), ctx)).toBe(false);
  });

  // Connor Cherry: drafted 2175, contract exp 2188 — long past his rookie scale.
  test("a veteran re-signed years after his draft is not on a rookie contract", () => {
    expect(isRookieContract(byPid(16820), ctx)).toBe(false);
  });

  test("a drafted player who hit free agency since is not on a rookie contract", () => {
    const p = structuredClone(byPid(17637));
    p.transactions = [
      ...(p.transactions ?? []),
      { season: p.draft.year + 1, phase: 8, tid: p.tid, type: "freeAgent" },
    ];
    expect(isRookieContract(p, ctx)).toBe(false);
  });
});

describe("topDraftClassPids", () => {
  test("returns the top 5 of a draft class by current OVR", () => {
    const top = topDraftClassPids(main.players, 2184, ctx.season);
    expect(top).toContain(17499); // Richie Hamilton, 70
    expect(top).toContain(17491); // Porfirio Rubirosa, 61 — 5th
    expect(top).not.toContain(17470); // Kenny Jacques, 58 — 6th
  });

  // The 2187 class has two players tied at 42 OVR in the 5th slot. Rule #2 says
  // "top 5 (or tied)", so both are included and the set runs to 6.
  test("includes everyone tied at the cutoff", () => {
    const top = topDraftClassPids(main.players, 2187, ctx.season);
    expect(top).toContain(17739); // Tanner Reynaud, 42
    expect(top).toContain(17691); // Scotty Stevenson, 42
    expect(top.size).toBe(6);
  });
});

describe("checkAssignEligibility", () => {
  const codes = (p: BbgmPlayer, topPids = new Set<number>()) =>
    checkAssignEligibility(p, { ...ctx, topDraftClassPids: topPids }).map((v) => v.code);

  test("a 52 OVR, 24yo on $1M is assignable", () => {
    expect(codes(byPid(17335))).toStrictEqual([]); // Chevy Smith
  });

  test("blocks a player over the OVR ceiling", () => {
    expect(codes(byPid(17267))).toContain("OVR_TOO_HIGH"); // Tyrell Ard, 60
  });

  test("blocks a player over the age ceiling", () => {
    expect(codes(byPid(16820))).toContain("TOO_OLD"); // Connor Cherry, 31
  });

  test("blocks a non-rookie earning more than $5M", () => {
    const p = structuredClone(byPid(17335));
    p.contract = { amount: 6000, exp: 2191 };
    p.draft = { ...p.draft, round: 0, pick: 0 };
    expect(codes(p)).toContain("SALARY_TOO_HIGH");
  });

  // David Leary earns $7.04M — over the cap — but it is a rookie deal, and
  // rule #2 exempts rookie contracts from the $5M limit.
  test("allows a rookie-contract player earning more than $5M", () => {
    expect(codes(byPid(17637))).toStrictEqual([]);
  });

  // Danny Owens: drafted 2187 (this season), top 5 of his class by OVR.
  test("blocks a top-5 rookie in his first season", () => {
    const top = topDraftClassPids(main.players, 2187, ctx.season);
    expect(codes(byPid(17740), top)).toContain("TOP_DRAFT_CLASS_ROOKIE");
  });

  test("the top-5 block lapses after the rookie's first season", () => {
    const p = structuredClone(byPid(17740));
    p.draft = { ...p.draft, year: ctx.season - 1 };
    const top = topDraftClassPids(main.players, 2187, ctx.season);
    expect(codes(p, top)).not.toContain("TOP_DRAFT_CLASS_ROOKIE");
  });

  test("every assignment violation is a hard block", () => {
    const vs = checkAssignEligibility(byPid(16820), { ...ctx, topDraftClassPids: new Set() });
    expect(vs.length).toBeGreaterThan(0);
    expect(vs.every((v) => v.severity === "HARD")).toBe(true);
  });
});

describe("checkAffiliateRoster", () => {
  const roster = (assigned: number, original: number) => [
    ...Array.from({ length: assigned }, () => ({ assigned: true })),
    ...Array.from({ length: original }, () => ({ assigned: false })),
  ];

  test("5 assigned + 2 originals is the ideal roster", () => {
    expect(checkAffiliateRoster(roster(5, 2))).toStrictEqual([]);
  });

  test("warns when the roster is short of the 5-man minimum", () => {
    expect(checkAffiliateRoster(roster(2, 1)).map((v) => v.code)).toContain("BELOW_MIN_ROSTER");
  });

  test("warns when more than 5 players are assigned", () => {
    expect(checkAffiliateRoster(roster(6, 1)).map((v) => v.code)).toContain("TOO_MANY_ASSIGNED");
  });

  test("warns past the 7-man roster limit", () => {
    expect(checkAffiliateRoster(roster(5, 3)).map((v) => v.code)).toContain("ABOVE_MAX_ROSTER");
  });

  test("warns past the 10-man hoard limit", () => {
    expect(checkAffiliateRoster(roster(5, 6)).map((v) => v.code)).toContain("HOARD_LIMIT");
  });

  test("roster violations are soft — a mod can override them", () => {
    const vs = checkAffiliateRoster(roster(6, 5));
    expect(vs.length).toBeGreaterThan(0);
    expect(vs.every((v) => v.severity === "SOFT")).toBe(true);
  });
});

describe("resolveCallUpContract", () => {
  test("restores an unexpired main-league contract verbatim", () => {
    const r = resolveCallUpContract({
      snapshot: { amountM: 4.11, exp: 2191 },
      ovr: 58,
      years: 2,
      season: 2188,
      wasRookieContract: false,
    });
    expect(r).toMatchObject({ amountM: 4.11, exp: 2191, source: "RESTORED" });
  });

  test("a restored contract keeps its original value even when below the pay scale", () => {
    // $4.11M is far under the 58 OVR / 2Y minimum of $2M... and also under the
    // 5Y minimum of $8M. Restoration ignores the scale entirely.
    const r = resolveCallUpContract({
      snapshot: { amountM: 1, exp: 2189 },
      ovr: 65,
      years: 5,
      season: 2188,
      wasRookieContract: false,
    });
    expect(r.amountM).toBe(1);
    expect(r.source).toBe("RESTORED");
  });

  test("uses the pay scale when the snapshot has expired", () => {
    const r = resolveCallUpContract({
      snapshot: { amountM: 1, exp: 2187 },
      ovr: 63,
      years: 4,
      season: 2188,
      wasRookieContract: false,
    });
    expect(r).toMatchObject({ amountM: 22, exp: 2192, source: "PAYSCALE" });
  });

  test("uses the pay scale for an original G-Leaguer with no main-league history", () => {
    const r = resolveCallUpContract({
      snapshot: null,
      ovr: 55,
      years: 3,
      season: 2188,
      wasRookieContract: false,
    });
    expect(r).toMatchObject({ amountM: 3, exp: 2191, source: "PAYSCALE" });
  });

  // A forced call-up (rule #4 — he no longer meets the assign criteria because
  // he turned 27) can involve a sub-55 player, who has no pay scale entry.
  // He signs for the main league minimum.
  test("falls back to the league minimum for a player below the pay scale", () => {
    const r = resolveCallUpContract({
      snapshot: { amountM: 1, exp: 2187 },
      ovr: 49,
      years: 2,
      season: 2188,
      wasRookieContract: false,
      minContractM: 1,
    });
    expect(r).toMatchObject({ amountM: 1, exp: 2190, source: "MINIMUM" });
  });

  test("a below-scale call-up still restores an unexpired contract", () => {
    const r = resolveCallUpContract({
      snapshot: { amountM: 2.5, exp: 2191 },
      ovr: 49,
      years: 2,
      season: 2188,
      wasRookieContract: false,
      minContractM: 1,
    });
    expect(r).toMatchObject({ amountM: 2.5, source: "RESTORED" });
  });

  test("refuses a below-scale player when no league minimum is supplied", () => {
    expect(() =>
      resolveCallUpContract({
        snapshot: null,
        ovr: 49,
        years: 2,
        season: 2188,
        wasRookieContract: false,
      }),
    ).toThrow(/55/);
  });

  // Rule #5: "If a player's rookie contract expires while they are in the
  // G-League they then lose their RFA rights for the next time they are a FA."
  test("flags lost RFA rights when a rookie deal expired during the assignment", () => {
    const r = resolveCallUpContract({
      snapshot: { amountM: 3.24, exp: 2187 },
      ovr: 56,
      years: 2,
      season: 2188,
      wasRookieContract: true,
    });
    expect(r.rfaRightsLost).toBe(true);
    expect(r.source).toBe("PAYSCALE");
  });

  test("does not flag RFA rights when the rookie deal is still running", () => {
    const r = resolveCallUpContract({
      snapshot: { amountM: 3.24, exp: 2190 },
      ovr: 56,
      years: 2,
      season: 2188,
      wasRookieContract: true,
    });
    expect(r.rfaRightsLost).toBe(false);
    expect(r.source).toBe("RESTORED");
  });
});

describe("checkCallUp", () => {
  const base = {
    ovr: 60,
    payrollM: 100,
    contractM: 10,
    hardCapM: 130,
    seasonsServed: 1,
  };

  test("a clean call-up under the hard cap raises nothing", () => {
    expect(checkCallUp(base)).toStrictEqual([]);
  });

  // Rule #4: "You are allowed to go over the salary cap to call-up a player but
  // you are not allowed to go over the hard cap."
  test("blocks a call-up that breaches the hard cap", () => {
    const vs = checkCallUp({ ...base, payrollM: 125, contractM: 10 });
    expect(vs.map((v) => v.code)).toContain("OVER_HARD_CAP");
    expect(vs.find((v) => v.code === "OVER_HARD_CAP")!.severity).toBe("HARD");
  });

  test("landing exactly on the hard cap is legal", () => {
    expect(checkCallUp({ ...base, payrollM: 120, contractM: 10 })).toStrictEqual([]);
  });

  // Misc rules: "Assigned players have to play 1 season in G-League before
  // being eligible to be released" — a mid-season recall is a soft warning.
  test("warns when the player has not served a full G-League season", () => {
    const vs = checkCallUp({ ...base, seasonsServed: 0 });
    expect(vs.map((v) => v.code)).toContain("SEASON_NOT_SERVED");
    expect(vs.find((v) => v.code === "SEASON_NOT_SERVED")!.severity).toBe("SOFT");
  });
});

/**
 * Rule #4: "Players on your affiliate that do not meet assigning criteria
 * stated in point 2 in the future will be automatically called up."
 */
describe("detectForcedCallUps", () => {
  const p = (over: Partial<{ pid: number; ovr: number; age: number; assigned: boolean }>) => ({
    pid: 1,
    name: "Test Player",
    ovr: 40,
    age: 22,
    assigned: true,
    ...over,
  });

  test("leaves an assigned player who still meets the criteria alone", () => {
    expect(detectForcedCallUps([p({})])).toStrictEqual([]);
  });

  test("forces up an assigned player who outgrew the OVR ceiling", () => {
    const out = detectForcedCallUps([p({ pid: 7, ovr: 55 })]);
    expect(out).toHaveLength(1);
    expect(out[0].pid).toBe(7);
    expect(out[0].reasons).toContain("OVR_TOO_HIGH");
  });

  test("forces up an assigned player who aged out", () => {
    const out = detectForcedCallUps([p({ age: 27 })]);
    expect(out[0].reasons).toContain("TOO_OLD");
  });

  test("reports every reason a player no longer qualifies", () => {
    const out = detectForcedCallUps([p({ ovr: 60, age: 30 })]);
    expect(out[0].reasons).toStrictEqual(["OVR_TOO_HIGH", "TOO_OLD"]);
  });

  // Original G-Leaguers were never assigned, so the criteria never bound them.
  test("ignores unflagged original G-Leaguers however good they get", () => {
    expect(detectForcedCallUps([p({ ovr: 70, age: 35, assigned: false })])).toStrictEqual([]);
  });
});

/**
 * Misc rules: "Assigned players have to play 1 season in G-League before being
 * eligible to be released." We can check that exactly — if the player has an
 * ASSIGN row in this same season's ledger, he was sent down this preseason and
 * has not served anything yet.
 */
describe("checkRelease", () => {
  const base = { assigned: true, assignedThisSeason: false, rosterSizeAfter: 6 };

  test("an assigned player who has served a season can be released", () => {
    expect(checkRelease(base)).toStrictEqual([]);
  });

  test("blocks releasing a player sent down this same preseason", () => {
    const vs = checkRelease({ ...base, assignedThisSeason: true });
    expect(vs.map((v) => v.code)).toContain("SEASON_NOT_SERVED");
    expect(vs.find((v) => v.code === "SEASON_NOT_SERVED")!.severity).toBe("HARD");
  });

  // Original G-Leaguers were never assigned, so the service rule never applied.
  test("an original G-Leaguer can be released at any time", () => {
    expect(checkRelease({ assigned: false, assignedThisSeason: false, rosterSizeAfter: 6 })).toStrictEqual([]);
  });

  test("warns when the release would drop the roster under the minimum", () => {
    const vs = checkRelease({ ...base, rosterSizeAfter: 4 });
    expect(vs.map((v) => v.code)).toContain("BELOW_MIN_ROSTER");
    expect(vs.find((v) => v.code === "BELOW_MIN_ROSTER")!.severity).toBe("SOFT");
  });

  test("landing exactly on the 5-man minimum is fine", () => {
    expect(checkRelease({ ...base, rosterSizeAfter: 5 })).toStrictEqual([]);
  });
});

/**
 * Roster limits have to be judged on what the roster will look like AFTER the
 * whole staged batch lands, not on what it looks like now. Staging three
 * assignments onto a 7-man affiliate is the case that matters.
 */
describe("projectRoster", () => {
  const roster = (assigned: number, original: number) => [
    ...Array.from({ length: assigned }, (_, i) => ({ pid: i, assigned: true })),
    ...Array.from({ length: original }, (_, i) => ({ pid: 100 + i, assigned: false })),
  ];

  test("an assignment adds an assigned player", () => {
    const out = projectRoster(roster(4, 2), { assignIn: 1, callUpOut: [], releaseOut: [] });
    expect(out).toHaveLength(7);
    expect(out.filter((p) => p.assigned)).toHaveLength(5);
  });

  test("a call-up removes that player", () => {
    const out = projectRoster(roster(5, 2), { assignIn: 0, callUpOut: [0], releaseOut: [] });
    expect(out).toHaveLength(6);
    expect(out.some((p) => p.pid === 0)).toBe(false);
  });

  test("a release removes that player", () => {
    const out = projectRoster(roster(5, 2), { assignIn: 0, callUpOut: [], releaseOut: [100] });
    expect(out).toHaveLength(6);
  });

  test("a batch of three assignments onto a full roster overflows it", () => {
    const out = projectRoster(roster(5, 2), { assignIn: 3, callUpOut: [], releaseOut: [] });
    expect(out).toHaveLength(10);
    const codes = checkAffiliateRoster(out).map((v) => v.code);
    expect(codes).toContain("ABOVE_MAX_ROSTER");
    expect(codes).toContain("TOO_MANY_ASSIGNED");
  });

  test("assigning while calling one up keeps the roster legal", () => {
    const out = projectRoster(roster(5, 2), { assignIn: 1, callUpOut: [0], releaseOut: [] });
    expect(out).toHaveLength(7);
    expect(checkAffiliateRoster(out)).toStrictEqual([]);
  });

  test("emptying a roster trips the minimum", () => {
    const out = projectRoster(roster(2, 0), { assignIn: 0, callUpOut: [0, 1], releaseOut: [] });
    expect(out).toStrictEqual([]);
    expect(checkAffiliateRoster(out).map((v) => v.code)).toContain("BELOW_MIN_ROSTER");
  });
});

/**
 * Mod-chosen call-up contracts.
 *
 * A running rookie deal is locked — he goes back on it. Any other running deal
 * can be kept or replaced. An expired deal, or an original G-Leaguer with no
 * main-league history, gets a new deal. A new deal is priced by the mod with the
 * pay scale as the floor (league minimum under 55 OVR) and the league max as
 * the ceiling.
 */
describe("call-up contract choice", () => {
  const base = {
    snapshot: { amountM: 4, exp: 2191 },
    ovr: 59,
    years: 2,
    season: 2189,
    wasRookieContract: false,
    minContractM: 1,
  };

  describe("resolveCallUpContract", () => {
    test("KEEP restores a running contract", () => {
      expect(resolveCallUpContract({ ...base, choice: { mode: "KEEP" } })).toMatchObject({
        amountM: 4,
        exp: 2191,
        source: "RESTORED",
      });
    });

    test("NEW replaces a running non-rookie contract with the mod's figure", () => {
      const r = resolveCallUpContract({
        ...base,
        choice: { mode: "NEW", years: 3, amountM: 9.5 },
      });
      expect(r).toMatchObject({ amountM: 9.5, exp: 2192, source: "PAYSCALE" });
    });

    test("a running rookie deal is restored even if NEW was asked for", () => {
      const r = resolveCallUpContract({
        ...base,
        wasRookieContract: true,
        choice: { mode: "NEW", years: 5, amountM: 20 },
      });
      expect(r).toMatchObject({ amountM: 4, exp: 2191, source: "RESTORED" });
    });

    test("NEW on an expired deal uses the mod's figure and years", () => {
      const r = resolveCallUpContract({
        ...base,
        snapshot: { amountM: 1, exp: 2188 },
        choice: { mode: "NEW", years: 4, amountM: 12 },
      });
      expect(r).toMatchObject({ amountM: 12, exp: 2193, source: "PAYSCALE" });
    });

    test("an expired rookie deal still costs RFA rights when re-priced", () => {
      const r = resolveCallUpContract({
        ...base,
        snapshot: { amountM: 1, exp: 2188 },
        wasRookieContract: true,
        choice: { mode: "NEW", years: 2, amountM: 5 },
      });
      expect(r.rfaRightsLost).toBe(true);
    });

    test("no choice keeps today's defaults: restore if running, else scale minimum", () => {
      expect(resolveCallUpContract(base).source).toBe("RESTORED");
      expect(
        resolveCallUpContract({ ...base, snapshot: { amountM: 1, exp: 2188 } }),
      ).toMatchObject({ amountM: 4, source: "PAYSCALE" });
    });

    test("a sub-55 new deal is tagged MINIMUM-band but keeps the mod's figure", () => {
      const r = resolveCallUpContract({
        ...base,
        ovr: 50,
        snapshot: null,
        choice: { mode: "NEW", years: 2, amountM: 2.5 },
      });
      expect(r).toMatchObject({ amountM: 2.5, source: "MINIMUM" });
    });
  });

  describe("callUpFloorM", () => {
    test("is the pay scale at 55+ OVR", () => {
      expect(callUpFloorM(59, 3, 1)).toBe(7);
      expect(callUpFloorM(65, 5, 1)).toBe(33);
    });
    test("is the league minimum below 55 OVR", () => {
      expect(callUpFloorM(50, 3, 1)).toBe(1);
    });
  });

  describe("checkCallUpContract", () => {
    const ck = (over: Record<string, unknown>) =>
      checkCallUpContract({ ...base, maxContractM: 33, ...over } as never).map((v) => v.code);

    test("a NEW deal at the scale floor is clean", () => {
      expect(ck({ snapshot: null, choice: { mode: "NEW", years: 3, amountM: 7 } })).toStrictEqual([]);
    });

    test("a NEW deal above the floor is clean", () => {
      expect(ck({ snapshot: null, choice: { mode: "NEW", years: 5, amountM: 20 } })).toStrictEqual([]);
    });

    test("blocks a NEW deal below the pay scale floor", () => {
      expect(ck({ snapshot: null, choice: { mode: "NEW", years: 3, amountM: 6.99 } })).toContain(
        "BELOW_SCALE",
      );
    });

    test("blocks a NEW deal above the league max", () => {
      expect(ck({ snapshot: null, choice: { mode: "NEW", years: 5, amountM: 40 } })).toContain(
        "ABOVE_MAX",
      );
    });

    test("blocks re-pricing a running rookie deal", () => {
      expect(
        ck({ wasRookieContract: true, choice: { mode: "NEW", years: 3, amountM: 10 } }),
      ).toContain("ROOKIE_LOCKED");
    });

    test("KEEP on a running rookie deal is fine", () => {
      expect(ck({ wasRookieContract: true, choice: { mode: "KEEP" } })).toStrictEqual([]);
    });

    test("blocks KEEP when there is no running contract to keep", () => {
      expect(ck({ snapshot: { amountM: 1, exp: 2188 }, choice: { mode: "KEEP" } })).toContain(
        "NOTHING_TO_KEEP",
      );
      expect(ck({ snapshot: null, choice: { mode: "KEEP" } })).toContain("NOTHING_TO_KEEP");
    });

    test("blocks a contract length outside 2-5 years", () => {
      expect(ck({ snapshot: null, choice: { mode: "NEW", years: 6, amountM: 20 } })).toContain(
        "BAD_LENGTH",
      );
    });

    test("every contract problem is a hard block", () => {
      const vs = checkCallUpContract({
        ...base,
        maxContractM: 33,
        snapshot: null,
        choice: { mode: "NEW", years: 3, amountM: 1 },
      });
      expect(vs.length).toBeGreaterThan(0);
      expect(vs.every((v) => v.severity === "HARD")).toBe(true);
    });
  });
});
