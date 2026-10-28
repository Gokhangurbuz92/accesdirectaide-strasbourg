-- Rollback of 0035_pkg12_veille_automatique (automatic verification chain: journal of the checks, FALC steps, summary of the last automatic check, levels and
-- attestations of the registry of official sources), run BEFORE 0034_down.sql.
-- Effect: the journal of the automatic checks (VeilleEvent) and the FALC steps are LOST; the decisions themselves stay in the ContentVerification ledger and the
-- registry keeps its entries (without their level and attestation). Roll back only with the code.
DROP INDEX IF EXISTS "VeilleEvent_created_idx";
DROP INDEX IF EXISTS "VeilleEvent_run_idx";
DROP INDEX IF EXISTS "VeilleEvent_entity_idx";
ALTER TABLE "Structure" DROP COLUMN IF EXISTS "auto_check";
ALTER TABLE "SourceRegistryEntry" DROP COLUMN IF EXISTS "attestation_url";
ALTER TABLE "SourceRegistryEntry" DROP COLUMN IF EXISTS "attestation";
ALTER TABLE "SourceRegistryEntry" DROP COLUMN IF EXISTS "level";
ALTER TABLE "Demarche" DROP COLUMN IF EXISTS "auto_check";
ALTER TABLE "Demarche" DROP COLUMN IF EXISTS "etapes_falc";
ALTER TABLE "Aide" DROP COLUMN IF EXISTS "auto_check";
ALTER TABLE "Aide" DROP COLUMN IF EXISTS "etapes_falc";
DROP TABLE IF EXISTS "VeilleEvent";
