-- PKG-11 rollback of drizzle/0029 (tested by the migration stage): sessions revoked by a logout / password reset become valid again until their own expiry (8 h) — roll back only with the code.
ALTER TABLE "ProUser" DROP COLUMN IF EXISTS "sessionsValidAfter";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0029>;
