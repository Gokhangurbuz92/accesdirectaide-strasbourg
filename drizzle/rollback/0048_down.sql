-- Rollback of 0048_m2_referral_message_history (M2 add-on / B01). Run on its own, or BEFORE 0047_down.sql when both are rolled back.
-- Data effect: "ReferralMessage" is DROPPED — the history of the texts exchanged on referrals is lost; the CURRENT text of each side stays in
-- "Referral"."messageEncrypted" / "responseMessageEncrypted", which this migration never altered. Export the table first if the history is needed
-- (`COPY (SELECT * FROM "ReferralMessage") TO STDOUT WITH CSV HEADER` — ciphertext only). After it the code keeps working: it writes no history again.
-- Idempotent: running it twice gives the same schema.
DROP TABLE IF EXISTS "ReferralMessage";
DROP FUNCTION IF EXISTS "ada_referral_message_guard"();
-- forget the migration too (its journal row, by the journal's « when » of 0048), otherwise a later run believes 0048 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794750600000;
