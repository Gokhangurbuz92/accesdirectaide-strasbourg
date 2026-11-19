# Migration 0056 — inclusive job board (X05, expansion)

- **File**: `drizzle/0056_x05_job_board.sql`; rollback `drizzle/rollback/0056_down.sql`; journal tag `0056_x05_job_board` (`when` 1794980000000);
  snapshot `drizzle/meta/0056_snapshot.json` (`prevId` = 0055's). Order: **after 0055 (X01), itself after 0054 (X02) and 0053 (X04)** — the branch
  `g6-x05-job-board` is stacked on X01 `fc90e17` because the migration guard requires a contiguous journal (`IDX_NOT_CONTIGUOUS`, `TAG_NOT_NUMBERED_BY_IDX`).
  If X01 (or X02 / X04) is not integrated, renumber this one (file, journal idx/tag, rollback `when`, tests `r44-migrate-guard`, `r43-booking-units`,
  `c12-migration-0050-db`, `x04-migration-0053-db`, `x02-migration-0054-db`, `x01-migration-0055-db`, `x05-migration-0056-db`).
- **Status**: LAB only. NOT applied in Production; it is released only when the owner runs it (`scripts/db-deploy-migrate.mjs --only 0056_x05_job_board`
  after 0053, 0054 and 0055, verified backup first). The capability `community.employment` stays closed anyway (outside the AIPD, surface `employment` opened by nothing).
- **What it adds** (additive only, nothing backfilled, **nothing seeded**): `JobListing` — the employer (`structureId`, FK ON DELETE CASCADE to `Structure`),
  the state (`draft`, `pending`, `published`, `rejected`, `withdrawn`, `taken_down`, `expired`), title (5–120), contract type (closed list), city (2–80) and
  postal code (5 digits), description (50–3000), inclusive accommodations (1–10 values of a closed list, CHECK `<@`), the employer's own application channel
  (`url` beginning `https://` or `email`), the end date `expiresOn`, the moderation reason (closed list), moderator e-mail and times.
  **No applicant data** (no table, no column): applications go to the employer's own channel. **No discriminatory criterion column** (Code du travail
  L1132-1). **No author column** (the professional who acted is in the audit trail only).
- **Code without the table**: `api/_services/job-board.js` asks the catalogue (`jobBoardSchemaAvailable`): public list empty, the employer's list says « not
  available », writes and moderation answer 503 `JOBS_NOT_AVAILABLE`, the organization closure skips the step.
- **Rollback**: `0056_down.sql` drops the table (every listing is lost — export first if needed) and forgets the journal row. Independent of 0053–0055.
- **Tests**: `tests/integration/x05-migration-0056-db.test.js` (up → down → code without it → up), `tests/integration/x05-job-board-db.test.js`.
