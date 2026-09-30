/**
 * The G-League console's read model, and the commit path behind it.
 *
 * Both exports are fetched, the committed ledger is replayed onto them, and
 * everything the mod sees — affiliate rosters, assignable players, forced
 * call-ups — is derived from that post-replay state. So the board always shows
 * the league as it will actually come out the other side.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { glMoves, seasons } from "../db/schema.js";
import { fetchLeagueJson, LeagueFetchError } from "./league.service.js";
import { HARD_CAP } from "./cap.constants.js";
import {
  buildAffiliateMap,
  buildAffiliateRosters,
  buildMainPayrolls,
  type AffiliateMap,
  type AffiliateRoster,
  type BbgmLeague,
} from "./gleague.service.js";
import {
  buildLeagueCtx,
  checkAffiliateRoster,
  checkAssignEligibility,
  checkCallUp,
  checkRelease,
  detectForcedCallUps,
  projectRoster,
  isRookieContract,
  playerAge,
  playerKey,
  playerName,
  playerOvr,
  resolveCallUpContract,
  topDraftClassPids,
  type BbgmPlayer,
  type Violation,
} from "./gleague-rules.service.js";
import { fromBbgmAmount, GL_MIN_ROSTER, MIN_CALLUP_OVR } from "./gleague.constants.js";
import { applyMoves, type GLeagueMove } from "./gleague-transfer.service.js";
import { replayLedger } from "./gleague-replay.service.js";
import {
  cacheGlTeams,
  latestAssignSnapshot,
  listCommittedMoves,
  listMoves,
  listProposals,
  proposeMoves,
  recordMoves,
  type GlMove,
  type LedgerEntry,
  type Submitter,
} from "./gleague-season.service.js";

export type LoadedPair = {
  season: typeof seasons.$inferSelect;
  main: BbgmLeague;
  gl: BbgmLeague;
  map: AffiliateMap;
  ledger: GlMove[];
};

/**
 * How the two exports are obtained. Injectable so tests (and any future
 * caching layer) can supply the files without going over the network.
 */
export type LeagueSource = (link: string) => Promise<unknown>;
export type LoadOpts = {
  fetchJson?: LeagueSource;
  /** Skip the cached board and rebuild from the exports. */
  fresh?: boolean;
};

/**
 * Process-wide override for the export source, for tests that drive the HTTP
 * layer (where there is no call site to thread an option through). Null in
 * normal operation, which leaves the real fetcher in place.
 */
let testSource: LeagueSource | null = null;
export function setLeagueSourceForTesting(source: LeagueSource | null): void {
  testSource = source;
}

/** The season row alone — cheap, and enough to name a download. */
export async function getSeasonRow(seasonId: number) {
  const [row] = await db.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1);
  return row ?? null;
}

/** Fetch both exports and replay the committed ledger onto them. */
export async function loadPair(seasonId: number, opts: LoadOpts = {}): Promise<LoadedPair> {
  const fetchJson = opts.fetchJson ?? testSource ?? fetchLeagueJson;
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1);
  if (!season) throw new LeagueFetchError("Season not found", 404);
  if (!season.glLeagueLink) {
    throw new LeagueFetchError("No G-League export linked to this season", 400);
  }

  const [main, gl] = (await Promise.all([
    fetchJson(season.leagueLink),
    fetchJson(season.glLeagueLink),
  ])) as [BbgmLeague, BbgmLeague];

  for (const [label, file] of [["main", main], ["G-League", gl]] as const) {
    if (!Array.isArray(file.players) || !Array.isArray(file.teams)) {
      throw new LeagueFetchError(`The ${label} export has no players/teams array`, 422);
    }
  }

  // Only approved moves are applied. A GM's PROPOSED submission and anything
  // DECLINED stay out of the exports entirely — see listCommittedMoves.
  const applied = await listCommittedMoves(seasonId);
  replayLedger(main, gl, applied as unknown as LedgerEntry[]);

  // The mod's view of the ledger is the full history, pending rows included.
  const ledger = await listMoves(seasonId);
  return { season, main, gl, map: buildAffiliateMap(main, gl), ledger };
}

