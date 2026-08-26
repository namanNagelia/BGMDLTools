import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { freeAgents, offers, seasons, teams } from "../db/schema.js";
import { LeagueFetchError } from "./league.service.js";

export const SOFT_CAP = 100; // $M
export const HARD_CAP = 130; // $M
export const MLE1_FLOOR = 92.5;
export const MLE1_CEIL = 107.5;
export const MLE1_AMT = 7.5;
export const MLE1_YRS = 4;
export const MLE2_AMT = 4.5;
export const MLE2_YRS = 3;
export const MIN_SALARY = 1; // $M/yr
export const MAX_SALARY = 33;

export type MLETier = 1 | 2;

/** The two MLE tiers. `floor`/`ceil` are the cap band a team must sit in to be
 * *naturally* eligible — teams may declare either tier anyway (trades move the
 * number), which surfaces as a warning rather than a block. */
export const MLE_TIERS: Record<MLETier, {
  tier: MLETier;
  maxAmount: number;
  maxYears: number;
  floor: number;
  ceil: number | null;
}> = {
  1: { tier: 1, maxAmount: MLE1_AMT, maxYears: MLE1_YRS, floor: MLE1_FLOOR, ceil: MLE1_CEIL },
  2: { tier: 2, maxAmount: MLE2_AMT, maxYears: MLE2_YRS, floor: MLE1_CEIL, ceil: null },
};

export function normalizeMLETier(tier: unknown): MLETier | null {
  return tier === 1 || tier === 2 ? tier : null;
}

/** [ovrThreshold, minAmountM] — highest threshold matched wins. */
const OVR_MIN_TABLE: Array<[number, number]> = [
  [70, 33],
  [68, 28],
  [66, 22],
  [63, 15],
  [61, 10],
  [59, 5],
  [57, 3],
];

export function minAmountForOvr(ovr: number): number {
  for (const [threshold, min] of OVR_MIN_TABLE) {
    if (ovr >= threshold) return min;
  }
  return MIN_SALARY;
}

export function computeHardViolations(
  fa: typeof freeAgents.$inferSelect,
  amount: number,
  years: number,
): string[] {
  const violations: string[] = [];

  if (amount > MAX_SALARY) {
    violations.push(`Exceeds league max contract ($${MAX_SALARY}M/yr)`);
  }

  const minByOvr = minAmountForOvr(fa.overall);
  if (amount < minByOvr) {
    if (fa.overall >= 70) {
      violations.push(`${fa.overall} OVR requires the max contract ($${minByOvr}M/yr)`);
    } else {
      violations.push(`${fa.overall} OVR requires at least $${minByOvr}M/yr`);
    }
  }

  if (fa.faStatus === "RFA") {
    const minYrs = amount >= 10 ? 3 : 2;
    if (years < minYrs || years > 5) {
      violations.push(
        `RFA at $${amount}M/yr must be ${minYrs}–5 years (got ${years})`,
      );
    }
  } else if (years < 1 || years > 5) {
    violations.push(`UFA contracts must be 1–5 years (got ${years})`);
  }

  return violations;
}

export class OfferValidationError extends Error {
  constructor(public violations: string[]) {
    super("offer_violates_contract_rules");
    this.name = "OfferValidationError";
  }
}

export type Offer = typeof offers.$inferSelect;

export interface OfferWithFlags extends Offer {
  invalidReasons: string[];
  playerName?: string;
  playerPreviousTeam?: string;
}

interface ValidateInput {
  fa: typeof freeAgents.$inferSelect;
  teamAbbrev: string;
  amount: number;
  years: number;
  payroll: number; // current roster salary
  // Sum of own non-renounced FA holds, EXCLUDING SIGNED FAs (a signed
  // player's contract is already in `payroll` via the BBGM re-ingest, so
  // their hold is auto-released — counting both would double-count).
  activeCapHolds: number;
  otherOfferTotal: number; // team's other pending offer amounts (not this FA)
  // Portion of otherOfferTotal that uses an exception (min-salary or MLE) and
  // shouldn't count against the soft cap for OTHER offers — mimics the fact
  // that min-salary offers are processed last within a wave. Hard cap still
  // counts everything.
  otherExemptOfferTotal?: number;
  // sum of own non-renounced cap holds that would be replaced by this offer
  // or any pending offer from this team (hold vanishes once the FA signs)
  replacedCapHolds: number;
  isMLE?: boolean;
  mleTier?: MLETier | null; // declared tier; null falls back to the eligible one
}

