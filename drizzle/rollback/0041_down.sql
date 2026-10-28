-- Rollback of 0041_r24_member_absences (R24 / owner decision R18.5), run BEFORE 0040_down.sql.
-- Effect: the members' personal absences are DELETED (an absence without its member would become a closure of the whole structure and block public booking);
-- the closures of the whole structure stay; the schedule delegations are lost (administrators keep their rights); pending institutional reset links stop
-- working (administrator-assisted recovery stays). Roll back only with the code.
DROP INDEX IF EXISTS "InstitutionAccount_resetTokenHash_key";
ALTER TABLE "InstitutionAccount" DROP COLUMN IF EXISTS "resetExpiresAt";
ALTER TABLE "InstitutionAccount" DROP COLUMN IF EXISTS "resetTokenHash";
DELETE FROM "ProTimeOff" WHERE "proUserId" IS NOT NULL;
DROP INDEX IF EXISTS "ProTimeOff_proUserId_idx";
ALTER TABLE "ProTimeOff" DROP CONSTRAINT IF EXISTS "ProTimeOff_proUser_fkey";
ALTER TABLE "ProTimeOff" DROP COLUMN IF EXISTS "proUserId";
ALTER TABLE "ProUser" DROP COLUMN IF EXISTS "canManageSchedule";
