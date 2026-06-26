/**
 * Single entry point for talking to the backend.
 * Every page imports from `@/lib/api` — never fetches directly.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });

  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `request_failed_${res.status}`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

// ---- Domain types ---------------------------------------------------------
export interface Season {
  id: number;
  seasonNumber: number;
  leagueLink: string;
  sheetsLink: string | null;
  isCurrentSzn: boolean;
  currentWave: number;
}

export interface RosterEntry {
  pid: number;
  name: string;
  pos: string | null;
  age: number | null;
  ovr: number | null;
  contractAmount: number; // millions
  contractExp: number | null;
}

export interface TeamRow {
  id: number;
  seasonId: number;
  tid: number;
  abbrev: string;
  name: string;
  totalSalary: string; // numeric — millions
  roster: RosterEntry[] | null;
}

export interface OfferWithFlags {
  id: number;
  freeAgentId: number;
  teamAbbrev: string;
  offerAmount: string;
  offerLength: number;
  offerSeason: number;
  offerGm: string;
  codeWord: string | null;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
  createdAt: string;
  invalidReasons: string[];
  playerName?: string;
  playerPreviousTeam?: string;
}

export interface SheetRow {
  [columnName: string]: string | number | boolean | null;
}

export interface ParsedSheets {
  freeAgentsByTeam: SheetRow[];
  freeAgentValues: SheetRow[];
  ranks: ParsedRanks & { error?: string };
}

export interface FreeAgent {
  id: number;
  seasonId: number;
  name: string;
  position: string;
  previousTeam: string;
  capHold: string;
  faStatus: "SIGNED" | "RFA" | "UFA" | "TBD";
  age: number;
  overall: number;
  marketValue: number;
  legacyValue: number;
  playingTimeValue: number;
  winningValue: number;
  loyaltyValue: number;
  moneyValue: number;
  lengthValue: number;
  wave: number;
  ratings: Record<string, number | string | null> | null;
  renounced: boolean;
  winningOfferId: number | null;
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

export interface IngestResult {
  seasonId: number;
  seasonNumber: number;
  inserted: number;
  matchedInBothSheets: number;
  unmatchedFromTeamSheet: string[];
  unmatchedFromValuesSheet: string[];
  ratingsAttached: number;
  ranks: {
    market: number;
    legacy: number;
    winning: number;
    unresolved: number;
    error?: string;
  };
}

export interface MarketRankRow {
  id: number;
  seasonId: number;
  teamAbbrev: string;
  teamName: string;
  rank: number;
}
export interface LegacyRankRow {
  id: number;
  seasonId: number;
  teamAbbrev: string;
  teamName: string;
  tier: number;
  titles: number;
  finals: number;
  playoffPct: string | null;
}
export interface WinningRankRow {
  id: number;
  seasonId: number;
  teamAbbrev: string;
  teamCity: string;
  rank: number;
  postseason: "CHAMPION" | "FINALS" | "CF" | null;
}
export interface CurrentSeasonRanks {
  market: Record<string, MarketRankRow>;
  legacy: Record<string, LegacyRankRow>;
  winning: Record<string, WinningRankRow>;
}

// ---- Mod auth -------------------------------------------------------------
export const mod = {
  async login(password: string): Promise<void> {
    await request<{ ok: true }>("/api/mod/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },

  async logout(): Promise<void> {
    await request<{ ok: true }>("/api/mod/logout", { method: "POST" });
  },

  async me(): Promise<{ role: "mod" | null }> {
    try {
      return await request<{ role: "mod" | null }>("/api/mod/me");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return { role: null };
      throw err;
    }
  },

  async fetchLeague(url: string): Promise<{ data: unknown }> {
    return request<{ data: unknown }>("/api/mod/league/fetch", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  },

  async listAllOffers(): Promise<OfferWithFlags[]> {
    const res = await request<{ offers: OfferWithFlags[] }>("/api/mod/offers");
    return res.offers;
  },

  async withdrawOffer(id: number): Promise<void> {
    await request<{ ok: true }>(`/api/mod/offers/${id}/withdraw`, {
      method: "POST",
    });
  },

  async acceptOffer(id: number): Promise<{
    accepted: OfferWithFlags;
    faId: number;
    rejectedIds: number[];
  }> {
    return request(`/api/mod/offers/${id}/accept`, { method: "POST" });
  },

  async calcFA(faId: number): Promise<CalcResult> {
    return request<CalcResult>(`/api/mod/free-agents/${faId}/calc`);
  },
};

// FA calc types ------------------------------------------------------------
export interface CalcValueLine {
  key:
    | "market"
    | "legacy"
    | "playingTime"
    | "winning"
    | "loyalty"
    | "money"
    | "length";
  playerValue: number;
  baseMultiplier: number;
  effectiveMultiplier: number;
  won: boolean;
  points: number;
  note?: string;
}

export interface CalcOfferScore {
  offerId: number;
  teamAbbrev: string;
  gm: string;
  amount: number;
  years: number;
  totalMoney: number;
  values: CalcValueLine[];
  total: number;
}

export interface CalcResult {
  player: {
    id: number;
    name: string;
    position: string;
    overall: number;
    faStatus: string;
    previousTeam: string;
    values: {
      market: number;
      legacy: number;
      playingTime: number;
      winning: number;
      loyalty: number;
      money: number;
      length: number;
    };
  };
  rounds: Array<{
    round: number;
    teams: CalcOfferScore[];
    eliminatedAbbrev?: string;
    eliminatedTotal?: number;
  }>;
  preFilter: Array<{ offerId: number; teamAbbrev: string; reason: string }>;
  winner: { abbrev: string; offerId: number; total: number } | null;
}

// ---- Seasons --------------------------------------------------------------
export const seasons = {
  async list(): Promise<Season[]> {
    const res = await request<{ seasons: Season[] }>("/api/mod/seasons");
    return res.seasons;
  },

  async create(input: {
    seasonNumber: number;
    leagueLink: string;
    makeCurrent?: boolean;
  }): Promise<Season> {
    const res = await request<{ season: Season }>("/api/mod/seasons", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return res.season;
  },

  async createFromLink(input: {
    leagueLink: string;
    makeCurrent?: boolean;
  }): Promise<{ season: Season; created: boolean; detectedSeason: number }> {
    return request("/api/mod/seasons/from-link", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async setCurrent(id: number): Promise<Season> {
    const res = await request<{ season: Season }>(`/api/mod/seasons/${id}/current`, {
      method: "POST",
    });
    return res.season;
  },

  async update(
    id: number,
    patch: {
      seasonNumber?: number;
      leagueLink?: string;
      sheetsLink?: string | null;
    },
  ): Promise<Season> {
    const res = await request<{ season: Season }>(`/api/mod/seasons/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return res.season;
  },

  async parseSheets(id: number): Promise<ParsedSheets> {
    return request<ParsedSheets>(`/api/mod/seasons/${id}/parse-sheets`, {
      method: "POST",
    });
  },

  async ingestFAs(id: number): Promise<IngestResult> {
    return request<IngestResult>(`/api/mod/seasons/${id}/ingest-fas`, {
      method: "POST",
    });
  },

  async setWave(id: number, wave: 1 | 2): Promise<Season> {
    const res = await request<{ season: Season }>(
      `/api/mod/seasons/${id}/wave/${wave}`,
      { method: "POST" },
    );
    return res.season;
  },

  async remove(id: number): Promise<void> {
    await request<{ ok: true }>(`/api/mod/seasons/${id}`, { method: "DELETE" });
  },
};

// ---- Public (no auth) -----------------------------------------------------
export const publicApi = {
  async currentSeasonFAs(): Promise<{
    season: Season | null;
    freeAgents: FreeAgent[];
    ranks: CurrentSeasonRanks;
    teams: Record<string, TeamRow>;
  }> {
    return request<{
      season: Season | null;
      freeAgents: FreeAgent[];
      ranks: CurrentSeasonRanks;
      teams: Record<string, TeamRow>;
    }>("/api/seasons/current/fas");
  },

  async renounce(
    faId: number,
    teamAbbrev: string,
    renounced: boolean,
  ): Promise<void> {
    await request<{ ok: true }>(`/api/free-agents/${faId}/renounce`, {
      method: "POST",
      body: JSON.stringify({ teamAbbrev, renounced }),
    });
  },

  async submitOffer(
    faId: number,
    input: {
      teamAbbrev: string;
      gm: string;
      codeWord?: string;
      amount: number;
      years: number;
    },
  ): Promise<{ offer: OfferWithFlags; invalidReasons: string[] }> {
    return request<{ offer: OfferWithFlags; invalidReasons: string[] }>(
      `/api/free-agents/${faId}/offers`,
      { method: "POST", body: JSON.stringify(input) },
    );
  },

  async previewOffer(
    faId: number,
    input: { teamAbbrev: string; amount: number; years: number },
  ): Promise<{ hardViolations: string[]; warnings: string[] }> {
    return request<{ hardViolations: string[]; warnings: string[] }>(
      `/api/free-agents/${faId}/offers/preview`,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
};
