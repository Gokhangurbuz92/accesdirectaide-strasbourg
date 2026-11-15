# M2 — migrations 0047 and 0048: migration note

Status: **LAB only.** Neither migration has been applied to Production; applying them needs a separate, explicit owner authorization (CLAUDE.md §6).
Scope: register ids R07, R09–R12, E06 (surfaces closed in Production). Design: `docs/vision/REFERRAL_REDIRECT_AND_REFERENT_DESIGN.md`.
Tested on the local LAB cluster only (PostgreSQL, databases `ada_m2_test`, `ada_m2_pre47_test` and throwaway databases): `tests/integration/m2-migrations-0047-0048-db.test.js` (up → down → up), `tests/integration/m2-pre0047-compat-db.test.js` (code on a database without them).

| Migration | Journal `when` | What it adds | Rollback |
|---|---|---|---|
| `0047_m2_referral_redirect_referent` | 1794750000000 | 3 nullable columns on `Referral`, `REDIRECT_SUGGESTED` in one CHECK, tables `DossierReferent` / `DossierReferentEvent` | `drizzle/rollback/0047_down.sql` |
| `0048_m2_referral_message_history` | 1794750600000 | table `ReferralMessage` (append-only history of the referral texts) + its guard function | `drizzle/rollback/0048_down.sql` |

## 1. Things to know before applying

- **Number 0046 is reserved by a parallel task.** Until it lands, the journal is not contiguous (idx 45 → 47): `verifyJournal()` reports `IDX_NOT_CONTIGUOUS` and the unit test « the repository journal passes » (`tests/unit/r44-migrate-guard.test.js`) is red on this branch. The `when` of 0046 must be **earlier than 1794750000000** (otherwise raise the two values above, here, in the journal and in the two rollback files). The snapshots `drizzle/meta/0047_snapshot.json` (prevId = 0045) and `0048_snapshot.json` (prevId = 0047) must be re-chained after 0046.
- **Order.** 0047 then 0048 (journal order). Rollback in the reverse order: **0048_down first, then 0047_down** — drizzle re-applies only what is later than the newest recorded migration, so rolling back 0047 alone while 0048 stays recorded would leave 0047 un-reapplicable by the migrator.
- **Production** is applied with `scripts/db-deploy-migrate.mjs --only <tag>` (never `npm run db:migrate`), one migration at a time, after an encrypted backup. The guard knows 0047's CHECK change (`CHECK_MARKERS`).
- **The code does not need the migrations.** New code on a database without them keeps every earlier path working (§5). The migrations can therefore be applied before or after the code release; the new features only appear once they are applied.

## 2. Exact SQL — 0047 (up)

