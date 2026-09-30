-- drizzle-kit push does not add values to an existing enum, so this one is
-- applied by hand. Safe to re-run.
ALTER TYPE gl_direction ADD VALUE IF NOT EXISTS 'RELEASE';
