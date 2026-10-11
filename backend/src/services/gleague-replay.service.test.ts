import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { ledgerToMoves, replayLedger } from "./gleague-replay.service.js";
import { buildAffiliateMap, type BbgmLeague } from "./gleague.service.js";
import { BBGM_TID } from "./gleague.constants.js";
import type { LedgerEntry } from "./gleague-season.service.js";

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8")) as BbgmLeague;

const fresh = () => ({ main: load("main-postdraft.fixture.json"), gl: load("gl.fixture.json") });

const assignRow = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  direction: "ASSIGN",
  playerKey: "chevy smith|2163",
  playerName: "Chevy Smith",
  bornYear: 2163,
  mainPid: 17335,
  glPid: null,
  mainTeamAbbrev: "BOS",
  glTeamAbbrev: "BOS",
  ovrAtMove: 52,
  ageAtMove: 24,
  snapContractAmount: 1,
  snapContractExp: 2191,
  snapWasRookie: false,
  ...over,
});

describe("ledgerToMoves", () => {
  test("turns an assignment row into a move aimed at the right affiliate", () => {
    const { main, gl } = fresh();
    const map = buildAffiliateMap(main, gl);
    const moves = ledgerToMoves([assignRow()], map);

    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      direction: "ASSIGN",
      pid: 17335,
      glTid: gl.teams.find((t) => t.abbrev === "BOS")!.tid,
    });
  });

  test("turns a call-up row into a move carrying its snapshot", () => {
    const { main, gl } = fresh();
    const map = buildAffiliateMap(main, gl);
    const moves = ledgerToMoves(
      [
        assignRow({
          direction: "CALLUP",
          glPid: 4242,
          newContractYears: 3,
          snapContractAmount: 4.11,
          snapContractExp: 2191,
          snapWasRookie: true,
        }),
      ],
      map,
    );

    expect(moves[0]).toMatchObject({
      direction: "CALLUP",
      glPid: 4242,
      years: 3,
      snapshot: { amountM: 4.11, exp: 2191 },
      wasRookieContract: true,
    });
  });

  test("passes no snapshot for an original G-Leaguer's call-up", () => {
    const { main, gl } = fresh();
    const map = buildAffiliateMap(main, gl);
    const moves = ledgerToMoves(
      [
        assignRow({
          direction: "CALLUP",
          glPid: 4242,
          snapContractAmount: null,
          snapContractExp: null,
          newContractYears: 2,
        }),
      ],
      map,
    );
    expect((moves[0] as { snapshot: unknown }).snapshot).toBeNull();
  });

  test("skips a row naming a team that is not in the affiliate map", () => {
    const { main, gl } = fresh();
    const map = buildAffiliateMap(main, gl);
    expect(ledgerToMoves([assignRow({ glTeamAbbrev: "ZZZ", mainTeamAbbrev: "ZZZ" })], map)).toHaveLength(0);
  });
});

describe("replayLedger", () => {
  test("reproduces an assignment in both exports", () => {
    const { main, gl } = fresh();
    const res = replayLedger(main, gl, [assignRow()]);

    expect(res.errors).toStrictEqual([]);
    expect(main.players.find((p) => p.pid === 17335)!.tid).toBe(BBGM_TID.INACTIVE);
    expect(gl.players.some((p) => `${p.firstName} ${p.lastName}` === "Chevy Smith")).toBe(true);
  });

  // The ledger is ordered oldest-first on replay, so a player sent down and
  // later recalled must end up back on his club, not stuck in the G-League.
  test("replays an assignment followed by its call-up back to the main club", () => {
    const { main, gl } = fresh();
    const glBos = gl.teams.find((t) => t.abbrev === "BOS")!.tid;
    const mainBos = main.teams.find((t) => t.abbrev === "BOS")!.tid;

    const assigned = replayLedger(main, gl, [assignRow()]);
    const glPid = assigned.results[0].glPid!;

    replayLedger(main, gl, [
      assignRow({ direction: "CALLUP", glPid, newContractYears: 2 }),
    ]);

    const p = main.players.find((x) => x.pid === 17335)!;
    expect(p.tid).toBe(mainBos);
    expect(p.contract).toStrictEqual({ amount: 1000, exp: 2191 });
    expect(gl.players.find((x) => x.pid === glPid)!.tid).toBe(BBGM_TID.INACTIVE);
    expect(glBos).toBeGreaterThanOrEqual(0);
  });

  test("is deterministic — replaying the same ledger twice gives the same files", () => {
    const a = fresh();
    const b = fresh();
    const ledger = [assignRow(), assignRow({ playerKey: "jd waters|2163", playerName: "J.D. Waters", mainPid: 17337, mainTeamAbbrev: "NOP", glTeamAbbrev: "NOP" })];

    replayLedger(a.main, a.gl, ledger);
    replayLedger(b.main, b.gl, ledger);

    expect(JSON.stringify(a.main.players)).toBe(JSON.stringify(b.main.players));
    expect(JSON.stringify(a.gl.players)).toBe(JSON.stringify(b.gl.players));
  });

  test("reports a row it could not apply without abandoning the rest", () => {
    const { main, gl } = fresh();
    const res = replayLedger(main, gl, [
      assignRow({ mainPid: 999999, playerKey: "ghost|2000", playerName: "Ghost" }),
      assignRow(),
    ]);

    expect(res.errors).toHaveLength(1);
    expect(main.players.find((p) => p.pid === 17335)!.tid).toBe(BBGM_TID.INACTIVE);
  });

  test("leaves both exports untouched when the ledger is empty", () => {
    const { main, gl } = fresh();
    const before = { main: JSON.stringify(main.players), gl: JSON.stringify(gl.players) };
    replayLedger(main, gl, []);
    expect(JSON.stringify(main.players)).toBe(before.main);
    expect(JSON.stringify(gl.players)).toBe(before.gl);
  });
});

/**
 * Replay applies what the ledger recorded. A mod-priced call-up must come out
 * of every later download at the price the mod set — recomputing it from the
 * pay scale would quietly rewrite it to the minimum.
 */
describe("replay keeps the contract the mod chose", () => {
  test("a $15M call-up is still $15M after replay", () => {
    const { main, gl } = fresh();
    const glBos = gl.teams.find((t) => t.abbrev === "BOS")!.tid;
    const assigned = replayLedger(main, gl, [assignRow()]);
    const glPid = assigned.results[0].glPid!;
    expect(glBos).toBeGreaterThanOrEqual(0);

    // Snapshot expired, so a recompute would give the scale minimum instead.
    replayLedger(main, gl, [
      assignRow({
        direction: "CALLUP",
        glPid,
        snapContractExp: 2180,
        newContractYears: 4,
        newContractAmount: 15,
        newContractExp: 2191,
        contractSource: "PAYSCALE",
      }),
    ]);

    expect(main.players.find((p) => p.pid === 17335)!.contract).toStrictEqual({
      amount: 15000,
      exp: 2191,
    });
  });

  test("ledgerToMoves carries the stored contract onto the move", () => {
    const { main, gl } = fresh();
    const map = buildAffiliateMap(main, gl);
    const [m] = ledgerToMoves(
      [
        assignRow({
          direction: "CALLUP",
          glPid: 4242,
          newContractYears: 3,
          newContractAmount: 9.5,
          newContractExp: 2190,
          contractSource: "PAYSCALE",
          rfaRightsLost: true,
        }),
      ],
      map,
    );
    expect(m).toMatchObject({
      direction: "CALLUP",
      fixedContract: { amountM: 9.5, exp: 2190, source: "PAYSCALE", rfaRightsLost: true },
    });
  });
});
