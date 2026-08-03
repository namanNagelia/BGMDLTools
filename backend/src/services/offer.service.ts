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
  activeCapHolds: number; // sum of own non-renounced FA holds
  otherOfferTotal: number; // team's other pending offer amounts (not this FA)
  // sum of own non-renounced cap holds that would be replaced by this offer
  // or any pending offer from this team (hold vanishes once the FA signs)
  replacedCapHolds: number;
}

/** Sum of own non-renounced FA cap holds that would be replaced by team offers. */
export function sumReplacedCapHolds(
  ownFAs: (typeof freeAgents.$inferSelect)[],
  offeredFaIds: Set<number>,
): number {
  return ownFAs
    .filter((f) => !f.renounced && offeredFaIds.has(f.id))
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
    replacedCapHolds,
  } = input;

  if (amount <= 0 || years <= 0) {
    reasons.push("Amount and years must be positive");
    return reasons;
  }

  const totalCommitted = payroll + activeCapHolds;
  const isOwn = fa.previousTeam === teamAbbrev;
  const hasBird = isOwn && !fa.renounced;

  const projectedTotal =
    totalCommitted + otherOfferTotal + amount - replacedCapHolds;
  if (projectedTotal > HARD_CAP) {
    const over = projectedTotal - HARD_CAP;
    reasons.push(
      `Over hard cap by $${over.toFixed(1)}M — must clear cap via trade before signing`,
    );
  }

  if (!hasBird) {
    const isMin = amount <= MIN_SALARY;
    const inMLE1Tier = totalCommitted >= MLE1_FLOOR && totalCommitted <= MLE1_CEIL;
    const inMLE2Tier = totalCommitted > MLE1_CEIL;
    const fitsMLE1 = inMLE1Tier && amount <= MLE1_AMT && years <= MLE1_YRS;
    const fitsMLE2 = inMLE2Tier && amount <= MLE2_AMT && years <= MLE2_YRS;
    const overSoft = projectedTotal > SOFT_CAP;

    if (overSoft && !isMin && !fitsMLE1 && !fitsMLE2) {
      const overSoftBy = projectedTotal - SOFT_CAP;
      const why =
        fa.renounced && isOwn ? "renounced rights" : "no Bird rights";
      reasons.push(
        `Over soft cap by $${overSoftBy.toFixed(1)}M with ${why} — must clear cap, renounce holds, or use MLE/min`,
      );
    }
  }

  return reasons;
}

export interface MLEStatus {
  available: boolean;
  tier: 1 | 2 | null;
  maxAmount: number | null;
  maxYears: number | null;
}

