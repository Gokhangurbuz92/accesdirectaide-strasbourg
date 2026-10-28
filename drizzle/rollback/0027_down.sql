-- PKG-6 rollback of drizzle/0027 (tested by the migration stage): FALC review provenance and pending AI drafts are forgotten (the FALC texts themselves stay).
ALTER TABLE "Structure" DROP CONSTRAINT IF EXISTS "Structure_falc_review_check";
ALTER TABLE "Demarche" DROP CONSTRAINT IF EXISTS "Demarche_falc_review_check";
ALTER TABLE "Aide" DROP CONSTRAINT IF EXISTS "Aide_falc_review_check";
ALTER TABLE "Structure" DROP COLUMN IF EXISTS "falc_origin", DROP COLUMN IF EXISTS "falc_reviewed_at", DROP COLUMN IF EXISTS "falc_reviewed_by";
ALTER TABLE "Demarche" DROP COLUMN IF EXISTS "falc_origin", DROP COLUMN IF EXISTS "falc_reviewed_at", DROP COLUMN IF EXISTS "falc_reviewed_by";
ALTER TABLE "Aide" DROP COLUMN IF EXISTS "falc_origin", DROP COLUMN IF EXISTS "falc_reviewed_at", DROP COLUMN IF EXISTS "falc_reviewed_by";
DROP TABLE IF EXISTS "AiOutputReview";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0027>;
