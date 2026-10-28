-- Rollback of 0032_pkg11_citizen_session_revocation (PKG-11 audit, citizen session revocation), run BEFORE 0031_down.sql.
-- Effect: citizen sessions revoked by a password reset, an ownership recovery or a logout become valid again until their own 7-day expiry; roll back only with the code.
ALTER TABLE "CitizenUser" DROP COLUMN IF EXISTS "sessionsValidAfter";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792749787352;   -- journal "when" of 0032
