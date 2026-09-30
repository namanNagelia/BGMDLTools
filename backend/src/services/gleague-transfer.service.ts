/**
 * Moves players between the main BGMDL export and the G-League export.
 *
 * The two files are independent BBGM leagues with independent pid spaces, so a
 * transfer is a cross-file copy, never an id edit. A player is never deleted:
 * the side he left keeps his record parked at BBGM's inactive tid, which drops
 * him off payroll and rosters while preserving his history for the return trip.
 */
import {
  BBGM_TID,
  glAssignedContractM,
  toBbgmAmount,
  fromBbgmAmount,
  MIN_CALLUP_OVR,
} from "./gleague.constants.js";
import {
  playerName,
  playerOvr,
  resolveCallUpContract,
  type BbgmPlayer,
} from "./gleague-rules.service.js";
import type { BbgmLeague } from "./gleague.service.js";

export type AssignMove = {
  direction: "ASSIGN";
  /** pid in the main export. */
  pid: number;
  /** Destination affiliate's tid in the G-League export. */
  glTid: number;
};

export type CallUpMove = {
  direction: "CALLUP";
  /** pid in the G-League export. */
  glPid: number;
  /** Destination club's tid in the main export. */
  mainTid: number;
  years: number;
  /** The main-league contract captured when he was assigned, if any. */
  snapshot: { amountM: number; exp: number } | null;
  wasRookieContract: boolean;
  /** Reject a call-up below the pay scale's 55 OVR floor (rule 8.2). */
  enforcePayScale?: boolean;
  /** Test/override hook for the OVR the pay scale is read at. */
  ovrOverride?: number;
};

export type ReleaseMove = {
  direction: "RELEASE";
  /** pid in the G-League export. */
  glPid: number;
};

export type GLeagueMove = AssignMove | CallUpMove | ReleaseMove;

export type MoveResult = {
  direction: "ASSIGN" | "CALLUP" | "RELEASE";
  playerName: string;
  mainPid?: number;
  glPid?: number;
  snapshot?: { amountM: number; exp: number } | null;
  contractSource?: "RESTORED" | "PAYSCALE" | "MINIMUM";
  contractAmountM?: number;
  contractExp?: number;
  rfaRightsLost?: boolean;
  error?: string;
};

export type ApplyResult = {
  results: MoveResult[];
  errors: string[];
};

const nextPid = (league: BbgmLeague): number =>
  league.players.reduce((max, p) => Math.max(max, p.pid), 0) + 1;

/**
 * Copy a player into the other league: identity and ability travel, league-bound
 * history does not. Keeping stats out means each league's record stays its own.
 */
function crossLeagueCopy(source: BbgmPlayer, pid: number, tid: number): BbgmPlayer {
  return {
    ...structuredClone(source),
    pid,
    tid,
    stats: [],
    statsTids: [],
    salaries: [],
    awards: [],
    transactions: [],
    rosterOrder: undefined,
    yearsFreeAgent: 0,
    numDaysFreeAgent: 0,
  };
}

function park(p: BbgmPlayer): void {
  p.tid = BBGM_TID.INACTIVE;
}

function applyAssign(main: BbgmLeague, gl: BbgmLeague, move: AssignMove): MoveResult {
  const source = main.players.find((p) => p.pid === move.pid);
  if (!source) {
    return { direction: "ASSIGN", playerName: `pid ${move.pid}`, error: `Player pid ${move.pid} not found in the main export` };
  }
  if (source.tid < 0) {
    return {
      direction: "ASSIGN",
      playerName: playerName(source),
      error: `${playerName(source)} is not on a main-league roster`,
    };
  }

  const name = playerName(source);
  const dupKey = `${name.toLowerCase()}|${source.born.year}`;
  if (
    gl.players.some(
      (p) => p.tid >= 0 && `${playerName(p).toLowerCase()}|${p.born.year}` === dupKey,
    )
  ) {
    return {
      direction: "ASSIGN",
      playerName: name,
      error: `${name} is already on a G-League roster`,
    };
  }

  const season = main.gameAttributes.season as number;
  const glSeason = gl.gameAttributes.season as number;
  const ovr = playerOvr(source, season);
  const snapshot = { amountM: fromBbgmAmount(source.contract.amount), exp: source.contract.exp };

  // Main side: park him. His contract stays on the record as the in-file
  // snapshot; payroll ignores him because he is no longer on a roster tid.
  park(source);
  source.watch = 1;

  // G-League side: a fresh record on the affiliate, paid off the GL scale.
  const glPid = nextPid(gl);
  const copy = crossLeagueCopy(source, glPid, move.glTid);
  copy.watch = 1;
  copy.contract = { amount: toBbgmAmount(glAssignedContractM(ovr)), exp: glSeason };
  gl.players.push(copy);

  return {
    direction: "ASSIGN",
    playerName: playerName(source),
    mainPid: source.pid,
    glPid,
    snapshot,
  };
}

