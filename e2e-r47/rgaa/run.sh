#!/bin/bash
# FA-D4 — RGAA 4.1.2 technical audit (INTERNAL, automated + scripted manual-style checks; NOT a conformity declaration) on the representative sample of the
# seven surfaces. Reuses the R47 admin LAB server (e2e-r47/admin/serve.mjs: built app + REAL api/index.js, final configuration, synthetic fixtures, loopback
# mocks) on its own disposable database and ports, then stops everything and drops the database. Never :3000, never Production.
# Build first (from the worktree), every surface opened by its switch:
#   VITE_PUBLIC_BETA=true VITE_PUBLIC_BETA_OPEN_SURFACES=accounts,pro,institution,appointments,video,communications,documents,diagnostic,admin \
#   VITE_PUBLIC_BETA_ACCOUNTS_SCOPE=full npx vite build --outDir <dir>
#   R47_DIST=<dir> RGAA_OUT=<result.json> bash e2e-r47/rgaa/run.sh [playwright args]
set -u
WT=$(cd "$(dirname "$0")/../.." && pwd); P=/opt/homebrew/opt/postgresql@17/bin
PORT=${RGAA_PORT:-5198}; CONTROL=${RGAA_CONTROL_PORT:-5298}
[ "$PORT" = 3000 ] && { echo "port 3000 is the owner LAB"; exit 3; }
DB=${RGAA_DB:-ada_fa4_rgaa_test}; URL=postgres://ada_test@127.0.0.1:55434/$DB
CREDS=$(mktemp); chmod 600 "$CREDS"
q() { "$P/psql" -h 127.0.0.1 -p 55434 -U postgres -d postgres -Atq -c "$1"; }
q "drop database if exists $DB" >/dev/null; q "create database $DB owner ada_test encoding 'UTF8' template template0 locale 'C'"; q "alter database $DB set timezone to 'UTC'"
"$P/psql" -h 127.0.0.1 -p 55434 -U ada_test -d $DB -Atq -c "create extension unaccent; create extension pg_trgm; create extension vector;"
(cd "$WT" && DATABASE_URL=$URL node --input-type=module -e "
import pg from 'pg'; import { drizzle } from 'drizzle-orm/node-postgres'; import { migrate } from 'drizzle-orm/node-postgres/migrator';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect(); await migrate(drizzle(c), { migrationsFolder: process.cwd() + '/drizzle' }); await c.end();") || exit 1
cd "$WT"
env -i PATH="$PATH" HOME="$HOME" TZ=UTC DATABASE_URL=$URL ADA_ENCRYPTION_KEY=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))') npx --no-install tsx scripts/geo-load.mjs --departements=67 >/dev/null 2>&1 || echo "geo-load failed"
env -i PATH="$PATH" HOME="$HOME" LANG=fr_FR.UTF-8 TZ=UTC DATABASE_URL=$URL R47_CREDS=$CREDS R47_PORT=$PORT R47_CONTROL_PORT=$CONTROL R47_DIST=${R47_DIST:-dist-r47} \
  node --import tsx e2e-r47/admin/serve.mjs > "${RGAA_LOG:-/dev/null}" 2>&1 & SRV=$!
trap 'kill $SRV 2>/dev/null; rm -f "$CREDS"; q "drop database if exists $DB" >/dev/null' EXIT
UP=0; for i in $(seq 1 90); do [ -s "$CREDS" ] && curl -s -o /dev/null "http://127.0.0.1:$CONTROL/hds" && { UP=1; break; }; sleep 1; done
[ "$UP" = 1 ] || { echo "LAB server did not start"; exit 1; }
# the sample's public record pages: one verified aide and one verified démarche (synthetic, D-5 v2 fields), written directly in this disposable database
"$P/psql" -h 127.0.0.1 -p 55434 -U ada_test -d $DB -Atq -c "
INSERT INTO \"Aide\" (id, slug, titre, cest_quoi, categorie, statut, launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url, \"updatedAt\", published_at)
VALUES ('fa4-aide', 'aide-synthetique-fa4', 'Aide synthétique FA4 pour le loyer', 'Fiche de test synthétique : aide pour payer le loyer.', 'logement', 'publie', true, 'VERIFIED', 'verification-automatique', true, 'official_source', NOW() - interval '3 days', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006', NOW(), NOW() - interval '3 days') ON CONFLICT DO NOTHING;
INSERT INTO \"Demarche\" (id, slug, titre, description_courte, categorie, statut, launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url, \"updatedAt\")
VALUES ('fa4-dem', 'demarche-synthetique-fa4', 'Démarche synthétique FA4 : demander un logement social', 'Fiche de test synthétique.', 'logement', 'publie', true, 'VERIFIED', 'verification-automatique', true, 'official_source', NOW() - interval '3 days', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F869', NOW()) ON CONFLICT DO NOTHING;" >/dev/null || echo "record seed failed (detail pages will show their not-found state)"
env -i PATH="$PATH" HOME="$HOME" R47_CREDS=$CREDS RGAA_OUT="${RGAA_OUT:-}" RGAA_LANGS="${RGAA_LANGS:-}" RGAA_ONLY="${RGAA_ONLY:-}" RTL_OUT="${RTL_OUT:-}" RTL_SHOTS="${RTL_SHOTS:-}" RTL_LANGS="${RTL_LANGS:-}" npx --no-install playwright test -c "${RGAA_CONFIG:-e2e-r47/rgaa/playwright.config.mjs}" "$@"; RC=$?
echo "rgaa rc=$RC"; exit $RC
