import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  decimal,
  jsonb,
  timestamp,
  pgEnum,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const seasons = pgTable("seasons", {
  id: serial("id").primaryKey(),
  seasonNumber: integer("season_number").notNull(),
  leagueLink: text("league_link").notNull(),
  sheetsLink: text("sheets_link"),
  isCurrentSzn: boolean("is_current_szn").default(false).notNull(),
  currentWave: integer("current_wave").default(1).notNull(),
  /** Dropbox link to the paired G-League BBGM export. */
  glLeagueLink: text("gl_league_link"),
});

export const statusEnum = pgEnum("fa_status", ["SIGNED", "RFA", "UFA", "TBD"]);
export const freeAgents = pgTable("free_agents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  position: text("position").notNull(),
  previousTeam: text("previous_team").notNull(),
  capHold: decimal("cap_hold", { precision: 10, scale: 2 }).notNull(),
  faStatus: statusEnum("fa_status").notNull(),
  seasonId: integer("season_id")
    .references(() => seasons.id)
    .notNull(),
  age: integer("age").notNull(),
  overall: integer("overall").notNull(),
  marketValue: integer("market_value").notNull(),
  legacyValue: integer("legacy_value").notNull(),
  playingTimeValue: integer("playing_time_value").notNull(),
  winningValue: integer("winning_value").notNull(),
  loyaltyValue: integer("loyalty_value").notNull(),
  moneyValue: integer("money_value").notNull(),
  lengthValue: integer("length_value").notNull(),
  wave: integer("wave").default(1).notNull(),
  yearsOnPreviousTeam: integer("years_on_previous_team").default(1).notNull(),
  source: text("source").default("SHEET").notNull(),
  ratings: jsonb("ratings"),
  renounced: boolean("renounced").default(false).notNull(),
  winningOfferId: integer("winning_offer_id").references(
    (): AnyPgColumn => offers.id,
    { onDelete: "set null" },
  ),
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id")
    .references(() => seasons.id, { onDelete: "cascade" })
    .notNull(),
  tid: integer("tid").notNull(),
  abbrev: text("abbrev").notNull(),
  name: text("name").notNull(),
  totalSalary: decimal("total_salary", { precision: 10, scale: 2 }).notNull(),
  roster: jsonb("roster"),
});

export const marketRanks = pgTable("market_ranks", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id")
    .references(() => seasons.id, { onDelete: "cascade" })
    .notNull(),
  teamAbbrev: text("team_abbrev").notNull(),
  teamName: text("team_name").notNull(),
  rank: integer("rank").notNull(),
});

export const legacyRanks = pgTable("legacy_ranks", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id")
    .references(() => seasons.id, { onDelete: "cascade" })
    .notNull(),
  teamAbbrev: text("team_abbrev").notNull(),
  teamName: text("team_name").notNull(),
  tier: integer("tier").notNull(),
  titles: integer("titles").notNull(),
  finals: integer("finals").notNull(),
  playoffPct: decimal("playoff_pct", { precision: 6, scale: 2 }),
});

export const winningRanks = pgTable("winning_ranks", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id")
    .references(() => seasons.id, { onDelete: "cascade" })
    .notNull(),
  teamAbbrev: text("team_abbrev").notNull(),
  teamCity: text("team_city").notNull(),
  rank: integer("rank").notNull(),
  postseason: text("postseason"), // CHAMPION | FINALS | CF | null
});

export const offerStatusEnum = pgEnum("offer_status", [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
]);

export const ingestSnapshots = pgTable("ingest_snapshots", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id")
    .references(() => seasons.id, { onDelete: "cascade" })
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  freeAgentsCount: integer("free_agents_count").notNull(),
  offersCount: integer("offers_count").notNull(),
  freeAgents: jsonb("free_agents").notNull(),
  offers: jsonb("offers").notNull(),
});

