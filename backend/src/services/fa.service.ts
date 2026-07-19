import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  freeAgents,
  ingestSnapshots,
  legacyRanks,
  marketRanks,
  offers,
  seasons,
  teams,
  winningRanks,
} from "../db/schema.js";
import { fetchLeagueJson, LeagueFetchError } from "./league.service.js";
import { loadFreeAgentData } from "./sheets.service.js";
import { loadSeasonRanks } from "./rank.service.js";
import { getSeasonRanksSheetName } from "../constants.js";

type FaStatus = "SIGNED" | "RFA" | "UFA" | "TBD";

interface TeamRow {
  Name?: string;
  Team?: string;
  "CAP HOLD (IN MILLIONS)"?: number | string;
  "FA Status"?: string;
}

interface ValueRow {
  Name?: string;
  Pos?: string;
  Age?: number | string;
  Ovr?: number | string;
  "MARKET (x1)"?: number | string;
  "LEGACY (x1)"?: number | string;
  "PLAYING TIME (x1.1)"?: number | string;
  "WINNING (x1.3)"?: number | string;
  "LOYALTY (x1.3)"?: number | string;
  "MONEY (x2)"?: number | string;
  "LENGTH (x1.4)"?: number | string;
}

const num = (v: unknown, fallback = 0): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const parseStatus = (s: unknown): FaStatus => {
  const v = String(s ?? "").trim().toUpperCase();
  if (v === "SIGNED" || v === "RFA" || v === "UFA" || v === "TBD") return v;
  return "TBD";
};

interface PlayerIndexEntry {
  ratings: Record<string, unknown> | null;
  stats: Array<{ season: number; tid: number }>;
}

