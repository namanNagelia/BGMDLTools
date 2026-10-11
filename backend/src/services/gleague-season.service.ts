/**
 * Persistence for the G-League: the export link, the cached affiliate rosters,
 * and the move ledger.
 *
 * The ledger is the authority for contract restoration. BBGM's own files can't
 * express "this player is on loan and owed $4.11M through 2191 when he comes
 * back", so we record it here at the moment of assignment and read it back on
 * call-up.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { glMoves, glTeams, seasons } from "../db/schema.js";

export type Season = typeof seasons.$inferSelect;
export type GlMove = typeof glMoves.$inferSelect;

export async function setGlLeagueLink(
  seasonId: number,
  link: string,
): Promise<Season | null> {
  const [row] = await db
    .update(seasons)
    .set({ glLeagueLink: link })
    .where(eq(seasons.id, seasonId))
    .returning();
  return row ?? null;
}

export type CachedRoster = {
  glTid: number;
  glAbbrev: string;
  glRegion: string;
  glName: string;
  mainAbbrev: string;
  mainTid: number;
  payrollM: number;
  players: unknown;
};

/** Replace the cached affiliate snapshot for a season. */
export async function cacheGlTeams(seasonId: number, rosters: CachedRoster[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(glTeams).where(eq(glTeams.seasonId, seasonId));
    if (!rosters.length) return;
    await tx.insert(glTeams).values(
      rosters.map((r) => ({
        seasonId,
        glTid: r.glTid,
        glAbbrev: r.glAbbrev,
        glRegion: r.glRegion,
        glName: r.glName,
        parentAbbrev: r.mainAbbrev,
        parentTid: r.mainTid,
        totalSalary: r.payrollM.toFixed(2),
        roster: r.players as never,
      })),
    );
  });
}

export type LedgerEntry = {
  direction: "ASSIGN" | "CALLUP" | "RELEASE";
  playerKey: string;
  playerName: string;
  bornYear: number;
  mainPid?: number | null;
  glPid?: number | null;
  mainTeamAbbrev: string;
  glTeamAbbrev: string;
  ovrAtMove: number;
  ageAtMove: number;
  snapContractAmount?: number | null;
  snapContractExp?: number | null;
  snapWasRookie?: boolean;
  newContractAmount?: number | null;
  newContractExp?: number | null;
  newContractYears?: number | null;
  contractSource?: "RESTORED" | "PAYSCALE" | "MINIMUM" | null;
  rfaRightsLost?: boolean;
  forced?: boolean;
  overrideReason?: string | null;
};

const money = (v: number | null | undefined) => (v == null ? null : v.toFixed(2));

/** Append a committed batch to the ledger. */
export async function recordMoves(
  seasonId: number,
  entries: LedgerEntry[],
): Promise<GlMove[]> {
  if (!entries.length) return [];
  return db
    .insert(glMoves)
    .values(
      entries.map((e) => ({
        ...toRow(seasonId, e),
        status: "COMMITTED" as const,
      })),
    )
    .returning();
}

/** Shared column mapping for both a mod's direct commit and a GM's submission. */
function toRow(seasonId: number, e: LedgerEntry) {
  return {
    seasonId,
    direction: e.direction,
    playerKey: e.playerKey,
    playerName: e.playerName,
    bornYear: e.bornYear,
    mainPid: e.mainPid ?? null,
    glPid: e.glPid ?? null,
    mainTeamAbbrev: e.mainTeamAbbrev,
    glTeamAbbrev: e.glTeamAbbrev,
    ovrAtMove: e.ovrAtMove,
    ageAtMove: e.ageAtMove,
    snapContractAmount: money(e.snapContractAmount),
    snapContractExp: e.snapContractExp ?? null,
    snapWasRookie: e.snapWasRookie ?? false,
    newContractAmount: money(e.newContractAmount),
    newContractExp: e.newContractExp ?? null,
    newContractYears: e.newContractYears ?? null,
    contractSource: e.contractSource ?? null,
    rfaRightsLost: e.rfaRightsLost ?? false,
    forced: e.forced ?? false,
    overrideReason: e.overrideReason ?? null,
  };
}

export async function listMoves(seasonId: number): Promise<GlMove[]> {
  return db
    .select()
    .from(glMoves)
    .where(eq(glMoves.seasonId, seasonId))
    .orderBy(desc(glMoves.createdAt), desc(glMoves.id));
}

export type AssignSnapshot = {
  amountM: number;
  exp: number;
  wasRookie: boolean;
  glPid: number | null;
  mainPid: number | null;
};

/**
 * The contract a player carried into the G-League, from his most recent
 * assignment. Null for original G-Leaguers, who fall through to the pay scale.
 */
export async function latestAssignSnapshot(
  seasonId: number,
  playerKey: string,
): Promise<AssignSnapshot | null> {
  const [row] = await db
    .select()
    .from(glMoves)
    .where(
      and(
        eq(glMoves.seasonId, seasonId),
        eq(glMoves.playerKey, playerKey),
        eq(glMoves.direction, "ASSIGN"),
      ),
    )
    .orderBy(desc(glMoves.id))
    .limit(1);

  if (!row || row.snapContractAmount == null || row.snapContractExp == null) return null;
  return {
    amountM: Number(row.snapContractAmount),
    exp: row.snapContractExp,
    wasRookie: row.snapWasRookie,
    glPid: row.glPid,
    mainPid: row.mainPid,
  };
}

/**
 * The ledger as the exports see it. Replay reads this, never `listMoves` —
 * a PROPOSED row is a GM's request that no mod has approved, and a DECLINED
 * row was rejected outright. Either one leaking into a replay would put a
 * move into a downloaded BBGM file that nobody signed off on.
 *
 * Oldest first, which is the order replay has to apply them in.
 */
export async function listCommittedMoves(seasonId: number): Promise<GlMove[]> {
  return db
    .select()
    .from(glMoves)
    .where(and(eq(glMoves.seasonId, seasonId), eq(glMoves.status, "COMMITTED")))
    .orderBy(glMoves.id);
}
