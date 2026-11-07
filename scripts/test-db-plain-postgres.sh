#!/usr/bin/env bash
# Runs the database tests against a plain Postgres (with pgTAP installed),
# using a stub of the Supabase pieces we depend on. For machines without
# Docker. CI uses the real Supabase stack via `supabase test db`.
#
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-db-plain-postgres.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=wfsc_test_$$
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f scripts/supabase-stub.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
# CI's database has the seed loaded too; tests must not depend on it being absent.
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/seed.sql
status=0
for f in supabase/tests/*.sql; do
  out=$(psql -q -X -At -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1) || status=1
  echo "$out"
  if echo "$out" | grep -qE '^not ok|Looks like|ERROR'; then status=1; fi
done
exit $status
