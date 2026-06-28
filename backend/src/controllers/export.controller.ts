import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { streamSignedExport } from "../services/export.service.js";

const idParam = z.coerce.number().int().positive();

export async function downloadSignedExport(
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
    await streamSignedExport(id.data, res);
  } catch (err) {
    if (!res.headersSent) return next(err);
    res.destroy(err as Error);
  }
}