/** The tier a team's cap position naturally qualifies for, or null if the team
 * is under the MLE floor (it has real cap space instead). */
export function eligibleMLETier(totalCommitted: number): MLETier | null {
  if (totalCommitted < MLE1_FLOOR) return null;
  if (totalCommitted <= MLE1_CEIL) return 1;
  return 2;
}

/** The tier an offer should be evaluated against: what the GM declared, else
 * whatever the team's cap qualifies for, else T1. */
export function resolveMLETier(
  declared: MLETier | null | undefined,
  totalCommitted: number,
): MLETier {
  return normalizeMLETier(declared) ?? eligibleMLETier(totalCommitted) ?? 1;
}

/** Soft MLE warnings. Nothing here blocks a submission — a team can declare
 * either tier and go over its limits; the mod decides at resolution time and a
 * trade can make an ineligible team eligible before signings are processed. */
export function computeMLEWarnings(input: {
  tier: MLETier;
  amount: number;
  years: number;
  totalCommitted: number; // team salary + active cap holds (excludes FA offers)
}): string[] {
  const spec = MLE_TIERS[input.tier];
  const warnings: string[] = [];

  if (input.amount > spec.maxAmount + 1e-9) {
    warnings.push(
      `MLE T${input.tier} is capped at $${spec.maxAmount.toFixed(1)}M/yr (offered $${input.amount.toFixed(2)}M/yr)`,
    );
  }
  if (input.years > spec.maxYears) {
    warnings.push(
      `MLE T${input.tier} is capped at ${spec.maxYears} years (offered ${input.years})`,
    );
  }

  const eligible = eligibleMLETier(input.totalCommitted);
  if (eligible !== input.tier) {
    const at = `$${input.totalCommitted.toFixed(1)}M salary + holds`;
    warnings.push(
      eligible === null
        ? `Team is under the $${MLE1_FLOOR.toFixed(1)}M MLE floor (${at}) — a trade would have to change that`
        : `Team's cap (${at}) fits MLE T${eligible}, not T${input.tier} — a trade would have to change that`,
    );
  }

  return warnings;
}

/** Sum of own non-renounced FA cap holds that would be replaced by team offers.
 * SIGNED FAs are excluded — their hold was already auto-released when they signed. */
export function sumReplacedCapHolds(
  ownFAs: (typeof freeAgents.$inferSelect)[],
  offeredFaIds: Set<number>,
): number {
  return ownFAs
    .filter((f) => !f.renounced && f.faStatus !== "SIGNED" && offeredFaIds.has(f.id))
    .reduce((s, f) => s + Number(f.capHold), 0);
}

export function computeInvalidReasons(input: ValidateInput): string[] {
  const reasons: string[] = [];
  const {
    fa,
    teamAbbrev,
    amount,
    years,
    payroll,
    activeCapHolds,
    otherOfferTotal,
    otherExemptOfferTotal = 0,
    replacedCapHolds,
    isMLE = false,
    mleTier,
  } = input;

  if (amount <= 0 || years <= 0) {
    reasons.push("Amount and years must be positive");
    return reasons;
  }

  const totalCommitted = payroll + activeCapHolds;
  const isOwn = fa.previousTeam === teamAbbrev;
  const hasBird = isOwn && !fa.renounced;

  const projectedForHardCap =
    totalCommitted + otherOfferTotal + amount - replacedCapHolds;
  if (projectedForHardCap > HARD_CAP) {
    const over = projectedForHardCap - HARD_CAP;
    reasons.push(
      `Over hard cap by $${over.toFixed(1)}M — must clear cap via trade before signing`,
    );
  }

  if (isMLE) {
    reasons.push(
      ...computeMLEWarnings({
        tier: resolveMLETier(mleTier, totalCommitted),
        amount,
        years,
        totalCommitted,
      }),
    );
  }

  // MLE is its own cap-clearing mechanism — its limits are reported above, so
  // skip the soft-cap warning when the offer is declared MLE.
  if (!hasBird && !isMLE) {
    const isMin = amount <= MIN_SALARY;
    const inMLE1Tier = totalCommitted >= MLE1_FLOOR && totalCommitted <= MLE1_CEIL;
    const inMLE2Tier = totalCommitted > MLE1_CEIL;
    const fitsMLE1 = inMLE1Tier && amount <= MLE1_AMT && years <= MLE1_YRS;
    const fitsMLE2 = inMLE2Tier && amount <= MLE2_AMT && years <= MLE2_YRS;
    // Min-salary and MLE offers use exceptions and don't count against the
    // soft cap. Subtract them from the projection so a legit under-soft offer
    // isn't warned just because a sibling min/MLE offer is also pending.
    const projectedForSoftCap =
      totalCommitted + (otherOfferTotal - otherExemptOfferTotal) + amount - replacedCapHolds;
    const overSoft = projectedForSoftCap > SOFT_CAP;

    if (overSoft && !isMin && !fitsMLE1 && !fitsMLE2) {
      const overSoftBy = projectedForSoftCap - SOFT_CAP;
      const why =
        fa.renounced && isOwn ? "renounced rights" : "no Bird rights";
      reasons.push(
        `Over soft cap by $${overSoftBy.toFixed(1)}M with ${why} — must clear cap, renounce holds, or use MLE/min`,
      );
    }
  }

  return reasons;
}

