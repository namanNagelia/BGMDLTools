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

/**
 * Use the gviz endpoint with `tqx=out:csv` and `sheet=<name>` — this lets
 * us target a specific tab by name on any "anyone with the link" sheet,
 * without knowing its gid.
 */
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

/**
 * Match a city-only string ("San Diego") to a Market entry whose name
 * starts with that city ("San Diego Clippers"). Longest-prefix wins so
 * "Los Angeles" beats "Los".
 */
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

  // we don't trust a fixed header offset — header rows are skipped naturally
  // because the tier columns won't parse as numbers in them.
  const rows = data;

  // -------- Market: tier in col B (1), team in col C (2) ----------------
  // canonical source of team abbreviations
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

    // "Brooklyn Nets BKN" — last token is the abbreviation
    const lastSpace = cell.lastIndexOf(" ");
    if (lastSpace === -1) continue;
    const name = cell.slice(0, lastSpace).trim();
    const abbrev = cell.slice(lastSpace + 1).trim();
    if (!name || !abbrev) continue;
    // abbrev should look like an abbrev (all caps, short) — skip header noise
    if (abbrev.length > 5 || !/^[A-Z0-9]+$/.test(abbrev)) continue;
    market.push({ tier: marketTier, name, abbrev });
  }

  const nameToAbbrev = new Map<string, string>();
  for (const m of market) nameToAbbrev.set(m.name.toLowerCase(), m.abbrev);

  // -------- Legacy: tier=D(3), team=E(4), T=F(5), Fnls=G(6), PO%=H(7) --
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

    // ignore trailing SUM / SUM MUST EQUAL totals rows
    if (/^sum/i.test(name)) continue;

    const titlesRaw = (r[5] ?? "").trim();
    const finalsRaw = (r[6] ?? "").trim();
    const playoffPctRaw = (r[7] ?? "").trim();

    // skip header rows like "Team" / "Titles"
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

  // -------- Winning: rank=J(9), city=K(10) ------------------------------
  // The top 4 cells (Champion / Finals / CF / CF) are rendered via cell
  // formatting and come through as empty in raw CSV — infer rank by position.
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
      // empty rank cell — top 4 with formatted display, position-based
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