```sql
-- M2 (R07 R09 R10 R11 R12 E06) — referral redirect (G3), follow-up notice (G4) and « référent de parcours » (G5). ADDITIVE and idempotent: three nullable
-- columns on "Referral", one CHECK widened ("Referral_response_check" gains REDIRECT_SUGGESTED), two new tables. No existing row is rewritten; every new
-- column is NULL on existing rows. The code works on a database WITHOUT this migration (api/_utils/schema-features.js: the redirect, the follow-up notice
-- and the référent answer « not available » and every earlier path is unchanged). Rollback: drizzle/rollback/0047_down.sql. Note: docs/vision/M2_MIGRATION_NOTE.md.
--
-- Redirect: a receiver that declines may name another organization ("suggestedStructureId", an identifier only — nothing is disclosed to that organization).
-- A NEW referral proposed afterwards points to the declined one ("previousReferralId") and starts at PENDING_CITIZEN like any other: only the person's
-- authorization creates the new receiver's access. No status is added: a redirect is a DECLINED referral whose "responseCode" is REDIRECT_SUGGESTED.
ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "previousReferralId" text;--> statement-breakpoint
ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "suggestedStructureId" text;--> statement-breakpoint
ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "followUpNotifiedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_previous_fkey";--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_previous_fkey" FOREIGN KEY ("previousReferralId") REFERENCES "public"."Referral"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_suggested_fkey";--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_suggested_fkey" FOREIGN KEY ("suggestedStructureId") REFERENCES "public"."Structure"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_previous_check";--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_previous_check" CHECK ("previousReferralId" IS NULL OR "previousReferralId" <> "id");--> statement-breakpoint
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_suggested_check";--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_suggested_check" CHECK ("suggestedStructureId" IS NULL OR ("status" IN ('DECLINED', 'CLOSED') AND "suggestedStructureId" <> "toStructureId" AND "suggestedStructureId" <> "fromStructureId"));--> statement-breakpoint
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_response_check";--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_response_check" CHECK ("responseCode" IS NULL OR "responseCode" IN ('OUT_OF_SCOPE', 'NO_CAPACITY', 'ALREADY_SUPPORTED', 'NEEDS_MORE_INFORMATION', 'OTHER', 'REDIRECT_SUGGESTED'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Referral_previous_idx" ON "Referral" USING btree ("previousReferralId");--> statement-breakpoint
-- one live follow-up per declined referral (a double click or two colleagues cannot fork the chain)
CREATE UNIQUE INDEX IF NOT EXISTS "Referral_previous_live_key" ON "Referral" USING btree ("previousReferralId") WHERE "previousReferralId" IS NOT NULL AND "status" IN ('DRAFT', 'PENDING_CITIZEN', 'SENT', 'ACKNOWLEDGED', 'NEEDS_INFO', 'ACCEPTED', 'IN_PROGRESS');--> statement-breakpoint
-- « Référent de parcours »: a named contact person for the path, DECLARATIVE. The row gives NO access to the dossier and carries no legal responsibility:
-- access stays the SharedDossierGrant alone (api/_utils/share-access.js never reads this table). Effective only once the person accepted
-- ("citizenDecisionAt", enforced below); the person ends it at any time.
CREATE TABLE IF NOT EXISTS "DossierReferent" (
	"id" text PRIMARY KEY NOT NULL,
	"sharedDiagnosticId" text NOT NULL,
	"structureId" text NOT NULL,
	"proUserId" text,
	"displayName" text NOT NULL,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"displayNameConsentAt" timestamp (3) NOT NULL,
	"proposedAt" timestamp (3) DEFAULT now() NOT NULL,
	"citizenDecisionAt" timestamp (3),
	"endedAt" timestamp (3),
	"endedBy" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "DossierReferentEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"referentId" text NOT NULL,
	"actorType" text NOT NULL,
	"actorId" text,
	"fromStatus" text,
	"toStatus" text NOT NULL,
	"reason" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_dossier_fkey";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_dossier_fkey" FOREIGN KEY ("sharedDiagnosticId") REFERENCES "public"."SharedDiagnostic"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_structure_fkey";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_pro_fkey";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_pro_fkey" FOREIGN KEY ("proUserId") REFERENCES "public"."ProUser"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DossierReferentEvent" DROP CONSTRAINT IF EXISTS "DossierReferentEvent_referent_fkey";--> statement-breakpoint
ALTER TABLE "DossierReferentEvent" ADD CONSTRAINT "DossierReferentEvent_referent_fkey" FOREIGN KEY ("referentId") REFERENCES "public"."DossierReferent"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_status_check";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_status_check" CHECK ("status" IN ('PROPOSED', 'ACCEPTED_BY_CITIZEN', 'ENDED'));--> statement-breakpoint
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_endedBy_check";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_endedBy_check" CHECK ("endedBy" IS NULL OR "endedBy" IN ('CITIZEN', 'PROFESSIONAL', 'DEPARTURE', 'ACCESS_REVOKED', 'ORGANIZATION_CLOSED'));--> statement-breakpoint
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_ended_check";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_ended_check" CHECK (("status" = 'ENDED') = ("endedAt" IS NOT NULL) AND ("status" = 'ENDED') = ("endedBy" IS NOT NULL));--> statement-breakpoint
-- the person's agreement is a fact of the row: never « accepted » without the instant of their decision
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_citizen_consent_check";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_citizen_consent_check" CHECK ("status" <> 'ACCEPTED_BY_CITIZEN' OR "citizenDecisionAt" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_name_check";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_name_check" CHECK (char_length("displayName") BETWEEN 2 AND 80);--> statement-breakpoint
ALTER TABLE "DossierReferentEvent" DROP CONSTRAINT IF EXISTS "DossierReferentEvent_actor_check";--> statement-breakpoint
ALTER TABLE "DossierReferentEvent" ADD CONSTRAINT "DossierReferentEvent_actor_check" CHECK ("actorType" IN ('PROFESSIONAL', 'CITIZEN', 'SYSTEM'));--> statement-breakpoint
-- one current (proposed or accepted) référent per dossier; ended rows are the history
CREATE UNIQUE INDEX IF NOT EXISTS "DossierReferent_current_key" ON "DossierReferent" USING btree ("sharedDiagnosticId") WHERE "status" IN ('PROPOSED', 'ACCEPTED_BY_CITIZEN');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DossierReferent_structure_idx" ON "DossierReferent" USING btree ("structureId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DossierReferent_pro_idx" ON "DossierReferent" USING btree ("proUserId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DossierReferentEvent_referent_idx" ON "DossierReferentEvent" USING btree ("referentId");--> statement-breakpoint
-- append-only history, like ReferralEvent (the function comes from 0022)
DROP TRIGGER IF EXISTS "DossierReferentEvent_append_only" ON "DossierReferentEvent";--> statement-breakpoint
CREATE TRIGGER "DossierReferentEvent_append_only" BEFORE UPDATE ON "DossierReferentEvent" FOR EACH ROW EXECUTE FUNCTION "ada_append_only"();
```

