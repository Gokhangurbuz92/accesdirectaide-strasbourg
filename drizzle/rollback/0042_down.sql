-- Rollback of 0042_r31_orientation_funding_pilot (R31), run BEFORE 0041_down.sql.
-- Effect: the professionals' orientation baskets, the funding dossiers with their versions, and the recorded pilot sessions are DELETED. Export the funding
-- dossiers (Markdown) and the pilot aggregates (CSV) first. Roll back only with the code.
DROP TABLE IF EXISTS "ProOrientationBasket";
DROP TABLE IF EXISTS "PilotSession";
DROP TABLE IF EXISTS "FundingDossierVersion";
DROP TABLE IF EXISTS "FundingDossier";
