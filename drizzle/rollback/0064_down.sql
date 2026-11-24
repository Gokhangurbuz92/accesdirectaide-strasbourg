-- Rollback of 0064_r3g_legal_protection (G14-R3G: representative of a protected adult). Journal idx 64 since release 3 (g14-r3).
-- Dropping the table ends every link at once (no representative can see or do anything any more); the history of what was done stays in "AuditLog"
-- under its own rule. Idempotent: a second run changes nothing.
DROP TABLE IF EXISTS "LegalProtectionMandate";
-- forget the migration too (journal « when » 1795060000000)
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795060000000;