export interface MLETierInfo {
  tier: MLETier;
  maxAmount: number;
  maxYears: number;
  eligible: boolean; // does the team's cap position naturally qualify?
}

export interface MLEStatus {
  /** Tier the team's cap position qualifies for; null = under the MLE floor. */
  eligibleTier: MLETier | null;
  /** Both tiers are always offerable — `eligible` is advisory. */
  tiers: MLETierInfo[];
  /** The MLE is one slot: either spent or not. Never a partial dollar amount. */
  used: boolean;
  usedOn: {
    offerId: number;
    freeAgentId: number;
    playerName: string | null;
    tier: MLETier | null;
    status: "PENDING" | "ACCEPTED";
  } | null;
}

export function mleTiersFor(totalCommitted: number): MLETierInfo[] {
  const eligible = eligibleMLETier(totalCommitted);
  return ([1, 2] as MLETier[]).map((t) => ({
    tier: t,
    maxAmount: MLE_TIERS[t].maxAmount,
    maxYears: MLE_TIERS[t].maxYears,
    eligible: eligible === t,
  }));
}

/** Load the cap context (current season + team row + that team's own FAs). */
export async function loadTeamCapContext(teamAbbrev: string): Promise<{
  season: typeof seasons.$inferSelect;
  team: typeof teams.$inferSelect | null;
  ownFAs: (typeof freeAgents.$inferSelect)[];
} | null> {
  const [current] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.isCurrentSzn, true))
    .limit(1);
  if (!current) return null;

  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.seasonId, current.id), eq(teams.abbrev, teamAbbrev)))
    .limit(1);

  const ownFAs = await db
    .select()
    .from(freeAgents)
    .where(
      and(
        eq(freeAgents.seasonId, current.id),
        eq(freeAgents.previousTeam, teamAbbrev),
      ),
    );

  return { season: current, team: team ?? null, ownFAs };
}

async function pendingOffersForTeam(teamAbbrev: string, seasonId: number) {
  return db
    .select()
    .from(offers)
    .where(
      and(
        eq(offers.teamAbbrev, teamAbbrev),
        eq(offers.offerSeason, seasonId),
        eq(offers.status, "PENDING"),
      ),
    );
}

/** The live MLE offer holding a team's single exception, if any. The MLE is not
 * divisible — one offer owns it until it's withdrawn or rejected. */
export function findCommittedMLE(
  teamOffers: Offer[],
  exclude: { offerId?: number; freeAgentId?: number } = {},
): Offer | null {
  const live = teamOffers
    .filter((o) => o.isMle)
    .filter((o) => o.status === "PENDING" || o.status === "ACCEPTED")
    .filter((o) => exclude.offerId == null || o.id !== exclude.offerId)
    .filter((o) => exclude.freeAgentId == null || o.freeAgentId !== exclude.freeAgentId);
  // An accepted MLE outranks a pending one — it's actually spent.
  return live.find((o) => o.status === "ACCEPTED") ?? live[0] ?? null;
}

const sameCode = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Hard block: a team gets one MLE per season, used or not used. `codeWord`
 * only controls how much detail the message gives away — the block itself is
 * unconditional. */
export function computeMLEHardViolations(
  committed: Offer | null,
  opts: { playerName?: string | null; codeWord?: string } = {},
): string[] {
  if (!committed) return [];
  const who =
    sameCode(committed.codeWord, opts.codeWord) && opts.playerName
      ? ` (currently on ${opts.playerName})`
      : "";
  return [
    committed.status === "ACCEPTED"
      ? `Team already used its MLE this season${who}`
      : `Team already has an MLE offer out${who} — one MLE per team, withdraw that one first`,
  ];
}

