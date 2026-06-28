import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  freeAgents,
  legacyRanks,
  marketRanks,
  offers,
  seasons,
  teams,
  winningRanks,
} from "../db/schema.js";
import {
  loyaltyYearsMultiplier,
  MONEY_BONUS_INCREMENT_M,
  MONEY_BONUS_STEP,
  MULTIPLIERS,
  RFA_MONEY_BONUS,
  TEN_M_PER_YEAR,
  TWENTY_M_TOTAL,
  type ValueKey,
} from "./fa-calc.constants.js";

export interface ValueLine {
  key: ValueKey;
  playerValue: number;
  baseMultiplier: number;
  effectiveMultiplier: number;
  won: boolean;
  points: number;
  note?: string;
}

export interface OfferScore {
  offerId: number;
  teamAbbrev: string;
  gm: string;
  amount: number;
  years: number;
  totalMoney: number;
  values: ValueLine[];
  total: number;
  eliminatedByMoneyRule?: { byTeamAbbrev: string; reason: string };
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
    teams: OfferScore[];
    eliminatedAbbrev?: string;
    eliminatedTotal?: number;
  }>;
  preFilter: Array<{ offerId: number; teamAbbrev: string; reason: string }>;
  winner: { abbrev: string; offerId: number; total: number } | null;
}