## 3. Exact SQL — 0048 (up)

```sql
-- M2 add-on / B01 (R09 R10) — the texts exchanged on a referral keep their HISTORY. Before: one "messageEncrypted" and one "responseMessageEncrypted" per
-- referral, so a second « needs info » round overwrote the first answer. ADDITIVE and idempotent: one new table and its guard; "Referral" is not altered and
-- its two columns stay (the current text of each side, read by every release). Existing texts become the first rows of the history: the ciphertext is
-- copied as it is (same key purpose and context « referral:<id> », so it opens with the referral's id — no key is needed by the migration).
-- The code works on a database WITHOUT this migration (api/_utils/schema-features.js: no history is written or returned; the two columns behave as before).
-- Rollback: drizzle/rollback/0048_down.sql. Note: docs/vision/M2_MIGRATION_NOTE.md.
CREATE TABLE IF NOT EXISTS "ReferralMessage" (
	"id" text PRIMARY KEY NOT NULL,
	"referralId" text NOT NULL,
	"side" text NOT NULL,
	"bodyEncrypted" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "ReferralMessage" DROP CONSTRAINT IF EXISTS "ReferralMessage_referral_fkey";--> statement-breakpoint
ALTER TABLE "ReferralMessage" ADD CONSTRAINT "ReferralMessage_referral_fkey" FOREIGN KEY ("referralId") REFERENCES "public"."Referral"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ReferralMessage" DROP CONSTRAINT IF EXISTS "ReferralMessage_side_check";--> statement-breakpoint
ALTER TABLE "ReferralMessage" ADD CONSTRAINT "ReferralMessage_side_check" CHECK ("side" IN ('SENDER', 'RECEIVER'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ReferralMessage_referral_idx" ON "ReferralMessage" USING btree ("referralId","createdAt");--> statement-breakpoint
-- Append-only: who said what and when can never be changed. The ONLY update allowed is the re-sealing of the ciphertext under a rotated key
-- (api/_services/key-rotation.js): every other column must be unchanged. Rows leave only with their referral (ON DELETE CASCADE: erasure of the dossier).
CREATE OR REPLACE FUNCTION "ada_referral_message_guard"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."referralId" IS DISTINCT FROM OLD."referralId" OR NEW."side" IS DISTINCT FROM OLD."side" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "ReferralMessage_append_only" ON "ReferralMessage";--> statement-breakpoint
CREATE TRIGGER "ReferralMessage_append_only" BEFORE UPDATE ON "ReferralMessage" FOR EACH ROW EXECUTE FUNCTION "ada_referral_message_guard"();--> statement-breakpoint
-- the texts that exist today become the first rows (deterministic ids: running the file twice inserts nothing twice)
INSERT INTO "ReferralMessage" ("id", "referralId", "side", "bodyEncrypted", "createdAt")
  SELECT 'rm-s-' || r."id", r."id", 'SENDER', r."messageEncrypted", r."createdAt" FROM "Referral" r WHERE r."messageEncrypted" IS NOT NULL
  ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "ReferralMessage" ("id", "referralId", "side", "bodyEncrypted", "createdAt")
  SELECT 'rm-r-' || r."id", r."id", 'RECEIVER', r."responseMessageEncrypted", COALESCE(r."respondedAt", r."updatedAt") FROM "Referral" r WHERE r."responseMessageEncrypted" IS NOT NULL
  ON CONFLICT ("id") DO NOTHING;
```

