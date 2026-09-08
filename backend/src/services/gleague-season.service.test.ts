/**
 * Integration tests — these run against the Postgres in DATABASE_URL.
 * Locally that is `bgmdl_dev`, a restored copy of production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { glMoves, glTeams, seasons } from "../db/schema.js";
import {
  cacheGlTeams,
  latestAssignSnapshot,
  listMoves,
  recordMoves,
  setGlLeagueLink,
} from "./gleague-season.service.js";

let seasonId: number;

beforeAll(async () => {
  const [row] = await db
    .insert(seasons)
    .values({ seasonNumber: 9999, leagueLink: "https://example.test/main.json" })
    .returning();
  seasonId = row.id;
});

afterAll(async () => {
  await db.delete(seasons).where(eq(seasons.id, seasonId));
});

beforeEach(async () => {
  await db.delete(glMoves).where(eq(glMoves.seasonId, seasonId));
  await db.delete(glTeams).where(eq(glTeams.seasonId, seasonId));
});

describe("setGlLeagueLink", () => {
  test("stores the G-League export link on the season", async () => {
    const updated = await setGlLeagueLink(seasonId, "https://example.test/gl.json");
    expect(updated!.glLeagueLink).toBe("https://example.test/gl.json");
  });

  test("returns null for a season that does not exist", async () => {
    expect(await setGlLeagueLink(-1, "https://example.test/gl.json")).toBeNull();
  });
});

describe("cacheGlTeams", () => {
  const rosters = [
    {
      glTid: 18,
      glAbbrev: "NOP",
      glRegion: "(NOP) Birmingham",
      glName: "Brigade",
      mainAbbrev: "NOP",
      mainTid: 18,
      payrollM: 3.25,
      players: [{ pid: 1, name: "Danny Owens", ovr: 49, age: 22, assigned: false }],
    },
  ];

  test("writes one row per affiliate", async () => {
    await cacheGlTeams(seasonId, rosters);
    const rows = await db.select().from(glTeams).where(eq(glTeams.seasonId, seasonId));
    expect(rows).toHaveLength(1);
    expect(rows[0].glAbbrev).toBe("NOP");
    expect(rows[0].parentAbbrev).toBe("NOP");
    expect(Number(rows[0].totalSalary)).toBe(3.25);
  });

  test("replaces the previous cache rather than appending to it", async () => {
    await cacheGlTeams(seasonId, rosters);
    await cacheGlTeams(seasonId, rosters);
    const rows = await db.select().from(glTeams).where(eq(glTeams.seasonId, seasonId));
    expect(rows).toHaveLength(1);
  });
});

describe("recordMoves", () => {
  const assign = {
    direction: "ASSIGN" as const,
    playerKey: "chevy smith|2163",
    playerName: "Chevy Smith",
    bornYear: 2163,
    mainPid: 17335,
    glPid: 20001,
    mainTeamAbbrev: "BOS",
    glTeamAbbrev: "BOS",
    ovrAtMove: 52,
    ageAtMove: 24,
    snapContractAmount: 1,
    snapContractExp: 2191,
    snapWasRookie: false,
  };

  test("writes an assignment to the ledger as committed", async () => {
    await recordMoves(seasonId, [assign]);
    const rows = await listMoves(seasonId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("COMMITTED");
    expect(rows[0].direction).toBe("ASSIGN");
    expect(Number(rows[0].snapContractAmount)).toBe(1);
  });

  test("keeps the contract snapshot to the cent", async () => {
    await recordMoves(seasonId, [{ ...assign, snapContractAmount: 7.04 }]);
    const [row] = await listMoves(seasonId);
    expect(Number(row.snapContractAmount)).toBe(7.04);
  });

  test("records a call-up with its resolved contract", async () => {
    await recordMoves(seasonId, [
      {
        direction: "CALLUP",
        playerKey: "danny owens|2166",
        playerName: "Danny Owens",
        bornYear: 2166,
        mainPid: 30001,
        glPid: 17740,
        mainTeamAbbrev: "NOP",
        glTeamAbbrev: "NOP",
        ovrAtMove: 49,
        ageAtMove: 22,
        newContractAmount: 1,
        newContractExp: 2190,
        newContractYears: 2,
        contractSource: "MINIMUM",
        rfaRightsLost: true,
        forced: true,
      },
    ]);
    const [row] = await listMoves(seasonId);
    expect(row.contractSource).toBe("MINIMUM");
    expect(row.rfaRightsLost).toBe(true);
    expect(row.forced).toBe(true);
  });

  test("preserves a mod's override reason", async () => {
    await recordMoves(seasonId, [{ ...assign, overrideReason: "trade pending, roster fixes next sim" }]);
    const [row] = await listMoves(seasonId);
    expect(row.overrideReason).toBe("trade pending, roster fixes next sim");
  });

  test("writes a whole batch in one go", async () => {
    await recordMoves(seasonId, [assign, { ...assign, playerKey: "jd waters|2163", playerName: "J.D. Waters", mainPid: 17337 }]);
    expect(await listMoves(seasonId)).toHaveLength(2);
  });

  test("an empty batch is a no-op", async () => {
    await recordMoves(seasonId, []);
    expect(await listMoves(seasonId)).toHaveLength(0);
  });
});

describe("latestAssignSnapshot", () => {
  const assignOf = (over: Record<string, unknown> = {}) => ({
    direction: "ASSIGN" as const,
    playerKey: "chevy smith|2163",
    playerName: "Chevy Smith",
    bornYear: 2163,
    mainPid: 17335,
    glPid: 20001,
    mainTeamAbbrev: "BOS",
    glTeamAbbrev: "BOS",
    ovrAtMove: 52,
    ageAtMove: 24,
    snapContractAmount: 1,
    snapContractExp: 2191,
    snapWasRookie: false,
    ...over,
  });

  test("finds the contract a player carried when he was sent down", async () => {
    await recordMoves(seasonId, [assignOf()]);
    const snap = await latestAssignSnapshot(seasonId, "chevy smith|2163");
    expect(snap).toStrictEqual({ amountM: 1, exp: 2191, wasRookie: false, glPid: 20001, mainPid: 17335 });
  });

  test("returns the most recent assignment when a player has been down twice", async () => {
    await recordMoves(seasonId, [assignOf({ snapContractAmount: 1, snapContractExp: 2189 })]);
    await recordMoves(seasonId, [assignOf({ snapContractAmount: 4.5, snapContractExp: 2193 })]);
    const snap = await latestAssignSnapshot(seasonId, "chevy smith|2163");
    expect(snap!.amountM).toBe(4.5);
    expect(snap!.exp).toBe(2193);
  });

  test("returns null for a player who was never assigned", async () => {
    expect(await latestAssignSnapshot(seasonId, "nobody here|2000")).toBeNull();
  });

  // An original G-Leaguer has no assignment history, so a call-up of his must
  // fall through to the pay scale rather than restoring a phantom contract.
  test("ignores call-up rows when looking for a snapshot", async () => {
    await recordMoves(seasonId, [
      {
        direction: "CALLUP",
        playerKey: "danny owens|2166",
        playerName: "Danny Owens",
        bornYear: 2166,
        mainTeamAbbrev: "NOP",
        glTeamAbbrev: "NOP",
        ovrAtMove: 49,
        ageAtMove: 22,
        newContractAmount: 1,
        newContractExp: 2190,
        contractSource: "MINIMUM",
      },
    ]);
    expect(await latestAssignSnapshot(seasonId, "danny owens|2166")).toBeNull();
  });

  test("scopes snapshots to their season", async () => {
    await recordMoves(seasonId, [assignOf()]);
    expect(await latestAssignSnapshot(-1, "chevy smith|2163")).toBeNull();
  });
});