function num(v: unknown, fb = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fb;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Market and legacy are category matches, not scaled values — flat award on match. */
const CATEGORY_MATCH_POINTS = 3;

interface PoolTeam {
  abbrev: string;
  marketRank: number | null;
  legacyTier: number | null;
  winningRank: number | null;
  ptScore: number;
}

/** Project a team into the shape the scorers need (rank lookups + PT score). */
function buildPoolTeam(
  abbrev: string,
  market: Map<string, { rank: number }>,
  legacy: Map<string, { tier: number }>,
  winning: Map<string, { rank: number }>,
  roster: Array<{ ovr: number | null }>,
): PoolTeam {
  const fifty = roster.filter((r) => (r.ovr ?? 0) >= 50);
  const count = fifty.length;
  const avg = count
    ? fifty.reduce((s, r) => s + (r.ovr ?? 0), 0) / count
    : 0;
  const ptScore = count === 0 ? 0 : (count + avg) / 2;

  return {
    abbrev,
    marketRank: market.get(abbrev)?.rank ?? null,
    legacyTier: legacy.get(abbrev)?.tier ?? null,
    winningRank: winning.get(abbrev)?.rank ?? null,
    ptScore,
  };
}

/** Category match: team's market tier == player's market value → flat 3 pts. 0 → nobody scores. */
function scoreMarket(playerValue: number, team: PoolTeam): ValueLine {
  const m = MULTIPLIERS.market;
  if (playerValue === 0) {
    return {
      key: "market",
      playerValue,
      baseMultiplier: m,
      effectiveMultiplier: m,
      won: false,
      points: 0,
      note: "player has 0 — no team earns points",
    };
  }
  const won = team.marketRank === playerValue;
  return {
    key: "market",
    playerValue,
    baseMultiplier: m,
    effectiveMultiplier: m,
    won,
    points: won ? CATEGORY_MATCH_POINTS : 0,
  };
}

/** Category match: team's legacy tier == player's legacy value → flat 3 pts. 0 → nobody scores. */
function scoreLegacy(playerValue: number, team: PoolTeam): ValueLine {
  const m = MULTIPLIERS.legacy;
  if (playerValue === 0) {
    return {
      key: "legacy",
      playerValue,
      baseMultiplier: m,
      effectiveMultiplier: m,
      won: false,
      points: 0,
      note: "player has 0 — no team earns points",
    };
  }
  const won = team.legacyTier === playerValue;
  return {
    key: "legacy",
    playerValue,
    baseMultiplier: m,
    effectiveMultiplier: m,
    won,
    points: won ? CATEGORY_MATCH_POINTS : 0,
  };
}

/** Lowest ptScore wins; ties all win. 0 → nobody scores. */
function scorePlayingTime(
  playerValue: number,
  team: PoolTeam,
  pool: PoolTeam[],
): ValueLine {
  const m = MULTIPLIERS.playingTime;
  if (playerValue === 0) {
    return {
      key: "playingTime",
      playerValue,
      baseMultiplier: m,
      effectiveMultiplier: m,
      won: false,
      points: 0,
      note: "player has 0 — no team earns points",
    };
  }
  const min = Math.min(...pool.map((p) => p.ptScore));
  const won = team.ptScore === min;
  return {
    key: "playingTime",
    playerValue,
    baseMultiplier: m,
    effectiveMultiplier: m,
    won,
    points: won ? r2(playerValue * m) : 0,
    note: `team PT score ${team.ptScore.toFixed(2)} vs best ${min.toFixed(2)}`,
  };
}

/** Best last-season record wins. 0 reverses → worst record wins. */
function scoreWinning(
  playerValue: number,
  team: PoolTeam,
  pool: PoolTeam[],
): ValueLine {
  const m = MULTIPLIERS.winning;
  const ranks = pool
    .map((p) => p.winningRank)
    .filter((r): r is number => r != null);
  if (!ranks.length || team.winningRank == null) {
    return {
      key: "winning",
      playerValue,
      baseMultiplier: m,
      effectiveMultiplier: m,
      won: false,
      points: 0,
      note: "no winning-rank data",
    };
  }
  if (playerValue === 0) {
    const worst = Math.max(...ranks);
    const won = team.winningRank === worst;
    return {
      key: "winning",
      playerValue,
      baseMultiplier: m,
      effectiveMultiplier: m,
      won,
      points: won ? r2(3 * m) : 0,
      note: `player has 0 — worst record wins (rank ${worst})`,
    };
  }
  const best = Math.min(...ranks);
  const won = team.winningRank === best;
  return {
    key: "winning",
    playerValue,
    baseMultiplier: m,
    effectiveMultiplier: m,
    won,
    points: won ? r2(playerValue * m) : 0,
    note: `best record wins (rank ${best})`,
  };
}

/** Only incumbent earns; effective = base × (years/3 rounded to 0.1). 0 → nobody scores. */
function scoreLoyalty(
  playerValue: number,
  isIncumbent: boolean,
  yearsOnTeam: number,
): ValueLine {
  const m = MULTIPLIERS.loyalty;
  if (playerValue === 0) {
    return {
      key: "loyalty",
      playerValue,
      baseMultiplier: m,
      effectiveMultiplier: m,
      won: false,
      points: 0,
      note: "player has 0 — no team earns points",
    };
  }
  if (!isIncumbent) {
    return {
      key: "loyalty",
      playerValue,
      baseMultiplier: m,
      effectiveMultiplier: m,
      won: false,
      points: 0,
      note: "not incumbent team",
    };
  }
  const yearsMult = loyaltyYearsMultiplier(yearsOnTeam);
  const eff = r2(m * yearsMult);
  return {
    key: "loyalty",
    playerValue,
    baseMultiplier: m,
    effectiveMultiplier: eff,
    won: true,
    points: r2(playerValue * eff),
    note: `incumbent · ${yearsOnTeam}yr → mult ${yearsMult}`,
  };
}

/**
 * Best per-year amount wins; ties all win.
 * Base multiplier: 2.0 (3.0 for RFA). Add +0.1 per $2M gap over the
 * cheapest offer (per-year gap when length=0). 0 → nobody scores.
 */
function scoreMoney(
  playerValue: number,
  amount: number,
  totalMoney: number,
  pool: Array<{ amount: number; totalMoney: number; abbrev: string }>,
  isRFA: boolean,
  hasZeroLength: boolean,
): ValueLine {
  const baseM = MULTIPLIERS.money + (isRFA ? RFA_MONEY_BONUS : 0);
  if (playerValue === 0) {
    return {
      key: "money",
      playerValue,
      baseMultiplier: baseM,
      effectiveMultiplier: baseM,
      won: false,
      points: 0,
      note: "player has 0 — no team earns points",
    };
  }

  const maxPerYr = Math.max(...pool.map((p) => p.amount));
  const won = amount === maxPerYr;

  const otherValues = pool.map((p) =>
    hasZeroLength ? p.amount : p.totalMoney,
  );
  const me = hasZeroLength ? amount : totalMoney;
  const minVal = Math.min(...otherValues);
  const diff = me - minVal;
  const increments = Math.max(0, Math.floor(diff / MONEY_BONUS_INCREMENT_M));
  const bonus = r2(increments * MONEY_BONUS_STEP);
  const eff = r2(baseM + bonus);

  return {
    key: "money",
    playerValue,
    baseMultiplier: baseM,
    effectiveMultiplier: eff,
    won,
    points: won ? r2(playerValue * eff) : 0,
    note:
      `${won ? "best per-year" : "not top per-year"}` +
      (isRFA ? " · RFA +1" : "") +
      (bonus > 0
        ? ` · +${bonus.toFixed(1)} from $${diff.toFixed(0)}M ${hasZeroLength ? "per-yr" : "total"} gap`
        : ""),
  };
}

/** Most years wins; ties all win. 0 reverses → shortest wins. */
function scoreLength(
  playerValue: number,
  years: number,
  pool: Array<{ years: number }>,
): ValueLine {
  const m = MULTIPLIERS.length;
  if (playerValue === 0) {
    const shortest = Math.min(...pool.map((p) => p.years));
    const won = years === shortest;
    return {
      key: "length",
      playerValue,
      baseMultiplier: m,
      effectiveMultiplier: m,
      won,
      points: won ? r2(3 * m) : 0,
      note: `player has 0 — shortest deal wins (${shortest}yr)`,
    };
  }
  const longest = Math.max(...pool.map((p) => p.years));
  const won = years === longest;
  return {
    key: "length",
    playerValue,
    baseMultiplier: m,
    effectiveMultiplier: m,
    won,
    points: won ? r2(playerValue * m) : 0,
  };
}

interface OfferInput {
  offerId: number;
  teamAbbrev: string;
  gm: string;
  amount: number;
  years: number;
}

/** Drop any offer dominated by ≥$10M/yr AND ≥$20M total by some other offer. */
function applyMoneyRuleFilter(rawOffers: OfferInput[]): {
  survivors: OfferInput[];
  killed: Array<{ offerId: number; teamAbbrev: string; reason: string }>;
} {
  const killed: Array<{ offerId: number; teamAbbrev: string; reason: string }> =
    [];
  const survivors: OfferInput[] = [];
  for (const o of rawOffers) {
    const oTotal = o.amount * o.years;
    let dominated = false;
    for (const other of rawOffers) {
      if (other.offerId === o.offerId) continue;
      const otherTotal = other.amount * other.years;
      const perYearDiff = other.amount - o.amount;
      const totalDiff = otherTotal - oTotal;
      if (perYearDiff >= TEN_M_PER_YEAR && totalDiff >= TWENTY_M_TOTAL) {
        killed.push({
          offerId: o.offerId,
          teamAbbrev: o.teamAbbrev,
          reason: `${other.teamAbbrev} dominates by $${perYearDiff.toFixed(0)}M/yr · $${totalDiff.toFixed(0)}M total`,
        });
        dominated = true;
        break;
      }
    }
    if (!dominated) survivors.push(o);
  }
  return { survivors, killed };
}

/**
 * Score every pending offer on the FA, run the 10M/20M filter, then Hayato-
 * eliminate the lowest score until 2 teams remain. Returns each round's table
 * plus the final winner.
 */
export async function calcFreeAgentWinner(faId: number): Promise<CalcResult> {
  const [fa] = await db
    .select()
    .from(freeAgents)
    .where(eq(freeAgents.id, faId))
    .limit(1);
  if (!fa) throw new Error("fa_not_found");

  const [season] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.id, fa.seasonId))
    .limit(1);
  if (!season) throw new Error("season_not_found");

  const rawOffers = await db
    .select()
    .from(offers)
    .where(and(eq(offers.freeAgentId, faId), eq(offers.status, "PENDING")));

  const [marketArr, legacyArr, winningArr, teamArr] = await Promise.all([
    db.select().from(marketRanks).where(eq(marketRanks.seasonId, season.id)),
    db.select().from(legacyRanks).where(eq(legacyRanks.seasonId, season.id)),
    db.select().from(winningRanks).where(eq(winningRanks.seasonId, season.id)),
    db.select().from(teams).where(eq(teams.seasonId, season.id)),
  ]);

  const marketMap = new Map(marketArr.map((m) => [m.teamAbbrev, m]));
  const legacyMap = new Map(legacyArr.map((l) => [l.teamAbbrev, l]));
  const winningMap = new Map(winningArr.map((w) => [w.teamAbbrev, w]));
  const teamMap = new Map(teamArr.map((t) => [t.abbrev, t]));

  const offerInputs = rawOffers.map((o) => ({
    offerId: o.id,
    teamAbbrev: o.teamAbbrev,
    gm: o.offerGm,
    amount: num(o.offerAmount),
    years: o.offerLength,
  }));

  const { survivors, killed } = applyMoneyRuleFilter(offerInputs);

  function buildPool(abvs: string[]): PoolTeam[] {
    return abvs.map((abv) => {
      const t = teamMap.get(abv);
      const roster = (t?.roster as Array<{ ovr: number | null }> | null) ?? [];
      return buildPoolTeam(abv, marketMap, legacyMap, winningMap, roster);
    });
  }

  const isRFA = fa.faStatus === "RFA";
  // player.values shows actual sheet values regardless of FA status — the
  // omission for RFAs happens at scoring time, not by zeroing the inputs.
  const player = {
    id: fa.id,
    name: fa.name,
    position: fa.position,
    overall: fa.overall,
    faStatus: fa.faStatus,
    previousTeam: fa.previousTeam,
    values: {
      market: fa.marketValue,
      legacy: fa.legacyValue,
      playingTime: fa.playingTimeValue,
      winning: fa.winningValue,
      loyalty: fa.loyaltyValue,
      money: fa.moneyValue,
      length: fa.lengthValue,
    },
  };

  /** Zero-point placeholder for value keys we explicitly skip (e.g. RFA-omitted). */
  function omitted(key: ValueKey, pv: number, note: string): ValueLine {
    const m = MULTIPLIERS[key];
    return {
      key,
      playerValue: pv,
      baseMultiplier: m,
      effectiveMultiplier: m,
      won: false,
      points: 0,
      note,
    };
  }

  /** Score every offer in the given pool against each other. */
  function scoreAll(pool: OfferInput[]): OfferScore[] {
    const poolAbvs = pool.map((o) => o.teamAbbrev);
    const poolTeams = buildPool(poolAbvs);
    const moneyPool = pool.map((o) => ({
      abbrev: o.teamAbbrev,
      amount: o.amount,
      totalMoney: o.amount * o.years,
    }));
    const lengthPool = pool.map((o) => ({ years: o.years }));

    return pool.map((o) => {
      const poolTeam = poolTeams.find((p) => p.abbrev === o.teamAbbrev)!;
      const isIncumbent = o.teamAbbrev === fa.previousTeam;
      const hasZeroLength = player.values.length === 0;

      const values: ValueLine[] = isRFA
        ? [
            omitted("market", player.values.market, "RFA — not counted"),
            omitted("legacy", player.values.legacy, "RFA — not counted"),
            omitted("playingTime", player.values.playingTime, "RFA — not counted"),
            omitted("winning", player.values.winning, "RFA — not counted"),
            omitted("loyalty", player.values.loyalty, "RFA — not counted"),
            scoreMoney(
              player.values.money,
              o.amount,
              o.amount * o.years,
              moneyPool,
              isRFA,
              hasZeroLength,
            ),
            scoreLength(player.values.length, o.years, lengthPool),
          ]
        : [
            scoreMarket(player.values.market, poolTeam),
            scoreLegacy(player.values.legacy, poolTeam),
            scorePlayingTime(player.values.playingTime, poolTeam, poolTeams),
            scoreWinning(player.values.winning, poolTeam, poolTeams),
            scoreLoyalty(player.values.loyalty, isIncumbent, fa.yearsOnPreviousTeam),
            scoreMoney(
              player.values.money,
              o.amount,
              o.amount * o.years,
              moneyPool,
              isRFA,
              hasZeroLength,
            ),
            scoreLength(player.values.length, o.years, lengthPool),
          ];

      const total = values.reduce((s, v) => s + v.points, 0);
      return {
        offerId: o.offerId,
        teamAbbrev: o.teamAbbrev,
        gm: o.gm,
        amount: o.amount,
        years: o.years,
        totalMoney: o.amount * o.years,
        values,
        total: r2(total),
      };
    });
  }

  const rounds: CalcResult["rounds"] = [];
  let pool = [...survivors];
  let round = 1;
  while (pool.length > 2) {
    const scored = scoreAll(pool);
    const lowest = scored.reduce((min, s) => (s.total < min.total ? s : min));
    rounds.push({
      round,
      teams: scored,
      eliminatedAbbrev: lowest.teamAbbrev,
      eliminatedTotal: lowest.total,
    });
    pool = pool.filter((o) => o.teamAbbrev !== lowest.teamAbbrev);
    round++;
  }
  if (pool.length > 0) {
    const scored = scoreAll(pool);
    rounds.push({ round, teams: scored });
  }

  const lastRound = rounds[rounds.length - 1];
  const winner = lastRound
    ? lastRound.teams.reduce(
        (best, s) => (best == null || s.total > best.total ? s : best),
        null as OfferScore | null,
      )
    : null;

  return {
    player,
    rounds,
    preFilter: killed,
    winner: winner
      ? { abbrev: winner.teamAbbrev, offerId: winner.offerId, total: winner.total }
      : null,
  };
}
