-- PKG-6 rollback of drizzle/0028 (tested by the migration stage): dossier synthesis drafts are forgotten (never published, never part of a dossier), the FALC rules are restored.
DELETE FROM "AiOutputReview" WHERE "kind" = 'DOSSIER_SYNTHESIS';
ALTER TABLE "AiOutputReview" DROP CONSTRAINT IF EXISTS "AiOutputReview_kind_check";
ALTER TABLE "AiOutputReview" ADD CONSTRAINT "AiOutputReview_kind_check" CHECK ("kind" IN ('FALC') AND "entityType" IN ('aide', 'demarche', 'structure') AND "field" IN ('summary_falc', 'conditions_falc', 'montant_falc'));
ALTER TABLE "AiOutputReview" DROP CONSTRAINT IF EXISTS "AiOutputReview_sharedDiagnostic_fkey";
DROP INDEX IF EXISTS "AiOutputReview_sharedDiagnostic_idx";
ALTER TABLE "AiOutputReview" DROP COLUMN IF EXISTS "scopeStructureId", DROP COLUMN IF EXISTS "sharedDiagnosticId";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0028>;