export type AssignCandidate = {
  pid: number;
  key: string;
  name: string;
  ovr: number;
  age: number;
  salaryM: number;
  contractExp: number;
  onRookieDeal: boolean;
  violations: Violation[];
  eligible: boolean;
};

export type BoardTeam = AffiliateRoster & {
  mainPayrollM: number;
  hardCapRoomM: number;
  candidates: AssignCandidate[];
  forced: ReturnType<typeof detectForcedCallUps>;
};

export type Board = {
  seasonId: number;
  /** How many GM submissions are waiting on a mod. */
  pendingCount: number;
  /** When this board was built — it is cached, so it can be a few minutes old. */
  builtAt: string;
  mainSeason: number;
  glSeason: number;
  hardCapM: number;
  minCallUpOvr: number;
  unmatchedGl: string[];
  unmatchedMain: string[];
  teams: BoardTeam[];
  ledger: GlMove[];
};

/**
 * Built boards, keyed by season.
 *
 * Building one costs two BBGM downloads — roughly 300MB and half a minute — so
 * the public page would be unusable without this. Correctness comes from
 * invalidating on every ledger write rather than from a TTL: a stale board here
 * would show a GM a player who has already been moved.
 */
const boardCache = new Map<number, Board>();

export function invalidateBoard(seasonId: number): void {
  boardCache.delete(seasonId);
}

export async function buildBoard(seasonId: number, opts: LoadOpts = {}): Promise<Board> {
  if (!opts.fresh) {
    const hit = boardCache.get(seasonId);
    if (hit) return hit;
  }
  const board = await buildBoardUncached(seasonId, opts);
  boardCache.set(seasonId, board);
  return board;
}

async function buildBoardUncached(seasonId: number, opts: LoadOpts = {}): Promise<Board> {
  const { main, gl, map, ledger } = await loadPair(seasonId, opts);
  const ctx = buildLeagueCtx(main);
  const rosters = buildAffiliateRosters(gl, map);
  const payrolls = buildMainPayrolls(main);

  // Only this season's rookies are frozen by the top-5 rule, so that is the
  // only draft class we need to rank.
  const topPids = topDraftClassPids(main.players, ctx.season, ctx.season);
  const assignCtx = { ...ctx, topDraftClassPids: topPids };

  const byMainTid = new Map<number, BbgmPlayer[]>();
  for (const p of main.players) {
    if (p.tid < 0) continue;
    const list = byMainTid.get(p.tid) ?? [];
    list.push(p);
    byMainTid.set(p.tid, list);
  }

  const teams: BoardTeam[] = rosters.map((roster) => {
    const squad = byMainTid.get(roster.mainTid) ?? [];
    const candidates: AssignCandidate[] = squad
      .map((p) => {
        const violations = checkAssignEligibility(p, assignCtx);
        return {
          pid: p.pid,
          key: playerKey(p),
          name: playerName(p),
          ovr: playerOvr(p, ctx.season),
          age: playerAge(p, ctx.season),
          salaryM: fromBbgmAmount(p.contract.amount),
          contractExp: p.contract.exp,
          onRookieDeal: isRookieContract(p, ctx),
          violations,
          eligible: violations.length === 0,
        };
      })
      .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.ovr - a.ovr);

    const mainPayrollM = payrolls.get(roster.mainAbbrev) ?? 0;
    return {
      ...roster,
      mainPayrollM,
      hardCapRoomM: HARD_CAP - mainPayrollM,
      candidates,
      forced: detectForcedCallUps(roster.players),
    };
  });

  await cacheGlTeams(
    seasonId,
    teams.map((t) => ({
      glTid: t.glTid,
      glAbbrev: t.glAbbrev,
      glRegion: t.glRegion,
      glName: t.glName,
      mainAbbrev: t.mainAbbrev,
      mainTid: t.mainTid,
      payrollM: t.payrollM,
      players: t.players,
    })),
  );

  return {
    seasonId,
    pendingCount: ledger.filter((r) => r.status === "PROPOSED").length,
    builtAt: new Date().toISOString(),
    mainSeason: ctx.season,
    glSeason: gl.gameAttributes.season as number,
    hardCapM: HARD_CAP,
    minCallUpOvr: MIN_CALLUP_OVR,
    unmatchedGl: map.unmatchedGl,
    unmatchedMain: map.unmatchedMain,
    teams,
    ledger,
  };
}

