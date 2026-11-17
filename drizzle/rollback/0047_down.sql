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
