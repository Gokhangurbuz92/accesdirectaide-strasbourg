-- PKG-4 rollback of drizzle/0022_pkg4_cases_referrals.sql (documentation + tested by the migration stage). Drops cases, case notes and referrals with their history.
-- Grants created by referrals stay (they are citizen-authorized grants); the grantedVia CHECK is removed so older code keeps working.
DROP TABLE IF EXISTS "ReferralEvent";
DROP TABLE IF EXISTS "Referral";
DROP TABLE IF EXISTS "ProCaseNote";
DROP TABLE IF EXISTS "ProCaseEvent";
DROP TABLE IF EXISTS "ProCase";
DROP FUNCTION IF EXISTS "ada_append_only"();
ALTER TABLE "SharedDossierGrant" DROP CONSTRAINT IF EXISTS "SharedDossierGrant_via_check";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0022>;
