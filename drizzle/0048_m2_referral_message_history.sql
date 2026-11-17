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
