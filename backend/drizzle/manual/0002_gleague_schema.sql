-- G-League schema, additive only. Safe to re-run: every statement is
-- IF NOT EXISTS, and nothing is dropped or altered destructively.
BEGIN;

ALTER TABLE seasons ADD COLUMN IF NOT EXISTS gl_league_link text;

DO $$ BEGIN
  CREATE TYPE gl_direction AS ENUM ('ASSIGN', 'CALLUP', 'RELEASE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE gl_move_status AS ENUM ('PROPOSED', 'COMMITTED', 'DECLINED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE gl_contract_source AS ENUM ('RESTORED', 'PAYSCALE', 'MINIMUM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS gl_teams (
  id serial PRIMARY KEY,
  season_id integer NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  gl_tid integer NOT NULL,
  gl_abbrev text NOT NULL,
  gl_region text NOT NULL,
  gl_name text NOT NULL,
  parent_abbrev text NOT NULL,
  parent_tid integer,
  total_salary numeric(10, 2) NOT NULL,
  roster jsonb
);

CREATE TABLE IF NOT EXISTS gl_moves (
  id serial PRIMARY KEY,
  season_id integer NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  direction gl_direction NOT NULL,
  status gl_move_status NOT NULL DEFAULT 'PROPOSED',
  player_key text NOT NULL,
  player_name text NOT NULL,
  born_year integer NOT NULL,
  main_pid integer,
  gl_pid integer,
  main_team_abbrev text NOT NULL,
  gl_team_abbrev text NOT NULL,
  ovr_at_move integer NOT NULL,
  age_at_move integer NOT NULL,
  snap_contract_amount numeric(10, 2),
  snap_contract_exp integer,
  snap_was_rookie boolean NOT NULL DEFAULT false,
  new_contract_amount numeric(10, 2),
  new_contract_exp integer,
  new_contract_years integer,
  contract_source gl_contract_source,
  rfa_rights_lost boolean NOT NULL DEFAULT false,
  forced boolean NOT NULL DEFAULT false,
  override_reason text,
  submitted_by_gm text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- Outside the transaction: ADD VALUE can't run in one on older Postgres.
ALTER TYPE gl_direction ADD VALUE IF NOT EXISTS 'RELEASE';
