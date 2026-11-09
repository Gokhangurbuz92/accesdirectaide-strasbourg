# Cloud-only backups of the Production database (V2 C7)

Status: **LAB-verified (incl. the Debian job image, 09/11/2026), not provisioned.** Nothing here runs until the owner approves the activation package
(`STRASBOURG_FULL_PRODUCT_PLAN/CONTROL/v2/C7_BULUT_YEDEK_YETKI_PAKETI_TR.md`). No step depends on the owner's computer.

## 1. Architecture

```
Neon (PG 18, Frankfurt) ──read-only role──► PRODUCER job (Scaleway Serverless Jobs, fr-par, cron 2×/day)
                                              pg_dump 18 → ADAB2 (RSA-4096 public key + AES-256-GCM) → erasure ledger (ADAB2)
                                              → PUT to R2 bucket (EU jurisdiction) → HEAD confirm → ping Healthchecks
R2 bucket « ada-db-backups » (EU) : lifecycle 35 days (deletion within ~24 h after) · Bucket Lock 30 days (age) · objects: dump, .sha256, ledger
VERIFIER job (separate job + separate token, monthly)  ─read-only token─► newest dump → private key → empty disposable DB (wiped at the end)
                                              → structure / migration / ledger checks → evidence JSON (counts only) → ping Healthchecks
Healthchecks.io : 2 checks (producer every 12 h, grace 3 h; verifier monthly, grace 2 days) → e-mail to the owner
```

| Who holds what | Producer | Verifier | Owner (offline, password manager) |
|---|---|---|---|
| Neon read-only connection | yes | **no** (refused if present) | — |
| Backup public key | yes | — | copy |
| Backup private key + passphrase | **no** (refused if present) | yes (Secret Manager of a separate job) | **yes** (recovery copy) |
| R2 token | **Object Read & Write**, scoped to this bucket only (it can read, list, write and delete objects) | **Object Read only**, this bucket only | Cloudflare account |
| Cloud API key (Scaleway, AWS…) | **none** (refused if present) | none | console |
| Scaleway project | `ada-backup` (producer job + its secrets) | `ada-restore-verify` (**separate project**: verifier job + private key) | both |

« Object Read & Write » is **not** write-only: a stolen producer token can add, list, download and delete objects. What it cannot do: decrypt (no private key
anywhere in the producer project) and delete or overwrite an object younger than 30 days (Bucket Lock on the whole bucket, shorter than the 35-day
lifecycle so the lifecycle can always delete). R2 has no write-only permission. The endpoint must be the EU-jurisdiction one (enforced by the code:
`BUCKET_ENDPOINT_NOT_EU_JURISDICTION`); a jurisdictional bucket is reachable only there.

Isolation of the producer: a Serverless Job receives only the secrets referenced in its own definition, and the producer holds no cloud API key
(enforced: `CLOUD_API_KEY_PRESENT_IN_PRODUCER`), so its execution cannot call Secret Manager; the verifier's secrets also live in another project.
**Effective permissions are checked at setup** by `--probe-permissions` (§ 3), inside each job, with the real tokens.

## 2. Costs (sources read 2026-11-09) — an ESTIMATE, not a cap

| Item | Price / allowance | Expected use | Expected cost |
|---|---|---|---|
| Cloudflare R2 Standard (purchase of the R2 plan + payment method required before any token) | 10 GB-month, 1 M class A, 10 M class B free; then 0.015 $/GB-month, 4.50 $/M class A, 0.36 $/M class B; egress free; DeleteObject free | ~70 objects (35 days × 2) + probes; a few hundred class A ops/month | **0 $** while dumps stay < ~140 MB; 1 GB dumps ≈ 0.90 $/month |
| Scaleway Serverless Jobs | 200 000 vCPU-s and 400 000 GB-s free per month; then 0.0000100 €/vCPU-s, 0.0000020 €/GB-s | 60 producer runs + 1 verifier run, ~1–3 min each at 1 vCPU / 2 GB | **0 €** |
| Scaleway Secret Manager | 0.04 €/secret version/month; 0.03 €/10 000 accesses | ~12 secret versions (4 producer, 6 verifier, + the startup script `job-entrypoint.sh` once in each project) | **≈ 0.48 €/month** |
| Container registry | public `docker.io/library/node:22-bookworm-slim`, no private registry | — | **0 €** (if Docker Hub limits block pulls: Scaleway Container Registry, price to be read then) |
| Healthchecks.io Hobbyist | 0 $, 20 checks | 2 checks, e-mail notifications to the owner | **0 $** |
| Neon (read-only role; separate empty `ada-restore-check` project) | Free plan | — | **0 €** (Free-plan project limit not re-verified) |

