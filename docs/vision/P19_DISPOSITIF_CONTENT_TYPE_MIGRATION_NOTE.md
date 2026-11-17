# P19 — `ContentType` value `DISPOSITIF` (migration 0051): migration note

Status: LAB only. Migration 0051 is NOT applied in Production; applying it needs an explicit owner action (CLAUDE.md §6). Register row P19 (public:
feedback, content report, suggest a structure); audit reference RECON public A-6.

Numbering: 0051, after 0050 (C12, `0050_rs_resource_publication`). The branch is rebased on the C12 commit: the journal is contiguous
(0049 → 0050 → 0051), the « when » of 0051 (1794930000000) is later than 0050's (1794911505815), and `drizzle/meta/0051_snapshot.json` is the 0050
snapshot (`prevId` = the 0050 snapshot id) plus the enum value. The guarded runner applies 0051 only after 0050: `--only 0051_p19_dispositif_content_type`
on a database at 0049 is refused (`EARLIER_MIGRATION_PENDING`, pending 0050).

## 1. What the migration does

File `drizzle/0051_p19_dispositif_content_type.sql` (journal idx 51, tag `0051_p19_dispositif_content_type`, `when` 1794930000000, snapshot
`drizzle/meta/0051_snapshot.json`). The only statement:

```sql
ALTER TYPE "public"."ContentType" ADD VALUE IF NOT EXISTS 'DISPOSITIF';
```

- Additive: one enum value appended after `ACTUALITE`. No table, column, constraint, index or row changes; nothing is backfilled or rewritten.
- Idempotent (`IF NOT EXISTS`). PostgreSQL 12+ accepts `ADD VALUE` inside the migration transaction (Neon is PG 18); the value can only be USED after
  commit, and nothing in the migration uses it.
- Lock: a catalogue change on the type only (no table scan, no rewrite of `ContentReport`).
- The SQL parser of `scripts/db-migrate-guard.mjs` cannot see an `ADD VALUE`; `ENUM_VALUE_MARKERS` now does: the physical-drift check reports
  `ENUM_VALUE_UNRECORDED` (value present without the 0051 history row) and `ENUM_VALUE_MISSING` (row present, value absent).

## 2. Behaviour of the code, with and without 0051

`api/_utils/schema-features.js` `contentTypeSchema(db)` reads `pg_enum` (at most once a minute per process; a failed read answers « without » and is
not remembered).

| | Database with 0051 | Database without 0051 (Production today) |
|---|---|---|
| `POST /api/feedback` `type: dispositif` | `contentType = DISPOSITIF`, `contentId = <id>` or `slug:<slug>` | as before: `AIDE`, `dispositif:<id>` / `dispositif:slug:<slug>` |
| `POST /api/reports` `contentType: DISPOSITIF` | stored as `DISPOSITIF` | stored as `AIDE` + `dispositif:<contentId>` (was a 400 before) |
| Admin filter « Dispositif » (`GET /api/reports?contentType=DISPOSITIF`) | `DISPOSITIF` rows OR `AIDE` rows whose target starts with `dispositif:` | the `AIDE` + `dispositif:` rows |
| Admin filter « Aide » | `AIDE` rows whose target does not start with `dispositif:` | same |
| Each listed row | `kind`, `target` (id without the prefix), `legacyDispositif` added; `contentType` / `contentId` unchanged | same |

An insert refused with SQLSTATE 22P02 for `DISPOSITIF` (0051 rolled back inside the one-minute cache) is retried once in the pre-0051 form; the report is
never lost. `/admin/signalements` shows the kind (« Dispositif »), the bare target, a note on rows filed under « Aide » before 0051, and a content-type
filter (six languages).

## 3. Rollback (`drizzle/rollback/0051_down.sql`) — manual only

PostgreSQL has no `ALTER TYPE … DROP VALUE`: an enum value cannot be dropped in place. The rollback file rebuilds the type without it:

1. if `ContentType` has no `DISPOSITIF`: notice, nothing to do;
2. if any `ContentReport` row is `DISPOSITIF`: **RAISE EXCEPTION, nothing changes** — those rows need a human decision first (export them; then
   either keep 0051, or reclassify them to the pre-0051 form with the reverse statement of §4, which is a data change and needs the owner's approval);
3. otherwise: `LOCK TABLE "ContentReport" IN ACCESS EXCLUSIVE MODE`, rename the type to `ContentType_0051_old`, create `ContentType` with the four values
   of 0000, re-type `ContentReport.contentType` (`USING "contentType"::text::"ContentType"`; this rewrites the table — small), drop the old type;
4. delete the 0051 history row (`created_at = 1794930000000`).

`ContentReport.contentType` is the only column of this type (checked in every migration file). Proven on LAB (127.0.0.1:55434): on a fresh database
with 0051 and no DISPOSITIF row the file restores the four values and the history drops to 51 rows (0000..0050), with no physical drift; with a DISPOSITIF row it
refuses (tests/integration/p19-dispositif-report-db.test.js). No automatic DOWN, no blind rollback.

## 4. Existing reports filed as AIDE + `dispositif:` — proposal only, NOT a migration

Nothing reclassifies them automatically; the admin views already treat both forms as « Dispositif ». If the owner wants them stored as `DISPOSITIF`
after 0051 is applied (and committed), a one-off, audited data step could be (not executed, not part of any migration):

```sql
BEGIN;
-- export first: COPY (SELECT * FROM "ContentReport" WHERE "contentType" = 'AIDE' AND "contentId" LIKE 'dispositif:%') TO STDOUT WITH CSV HEADER
UPDATE "ContentReport"
   SET "contentType" = 'DISPOSITIF', "contentId" = substr("contentId", length('dispositif:') + 1), "updatedAt" = now()
 WHERE "contentType" = 'AIDE' AND "contentId" LIKE 'dispositif:%';
-- one administration-journal row saying how many rows and who decided (AuditLog, action e.g. CONTENT_REPORT_RECLASSIFIED)
COMMIT;
```

Reverse (needed before the rollback of §3 if DISPOSITIF rows exist):
`UPDATE "ContentReport" SET "contentType" = 'AIDE', "contentId" = 'dispositif:' || "contentId", "updatedAt" = now() WHERE "contentType" = 'DISPOSITIF';`

Caveats: the earlier triage rows of `AuditLog` keep the old `contentType` / `contentId` in their details (history is not rewritten); a caller of
`POST /api/reports` could have sent `AIDE` with a `dispositif:` target itself — such rows are indistinguishable and would be reclassified too.