## 4. Data impact

**0047**
- `Referral`: three columns added, all NULL on every existing row (`previousReferralId`, `suggestedStructureId`, `followUpNotifiedAt`). No row is updated. Two foreign keys (ON DELETE SET NULL), two CHECKs that every existing row satisfies (both columns are NULL), one index, one partial unique index.
- `Referral_response_check` is dropped and re-created with one more allowed value (`REDIRECT_SUGGESTED`): every existing value stays valid. The re-creation validates the table (a scan under an ACCESS EXCLUSIVE lock; the table is empty in Production while the surface is closed).
- Two new empty tables. `DossierReferentEvent` reuses the `ada_append_only()` function of migration 0022 (it must exist: it does on every database at 0022 or later).
- New personal data once the feature is used: the display name a professional agrees to show (`DossierReferent.displayName`, with `displayNameConsentAt`). It is deleted with the dossier (CASCADE). **Open for the owner / legal review:** AIPD and register update for this data, retention of ended rows (today: with the dossier).

**0048**
- One new table. `Referral` is not altered.
- Backfill: one row per existing non-NULL `Referral.messageEncrypted` (side SENDER, dated `createdAt`) and per non-NULL `responseMessageEncrypted` (side RECEIVER, dated `respondedAt`). The ciphertext is copied as it is — same key purpose and context (`referral:<id>`), no key is needed. Deterministic ids (`rm-s-<id>`, `rm-r-<id>`): re-running inserts nothing twice. In Production the referral table is empty (surface closed), so the backfill inserts nothing.
- A new function `ada_referral_message_guard()`: an UPDATE may only change `bodyEncrypted` (re-sealing under a rotated key, `api/_services/key-rotation.js`, which covers the table when it exists); `id`, `referralId`, `side`, `createdAt` can never change. Rows are deleted only with their referral (CASCADE).

Both files are idempotent (IF NOT EXISTS / DROP … IF EXISTS before each ADD CONSTRAINT / ON CONFLICT DO NOTHING): running one twice gives the same schema and the same rows (tested).

## 5. Behaviour of the code around the migrations

**Old code (previous release) on a database WITH 0047 / 0048.** Unaffected. Its Drizzle schema does not know the new columns and names its own columns explicitly in every INSERT / SELECT / RETURNING; the raw `SELECT r.*` queries ignore extra keys; the new columns are nullable without default, so its INSERTs succeed (tested: the INSERT of the previous release is accepted, the three columns are NULL). It never writes `REDIRECT_SUGGESTED`. It does not know the new tables. One difference to know: old code that deletes a `Structure` or a `ProUser` now also cascades / nulls the `DossierReferent` rows (foreign keys) — intended.
If old code runs *after* the new code created data: a referral declined with `REDIRECT_SUGGESTED` is shown by old screens with the raw code as its label (no French label in the old bundle); nothing fails.

**New code on rows that existed before (NULLs).**
- `previousReferralId` NULL → the referral is not part of a chain: `previous` / `previousId` are null, no « suite de… » line.
- `suggestedStructureId` NULL → `suggested` is null, the next action of a declined referral is « the supporting organization may propose another referral » (`SENDER_NEXT`), no « propose this organization » button.
- `followUpNotifiedAt` NULL → the follow-up notice has not been sent: an ACCEPTED referral already older than 14 days gets its ONE notice at the first cron run after the migration (in-app only; the referral is not changed).
- A dossier without a `DossierReferent` row → « no contact person »; nothing is shown to the person.
- A referral whose texts predate 0048 → its history starts with the backfilled rows; a referral without any text has an empty history.

**New code on a database WITHOUT 0047 / 0048** (`api/_utils/schema-features.js`, read once per minute per process; tested in `tests/integration/m2-pre0047-compat-db.test.js`, and the three earlier referral suites pass on that database):
- every earlier path works: propose, authorize, lists, detail, acknowledge / accept / decline / needs-info / reply / cancel / close, the person's list, the referral-timeouts cron, the person withdrawing an access, a member's departure, an organization's closure, key rotation. The service uses the `Referral` table object without the three columns, so no statement names them;
- the redirect answers 409 `REDIRECT_UNAVAILABLE`, the référent answers 409 `REFERENT_UNAVAILABLE` (or « none » on reads), the follow-up notice step of the cron is skipped, no text history is written or returned. Nothing is written half-way;
- the changes that need no schema apply everywhere: a reply is appended to the authorized message (A05), a request for information restarts the deadline (A06), the sender's case leaves REFERRED when its last sent referral ends (A07), the person's list carries the motive and dates of the answer (A09).
- 0047 without 0048, or the reverse order of application, is handled the same way (each feature is detected on its own).

