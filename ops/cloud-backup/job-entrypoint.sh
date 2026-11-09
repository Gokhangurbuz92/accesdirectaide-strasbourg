#!/bin/sh
# V2 C7 — start of the backup jobs on the stock public image node:22-bookworm-slim (no Docker build). Canonical copy: THIS file at the release SHA.
# Delivery (Scaleway's documented model for complex startup scripts — no multiline environment variable):
#   1. this file is stored as a Secret Manager secret (one version per release; that version is the one referenced, never "latest");
#   2. the job references it with the method « File », mounted at /ada/job-entrypoint.sh;
#   3. jobs API v1alpha2: startup_command ["/bin/sh", "-c"], args = ONE line that checks the mounted file against the pinned digest, then runs it:
#        /bin/sh -c 'echo "$ADA_ENTRYPOINT_SHA256  /ada/job-entrypoint.sh" | sha256sum -c --status - && exec /bin/sh /ada/job-entrypoint.sh || { echo "{\"ok\":false,\"code\":\"ENTRYPOINT_DIGEST_MISMATCH\"}"; exit 1; }'
#      ADA_ENTRYPOINT_SHA256 (plain variable, 64 hex) = sha256 of this file at the release SHA (ops/cloud-backup/README.md § 6).
# Nothing unpinned runs: this file (SHA-256), the scripts archive (SHA-256 of the release commit's tarball), the PGDG key (fingerprint), the two npm
# dependencies (versions of the release lockfile). LAB tests on node:22-bookworm-slim with synthetic data: CONTROL/v2/c7/DEBIAN_BOOTSTRAP_TEST_*.md.
# Env (besides the job's own variables, ops/cloud-backup/README.md § 3):
#   ADA_SCRIPTS_SHA      the reviewed release commit (40 hex) whose scripts run
#   ADA_SCRIPTS_SHA256   sha256 of https://codeload.github.com/Gokhangurbuz92/accesdirectaide-strasbourg/tar.gz/$ADA_SCRIPTS_SHA (pinned)
#   ADA_JOB              producer | verifier | probe-producer | probe-verifier (setup: effective bucket permissions, once)
# Evidence: the verifier prints ONE JSON line and sends the same JSON as its Healthchecks.io ping body (the durable record; the container is ephemeral).
set -eu
case "${ADA_SCRIPTS_SHA:-}" in *[!0-9a-f]*|'') echo '{"ok":false,"code":"ADA_SCRIPTS_SHA_INVALID"}'; exit 1;; esac
[ "${#ADA_SCRIPTS_SHA}" -eq 40 ] || { echo '{"ok":false,"code":"ADA_SCRIPTS_SHA_INVALID"}'; exit 1; }
# PostgreSQL 18 client from the PGDG repository. One command per line: under « set -e » a failing command inside an « a && b » list does NOT stop the
# script (LAB finding 09/11/2026). The key and list stay world-readable (apt verifies as the unprivileged _apt user), so umask 077 comes AFTER.
PGDG_FPR=B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends ca-certificates curl gnupg >/dev/null
install -d -m 0755 /usr/share/postgresql-common/pgdg
curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
chmod 0644 /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
gpg --show-keys --with-colons /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc 2>/dev/null | grep -q "^fpr:::::::::$PGDG_FPR:" \
  || { echo '{"ok":false,"code":"PGDG_KEY_FINGERPRINT_MISMATCH"}'; exit 1; }
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list
chmod 0644 /etc/apt/sources.list.d/pgdg.list
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends postgresql-client-18 >/dev/null
[ -x /usr/lib/postgresql/18/bin/pg_dump ] && [ -x /usr/lib/postgresql/18/bin/pg_restore ] || { echo '{"ok":false,"code":"PG_CLIENT_18_MISSING"}'; exit 1; }
umask 077
W=$(mktemp -d)
curl -fsSL -o "$W/src.tgz" "https://codeload.github.com/Gokhangurbuz92/accesdirectaide-strasbourg/tar.gz/$ADA_SCRIPTS_SHA"
echo "${ADA_SCRIPTS_SHA256:-none}  $W/src.tgz" | sha256sum -c --status - || { echo '{"ok":false,"code":"SCRIPTS_ARCHIVE_DIGEST_MISMATCH"}'; exit 1; }
mkdir "$W/app"
tar -xzf "$W/src.tgz" -C "$W/app" --strip-components=1 \
  --wildcards '*/scripts/db-backup.mjs' '*/scripts/db-restore.mjs' '*/scripts/db-erasure-replay.mjs' '*/scripts/cloud-backup.mjs' \
  '*/scripts/cloud-restore-verify.mjs' '*/scripts/lib/is-main.mjs' '*/scripts/lib/backup-bucket.mjs' '*/api/_services/retention-policy.js' \
  '*/drizzle/meta/_journal.json' '*/package-lock.json'
cd "$W/app"
# the two runtime dependencies, at the versions of the release's lockfile
PG_V=$(node -e "console.log(require('./package-lock.json').packages['node_modules/pg'].version)")
S3_V=$(node -e "console.log(require('./package-lock.json').packages['node_modules/@aws-sdk/client-s3'].version)")
echo '{"type":"module"}' > package.json
npm install --no-save --no-audit --no-fund --ignore-scripts "pg@$PG_V" "@aws-sdk/client-s3@$S3_V" >/dev/null 2>&1
export PG_BIN=/usr/lib/postgresql/18/bin TZ=UTC
case "${ADA_JOB:-}" in
  producer) exec node scripts/cloud-backup.mjs --run --label prod ;;
  probe-producer) exec node scripts/cloud-backup.mjs --probe-permissions --role producer ;;
  probe-verifier) exec node scripts/cloud-backup.mjs --probe-permissions --role verifier ;;
  verifier) exec node scripts/cloud-restore-verify.mjs --confirm-target "${RESTORE_CONFIRM_TARGET:?}" --expect-migrations "${RESTORE_EXPECT_MIGRATIONS:?}" ;;
  *) echo '{"ok":false,"code":"ADA_JOB_INVALID"}'; exit 1 ;;
esac
