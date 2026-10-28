-- Rollback of 0036_pkg12_demarche_conditions_falc (who a démarche is for, in FALC, written by the automatic verification chain), run BEFORE 0035_down.sql.
-- Effect: the FALC « Pour qui ? » texts of the démarches are LOST (the normal pour_qui stays). Roll back only with the code.
ALTER TABLE "Demarche" DROP COLUMN IF EXISTS "conditions_falc";