function applyCallUp(main: BbgmLeague, gl: BbgmLeague, move: CallUpMove): MoveResult {
  const source = gl.players.find((p) => p.pid === move.glPid);
  if (!source) {
    return { direction: "CALLUP", playerName: `pid ${move.glPid}`, error: `Player pid ${move.glPid} not found in the G-League export` };
  }

  const name = playerName(source);
  if (source.tid < 0) {
    // Already called up, released, or never on a roster. Proceeding would
    // insert a second main-league record for a player who has one already.
    return {
      direction: "CALLUP",
      playerName: name,
      error: `${name} is not on an affiliate roster`,
    };
  }

  const mainSeason = main.gameAttributes.season as number;
  const glSeason = gl.gameAttributes.season as number;
  const ovr = move.ovrOverride ?? playerOvr(source, glSeason);

  // Rule 8.2 — a *direct* call-up needs 55 OVR. A forced call-up (he aged out
  // or outgrew the salary limit) has no such floor and signs for the minimum.
  if (move.enforcePayScale && ovr < MIN_CALLUP_OVR) {
    return {
      direction: "CALLUP",
      playerName: name,
      error: `${name} is ${ovr} OVR — a direct call-up requires ${MIN_CALLUP_OVR} OVR`,
    };
  }

  let contract;
  try {
    contract = resolveCallUpContract({
      snapshot: move.snapshot,
      ovr,
      years: move.years,
      season: mainSeason,
      wasRookieContract: move.wasRookieContract,
      minContractM: fromBbgmAmount((main.gameAttributes.minContract as number) ?? 1000),
    });
  } catch (err) {
    return { direction: "CALLUP", playerName: name, error: (err as Error).message };
  }

  // Reuse whatever record he already has in the main league — parked from an
  // earlier assignment, or active if something went sideways. Only a genuine
  // original G-Leaguer, with no main-league record at all, needs a new one.
  const key = `${name.toLowerCase()}|${source.born.year}`;
  const existing = main.players.find(
    (p) => `${playerName(p).toLowerCase()}|${p.born.year}` === key,
  );

  const target = existing ?? crossLeagueCopy(source, nextPid(main), move.mainTid);
  target.tid = move.mainTid;
  target.contract = { amount: toBbgmAmount(contract.amountM), exp: contract.exp };
  delete target.watch;
  if (!existing) main.players.push(target);

  park(source);

  return {
    direction: "CALLUP",
    playerName: name,
    mainPid: target.pid,
    glPid: source.pid,
    contractSource: contract.source,
    contractAmountM: contract.amountM,
    contractExp: contract.exp,
    rfaRightsLost: contract.rfaRightsLost,
  };
}

/**
 * Cut a player loose.
 *
 * His G-League record goes to the G-League free agent pool. If he was assigned
 * from the main league, the record parked there is freed too — releasing only
 * the G-League side would strand his main-league record at the inactive tid
 * with no affiliate left to recall him from.
 */
function applyRelease(main: BbgmLeague, gl: BbgmLeague, move: ReleaseMove): MoveResult {
  const source = gl.players.find((p) => p.pid === move.glPid);
  if (!source) {
    return {
      direction: "RELEASE",
      playerName: `pid ${move.glPid}`,
      error: `Player pid ${move.glPid} not found in the G-League export`,
    };
  }

  const name = playerName(source);
  if (source.tid < 0) {
    return {
      direction: "RELEASE",
      playerName: name,
      error: `${name} is not on an affiliate roster`,
    };
  }

  const wasAssigned = source.watch === 1;

  source.tid = BBGM_TID.FREE_AGENT;
  delete source.watch;

  let mainPid: number | undefined;
  if (wasAssigned) {
    const key = `${name.toLowerCase()}|${source.born.year}`;
    const parked = main.players.find(
      (p) =>
        p.tid === BBGM_TID.INACTIVE &&
        `${playerName(p).toLowerCase()}|${p.born.year}` === key,
    );
    if (parked) {
      parked.tid = BBGM_TID.FREE_AGENT;
      delete parked.watch;
      mainPid = parked.pid;
    }
  }

  return { direction: "RELEASE", playerName: name, glPid: source.pid, mainPid };
}

/**
 * Apply a batch in order. A bad move is isolated — it is reported and skipped
 * so one typo can't sink an otherwise good preseason batch.
 */
export function applyMoves(
  main: BbgmLeague,
  gl: BbgmLeague,
  moves: GLeagueMove[],
): ApplyResult {
  const results: MoveResult[] = [];

  for (const move of moves) {
    if (move.direction === "ASSIGN") {
      results.push(applyAssign(main, gl, move));
    } else if (move.direction === "CALLUP") {
      results.push(applyCallUp(main, gl, move));
    } else {
      results.push(applyRelease(main, gl, move));
    }
  }

  return {
    results,
    errors: results.filter((r) => r.error).map((r) => r.error!),
  };
}
