import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { buildSignedExport } from "../services/export.service.js";

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
    const { filename, buffer, signed, unmatched } = await buildSignedExport(id.data);
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Signed-Count", String(signed));
    res.setHeader("X-Unmatched-Count", String(unmatched.length));
    res.end(buffer);
  } catch (err) {
    next(err);
  }
}
