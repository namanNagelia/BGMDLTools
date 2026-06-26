import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { calcFreeAgentWinner } from "../services/fa-calc.service.js";

const idParam = z.coerce.number().int().positive();

export async function calcFA(
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
    const result = await calcFreeAgentWinner(id.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
