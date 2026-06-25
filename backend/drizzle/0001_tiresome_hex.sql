CREATE TYPE "public"."fa_status" AS ENUM('SIGNED', 'RFA', 'UFA', 'TBD');--> statement-breakpoint
CREATE TABLE "free_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" text NOT NULL,
	"previous_team" text NOT NULL,
	"cap_hold" numeric(10, 2) NOT NULL,
	"fa_status" "fa_status" NOT NULL,
	"season_id" integer NOT NULL,
	"age" integer NOT NULL,
	"overall" integer NOT NULL,
	"market_value" integer NOT NULL,
	"legacy_value" integer NOT NULL,
	"playing_time_value" integer NOT NULL,
	"winning_value" integer NOT NULL,
	"loyalty_value" integer NOT NULL,
	"money_value" integer NOT NULL,
	"length_value" integer NOT NULL,
	"winning_offer_id" integer
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"free_agent_id" integer NOT NULL,
	"team_name" text NOT NULL,
	"offer_amount" numeric(10, 2) NOT NULL,
	"offer_length" integer NOT NULL,
	"offer_season" integer NOT NULL,
	"offer_gm" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "free_agents" ADD CONSTRAINT "free_agents_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_agents" ADD CONSTRAINT "free_agents_winning_offer_id_offers_id_fk" FOREIGN KEY ("winning_offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_free_agent_id_free_agents_id_fk" FOREIGN KEY ("free_agent_id") REFERENCES "public"."free_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_offer_season_seasons_id_fk" FOREIGN KEY ("offer_season") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;