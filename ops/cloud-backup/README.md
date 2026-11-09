# Cloud-only backups of the Production database (V2 C7)

Status: **LAB-verified, not provisioned.** Nothing here runs until the owner approves the activation package
(`STRASBOURG_FULL_PRODUCT_PLAN/CONTROL/v2/C7_BULUT_YEDEK_YETKI_PAKETI_TR.md`). No step depends on the owner's computer.

## 1. Architecture

```
Neon (PG 18, Frankfurt) ──read-only role──► PRODUCER job (Scaleway Serverless Jobs, fr-par, cron 2×/day)
                                              pg_dump 18 → ADAB2 (RSA-4096 public key + AES-256-GCM) → erasure ledger (ADAB2)
                                              → PUT to R2 bucket (EU jurisdiction) → HEAD confirm → ping Healthchecks
R2 bucket « ada-db-backups » (EU) : lifecycle 35 days (deletion within ~24 h after) · Bucket Lock 30 days (age) · objects: dump, .sha256, ledger
VERIFIER job (separate job + separate token, monthly)  ─read-only token─► newest dump → private key → empty disposable DB
                                              → structure / migration / ledger checks → evidence JSON (counts only) → ping Healthchecks
Healthchecks.io : 2 checks (producer every 12 h, grace 3 h; verifier monthly, grace 2 days) → e-mail to the owner
```

| Who holds what | Producer | Verifier | Owner (offline, password manager) |
|---|---|---|---|
| Neon read-only connection | yes | **no** (refused if present) | — |
| Backup public key | yes | — | copy |
| Backup private key + passphrase | **no** (refused if present) | yes (Secret Manager of a separate job) | **yes** (recovery copy) |
| R2 token | Object Read & Write, this bucket only | Object Read only, this bucket only | Cloudflare account |

A stolen producer token can add objects but cannot read backups (no private key) nor delete them before 30 days (Bucket Lock, shorter than the 35-day lifecycle so the lifecycle can always delete).

## 2. Verified costs (sources read 2026-11-09)

| Item | Allowance | Expected use | Cost |
|---|---|---|---|
| Cloudflare R2 Standard | 10 GB-month, 1 M class A, 10 M class B, egress free | ~70 objects, < 10 GB while dumps stay < 140 MB | **0 €**; beyond: 0.015 $/GB-month |
| Scaleway Serverless Jobs | 200 000 vCPU-s and 400 000 GB-s / month | 2 runs/day × ~2 min | **0 €** |
| Scaleway Secret Manager / Container Registry | — | 6 secrets, 1 small image | a few cents (price **not verified**) |
| Healthchecks.io Hobbyist | 20 checks | 2 checks | **0 €** |

Scaleway asks for a payment card at account creation (1 € check). Cloudflare R2 probably does too (not verified).
Fallback runtime: Google Cloud Run Jobs + Cloud Scheduler in europe-west9 (same image, same variables, also within its free tier).

## 3. Variables (names only)

Producer job: `DATABASE_URL` (read-only role, **unpooled** host, `sslmode=require`), `BACKUP_PUBLIC_KEY`, `BACKUP_S3_ENDPOINT`
(`https://<account id>.eu.r2.cloudflarestorage.com`), `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`,
`BACKUP_HEALTHCHECK_URL`, optional `BACKUP_MAX_AGE_HOURS` (36).
Verifier job: `TARGET_DATABASE_URL` (empty disposable database), `BACKUP_PRIVATE_KEY_FILE` (mounted secret file), `BACKUP_PRIVATE_KEY_PASSPHRASE`,
the four `BACKUP_S3_*` with the **read-only** token, `RESTORE_HEALTHCHECK_URL`. Command:
`node scripts/cloud-restore-verify.mjs --confirm-target <host>/<database> --expect-migrations 43 --evidence /tmp/evidence.json` (43 = history rows of a database at 0042; 44 after 0045).

`node scripts/cloud-backup.mjs --check-config` lists missing or invalid variables by name (never a value).

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
(or `GRANT pg_read_all_data TO ada_backup_ro;` if the Neon console allows it — not verified on Free). The role cannot write.

## 5. RPO / RTO

- **RPO** (data that can be lost): ≤ 12 h with two runs a day; ≤ 6 h for incidents noticed within Neon's own restore window (Free plan: 6 h).
- **RTO** (time to be back): ~2 h — new Neon project or branch, restore of the newest dump (minutes for < 1 GB), erasure replay, migration check,
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
