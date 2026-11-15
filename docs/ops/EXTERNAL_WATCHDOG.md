# External watchdog (RA-04) — prepared, not activated

**State: proposal only.** `docs/ops/healthcheck.workflow.yml.proposed` is not under `.github/workflows/`, so GitHub does not run it. The documents used
to cite a `healthcheck.yml` workflow « every 30 minutes »; that file does not exist (`.github/workflows/` holds `ci.yml` only).

## Why
The in-platform health check (`/api/cron/health-alert`, hourly) cannot report its own absence: if the serverless function, the Vercel scheduler or the
deployment is down, nobody is told. An external probe closes that gap without any new service or secret.

## What the proposed workflow does
- Runs on GitHub's runners every hour at minute 12 (and on demand).
- Read-only `GET` of public pages (`/`, `/aides`, `/demarches`, `/structures`, `/sitemap.xml`) and public endpoints (`/api/health`, `/api/health/ready`,
  `/api/status`); each must answer 200 (three attempts).
- `/api/status` must not report an unavailable component (the local assistant is ignored: there is no model in Production).
- `/api/health` must carry `x-release-sha`. Comparing it with an expected SHA is **optional** and only done on a manual run that gives the SHA.
- No credential, no cron route, no administrator route, no write. `permissions: {}`.
- A failed run sends GitHub's standard e-mail to the repository owner. The repository is public: the run logs are public too — they contain paths,
  status codes and the short release SHA only.

## Decisions for the owner before activating
1. **Approve a new scheduled job** (project rule: a new schedule needs the owner).
2. **Schedule.** Minute 12 follows the health check of minute 7 on purpose: `/api/status` and `/api/health/ready` read the database, and Neon Free
   suspends its compute after five idle minutes. An independent 30-minute rhythm would wake the database about 48 times a day. GitHub may delay a
   scheduled run by several minutes under load; if the measured compute rises, drop the two database-backed endpoints from the scheduled probe.
3. **Notification address**: GitHub → Settings → Notifications → « Actions » must be on for the owner account (failed workflows only is enough).
4. **Activation**: copy the file to `.github/workflows/healthcheck.yml` and push with a token that has the `workflow` scope (as for `ci.yml`).
   GitHub disables scheduled workflows of a repository after 60 days without activity; a push re-enables them.

## Limits
It sees availability, not correctness, and at best once an hour. It does not replace `SENTRY_DSN` (still not set) nor the per-job alerts of the health
check. `scripts/ci-healthcheck.js` (an older, richer probe that also checks robots / noindex) stays available for manual runs:
`node scripts/ci-healthcheck.js https://www.accesdirectaide.fr`.
