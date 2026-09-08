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
import { buildBoard, commitProposals, loadPair, validateProposals } from "./gleague-board.service.js";
import { setGlLeagueLink } from "./gleague-season.service.js";
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
