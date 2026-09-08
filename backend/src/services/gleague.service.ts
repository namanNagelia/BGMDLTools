/**
 * Reads the two BBGM exports and derives the views the G-League console needs:
 * the affiliate pairing, each affiliate's roster, and main-league payrolls.
 *
 * The affiliate pairing needs no configuration. In the BGMDL exports a
 * G-League team carries its parent's abbrev *and* tags the parent in its
 * region — "(NOP) Birmingham". Both agree across all 30 teams.
 */
import {
  checkAffiliateRoster,
  playerAge,
  playerKey,
  playerName,
  playerOvr,
  type BbgmPlayer,
  type Violation,
} from "./gleague-rules.service.js";
import { fromBbgmAmount } from "./gleague.constants.js";

export type BbgmTeam = {
  tid: number;
  abbrev: string;
  region: string;
  name: string;
  disabled?: boolean;
  [key: string]: unknown;
};

export type BbgmLeague = {
  gameAttributes: Record<string, unknown>;
  teams: BbgmTeam[];
  players: BbgmPlayer[];
  [key: string]: unknown;
};

const PARENT_TAG = /^\((\w+)\)/;

/** The parent club's abbrev for a G-League team. Region tag wins; abbrev is the fallback. */
export function parentAbbrevOf(team: Pick<BbgmTeam, "abbrev" | "region" | "name">): string {
  return PARENT_TAG.exec(team.region ?? "")?.[1] ?? team.abbrev;
}

export type AffiliatePair = {
  mainTid: number;
  mainAbbrev: string;
  mainName: string;
  glTid: number;
  glAbbrev: string;
  glRegion: string;
  glName: string;
};

export type AffiliateMap = {
  pairs: AffiliatePair[];
  mainTidByGlTid: Map<number, number>;
  glTidByMainTid: Map<number, number>;
  /** G-League teams whose parent tag matches no main-league club. */
  unmatchedGl: string[];
  /** Main-league clubs with no G-League affiliate. */
  unmatchedMain: string[];
};

export function buildAffiliateMap(main: BbgmLeague, gl: BbgmLeague): AffiliateMap {
  const mainByAbbrev = new Map(main.teams.map((t) => [t.abbrev, t]));
  const pairs: AffiliatePair[] = [];
  const unmatchedGl: string[] = [];
  const pairedMain = new Set<string>();

  for (const glTeam of gl.teams) {
    const parent = parentAbbrevOf(glTeam);
    const mainTeam = mainByAbbrev.get(parent);
    if (!mainTeam) {
      unmatchedGl.push(parent);
      continue;
    }
    pairedMain.add(mainTeam.abbrev);
    pairs.push({
      mainTid: mainTeam.tid,
      mainAbbrev: mainTeam.abbrev,
      mainName: `${mainTeam.region} ${mainTeam.name}`.trim(),
      glTid: glTeam.tid,
      glAbbrev: glTeam.abbrev,
      glRegion: glTeam.region,
      glName: `${glTeam.region} ${glTeam.name}`.trim(),
    });
  }

  return {
    pairs,
    mainTidByGlTid: new Map(pairs.map((p) => [p.glTid, p.mainTid])),
    glTidByMainTid: new Map(pairs.map((p) => [p.mainTid, p.glTid])),
    unmatchedGl,
    unmatchedMain: main.teams.filter((t) => !pairedMain.has(t.abbrev)).map((t) => t.abbrev),
  };
}

export type AffiliatePlayer = {
  pid: number;
  key: string;
  name: string;
  ovr: number;
  age: number;
  salaryM: number;
  contractExp: number;
  /** BBGM's `watch` flag — set on players sent down from the main league. */
  assigned: boolean;
};

export type AffiliateRoster = AffiliatePair & {
  players: AffiliatePlayer[];
  assignedCount: number;
  originalCount: number;
  payrollM: number;
  violations: Violation[];
};

export function buildAffiliateRosters(gl: BbgmLeague, map: AffiliateMap): AffiliateRoster[] {
  const season = gl.gameAttributes.season as number;

  const byGlTid = new Map<number, AffiliatePlayer[]>();
  for (const p of gl.players) {
    if (p.tid < 0) continue;
    const list = byGlTid.get(p.tid) ?? [];
    list.push({
      pid: p.pid,
      key: playerKey(p),
      name: playerName(p),
      ovr: playerOvr(p, season),
      age: playerAge(p, season),
      salaryM: fromBbgmAmount(p.contract.amount),
      contractExp: p.contract.exp,
      assigned: p.watch === 1,
    });
    byGlTid.set(p.tid, list);
  }

  return map.pairs.map((pair) => {
    const players = (byGlTid.get(pair.glTid) ?? []).sort((a, b) => b.ovr - a.ovr);
    return {
      ...pair,
      players,
      assignedCount: players.filter((p) => p.assigned).length,
      originalCount: players.filter((p) => !p.assigned).length,
      payrollM: players.reduce((sum, p) => sum + p.salaryM, 0),
      violations: checkAffiliateRoster(players),
    };
  });
}

/** Main-league payroll per team abbrev, $M. Only rostered players count. */
export function buildMainPayrolls(main: BbgmLeague): Map<string, number> {
  const abbrevByTid = new Map(main.teams.map((t) => [t.tid, t.abbrev]));
  const out = new Map<string, number>();
  for (const t of main.teams) out.set(t.abbrev, 0);

  for (const p of main.players) {
    if (p.tid < 0) continue;
    const abbrev = abbrevByTid.get(p.tid);
    if (!abbrev) continue;
    out.set(abbrev, (out.get(abbrev) ?? 0) + fromBbgmAmount(p.contract.amount));
  }
  return out;
}
