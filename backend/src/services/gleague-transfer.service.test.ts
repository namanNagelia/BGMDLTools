import { beforeEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { applyMoves } from "./gleague-transfer.service.js";
import { buildAffiliateMap, type BbgmLeague } from "./gleague.service.js";
import { BBGM_TID } from "./gleague.constants.js";

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8")) as BbgmLeague;

let main: BbgmLeague;
let gl: BbgmLeague;

beforeEach(() => {
  main = load("main-postdraft.fixture.json");
  gl = load("gl.fixture.json");
});

const mainPid = (pid: number) => main.players.find((p) => p.pid === pid)!;
const glNamed = (name: string) =>
  gl.players.find((p) => `${p.firstName} ${p.lastName}` === name && p.tid >= 0)!;
const tidOf = (l: BbgmLeague, abbrev: string) => l.teams.find((t) => t.abbrev === abbrev)!.tid;
const nameOf = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

/** Chevy Smith — BOS, 52 OVR, 24yo, $1M through 2191. Cleanly assignable. */
const CHEVY = 17335;

describe("applyMoves — assignment", () => {
  test("parks the player in the main export instead of deleting him", () => {
    const before = main.players.length;
    applyMoves(main, gl, [{ direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") }]);

    expect(main.players).toHaveLength(before);
    const p = mainPid(CHEVY);
    expect(p.tid).toBe(BBGM_TID.INACTIVE);
    expect(p.watch).toBe(1);
  });

  test("preserves the main-league contract so a call-up can restore it", () => {
    applyMoves(main, gl, [{ direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") }]);
    expect(mainPid(CHEVY).contract).toStrictEqual({ amount: 1000, exp: 2191 });
  });

  test("drops the player off his main-league payroll", () => {
    const bos = tidOf(main, "BOS");
    const payroll = (l: BbgmLeague) =>
      l.players.filter((p) => p.tid === bos).reduce((s, p) => s + p.contract.amount, 0);
    const before = payroll(main);

    applyMoves(main, gl, [{ direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") }]);

    expect(payroll(main)).toBe(before - 1000);
  });

  test("adds the player to his affiliate with a fresh, unused G-League pid", () => {
    const maxGlPid = Math.max(...gl.players.map((p) => p.pid));
    const res = applyMoves(main, gl, [
      { direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") },
    ]);

    const added = gl.players.find((p) => p.pid > maxGlPid)!;
    expect(added).toBeDefined();
    expect(`${added.firstName} ${added.lastName}`).toBe("Chevy Smith");
    expect(added.tid).toBe(tidOf(gl, "BOS"));
    expect(added.watch).toBe(1);
    expect(res.results[0].glPid).toBe(added.pid);
    expect(new Set(gl.players.map((p) => p.pid)).size).toBe(gl.players.length);
  });

  // Rule #8 pay scale: 52 OVR is in the 50+ band, so $2M.
  test("pays the assigned player off the G-League scale, not his main deal", () => {
    applyMoves(main, gl, [{ direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") }]);
    const added = gl.players.find((p) => `${p.firstName} ${p.lastName}` === "Chevy Smith")!;
    expect(added.contract.amount).toBe(2000);
  });

  test("carries ratings and birth year but resets G-League stat history", () => {
    applyMoves(main, gl, [{ direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") }]);
    const added = gl.players.find((p) => `${p.firstName} ${p.lastName}` === "Chevy Smith")!;

    expect(added.born.year).toBe(mainPid(CHEVY).born.year);
    expect(added.ratings.at(-1)!.ovr).toBe(52);
    expect(added.stats).toStrictEqual([]);
    expect(added.statsTids).toStrictEqual([]);
  });

  test("records the contract snapshot the call-up will restore from", () => {
    const res = applyMoves(main, gl, [
      { direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") },
    ]);
    expect(res.results[0].snapshot).toStrictEqual({ amountM: 1, exp: 2191 });
  });

  test("refuses to assign a player who is not on a main-league roster", () => {
    const res = applyMoves(main, gl, [
      { direction: "ASSIGN", pid: 999999, glTid: tidOf(gl, "BOS") },
    ]);
    expect(res.results[0].error).toMatch(/not found/i);
    expect(res.errors).toHaveLength(1);
  });
});

describe("applyMoves — call-up", () => {
  // Ty Christiansen exists only in the G-League file — a true original with no
  // main-league record, so calling him up has to create one.
  test("moves an original G-Leaguer onto the main roster with a new pid", () => {
    const p = glNamed("Ty Christiansen");
    const maxMainPid = Math.max(...main.players.map((x) => x.pid));

    const res = applyMoves(main, gl, [
      {
        direction: "CALLUP",
        glPid: p.pid,
        mainTid: tidOf(main, "NOP"),
        years: 3,
        snapshot: null,
        wasRookieContract: false,
      },
    ]);

    const added = main.players.find((x) => x.pid > maxMainPid)!;
    expect(added.tid).toBe(tidOf(main, "NOP"));
    expect(nameOf(added)).toBe("Ty Christiansen");
    expect(res.results[0].mainPid).toBe(added.pid);
  });

  // Danny Owens already has a main-league record. Calling him up must reuse it
  // rather than adding a second one under a fresh pid.
  test("reuses an existing main-league record instead of creating a second", () => {
    const p = glNamed("Danny Owens");
    const before = main.players.filter((x) => nameOf(x) === "Danny Owens").length;

    applyMoves(main, gl, [
      {
        direction: "CALLUP",
        glPid: p.pid,
        mainTid: tidOf(main, "NOP"),
        years: 3,
        snapshot: null,
        wasRookieContract: false,
      },
    ]);

    const after = main.players.filter((x) => nameOf(x) === "Danny Owens");
    expect(after).toHaveLength(before);
    expect(after.filter((x) => x.tid >= 0)).toHaveLength(1);
  });

  test("parks the called-up player's G-League record instead of deleting it", () => {
    const p = glNamed("Danny Owens");
    const before = gl.players.length;

    applyMoves(main, gl, [
      {
        direction: "CALLUP",
        glPid: p.pid,
        mainTid: tidOf(main, "NOP"),
        years: 3,
        snapshot: null,
        wasRookieContract: false,
      },
    ]);

    expect(gl.players).toHaveLength(before);
    expect(gl.players.find((x) => x.pid === p.pid)!.tid).toBe(BBGM_TID.INACTIVE);
  });

  // Danny Owens is 49 OVR — below the 55 OVR floor of the call-up pay scale.
  test("blocks a call-up below the pay scale's minimum OVR", () => {
    const p = glNamed("Danny Owens");
    const res = applyMoves(main, gl, [
      {
        direction: "CALLUP",
        glPid: p.pid,
        mainTid: tidOf(main, "NOP"),
        years: 3,
        snapshot: null,
        wasRookieContract: false,
        enforcePayScale: true,
      },
    ]);
    expect(res.results[0].error).toMatch(/55/);
    expect(gl.players.find((x) => x.pid === p.pid)!.tid).toBeGreaterThanOrEqual(0);
  });

  test("clears the assigned flag when a player reaches the main league", () => {
    const p = glNamed("Ty Christiansen");
    applyMoves(main, gl, [
      {
        direction: "CALLUP",
        glPid: p.pid,
        mainTid: tidOf(main, "NOP"),
        years: 3,
        snapshot: null,
        wasRookieContract: false,
      },
    ]);
    const added = main.players.find((x) => nameOf(x) === "Ty Christiansen")!;
    expect(added.watch).toBeUndefined();
  });
});

describe("applyMoves — assign then call-up round trip", () => {
  test("returns the player to his old club on his original contract", () => {
    const glBos = tidOf(gl, "BOS");
    const mainBos = tidOf(main, "BOS");

    const assign = applyMoves(main, gl, [{ direction: "ASSIGN", pid: CHEVY, glTid: glBos }]);
    const { glPid, snapshot } = assign.results[0];

    const callup = applyMoves(main, gl, [
      {
        direction: "CALLUP",
        glPid: glPid!,
        mainTid: mainBos,
        years: 2,
        snapshot: snapshot!,
        wasRookieContract: false,
      },
    ]);

    const p = mainPid(CHEVY);
    expect(p.tid).toBe(mainBos);
    expect(p.contract).toStrictEqual({ amount: 1000, exp: 2191 });
    expect(p.watch).toBeUndefined();
    expect(callup.results[0].contractSource).toBe("RESTORED");
  });

  test("reuses the parked main record rather than creating a duplicate", () => {
    const before = main.players.length;
    const assign = applyMoves(main, gl, [
      { direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") },
    ]);
    applyMoves(main, gl, [
      {
        direction: "CALLUP",
        glPid: assign.results[0].glPid!,
        mainTid: tidOf(main, "BOS"),
        years: 2,
        snapshot: assign.results[0].snapshot!,
        wasRookieContract: false,
      },
    ]);

    expect(main.players).toHaveLength(before);
    expect(main.players.filter((p) => p.pid === CHEVY)).toHaveLength(1);
  });

  test("writes a pay-scale contract when the snapshot expired while he was down", () => {
    const assign = applyMoves(main, gl, [
      { direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") },
    ]);
    const callup = applyMoves(main, gl, [
      {
        direction: "CALLUP",
        glPid: assign.results[0].glPid!,
        mainTid: tidOf(main, "BOS"),
        years: 2,
        // Pretend his deal lapsed: OVR 52 is below the scale, so bump him to 57.
        snapshot: { amountM: 1, exp: 2186 },
        wasRookieContract: true,
        ovrOverride: 57,
      },
    ]);

    expect(callup.results[0].contractSource).toBe("PAYSCALE");
    expect(callup.results[0].rfaRightsLost).toBe(true);
    expect(mainPid(CHEVY).contract).toStrictEqual({ amount: 2000, exp: 2189 });
  });
});

describe("applyMoves — batch integrity", () => {
  test("applies every valid move and isolates the failures", () => {
    const res = applyMoves(main, gl, [
      { direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") },
      { direction: "ASSIGN", pid: 999999, glTid: tidOf(gl, "BOS") },
      { direction: "ASSIGN", pid: 17337, glTid: tidOf(gl, "NOP") },
    ]);

    expect(res.errors).toHaveLength(1);
    expect(res.results.filter((r) => !r.error)).toHaveLength(2);
    expect(mainPid(CHEVY).tid).toBe(BBGM_TID.INACTIVE);
    expect(mainPid(17337).tid).toBe(BBGM_TID.INACTIVE);
  });

  test("assigning two players to one affiliate gives them distinct pids", () => {
    const res = applyMoves(main, gl, [
      { direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") },
      { direction: "ASSIGN", pid: 17337, glTid: tidOf(gl, "BOS") },
    ]);
    const [a, b] = res.results;
    expect(a.glPid).not.toBe(b.glPid);
    expect(new Set(gl.players.map((p) => p.pid)).size).toBe(gl.players.length);
  });

  test("leaves the affiliate map intact after a batch", () => {
    applyMoves(main, gl, [{ direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") }]);
    const map = buildAffiliateMap(main, gl);
    expect(map.pairs).toHaveLength(30);
    expect(map.unmatchedGl).toStrictEqual([]);
  });
});

describe("applyMoves — release", () => {
  test("an original G-Leaguer goes to the G-League free agent pool", () => {
    const p = glNamed("Danny Owens");
    const before = gl.players.length;

    const res = applyMoves(main, gl, [{ direction: "RELEASE", glPid: p.pid }]);

    expect(res.errors).toStrictEqual([]);
    expect(gl.players).toHaveLength(before);
    expect(gl.players.find((x) => x.pid === p.pid)!.tid).toBe(BBGM_TID.FREE_AGENT);
  });

  test("he leaves the affiliate roster", () => {
    const p = glNamed("Danny Owens");
    const tid = p.tid;
    applyMoves(main, gl, [{ direction: "RELEASE", glPid: p.pid }]);
    expect(gl.players.filter((x) => x.tid === tid).some((x) => x.pid === p.pid)).toBe(false);
  });

  /**
   * Releasing a player who was sent down cuts him from the organisation. If
   * only the G-League record were released, his main-league record would sit
   * parked at the inactive tid forever with no affiliate to recall him from.
   */
  test("releasing an assigned player also frees his parked main-league record", () => {
    const assign = applyMoves(main, gl, [
      { direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") },
    ]);
    expect(mainPid(CHEVY).tid).toBe(BBGM_TID.INACTIVE);

    applyMoves(main, gl, [{ direction: "RELEASE", glPid: assign.results[0].glPid! }]);

    expect(mainPid(CHEVY).tid).toBe(BBGM_TID.FREE_AGENT);
    expect(gl.players.find((x) => x.pid === assign.results[0].glPid)!.tid).toBe(
      BBGM_TID.FREE_AGENT,
    );
  });

  test("clears the assigned flag — he is nobody's farmhand now", () => {
    const assign = applyMoves(main, gl, [
      { direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") },
    ]);
    applyMoves(main, gl, [{ direction: "RELEASE", glPid: assign.results[0].glPid! }]);
    expect(gl.players.find((x) => x.pid === assign.results[0].glPid)!.watch).toBeUndefined();
  });

  test("reports a release of someone who is not there", () => {
    const res = applyMoves(main, gl, [{ direction: "RELEASE", glPid: 999999 }]);
    expect(res.results[0].error).toMatch(/not found/i);
  });

  test("names the released player in the result", () => {
    const p = glNamed("Danny Owens");
    const res = applyMoves(main, gl, [{ direction: "RELEASE", glPid: p.pid }]);
    expect(res.results[0]).toMatchObject({ direction: "RELEASE", playerName: "Danny Owens" });
  });
});

/**
 * A move must never duplicate a player. Two call-ups for the same man — a GM
 * submitting twice, or a mod approving a stale request — has to converge on one
 * record, not two. This corrupted a real 2189 export: Lyndell Priester ended up
 * on New Orleans twice, at $13M and $7M.
 */
describe("applyMoves — never duplicates a player", () => {
  const callUp = (glPid: number, years = 2) => ({
    direction: "CALLUP" as const,
    glPid,
    mainTid: tidOf(main, "BOS"),
    years,
    snapshot: null,
    wasRookieContract: false,
  });

  test("calling the same player up twice leaves one active main record", () => {
    const assign = applyMoves(main, gl, [
      { direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") },
    ]);
    const glPid = assign.results[0].glPid!;

    applyMoves(main, gl, [callUp(glPid)]);
    const after1 = main.players.filter((p) => p.pid === CHEVY || nameOf(p) === "Chevy Smith");
    applyMoves(main, gl, [callUp(glPid)]);
    const after2 = main.players.filter((p) => nameOf(p) === "Chevy Smith");

    expect(after1.filter((p) => p.tid >= 0)).toHaveLength(1);
    expect(after2.filter((p) => p.tid >= 0)).toHaveLength(1);
    expect(after2).toHaveLength(1);
  });

  test("the second call-up is reported as an error, not silently applied", () => {
    const assign = applyMoves(main, gl, [
      { direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") },
    ]);
    const glPid = assign.results[0].glPid!;
    applyMoves(main, gl, [callUp(glPid)]);

    const second = applyMoves(main, gl, [callUp(glPid)]);
    expect(second.results[0].error).toMatch(/not on an affiliate/i);
  });

  test("calling up someone who is not on an affiliate roster is refused", () => {
    const p = glNamed("Danny Owens");
    p.tid = BBGM_TID.FREE_AGENT; // already released
    const res = applyMoves(main, gl, [callUp(p.pid)]);
    expect(res.results[0].error).toMatch(/not on an affiliate/i);
  });

  test("releasing an already-released player is refused", () => {
    const p = glNamed("Danny Owens");
    applyMoves(main, gl, [{ direction: "RELEASE", glPid: p.pid }]);
    const again = applyMoves(main, gl, [{ direction: "RELEASE", glPid: p.pid }]);
    expect(again.results[0].error).toMatch(/not on an affiliate/i);
  });

  test("assigning the same player twice is refused the second time", () => {
    applyMoves(main, gl, [{ direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") }]);
    const second = applyMoves(main, gl, [
      { direction: "ASSIGN", pid: CHEVY, glTid: tidOf(gl, "BOS") },
    ]);
    expect(second.results[0].error).toBeDefined();
    expect(gl.players.filter((p) => nameOf(p) === "Chevy Smith" && p.tid >= 0)).toHaveLength(1);
  });
});
