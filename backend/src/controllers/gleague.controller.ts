import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { createGzip, constants as zlibConstants } from "node:zlib";
import { LeagueFetchError } from "../services/league.service.js";
import {
  buildBoard,
  commitProposals,
  getSeasonRow,
  loadPair,
  validateProposals,
  type Proposal,
} from "../services/gleague-board.service.js";
import { listMoves, setGlLeagueLink } from "../services/gleague-season.service.js";
import { upsertSeasonFromLink } from "../services/season.service.js";

const seasonIdOf = (req: Request): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new LeagueFetchError("Invalid season id", 400);
  return id;
};

const proposalSchema = z.discriminatedUnion("direction", [
  z.object({
    direction: z.literal("ASSIGN"),
    pid: z.number().int(),
    glAbbrev: z.string().min(1),
    overrideReason: z.string().optional(),
  }),
  z.object({
    direction: z.literal("CALLUP"),
    glPid: z.number().int(),
    mainAbbrev: z.string().min(1),
    years: z.number().int().min(2).max(5),
    overrideReason: z.string().optional(),
  }),
]);

const batchSchema = z.object({ moves: z.array(proposalSchema).max(200) });

/** Attach a G-League export to a season. */
export async function linkGlExport(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = z.object({ leagueLink: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) throw new LeagueFetchError("leagueLink is required", 400);

    const season = await setGlLeagueLink(seasonIdOf(req), parsed.data.leagueLink);
    if (!season) throw new LeagueFetchError("Season not found", 404);
    res.json({ season });
  } catch (err) {
    next(err);
  }
}

export async function getBoard(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await buildBoard(seasonIdOf(req)));
  } catch (err) {
    next(err);
  }
}

export async function validateBatch(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) throw new LeagueFetchError("Invalid moves payload", 400);
    res.json(await validateProposals(seasonIdOf(req), parsed.data.moves as Proposal[]));
  } catch (err) {
    next(err);
  }
}

export async function commitBatch(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) throw new LeagueFetchError("Invalid moves payload", 400);
    res.json(await commitProposals(seasonIdOf(req), parsed.data.moves as Proposal[]));
  } catch (err) {
    next(err);
  }
}

/**
 * Stream one side of the pair with the whole ledger applied.
 *
 * Headers go out before the slow upstream fetch, and the gzip stream is
 * sync-flushed periodically so proxies don't drop the connection as idle —
 * same approach as the FA signed-export download.
 */
export async function downloadExport(req: Request, res: Response, next: NextFunction) {
  const side = req.params.side === "gleague" ? "gleague" : "main";
  try {
    const seasonId = seasonIdOf(req);

    // Every header must be set before the response is committed — setHeader
    // after flushHeaders throws, and by then the status is already on the wire.
    // The season row is a single cheap query, so the filename is known up front.
    const [season, ledger] = await Promise.all([
      getSeasonRow(seasonId),
      listMoves(seasonId),
    ]);
    if (!season) throw new LeagueFetchError("Season not found", 404);

    const name =
      side === "gleague"
        ? `BGMDL_GL_${season.seasonNumber}_post_gleague.json.gz`
        : `BGMDL_${season.seasonNumber}_post_gleague.json.gz`;

    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("X-Moves-Applied", String(ledger.length));
    res.flushHeaders();

    const gz = createGzip();
    gz.pipe(res);
    const heartbeat = setInterval(() => gz.flush(zlibConstants.Z_SYNC_FLUSH), 15_000);

    try {
      const { main, gl } = await loadPair(seasonId);
      gz.end(JSON.stringify(side === "gleague" ? gl : main));
      await new Promise<void>((resolve, reject) => {
        res.on("finish", resolve);
        res.on("close", resolve);
        gz.on("error", reject);
      });
    } catch (err) {
      // Headers are already out, so the only honest signal left is an abrupt
      // close — a truncated gzip fails loudly rather than looking complete.
      console.error(`[gl-export] season ${seasonId} ${side} failed:`, err);
      gz.destroy();
      res.destroy();
    } finally {
      clearInterval(heartbeat);
    }
  } catch (err) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    next(err);
  }
}

/** Pull the G-League export by link and file it against the season. */
export async function fetchGlLeague(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = z.object({ leagueLink: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) throw new LeagueFetchError("leagueLink is required", 400);
    const result = await upsertSeasonFromLink({ leagueLink: parsed.data.leagueLink });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
