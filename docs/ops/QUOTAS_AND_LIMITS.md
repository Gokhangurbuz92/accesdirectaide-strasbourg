# Provider quotas, expected load and abuse protection (FA-D11, 18/11/2026)

Official pages were read on **18/11/2026** unless stated. « Expected » figures are estimates from the code and the schedules, not measurements of
provider usage: the provider consoles are the only source of real usage (owner checks at the end). Nothing here is a spending cap.

## 1. Quotas against expected load

| Provider (plan) | Official limit (source) | Expected use (basis) | Headroom / risk |
|---|---|---|---|
| Vercel (Pro, active since 21/01/2026) | $20 monthly usage credit; Flat Rate CDN tier: 1 million CDN requests and 1 TB transfer a month; spend notifications at 75 % of the credit, default spend alert $200 (https://vercel.com/docs/plans/pro-plan, « last_updated 2026-09-15 »). Cron jobs: 100 per project, per-minute precision on Pro (https://vercel.com/docs/cron-jobs/usage-and-pricing, « last_updated 2026-07-15 »). Runtime logs: 1 day without Observability Plus (CLI refusal « The pro plan does not retain runtime logs for the requested time range » for 24 h, 18/11/2026) | 11 cron entries (`vercel.json`), ≈ 1,100 cron invocations a month (health-alert 744, veille 186, actualites 124, daily jobs 31 each, weekly 4–5) + the watchdog's 9 GETs per run | cron count far inside; function / CDN usage: **not measured** (owner: Vercel → Usage). Logs older than 1 day are gone: incident evidence must be captured the same day |
| Neon (Free) | 1 GB storage per project; 100 CU-hours per project per month; history (instant restore) up to 6 h / 1 GB of changes; suspends after 5 min idle; 10 branches; **egress 5 GB per project per month**; over the CU-hours or egress allowance « Compute is suspended until the next billing period » and connections fail « including `pg_dump` » (https://neon.com/docs/introduction/plans, « last updated 2026-11-12 ») | storage: encrypted dump 14.6 MB (17/11) — LAB ratio ≈ 5 : 1 ⇒ database ≈ 80 MB (~8 % of 1 GB). Compute: the hourly health check (minute 7) and the watchdog (minute 12) wake the compute ~24×/day for ≥ 10 min ⇒ ≈ 4 h/day; at 0.25 CU (ASSUMPTION: minimum size not read) ≈ 30 CU-h/month + traffic. **Egress: each K3 backup reads the whole database** — LAB plain dump of the Production-like database = 48.5 MB ⇒ 2 backups/day × 30 ≈ **2.9 GB/month (~58 % of 5 GB) before any citizen traffic** | **Tightest quota.** Exceeding egress or CU-hours suspends Production AND stops the backups until the next period. Owner: Neon → Usage (network transfer, CU-hours). Options (owner decision): one backup a day (RPO 24 h then has no margin for a failed run), or a paid plan |
| Upstash Redis (Free) | 250 MB, 500K commands/month, 10 GB bandwidth/month (https://upstash.com/docs/redis/overall/pricing, no date shown); Free behaviour beyond the command limit **not stated** on that page; archive after ≥ 30 days inactivity (FAQ, read 17/11/2026) | keep-alive ≈ 1,500 commands/month (`UPSTASH_FREE.md`); each rate-limited public request costs ≥ 1 command (sliding window = one script call; `/api/search` adds a cache GET/SET) ⇒ ≈ 170K–500K public API requests/month fit | Real launch traffic or a distributed flood can exhaust 500K. When Upstash refuses, Production **fails closed** for sign-ins, administration and every non-public action (503), public reads go on (`docs/runbooks.md` § 3). Owner: Upstash console → « Commands » this month |
| Mailjet (Free, owner-confirmed 17/11/2026) | 200 e-mails/day, 6,000/month, 1,000 contacts (https://www.mailjet.com/pricing/) | narrow 6B: account verification, password reset and DSR e-mails; ALERT_EMAIL (one per alert per hour) | 200/day is the binding limit: every sign-up sends at least one verification e-mail ⇒ fewer than 200 sign-ups a day saturate it; alerts compete with citizen mail. Alerts also go to the webhook (Healthchecks), which does not use Mailjet |
| Cloudflare R2 (paid plan, free tier) | 10 GB-month storage, 1M Class A, 10M Class B, free egress (https://developers.cloudflare.com/r2/pricing/, read 17/11/2026) | 2 dumps/day × 35 days × 14.6 MB ≈ 1 GB; ≈ 200 Class A/month | inside; no spending cap |
| GitHub Actions | standard GitHub-hosted runners free in public repositories (https://docs.github.com/en/billing/concepts/product-billing/github-actions); schedule « can be delayed … some queued jobs may be dropped », shortest interval 5 min, schedules disabled after 60 days without activity in a public repository (https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) | CI per push + watchdog ≤ 744 runs/month | cost 0; reliability best effort (1 run in 11 h observed 17/11) |
| Healthchecks.io (Hobbyist) | 20 checks, 100 log entries per check (https://healthchecks.io/pricing/) | 3 checks (producer, verifier, ada-ops-alerts) | inside |

## 2. Abuse protection inventory (code, 46afa53)

- **Per-action rate limits** (`api/_utils/rateLimit.js`, Upstash sliding window, key = action + IP or account): sign-in 8/15 min, sign-up 5/h,
  password reset 3–5/h, OTP 3–5/min, professional login 5/15 min, MFA 3–5 per 5–15 min, contact form 5/h, DSR export 10/h, public search 30/min,
  structures 30/min, resources 60/min, taxonomy 60/min, territory 60/min, translations 120/min, CSP reports 20/min, assistant 10–15/min, messaging
  10–120 per 1–5 min, booking 10/h. Administrator API: global limit `ADMIN_API` (`api/index.js`). Professional booking: `api/_utils/pro-rdv-rate-limit.js`.
- **When Upstash is unreachable**: fail-closed in Production for authentication, administration and non-public writes; public reads continue
  (`tests/unit/rateLimit-degradation.test.js`).
- **Denied requests**: `@upstash/ratelimit` 2.0.8 keeps an in-memory cache of blocked identifiers per warm instance (default `ephemeralCache`), so a
  single blocked IP stops costing commands on that instance; a distributed flood still does.
- **Not in place** (classified, not implemented here): no edge / firewall rate limit in front of the functions (Vercel Firewall rules are a separate
  product decision); no global per-day cap that protects the Upstash monthly quota or the Mailjet daily quota from one abusive actor; no error
  tracking (`SENTRY_DSN` unset) — 5xx bursts are visible only in the 1-day logs and the hourly health check.

## 3. Owner console checks (read only, ~10 minutes, no secret shared)

1. Neon → project → Usage: network transfer and CU-hours this month (compare with § 1; > 60 % by mid-month = act).
2. Upstash → database → Usage: commands this month; Configuration: eviction **off**.
3. Vercel → Usage: function invocations / CDN requests vs the included credit; Settings → Billing: spend alert amount.
4. Mailjet → Statistics: sends per day (200 limit).
5. GitHub → Settings → Notifications → Actions: failed-workflow e-mails on.