export type Proposal =
  | { direction: "ASSIGN"; pid: number; glAbbrev: string; overrideReason?: string }
  | {
      direction: "CALLUP";
      glPid: number;
      mainAbbrev: string;
      years: number;
      overrideReason?: string;
    }
  | { direction: "RELEASE"; glPid: number; mainAbbrev: string; overrideReason?: string };

/** Which affiliate a proposal acts on, by parent-club abbrev. */
function proposalTeam(p: Proposal, map: AffiliateMap): string | null {
  if (p.direction === "ASSIGN") {
    return map.pairs.find((x) => x.glAbbrev === p.glAbbrev)?.mainAbbrev ?? null;
  }
  return p.mainAbbrev;
}

export type StagedMove = {
  proposal: Proposal;
  /** Set on a release: was he sent down, or an original G-Leaguer? */
  wasAssigned?: boolean;
  playerName: string;
  ovr: number;
  age: number;
  violations: Violation[];
  blocked: boolean;
  /** What the call-up would cost, previewed before commit. */
  contract?: { amountM: number; exp: number; source: string; rfaRightsLost: boolean };
};

/**
 * Validate a batch without touching either export. Hard violations block the
 * commit; soft ones need an override reason, which the ledger records.
 */
export async function validateProposals(
  seasonId: number,
  proposals: Proposal[],
  opts: LoadOpts = {},
): Promise<{ staged: StagedMove[]; blocked: boolean }> {
  const { main, gl, map } = await loadPair(seasonId, opts);
  const ctx = buildLeagueCtx(main);
  const topPids = topDraftClassPids(main.players, ctx.season, ctx.season);
  const payrolls = buildMainPayrolls(main);
  const rosters = buildAffiliateRosters(gl, map);
  const minContractM = fromBbgmAmount((main.gameAttributes.minContract as number) ?? 1000);
  const glSeason = gl.gameAttributes.season as number;

  const staged: StagedMove[] = [];

  for (const proposal of proposals) {
    if (proposal.direction === "ASSIGN") {
      const p = main.players.find((x) => x.pid === proposal.pid);
      if (!p) {
        staged.push(notFound(proposal, `pid ${proposal.pid}`, "Player not in the main export"));
        continue;
      }
      staged.push({
        proposal,
        playerName: playerName(p),
        ovr: playerOvr(p, ctx.season),
        age: playerAge(p, ctx.season),
        violations: checkAssignEligibility(p, { ...ctx, topDraftClassPids: topPids }),
        blocked: false,
      });
      continue;
    }

    const p = gl.players.find((x) => x.pid === proposal.glPid);
    if (!p) {
      staged.push(notFound(proposal, `pid ${proposal.glPid}`, "Player not in the G-League export"));
      continue;
    }
    const ovr = playerOvr(p, glSeason);
    const snap = await latestAssignSnapshot(seasonId, playerKey(p));

    if (proposal.direction === "RELEASE") {
      staged.push({
        proposal,
        playerName: playerName(p),
        ovr,
        age: playerAge(p, glSeason),
        wasAssigned: p.watch === 1,
        // Roster size is projected below; this call only covers the service rule.
        violations: checkRelease({
          assigned: p.watch === 1,
          assignedThisSeason: snap != null,
          rosterSizeAfter: GL_MIN_ROSTER,
        }),
        blocked: false,
      });
      continue;
    }

    const contract = resolveCallUpContract({
      snapshot: snap ? { amountM: snap.amountM, exp: snap.exp } : null,
      ovr,
      years: proposal.years,
      season: ctx.season,
      wasRookieContract: snap?.wasRookie ?? false,
      minContractM,
    });

    staged.push({
      proposal,
      playerName: playerName(p),
      ovr,
      age: playerAge(p, glSeason),
      violations: checkCallUp({
        ovr,
        payrollM: payrolls.get(proposal.mainAbbrev) ?? 0,
        contractM: contract.amountM,
        hardCapM: HARD_CAP,
        // Service time is enforced on release, not on recall.
        seasonsServed: 1,
      }),
      blocked: false,
      contract: {
        amountM: contract.amountM,
        exp: contract.exp,
        source: contract.source,
        rfaRightsLost: contract.rfaRightsLost,
      },
    });
  }

  // Roster limits judged on the batch's result, not its starting point.
  attachProjectedRosterViolations(staged, rosters, map);

  for (const s of staged) s.blocked = s.violations.some((v) => v.severity === "HARD");
  return { staged, blocked: staged.some((s) => s.blocked) };
}

