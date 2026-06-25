import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  sessionCookie,
  signSession,
  verifyPassword,
} from "../services/auth.service.js";
import { fetchLeagueJson } from "../services/league.service.js";

const isProd = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax" as const,
  path: "/",
  maxAge: sessionCookie.maxAgeMs,
};

const loginSchema = z.object({ password: z.string().min(1) });
const fetchSchema = z.object({ url: z.url() });

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  if (!verifyPassword(parsed.data.password)) {
    await new Promise((r) => setTimeout(r, 300));
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const token = signSession();
  res.cookie(sessionCookie.name, token, cookieOptions);
  res.json({ ok: true });
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie(sessionCookie.name, { ...cookieOptions, maxAge: 0 });
  res.json({ ok: true });
}

export function me(req: Request, res: Response): void {
  res.json({ role: req.modSession?.role ?? null });
}

export async function fetchLeague(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = fetchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const json = await fetchLeagueJson(parsed.data.url);
    res.json({ data: json });
  } catch (err) {
    next(err);
  }
}

