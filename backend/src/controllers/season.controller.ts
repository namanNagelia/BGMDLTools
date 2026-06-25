import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as seasonService from "../services/season.service.js";

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