function notFound(proposal: Proposal, label: string, message: string): StagedMove {
  return {
    proposal,
    playerName: label,
    ovr: 0,
    age: 0,
    violations: [{ code: "NOT_FOUND", severity: "HARD", message }],
    blocked: true,
  };
}

/**
 * Judge each affiliate's roster on what the whole batch leaves behind.
 *
 * Staging three assignments onto a full affiliate is legal move-by-move and
 * illegal as a batch, so the limits have to be applied to the projection.
 */
function attachProjectedRosterViolations(
  staged: StagedMove[],
  rosters: AffiliateRoster[],
  map: AffiliateMap,
): void {
  const byTeam = new Map<string, StagedMove[]>();
  for (const s of staged) {
    if (s.violations.some((v) => v.code === "NOT_FOUND")) continue;
    const team = proposalTeam(s.proposal, map);
    if (!team) continue;
    byTeam.set(team, [...(byTeam.get(team) ?? []), s]);
  }

  for (const [team, moves] of byTeam) {
    const roster = rosters.find((r) => r.mainAbbrev === team);
    if (!roster) continue;

    const projected = projectRoster(roster.players, {
      assignIn: moves.filter((m) => m.proposal.direction === "ASSIGN").length,
      callUpOut: moves
        .filter((m) => m.proposal.direction === "CALLUP")
        .map((m) => (m.proposal as { glPid: number }).glPid),
      releaseOut: moves
        .filter((m) => m.proposal.direction === "RELEASE")
        .map((m) => (m.proposal as { glPid: number }).glPid),
    });

    const violations = checkAffiliateRoster(projected);
    if (!violations.length) continue;
    // Attach to every move in the batch — any one of them could be dropped to fix it.
    for (const m of moves) m.violations = [...m.violations, ...violations];
  }
}

/**
 * A mod commits directly, skipping the request queue. Same validation and the
 * same ledger mapping a GM's submission gets — it just lands COMMITTED.
 */
export async function commitProposals(
  seasonId: number,
  proposals: Proposal[],
  opts: LoadOpts = {},
): Promise<{ staged: StagedMove[]; committed: GlMove[]; errors: string[] }> {
  const { staged, blocked } = await validateProposals(seasonId, proposals, opts);
  if (blocked) {
    throw new LeagueFetchError(
      `${staged.filter((s) => s.blocked).length} move(s) break a hard rule — nothing was committed`,
      422,
    );
  }

  const pair = await loadPair(seasonId, opts);
  const glTidByAbbrev = new Map(pair.map.pairs.map((p) => [p.glAbbrev, p.glTid]));
  const mainTidByAbbrev = new Map(pair.map.pairs.map((p) => [p.mainAbbrev, p.mainTid]));

  const moves: GLeagueMove[] = [];
  for (const proposal of proposals) {
    if (proposal.direction === "ASSIGN") {
      const glTid = glTidByAbbrev.get(proposal.glAbbrev);
      if (glTid == null) throw new LeagueFetchError(`Unknown affiliate ${proposal.glAbbrev}`, 400);
      moves.push({ direction: "ASSIGN", pid: proposal.pid, glTid });
      continue;
    }
    if (proposal.direction === "RELEASE") {
      moves.push({ direction: "RELEASE", glPid: proposal.glPid });
      continue;
    }
    const mainTid = mainTidByAbbrev.get(proposal.mainAbbrev);
    if (mainTid == null) throw new LeagueFetchError(`Unknown club ${proposal.mainAbbrev}`, 400);
    const p = pair.gl.players.find((x) => x.pid === proposal.glPid)!;
    const snapshot = await latestAssignSnapshot(seasonId, playerKey(p));
    moves.push({
      direction: "CALLUP",
      glPid: proposal.glPid,
      mainTid,
      years: proposal.years,
      snapshot: snapshot ? { amountM: snapshot.amountM, exp: snapshot.exp } : null,
      wasRookieContract: snapshot?.wasRookie ?? false,
    });
  }

  const entries = await toLedgerEntries(seasonId, proposals, staged, pair);
  const applied = applyMoves(pair.main, pair.gl, moves);

  // Carry the pids the move actually produced onto the ledger rows.
  applied.results.forEach((result, i) => {
    if (result.error || !entries[i]) return;
    entries[i].mainPid = result.mainPid ?? entries[i].mainPid;
    entries[i].glPid = result.glPid ?? entries[i].glPid;
  });

  const keep = entries.filter((_, i) => !applied.results[i]?.error);
  const committed = await recordMoves(seasonId, keep);
  invalidateBoard(seasonId);
  return { staged, committed, errors: applied.errors };
}

