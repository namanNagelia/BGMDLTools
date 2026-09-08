import { describe, expect, test } from "vitest";
import { MAX_FETCH_BYTES, normalizeDropboxUrl } from "./league.service.js";

/**
 * Observed BGMDL export sizes (2187/2188):
 *   main league, gzipped   ~43MB
 *   main league, plain     ~190MB
 *   G-League,    plain     ~107MB
 *
 * Dropbox serves whatever was uploaded, so a plain-JSON export is normal —
 * the ceiling has to clear the largest realistic file with room to grow.
 */
describe("MAX_FETCH_BYTES", () => {
  test("admits an uncompressed G-League export", () => {
    expect(MAX_FETCH_BYTES).toBeGreaterThan(107 * 1024 * 1024);
  });

  test("admits an uncompressed main-league export", () => {
    expect(MAX_FETCH_BYTES).toBeGreaterThan(190 * 1024 * 1024);
  });

  test("still caps runaway downloads", () => {
    expect(MAX_FETCH_BYTES).toBeLessThanOrEqual(1024 * 1024 * 1024);
  });
});

describe("normalizeDropboxUrl", () => {
  test("forces a share link to direct download", () => {
    const url = normalizeDropboxUrl("https://www.dropbox.com/scl/fi/abc/league.json?rlkey=x&dl=0");
    expect(url).toContain("dl.dropboxusercontent.com");
    expect(url).toContain("dl=1");
  });

  test("rejects a non-https link", () => {
    expect(() => normalizeDropboxUrl("http://example.com/league.json")).toThrow(/https/);
  });
});