async function allTeamOffers(teamAbbrev: string, seasonId: number) {
  return db
    .select()
    .from(offers)
    .where(
      and(eq(offers.teamAbbrev, teamAbbrev), eq(offers.offerSeason, seasonId)),
    );
}

export interface OfferPreview {
  hardViolations: string[];
  warnings: string[]; // formerly "invalidReasons" — cap/Bird/MLE flags
  mle: MLEStatus;
  /** False when no matching private key was supplied: the team's other pending
   * offers were left out of the projection because they aren't this caller's
   * to see. */
  pendingVisible: boolean;
}

/** Does this private key own at least one offer filed under this team? That's
 * the only proof of team identity we have, and it's what unlocks the team's
 * pending-offer figures. */
export function codeOwnsTeam(teamOffers: Offer[], codeWord?: string): boolean {
  const code = (codeWord ?? "").trim();
  if (!code) return false;
  return teamOffers.some((o) => sameCode(o.codeWord, code));
}

/** Dry-run validate an offer (used by the GM form for live warnings). */
export async function previewOffer(input: {
  freeAgentId: number;
  teamAbbrev: string;
  amount: number;
  years: number;
  isMLE?: boolean;
  mleTier?: MLETier | null;
  codeWord?: string;
}): Promise<OfferPreview> {
  const [fa] = await db
    .select()
    .from(freeAgents)
    .where(eq(freeAgents.id, input.freeAgentId))
    .limit(1);
  if (!fa) throw new LeagueFetchError("Free agent not found", 404);

  const hardViolations = computeHardViolations(fa, input.amount, input.years);
  const isMLE = input.isMLE === true;

  const ctx = await loadTeamCapContext(input.teamAbbrev);
  if (!ctx) {
    return {
      hardViolations,
      warnings: [],
      mle: {
        eligibleTier: null,
        tiers: mleTiersFor(0),
        used: false,
        usedOn: null,
      },
      pendingVisible: false,
    };
  }
  const payroll = ctx.team ? Number(ctx.team.totalSalary) : 0;
  const activeCapHolds = ctx.ownFAs
    .filter((f) => !f.renounced && f.faStatus !== "SIGNED")
    .reduce((s, f) => s + Number(f.capHold), 0);
  const totalCommitted = payroll + activeCapHolds;

  const teamOffers = await allTeamOffers(input.teamAbbrev, fa.seasonId);
  const pendingVisible = codeOwnsTeam(teamOffers, input.codeWord);

  // Without a matching key we can't tell this caller apart from a rival
  // fishing for the team's book, so the projection is computed as if the team
  // had no other offers out.
  const pending = pendingVisible
    ? teamOffers.filter((o) => o.status === "PENDING")
    : [];
  const otherPending = pending.filter((o) => o.freeAgentId !== fa.id);
  const otherOfferTotal = otherPending.reduce((s, o) => s + Number(o.offerAmount), 0);
  const otherExemptOfferTotal = otherPending
    .filter((o) => Number(o.offerAmount) <= MIN_SALARY || o.isMle)
    .reduce((s, o) => s + Number(o.offerAmount), 0);
  const offeredFaIds = new Set<number>([fa.id, ...pending.map((o) => o.freeAgentId)]);
  const replacedCapHolds = sumReplacedCapHolds(ctx.ownFAs, offeredFaIds);

  // Offers on THIS FA are excluded — re-previewing an existing MLE offer
  // shouldn't have it block itself.
  const committedMLE = findCommittedMLE(teamOffers, { freeAgentId: fa.id });

  const warnings = computeInvalidReasons({
    fa,
    teamAbbrev: input.teamAbbrev,
    amount: input.amount,
    years: input.years,
    payroll,
    activeCapHolds,
    otherOfferTotal,
    otherExemptOfferTotal,
    replacedCapHolds,
    isMLE,
    mleTier: input.mleTier,
  });

  // An accepted MLE is a completed signing and already public. A *pending* one
  // is exactly the kind of thing a rival shouldn't be able to read off the
  // board, so without a matching key it isn't reported at all — the hard block
  // below still fires on submit either way.
  const reportMLE =
    committedMLE && (committedMLE.status === "ACCEPTED" || pendingVisible)
      ? committedMLE
      : null;
  let usedOnName: string | null = null;
  if (reportMLE) {
    const [mleFa] = await db
      .select({ name: freeAgents.name })
      .from(freeAgents)
      .where(eq(freeAgents.id, reportMLE.freeAgentId))
      .limit(1);
    usedOnName = mleFa?.name ?? null;
  }

  const mle: MLEStatus = {
    eligibleTier: eligibleMLETier(totalCommitted),
    tiers: mleTiersFor(totalCommitted),
    used: reportMLE !== null,
    usedOn: reportMLE
      ? {
          offerId: reportMLE.id,
          freeAgentId: reportMLE.freeAgentId,
          playerName: usedOnName,
          tier: normalizeMLETier(reportMLE.mleTier),
          status: reportMLE.status as "PENDING" | "ACCEPTED",
        }
      : null,
  };

  // Same reasoning: previewing off `reportMLE` rather than `committedMLE`
  // keeps a rival from confirming a pending MLE by watching for the block.
  // createOffer checks the real thing and rejects on submit regardless.
  const mleHard = isMLE
    ? computeMLEHardViolations(reportMLE, {
        playerName: usedOnName,
        codeWord: input.codeWord,
      })
    : [];

  return {
    hardViolations: [...hardViolations, ...mleHard],
    warnings,
    mle,
    pendingVisible,
  };
}

