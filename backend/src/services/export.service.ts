import { gzipSync } from "node:zlib";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { freeAgents, offers, seasons, teams } from "../db/schema.js";
import { fetchLeagueJson, LeagueFetchError } from "./league.service.js";

interface ContractWrite {
  pid?: number;
  fullName: string;
  newTid: number;
  amountThousands: number;
  exp: number;
}

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Pull the league export, apply every ACCEPTED offer (set player.tid +
 * player.contract on each signed FA), gzip the result, and return it.
 */
export async function buildSignedExport(seasonId: number): Promise<{
  filename: string;
  buffer: Buffer;
  signed: number;
  unmatched: string[];
}> {
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

  // index players by normalized full name
  const byName = new Map<string, (typeof data.players)[number]>();
  for (const p of data.players) {
    const full =
      p.name && typeof p.name === "string"
        ? p.name
        : `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
    if (full) byName.set(normName(full), p);
  }

  const writes: ContractWrite[] = [];
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
    writes.push({
      pid: p.pid,
      fullName: a.faName,
      newTid: tid,
      amountThousands: Math.round(Number(a.offer.offerAmount) * 1000),
      exp: season.seasonNumber + a.offer.offerLength,
    });
  }

  for (const w of writes) {
    const p = byName.get(normName(w.fullName));
    if (!p) continue;
    p.tid = w.newTid;
    p.contract = { amount: w.amountThousands, exp: w.exp };
  }

  const json = JSON.stringify(data);
  const gz = gzipSync(Buffer.from(json, "utf-8"));
  const filename = `BGMDL_${season.seasonNumber}_post_FA.json.gz`;
  return { filename, buffer: gz, signed: writes.length, unmatched };
}