export function mleStatusFor(totalCommitted: number): MLEStatus {
  if (totalCommitted < MLE1_FLOOR)
    return { available: false, tier: null, maxAmount: null, maxYears: null };
  if (totalCommitted <= MLE1_CEIL)
    return { available: true, tier: 1, maxAmount: MLE1_AMT, maxYears: MLE1_YRS };
  return { available: true, tier: 2, maxAmount: MLE2_AMT, maxYears: MLE2_YRS };
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

export interface OfferPreview {
  hardViolations: string[];
  warnings: string[]; // formerly "invalidReasons" — cap/Bird/MLE flags
}

/** Dry-run validate an offer (used by the GM form for live warnings). */
export async function previewOffer(input: {
  freeAgentId: number;
  teamAbbrev: string;
  amount: number;
  years: number;
}): Promise<OfferPreview> {
  const [fa] = await db
    .select()
    .from(freeAgents)
    .where(eq(freeAgents.id, input.freeAgentId))
    .limit(1);
  if (!fa) throw new LeagueFetchError("Free agent not found", 404);

  const hardViolations = computeHardViolations(fa, input.amount, input.years);

  const ctx = await loadTeamCapContext(input.teamAbbrev);
  if (!ctx) return { hardViolations, warnings: [] };
  const payroll = ctx.team ? Number(ctx.team.totalSalary) : 0;
  const activeCapHolds = ctx.ownFAs
    .filter((f) => !f.renounced)
    .reduce((s, f) => s + Number(f.capHold), 0);
  const pending = await pendingOffersForTeam(input.teamAbbrev, fa.seasonId);
  const otherOfferTotal = pending
    .filter((o) => o.freeAgentId !== fa.id)
    .reduce((s, o) => s + Number(o.offerAmount), 0);
  const offeredFaIds = new Set<number>([fa.id, ...pending.map((o) => o.freeAgentId)]);
  const replacedCapHolds = sumReplacedCapHolds(ctx.ownFAs, offeredFaIds);

  const warnings = computeInvalidReasons({
    fa,
    teamAbbrev: input.teamAbbrev,
    amount: input.amount,
    years: input.years,
    payroll,
    activeCapHolds,
    otherOfferTotal,
    replacedCapHolds,
  });
  return { hardViolations, warnings };
}

export async function createOffer(input: {
  freeAgentId: number;
  teamAbbrev: string;
  amount: number;
  years: number;
  gm: string;
  codeWord: string;
}): Promise<{ offer: Offer; invalidReasons: string[] }> {
  const [fa] = await db
    .select()
    .from(freeAgents)
    .where(eq(freeAgents.id, input.freeAgentId))
    .limit(1);
  if (!fa) throw new LeagueFetchError("Free agent not found", 404);

  const hardViolations = computeHardViolations(fa, input.amount, input.years);
  if (hardViolations.length > 0) throw new OfferValidationError(hardViolations);

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
    })
    .returning();

  const ctx = await loadTeamCapContext(input.teamAbbrev);
  if (!ctx) return { offer: row, invalidReasons: [] };
  const payroll = ctx.team ? Number(ctx.team.totalSalary) : 0;
  const activeCapHolds = ctx.ownFAs
    .filter((f) => !f.renounced)
    .reduce((s, f) => s + Number(f.capHold), 0);
  const pending = await pendingOffersForTeam(input.teamAbbrev, fa.seasonId);
  const otherOfferTotal = pending
    .filter((o) => o.id !== row.id && o.freeAgentId !== fa.id)
    .reduce((s, o) => s + Number(o.offerAmount), 0);
  const offeredFaIds = new Set<number>([fa.id, ...pending.map((o) => o.freeAgentId)]);
  const replacedCapHolds = sumReplacedCapHolds(ctx.ownFAs, offeredFaIds);

  const invalidReasons = computeInvalidReasons({
    fa,
    teamAbbrev: input.teamAbbrev,
    amount: input.amount,
    years: input.years,
    payroll,
    activeCapHolds,
    otherOfferTotal,
    replacedCapHolds,
  });
  return { offer: row, invalidReasons };
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
        .filter((f) => !f.renounced)
        .reduce((s, f) => s + Number(f.capHold), 0);
      const teamPending = pendingByTeam.get(o.teamAbbrev) ?? [];
      const otherOfferTotal = teamPending
        .filter((x) => x.id !== o.id && x.freeAgentId !== o.freeAgentId)
        .reduce((s, x) => s + Number(x.offerAmount), 0);
      const offeredFaIds = new Set<number>([
        o.freeAgentId,
        ...teamPending.map((x) => x.freeAgentId),
      ]);
      const replacedCapHolds = sumReplacedCapHolds(ctx.ownFAs, offeredFaIds);
      invalidReasons = [
        ...computeHardViolations(fa, Number(o.offerAmount), o.offerLength),
        ...computeInvalidReasons({
          fa,
          teamAbbrev: o.teamAbbrev,
          amount: Number(o.offerAmount),
          years: o.offerLength,
          payroll,
          activeCapHolds: activeHolds,
          otherOfferTotal,
          replacedCapHolds,
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
  patch: { amount?: number; years?: number },
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

  const hardViolations = computeHardViolations(fa, newAmount, newYears);
  if (hardViolations.length > 0) throw new OfferValidationError(hardViolations);

  const [updated] = await db
    .update(offers)
    .set({
      offerAmount: newAmount.toFixed(2),
      offerLength: newYears,
    })
    .where(eq(offers.id, id))
    .returning();

  const ctx = await loadTeamCapContext(original.teamAbbrev);
  let invalidReasons: string[] = [];
  if (ctx) {
    const payroll = ctx.team ? Number(ctx.team.totalSalary) : 0;
    const activeCapHolds = ctx.ownFAs
      .filter((f) => !f.renounced)
      .reduce((s, f) => s + Number(f.capHold), 0);
    const pending = await pendingOffersForTeam(original.teamAbbrev, fa.seasonId);
    const otherOfferTotal = pending
      .filter((o) => o.id !== id && o.freeAgentId !== fa.id)
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
      replacedCapHolds,
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