export async function createOffer(input: {
  freeAgentId: number;
  teamAbbrev: string;
  amount: number;
  years: number;
  gm: string;
  codeWord: string;
  isMLE?: boolean;
  mleTier?: MLETier | null;
  isDoubleDip?: boolean;
}): Promise<{ offer: Offer; invalidReasons: string[] }> {
  const [fa] = await db
    .select()
    .from(freeAgents)
    .where(eq(freeAgents.id, input.freeAgentId))
    .limit(1);
  if (!fa) throw new LeagueFetchError("Free agent not found", 404);

  const isMLE = input.isMLE === true;
  const hardViolations = computeHardViolations(fa, input.amount, input.years);

  // The one-MLE-per-team check needs team context, so run it before insert.
  const ctxPre = await loadTeamCapContext(input.teamAbbrev);
  const payrollPre = ctxPre?.team ? Number(ctxPre.team.totalSalary) : 0;
  const holdsPre = (ctxPre?.ownFAs ?? [])
    .filter((f) => !f.renounced && f.faStatus !== "SIGNED")
    .reduce((s, f) => s + Number(f.capHold), 0);
  const mleTier = isMLE
    ? resolveMLETier(input.mleTier, payrollPre + holdsPre)
    : null;

  if (isMLE) {
    const teamOffers = await allTeamOffers(input.teamAbbrev, fa.seasonId);
    const committedMLE = findCommittedMLE(teamOffers, { freeAgentId: fa.id });
    const mleHard = computeMLEHardViolations(committedMLE, {
      playerName: committedMLE ? await faNameById(committedMLE.freeAgentId) : null,
      codeWord: input.codeWord,
    });
    if (mleHard.length > 0 || hardViolations.length > 0) {
      throw new OfferValidationError([...hardViolations, ...mleHard]);
    }
  } else if (hardViolations.length > 0) {
    throw new OfferValidationError(hardViolations);
  }

  const [row] = await db
    .insert(offers)
    .values({
      freeAgentId: input.freeAgentId,
      teamAbbrev: input.teamAbbrev,
      offerAmount: input.amount.toFixed(2),
      offerLength: input.years,
      offerSeason: fa.seasonId,
      offerGm: input.gm,
      codeWord: input.codeWord.trim(),
      isMle: isMLE,
      mleTier,
      isDoubleDip: input.isDoubleDip === true,
    })
    .returning();

  const ctx = ctxPre;
  if (!ctx) return { offer: row, invalidReasons: [] };
  const teamOffers = await allTeamOffers(input.teamAbbrev, fa.seasonId);
  const pending = teamOffers.filter((o) => o.status === "PENDING");
  const otherPending = pending.filter(
    (o) => o.id !== row.id && o.freeAgentId !== fa.id,
  );
  const otherOfferTotal = otherPending.reduce((s, o) => s + Number(o.offerAmount), 0);
  const otherExemptOfferTotal = otherPending
    .filter((o) => Number(o.offerAmount) <= MIN_SALARY || o.isMle)
    .reduce((s, o) => s + Number(o.offerAmount), 0);
  const offeredFaIds = new Set<number>([fa.id, ...pending.map((o) => o.freeAgentId)]);
  const replacedCapHolds = sumReplacedCapHolds(ctx.ownFAs, offeredFaIds);

  const invalidReasons = computeInvalidReasons({
    fa,
    teamAbbrev: input.teamAbbrev,
    amount: input.amount,
    years: input.years,
    payroll: payrollPre,
    activeCapHolds: holdsPre,
    otherOfferTotal,
    otherExemptOfferTotal,
    replacedCapHolds,
    isMLE,
    mleTier,
  });
  return { offer: row, invalidReasons };
}

