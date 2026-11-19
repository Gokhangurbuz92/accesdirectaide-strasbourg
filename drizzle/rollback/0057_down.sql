-- Rollback of 0057_x03_entraide (X03 Entraide). Independent of every other migration (0053–0056 included).
-- Effect: every Entraide pseudonym, offer, request, shared e-mail, report and block is DELETED with the six tables. The consent proofs (charter, shared
-- e-mails) stay in ConsentLog (append-only ledger, its own retention). Export a copy first if needed. The code then behaves as on a database without 0057
-- (« not available », nothing listed, empty export sections).
DROP TABLE IF EXISTS "EntraideBlock";
DROP TABLE IF EXISTS "EntraideReport";
DROP TABLE IF EXISTS "EntraideContactShare";
DROP TABLE IF EXISTS "EntraideRequest";
DROP TABLE IF EXISTS "EntraideOffer";
DROP TABLE IF EXISTS "EntraideMember";
-- forget the migration too (its journal row, by the journal's « when » of 0057), otherwise a later run believes 0057 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794990000000;