/** Index BBGM players by normalized name → ratings snapshot + per-season (season, tid) stats. */
function buildPlayerIndex(
  bbgm: unknown,
  seasonNumber: number,
): Map<string, PlayerIndexEntry> {
  const map = new Map<string, PlayerIndexEntry>();
  if (!bbgm || typeof bbgm !== "object") return map;
  const players = (bbgm as { players?: unknown }).players;
  if (!Array.isArray(players)) return map;

  for (const p of players) {
    if (!p || typeof p !== "object") continue;
    const player = p as {
      name?: string;
      firstName?: string;
      lastName?: string;
      ratings?: unknown;
      stats?: unknown;
    };
    const fullName =
      player.name && typeof player.name === "string"
        ? player.name
        : `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim();
    if (!fullName) continue;

    let ratings: Record<string, unknown> | null = null;
    if (Array.isArray(player.ratings)) {
      const arr = player.ratings as Array<{ season?: number }>;
      let pick = arr.find((r) => r?.season === seasonNumber);
      if (!pick) {
        const candidates = arr.filter(
          (r) => typeof r?.season === "number" && r.season! <= seasonNumber,
        );
        pick = candidates.length
          ? candidates[candidates.length - 1]
          : arr[arr.length - 1];
      }
      ratings = pick ?? null;
    }

    const seenKeys = new Set<string>();
    const stats: Array<{ season: number; tid: number }> = [];
    if (Array.isArray(player.stats)) {
      for (const s of player.stats as Array<{ season?: number; tid?: number }>) {
        if (typeof s?.season !== "number" || typeof s?.tid !== "number") continue;
        const k = `${s.season}|${s.tid}`;
        if (seenKeys.has(k)) continue;
        seenKeys.add(k);
        stats.push({ season: s.season, tid: s.tid });
      }
      stats.sort((a, b) => a.season - b.season);
    }

    map.set(normName(fullName), { ratings, stats });
  }
  return map;
}

/** Walk stats backward from priorSeason, counting consecutive seasons on `tid`. */
function consecutiveYearsOnTeam(
  stats: Array<{ season: number; tid: number }>,
  tid: number,
  priorSeason: number,
): number {
  if (!stats.length) return 0;
  let count = 0;
  for (let i = stats.length - 1; i >= 0; i--) {
    const row = stats[i];
    if (row.season > priorSeason) continue;
    if (row.tid === tid) count++;
    else if (count > 0) break;
  }
  return count;
}

function buildAbbrevToTid(bbgm: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!bbgm || typeof bbgm !== "object") return map;
  const teams = (bbgm as { teams?: unknown }).teams;
  if (!Array.isArray(teams)) return map;
  for (const t of teams as Array<{ tid?: number; abbrev?: string }>) {
    if (typeof t?.tid === "number" && t.tid >= 0 && t.abbrev) {
      map.set(t.abbrev, t.tid);
    }
  }
  return map;
}

export interface IngestResult {
  seasonId: number;
  seasonNumber: number;
  inserted: number;
  matchedInBothSheets: number;
  unmatchedFromTeamSheet: string[];
  unmatchedFromValuesSheet: string[];
  ratingsAttached: number;
  teamsInserted: number;
  bbgmOnlyInserted: number;
  faUpdated: number;
  faInserted: number;
  snapshotId: number;
  snapshotFAs: number;
  snapshotOffers: number;
  ranks: {
    market: number;
    legacy: number;
    winning: number;
    unresolved: number;
    error?: string;
  };
}

interface RosterEntry {
  pid: number;
  name: string;
  pos: string | null;
  age: number | null;
  ovr: number | null;
  contractAmount: number; // millions
  contractExp: number | null;
}

interface TeamPayroll {
  tid: number;
  abbrev: string;
  name: string;
  totalSalaryMillions: number;
  roster: RosterEntry[];
}

/** Build per-team rosters + payrolls from BBGM. Contract amount converted thousands → millions. */
function buildTeamPayrolls(bbgm: unknown, seasonNumber: number): TeamPayroll[] {
  if (!bbgm || typeof bbgm !== "object") return [];
  const d = bbgm as { teams?: unknown; players?: unknown };
  if (!Array.isArray(d.teams) || !Array.isArray(d.players)) return [];

  const teamMeta = d.teams as Array<{
    tid?: number;
    abbrev?: string;
    region?: string;
    name?: string;
  }>;
  const players = d.players as Array<{
    pid?: number;
    tid?: number;
    name?: string;
    firstName?: string;
    lastName?: string;
    born?: { year?: number };
    contract?: { amount?: number; exp?: number };
    ratings?: Array<{ season?: number; pos?: string; ovr?: number }>;
  }>;

  const rosterByTid = new Map<number, RosterEntry[]>();
  for (const p of players) {
    if (typeof p?.tid !== "number" || p.tid < 0) continue;
    const list = rosterByTid.get(p.tid) ?? [];

    const fullName =
      typeof p.name === "string" && p.name
        ? p.name
        : `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();

    let pos: string | null = null;
    let ovr: number | null = null;
    if (Array.isArray(p.ratings) && p.ratings.length) {
      const exact = p.ratings.find((r) => r?.season === seasonNumber);
      const pick = exact ?? p.ratings[p.ratings.length - 1];
      pos = pick?.pos ?? null;
      ovr = typeof pick?.ovr === "number" ? pick.ovr : null;
    }

    const age = p.born?.year ? seasonNumber - p.born.year : null;
    const amt = p.contract?.amount ?? 0;

    list.push({
      pid: p.pid ?? -1,
      name: fullName || "—",
      pos,
      age,
      ovr,
      contractAmount: amt / 1000,
      contractExp: p.contract?.exp ?? null,
    });
    rosterByTid.set(p.tid, list);
  }

  const out: TeamPayroll[] = [];
  for (const t of teamMeta) {
    if (typeof t.tid !== "number" || t.tid < 0 || !t.abbrev) continue;
    const roster = rosterByTid.get(t.tid) ?? [];
    const totalSalary = roster.reduce((s, r) => s + r.contractAmount, 0);
    out.push({
      tid: t.tid,
      abbrev: t.abbrev,
      name: `${t.region ?? ""} ${t.name ?? ""}`.trim() || t.abbrev,
      totalSalaryMillions: totalSalary,
      roster: roster.sort((a, b) => b.contractAmount - a.contractAmount),
    });
  }
  return out;
}

