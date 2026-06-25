import { timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

const SESSION_COOKIE = "mod_session";
const MAX_AGE_SECONDS = 60 * 60 * 24; // 24h

export interface ModSession {
  role: "mod";
  iat: number;
  exp: number;
}

export function verifyPassword(input: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(config.MOD_PASSWORD);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signSession(): string {
  return jwt.sign({ role: "mod" as const }, config.MOD_JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: MAX_AGE_SECONDS,
  });
}

export function verifySession(token: string): ModSession | null {
  try {
    const decoded = jwt.verify(token, config.MOD_JWT_SECRET, { algorithms: ["HS256"] });
    if (typeof decoded === "object" && decoded && (decoded as ModSession).role === "mod") {
      return decoded as ModSession;
    }
    return null;
  } catch {
    return null;
  }
}

export const sessionCookie = {
  name: SESSION_COOKIE,
  maxAgeMs: MAX_AGE_SECONDS * 1000,
};
