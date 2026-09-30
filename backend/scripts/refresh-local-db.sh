#!/usr/bin/env bash
#
# Rebuild the local dev database as a fresh copy of production.
#
# Production is only ever READ (pg_dump). Everything destructive happens to the
# local database named in .env.local, which is dropped and recreated.
#
#   npm run db:refresh-local
#
set -euo pipefail

cd "$(dirname "$0")/.."

PG_BIN="/opt/homebrew/opt/postgresql@18/bin"
[ -d "$PG_BIN" ] && export PATH="$PG_BIN:$PATH"

PROD_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
LOCAL_URL="$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)"
LOCAL_DB="${LOCAL_URL##*/}"

if [ -z "$PROD_URL" ] || [ -z "$LOCAL_URL" ]; then
  echo "error: need DATABASE_URL in both .env (prod) and .env.local (local)" >&2
  exit 1
fi

# Guard: never let this point at anything but a local server.
case "$LOCAL_URL" in
  *localhost*|*127.0.0.1*) ;;
  *) echo "error: .env.local DATABASE_URL is not local — refusing to drop $LOCAL_DB" >&2; exit 1 ;;
esac

DUMP="$(mktemp -t bgmdl-prod-XXXXXX).sql"
trap 'rm -f "$DUMP"' EXIT

echo "==> dumping production (read-only)"
pg_dump --no-owner --no-acl -d "$PROD_URL" -f "$DUMP"
echo "    $(du -h "$DUMP" | cut -f1)"

echo "==> recreating $LOCAL_DB"
psql -d postgres -qc \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$LOCAL_DB' AND pid <> pg_backend_pid();" >/dev/null
dropdb --if-exists "$LOCAL_DB"
createdb "$LOCAL_DB"

echo "==> restoring"
psql -q -d "$LOCAL_DB" -f "$DUMP" 2>&1 | grep -iE '^(error|fatal)' || true

echo "==> applying local schema (adds anything not yet migrated to prod, e.g. the G-League tables)"
npx drizzle-kit push --force >/dev/null 2>&1

echo "==> done"
psql -d "$LOCAL_DB" -c "\
  SELECT 'seasons' AS table, count(*) FROM seasons \
  UNION ALL SELECT 'free_agents', count(*) FROM free_agents \
  UNION ALL SELECT 'offers', count(*) FROM offers \
  UNION ALL SELECT 'gl_moves', count(*) FROM gl_moves \
  UNION ALL SELECT 'gl_teams', count(*) FROM gl_teams;"
