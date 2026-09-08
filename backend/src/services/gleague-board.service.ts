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
import { seasons } from "../db/schema.js";
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
  checkAssignEligibility,
  checkCallUp,
  detectForcedCallUps,
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
import { fromBbgmAmount, MIN_CALLUP_OVR } from "./gleague.constants.js";
import { applyMoves, type GLeagueMove } from "./gleague-transfer.service.js";
import { replayLedger } from "./gleague-replay.service.js";
import {
  cacheGlTeams,
  latestAssignSnapshot,
  listMoves,
  recordMoves,
  type GlMove,
  type LedgerEntry,
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
export type LoadOpts = { fetchJson?: LeagueSource };

/** Fetch both exports and replay the committed ledger onto them. */
export async function loadPair(seasonId: number, opts: LoadOpts = {}): Promise<LoadedPair> {
  const fetchJson = opts.fetchJson ?? fetchLeagueJson;
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

  const ledger = await listMoves(seasonId);
  // listMoves is newest-first; replay has to run oldest-first.
  replayLedger(main, gl, [...ledger].reverse() as unknown as LedgerEntry[]);

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
  mainSeason: number;
  glSeason: number;
  hardCapM: number;
  minCallUpOvr: number;
  unmatchedGl: string[];
  unmatchedMain: string[];
  teams: BoardTeam[];
  ledger: GlMove[];
};

export async function buildBoard(seasonId: number, opts: LoadOpts = {}): Promise<Board> {
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
    };

export type StagedMove = {
  proposal: Proposal;
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

  const staged: StagedMove[] = [];

  for (const proposal of proposals) {
    if (proposal.direction === "ASSIGN") {
      const p = main.players.find((x) => x.pid === proposal.pid);
      if (!p) {
        staged.push({
          proposal,
          playerName: `pid ${proposal.pid}`,
          ovr: 0,
          age: 0,
          violations: [{ code: "NOT_FOUND", severity: "HARD", message: "Player not in the main export" }],
          blocked: true,
        });
        continue;
      }
      const violations = checkAssignEligibility(p, { ...ctx, topDraftClassPids: topPids });
      const roster = rosters.find((r) => r.glAbbrev === proposal.glAbbrev);
      if (roster) {
        // Preview the roster after this assignment lands.
        violations.push(
          ...roster.violations.filter((v) => v.code === "TOO_MANY_ASSIGNED" || v.code === "HOARD_LIMIT"),
        );
      }
      staged.push({
        proposal,
        playerName: playerName(p),
        ovr: playerOvr(p, ctx.season),
        age: playerAge(p, ctx.season),
        violations,
        blocked: violations.some((v) => v.severity === "HARD"),
      });
      continue;
    }

    const p = gl.players.find((x) => x.pid === proposal.glPid);
    if (!p) {
      staged.push({
        proposal,
        playerName: `pid ${proposal.glPid}`,
        ovr: 0,
        age: 0,
        violations: [{ code: "NOT_FOUND", severity: "HARD", message: "Player not in the G-League export" }],
        blocked: true,
      });
      continue;
    }

    const glSeason = gl.gameAttributes.season as number;
    const ovr = playerOvr(p, glSeason);
    const snap = await latestAssignSnapshot(seasonId, playerKey(p));
    const contract = resolveCallUpContract({
      snapshot: snap ? { amountM: snap.amountM, exp: snap.exp } : null,
      ovr,
      years: proposal.years,
      season: ctx.season,
      wasRookieContract: snap?.wasRookie ?? false,
      minContractM,
    });

    const violations = checkCallUp({
      ovr,
      payrollM: payrolls.get(proposal.mainAbbrev) ?? 0,
      contractM: contract.amountM,
      hardCapM: HARD_CAP,
      // Ledger-tracked service time lands with the season-rollover work; until
      // then a call-up is not blocked on it.
      seasonsServed: 1,
    });

    staged.push({
      proposal,
      playerName: playerName(p),
      ovr,
      age: playerAge(p, glSeason),
      violations,
      blocked: violations.some((v) => v.severity === "HARD"),
      contract: {
        amountM: contract.amountM,
        exp: contract.exp,
        source: contract.source,
        rfaRightsLost: contract.rfaRightsLost,
      },
    });
  }

  return { staged, blocked: staged.some((s) => s.blocked) };
}

/** Validate, apply to in-memory copies, and append the batch to the ledger. */
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

  const { main, gl, map } = await loadPair(seasonId, opts);
  const ctx = buildLeagueCtx(main);
  const glTidByAbbrev = new Map(map.pairs.map((p) => [p.glAbbrev, p.glTid]));
  const mainTidByAbbrev = new Map(map.pairs.map((p) => [p.mainAbbrev, p.mainTid]));
  const moves: GLeagueMove[] = [];
  const meta: Array<{ proposal: Proposal; snapshot: Awaited<ReturnType<typeof latestAssignSnapshot>> }> = [];

  for (const proposal of proposals) {
    if (proposal.direction === "ASSIGN") {
      const glTid = glTidByAbbrev.get(proposal.glAbbrev);
      if (glTid == null) throw new LeagueFetchError(`Unknown affiliate ${proposal.glAbbrev}`, 400);
      moves.push({ direction: "ASSIGN", pid: proposal.pid, glTid });
      meta.push({ proposal, snapshot: null });
      continue;
    }
    const mainTid = mainTidByAbbrev.get(proposal.mainAbbrev);
    if (mainTid == null) throw new LeagueFetchError(`Unknown club ${proposal.mainAbbrev}`, 400);
    const p = gl.players.find((x) => x.pid === proposal.glPid)!;
    const snapshot = await latestAssignSnapshot(seasonId, playerKey(p));
    moves.push({
      direction: "CALLUP",
      glPid: proposal.glPid,
      mainTid,
      years: proposal.years,
      snapshot: snapshot ? { amountM: snapshot.amountM, exp: snapshot.exp } : null,
      wasRookieContract: snapshot?.wasRookie ?? false,
    });
    meta.push({ proposal, snapshot });
  }

  const applied = applyMoves(main, gl, moves);

  const entries: LedgerEntry[] = [];
  applied.results.forEach((result, i) => {
    if (result.error) return;
    const { proposal } = meta[i];
    const stagedMove = staged[i];
    const isAssign = proposal.direction === "ASSIGN";
    const source = isAssign
      ? main.players.find((x) => x.pid === (proposal as { pid: number }).pid)!
      : gl.players.find((x) => x.pid === (proposal as { glPid: number }).glPid)!;

    entries.push({
      direction: result.direction,
      playerKey: playerKey(source),
      playerName: result.playerName,
      bornYear: source.born.year,
      mainPid: result.mainPid ?? null,
      glPid: result.glPid ?? null,
      mainTeamAbbrev: isAssign
        ? map.pairs.find((x) => x.glAbbrev === (proposal as { glAbbrev: string }).glAbbrev)!.mainAbbrev
        : (proposal as { mainAbbrev: string }).mainAbbrev,
      glTeamAbbrev: isAssign
        ? (proposal as { glAbbrev: string }).glAbbrev
        : map.pairs.find((x) => x.mainAbbrev === (proposal as { mainAbbrev: string }).mainAbbrev)!.glAbbrev,
      ovrAtMove: stagedMove.ovr,
      ageAtMove: stagedMove.age,
      snapContractAmount: isAssign ? (result.snapshot?.amountM ?? null) : (meta[i].snapshot?.amountM ?? null),
      snapContractExp: isAssign ? (result.snapshot?.exp ?? null) : (meta[i].snapshot?.exp ?? null),
      snapWasRookie: isAssign ? isRookieContract(source, ctx) : (meta[i].snapshot?.wasRookie ?? false),
      newContractAmount: result.contractAmountM ?? null,
      newContractExp: result.contractExp ?? null,
      newContractYears: isAssign ? null : (proposal as { years: number }).years,
      contractSource: result.contractSource ?? null,
      rfaRightsLost: result.rfaRightsLost ?? false,
      forced: false,
      overrideReason: proposal.overrideReason ?? null,
    });
  });

  const committed = await recordMoves(seasonId, entries);
  return { staged, committed, errors: applied.errors };
}
