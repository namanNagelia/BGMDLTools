import Papa from "papaparse";

export class RankFetchError extends Error {
  constructor(
    message: string,
    public status: number = 400,
  ) {
    super(message);
    this.name = "RankFetchError";
  }
}

export interface MarketEntry {
  tier: number;
  abbrev: string;
  name: string;
}

export interface LegacyEntry {
  tier: number;
  abbrev: string;
  name: string;
  titles: number;
  finals: number;
  playoffPct: number | null;
}

export interface WinningEntry {
  rank: number;
  city: string;
  abbrev: string;
  postseason: "CHAMPION" | "FINALS" | "CF" | null;
}

export interface ParsedRanks {
  market: MarketEntry[];
  legacy: LegacyEntry[];
  winning: WinningEntry[];
}

function extractSpreadsheetId(sheetUrl: string): string {
  let url: URL;
  try {
    url = new URL(sheetUrl);
  } catch {
    throw new RankFetchError("Invalid sheet URL");
  }
  const idMatch = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) throw new RankFetchError("URL is not a Google Sheets link");
  return idMatch[1];
}

/** Target a specific tab by name via gviz CSV — no gid required. */
function buildGvizCsvUrl(spreadsheetId: string, sheetName: string): string {
  const params = new URLSearchParams({ tqx: "out:csv", sheet: sheetName });
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?${params.toString()}`;
}

async function fetchCsv(spreadsheetId: string, sheetName: string): Promise<string> {
  const csvUrl = buildGvizCsvUrl(spreadsheetId, sheetName);
  const res = await fetch(csvUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new RankFetchError(`Rank sheet fetch failed (${res.status})`, 502);
  }
  return res.text();
}

function parsePostseason(raw: string): WinningEntry["postseason"] {
  const v = raw.toUpperCase();
  if (v.includes("CHAMPION")) return "CHAMPION";
  if (v.includes("FINALS")) return "FINALS";
  if (v.includes("CF")) return "CF";
  return null;
}

/** Match a city to a Market entry whose full name starts with it; longest prefix wins. */
function findAbbrevByCity(city: string, market: MarketEntry[]): string | null {
  const c = city.trim().toLowerCase();
  let best: MarketEntry | null = null;
  for (const m of market) {
    if (m.name.toLowerCase().startsWith(c)) {
      if (!best || m.name.length > best.name.length) best = m;
    }
  }
  return best?.abbrev ?? null;
}

export async function loadSeasonRanks(
  sheetUrl: string,
  sheetName: string,
): Promise<ParsedRanks> {
  const spreadsheetId = extractSpreadsheetId(sheetUrl);
  const csv = await fetchCsv(spreadsheetId, sheetName);

  const { data, errors } = Papa.parse<string[]>(csv, {
    header: false,
    skipEmptyLines: true,
  });
  if (errors.length > 0 && data.length === 0) {
    throw new RankFetchError("CSV parse failed", 422);
  }

  const rows = data;

  // Market (cols B/C) — canonical source of abbreviations
  const market: MarketEntry[] = [];
  let marketTier: number | null = null;

  for (const r of rows) {
    const tierRaw = (r[1] ?? "").trim();
    if (tierRaw) {
      const n = Number(tierRaw);
      if (Number.isFinite(n)) marketTier = n;
    }
    const cell = (r[2] ?? "").trim();
    if (marketTier == null || !cell) continue;

    const lastSpace = cell.lastIndexOf(" ");
    if (lastSpace === -1) continue;
    const name = cell.slice(0, lastSpace).trim();
    const abbrev = cell.slice(lastSpace + 1).trim();
    if (!name || !abbrev) continue;
    if (abbrev.length > 5 || !/^[A-Z0-9]+$/.test(abbrev)) continue;
    market.push({ tier: marketTier, name, abbrev });
  }

  const nameToAbbrev = new Map<string, string>();
  for (const m of market) nameToAbbrev.set(m.name.toLowerCase(), m.abbrev);

  // Legacy (cols D-H)
  const legacy: LegacyEntry[] = [];
  let legacyTier: number | null = null;

  for (const r of rows) {
    const tierRaw = (r[3] ?? "").trim();
    if (tierRaw) {
      const n = Number(tierRaw);
      if (Number.isFinite(n)) legacyTier = n;
    }
    const name = (r[4] ?? "").trim();
    if (legacyTier == null || !name) continue;

    if (/^sum/i.test(name)) continue;

    const titlesRaw = (r[5] ?? "").trim();
    const finalsRaw = (r[6] ?? "").trim();
    const playoffPctRaw = (r[7] ?? "").trim();

    if (!/^\d/.test(titlesRaw) && titlesRaw !== "0") continue;

    legacy.push({
      tier: legacyTier,
      abbrev: nameToAbbrev.get(name.toLowerCase()) ?? "?",
      name,
      titles: Number(titlesRaw),
      finals: finalsRaw ? Number(finalsRaw) : 0,
      playoffPct: playoffPctRaw ? Number(playoffPctRaw) : null,
    });
  }

  // Winning (cols J/K) — top 4 cells render via Sheets formatting and come
  // through empty in raw CSV, so we infer rank by row order.
  const POSTSEASON_BY_RANK: Record<number, WinningEntry["postseason"]> = {
    1: "CHAMPION",
    2: "FINALS",
    3: "CF",
    4: "CF",
  };

  const winning: WinningEntry[] = [];

  for (const r of rows) {
    const rankRaw = (r[9] ?? "").trim();
    const city = (r[10] ?? "").trim();
    if (!city || city.toLowerCase() === "team") continue;

    let rank: number;
    let postseason: WinningEntry["postseason"] = null;

    if (rankRaw) {
      const m = rankRaw.match(/^(\d+)\s*(?:\(([^)]*)\))?/);
      if (!m) continue;
      rank = Number(m[1]);
      postseason = m[2] ? parsePostseason(m[2]) : (POSTSEASON_BY_RANK[rank] ?? null);
    } else {
      rank = winning.length + 1;
      postseason = POSTSEASON_BY_RANK[rank] ?? null;
    }

    if (!Number.isFinite(rank)) continue;

    winning.push({
      rank,
      city,
      abbrev: findAbbrevByCity(city, market) ?? "?",
      postseason,
    });
  }

  return { market, legacy, winning };
}
