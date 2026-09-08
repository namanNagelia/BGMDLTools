import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildAffiliateMap,
  buildAffiliateRosters,
  buildMainPayrolls,
  parentAbbrevOf,
  type BbgmLeague,
} from "./gleague.service.js";

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8")) as BbgmLeague;

const main = load("main-postdraft.fixture.json");
const gl = load("gl.fixture.json");

describe("parentAbbrevOf", () => {
  test("reads the parent tag out of a G-League team's region", () => {
    expect(parentAbbrevOf({ abbrev: "NOP", region: "(NOP) Birmingham", name: "Brigade" })).toBe("NOP");
  });

  test("falls back to the team's own abbrev when the region has no tag", () => {
    expect(parentAbbrevOf({ abbrev: "LAL", region: "South Bay", name: "Lakers" })).toBe("LAL");
  });

  test("prefers the region tag when it disagrees with the abbrev", () => {
    expect(parentAbbrevOf({ abbrev: "XXX", region: "(BOS) Maine", name: "Celtics" })).toBe("BOS");
  });
});

describe("buildAffiliateMap", () => {
  const map = buildAffiliateMap(main, gl);

  test("pairs all 30 G-League teams with their parent club", () => {
    expect(map.pairs).toHaveLength(30);
    expect(map.unmatchedGl).toStrictEqual([]);
    expect(map.unmatchedMain).toStrictEqual([]);
  });

  test("maps the Birmingham Brigade to New Orleans", () => {
    const nop = map.pairs.find((p) => p.mainAbbrev === "NOP")!;
    expect(nop.glAbbrev).toBe("NOP");
    expect(nop.glRegion).toContain("(NOP)");
  });

  test("resolves a parent tid from a G-League tid and back", () => {
    const nopMain = main.teams.find((t) => t.abbrev === "NOP")!;
    const nopGl = gl.teams.find((t) => t.abbrev === "NOP")!;
    expect(map.mainTidByGlTid.get(nopGl.tid)).toBe(nopMain.tid);
    expect(map.glTidByMainTid.get(nopMain.tid)).toBe(nopGl.tid);
  });

  test("reports G-League teams whose parent is missing from the main league", () => {
    const orphaned = structuredClone(gl);
    orphaned.teams[0] = { ...orphaned.teams[0], abbrev: "ZZZ", region: "(ZZZ) Nowhere" };
    const m = buildAffiliateMap(main, orphaned);
    expect(m.unmatchedGl).toStrictEqual(["ZZZ"]);
    expect(m.pairs).toHaveLength(29);
  });
});

describe("buildAffiliateRosters", () => {
  const map = buildAffiliateMap(main, gl);
  const rosters = buildAffiliateRosters(gl, map);

  test("groups G-League players onto their affiliate", () => {
    const nop = rosters.find((r) => r.mainAbbrev === "NOP")!;
    expect(nop.players).toHaveLength(7);
  });

  // watch === 1 is the flag BGMDL mods already use for assigned players;
  // unflagged players are original G-Leaguers.
  test("reads the assigned flag off BBGM's watch field", () => {
    const nop = rosters.find((r) => r.mainAbbrev === "NOP")!;
    expect(nop.players.filter((p) => p.assigned).length).toBeGreaterThan(0);
    expect(nop.assignedCount + nop.originalCount).toBe(nop.players.length);
  });

  test("reports each player's OVR, age and salary in $M", () => {
    const nop = rosters.find((r) => r.mainAbbrev === "NOP")!;
    const p = nop.players.find((x) => x.name === "Danny Owens")!;
    expect(p.ovr).toBe(49);
    expect(p.age).toBe(22);
    expect(p.salaryM).toBe(0.25);
  });

  test("includes affiliates with an empty roster", () => {
    expect(rosters).toHaveLength(30);
    expect(rosters.some((r) => r.players.length === 0)).toBe(true);
  });

  test("surfaces roster-shape warnings per affiliate", () => {
    const empty = rosters.find((r) => r.players.length === 0)!;
    expect(empty.violations.map((v) => v.code)).toContain("BELOW_MIN_ROSTER");
  });
});

describe("buildMainPayrolls", () => {
  const payrolls = buildMainPayrolls(main);

  test("sums each main-league roster's contracts into $M", () => {
    const nop = payrolls.get("NOP")!;
    expect(nop).toBeGreaterThan(0);
    expect(Number.isFinite(nop)).toBe(true);
  });

  test("excludes free agents and inactive players from payroll", () => {
    const withFa = structuredClone(main);
    const before = buildMainPayrolls(withFa).get("NOP")!;
    withFa.players.push({
      ...withFa.players.find((p) => p.tid >= 0)!,
      pid: 999999,
      tid: -1,
      contract: { amount: 50000, exp: 2191 },
    });
    expect(buildMainPayrolls(withFa).get("NOP")).toBe(before);
  });
});