export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  freeAgentId: integer("free_agent_id")
    .references(() => freeAgents.id, { onDelete: "cascade" })
    .notNull(),
  teamAbbrev: text("team_abbrev").notNull(),
  offerAmount: decimal("offer_amount", { precision: 10, scale: 2 }).notNull(),
  offerLength: integer("offer_length").notNull(),
  offerSeason: integer("offer_season")
    .references(() => seasons.id, { onDelete: "cascade" })
    .notNull(),
  offerGm: text("offer_gm").notNull(),
  codeWord: text("code_word"),
  status: offerStatusEnum("status").default("PENDING").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // Mid-Level Exception flag. Backfills to false on existing rows via default.
  isMle: boolean("is_mle").default(false).notNull(),
  // Which MLE tier the GM declared (1 or 2). Null on non-MLE offers and on
  // pre-tier rows — those fall back to whatever tier the team's cap qualifies
  // for. A team may declare either tier regardless of eligibility; a mismatch
  // is a warning, not a block, because trades can move the cap number.
  mleTier: integer("mle_tier"),
  // Rule 6 RFA exception: the GM declares this offer is riding on money
  // already tied up in their offers to restricted free agents. Declarative
  // only — the cap checks ignore it; the mod reads it when resolving signings.
  isDoubleDip: boolean("is_double_dip").default(false).notNull(),
});

/* ---------------------------------------------------------------------------
 * G-League
 *
 * A season pairs two BBGM exports: the post-draft main league export (already
 * on `seasons.leagueLink`) and the G-League export (`seasons.glLeagueLink`).
 * Players move between the two files; `glMoves` is the authoritative ledger of
 * every transfer, and it is what makes a call-up able to restore the exact
 * contract a player carried when he was sent down.
 * ------------------------------------------------------------------------- */

/** Cached parse of the G-League export, mirroring `teams` for the main league. */
export const glTeams = pgTable("gl_teams", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id")
    .references(() => seasons.id, { onDelete: "cascade" })
    .notNull(),
  glTid: integer("gl_tid").notNull(),
  glAbbrev: text("gl_abbrev").notNull(),
  glRegion: text("gl_region").notNull(),
  glName: text("gl_name").notNull(),
  /** Parent club, read from the "(NOP) Birmingham" tag on the GL team's region. */
  parentAbbrev: text("parent_abbrev").notNull(),
  parentTid: integer("parent_tid"),
  totalSalary: decimal("total_salary", { precision: 10, scale: 2 }).notNull(),
  roster: jsonb("roster"),
});

export const glDirectionEnum = pgEnum("gl_direction", ["ASSIGN", "CALLUP"]);
export const glMoveStatusEnum = pgEnum("gl_move_status", [
  "PROPOSED",
  "COMMITTED",
  "DECLINED",
]);
export const glContractSourceEnum = pgEnum("gl_contract_source", [
  "RESTORED",
  "PAYSCALE",
  "MINIMUM",
]);

export const glMoves = pgTable("gl_moves", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id")
    .references(() => seasons.id, { onDelete: "cascade" })
    .notNull(),
  direction: glDirectionEnum("direction").notNull(),
  status: glMoveStatusEnum("status").default("PROPOSED").notNull(),

  /** name|bornYear — the join between two exports with independent pid spaces. */
  playerKey: text("player_key").notNull(),
  playerName: text("player_name").notNull(),
  bornYear: integer("born_year").notNull(),
  mainPid: integer("main_pid"),
  glPid: integer("gl_pid"),
  mainTeamAbbrev: text("main_team_abbrev").notNull(),
  glTeamAbbrev: text("gl_team_abbrev").notNull(),
  ovrAtMove: integer("ovr_at_move").notNull(),
  ageAtMove: integer("age_at_move").notNull(),

  /** The main-league contract as it stood when he was assigned. */
  snapContractAmount: decimal("snap_contract_amount", { precision: 10, scale: 2 }),
  snapContractExp: integer("snap_contract_exp"),
  /** Whether that snapshot was a rookie deal — drives the RFA-rights rule. */
  snapWasRookie: boolean("snap_was_rookie").default(false).notNull(),

  /** What he was actually paid on the way back up. */
  newContractAmount: decimal("new_contract_amount", { precision: 10, scale: 2 }),
  newContractExp: integer("new_contract_exp"),
  newContractYears: integer("new_contract_years"),
  contractSource: glContractSourceEnum("contract_source"),

  /** Rule #5: a rookie deal that lapsed in the G-League costs RFA rights. */
  rfaRightsLost: boolean("rfa_rights_lost").default(false).notNull(),
  /** Rule #4: he no longer meets assign criteria, so the call-up is mandatory. */
  forced: boolean("forced").default(false).notNull(),
  /** Mod-recorded override of a soft rule (roster shape, service time). */
  overrideReason: text("override_reason"),
  /**
   * The GM who submitted this from the public page. Attribution, not
   * authorization — the public page has no secret, so the approval queue is
   * what actually gates a move reaching an export.
   */
  submittedByGm: text("submitted_by_gm"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
