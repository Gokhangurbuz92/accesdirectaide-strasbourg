-- PKG-5 batch 2 rollback of drizzle/0026 (tested by the migration stage). Export first: support requests, partner agreements, institution accounts and
-- ownership-recovery cases are forgotten; flag overrides vanish (flags fall back to the environment); legal-hold release proposals are forgotten (holds stay).
ALTER TABLE "LegalHold" DROP CONSTRAINT IF EXISTS "LegalHold_two_person_release_check";
ALTER TABLE "LegalHold" DROP COLUMN IF EXISTS "releasedBy";
ALTER TABLE "LegalHold" DROP COLUMN IF EXISTS "releaseReason";
ALTER TABLE "LegalHold" DROP COLUMN IF EXISTS "releaseProposedAt";
ALTER TABLE "LegalHold" DROP COLUMN IF EXISTS "releaseProposedBy";
DROP TABLE IF EXISTS "OwnershipRecoveryCase";
DROP TABLE IF EXISTS "InstitutionAccount";
DROP TABLE IF EXISTS "PartnerAgreement";
DROP TABLE IF EXISTS "SupportRequest";
DROP TABLE IF EXISTS "FeatureFlagOverride";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0026>;
