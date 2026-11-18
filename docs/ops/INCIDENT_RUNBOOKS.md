# Incident runbooks — six scenarios with explicit owner actions (FA-D11, 18/11/2026)

No secret, token, URL with a key or physical address belongs in this file or in any incident note. « Owner » = the only person with console access
(Vercel, Neon, Upstash, Cloudflare, Scaleway, Mailjet, GitHub, Healthchecks). There is **no second operator and no on-call fallback** today: when the
owner is unreachable, every step marked OWNER waits, and the RTO of one business day (`RPO_RTO.md`) is not met.

Common to every scenario:
- **Detect**: GitHub « External healthcheck » failure e-mail (`EXTERNAL_WATCHDOG.md`), Healthchecks e-mails (backup producer, restore verifier,
  `ada-ops-alerts` = health-check webhook), admin alert log, provider status pages.
- **Freeze if data are at risk**: `MAINTENANCE_MODE=1` in Vercel + redeploy the same SHA (`docs/runbooks.md` § 1) — OWNER.
- **Record**: incident register outside the repository (`docs/runbooks.md` § 12). Personal data lost, exposed or unavailable ⇒ the 72-hour CNIL
  assessment starts at awareness — OWNER decides and writes the reason.
- **Evidence the same day**: Vercel keeps runtime logs **1 day** (no Observability Plus): export what matters before it expires (counts, paths, times —
  no personal data).

## R1. Database loss or corruption (Neon)

| # | Action | Who |
|---|---|---|
| 1 | Confirm: `/api/health/ready` 503 / alert `db.down`; Neon status page; was it a bad write (< 6 h ago) or a lost project? | Claude/ops (read only) |
| 2 | Freeze writes (maintenance or close the citizen surfaces), redeploy | OWNER |
| 3a | Incident < 6 h old and project intact: Neon console → restore to a time before the incident **into a new branch** (`docs/disaster-recovery.md`) | OWNER |
| 3b | Otherwise: new empty Neon database; K3 restore with signatures (`cloud-restore-verify.mjs --keep-restored`, `docs/runbooks.md` § 9) | OWNER (keys on the owner's machine) |
| 4 | `db-deploy-migrate.mjs --check` on the copy: 51 history rows expected since 17/11/2026 | ops |
| 5 | Erasure replay **always** (also after a Neon branch): dry run, then `--execute` with `--kv` (+ `TOMBSTONE_COPY_*` once D5 b is on). If it refuses (`TOMBSTONES_INCOMPLETE`): stop; the decision to proceed with `--accept-single-copy` or `--no-tombstones` is the owner's, written in the register | ops + OWNER decision |
| 6 | Retention purge re-run on the copy (step 6c) | ops |
| 7 | Point Vercel `DATABASE_URL*` at the copy, redeploy, `/api/health/ready`, smoke tests, reopen | OWNER |
| 8 | Next K3 backup must succeed (Healthchecks green) before closing the incident | OWNER (check) |

Measured: technical restore path ≈ 3 s (LAB, Production-like size) and 25 s for the real 10.5 MB K3 restore of 12/11/2026 (`RPO_RTO.md` § 6).

## R2. Upstash loss (store unreachable, emptied, archived or deleted)

| # | Action | Who |
|---|---|---|
| 1 | Alert `kv.down` (unreachable) or `kv.data_lost` (sentinel gone). Production already fails closed for sign-ins, administration and non-public writes; public pages keep working | automatic |
| 2 | Upstash console: archived ⇒ restore the backup into a **new** database (new address and token) | OWNER |
| 3 | Vercel: replace `KV_REST_API_URL` / `KV_REST_API_TOKEN` (and `UPSTASH_*` aliases if set), redeploy | OWNER |
| 4 | Data deleted for good: take a fresh K3 backup at once (its ledger then carries every erasure); never restore an older backup without the replay; Mailjet retry list lost ⇒ review recent erasures with Mailjet (human) | OWNER |
| 5 | Next hourly health check green (sentinel rewritten) | automatic |

Detail and data classes: `UPSTASH_FREE.md`. LAB proof of detection: `tests/integration/c5-kv-data-loss-db.test.js` (PASS 18/11/2026).

## R3. Mailjet outage or quota reached (Free: 200/day)

| # | Action | Who |
|---|---|---|
| 1 | Symptoms: mails recorded `NOT_SENT` / `NOT_DELIVERED`, alert e-mails missing; Mailjet status page and Statistics (daily count) | OWNER (console) |
| 2 | Nothing is reported as sent when it was not (`docs/runbooks.md` § 8); screens that wait for an e-mail say so. Operational alerts still reach Healthchecks through the webhook | automatic |
| 3 | Quota reached: wait for the daily reset, or pause sign-ups (close the accounts surface) if verification mails pile up | OWNER |
| 4 | Contact deletions that failed stay in the retry list (Upstash) and are retried; never announce a deletion that failed | automatic |
| 5 | Prolonged outage: decide a provider change (`MAILER_PROVIDER`) — a legal-notice change (processor list) needs a new approved version | OWNER decision |

## R4. Vercel outage (platform, region fra1, or the deployment)

| # | Action | Who |
|---|---|---|
| 1 | Watchdog failure e-mail; in-platform health check silent; https://www.vercel-status.com | automatic / OWNER |
| 2 | Platform outage: nothing to deploy elsewhere (no second host is set up); wait, keep the incident record; backups (Scaleway → Neon) continue independently | OWNER |
| 3 | Our deployment broken (platform fine): R6 rollback | OWNER |
| 4 | After recovery: check that the hourly health check resumed (`/admin/sync`), and that no cron window was missed beyond its alert threshold | ops |

## R5. Secret leak (a key or token seen where it must not be)

| # | Action | Who |
|---|---|---|
| 1 | Identify **which** secret by name only; never paste the value into a chat, issue, commit or log | anyone |
| 2 | Revoke / regenerate at the provider (Neon role password, Upstash token, Mailjet key, Cloudflare R2 token, Scaleway key, GitHub token, `JWT_SECRET`, `CRON_SECRET`, `ADA_ENCRYPTION_KEY` — the latter only with the key-rotation procedure, `docs/runbooks.md` § 5, or stored data become unreadable) | OWNER |
| 3 | Update the Vercel variable (or Scaleway secret for K3) and redeploy (a variable change needs a redeploy) | OWNER |
| 4 | Repository: if committed, the public history keeps it — rotation is the fix, history rewriting is not; run gitleaks on the range | OWNER + Claude |
| 5 | Review the provider's access logs for use of the leaked value; personal data reachable ⇒ register + 72-hour assessment | OWNER |
| 6 | Backup keys (K3): the recovery directory stays offline on the owner's machine; a leaked backup **private** key ⇒ new key pair, new backups, old ones deleted when the 30-day lock expires | OWNER |

## R6. Bad release

| # | Action | Who |
|---|---|---|
| 1 | Detected at release: `scripts/release-production.sh` rolls back automatically on a failed smoke test (exit 4) or prints the rollback command (exit 5) | automatic |
| 2 | Detected later: Vercel → Deployments → previous production → « Promote to Production », or `vercel rollback <previous deployment> --yes`; check `x-release-sha` on `/api/health` | OWNER |
| 3 | Current rollback target (18/11/2026): Y2 = deployment `atcltkk8i`; previous production `f4l4sso33` (Y, 5c78c71), Ready (`vercel inspect`, read only) | — |
| 4 | A code rollback never undoes a migration; the environment of the old build is its own (variables changed since apply only at the next deploy) | — |
| 5 | Fix forward on a branch → QA of the exact SHA → owner approval of that SHA → release | Claude + OWNER approval |
