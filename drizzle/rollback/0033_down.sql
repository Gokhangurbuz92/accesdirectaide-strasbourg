-- Rollback of 0033_pkg11_admin_sessions_falc_fields_share_limits (PKG-11: ADM-10 administrator session revocation, ADM-11 field-level FALC review,
-- PUB-6 dossier size limits), run BEFORE 0032_down.sql.
-- Effect: administrator sessions revoked by a logout, a password change or another administrator become valid again until their own 8-hour expiry, and a
-- disabled administrator's existing sessions too; the per-field FALC review records are forgotten (the record-level falc_reviewed_at stays); shared dossiers
-- are no longer size-bounded. Roll back only with the code.
ALTER TABLE "SharedDiagnostic" DROP CONSTRAINT IF EXISTS "SharedDiagnostic_results_size_check";
ALTER TABLE "SharedDiagnostic" DROP CONSTRAINT IF EXISTS "SharedDiagnostic_situation_size_check";
ALTER TABLE "Structure" DROP COLUMN IF EXISTS "falc_field_reviews";
ALTER TABLE "Demarche" DROP COLUMN IF EXISTS "falc_field_reviews";
ALTER TABLE "Aide" DROP COLUMN IF EXISTS "falc_field_reviews";
ALTER TABLE "AdminUser" DROP COLUMN IF EXISTS "disabledAt";
ALTER TABLE "AdminUser" DROP COLUMN IF EXISTS "sessionsValidAfter";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792803516631;   -- journal "when" of 0033
