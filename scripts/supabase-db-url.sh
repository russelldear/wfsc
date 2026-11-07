#!/usr/bin/env bash
# Prints a connection URL for a Supabase project's database, via its IPv4
# session pooler. GitHub-hosted runners have no IPv6, and Supabase's direct
# database host is IPv6-only.
#
# Usage: SUPABASE_ACCESS_TOKEN=... SUPABASE_DB_PASSWORD=... scripts/supabase-db-url.sh <project-ref>
set -euo pipefail

ref="${1:?project ref required}"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be set}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD must be set}"

response=$(curl --silent --show-error --fail-with-body \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${ref}/config/database/pooler") || {
  echo "Could not look up the database pooler for project ${ref}: ${response:-no response}" >&2
  exit 1
}

# Session mode (port 5432) rather than transaction mode (6543): migrations
# need a normal session.
node -e '
  const list = [].concat(JSON.parse(process.argv[1]));
  const p = list.find((x) => x.database_type === "PRIMARY") ?? list[0];
  if (!p || !p.db_host || !p.db_user) {
    console.error("Unexpected pooler response: " + process.argv[1]);
    process.exit(1);
  }
  const user = encodeURIComponent(p.db_user);
  const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD);
  console.log(`postgresql://${user}:${password}@${p.db_host}:5432/${p.db_name || "postgres"}`);
' "$response"
