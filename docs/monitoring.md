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
- **Sentry** is configured to capture uncaught exceptions and performance issues. Alerts are routed to the Slack channel defined in `ALERT_WEBHOOK_URL`.
- **Health alerts**: a cron (`/api/cron/health-alert`) runs every 5 minutes and triggers a Slack alert if any of the above endpoints return a non‑200 response.
- **Thresholds**:
  - `data-quality` open tickets must stay below `openTotalMax = 500`.
  - Cron job freshness: if `ageMinutes` exceeds `failMinutes` (1440 min) an alert is raised.

## Incident Response
1. Verify `/api/health` and `/api/monitor/core`.
2. Check individual cron endpoints for freshness.
3. If a service is down, inspect logs in Sentry and Vercel deployments.
4. Restart the affected Vercel function via the dashboard or redeploy the latest build.
5. Document the incident in `docs/incidents.md` with timestamps, root cause, and remediation steps.

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
- **Sentry Alerts**: `#alerts` Slack channel
- **Vercel Dashboard**: <https://vercel.com/dashboard>
