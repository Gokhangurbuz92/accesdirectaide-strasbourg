-- Rollback of 0058_g12_sole_admin_checks (G12 single-administrator approval for legal-hold release and ownership recovery). Independent of 0053–0057.
-- REFUSED while a row was decided by its proposer as sole administrator (the restored two-person CHECK would reject it): nothing changes then.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "LegalHold" WHERE "releaseSoleAdministrator") OR EXISTS (SELECT 1 FROM "OwnershipRecoveryCase" WHERE "soleAdministrator") THEN
    RAISE EXCEPTION '0058_down refused: a legal-hold release or an ownership recovery was decided by the sole administrator';
  END IF;
END $$;
ALTER TABLE "LegalHold" DROP CONSTRAINT "LegalHold_two_person_release_check";
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_two_person_release_check" CHECK ("releasedBy" IS NULL OR ("releaseProposedBy" IS NOT NULL AND "releasedBy" <> "releaseProposedBy"));
ALTER TABLE "OwnershipRecoveryCase" DROP CONSTRAINT "OwnershipRecoveryCase_status_check";
ALTER TABLE "OwnershipRecoveryCase" ADD CONSTRAINT "OwnershipRecoveryCase_status_check" CHECK ("status" IN ('PROPOSED', 'APPROVED', 'REJECTED') AND ("status" = 'PROPOSED' OR ("decidedBy" IS NOT NULL AND "decidedAt" IS NOT NULL)) AND ("decidedBy" IS NULL OR "decidedBy" <> "proposedBy"));
ALTER TABLE "LegalHold" DROP COLUMN "releaseSoleAdministrator";
ALTER TABLE "OwnershipRecoveryCase" DROP COLUMN "soleAdministrator";
-- forget the migration too (its journal row, by the journal's « when » of 0058)
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795000000000;