## 6. Rollback SQL

Run with an encrypted backup first, 0048 before 0047.

### 0048 (down)

```sql
-- Rollback of 0048_m2_referral_message_history (M2 add-on / B01). Run on its own, or BEFORE 0047_down.sql when both are rolled back.
-- Data effect: "ReferralMessage" is DROPPED — the history of the texts exchanged on referrals is lost; the CURRENT text of each side stays in
-- "Referral"."messageEncrypted" / "responseMessageEncrypted", which this migration never altered. Export the table first if the history is needed
-- (`COPY (SELECT * FROM "ReferralMessage") TO STDOUT WITH CSV HEADER` — ciphertext only). After it the code keeps working: it writes no history again.
-- Idempotent: running it twice gives the same schema.
DROP TABLE IF EXISTS "ReferralMessage";
DROP FUNCTION IF EXISTS "ada_referral_message_guard"();
-- forget the migration too (its journal row, by the journal's « when » of 0048), otherwise a later run believes 0048 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794750600000;
```

Effect: the history table is dropped (the current text of each side stays in `Referral`). The code keeps working and stops writing a history.

### 0047 (down)

```sql
-- Rollback of 0047_m2_referral_redirect_referent (M2). Run with the code of the previous release (or the M2 code: it detects the missing columns).
-- Data effect — export first if needed (`COPY (SELECT …) TO STDOUT WITH CSV HEADER`):
--   * "DossierReferent" / "DossierReferentEvent" are DROPPED (every référent de parcours and its history);
--   * the redirect links are lost: "Referral"."previousReferralId", "suggestedStructureId", "followUpNotifiedAt" are DROPPED;
--   * a decline recorded as REDIRECT_SUGGESTED becomes OTHER (the earlier CHECK does not know the code); the referral, its status, its dates and its
--     ReferralEvent history are kept.
-- Idempotent: running it twice gives the same schema.
DROP TABLE IF EXISTS "DossierReferentEvent";
DROP TABLE IF EXISTS "DossierReferent";
DROP INDEX IF EXISTS "Referral_previous_live_key";
DROP INDEX IF EXISTS "Referral_previous_idx";
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_suggested_check";
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_previous_check";
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_suggested_fkey";
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_previous_fkey";
ALTER TABLE "Referral" DROP COLUMN IF EXISTS "followUpNotifiedAt";
ALTER TABLE "Referral" DROP COLUMN IF EXISTS "suggestedStructureId";
ALTER TABLE "Referral" DROP COLUMN IF EXISTS "previousReferralId";
UPDATE "Referral" SET "responseCode" = 'OTHER' WHERE "responseCode" = 'REDIRECT_SUGGESTED';
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_response_check";
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_response_check" CHECK ("responseCode" IS NULL OR "responseCode" IN ('OUT_OF_SCOPE', 'NO_CAPACITY', 'ALREADY_SUPPORTED', 'NEEDS_MORE_INFORMATION', 'OTHER'));
-- forget the migration too (its journal row, by the journal's « when » of 0047), otherwise a later run believes 0047 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794750000000;
```

Effect: every « référent de parcours » and its history is deleted; the redirect links and suggestions are lost; a decline recorded as `REDIRECT_SUGGESTED` becomes `OTHER`; referrals, their states, dates and `ReferralEvent` history are kept. The code keeps working (it detects the missing objects within a minute, or at once after a restart).

## 7. What the record of a « référent de parcours » is not

A `DossierReferent` row gives **no access** to the dossier and carries **no legal responsibility**. Access is decided by `SharedDossierGrant` alone (`api/_utils/share-access.js` never reads the référent tables — asserted by a unit test); a référent whose organization holds no active grant receives the same 404 as anyone (integration test, including a row written directly as « accepted »). The row becomes effective only with the person's decision (`citizenDecisionAt`, enforced by a CHECK) and the person ends it at any time. The interface calls it a contact person (« personne de contact ») and states that it replaces no legal or contractual designation and creates no obligation of result.
