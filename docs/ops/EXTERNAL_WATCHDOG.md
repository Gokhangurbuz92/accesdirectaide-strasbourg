# External watchdog (RA-04 / C1)

**State: installed in the repository** as `.github/workflows/healthcheck.yml` (owner Paket 4, C1 « EVET », 17/11/2026). GitHub runs it once the
file is on the default branch of the GitHub repository (a push with a token that has the `workflow` scope). It is on `main` since 17/11/2026 (workflow
registered 13:32 UTC) and has run (first scheduled run 17/11 22:16 UTC, success). GitHub → Actions → « External healthcheck » shows every run.

## Why
The in-platform health check (`/api/cron/health-alert`, hourly) cannot report its own absence: if the serverless function, the Vercel scheduler or the
deployment is down, nobody is told. The external probe closes that gap without any new service and without any stored secret.

## What it does
- Runs on GitHub's runners every hour at minute 12 (five minutes after the in-platform check, while Neon Free is still awake), and on demand.
  **Scheduled, not guaranteed.** GitHub states that the `schedule` event « can be delayed during periods of high loads » and that « some queued jobs
  may be dropped » (https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows, read 18/11/2026). Observed
  (FA-D11, `gh run list --workflow healthcheck.yml`, 18/11/2026 00:39 UTC): the workflow was registered 17/11 13:32 UTC and ran **once** in the next
  11 hours (17/11 22:16 UTC, success, every probe 200, served release 297c2b3). Treat it as « at most hourly ».
- Read-only `GET` of public pages (`/`, `/aides`, `/demarches`, `/structures`, `/sitemap.xml`) and public endpoints (`/api/health`, `/api/health/ready`,
  `/api/status`, `/api/aides?pageSize=1`); each must answer 200 (two attempts, 15 s apart, 15 s time limit each).
- `/api/status` must not report an unavailable component (the local assistant is ignored: there is no model in Production).
- `/api/health` must carry `x-release-sha`; comparing it with an expected SHA happens only on a manual run that gives the SHA.
- No credential, no secret, no cron route, no administrator route, no write. Permissions: `actions: read` only (the automatic `GITHUB_TOKEN`, to read
  this workflow's own previous runs).
- Logs (public, the repository is public): paths, status codes, public component ids and states, the short release SHA. Never a response body.

## Alerting without noise
A failed probe does not fail the run. The step « Probe failed (strike) » runs instead and counts the consecutive failed runs before it (from this
workflow's run history, up to 30 runs back). The run fails — GitHub's standard e-mail to the owner — only at the **2nd consecutive failed run**, then at
every 6th (6, 12, 18, 24, 30 runs). FA-D11: because GitHub may drop scheduled runs, the run also fails at the **1st** failed run when the previous
run is more than 2 hours old (or there is none) — otherwise « two consecutive runs » could mean a day of silence. One cold start or one network blip never alerts. If the run history cannot be read while the probe is failing, the
run fails (an alert rather than silence). After 30 consecutive failed runs no further e-mail is sent (the history window); the runs stay visible.

## Owner checks (outside the repository, not verified here)
1. GitHub → Settings → Notifications → « Actions »: notifications for failed workflows must be on for the owner account.
2. GitHub disables scheduled workflows of a repository after 60 days without activity; a push re-enables them.
3. Cost: public repository, standard GitHub-hosted runner, typically well under one minute per run.

## C5 (Upstash Free): keeping the store active
`/api/aides?pageSize=1` is public and read-only and passes the Upstash rate limiter (`SEARCH_AIDES`): one real Redis command per hour from outside the
platform, independent of the Vercel scheduler. See `docs/ops/UPSTASH_FREE.md`.

## Limits
It sees availability, not correctness, and at best once an hour. It does not replace `SENTRY_DSN` (still not set) nor the per-job alerts of the health
check. `scripts/ci-healthcheck.js` (an older, richer probe that also checks robots / noindex) stays available for manual runs:
`node scripts/ci-healthcheck.js https://www.accesdirectaide.fr`.
