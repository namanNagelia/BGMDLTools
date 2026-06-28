import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as seasonService from "../services/season.service.js";
import * as faService from "../services/fa.service.js";

const createSchema = z.object({
  seasonNumber: z.coerce.number().int().positive(),
  leagueLink: z.url(),
  makeCurrent: z.boolean().optional(),
});

const updateSchema = z.object({
  seasonNumber: z.coerce.number().int().positive().optional(),
  leagueLink: z.url().optional(),
  sheetsLink: z.union([z.url(), z.null()]).optional(),
});

const fromLinkSchema = z.object({
  leagueLink: z.url(),
  makeCurrent: z.boolean().optional(),
});

const waveParam = z.coerce.number().int().min(1).max(2);

const idParam = z.coerce.number().int().positive();

export async function list(_req: Request, res: Response): Promise<void> {
  const rows = await seasonService.listSeasons();
  res.json({ seasons: rows });
}

export async function create(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const row = await seasonService.createSeason(parsed.data);
  res.status(201).json({ season: row });
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = idParam.safeParse(req.params.id);
  const body = updateSchema.safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  if (Object.keys(body.data).length === 0) {
    res.status(400).json({ error: "no_fields_to_update" });
    return;
  }
  const row = await seasonService.updateSeason(id.data, body.data);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ season: row });
}

export async function setCurrent(req: Request, res: Response): Promise<void> {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const row = await seasonService.setCurrentSeason(id.data);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ season: row });
}

export async function createFromLink(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = fromLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const result = await seasonService.upsertSeasonFromLink(parsed.data);
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function setWave(req: Request, res: Response): Promise<void> {
  const id = idParam.safeParse(req.params.id);
  const wave = waveParam.safeParse(req.params.wave);
  if (!id.success || !wave.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const result = await seasonService.setSeasonWave(id.data, wave.data);
  if (!result) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(result);
}

const reassignSchema = z.object({ teamAbbrev: z.string().min(1).max(8) });

export async function reassignRights(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = idParam.safeParse(req.params.id);
  const body = reassignSchema.safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  try {
    const updated = await faService.reassignFARights(id.data, body.data.teamAbbrev);
    if (!updated) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ freeAgent: updated });
  } catch (err) {
    next(err);
  }
}

export async function ingestFAs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  try {
    const result = await faService.ingestFreeAgents(id.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listCurrentSeasonFAs(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await faService.listFreeAgentsForCurrentSeason();
    res.json(data);
  } catch (err) {
    next(err);
  }
}

const renounceSchema = z.object({
  teamAbbrev: z.string().min(1).max(8),
  renounced: z.boolean(),
});

export async function renounceFA(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = idParam.safeParse(req.params.id);
  const body = renounceSchema.safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  try {
    const result = await faService.setRenounced(
      id.data,
      body.data.teamAbbrev,
      body.data.renounced,
    );
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function parseSheets(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  try {
    const data = await seasonService.parseSeasonSheets(id.data);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function reset(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  try {
    const result = await seasonService.resetSeasonFA(id.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const ok = await seasonService.deleteSeason(id.data);
  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
}
