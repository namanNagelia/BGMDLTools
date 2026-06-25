import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  decimal,
  jsonb,
  pgEnum,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const seasons = pgTable("seasons", {
  id: serial("id").primaryKey(),
  seasonNumber: integer("season_number").notNull(),
  leagueLink: text("league_link").notNull(),
  sheetsLink: text("sheets_link"),
  isCurrentSzn: boolean("is_current_szn").default(false).notNull(),
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
  ratings: jsonb("ratings"),
  winningOfferId: integer("winning_offer_id").references(
    (): AnyPgColumn => offers.id,
    { onDelete: "set null" },
  ),
});

export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  freeAgentId: integer("free_agent_id")
    .references(() => freeAgents.id)
    .notNull(),
  teamName: text("team_name").notNull(),
  offerAmount: decimal("offer_amount", { precision: 10, scale: 2 }).notNull(),
  offerLength: integer("offer_length").notNull(),
  offerSeason: integer("offer_season")
    .references(() => seasons.id)
    .notNull(),
  offerGm: text("offer_gm").notNull(),
});
