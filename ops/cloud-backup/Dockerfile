# V2 C7 — image of the cloud backup jobs (producer: scripts/cloud-backup.mjs; verifier: scripts/cloud-restore-verify.mjs).
# Holds NO secret: every credential is injected by the job runtime (Scaleway Secret Manager). Build for linux/amd64, push to a PRIVATE registry
# in the same region (Scaleway Container Registry fr-par). Rebuild only from a reviewed commit; the image digest is pinned in the job definition.
FROM node:22-bookworm-slim
ARG PG_MAJOR=18
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates curl gnupg >/dev/null \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update -qq && apt-get install -y -qq --no-install-recommends postgresql-client-${PG_MAJOR} >/dev/null \
 && apt-get purge -y -qq curl gnupg >/dev/null && apt-get autoremove -y -qq >/dev/null && rm -rf /var/lib/apt/lists/*
ENV PG_BIN=/usr/lib/postgresql/${PG_MAJOR}/bin NODE_ENV=production TZ=UTC
WORKDIR /app
# only what the jobs run: the backup scripts, the retention policy they read, the migration journal (expected count), and their dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null && npm cache clean --force >/dev/null
COPY scripts/db-backup.mjs scripts/db-restore.mjs scripts/db-erasure-replay.mjs scripts/cloud-backup.mjs scripts/cloud-restore-verify.mjs scripts/
COPY scripts/lib/is-main.mjs scripts/lib/backup-bucket.mjs scripts/lib/
COPY api/_services/retention-policy.js api/_services/
COPY drizzle/meta/_journal.json drizzle/meta/
USER node
# default: the producer. The verifier job overrides the command (see scaleway-jobs.md).
CMD ["node", "scripts/cloud-backup.mjs", "--run", "--label", "prod"]