/**
 * Turn validated proposals into ledger entries without applying them.
 *
 * Used by both paths: a GM's submission stops here at PROPOSED, and a mod's
 * direct commit continues on to apply. Keeping the mapping in one place means
 * the two can't drift in what they record about a move.
 */
async function toLedgerEntries(
  seasonId: number,
  proposals: Proposal[],
  staged: StagedMove[],
  pair: LoadedPair,
): Promise<LedgerEntry[]> {
  const { main, gl, map } = pair;
  const ctx = buildLeagueCtx(main);
  const entries: LedgerEntry[] = [];

  for (const [i, proposal] of proposals.entries()) {
    const isAssign = proposal.direction === "ASSIGN";
    const isRelease = proposal.direction === "RELEASE";
    const source = isAssign
      ? main.players.find((x) => x.pid === proposal.pid)
      : gl.players.find((x) => x.pid === proposal.glPid);
    if (!source) continue;

    const snapshot = isAssign ? null : await latestAssignSnapshot(seasonId, playerKey(source));
    const pair_ = isAssign
      ? map.pairs.find((x) => x.glAbbrev === proposal.glAbbrev)
      : map.pairs.find((x) => x.mainAbbrev === proposal.mainAbbrev);
    if (!pair_) continue;

    entries.push({
      direction: proposal.direction,
      playerKey: playerKey(source),
      playerName: playerName(source),
      bornYear: source.born.year,
      mainPid: isAssign ? source.pid : (snapshot?.mainPid ?? null),
      glPid: isAssign ? null : source.pid,
      mainTeamAbbrev: pair_.mainAbbrev,
      glTeamAbbrev: pair_.glAbbrev,
      ovrAtMove: staged[i].ovr,
      ageAtMove: staged[i].age,
      snapContractAmount: isAssign
        ? fromBbgmAmount(source.contract.amount)
        : (snapshot?.amountM ?? null),
      snapContractExp: isAssign ? source.contract.exp : (snapshot?.exp ?? null),
      snapWasRookie: isAssign ? isRookieContract(source, ctx) : (snapshot?.wasRookie ?? false),
      newContractAmount: staged[i].contract?.amountM ?? null,
      newContractExp: staged[i].contract?.exp ?? null,
      newContractYears: proposal.direction === "CALLUP" ? proposal.years : null,
      contractSource: (staged[i].contract?.source as LedgerEntry["contractSource"]) ?? null,
      rfaRightsLost: staged[i].contract?.rfaRightsLost ?? false,
      forced: false,
      overrideReason: proposal.overrideReason ?? null,
    });
  }

  return entries;
}

/**
 * A GM's submission from the public page. Validated against the live exports
 * so bad moves bounce immediately, then parked at PROPOSED for a mod to review.
 */
