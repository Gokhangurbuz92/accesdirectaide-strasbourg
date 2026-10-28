-- Rollback of 0039_r11_structure_services_externes (R11 / D05 data·inclusion), run BEFORE 0038_down.sql.
-- Effect: the attributed services read from data·inclusion are LOST (the next veille re-reads them after a re-migration); no structure, identity,
-- verification or audit row is touched. Roll back only with the code.
ALTER TABLE "Structure" DROP COLUMN IF EXISTS "services_externes";
