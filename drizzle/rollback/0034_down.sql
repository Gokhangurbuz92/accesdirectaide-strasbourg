-- Rollback of 0034_pkg11_owner_lab_review_integrity (owner LAB audit: a TOTP code is accepted once, administrators and professionals; the verification ledger
-- records which content version a decision approved; an administrator account carries the name of the person who holds it; D13 duplicate register),
-- run BEFORE 0033_down.sql.
-- Effect: an MFA code already used could again be accepted a second time within its 30-90 s validity window (RFC 6238 §5.2 replay); the ledger forgets
-- which content version each decision of this period approved; administrator accounts lose the holder's name; the duplicate decisions are LOST (the holds
-- they placed stay in the verification ledger). Professional MFA seeds sealed with the vault (« v1:… ») stay sealed: the code that reads them must stay too.
-- Roll back only with the code.
DROP TABLE IF EXISTS "StructureDuplicateDecision";
ALTER TABLE "ProUser" DROP COLUMN IF EXISTS "mfa_last_time_step";
ALTER TABLE "ContentVerification" DROP COLUMN IF EXISTS "contentVersion";
ALTER TABLE "AdminUser" DROP COLUMN IF EXISTS "displayName";
ALTER TABLE "AdminUser" DROP COLUMN IF EXISTS "mfaLastTimeStep";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792818796525;   -- journal "when" of 0034
