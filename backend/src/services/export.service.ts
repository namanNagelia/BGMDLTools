import { createGzip, constants as zlibConstants } from "node:zlib";
import type { Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { freeAgents, offers, seasons, teams } from "../db/schema.js";
import { fetchLeagueJson, LeagueFetchError } from "./league.service.js";

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Pull the league export, apply every ACCEPTED offer (set player.tid +
 * player.contract on each signed FA), and stream the gzipped result to `res`.
 *
 * Headers are committed before the slow upstream fetch and gzip sync-flush
 * markers are emitted periodically so intermediaries (corporate proxies,
 * mobile NATs, CDNs) don't kill the connection as "idle" while we work.
 */
export async function streamSignedExport(
  seasonId: number,
  res: Response,
): Promise<void> {
  const [season] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .limit(1);
  if (!season) throw new LeagueFetchError("Season not found", 404);

  const accepted = await db
    .select({
      offer: offers,
      faName: freeAgents.name,
    })
    .from(offers)
    .innerJoin(freeAgents, eq(freeAgents.id, offers.freeAgentId))
    .where(and(eq(offers.offerSeason, seasonId), eq(offers.status, "ACCEPTED")));

  const filename = `BGMDL_${season.seasonNumber}_post_FA.json.gz`;

  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-Signed-Count", String(accepted.length));
  res.flushHeaders();

  const gz = createGzip();
  gz.pipe(res);

  const heartbeat = setInterval(() => {
    gz.flush(zlibConstants.Z_SYNC_FLUSH);
  }, 15_000);

  try {
    const teamRows = await db
      .select()
      .from(teams)
      .where(eq(teams.seasonId, seasonId));
    const abbrevToTid = new Map(teamRows.map((t) => [t.abbrev, t.tid]));

    const data = (await fetchLeagueJson(season.leagueLink)) as {
      players?: Array<{
        pid?: number;
        tid?: number;
        name?: string;
        firstName?: string;
        lastName?: string;
        contract?: { amount?: number; exp?: number };
      }>;
    };
    if (!data || !Array.isArray(data.players)) {
      throw new LeagueFetchError("BBGM JSON has no players array", 422);
    }

    const byName = new Map<string, (typeof data.players)[number]>();
    for (const p of data.players) {
      const full =
        p.name && typeof p.name === "string"
          ? p.name
          : `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
      if (full) byName.set(normName(full), p);
    }

    const unmatched: string[] = [];
    for (const a of accepted) {
      const tid = abbrevToTid.get(a.offer.teamAbbrev);
      if (tid == null) {
        unmatched.push(`${a.faName} → ${a.offer.teamAbbrev} (unknown team)`);
        continue;
      }
      const p = byName.get(normName(a.faName));
      if (!p) {
        unmatched.push(`${a.faName} (player not in BBGM)`);
        continue;
      }
      p.tid = tid;
      p.contract = {
        amount: Math.round(Number(a.offer.offerAmount) * 1000),
        exp: season.seasonNumber + a.offer.offerLength,
      };
    }
    if (unmatched.length) {
      console.warn(
        `[signed-export] season ${seasonId} unmatched (${unmatched.length}):`,
        unmatched,
      );
    }

    gz.end(JSON.stringify(data));
    await new Promise<void>((resolve, reject) => {
      res.on("finish", resolve);
      res.on("close", resolve);
      gz.on("error", reject);
    });
  } finally {
    clearInterval(heartbeat);
  }
}
