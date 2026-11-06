#!/bin/bash
# R47 admin — disposable LAB database (PG17 127.0.0.1:55434), the LAB server (built app R47_DIST + real API, final configuration) on :5193, the browser suite,
# then everything is stopped and the database dropped. Build first (from the worktree):
#   VITE_PUBLIC_BETA=true VITE_PUBLIC_BETA_OPEN_SURFACES=accounts,pro,institution,appointments,video,communications,documents,diagnostic,admin \
#   VITE_PUBLIC_BETA_ACCOUNTS_SCOPE=full npx vite build --outDir dist-r47
set -u
WT=$(cd "$(dirname "$0")/../.." && pwd); P=/opt/homebrew/opt/postgresql@17/bin
DB=ada_r47_admin_test; URL=postgres://ada_test@127.0.0.1:55434/$DB
CREDS=$(mktemp); chmod 600 "$CREDS"
q() { "$P/psql" -h 127.0.0.1 -p 55434 -U postgres -d postgres -Atq -c "$1"; }
q "drop database if exists $DB" >/dev/null; q "create database $DB owner ada_test encoding 'UTF8' template template0 locale 'C'"; q "alter database $DB set timezone to 'UTC'"
"$P/psql" -h 127.0.0.1 -p 55434 -U ada_test -d $DB -Atq -c "create extension unaccent; create extension pg_trgm; create extension vector;"
(cd "$WT" && DATABASE_URL=$URL node --input-type=module -e "
import pg from 'pg'; import { drizzle } from 'drizzle-orm/node-postgres'; import { migrate } from 'drizzle-orm/node-postgres/migrator';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect(); await migrate(drizzle(c), { migrationsFolder: process.cwd() + '/drizzle' }); await c.end();") || exit 1
cd "$WT"
# the official territory reference of the Bas-Rhin (offline, from data/reference): the assistant resolves « Strasbourg » only with it
env -i PATH="$PATH" HOME="$HOME" TZ=UTC DATABASE_URL=$URL ADA_ENCRYPTION_KEY=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))') npx --no-install tsx scripts/geo-load.mjs --departements=67 >/dev/null 2>&1 || echo "geo-load failed"
env -i PATH="$PATH" HOME="$HOME" LANG=fr_FR.UTF-8 TZ=UTC DATABASE_URL=$URL R47_CREDS=$CREDS R47_DIST=${R47_DIST:-dist-r47} node --import tsx e2e-r47/admin/serve.mjs > "${R47_LOG:-/dev/null}" 2>&1 & SRV=$!
trap 'kill $SRV 2>/dev/null; rm -f "$CREDS"; q "drop database if exists $DB" >/dev/null' EXIT
for i in $(seq 1 90); do [ -s "$CREDS" ] && curl -s -o /dev/null http://127.0.0.1:5294/hds && break; sleep 1; done
env -i PATH="$PATH" HOME="$HOME" R47_CREDS=$CREDS npx --no-install playwright test -c e2e-r47/admin/playwright.config.mjs "$@"; RC=$?
echo "admin rc=$RC"; exit $RC