**Expected total ≈ 0.50 €/month** (≈ 0.04 € more for a few days at each release, while the old script version is still kept). None of these providers offers a hard spending cap on these plans: Scaleway has **billing alerts**
(e-mail/SMS/webhook at a threshold of a budget), which notify but do not stop spending; Cloudflare R2 bills usage beyond the free tier. Cost is bounded
**by design**: fixed schedule, job timeout 30 min and 1 vCPU / 2 GB set in the job definition, no parallel manual runs, objects deleted by the lifecycle at 35 days. Worst case if every
scheduled run hit the 30-min limit: 61 × 1 800 vCPU-s = 109 800 vCPU-s, still inside the free allowance. Set a Scaleway billing alert at 5 € (budget) and
a Cloudflare billing notification if offered on the account.

## 3. Variables (names only)

Producer job: `DATABASE_URL` (read-only role, **unpooled** host, `sslmode=require`), `BACKUP_PUBLIC_KEY`, `BACKUP_S3_ENDPOINT`
(`https://<account id>.eu.r2.cloudflarestorage.com`), `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`,
`BACKUP_HEALTHCHECK_URL`, optional `BACKUP_MAX_AGE_HOURS` (36).
Verifier job (separate Scaleway project): `TARGET_DATABASE_URL` (empty disposable database in the separate Neon project `ada-restore-check`), `BACKUP_PRIVATE_KEY_FILE` (mounted secret file), `BACKUP_PRIVATE_KEY_PASSPHRASE`,
the four `BACKUP_S3_*` with the **read-only** token, `RESTORE_HEALTHCHECK_URL`. Command:
`node scripts/cloud-restore-verify.mjs --confirm-target <host>/<database> --expect-migrations 43` (43 = history rows of a database at 0042; 44 after 0045).

`node scripts/cloud-backup.mjs --check-config` lists missing or invalid variables by name (never a value).

**Startup (stock image, no build, no multiline environment variable).** Scaleway's docs (GitHub `scaleway/docs-content`, read 2026-11-09): variables or
secrets spread over several lines « will not be injected properly » (troubleshooting/cannot-inject-secret-variable); for complex commands, store the
script as a secret, inject it **as a file** and call it at startup (how-to/execute-complex-commands). The earlier `ADA_ENTRYPOINT` variable + `eval`
design is withdrawn. API `jobs/v1alpha2` (`command` is deprecated there). Per job:
1. Secret Manager (same project and region as the job): secret `ada-job-entrypoint`, one version = the bytes of `ops/cloud-backup/job-entrypoint.sh`
   at the release SHA (LF line endings, ~5 KB). Not a credential; stored there only to be mounted.
2. Job → Secret references → that secret, **the explicit version number** (`secret_manager_version`; « latest » not used), method **File**
   (`path` = `/ada/job-entrypoint.sh`). Secret limit 64 KB; at most 20 references per job; same region as the job.
3. Plain variable `ADA_ENTRYPOINT_SHA256` = `sha256sum ops/cloud-backup/job-entrypoint.sh` at the release SHA (64 hex), next to `ADA_SCRIPTS_SHA` and
   `ADA_SCRIPTS_SHA256`.
4. `startup_command` = `["/bin/sh", "-c"]` and `args` = one element, this line (no `$(…)`, which Scaleway would interpolate itself):
   `/bin/sh -c 'echo "$ADA_ENTRYPOINT_SHA256  /ada/job-entrypoint.sh" | sha256sum -c --status - && exec /bin/sh /ada/job-entrypoint.sh || { echo "{\"ok\":false,\"code\":\"ENTRYPOINT_DIGEST_MISMATCH\"}"; exit 1; }'`
   A mounted file that differs from the reviewed one by a single byte is refused before anything runs.

