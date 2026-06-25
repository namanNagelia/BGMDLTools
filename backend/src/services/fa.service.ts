import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { freeAgents, seasons } from "../db/schema.js";
import { fetchLeagueJson, LeagueFetchError } from "./league.service.js";
import { loadFreeAgentData } from "./sheets.service.js";

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

/**
 * Build a map of normalized player name → ratings entry for `seasonNumber`.
 * BBGM player.ratings is an array of per-season rating snapshots.
 */
function buildRatingsIndex(
  bbgm: unknown,
  seasonNumber: number,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
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
    };
    const fullName =
      player.name && typeof player.name === "string"
        ? player.name
        : `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim();
    if (!fullName) continue;
    if (!Array.isArray(player.ratings)) continue;

    const ratingsArr = player.ratings as Array<{ season?: number }>;
    // exact season match first, fall back to latest <= seasonNumber, fall back to last
    let pick = ratingsArr.find((r) => r?.season === seasonNumber);
    if (!pick) {
      const candidates = ratingsArr.filter(
        (r) => typeof r?.season === "number" && r.season! <= seasonNumber,
      );
      pick = candidates.length ? candidates[candidates.length - 1] : ratingsArr[ratingsArr.length - 1];
    }
    if (pick) map.set(normName(fullName), pick);
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

  const [{ freeAgentsByTeam, freeAgentValues }, bbgm] = await Promise.all([
    loadFreeAgentData(String(season.seasonNumber), season.sheetsLink),
    fetchLeagueJson(season.leagueLink),
  ]);

  const teamByName = new Map<string, TeamRow>();
  for (const r of freeAgentsByTeam as TeamRow[]) {
    if (r?.Name) teamByName.set(normName(r.Name), r);
  }

  const valueByName = new Map<string, ValueRow>();
  for (const r of freeAgentValues as ValueRow[]) {
    if (r?.Name) valueByName.set(normName(r.Name), r);
  }

  const ratingsIndex = buildRatingsIndex(bbgm, season.seasonNumber);

  // join: only players present in both sheets get inserted (we need columns from each)
  const rowsToInsert: (typeof freeAgents.$inferInsert)[] = [];
  const unmatchedFromValues: string[] = [];
  let ratingsAttached = 0;

  for (const [key, team] of teamByName) {
    const value = valueByName.get(key);
    if (!value) {
      unmatchedFromValues.push(team.Name ?? key);
      continue;
    }
    const ratings = ratingsIndex.get(key) ?? null;
    if (ratings) ratingsAttached++;

    rowsToInsert.push({
      seasonId: season.id,
      name: team.Name!,
      position: String(value.Pos ?? "").trim() || "?",
      previousTeam: String(team.Team ?? "").trim() || "FA",
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
      ratings,
    });
  }

  const unmatchedFromTeam: string[] = [];
  for (const [key, v] of valueByName) {
    if (!teamByName.has(key)) unmatchedFromTeam.push(v.Name ?? key);
  }

  // replace existing FAs for this season (idempotent re-ingest)
  await db.transaction(async (tx) => {
    await tx.delete(freeAgents).where(eq(freeAgents.seasonId, season.id));
    if (rowsToInsert.length) await tx.insert(freeAgents).values(rowsToInsert);
  });

  return {
    seasonId: season.id,
    seasonNumber: season.seasonNumber,
    inserted: rowsToInsert.length,
    matchedInBothSheets: rowsToInsert.length,
    unmatchedFromTeamSheet: unmatchedFromTeam,
    unmatchedFromValuesSheet: unmatchedFromValues,
    ratingsAttached,
  };
}

export async function listFreeAgentsForSeason(seasonId: number) {
  return db.select().from(freeAgents).where(eq(freeAgents.seasonId, seasonId));
}

export async function listFreeAgentsForCurrentSeason() {
  const [current] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.isCurrentSzn, true))
    .limit(1);
  if (!current) return { season: null, freeAgents: [] };
  const rows = await listFreeAgentsForSeason(current.id);
  return { season: current, freeAgents: rows };
}
