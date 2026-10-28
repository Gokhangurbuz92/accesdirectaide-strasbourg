-- Rollback of 0038_launch_retention_measures (launch-readiness items 62 and 66), run BEFORE 0037_down.sql.
-- Effect: the inactivity measurement (CitizenUser.lastSeenAt) and the PENDING e-mail address changes are LOST (no account, dossier or message is touched;
-- an address already changed stays changed). Roll back only with the code.
DROP TABLE IF EXISTS "EmailChangeRequest";
ALTER TABLE "CitizenUser" DROP COLUMN IF EXISTS "lastSeenAt";
