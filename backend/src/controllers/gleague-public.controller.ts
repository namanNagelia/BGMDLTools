/**
 * Public G-League endpoints — no mod password.
 *
 * A GM here submits *requests*, never moves. Everything lands at PROPOSED and
 * waits for a mod, which is what makes an unauthenticated page safe: the worst
 * a bad submission can do is sit in a queue until someone declines it.
 */
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { LeagueFetchError } from "../services/league.service.js";
import {
  buildBoard,
  pendingRequests,
  submitProposals,
  validateProposals,
  type Proposal,
} from "../services/gleague-board.service.js";
import { getCurrentSeason } from "../services/season.service.js";
import { withdrawProposal } from "../services/gleague-season.service.js";

/** The public side always acts on the season the mods have marked current. */
async function currentSeasonId(): Promise<number> {
  const season = await getCurrentSeason();
  if (!season) throw new LeagueFetchError("No current season", 404);
  if (!season.glLeagueLink) {
    throw new LeagueFetchError("The G-League export has not been filed for this season yet", 400);
  }
  return season.id;
}

const proposalSchema = z.discriminatedUnion("direction", [
  z.object({
    direction: z.literal("ASSIGN"),
    pid: z.number().int(),
    glAbbrev: z.string().min(1).max(8),
  }),
  z.object({
    direction: z.literal("CALLUP"),
    glPid: z.number().int(),
    mainAbbrev: z.string().min(1).max(8),
    years: z.number().int().min(2).max(5),
  }),
  z.object({
    direction: z.literal("RELEASE"),
    glPid: z.number().int(),
    mainAbbrev: z.string().min(1).max(8),
  }),
]);

const submitSchema = z.object({
  teamAbbrev: z.string().min(1).max(8),
  gm: z.string().min(1).max(64),
  moves: z.array(proposalSchema).min(1).max(20),
});

export async function getBoard(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await buildBoard(await currentSeasonId()));
  } catch (err) {
    next(err);
  }
}

export async function submit(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) throw new LeagueFetchError("Invalid submission", 400);
    const { teamAbbrev, gm, moves } = parsed.data;

    // A submission only ever concerns the submitting team's own players.
    for (const m of moves) {
      const target = m.direction === "ASSIGN" ? m.glAbbrev : m.mainAbbrev;
      if (target !== teamAbbrev) {
        throw new LeagueFetchError(
          `Move targets ${target} but the submission is from ${teamAbbrev}`,
          400,
        );
      }
    }

    const seasonId = await currentSeasonId();
    const result = await submitProposals(seasonId, moves as Proposal[], { gm, teamAbbrev });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function listMine(req: Request, res: Response, next: NextFunction) {
  try {
    const team = z.string().min(1).max(8).safeParse(req.query.teamAbbrev);
    if (!team.success) throw new LeagueFetchError("teamAbbrev is required", 400);
    res.json({ requests: await pendingRequests(await currentSeasonId(), team.data) });
  } catch (err) {
    next(err);
  }
}

export async function withdraw(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    const team = z.string().min(1).max(8).safeParse(req.body?.teamAbbrev);
    if (!id.success || !team.success) throw new LeagueFetchError("Invalid withdraw request", 400);

    const ok = await withdrawProposal(await currentSeasonId(), id.data, team.data);
    if (!ok) {
      throw new LeagueFetchError("That request is not pending, or belongs to another team", 404);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Dry-run a batch: what each move costs and which rules it trips, without
 * writing anything. This is what puts real contract figures in front of a GM
 * before they commit to sending the request.
 */
export async function preview(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = z
      .object({ moves: z.array(proposalSchema).min(1).max(20) })
      .safeParse(req.body);
    if (!parsed.success) throw new LeagueFetchError("Invalid preview request", 400);
    res.json(await validateProposals(await currentSeasonId(), parsed.data.moves as Proposal[]));
  } catch (err) {
    next(err);
  }
}