async function faNameById(faId: number): Promise<string | null> {
  const [row] = await db
    .select({ name: freeAgents.name })
    .from(freeAgents)
    .where(eq(freeAgents.id, faId))
    .limit(1);
  return row?.name ?? null;
}

/** Attach live invalidReasons to each offer by re-evaluating cap + hard rules. */
async function annotate(rawOffers: Offer[]): Promise<OfferWithFlags[]> {
  if (rawOffers.length === 0) return [];

  const faIds = Array.from(new Set(rawOffers.map((o) => o.freeAgentId)));
  const fas = faIds.length
    ? await db
        .select()
        .from(freeAgents)
        .where(eq(freeAgents.seasonId, rawOffers[0].offerSeason))
    : [];
  const faById = new Map(fas.map((f) => [f.id, f]));

  const teamAbbrevs = Array.from(new Set(rawOffers.map((o) => o.teamAbbrev)));
  const contexts = new Map<
    string,
    Awaited<ReturnType<typeof loadTeamCapContext>>
  >();
  for (const abv of teamAbbrevs) contexts.set(abv, await loadTeamCapContext(abv));

  const pendingByTeam = new Map<string, Offer[]>();
  for (const abv of teamAbbrevs) {
    const ctx = contexts.get(abv);
    pendingByTeam.set(
      abv,
      ctx ? await pendingOffersForTeam(abv, ctx.season.id) : [],
    );
  }

  const out: OfferWithFlags[] = [];
  for (const o of rawOffers) {
    const fa = faById.get(o.freeAgentId);
    const ctx = contexts.get(o.teamAbbrev);
    let invalidReasons: string[] = [];
    if (fa && ctx) {
      const payroll = ctx.team ? Number(ctx.team.totalSalary) : 0;
      const activeHolds = ctx.ownFAs
        .filter((f) => !f.renounced && f.faStatus !== "SIGNED")
        .reduce((s, f) => s + Number(f.capHold), 0);
      const teamPending = pendingByTeam.get(o.teamAbbrev) ?? [];
      const otherPending = teamPending.filter(
        (x) => x.id !== o.id && x.freeAgentId !== o.freeAgentId,
      );
      const otherOfferTotal = otherPending.reduce((s, x) => s + Number(x.offerAmount), 0);
      const otherExemptOfferTotal = otherPending
        .filter((x) => Number(x.offerAmount) <= MIN_SALARY || x.isMle)
        .reduce((s, x) => s + Number(x.offerAmount), 0);
      const offeredFaIds = new Set<number>([
        o.freeAgentId,
        ...teamPending.map((x) => x.freeAgentId),
      ]);
      const replacedCapHolds = sumReplacedCapHolds(ctx.ownFAs, offeredFaIds);
      // Flag any rival claim on the team's single MLE. Legacy rows can double
      // up here — createOffer blocks it now, but old data may not comply.
      const teamAllOffers = await allTeamOffers(o.teamAbbrev, o.offerSeason);
      const rivalMLE = findCommittedMLE(teamAllOffers, { offerId: o.id });
      const mleHard =
        o.isMle && rivalMLE
          ? computeMLEHardViolations(rivalMLE, {
              playerName: faById.get(rivalMLE.freeAgentId)?.name ?? null,
              codeWord: rivalMLE.codeWord ?? undefined,
            })
          : [];
      invalidReasons = [
        ...computeHardViolations(fa, Number(o.offerAmount), o.offerLength),
        ...mleHard,
        ...computeInvalidReasons({
          fa,
          teamAbbrev: o.teamAbbrev,
          amount: Number(o.offerAmount),
          years: o.offerLength,
          payroll,
          activeCapHolds: activeHolds,
          otherOfferTotal,
          otherExemptOfferTotal,
          replacedCapHolds,
          isMLE: o.isMle,
          mleTier: normalizeMLETier(o.mleTier),
        }),
      ];
    }
    out.push({
      ...o,
      invalidReasons,
      playerName: fa?.name,
      playerPreviousTeam: fa?.previousTeam,
    });
  }
  return out;
}

export async function listAllOffersForCurrentSeason(): Promise<OfferWithFlags[]> {
  const [current] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.isCurrentSzn, true))
    .limit(1);
  if (!current) return [];
  const rows = await db
    .select()
    .from(offers)
    .where(eq(offers.offerSeason, current.id))
    .orderBy(desc(offers.createdAt));
  return annotate(rows);
}

