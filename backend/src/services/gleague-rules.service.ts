/**
 * G-League rules engine. Pure functions over BBGM player objects — no DB, no
 * network, no I/O. Every rule here traces to a numbered rule in #g-league_rules.
 *
 * Money is $M at this layer; BBGM's thousands are converted at the boundary.
 */
import {
  callUpMinimumM,
  fromBbgmAmount,
  GL_HOARD_LIMIT,
  GL_MAX_ASSIGNED,
  GL_MAX_ROSTER,
  GL_MIN_ROSTER,
  MAX_ASSIGN_AGE,
  MAX_ASSIGN_OVR,
  MAX_ASSIGN_SALARY_M,
  MIN_CALLUP_OVR,
} from "./gleague.constants.js";

export type BbgmTransaction = { season: number; phase: number; tid: number; type: string };

export type BbgmPlayer = {
  pid: number;
  tid: number;
  firstName: string;
  lastName: string;
  born: { year: number; loc?: string };
  draft: { round: number; pick: number; year: number; tid?: number; originalTid?: number };
  contract: { amount: number; exp: number };
  ratings: Array<{ season?: number; ovr: number; pos?: string }>;
  transactions?: BbgmTransaction[];
  watch?: number;
  [key: string]: unknown;
};

export type LeagueCtx = {
  season: number;
  rookieContractLengths: number[];
};

export type Severity = "HARD" | "SOFT";
export type Violation = { code: string; severity: Severity; message: string };

const hard = (code: string, message: string): Violation => ({ code, severity: "HARD", message });
const soft = (code: string, message: string): Violation => ({ code, severity: "SOFT", message });

/** Most recent ratings row wins — BBGM appends one per season. */
export function playerOvr(p: BbgmPlayer, season: number): number {
  const exact = p.ratings.find((r) => r.season === season);
  return (exact ?? p.ratings[p.ratings.length - 1]).ovr;
}

export function playerAge(p: BbgmPlayer, season: number): number {
  return season - p.born.year;
}

export function playerName(p: BbgmPlayer): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

/** Stable cross-league identity: the two exports have independent pid spaces. */
export function playerKey(p: BbgmPlayer): string {
  return `${playerName(p).toLowerCase().replace(/\s+/g, " ")}|${p.born.year}`;
}

export function buildLeagueCtx(league: { gameAttributes: Record<string, unknown> }): LeagueCtx {
  const ga = league.gameAttributes;
  const season = ga.season as number;
  const rookieContractLengths = (ga.rookieContractLengths as number[]) ?? [4, 3];
  return { season, rookieContractLengths };
}

/**
 * A player is on a rookie contract when he was drafted, his contract still
 * expires exactly at the end of his draft-scale term, and he has not signed
 * as a free agent or re-signed since. Verified against the 2187 export:
 * identifies 140 of 281 rostered players.
 */
export function isRookieContract(p: BbgmPlayer, ctx: LeagueCtx): boolean {
  const round = p.draft?.round ?? 0;
  if (round < 1) return false;

  const length = ctx.rookieContractLengths[round - 1];
  if (!length) return false;
  if (p.contract.exp !== p.draft.year + length) return false;

  return !(p.transactions ?? []).some(
    (t) => t.season > p.draft.year && (t.type === "freeAgent" || t.type === "reSigned"),
  );
}

/**
 * Rule #2: rookies who are "top 5 (or tied) in OVR in their draft class" cannot
 * be assigned in their first season. Ties at the cutoff are included, so the
 * returned set can exceed `size`.
 */
export function topDraftClassPids(
  players: BbgmPlayer[],
  draftYear: number,
  season: number,
  size = 5,
): Set<number> {
  const klass = players
    .filter((p) => p.draft?.year === draftYear && (p.draft.round ?? 0) >= 1)
    .map((p) => ({ pid: p.pid, ovr: playerOvr(p, season) }))
    .sort((a, b) => b.ovr - a.ovr);

  if (klass.length === 0) return new Set();
  const cutoff = klass[Math.min(size, klass.length) - 1].ovr;
  return new Set(klass.filter((p) => p.ovr >= cutoff).map((p) => p.pid));
}

export type AssignCtx = LeagueCtx & { topDraftClassPids: Set<number> };

/** Rule #2 assignment criteria. Any violation is a hard block. */
export function checkAssignEligibility(p: BbgmPlayer, ctx: AssignCtx): Violation[] {
  const out: Violation[] = [];
  const ovr = playerOvr(p, ctx.season);
  const age = playerAge(p, ctx.season);
  const salaryM = fromBbgmAmount(p.contract.amount);

  if (ovr > MAX_ASSIGN_OVR) {
    out.push(hard("OVR_TOO_HIGH", `${ovr} OVR — must be ${MAX_ASSIGN_OVR} or less`));
  }
  if (age > MAX_ASSIGN_AGE) {
    out.push(hard("TOO_OLD", `${age} years old — must be ${MAX_ASSIGN_AGE} or less`));
  }

  // The $5M ceiling does not apply to rookie-contract players.
  const onRookieDeal = isRookieContract(p, ctx);
  if (salaryM > MAX_ASSIGN_SALARY_M && !onRookieDeal) {
    out.push(
      hard(
        "SALARY_TOO_HIGH",
        `$${salaryM.toFixed(2)}M — must be $${MAX_ASSIGN_SALARY_M.toFixed(2)}M or less (rookie contracts exempt)`,
      ),
    );
  }

  // ...but a top-5 rookie is frozen for his first season regardless.
  if (onRookieDeal && p.draft.year === ctx.season && ctx.topDraftClassPids.has(p.pid)) {
    out.push(
      hard(
        "TOP_DRAFT_CLASS_ROOKIE",
        `top-5 OVR in the ${p.draft.year} draft class — cannot be assigned in his first season`,
      ),
    );
  }

  return out;
}

