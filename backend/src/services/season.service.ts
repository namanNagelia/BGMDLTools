import { eq, desc, ne, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { seasons } from "../db/schema.js";
import { extractSeasonNumber, fetchLeagueJson, LeagueFetchError } from "./league.service.js";
import { loadFreeAgentData } from "./sheets.service.js";

export type Season = typeof seasons.$inferSelect;

export async function listSeasons(): Promise<Season[]> {
  return db
    .select()
    .from(seasons)
    .orderBy(desc(seasons.isCurrentSzn), desc(seasons.seasonNumber));
}

export async function getCurrentSeason(): Promise<Season | null> {
  const [row] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.isCurrentSzn, true))
    .limit(1);
  return row ?? null;
}

export async function createSeason(input: {
  seasonNumber: number;
  leagueLink: string;
  makeCurrent?: boolean;
}): Promise<Season> {
  return db.transaction(async (tx) => {
    if (input.makeCurrent) {
      await tx
        .update(seasons)
        .set({ isCurrentSzn: false })
        .where(eq(seasons.isCurrentSzn, true));
    }
    const [row] = await tx
      .insert(seasons)
      .values({
        seasonNumber: input.seasonNumber,
        leagueLink: input.leagueLink,
        isCurrentSzn: !!input.makeCurrent,
      })
      .returning();
    return row;
  });
}

export async function setCurrentSeason(id: number): Promise<Season | null> {
  return db.transaction(async (tx) => {
    const [exists] = await tx
      .select()
      .from(seasons)
      .where(eq(seasons.id, id))
      .limit(1);
    if (!exists) return null;
    await tx
      .update(seasons)
      .set({ isCurrentSzn: false })
      .where(and(eq(seasons.isCurrentSzn, true), ne(seasons.id, id)));
    const [updated] = await tx
      .update(seasons)
      .set({ isCurrentSzn: true })
      .where(eq(seasons.id, id))
      .returning();
    return updated;
  });
}

export async function updateSeason(
  id: number,
  patch: { seasonNumber?: number; leagueLink?: string; sheetsLink?: string | null },
): Promise<Season | null> {
  const [row] = await db
    .update(seasons)
    .set(patch)
    .where(eq(seasons.id, id))
    .returning();
  return row ?? null;
}

export async function parseSeasonSheets(id: number) {
  const [row] = await db.select().from(seasons).where(eq(seasons.id, id)).limit(1);
  if (!row) throw new LeagueFetchError("Season not found", 404);
  if (!row.sheetsLink) throw new LeagueFetchError("No sheets link saved on this season", 400);
  return loadFreeAgentData(String(row.seasonNumber), row.sheetsLink);
}

export async function deleteSeason(id: number): Promise<boolean> {
  const rows = await db.delete(seasons).where(eq(seasons.id, id)).returning();
  return rows.length > 0;
}

/**
 * Pull the BBGM JSON from the link, read the season number out of it, then
 * insert-or-update the season row keyed on season_number.
 */
export async function upsertSeasonFromLink(input: {
  leagueLink: string;
  makeCurrent?: boolean;
}): Promise<{ season: Season; created: boolean; detectedSeason: number }> {
  const data = await fetchLeagueJson(input.leagueLink);
  const detected = extractSeasonNumber(data);
  if (detected == null) {
    throw new LeagueFetchError("Could not detect season from BBGM file", 422);
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(seasons)
      .where(eq(seasons.seasonNumber, detected))
      .limit(1);

    if (input.makeCurrent) {
      await tx
        .update(seasons)
        .set({ isCurrentSzn: false })
        .where(eq(seasons.isCurrentSzn, true));
    }

    if (existing) {
      const [updated] = await tx
        .update(seasons)
        .set({
          leagueLink: input.leagueLink,
          ...(input.makeCurrent ? { isCurrentSzn: true } : {}),
        })
        .where(eq(seasons.id, existing.id))
        .returning();
      return { season: updated, created: false, detectedSeason: detected };
    }

    const [row] = await tx
      .insert(seasons)
      .values({
        seasonNumber: detected,
        leagueLink: input.leagueLink,
        isCurrentSzn: !!input.makeCurrent,
      })
      .returning();
    return { season: row, created: true, detectedSeason: detected };
  });
}
