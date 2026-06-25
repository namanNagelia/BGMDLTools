import type { Request, Response, NextFunction } from "express";
import { LeagueFetchError } from "../services/league.service.js";
import { RankFetchError } from "../services/rank.service.js";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof LeagueFetchError || err instanceof RankFetchError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_server_error" });
}