/** Rule #7 roster shape. All soft — mods override with a recorded reason. */
export function checkAffiliateRoster(roster: Array<{ assigned: boolean }>): Violation[] {
  const out: Violation[] = [];
  const total = roster.length;
  const assigned = roster.filter((r) => r.assigned).length;

  if (total < GL_MIN_ROSTER) {
    out.push(soft("BELOW_MIN_ROSTER", `${total} players — minimum is ${GL_MIN_ROSTER}`));
  }
  if (total > GL_MAX_ROSTER) {
    out.push(soft("ABOVE_MAX_ROSTER", `${total} players — maximum is ${GL_MAX_ROSTER}`));
  }
  if (total > GL_HOARD_LIMIT) {
    out.push(soft("HOARD_LIMIT", `${total} players — hard hoard limit is ${GL_HOARD_LIMIT}`));
  }
  if (assigned > GL_MAX_ASSIGNED) {
    out.push(
      soft("TOO_MANY_ASSIGNED", `${assigned} assigned — maximum is ${GL_MAX_ASSIGNED}`),
    );
  }
  return out;
}

export type CallUpContractInput = {
  /** The player's main-league contract as captured at assignment, if any. */
  snapshot: { amountM: number; exp: number } | null;
  ovr: number;
  years: number;
  season: number;
  wasRookieContract: boolean;
  /**
   * Main-league minimum, $M. Supplied for forced call-ups — a player who aged
   * out or outgrew the salary limit must come up even below 55 OVR, where the
   * pay scale has no entry for him.
   */
  minContractM?: number;
};

export type CallUpContract = {
  amountM: number;
  exp: number;
  source: "RESTORED" | "PAYSCALE" | "MINIMUM";
  rfaRightsLost: boolean;
};

/**
 * Rule #5. An unexpired main-league contract is restored exactly as it was —
 * that covers "placed back onto that contract" and, because we snapshot at
 * assignment, rookie deals carry over for free. An expired deal is replaced
 * off the call-up pay scale, and an expired *rookie* deal costs RFA rights.
 */
export function resolveCallUpContract(input: CallUpContractInput): CallUpContract {
  const { snapshot, ovr, years, season, wasRookieContract, minContractM } = input;
  const stillRunning = snapshot != null && snapshot.exp >= season;

  if (stillRunning) {
    return {
      amountM: snapshot.amountM,
      exp: snapshot.exp,
      source: "RESTORED",
      rfaRightsLost: false,
    };
  }

  const belowScale = ovr < MIN_CALLUP_OVR;
  if (belowScale && minContractM == null) {
    // No scale entry and no minimum to fall back on — the caller has to decide.
    callUpMinimumM(ovr, years);
  }

  return {
    amountM: belowScale ? minContractM! : callUpMinimumM(ovr, years),
    exp: season + years,
    source: belowScale ? "MINIMUM" : "PAYSCALE",
    rfaRightsLost: wasRookieContract,
  };
}

export type CallUpCheckInput = {
  ovr: number;
  /** Main-league payroll before the call-up, $M. */
  payrollM: number;
  /** The call-up's incoming contract, $M. */
  contractM: number;
  hardCapM: number;
  /** Full G-League seasons this player has served since being assigned. */
  seasonsServed: number;
};

/** Rule #4 + misc. Hard cap is a block; the service-time rule is a warning. */
export function checkCallUp(input: CallUpCheckInput): Violation[] {
  const out: Violation[] = [];
  const projected = input.payrollM + input.contractM;

  if (projected > input.hardCapM) {
    out.push(
      hard(
        "OVER_HARD_CAP",
        `payroll would be $${projected.toFixed(2)}M vs $${input.hardCapM}M hard cap — clear space via trade first`,
      ),
    );
  }
  if (input.seasonsServed < 1) {
    out.push(
      soft("SEASON_NOT_SERVED", "has not completed a full G-League season since being assigned"),
    );
  }
  return out;
}

export type AffiliateRosterSlot = {
  pid: number;
  name: string;
  ovr: number;
  age: number;
  assigned: boolean;
};

export type ForcedCallUp = AffiliateRosterSlot & { reasons: string[] };

/**
 * Rule #4: an assigned player who no longer meets the rule #2 criteria must be
 * called up. Only OVR and age can change while a player sits in the G-League —
 * his main-league contract is frozen in the ledger snapshot — so those are the
 * two triggers. Original G-Leaguers were never bound by the criteria.
 */
export function detectForcedCallUps(roster: AffiliateRosterSlot[]): ForcedCallUp[] {
  const out: ForcedCallUp[] = [];
  for (const p of roster) {
    if (!p.assigned) continue;
    const reasons: string[] = [];
    if (p.ovr > MAX_ASSIGN_OVR) reasons.push("OVR_TOO_HIGH");
    if (p.age > MAX_ASSIGN_AGE) reasons.push("TOO_OLD");
    if (reasons.length) out.push({ ...p, reasons });
  }
  return out;
}
