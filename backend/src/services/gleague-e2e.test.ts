/**
 * End-to-end: a real season row in Postgres, both BBGM exports, and the whole
 * assign → ledger → replay → download path.
 *
 * The exports are supplied through the injectable source rather than fetched,
 * so the test is hermetic; everything downstream of the fetch is the real code.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { glMoves, glTeams, seasons } from "../db/schema.js";
import {
  buildBoard,
  commitProposals,
  invalidateBoard,
  invalidateBoardOnly,
  loadPair,
  validateProposals,
} from "./gleague-board.service.js";
import { recordMoves, setGlLeagueLink } from "./gleague-season.service.js";
import { BBGM_TID } from "./gleague.constants.js";

const MAIN_URL = "https://fixture.test/main.json";
const GL_URL = "https://fixture.test/gl.json";

const files: Record<string, string> = {
  [MAIN_URL]: "main-postdraft.fixture.json",
  [GL_URL]: "gl.fixture.json",
};

/** Fresh parse per call — the services mutate what they are handed. */
const source = async (link: string) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${files[link]}`, import.meta.url), "utf8"));

const opts = { fetchJson: source };

let seasonId: number;

beforeAll(async () => {
  const [row] = await db
    .insert(seasons)
    .values({ seasonNumber: 9998, leagueLink: MAIN_URL })
    .returning();
  seasonId = row.id;
  await setGlLeagueLink(seasonId, GL_URL);
});

afterAll(async () => {
  await db.delete(seasons).where(eq(seasons.id, seasonId));
});

beforeEach(async () => {
  await db.delete(glMoves).where(eq(glMoves.seasonId, seasonId));
  await db.delete(glTeams).where(eq(glTeams.seasonId, seasonId));
  // These tests mutate the ledger directly, behind the board cache's back.
  invalidateBoard(seasonId);
});

/** Chevy Smith — BOS, 52 OVR, 24, $1M through 2191. */
const CHEVY = 17335;

describe("board", () => {
  test("pairs every affiliate and reports both seasons", async () => {
    const board = await buildBoard(seasonId, opts);
    expect(board.teams).toHaveLength(30);
    expect(board.mainSeason).toBe(2187);
    expect(board.glSeason).toBe(2188);
    expect(board.unmatchedGl).toStrictEqual([]);
    expect(board.unmatchedMain).toStrictEqual([]);
  });

  test("separates assignable players from blocked ones with a reason", async () => {
    const board = await buildBoard(seasonId, opts);
    const bos = board.teams.find((t) => t.mainAbbrev === "BOS")!;

    const chevy = bos.candidates.find((c) => c.pid === CHEVY)!;
    expect(chevy.eligible).toBe(true);

    const blocked = bos.candidates.filter((c) => !c.eligible);
    expect(blocked.length).toBeGreaterThan(0);
    for (const c of blocked) expect(c.violations.length).toBeGreaterThan(0);
  });

  test("marks rookie-contract players so the $5M waiver is visible", async () => {
    const board = await buildBoard(seasonId, opts);
    const nop = board.teams.find((t) => t.mainAbbrev === "NOP")!;
    // David Leary, $7.04M rookie deal — assignable despite the salary.
    const leary = nop.candidates.find((c) => c.name === "David Leary")!;
    expect(leary.onRookieDeal).toBe(true);
    expect(leary.salaryM).toBeGreaterThan(5);
    expect(leary.eligible).toBe(true);
  });

  test("reports hard-cap room against each club's payroll", async () => {
    const board = await buildBoard(seasonId, opts);
    const nop = board.teams.find((t) => t.mainAbbrev === "NOP")!;
    expect(nop.hardCapRoomM).toBeCloseTo(board.hardCapM - nop.mainPayrollM, 5);
  });

  test("caches the affiliate rosters to Postgres", async () => {
    await buildBoard(seasonId, opts);
    const rows = await db.select().from(glTeams).where(eq(glTeams.seasonId, seasonId));
    expect(rows).toHaveLength(30);
    expect(rows.every((r) => r.parentAbbrev.length > 0)).toBe(true);
  });
});

describe("validate", () => {
  test("passes a legal assignment", async () => {
    const { blocked, staged } = await validateProposals(
      seasonId,
      [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }],
      opts,
    );
    expect(blocked).toBe(false);
    expect(staged[0].playerName).toBe("Chevy Smith");
  });

  test("blocks an ineligible assignment and names the rule", async () => {
    // Tyrell Ard — 60 OVR, over the ceiling.
    const { blocked, staged } = await validateProposals(
      seasonId,
      [{ direction: "ASSIGN", pid: 17267, glAbbrev: "LAL" }],
      opts,
    );
    expect(blocked).toBe(true);
    expect(staged[0].violations.map((v) => v.code)).toContain("OVR_TOO_HIGH");
  });

  test("previews what a call-up would cost before committing", async () => {
    const board = await buildBoard(seasonId, opts);
    const nop = board.teams.find((t) => t.glAbbrev === "NOP")!;
    const target = nop.players[0];

    const { staged } = await validateProposals(
      seasonId,
      [{ direction: "CALLUP", glPid: target.pid, mainAbbrev: "NOP", years: 3 }],
      opts,
    );
    expect(staged[0].contract).toBeDefined();
    expect(staged[0].contract!.amountM).toBeGreaterThan(0);
  });
});

describe("commit and replay", () => {
  test("writes the assignment to the ledger with its contract snapshot", async () => {
    const { committed } = await commitProposals(
      seasonId,
      [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }],
      opts,
    );

    expect(committed).toHaveLength(1);
    expect(committed[0].direction).toBe("ASSIGN");
    expect(Number(committed[0].snapContractAmount)).toBe(1);
    expect(committed[0].snapContractExp).toBe(2191);
    expect(committed[0].playerName).toBe("Chevy Smith");
  });

  test("refuses to commit a batch containing a hard violation", async () => {
    await expect(
      commitProposals(
        seasonId,
        [
          { direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" },
          { direction: "ASSIGN", pid: 17267, glAbbrev: "LAL" },
        ],
        opts,
      ),
    ).rejects.toThrow(/hard rule/i);

    const rows = await db.select().from(glMoves).where(eq(glMoves.seasonId, seasonId));
    expect(rows).toHaveLength(0);
  });

  test("a committed assignment shows up in the next board load", async () => {
    await commitProposals(seasonId, [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }], opts);

    const board = await buildBoard(seasonId, opts);
    const bos = board.teams.find((t) => t.glAbbrev === "BOS")!;
    expect(bos.players.some((p) => p.name === "Chevy Smith")).toBe(true);
    expect(bos.candidates.some((c) => c.pid === CHEVY)).toBe(false);
  });

  test("the replayed exports agree about where the player is", async () => {
    await commitProposals(seasonId, [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }], opts);
    const { main, gl } = await loadPair(seasonId, opts);

    expect(main.players.find((p) => p.pid === CHEVY)!.tid).toBe(BBGM_TID.INACTIVE);
    const inGl = gl.players.filter((p) => `${p.firstName} ${p.lastName}` === "Chevy Smith" && p.tid >= 0);
    expect(inGl).toHaveLength(1);
  });

  test("assignment then call-up returns him to Boston on his old deal", async () => {
    await commitProposals(seasonId, [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }], opts);

    const board = await buildBoard(seasonId, opts);
    const bos = board.teams.find((t) => t.glAbbrev === "BOS")!;
    const chevyInGl = bos.players.find((p) => p.name === "Chevy Smith")!;

    await commitProposals(
      seasonId,
      [{ direction: "CALLUP", glPid: chevyInGl.pid, mainAbbrev: "BOS", years: 2 }],
      opts,
    );

    const { main } = await loadPair(seasonId, opts);
    const p = main.players.find((x) => x.pid === CHEVY)!;
    const bosTid = main.teams.find((t) => t.abbrev === "BOS")!.tid;

    expect(p.tid).toBe(bosTid);
    expect(p.contract).toStrictEqual({ amount: 1000, exp: 2191 });
  });

  test("the call-up ledger row records that the contract was restored", async () => {
    await commitProposals(seasonId, [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }], opts);
    const board = await buildBoard(seasonId, opts);
    const chevyInGl = board.teams
      .find((t) => t.glAbbrev === "BOS")!
      .players.find((p) => p.name === "Chevy Smith")!;

    const { committed } = await commitProposals(
      seasonId,
      [{ direction: "CALLUP", glPid: chevyInGl.pid, mainAbbrev: "BOS", years: 2 }],
      opts,
    );

    expect(committed[0].contractSource).toBe("RESTORED");
    expect(Number(committed[0].newContractAmount)).toBe(1);
    expect(committed[0].rfaRightsLost).toBe(false);
  });

  test("an override reason survives onto the ledger row", async () => {
    const { committed } = await commitProposals(
      seasonId,
      [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS", overrideReason: "roster fixed by trade" }],
      opts,
    );
    expect(committed[0].overrideReason).toBe("roster fixed by trade");
  });

  test("payroll drops by exactly the assigned player's salary", async () => {
    const before = (await buildBoard(seasonId, opts)).teams.find((t) => t.mainAbbrev === "BOS")!;
    await commitProposals(seasonId, [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }], opts);
    const after = (await buildBoard(seasonId, opts)).teams.find((t) => t.mainAbbrev === "BOS")!;

    expect(after.mainPayrollM).toBeCloseTo(before.mainPayrollM - 1, 5);
  });
});

/**
 * GMs no longer submit requests, but the 2189 ledger still holds some from
 * before the change. A row that is not COMMITTED must never reach an export.
 */
describe("leftover pending rows never reach an export", () => {
  test("a PROPOSED assignment leaves both exports untouched", async () => {
    const [r] = await recordMoves(seasonId, [
      {
        direction: "ASSIGN",
        playerKey: "j.d. waters|2163",
        playerName: "J.D. Waters",
        bornYear: 2163,
        mainPid: 17337,
        mainTeamAbbrev: "NOP",
        glTeamAbbrev: "NOP",
        ovrAtMove: 45,
        ageAtMove: 24,
        snapContractAmount: 1,
        snapContractExp: 2189,
      },
    ]);
    await db.update(glMoves).set({ status: "PROPOSED" }).where(eq(glMoves.id, r.id));
    invalidateBoard(seasonId);

    const { main, gl } = await loadPair(seasonId, opts);
    expect(main.players.find((x) => x.pid === 17337)!.tid).toBeGreaterThanOrEqual(0);
    expect(
      gl.players.some((x) => `${x.firstName} ${x.lastName}` === "J.D. Waters" && x.tid >= 0),
    ).toBe(false);
  });
});

/**
 * The public page can't refetch ~300MB of BBGM per visitor. The built board is
 * cached per season and invalidated whenever the ledger changes.
 */
describe("board cache", () => {
  let fetches = 0;
  const counting = {
    fetchJson: async (link: string) => {
      fetches++;
      return source(link);
    },
  };

  beforeEach(() => {
    fetches = 0;
    invalidateBoard(seasonId);
  });

  test("a second load serves from cache without refetching the exports", async () => {
    await buildBoard(seasonId, counting);
    const after1 = fetches;
    await buildBoard(seasonId, counting);

    expect(after1).toBeGreaterThan(0);
    expect(fetches).toBe(after1);
  });

  test("the cached board has the same contents as the first build", async () => {
    const a = await buildBoard(seasonId, counting);
    const b = await buildBoard(seasonId, counting);
    expect(b.teams).toHaveLength(a.teams.length);
    expect(b.mainSeason).toBe(a.mainSeason);
  });

  test("committing a move invalidates it, so the next board reflects the change", async () => {
    const before = await buildBoard(seasonId, counting);
    const bosBefore = before.teams.find((t) => t.glAbbrev === "BOS")!.players.length;

    await commitProposals(seasonId, [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }], counting);

    const after = await buildBoard(seasonId, counting);
    expect(after.teams.find((t) => t.glAbbrev === "BOS")!.players).toHaveLength(bosBefore + 1);
  });

  // A mod edits a call-up price and the batch re-validates on every change.
  // That must not refetch ~300MB of BBGM each time.
  test("validating a batch reuses the cached exports", async () => {
    await buildBoard(seasonId, counting);
    const after = fetches;
    await validateProposals(seasonId, [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }], counting);
    await validateProposals(seasonId, [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }], counting);
    expect(fetches).toBe(after);
  });

  test("validating does not alter the cached exports", async () => {
    const before = await buildBoard(seasonId, counting);
    const n = before.teams.find((t) => t.glAbbrev === "BOS")!.players.length;
    await validateProposals(seasonId, [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }], counting);
    invalidateBoardOnly(seasonId);
    const after = await buildBoard(seasonId, counting);
    expect(after.teams.find((t) => t.glAbbrev === "BOS")!.players).toHaveLength(n);
  });

  test("a commit drops the cached exports so the next validate sees it", async () => {
    await buildBoard(seasonId, counting);
    await commitProposals(seasonId, [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }], counting);
    const { blocked, staged } = await validateProposals(
      seasonId,
      [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }],
      counting,
    );
    expect(blocked).toBe(true);
    expect(staged[0].violations.map((v) => v.code)).toContain("ALREADY_ASSIGNED");
  });

  test("forcing a refresh refetches even when a cached board exists", async () => {
    await buildBoard(seasonId, counting);
    const after1 = fetches;
    await buildBoard(seasonId, { ...counting, fresh: true });
    expect(fetches).toBeGreaterThan(after1);
  });
});

/**
 * The duplicate that corrupted a real 2189 export: Lyndell Priester was called
 * up twice and ended up on New Orleans twice, at $13M and $7M. Blocked at
 * validation so a GM is told immediately, not at apply time.
 */
describe("duplicate moves are rejected up front", () => {
  test("calling up a player who is not on an affiliate is a hard block", async () => {
    const board = await buildBoard(seasonId, opts);
    const bos = board.teams.find((t) => t.glAbbrev === "BOS")!;
    const p = bos.players[0];

    await commitProposals(
      seasonId,
      [{ direction: "CALLUP", glPid: p.pid, mainAbbrev: "BOS", years: 2 }],
      opts,
    );

    const { staged, blocked } = await validateProposals(
      seasonId,
      [{ direction: "CALLUP", glPid: p.pid, mainAbbrev: "BOS", years: 2 }],
      opts,
    );
    expect(blocked).toBe(true);
    expect(staged[0].violations.map((v) => v.code)).toContain("NOT_ON_AFFILIATE");
  });

  test("a second commit cannot duplicate him onto the main roster", async () => {
    const board = await buildBoard(seasonId, opts);
    const bos = board.teams.find((t) => t.glAbbrev === "BOS")!;
    const p = bos.players[0];
    const move = { direction: "CALLUP" as const, glPid: p.pid, mainAbbrev: "BOS", years: 2 };

    await commitProposals(seasonId, [move], opts);
    await expect(commitProposals(seasonId, [move], opts)).rejects.toThrow(/hard rule/i);

    const { main } = await loadPair(seasonId, opts);
    const active = main.players.filter(
      (x) => `${x.firstName} ${x.lastName}` === p.name && x.tid >= 0,
    );
    expect(active).toHaveLength(1);
  });

  test("assigning a player who is already in the G-League is a hard block", async () => {
    await commitProposals(seasonId, [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }], opts);
    const { staged, blocked } = await validateProposals(
      seasonId,
      [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }],
      opts,
    );
    expect(blocked).toBe(true);
    expect(staged[0].violations.map((v) => v.code)).toContain("ALREADY_ASSIGNED");
  });

  test("releasing a player who is already gone is a hard block", async () => {
    const board = await buildBoard(seasonId, opts);
    const bos = board.teams.find((t) => t.glAbbrev === "BOS")!;
    const p = bos.players[0];

    await commitProposals(
      seasonId,
      [{ direction: "RELEASE", glPid: p.pid, mainAbbrev: "BOS" }],
      opts,
    );
    const { blocked } = await validateProposals(
      seasonId,
      [{ direction: "RELEASE", glPid: p.pid, mainAbbrev: "BOS" }],
      opts,
    );
    expect(blocked).toBe(true);
  });
});

/**
 * Mod-priced call-ups, end to end: the mod's figure is validated against the
 * pay scale, committed, and comes out of the downloaded export unchanged.
 */
describe("call-up contract set by the mod", () => {
  const tyPid = async () => {
    const board = await buildBoard(seasonId, opts);
    return board.teams.find((t) => t.glAbbrev === "NOP")!.players.find((p) => p.name === "Ty Christiansen")!.pid;
  };

  test("preview tells the mod what he can choose: floor per length, max, no deal to keep", async () => {
    const glPid = await tyPid();
    const { staged } = await validateProposals(
      seasonId,
      [{ direction: "CALLUP", glPid, mainAbbrev: "NOP", years: 2 }],
      opts,
    );
    const o = staged[0].contractOptions!;
    expect(o.current).toBeNull();
    expect(o.rookieLocked).toBe(false);
    expect(o.maxM).toBe(33);
    // Ty is 51 OVR — under the scale, so every length floors at the $1M minimum.
    expect(o.floorByYears).toStrictEqual({ 2: 1, 3: 1, 4: 1, 5: 1 });
  });

  test("a deal above the floor commits at the mod's figure and reaches the export", async () => {
    const glPid = await tyPid();
    const { committed } = await commitProposals(
      seasonId,
      [
        {
          direction: "CALLUP",
          glPid,
          mainAbbrev: "NOP",
          years: 3,
          contract: { mode: "NEW", years: 3, amountM: 4.5 },
        },
      ],
      opts,
    );
    expect(Number(committed[0].newContractAmount)).toBe(4.5);
    expect(committed[0].newContractYears).toBe(3);

    const { main } = await loadPair(seasonId, opts);
    const ty = main.players.find((p) => `${p.firstName} ${p.lastName}` === "Ty Christiansen" && p.tid >= 0)!;
    expect(ty.contract).toStrictEqual({ amount: 4500, exp: 2190 });
  });

  test("blocks a deal under the floor", async () => {
    const glPid = await tyPid();
    const { blocked, staged } = await validateProposals(
      seasonId,
      [{ direction: "CALLUP", glPid, mainAbbrev: "NOP", years: 2, contract: { mode: "NEW", years: 2, amountM: 0.5 } }],
      opts,
    );
    expect(blocked).toBe(true);
    expect(staged[0].violations.map((v) => v.code)).toContain("BELOW_SCALE");
  });

  test("blocks a deal over the max", async () => {
    const glPid = await tyPid();
    const { staged } = await validateProposals(
      seasonId,
      [{ direction: "CALLUP", glPid, mainAbbrev: "NOP", years: 5, contract: { mode: "NEW", years: 5, amountM: 40 } }],
      opts,
    );
    expect(staged[0].violations.map((v) => v.code)).toContain("ABOVE_MAX");
  });

  // David Leary: $7.04M rookie deal through 2190, assignable via the waiver.
  test("a running rookie deal is locked — NEW is refused, KEEP restores it", async () => {
    const board = await buildBoard(seasonId, opts);
    const leary = board.teams.find((t) => t.mainAbbrev === "NOP")!.candidates.find((c) => c.name === "David Leary")!;
    await commitProposals(seasonId, [{ direction: "ASSIGN", pid: leary.pid, glAbbrev: "NOP" }], opts);

    const after = await buildBoard(seasonId, opts);
    const glPid = after.teams.find((t) => t.glAbbrev === "NOP")!.players.find((p) => p.name === "David Leary")!.pid;

    const tryNew = await validateProposals(
      seasonId,
      [{ direction: "CALLUP", glPid, mainAbbrev: "NOP", years: 3, contract: { mode: "NEW", years: 3, amountM: 12 } }],
      opts,
    );
    expect(tryNew.staged[0].violations.map((v) => v.code)).toContain("ROOKIE_LOCKED");
    expect(tryNew.staged[0].contractOptions!.rookieLocked).toBe(true);

    const { committed } = await commitProposals(
      seasonId,
      [{ direction: "CALLUP", glPid, mainAbbrev: "NOP", years: 2, contract: { mode: "KEEP" } }],
      opts,
    );
    expect(committed[0].contractSource).toBe("RESTORED");
    expect(Number(committed[0].newContractAmount)).toBe(7.04);
  });

  test("a running non-rookie deal can be replaced", async () => {
    await commitProposals(seasonId, [{ direction: "ASSIGN", pid: CHEVY, glAbbrev: "BOS" }], opts);
    const board = await buildBoard(seasonId, opts);
    const glPid = board.teams.find((t) => t.glAbbrev === "BOS")!.players.find((p) => p.name === "Chevy Smith")!.pid;

    const { staged } = await validateProposals(
      seasonId,
      [{ direction: "CALLUP", glPid, mainAbbrev: "BOS", years: 2 }],
      opts,
    );
    expect(staged[0].contractOptions!.current).toStrictEqual({ amountM: 1, exp: 2191 });

    const { committed } = await commitProposals(
      seasonId,
      [{ direction: "CALLUP", glPid, mainAbbrev: "BOS", years: 4, contract: { mode: "NEW", years: 4, amountM: 3 } }],
      opts,
    );
    expect(Number(committed[0].newContractAmount)).toBe(3);
    const { main } = await loadPair(seasonId, opts);
    expect(main.players.find((p) => p.pid === CHEVY)!.contract).toStrictEqual({ amount: 3000, exp: 2191 });
  });
});
