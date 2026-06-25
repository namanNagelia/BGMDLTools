import type { Request, Response, NextFunction } from "express";
import { sessionCookie, verifySession, type ModSession } from "../services/auth.service.js";

declare global {
  namespace Express {
    interface Request {
      modSession?: ModSession;
    }
  }
}

export function modAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[sessionCookie.name];
  if (typeof token !== "string") {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const session = verifySession(token);
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.modSession = session;
  next();
}
