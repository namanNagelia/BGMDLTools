CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_number" integer NOT NULL,
	"league_link" text NOT NULL,
	"is_current_szn" boolean DEFAULT false NOT NULL
);