/** Find all PENDING offers for the current season whose codeWord matches (case-insensitive). */
export async function listOffersByCode(code: string): Promise<OfferWithFlags[]> {
  const trimmed = code.trim();
  if (!trimmed) return [];
  const [current] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.isCurrentSzn, true))
    .limit(1);
  if (!current) return [];
  const rows = await db
    .select()
    .from(offers)
    .where(
      and(
        eq(offers.offerSeason, current.id),
        eq(offers.status, "PENDING"),
        sql`LOWER(${offers.codeWord}) = LOWER(${trimmed})`,
      ),
    )
    .orderBy(desc(offers.createdAt));
  return annotate(rows);
}

export interface PendingOfferSummary {
  id: number;
  freeAgentId: number;
  amount: number;
  years: number;
  isMle: boolean;
  mleTier: MLETier | null;
  isDoubleDip: boolean;
}

/**
 * Pending-offer book for every team this private key has filed an offer under.
 * How many offers a team has out and what they add up to is private — a rival
 * shouldn't be able to read it off the board — so it hangs off the key rather
 * than off the public season payload.
 */
export async function pendingSummaryForCode(
  code: string,
): Promise<Record<string, PendingOfferSummary[]>> {
  const trimmed = code.trim();
  if (!trimmed) return {};
  const [current] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.isCurrentSzn, true))
    .limit(1);
  if (!current) return {};

  // Any offer under this key claims the team — including ones already accepted
  // or withdrawn, so a GM doesn't lose sight of their book mid-wave.
  const owned = await db
    .select({ teamAbbrev: offers.teamAbbrev })
    .from(offers)
    .where(
      and(
        eq(offers.offerSeason, current.id),
        sql`LOWER(${offers.codeWord}) = LOWER(${trimmed})`,
      ),
    );
  const myTeams = new Set(owned.map((o) => o.teamAbbrev));
  if (myTeams.size === 0) return {};

  const pending = await db
    .select()
    .from(offers)
    .where(
      and(eq(offers.offerSeason, current.id), eq(offers.status, "PENDING")),
    );

  // Seed every claimed team, so a GM whose offers have all been resolved still
  // reads as unlocked (with an empty book) rather than as a stranger.
  const out: Record<string, PendingOfferSummary[]> = {};
  for (const abv of myTeams) out[abv] = [];
  for (const o of pending) {
    if (!myTeams.has(o.teamAbbrev)) continue;
    (out[o.teamAbbrev] ||= []).push({
      id: o.id,
      freeAgentId: o.freeAgentId,
      amount: Number(o.offerAmount),
      years: o.offerLength,
      isMle: o.isMle,
      mleTier: normalizeMLETier(o.mleTier),
      isDoubleDip: o.isDoubleDip,
    });
  }
  return out;
}

async function loadOfferIfCodeMatches(
  id: number,
  code: string,
): Promise<Offer | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const [row] = await db.select().from(offers).where(eq(offers.id, id)).limit(1);
  if (!row) return null;
  if (!row.codeWord) return null;
  if (row.codeWord.toLowerCase() !== trimmed.toLowerCase()) return null;
  return row;
}

