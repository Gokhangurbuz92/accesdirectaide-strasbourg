# Upstash Redis on the Free plan (C5)

Owner decision (Paket 4, C5 « a », 17/11/2026): no paid plan. This page lists what the site keeps in Upstash, what is lost if the database disappears,
how the site keeps it active and notices a loss, and how to recover. Facts about the account (plan Free, region `fra1`, eviction **off**) come from the
read-only Vercel API check of 15/11/2026 recorded in the control documents; nothing here re-verified them.

## Upstash's own rules (read 17/11/2026)
- Upstash Redis FAQ, https://upstash.com/docs/redis/help/faq — « Free tier databases are archived after a minimum of 30 days of inactivity », after
  « several warning emails »; « Archival means backing up user data and removing the database instance »; data can be restored from the console into a
  **new** database (new address and token).
- Upstash Terms of Service (PDF « Last Update Date: April, 2025 », https://upstash.com/trust/terms.pdf), « Resource Inactivity »: a resource is inactive
  after **1 week** without requests on a free plan, and Upstash « may proceed with the deletion » of it. No restore is promised there.
- Pricing, https://upstash.com/docs/redis/overall/pricing — Free: 250 MB, 500K commands per month, one database. What happens when the monthly command
  limit is exceeded on Free is **not stated** on that page (UNVERIFIED).
- What counts as « activity » is not defined on these pages. This page assumes any command (read or write) counts (UNVERIFIED).

## What is stored there

| Key / prefix | Written by | Lifetime | Class | If lost |
|---|---|---|---|---|
| `ada:erasure-tombstones:v1`, `…:v1:last` | account erasure (`api/_services/erasure-tombstones.js`) | list 40 days, marker no TTL | **CRITICAL** | after a database restore, erasures done since the restored backup cannot be replayed; the replay tool refuses to run (`TOMBSTONES_INCOMPLETE`) rather than guess. In Production an erasure is refused (request stays open) while the store is unreachable. |
| `ada:mail-contact-erasure:pending:v1` | Mailjet contact deletion retries (`api/_services/mail-contact-erasure.js`) | until drained | **CRITICAL** | the numeric Mailjet contact ids waiting for a retry are gone and cannot be rebuilt (no other copy, by design no address anywhere): those contacts stay at Mailjet until a person handles them |
| `@upstash/ratelimit:*` | every rate limit (`api/_utils/rateLimit.js`) | seconds to 24 h | operational (security control) | counters restart. While the store is **unreachable**, Production refuses sign-ins, administrator API calls and every non-public action (fail-closed, 503); public reads go on |
| `rl:pro-rdv:*` (`api/_utils/pro-rdv-rate-limit.js`) | professional booking limits | minute / day | operational | counters restart |
| `reset:pro:*` (`api/_handlers/pro/auth/*`) | professional password-reset links (token hash) | 1 h | operational | the person asks for a new link |
| `cron:actualites:lock`, `pipeline:lock:*` (`api/_handlers/cron/actualites.js`, `api/_utils/pipelineLock.js`) | job locks | minutes | disposable | a lock is simply free |
| `alert:cooldown:*`, `alert:log`, `health-alert:*` | health check | 1 h to 400 days | disposable | an alert may be sent once more; the admin alert history and « first expected » times restart |
| `search:*`, `app:logs`, `at-connector:next-url` | search cache, log ring, ingestion cursor | 5 min to 30 days | disposable | cache miss; the ingestion restarts from page 1 |
| `ada:kv-sentinel:v1` | health check (C5) | no TTL | detection | its absence while the run record remembers it **is** the loss signal |

## Keeping the database active
Two independent hourly paths send real commands:
1. the in-platform health check (`/api/cron/health-alert`, minute 7, open in Production) — SET/GET of `health-alert:ping` and the sentinel read;
2. the external watchdog (`.github/workflows/healthcheck.yml`, minute 12) — `GET /api/aides?pageSize=1`, a public read that passes the rate limiter.
Either alone is far inside the 1-week clause. Both stop only if the site itself is down for a week (then the watchdog has alerted for days) or if both
the Vercel scheduler and GitHub's schedule stop (GitHub disables a schedule after 60 days without repository activity). Cost: about 2 × 24 × 31 ≈ 1,500
commands a month for keep-alive, against 500K.

## Noticing a loss
- unreachable store → `kv.down` (existing check 2 of the health check);
- store answers but its data are gone → `kv.data_lost` (check 2b, C5): the sentinel key has no TTL and its creation time is copied into the health
  check's run record in Postgres; sentinel missing while Postgres remembers it ⇒ alert once, sentinel rewritten. Alerts go through the existing channels
  (`ALERT_EMAIL` / `ALERT_WEBHOOK_URL`, the admin alert log).

## Reprise (recovery), owner actions
1. Upstash console: if the database was **archived**, restore the backup into a new database (FAQ). The new database has a new address and token.
2. Vercel: replace `KV_REST_API_URL` / `KV_REST_API_TOKEN` (and their `UPSTASH_*` aliases if set), then redeploy (an environment change needs a
   redeploy). Never paste the token anywhere else.
3. If no backup exists (deleted under the 1-week clause): the tombstones and the retry list are lost.
   - Tombstones: take a fresh, verified database backup at once (K3), so that the newest backup carries every erasure in its ledger; do not restore an
     older backup without replaying the erasures recorded in a newer one (`scripts/db-erasure-replay.mjs` refuses to run on an incomplete list).
   - Mailjet retry list: the pending contact ids are unknown; ask the owner to review recent erasures with Mailjet support (human intervention).
4. The next hourly health check is green once the sentinel is back.

## Second copy of the erasure tombstones (D5 b, 17/11/2026)
Owner decision D5 b: the tombstones also go, encrypted (AES-256-GCM), to a dedicated Cloudflare R2 EU bucket of the K3 object storage
(`api/_services/erasure-tombstone-copy.js`, variables `TOMBSTONE_COPY_*`, owner setup `CONTROL/v2/k3_tombstone_key_setup.sh`). Off until those
variables are set. When on: an erasure is refused only if both stores fail; a copy failure raises `tombstone_copy.write_failed`; the restore reads both
and refuses an unexplained disagreement, including a complete Upstash loss, unless the operator records `--accept-single-copy` (`docs/ops/RPO_RTO.md` § 3).
Not operationally complete before the genuine recovery test of `docs/ops/RPO_RTO.md` § 4.

## What is not solved on Free
See `CONTROL/master/completion/C5_UPSTASH_FREE_RISK.md` (outside the repository): the Mailjet retry list has no second copy, the tombstones have one
only once D5 b is activated, and the 1-week deletion clause promises no restore. Moving the Mailjet retry list to Postgres needs a new migration (0050+), not done here.
