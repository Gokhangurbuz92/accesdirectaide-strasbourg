# C12 — publication of the `/ressources` documents (migration 0050): migration note

Status: LAB only. Migration 0050 is NOT applied in Production; applying it needs an explicit owner action (CLAUDE.md §6), evaluated separately
(owner decision C12 = b, 17/11/2026). Register rows P11 / P12. Another branch may also add a migration numbered 0050: the integrator renumbers.

## 1. What it does

File `drizzle/0050_rs_resource_publication.sql` (journal idx 50, tag `0050_rs_resource_publication`, `when` 1794911505815, snapshot
`drizzle/meta/0050_snapshot.json`). Additive and idempotent:

- `ResourceAccessibility`: eight nullable columns, no default — `source_publisher`, `verified_at`, `reviewer_type`, `reviewer_id`, `verified_version`,
  `published_at`, `withdrawn_at`, `withdrawal_reason`;
- `ResourceAccessibility_verification_check`: a verification date only with its reviewer, publisher, official address and verified content version
  (true of every existing row: they all have `verified_at` NULL);
- `ResourcePublicationEvent`: the append-only ledger (CREATE, EDIT, VERIFY, PUBLISH, WITHDRAW; actor type + id; from / to status; source; content
  version; note), two CHECKs, one index, trigger `ResourcePublicationEvent_append_only` (BEFORE UPDATE OR DELETE → `ada_append_only()`, since 0022).
  No foreign key, like `ContentVerification`: the ledger outlives its document.

Nothing is backfilled. Rows created before 0050 keep their status and get no publisher, date or reviewer: they are never public until a named
administrator edits (→ draft), verifies and publishes them.

## 2. Data impact (measured on throwaway LAB databases)

`tests/integration/c12-migration-0050-db.test.js`: up → down → rows written as before 0050 → up → the file run again by hand. Former columns and status
of existing rows unchanged, new columns NULL, `relfilenode` unchanged (no table rewrite), same schema after a second run. The ADD CONSTRAINT scans the
(small) table under an `ACCESS EXCLUSIVE` lock: use a `lock_timeout`. `scripts/db-migrate-guard.mjs` preflight: no drift at 0050 nor after the rollback;
on a 0049 database the plan is exactly `0050_rs_resource_publication`.

## 3. Code without 0050

`api/_utils/schema-features.js` `resourcePublicationSchema()` (cached 60 s, fail-closed). Without 0050: `GET /api/ressources` lists no document and a
document answers 404 (no row can meet the contract); `/api/admin/resources` lists the rows read-only (`available: false`) and refuses every write
(503 `MIGRATION_0050_REQUIRED`); the administration page says so. Proven on a database rolled back to 0049
(`tests/integration/c12-resource-publication-db.test.js`: since QA v43 the file makes its own throwaway databases at 0049 and at the latest
migration, so both levels run in every integration run).

## 4. Rollback

`drizzle/rollback/0050_down.sql`: drops the ledger, the CHECK and the eight columns (export commands in the file), and forgets the journal row
(`created_at = 1794911505815`). Documents (title, type, text, address, status) stay.

## 5. Production, when authorised

Recovery branch + backup first; `--check`, `--dry-run`, then `scripts/db-deploy-migrate.mjs --only 0050_rs_resource_publication` in journal order (after
0046–0049). Applying 0050 publishes nothing: publication stays a human action in the administration, whose surface is closed during the restricted
beta.
