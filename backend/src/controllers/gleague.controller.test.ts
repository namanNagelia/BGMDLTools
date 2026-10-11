/**
 * HTTP-level tests for the export downloads.
 *
 * These exist because the streaming path has failure modes the service tests
 * cannot see: headers committed before the slow work, then a second setHeader
 * that throws after the response is already on the wire.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import express from "express";
import request from "supertest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { seasons } from "../db/schema.js";
import { setGlLeagueLink } from "../services/gleague-season.service.js";
import { downloadExport, validateBatch } from "./gleague.controller.js";
import { errorHandler } from "../middleware/errorHandler.js";

const MAIN_URL = "https://fixture.test/main.json";
const GL_URL = "https://fixture.test/gl.json";
const files: Record<string, string> = {
  [MAIN_URL]: "../services/__fixtures__/main-postdraft.fixture.json",
  [GL_URL]: "../services/__fixtures__/gl.fixture.json",
};

let seasonId: number;

const app = express();
app.get("/export/:id/:side", (req, res, next) => {
  req.params.id = String(seasonId);
  return downloadExport(req, res, next);
});
app.use(express.json());
app.post("/validate/:id", (req, res, next) => {
  req.params.id = String(seasonId);
  return validateBatch(req, res, next);
});
app.use(errorHandler);

beforeAll(async () => {
  const [row] = await db
    .insert(seasons)
    .values({ seasonNumber: 9996, leagueLink: MAIN_URL })
    .returning();
  seasonId = row.id;
  await setGlLeagueLink(seasonId, GL_URL);

  // Serve the fixtures in place of the network for this suite.
  const { setLeagueSourceForTesting } = await import("../services/gleague-board.service.js");
  setLeagueSourceForTesting(async (link: string) =>
    JSON.parse(readFileSync(new URL(files[link], import.meta.url), "utf8")),
  );
});

afterAll(async () => {
  const { setLeagueSourceForTesting } = await import("../services/gleague-board.service.js");
  setLeagueSourceForTesting(null);
  await db.delete(seasons).where(eq(seasons.id, seasonId));
});

describe.each(["main", "gleague"] as const)("GET /export/:id/%s", (side) => {
  test("streams a non-empty gzip body", async () => {
    const res = await request(app).get(`/export/1/${side}`).buffer().parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });

    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
  });

  test("the body gunzips into a BBGM league with players and teams", async () => {
    const res = await request(app).get(`/export/1/${side}`).buffer().parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });

    const league = JSON.parse(gunzipSync(res.body as Buffer).toString("utf8"));
    expect(Array.isArray(league.players)).toBe(true);
    expect(league.teams).toHaveLength(30);
    expect(league.gameAttributes.season).toBe(side === "main" ? 2187 : 2188);
  });

  test("names the download and reports how many moves were applied", async () => {
    const res = await request(app).get(`/export/1/${side}`);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename=".*\.json\.gz"/);
    expect(res.headers["x-moves-applied"]).toBeDefined();
  });
});

/**
 * The mod API is the only way moves are made now, so it has to accept all
 * three of them and the mod's contract decision on a call-up.
 */
describe("POST /validate — the mod's move payloads", () => {
  test("accepts a cut", async () => {
    const res = await request(app)
      .post("/validate/1")
      .send({ moves: [{ direction: "RELEASE", glPid: 1, mainAbbrev: "NOP" }] });
    expect(res.status).toBe(200);
    expect(res.body.staged).toHaveLength(1);
  });

  test("accepts a call-up with a new deal", async () => {
    const res = await request(app)
      .post("/validate/1")
      .send({
        moves: [
          {
            direction: "CALLUP",
            glPid: 1,
            mainAbbrev: "NOP",
            years: 3,
            contract: { mode: "NEW", years: 3, amountM: 4.5 },
          },
        ],
      });
    expect(res.status).toBe(200);
  });

  test("accepts a call-up keeping the current deal", async () => {
    const res = await request(app)
      .post("/validate/1")
      .send({
        moves: [
          { direction: "CALLUP", glPid: 1, mainAbbrev: "NOP", years: 2, contract: { mode: "KEEP" } },
        ],
      });
    expect(res.status).toBe(200);
  });

  test("rejects a malformed contract", async () => {
    const res = await request(app)
      .post("/validate/1")
      .send({
        moves: [
          { direction: "CALLUP", glPid: 1, mainAbbrev: "NOP", years: 2, contract: { mode: "NEW" } },
        ],
      });
    expect(res.status).toBe(400);
  });
});
