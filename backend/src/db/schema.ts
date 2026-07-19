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
});
