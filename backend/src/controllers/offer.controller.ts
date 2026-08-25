import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as offerService from "../services/offer.service.js";
import { OfferValidationError } from "../services/offer.service.js";

const idParam = z.coerce.number().int().positive();

const createSchema = z.object({
  teamAbbrev: z.string().min(1).max(8),
  gm: z.string().min(1).max(64),
  codeWord: z.string().min(1).max(64),
  amount: z.coerce.number().positive(),
  years: z.coerce.number().int().positive(),
  isMLE: z.boolean().optional(),
  isDoubleDip: z.boolean().optional(),
});

const previewSchema = z.object({
  teamAbbrev: z.string().min(1).max(8),
  amount: z.coerce.number().positive(),
  years: z.coerce.number().int().positive(),
  isMLE: z.boolean().optional(),
});

export async function preview(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = idParam.safeParse(req.params.id);
  const body = previewSchema.safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  try {
    const result = await offerService.previewOffer({
      freeAgentId: id.data,
      ...body.data,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function create(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = idParam.safeParse(req.params.id);
  const body = createSchema.safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  try {
    const result = await offerService.createOffer({
      freeAgentId: id.data,
      ...body.data,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof OfferValidationError) {
      res.status(400).json({
        error: "offer_violates_contract_rules",
        violations: err.violations,
      });
      return;
    }
    next(err);
  }
}

export async function listAllForMod(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rows = await offerService.listAllOffersForCurrentSeason();
    res.json({ offers: rows });
  } catch (err) {
    next(err);
  }
}

export async function modAccept(
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
    const result = await offerService.modAcceptOffer(id.data);
    if (!result) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}

const lookupSchema = z.object({ codeWord: z.string().min(1).max(64) });

export async function lookupByCode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const body = lookupSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  try {
    const rows = await offerService.listOffersByCode(body.data.codeWord);
    res.json({ offers: rows });
  } catch (err) {
    next(err);
  }
}

const editSchema = z.object({
  codeWord: z.string().min(1).max(64),
  amount: z.coerce.number().positive().optional(),
  years: z.coerce.number().int().positive().optional(),
  isMLE: z.boolean().optional(),
  isDoubleDip: z.boolean().optional(),
});

export async function editByCode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = idParam.safeParse(req.params.id);
  const body = editSchema.safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  try {
    const result = await offerService.updateOfferByCode(id.data, body.data.codeWord, {
      amount: body.data.amount,
      years: body.data.years,
      isMLE: body.data.isMLE,
      isDoubleDip: body.data.isDoubleDip,
    });
    if (!result) {
      res.status(404).json({ error: "not_found_or_wrong_code" });
      return;
    }
    res.json(result);
  } catch (err) {
    if (err instanceof OfferValidationError) {
      res.status(400).json({
        error: "offer_violates_contract_rules",
        violations: err.violations,
      });
      return;
    }
    next(err);
  }
}

const codeOnlySchema = z.object({ codeWord: z.string().min(1).max(64) });

export async function withdrawByCode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = idParam.safeParse(req.params.id);
  const body = codeOnlySchema.safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  try {
    const ok = await offerService.withdrawOfferByCode(id.data, body.data.codeWord);
    if (!ok) {
      res.status(404).json({ error: "not_found_or_wrong_code" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function modWithdraw(
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
    const ok = await offerService.modWithdrawOffer(id.data);
    if (!ok) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