**Evidence (verifier).** The job's container is ephemeral: nothing written inside it survives. The verifier prints one JSON line (job log) and sends
**the same JSON** as the body of its Healthchecks.io ping (success and failure). Cockpit keeps job logs only 7 days free and the job-run history
60 days, so the ping body, kept in the check's event log, is the durable record (copy it within days of the run; Healthchecks changed its ping-log
retention wording on 2026-11-09, re-read it at activation): the owner copies it to `CONTROL/v2/c7/EVIDENCE_<date>.json`, then `node scripts/check-restore-evidence.mjs <file>` accepts it only if
`ok`, `wiped: true`, migrations equal to the expected count, sidecar and object digest checked, core tables present and the erasure replay done; it
refuses any field other than counts, codes, digests and object names. Independent cross-checks (no secret): `dump` and `encryptedBytes` against the
R2 object list, `dumpSha256` against the `<dump>.sha256` sidecar, `verifiedAt` against the Healthchecks event time and the Scaleway run history.

Setup, once per job, before the first real backup: `ADA_JOB=probe-producer` / `probe-verifier`
→ `node scripts/cloud-backup.mjs --probe-permissions --role producer|verifier` (expected: producer put + read allowed, delete of the fresh probe refused
by the lock, list buckets refused; verifier put refused). It leaves one tiny `probe/…txt` object (no personal data), deleted by the lifecycle.

## 4. Neon read-only role (SQL, run by the owner in the Neon SQL editor)

```sql
CREATE ROLE ada_backup_ro LOGIN PASSWORD '<generated in the password manager>';
GRANT CONNECT ON DATABASE neondb TO ada_backup_ro;
GRANT USAGE ON SCHEMA public, drizzle TO ada_backup_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public, drizzle TO ada_backup_ro;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, drizzle TO ada_backup_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ada_backup_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO ada_backup_ro;
```
(or `GRANT pg_read_all_data TO ada_backup_ro;` if the Neon console allows it — not verified on Free). The role cannot write (LAB: a DELETE by the role
→ `permission denied`). Creating this role is an **administrative change** to the Production database (a new login), authorised separately; the backup
itself never modifies Production application data. The restore check writes only into the disposable database, which it empties at the end.

## 5. RPO / RTO — targets, NOT yet verified operationally

- **RPO** (data that can be lost), target: ≤ 12 h with two runs a day; ≤ 6 h for incidents noticed within Neon's own restore window (Free plan: 6 h).
- **RTO** (time to be back), target: ~2 h (never rehearsed on Production) — new Neon project or branch, restore of the newest dump (minutes for < 1 GB), erasure replay, migration check,
  Vercel variable switch and redeploy.

## 6. Disaster recovery (summary — full Turkish procedure in the activation package)

1. Freeze writes: close the citizen surfaces (Vercel variable) and redeploy.
2. New empty Neon database. Download the newest dump and its ledger from R2 (owner's Cloudflare account).
3. `db-restore.mjs` with the private key (owner's recovery copy) → `db-deploy-migrate.mjs --check` → `db-erasure-replay.mjs` dry run then `--execute`.
4. Point Vercel at the restored database, redeploy, re-run the retention purge, check `/api/health`.
5. Record the incident (GDPR art. 33 assessment within 72 h if personal data were lost or exposed).

## 7. Tests

`tests/integration/v2-cloud-backup-e2e.test.js` (LAB, synthetic data, loopback fake S3 bucket): producer → bucket → verifier → empty database;
refusals (decryption key in the producer, live database next to the verifier, write with the read-only token, tampered object); missed run and
overdue retention alerts; prune. `tests/unit/v2-cloud-backup.test.js`: configuration, naming, retention and freshness rules, image contents.
The E2E also proves the durable record: the Healthchecks ping body equals the verifier's output and `check-restore-evidence.mjs` accepts it (and
refuses the failed run). `tests/unit/v2-restore-evidence.test.js`: evidence checker (acceptance rules, privacy allowlist).
`tests/unit/v2-job-entrypoint.test.js`: startup script (LF, pins, startup command identical in script and README, no variable + eval delivery).
`tests/unit/v2-cloud-backup-probe.test.js`: effective bucket permissions.
