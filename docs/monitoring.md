# Monitoring Strategy

## Overview
The platform exposes several health and monitoring endpoints that are used by the operations team and automated alerting systems.

| Endpoint | Description | Last Check |
|----------|-------------|------------|
| `/api/health` | Basic health check – returns service status. | ✅ OK (2026-03-24) |
| `/api/monitor/core` | Core dependencies health (DB, KV store). | ✅ OK (2026-03-24) |
| `/api/monitor/cron/actualites` | Cron job status for *actualités* ingestion. | ✅ fresh (2026-03-24) |
| `/api/monitor/data-quality` | Data quality metrics (open tickets). | ✅ 0 open (2026-03-24) |
| `/api/monitor/ingestion-freshness` | Freshness of data ingestion pipelines. | ✅ OK |
| `/api/monitor/pro-rdv` | Monitoring for professional appointment system. | ✅ OK |

## Security Headers

Verified on production (`www.accesdirectaide.fr`) — 2026-03-24 :

| Header | Value | Status |
|--------|-------|--------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | ✅ |
| `X-Content-Type-Options` | `nosniff` | ✅ |
| `X-Frame-Options` | `DENY` | ✅ |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' …` | ✅ |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | ✅ |
| `Permissions-Policy` | `camera=(self), microphone=(self), geolocation=()…` | ✅ |

## Alerting
> Updated 15/11/2026 against the code. The « Last Check » and « Verified » columns above are dated observations of 24/03/2026, not live status.

- **Sentry** captures exceptions only when `SENTRY_DSN` is set (EU region). Without it the client is a no-op and errors go to the function logs only.
- **Health alerts**: `/api/cron/health-alert` runs **once an hour** (minute 7, `vercel.json`). It checks the database, KV (unreachable: `kv.down`; reachable but emptied — e.g. an Upstash Free database archived and recreated: `kv.data_lost`, C5, `docs/ops/UPSTASH_FREE.md`), each scheduled job on its own
  (`job.failed.<job>`, `job.stale.<job>`), the automatic veille (`veille.stale`), the review queue, mail delivery events and the security signals, and
  sends each alert at most once an hour to `ALERT_WEBHOOK_URL` (any https webhook) and/or by e-mail to `ALERT_EMAIL` through the site's mail provider.
  Every run leaves a `CronRun` row and one summary log line; a check that cannot run is logged.
- **External watchdog** (C1): `.github/workflows/healthcheck.yml`, hourly public read-only probes from GitHub's runners; it alerts at the 2nd consecutive
  failed run (`docs/ops/EXTERNAL_WATCHDOG.md`). It runs only once pushed to GitHub.
- **Thresholds**:
  - `data-quality` open tickets must stay below `openTotalMax = 500`.
  - Scheduled jobs: twice the schedule interval + 1 h (`api/_services/job-watch.js`).
  - Security signals: `ALERT_FAILED_LOGIN_BURST` (30), `ALERT_MFA_FAILURE_BURST` (10) per 70-minute window; `ALERT_EXPORT_BURST` (20), `ALERT_EXPORT_PER_ACTOR` (8) per hour.

## Incident Response
1. Verify `/api/health` and `/api/monitor/core`.
2. Check individual cron endpoints for freshness.
3. If a service is down, inspect logs in Sentry and Vercel deployments.
4. Restart the affected Vercel function via the dashboard or redeploy the latest build.
5. Document the incident. An incident touching personal data goes into the breach register kept outside this repository (`docs/runbooks.md` § 12, validator `scripts/incident-register-validate.mjs`); procedures per case are in `docs/runbooks.md`.

## Rate Limiting

Implémenté via Upstash KV (prod) / mémoire (test). Double rate limit IP + clé par action.

| Action | Limite | Fenêtre | Endpoints protégés |
|--------|--------|---------|-------------------|
| `LOGIN_USER` | 8 req | 15 min | `/api/auth/login` |
| `SIGNUP_USER` | 5 req | 1h | `/api/auth/signup` |
| `FORGOT_USER` | 5 req | 1h | `/api/auth/forgot-password` |
| `RESET_PASSWORD` | 3 req | 1h | `/api/auth/reset-password` |
| `ASSISTANT_CHAT` | 10 req | 1 min | `/api/assistant/chat` |
| `ASSISTANT_RECOS` | 15 req | 1 min | `/api/assistant/recommendations` |
| `DIAGNOSTIC` | 30 req | 1 min | `/api/diagnostic` |
| `ADMIN_API` | 60 req | 1 min | `/api/admin/*` |
| `RDV_PUBLIC_READ` | 60 req | 1 min | `/api/rdv` (lecture) |

**50+ fichiers** utilisent `checkRateLimit`. Voir `api/_utils/rateLimit.js` pour la config complète.

## SEO

Vérifié en production — 2026-03-24 :

| Check | Status | Détails |
|-------|--------|---------|
| `robots.txt` | ✅ | Allow: / · Disallow: /admin, /api/ |
| `sitemap.xml` | ✅ | 2 URLs (/, /aides) |
| HTTP → HTTPS | ✅ | 308 Permanent Redirect |
| www redirect | ✅ | `accesdirectaide.fr` → `www.accesdirectaide.fr` (308) |
| Meta tags | ✅ | OG, Twitter Cards, JSON-LD |
| Canonical URL | ✅ | `<link rel="canonical">` |

## Response Times (production)

Mesuré le 2026-03-24 :

| Endpoint | Temps |
|----------|-------|
| `GET /api/health` | ~87ms |
| `GET /api/monitor/core` | ~851ms (includes DB + KV check) |

## Error Pages

| Scénario | Réponse |
|----------|---------|
| API route inexistante | `{"error":"Not Found"}` (JSON) |
| Page inexistante | SPA client-side (200 + React Router) |

## Contacts
- **On‑call Engineer**: `<adresse de garde de l’association, à définir>`
- **Alerts**: the channel configured in `ALERT_WEBHOOK_URL` and/or the mailbox in `ALERT_EMAIL` (no Slack workspace exists; Sentry only when `SENTRY_DSN` is set)
- **Vercel Dashboard**: <https://vercel.com/dashboard>