/** GM updates their own offer (amount and/or years). Code must match the original offer. */
export async function updateOfferByCode(
  id: number,
  code: string,
  patch: {
    amount?: number;
    years?: number;
    isMLE?: boolean;
    mleTier?: MLETier | null;
    isDoubleDip?: boolean;
  },
): Promise<{ offer: Offer; invalidReasons: string[] } | null> {
  const original = await loadOfferIfCodeMatches(id, code);
  if (!original) return null;
  if (original.status !== "PENDING") return null;

  const [fa] = await db
    .select()
    .from(freeAgents)
    .where(eq(freeAgents.id, original.freeAgentId))
    .limit(1);
  if (!fa) return null;

  const newAmount = patch.amount ?? Number(original.offerAmount);
  const newYears = patch.years ?? original.offerLength;
  const newIsMLE = patch.isMLE ?? original.isMle;
  const newIsDoubleDip = patch.isDoubleDip ?? original.isDoubleDip;

  const hardViolations = computeHardViolations(fa, newAmount, newYears);

  const ctx = await loadTeamCapContext(original.teamAbbrev);
  const payroll = ctx?.team ? Number(ctx.team.totalSalary) : 0;
  const activeCapHolds = (ctx?.ownFAs ?? [])
    .filter((f) => !f.renounced && f.faStatus !== "SIGNED")
    .reduce((s, f) => s + Number(f.capHold), 0);
  const newTier = newIsMLE
    ? resolveMLETier(
        patch.mleTier ?? normalizeMLETier(original.mleTier),
        payroll + activeCapHolds,
      )
    : null;

  // One MLE per team — check against everything but this offer.
  if (newIsMLE) {
    const teamOffers = await allTeamOffers(original.teamAbbrev, fa.seasonId);
    const committedMLE = findCommittedMLE(teamOffers, { offerId: id });
    const mleHard = computeMLEHardViolations(committedMLE, {
      playerName: committedMLE ? await faNameById(committedMLE.freeAgentId) : null,
      codeWord: code,
    });
    if (mleHard.length > 0 || hardViolations.length > 0) {
      throw new OfferValidationError([...hardViolations, ...mleHard]);
    }
  } else if (hardViolations.length > 0) {
    throw new OfferValidationError(hardViolations);
  }

  const [updated] = await db
    .update(offers)
    .set({
      offerAmount: newAmount.toFixed(2),
      offerLength: newYears,
      isMle: newIsMLE,
      mleTier: newTier,
      isDoubleDip: newIsDoubleDip,
    })
    .where(eq(offers.id, id))
    .returning();

  let invalidReasons: string[] = [];
  if (ctx) {
    const teamOffers = await allTeamOffers(original.teamAbbrev, fa.seasonId);
    const pending = teamOffers.filter((o) => o.status === "PENDING");
    const otherPending = pending.filter((o) => o.id !== id && o.freeAgentId !== fa.id);
    const otherOfferTotal = otherPending.reduce((s, o) => s + Number(o.offerAmount), 0);
    const otherExemptOfferTotal = otherPending
      .filter((o) => Number(o.offerAmount) <= MIN_SALARY || o.isMle)
      .reduce((s, o) => s + Number(o.offerAmount), 0);
    const offeredFaIds = new Set<number>([fa.id, ...pending.map((o) => o.freeAgentId)]);
    const replacedCapHolds = sumReplacedCapHolds(ctx.ownFAs, offeredFaIds);
    invalidReasons = computeInvalidReasons({
      fa,
      teamAbbrev: original.teamAbbrev,
      amount: newAmount,
      years: newYears,
      payroll,
      activeCapHolds,
      otherOfferTotal,
      otherExemptOfferTotal,
      replacedCapHolds,
      isMLE: newIsMLE,
      mleTier: newTier,
    });
  }
  return { offer: updated, invalidReasons };
}

/** GM withdraws their own offer. Code must match. */
export async function withdrawOfferByCode(
  id: number,
  code: string,
): Promise<boolean> {
  const original = await loadOfferIfCodeMatches(id, code);
  if (!original) return false;
  if (original.status !== "PENDING") return false;
  await db
    .update(offers)
    .set({ status: "WITHDRAWN" })
    .where(eq(offers.id, id));
  return true;
}

export async function modWithdrawOffer(id: number): Promise<boolean> {
  const [row] = await db.select().from(offers).where(eq(offers.id, id)).limit(1);
  if (!row) return false;
  await db.update(offers).set({ status: "WITHDRAWN" }).where(eq(offers.id, id));
  return true;
}

/** Mod accepts an offer → sign the FA, auto-reject all other pending offers on them. */
export async function modAcceptOffer(id: number): Promise<{
  accepted: Offer;
  faId: number;
  rejectedIds: number[];
} | null> {
  const [row] = await db.select().from(offers).where(eq(offers.id, id)).limit(1);
  if (!row) return null;

  return db.transaction(async (tx) => {
    await tx.update(offers).set({ status: "ACCEPTED" }).where(eq(offers.id, id));
    await tx
      .update(freeAgents)
      .set({ faStatus: "SIGNED", winningOfferId: id })
      .where(eq(freeAgents.id, row.freeAgentId));
    const others = await tx
      .select({ id: offers.id })
      .from(offers)
      .where(
        and(
          eq(offers.freeAgentId, row.freeAgentId),
          eq(offers.status, "PENDING"),
        ),
      );
    const otherIds = others.map((o) => o.id);
    if (otherIds.length) {
      for (const oid of otherIds) {
        await tx.update(offers).set({ status: "REJECTED" }).where(eq(offers.id, oid));
      }
    }
    const [accepted] = await tx
      .select()
      .from(offers)
      .where(eq(offers.id, id))
      .limit(1);
    return { accepted, faId: row.freeAgentId, rejectedIds: otherIds };
  });
}
