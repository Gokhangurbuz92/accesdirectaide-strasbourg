# M1 — `ParcoursItem.planStep` (migration 0046): migration note

Status: LAB only. Migration 0046 is NOT applied in Production; applying it needs an explicit owner action (CLAUDE.md §6). The Mon Parcours surface is closed
in Production. This note is the input for a later Production migration request (register ids C07, C08).

## 1. What the migration does

File `drizzle/0046_m1_parcours_plan_step.sql` (journal entry idx 46, tag `0046_m1_parcours_plan_step`, `when` 1794742203358, snapshot
`drizzle/meta/0046_snapshot.json`). The only statement:

```sql
ALTER TABLE "ParcoursItem" ADD COLUMN IF NOT EXISTS "planStep" jsonb;
```

- One nullable `jsonb` column, no default, no index, no constraint, no trigger, no backfill.
- Idempotent (`IF NOT EXISTS`), as `docs/database.md` requires for 0046+.
- It touches nothing of the obsolete migrations 0043 / 0044: it can be applied on Production (0042 + 0045) on its own, with
  `scripts/db-deploy-migrate.mjs --only 0046_m1_parcours_plan_step` (after `--check` and `--dry-run`; never `npm run db:migrate` on Production).

**Attention before any Production migration run.** With this entry in the journal, 0046 is the one pending, non-obsolete migration on a database at
0042 + 0045: a PLAIN run of `scripts/db-deploy-migrate.mjs` (no `--only`) on Production would now plan and apply 0046 (`planDeploy`, covered by
`tests/unit/r44-migrate-guard.test.js` and `tests/unit/r43-booking-units.test.jsx`). Do not run it on Production until the owner authorises 0046;
`--check` and `--dry-run` stay read-only.
Since then the journal holds later migrations: 0047 and 0048 (M2, `docs/vision/M2_MIGRATION_NOTE.md`) and 0049 (pro messages,
`RdvConversationRead`). A plain run on 0042 + 0045 would apply 0046, 0047, 0048 and 0049 together: use `--only <tag>`, one authorised migration at a time,
in journal order.

## 2. Data impact

- No existing row is rewritten. PostgreSQL adds a nullable column without a default as a catalogue change only; every existing row reads `NULL`.
- Measured on a throwaway database at level 0045 with 200 existing rows (`tests/integration/m1-planstep-migration-db.test.js`): after the migration the
  table keeps the same `relfilenode` (the table file is not rewritten) and every row keeps the same `ctid` and `xmin` (no new row version); the former
  columns of every row are identical; indexes, constraints and triggers of the table are unchanged; `ParcoursEvent` is untouched and still append-only.
- Lock: `ALTER TABLE … ADD COLUMN` takes an `ACCESS EXCLUSIVE` lock on `ParcoursItem` for the duration of the catalogue change (no table scan, no
  rewrite). Use a `lock_timeout` as for any DDL.
- The status CHECK (`ParcoursItem_status_check`, the ten self-declared states) and the history CHECK (`ParcoursEvent_kind_check`) are unchanged.

## 3. What the column holds

Written and read only through `api/lib/parcours-plan-step.js` (the column has no CHECK: the server validation is the contract). Version 1, every key optional:

```json
{ "v": 1, "need": "<taxonomy subdomain id>", "actor": { "kind": "citizen | organisation | professional", "name": "<organisation only>" },
  "links": [{ "url": "<official https url>", "label": "…" }, { "to": "</internal-route>", "label": "…" }],
  "dependsOnItemId": "<another step of the same account>", "nextActionKey": "<listed key>", "detail": "<plan text>", "closure": "ABANDONED | OUTCOME_UNKNOWN" }
```

- A person may send only `need`, `actor`, `links` (official `url` links, at most 5), `dependsOnItemId`, `nextActionKey`; size cap 8192 bytes; unknown keys
  refused. Official links use the allow-list of human verification (`evidenceUrlAllowed`, `api/_services/content-verification.js`).
- `detail` and internal `to` links come only from the account-free plan of a dossier the account owns (copied at import, so they outlive the dossier).
- `closure` is set only by the status action: `ABANDONED` / `OUTCOME_UNKNOWN` are stored as status `CLOSED` plus this reason.
- Personal data: the content is the person's own organisation of their steps. It is included in the person's data export (`parcours[].planStep`), deleted
  with the step or the account (same row), and never shown to a delegate. No person's name is accepted for `actor` (only an organisation is named).
  The register entry of Mon Parcours (`REGISTRE_RGPD.json`) should mention the new field before Production activation — not done here.

## 4. Rollback

File `drizzle/rollback/0046_down.sql`:

```sql
ALTER TABLE "ParcoursItem" DROP COLUMN IF EXISTS "planStep";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794742203358;
```

- Effect: every step loses its plan data (need, who acts, links, dependency, next action, closing reason). The steps themselves, their status, deadlines,
  notes and history stay; a step closed as « abandoned » / « outcome unknown » stays `CLOSED` (« Terminé ») without its reason.
