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
}

export interface SheetRow {
  [columnName: string]: string | number | boolean | null;
}

export interface ParsedSheets {
  freeAgentsByTeam: SheetRow[];
  freeAgentValues: SheetRow[];
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
  ratings: Record<string, number | string | null> | null;
  winningOfferId: number | null;
}

export interface IngestResult {
  seasonId: number;
  seasonNumber: number;
  inserted: number;
  matchedInBothSheets: number;
  unmatchedFromTeamSheet: string[];
  unmatchedFromValuesSheet: string[];
  ratingsAttached: number;
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
};

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

  async remove(id: number): Promise<void> {
    await request<{ ok: true }>(`/api/mod/seasons/${id}`, { method: "DELETE" });
  },
};

// ---- Public (no auth) -----------------------------------------------------
export const publicApi = {
  async currentSeasonFAs(): Promise<{
    season: Season | null;
    freeAgents: FreeAgent[];
  }> {
    return request<{ season: Season | null; freeAgents: FreeAgent[] }>(
      "/api/seasons/current/fas",
    );
  },
};