export async function submitProposals(
  seasonId: number,
  proposals: Proposal[],
  by: Submitter,
  opts: LoadOpts = {},
): Promise<{ staged: StagedMove[]; submitted: GlMove[] }> {
  const { staged, blocked } = await validateProposals(seasonId, proposals, opts);
  if (blocked) {
    throw new LeagueFetchError(
      `${staged.filter((s) => s.blocked).length} move(s) break a hard rule — nothing was submitted`,
      422,
    );
  }

  const pair = await loadPair(seasonId, opts);
  const entries = await toLedgerEntries(seasonId, proposals, staged, pair);
  const submitted = await proposeMoves(seasonId, entries, by);
  invalidateBoard(seasonId);
  return { staged, submitted };
}

/** Pending submissions, for the public page (one team) or the mod queue (all). */
export async function pendingRequests(
  seasonId: number,
  teamAbbrev?: string,
): Promise<GlMove[]> {
  return listProposals(seasonId, teamAbbrev);
}

/**
 * A mod approves pending submissions.
 *
 * The rules are re-checked here, not just at submission — a GM may have
 * submitted days earlier, and the board can have moved underneath them.
 */
export async function approveMoves(
  seasonId: number,
  moveIds: number[],
  opts: LoadOpts = {},
): Promise<{ committed: GlMove[] }> {
  if (!moveIds.length) return { committed: [] };

  const pending = (await listProposals(seasonId)).filter((r) => moveIds.includes(r.id));
  if (!pending.length) return { committed: [] };

  const pair = await loadPair(seasonId, opts);
  const proposals: Proposal[] = pending.map((r) => {
    if (r.direction === "ASSIGN") {
      return { direction: "ASSIGN", pid: r.mainPid!, glAbbrev: r.glTeamAbbrev };
    }
    if (r.direction === "RELEASE") {
      return { direction: "RELEASE", glPid: r.glPid!, mainAbbrev: r.mainTeamAbbrev };
    }
    return {
      direction: "CALLUP",
      glPid: r.glPid!,
      mainAbbrev: r.mainTeamAbbrev,
      years: r.newContractYears ?? 2,
    };
  });

  const { staged, blocked } = await validateProposals(seasonId, proposals, opts);
  if (blocked) {
    throw new LeagueFetchError(
      `${staged.filter((s) => s.blocked).length} of these break a hard rule now — nothing was approved`,
      422,
    );
  }

  // Apply against the pair so the move's real pids and contracts are recorded.
  const applied = applyMoves(
    pair.main,
    pair.gl,
    proposals.map((p) =>
      p.direction === "ASSIGN"
        ? { direction: "ASSIGN" as const, pid: p.pid, glTid: pair.map.glTidByMainTid.get(
            pair.map.pairs.find((x) => x.glAbbrev === p.glAbbrev)!.mainTid,
          )! }
        : p.direction === "RELEASE"
        ? { direction: "RELEASE" as const, glPid: p.glPid }
        : {
            direction: "CALLUP" as const,
            glPid: p.glPid,
            mainTid: pair.map.pairs.find((x) => x.mainAbbrev === p.mainAbbrev)!.mainTid,
            years: p.years,
            snapshot: pending[proposals.indexOf(p)].snapContractAmount != null
              ? {
                  amountM: Number(pending[proposals.indexOf(p)].snapContractAmount),
                  exp: pending[proposals.indexOf(p)].snapContractExp!,
                }
              : null,
            wasRookieContract: pending[proposals.indexOf(p)].snapWasRookie,
          },
    ),
  );

  const committed: GlMove[] = [];
  for (const [i, row] of pending.entries()) {
    const result = applied.results[i];
    if (result?.error) continue;
    const [updated] = await db
      .update(glMoves)
      .set({
        status: "COMMITTED",
        mainPid: result.mainPid ?? row.mainPid,
        glPid: result.glPid ?? row.glPid,
        newContractAmount: result.contractAmountM != null ? result.contractAmountM.toFixed(2) : row.newContractAmount,
        newContractExp: result.contractExp ?? row.newContractExp,
        contractSource: result.contractSource ?? row.contractSource,
        rfaRightsLost: result.rfaRightsLost ?? row.rfaRightsLost,
      })
      .where(eq(glMoves.id, row.id))
      .returning();
    committed.push(updated);
  }

  invalidateBoard(seasonId);
  return { committed };
}