- The loss is not recoverable from the database afterwards. Export first if needed:
  `COPY (SELECT id, "userId", "planStep" FROM "ParcoursItem" WHERE "planStep" IS NOT NULL) TO STDOUT WITH CSV HEADER` (after an encrypted backup,
  `scripts/db-backup.mjs`).
- `DROP COLUMN` is also a catalogue change (no rewrite). The second statement forgets the migration's history row so that a later run applies 0046 again
  instead of silently skipping it (rule since 0043, test `tests/unit/r39-rollback-journal.test.js`).
- Order: on Production (0042 + 0045 + 0046) it runs on its own; on a LAB database it runs before `0045_down.sql`. Where a later migration is
  recorded (0047, 0048, 0049), roll those back first, newest first (`0049_down.sql`, `0048_down.sql`, `0047_down.sql`): drizzle only re-applies what is later than the newest recorded row.
- Up → down → up was rehearsed on a throwaway LAB database (same test): after down the catalogue is identical to level 0045 and the pre-M1 INSERT works;
  after the second up the column is back and empty.

## 5. Compatibility matrix

| Code | Database | Behaviour |
|---|---|---|
| Old code (before M1) | column absent | Unchanged: it is today's Production state. |
| Old code (before M1) | column present (0046 applied, code rolled back or not yet released) | Works. The old code's Drizzle schema does not know the column: it never selects, inserts or returns it; an INSERT leaves it `NULL`. Plan data already stored is kept but not shown; a step closed with a reason shows as « Terminé ». |
| New code (M1) | column absent (code released before the migration) | Works as before M1. `api/_utils/schema-features.js` (`parcoursPlanStepSchema`, `parcoursItemTable`) reads the information schema (cached 60 s per process) and every reader / writer of `ParcoursItem` uses the table without the column: `api/_services/mon-espace.js`, the data export in `api/_services/privacy.js`; the delegate's view (`api/_services/delegation.js`) selects explicit columns. The list answers `planSteps: false`; « add » creates the step without plan data and answers `planSaved: false`; the `plan` action and the statuses `ABANDONED` / `OUTCOME_UNKNOWN` answer 409 `PLAN_STEP_UNAVAILABLE` and change nothing; the screen does not offer them. Raw-SQL readers (`api/_handlers/cron/parcours-reminder.js`, `api/_services/citizen-inbox.js`) never name the column. Proven on a database migrated to 0045 only: `tests/integration/m1-parcours-without-0046-db.test.js` (without the guard, 20 parcours tests fail there with « column "planStep" does not exist »). |
| New code (M1) | column present, value `NULL` (every row that existed before 0046) | The step lists and changes exactly as before: `step: null`, `closure: null`, `dependsOn: null`, `waiting: false`; a plan step imported before 0046 still reads « who / detail / links » back from its dossier while the account owns it. No former action writes the column (it stays `NULL`). Proven in `tests/integration/m1-parcours-planstep-db.test.js` (backward-compatibility block). |
| New code (M1) | column present, value written | Plan data is validated on write and re-validated on read (a link whose host left the allow-list is not shown; another `v` is ignored). |

LAB test fixtures that insert a step through the full Drizzle schema (for example `tests/integration/pkg11-n02-sms-stop-db.test.js`) need a database at
0046; on a 0045-level database that one fixture fails by construction (the application code does not).

After the migration is applied, the running code picks the column up within 60 seconds (cache TTL) without a redeploy.

## 6. Known limits (decisions left open)

- The history (`ParcoursEvent`) records statuses, deadlines and notes; its kinds are fixed by a CHECK of 0016. A change of plan data writes no history
  line, and a closing reason appears in the history as a change to `CLOSED` (the reason itself is only on the step). Recording them would need a second
  migration widening `ParcoursEvent_kind_check`.
- Steps imported before 0046 are not backfilled (no row is rewritten): they keep the dossier read-back and lose « who / detail / links » when the dossier
  goes, as before. Re-importing a plan does not rewrite an existing step.
- A dependency on a step that is later removed is not cleaned in the data; it is simply no longer resolved (the dependent step is not « waiting »).
- The need label shown for a group is the French label of `data/reference/social-domains.v1.json` (marked `lang="fr"`); the taxonomy has no translations.

## 7. LAB rehearsal commands

Local cluster 127.0.0.1:55434, synthetic data only:

- level 0046: `tests/integration/m1-parcours-planstep-db.test.js`, `vis-r-parcours-db.test.js`, `pkg2-mon-espace-db.test.js`;
- level 0045: `tests/integration/m1-parcours-without-0046-db.test.js` plus the same former suites;
- up → down → up: `M1_MIGRATION_TEST_URL=postgresql://…@127.0.0.1:55434/ada_m1_migration_test` (a database named `ada_m1_*_test` at level 0045)
  with `tests/integration/m1-planstep-migration-db.test.js`.
