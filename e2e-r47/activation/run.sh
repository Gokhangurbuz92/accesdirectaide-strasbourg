#!/bin/bash
# R47 activation — live proof on a disposable LAB database (PG17 127.0.0.1:55434), then the database is dropped.
#   e2e-r47/activation/run.sh full  <report.json>   all shipped migrations (0043–0045 included)
#   e2e-r47/activation/run.sh 0042  <report.json>   the Production schema level (migrations up to 0042 only: 0045 NOT applied)
# Port 5193 (+5293 mock ProConnect, ephemeral loopback ports for the other mocks). Never :3000, never Production, synthetic data only.
set -u
LEVEL=${1:-full}; OUT=${2:-}
WT=$(cd "$(dirname "$0")/../.." && pwd)
P=/opt/homebrew/opt/postgresql@17/bin
DB=ada_r47_activation_${LEVEL}_test; URL=postgres://ada_test@127.0.0.1:55434/$DB
q() { "$P/psql" -h 127.0.0.1 -p 55434 -U postgres -d postgres -Atq -c "$1"; }
q "drop database if exists $DB" >/dev/null; q "create database $DB owner ada_test encoding 'UTF8' template template0 locale 'C'"; q "alter database $DB set timezone to 'UTC'"
"$P/psql" -h 127.0.0.1 -p 55434 -U ada_test -d $DB -Atq -c "create extension unaccent; create extension pg_trgm; create extension vector;"
MIG=$WT/drizzle
if [ "$LEVEL" = "0042" ]; then
  MIG=$(mktemp -d); cp "$WT"/drizzle/00[0-3]*.sql "$WT"/drizzle/004[0-2]*.sql "$MIG"/; mkdir "$MIG/meta"
  node -e 'const j=require(process.argv[1]); j.entries=j.entries.filter(e=>e.idx<=42); require("fs").writeFileSync(process.argv[2], JSON.stringify(j))' "$WT/drizzle/meta/_journal.json" "$MIG/meta/_journal.json"
fi
(cd "$WT" && DATABASE_URL=$URL MIG=$MIG node --input-type=module -e "
import pg from 'pg'; import { drizzle } from 'drizzle-orm/node-postgres'; import { migrate } from 'drizzle-orm/node-postgres/migrator';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect(); await migrate(drizzle(c), { migrationsFolder: process.env.MIG }); await c.end();") || exit 1
cd "$WT"
# the official territory reference of the Bas-Rhin (offline, from data/reference): the assistant resolves « Strasbourg » only with it
env -i PATH="$PATH" HOME="$HOME" TZ=UTC DATABASE_URL=$URL ADA_ENCRYPTION_KEY=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))') npx --no-install tsx scripts/geo-load.mjs --departements=67 >/dev/null 2>&1 || echo "geo-load failed"
env -i PATH="$PATH" HOME="$HOME" LANG=fr_FR.UTF-8 TZ=UTC DATABASE_URL=$URL node --import tsx e2e-r47/activation/run.mjs ${OUT:+--out "$OUT"} 2>/dev/null | grep -v '^{'
RC=${PIPESTATUS[0]}
q "drop database if exists $DB" >/dev/null
[ "$LEVEL" = "0042" ] && rm -rf "$MIG"
exit $RC