export async function ingestFreeAgents(seasonId: number): Promise<IngestResult> {
  const [season] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .limit(1);
  if (!season) throw new LeagueFetchError("Season not found", 404);
  if (!season.sheetsLink)
    throw new LeagueFetchError("No sheets link saved on this season", 400);

  const seasonStr = String(season.seasonNumber);
  const ranksSheetName = getSeasonRanksSheetName(seasonStr);

  const [{ freeAgentsByTeam, freeAgentValues }, bbgm, ranks] = await Promise.all([
    loadFreeAgentData(seasonStr, season.sheetsLink),
    fetchLeagueJson(season.leagueLink),
    loadSeasonRanks(season.sheetsLink, ranksSheetName).catch((err) => {
      return {
        market: [],
        legacy: [],
        winning: [],
        error: err instanceof Error ? err.message : "rank parse failed",
      } as Awaited<ReturnType<typeof loadSeasonRanks>> & { error?: string };
    }),
  ]);

  const teamByName = new Map<string, TeamRow>();
  for (const r of freeAgentsByTeam as TeamRow[]) {
    if (r?.Name) teamByName.set(normName(r.Name), r);
  }

  const valueByName = new Map<string, ValueRow>();
  for (const r of freeAgentValues as ValueRow[]) {
    if (r?.Name) valueByName.set(normName(r.Name), r);
  }

  const playerIndex = buildPlayerIndex(bbgm, season.seasonNumber);
  const abbrevToTid = buildAbbrevToTid(bbgm);

  const rowsToInsert: (typeof freeAgents.$inferInsert)[] = [];
  const unmatchedFromValues: string[] = [];
  let ratingsAttached = 0;
  let loyaltyYearsAttached = 0;

  for (const [key, team] of teamByName) {
    const value = valueByName.get(key);
    if (!value) {
      unmatchedFromValues.push(team.Name ?? key);
      continue;
    }
    const idxEntry = playerIndex.get(key);
    const ratings = idxEntry?.ratings ?? null;
    if (ratings) ratingsAttached++;

    const prevAbbrev = String(team.Team ?? "").trim();
    const prevTid = prevAbbrev ? abbrevToTid.get(prevAbbrev) : undefined;
    let yearsOnPreviousTeam = 1;
    if (idxEntry && prevTid != null) {
      const years = consecutiveYearsOnTeam(
        idxEntry.stats,
        prevTid,
        season.seasonNumber - 1,
      );
      if (years > 0) {
        yearsOnPreviousTeam = years;
        loyaltyYearsAttached++;
      }
    }

    rowsToInsert.push({
      seasonId: season.id,
      name: team.Name!,
      position: String(value.Pos ?? "").trim() || "?",
      previousTeam: prevAbbrev || "FA",
      capHold: String(num(team["CAP HOLD (IN MILLIONS)"])),
      faStatus: parseStatus(team["FA Status"]),
      age: num(value.Age),
      overall: num(value.Ovr),
      marketValue: num(value["MARKET (x1)"]),
      legacyValue: num(value["LEGACY (x1)"]),
      playingTimeValue: num(value["PLAYING TIME (x1.1)"]),
      winningValue: num(value["WINNING (x1.3)"]),
      loyaltyValue: num(value["LOYALTY (x1.3)"]),
      moneyValue: num(value["MONEY (x2)"]),
      lengthValue: num(value["LENGTH (x1.4)"]),
      yearsOnPreviousTeam,
      ratings,
    });
  }
  void loyaltyYearsAttached; // reserved for future ingest-summary surfacing

  // ---- BBGM-only FAs: tid=-1 players not present in the sheet ---------
  const tidToAbbrev = new Map<number, string>();
  for (const [abv, tid] of abbrevToTid) tidToAbbrev.set(tid, abv);

  const sheetNames = new Set(rowsToInsert.map((r) => normName(r.name)));
  let bbgmOnlyInserted = 0;
  const bbgmPlayers = (bbgm as { players?: unknown }).players;
  if (Array.isArray(bbgmPlayers)) {
    for (const p of bbgmPlayers as Array<{
      tid?: number;
      name?: string;
      firstName?: string;
      lastName?: string;
      born?: { year?: number };
    }>) {
      if (p?.tid !== -1) continue;
      const fullName =
        p.name && typeof p.name === "string"
          ? p.name
          : `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
      if (!fullName) continue;
      const key = normName(fullName);
      if (sheetNames.has(key)) continue;

      const idx = playerIndex.get(key);
      const rt = (idx?.ratings ?? {}) as { pos?: string; ovr?: number };
      const pos = typeof rt.pos === "string" ? rt.pos : "?";
      const ovr = typeof rt.ovr === "number" ? rt.ovr : 0;
      const age = p.born?.year ? season.seasonNumber - p.born.year : 0;

      let prevAbbrev = "FA";
      let bbgmYearsOnPrev = 1;
      if (idx?.stats.length) {
        for (let i = idx.stats.length - 1; i >= 0; i--) {
          const s = idx.stats[i];
          if (s.tid >= 0) {
            const abv = tidToAbbrev.get(s.tid);
            if (abv) {
              prevAbbrev = abv;
              bbgmYearsOnPrev = consecutiveYearsOnTeam(
                idx.stats,
                s.tid,
                season.seasonNumber - 1,
              );
              if (bbgmYearsOnPrev < 1) bbgmYearsOnPrev = 1;
            }
            break;
          }
        }
      }

      rowsToInsert.push({
        seasonId: season.id,
        name: fullName,
        position: pos,
        previousTeam: prevAbbrev,
        capHold: "0",
        faStatus: "UFA",
        age,
        overall: ovr,
        marketValue: 0,
        legacyValue: 0,
        playingTimeValue: 0,
        winningValue: 0,
        loyaltyValue: 0,
        moneyValue: 0,
        lengthValue: 0,
        yearsOnPreviousTeam: bbgmYearsOnPrev,
        source: "BBGM_ONLY",
        ratings: idx?.ratings ?? null,
      });
      bbgmOnlyInserted++;
    }
  }

  const unmatchedFromTeam: string[] = [];
  for (const [key, v] of valueByName) {
    if (!teamByName.has(key)) unmatchedFromTeam.push(v.Name ?? key);
  }

  const teamPayrolls = buildTeamPayrolls(bbgm, season.seasonNumber);
  const teamRows = teamPayrolls.map((t) => ({
    seasonId: season.id,
    tid: t.tid,
    abbrev: t.abbrev,
    name: t.name,
    totalSalary: t.totalSalaryMillions.toFixed(2),
    roster: t.roster,
  }));

  const marketRows = ranks.market.map((m) => ({
    seasonId: season.id,
    teamAbbrev: m.abbrev,
    teamName: m.name,
    rank: m.tier,
  }));
  const legacyRows = ranks.legacy
    .filter((r) => r.abbrev !== "?")
    .map((r) => ({
      seasonId: season.id,
      teamAbbrev: r.abbrev,
      teamName: r.name,
      tier: r.tier,
      titles: r.titles,
      finals: r.finals,
      playoffPct: r.playoffPct != null ? String(r.playoffPct) : null,
    }));
  const winningRows = ranks.winning
    .filter((w) => w.abbrev !== "?")
    .map((w) => ({
      seasonId: season.id,
      teamAbbrev: w.abbrev,
      teamCity: w.city,
      rank: w.rank,
      postseason: w.postseason,
    }));
  const ranksUnresolved =
    ranks.legacy.filter((r) => r.abbrev === "?").length +
    ranks.winning.filter((w) => w.abbrev === "?").length;

  let snapshotId = 0;
  let snapshotFAs = 0;
  let snapshotOffers = 0;
  let faUpdated = 0;
  let faInserted = 0;
  await db.transaction(async (tx) => {
    // ---- Snapshot the "before" state so a bad ingest is recoverable. ----
    const existingFAs = await tx
      .select()
      .from(freeAgents)
      .where(eq(freeAgents.seasonId, season.id));
    const existingOffers = existingFAs.length
      ? await tx
          .select()
          .from(offers)
          .where(eq(offers.offerSeason, season.id))
      : [];
    const [snap] = await tx
      .insert(ingestSnapshots)
      .values({
        seasonId: season.id,
        freeAgentsCount: existingFAs.length,
        offersCount: existingOffers.length,
        freeAgents: existingFAs,
        offers: existingOffers,
      })
      .returning({ id: ingestSnapshots.id });
    snapshotId = snap?.id ?? 0;
    snapshotFAs = existingFAs.length;
    snapshotOffers = existingOffers.length;

    // ---- Upsert FAs by (seasonId, name) so offers/renouncements/signings survive. ----
    const existingByKey = new Map(existingFAs.map((r) => [normName(r.name), r]));
    const freshInserts: (typeof freeAgents.$inferInsert)[] = [];

    for (const row of rowsToInsert) {
      const key = normName(row.name);
      const prev = existingByKey.get(key);
      if (!prev) {
        freshInserts.push(row);
        continue;
      }
      // Preserve stateful fields: id, wave, renounced, winningOfferId,
      // and keep faStatus=SIGNED sticky (a signing shouldn't be reverted by a re-ingest).
      const nextStatus = prev.faStatus === "SIGNED" ? "SIGNED" : row.faStatus;
      await tx
        .update(freeAgents)
        .set({
          position: row.position,
          previousTeam: row.previousTeam,
          capHold: row.capHold,
          faStatus: nextStatus,
          age: row.age,
          overall: row.overall,
          marketValue: row.marketValue,
          legacyValue: row.legacyValue,
          playingTimeValue: row.playingTimeValue,
          winningValue: row.winningValue,
          loyaltyValue: row.loyaltyValue,
          moneyValue: row.moneyValue,
          lengthValue: row.lengthValue,
          yearsOnPreviousTeam: row.yearsOnPreviousTeam,
          source: row.source ?? prev.source,
          ratings: row.ratings ?? prev.ratings,
        })
        .where(eq(freeAgents.id, prev.id));
      faUpdated++;
    }
    if (freshInserts.length) {
      await tx.insert(freeAgents).values(freshInserts);
      faInserted = freshInserts.length;
    }
    // NOTE: existing FA rows not present in the incoming ingest are intentionally
    // left untouched — they may carry historical offers, a winning bid, or a SIGNED
    // status from a completed signing. Full wipe is available via resetSeasonFA.

    // Ranks + team payrolls hold no offer references — safe to fully replace.
    await tx.delete(marketRanks).where(eq(marketRanks.seasonId, season.id));
    await tx.delete(legacyRanks).where(eq(legacyRanks.seasonId, season.id));
    await tx.delete(winningRanks).where(eq(winningRanks.seasonId, season.id));
    if (marketRows.length) await tx.insert(marketRanks).values(marketRows);
    if (legacyRows.length) await tx.insert(legacyRanks).values(legacyRows);
    if (winningRows.length) await tx.insert(winningRanks).values(winningRows);

    await tx.delete(teams).where(eq(teams.seasonId, season.id));
    if (teamRows.length) await tx.insert(teams).values(teamRows);
  });

  return {
    seasonId: season.id,
    seasonNumber: season.seasonNumber,
    inserted: rowsToInsert.length,
    matchedInBothSheets: rowsToInsert.length - bbgmOnlyInserted,
    unmatchedFromTeamSheet: unmatchedFromTeam,
    unmatchedFromValuesSheet: unmatchedFromValues,
    ratingsAttached,
    teamsInserted: teamRows.length,
    bbgmOnlyInserted,
    faUpdated,
    faInserted,
    snapshotId,
    snapshotFAs,
    snapshotOffers,
    ranks: {
      market: marketRows.length,
      legacy: legacyRows.length,
      winning: winningRows.length,
      unresolved: ranksUnresolved,
      error: "error" in ranks ? (ranks as { error?: string }).error : undefined,
    },
  };
}

export async function listFreeAgentsForSeason(seasonId: number) {
  return db.select().from(freeAgents).where(eq(freeAgents.seasonId, seasonId));
}

/** Manually reassign which team holds an FA's Bird/cap-hold rights (mid-FA trades). */
export async function reassignFARights(
  faId: number,
  newTeamAbbrev: string,
): Promise<typeof freeAgents.$inferSelect | null> {
  const [updated] = await db
    .update(freeAgents)
    .set({ previousTeam: newTeamAbbrev, renounced: false })
    .where(eq(freeAgents.id, faId))
    .returning();
  return updated ?? null;
}

/**
 * Toggle renounced on a free agent. Only the team that holds the player's
 * Bird/RFA rights (i.e. their previousTeam) may renounce — server validates.
 */
export async function setRenounced(
  faId: number,
  teamAbbrev: string,
  renounced: boolean,
): Promise<{ ok: true } | { error: string; status: number }> {
  const [fa] = await db
    .select()
    .from(freeAgents)
    .where(eq(freeAgents.id, faId))
    .limit(1);
  if (!fa) return { error: "free_agent_not_found", status: 404 };
  if (fa.previousTeam !== teamAbbrev) {
    return { error: "not_your_player", status: 403 };
  }
  await db.update(freeAgents).set({ renounced }).where(eq(freeAgents.id, faId));
  return { ok: true };
}

export async function listFreeAgentsForCurrentSeason() {
  const [current] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.isCurrentSzn, true))
    .limit(1);
  if (!current) {
    return {
      season: null,
      freeAgents: [],
      ranks: { market: {}, legacy: {}, winning: {} },
      teams: {},
    };
  }

  const [rows, market, legacy, winning, teamRows] = await Promise.all([
    listFreeAgentsForSeason(current.id),
    db.select().from(marketRanks).where(eq(marketRanks.seasonId, current.id)),
    db.select().from(legacyRanks).where(eq(legacyRanks.seasonId, current.id)),
    db.select().from(winningRanks).where(eq(winningRanks.seasonId, current.id)),
    db.select().from(teams).where(eq(teams.seasonId, current.id)),
  ]);

  return {
    season: current,
    freeAgents: rows,
    ranks: {
      market: Object.fromEntries(market.map((m) => [m.teamAbbrev, m])),
      legacy: Object.fromEntries(legacy.map((l) => [l.teamAbbrev, l])),
      winning: Object.fromEntries(winning.map((w) => [w.teamAbbrev, w])),
    },
    teams: Object.fromEntries(teamRows.map((t) => [t.abbrev, t])),
  };
}
