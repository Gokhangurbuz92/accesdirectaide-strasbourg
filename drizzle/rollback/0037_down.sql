-- Rollback of 0037_pkg12_veille_hardening (health, version and successor of the official sources; automatic check of the dispositifs), run BEFORE 0036_down.sql.
-- Effect: the health history of the sources and the automatic-check records of the dispositifs are LOST (the sources and the dispositifs stay). Roll back only with the code.
ALTER TABLE "Dispositif" DROP CONSTRAINT IF EXISTS "Dispositif_falc_origin_check";
ALTER TABLE "Dispositif" DROP COLUMN IF EXISTS "auto_check";
ALTER TABLE "Dispositif" DROP COLUMN IF EXISTS "falc_origin";
ALTER TABLE "SourceRegistryEntry" DROP COLUMN IF EXISTS "successor_source_id";
ALTER TABLE "SourceRegistryEntry" DROP COLUMN IF EXISTS "redirects";
ALTER TABLE "SourceRegistryEntry" DROP COLUMN IF EXISTS "last_change_at";
ALTER TABLE "SourceRegistryEntry" DROP COLUMN IF EXISTS "content_version";
ALTER TABLE "SourceRegistryEntry" DROP COLUMN IF EXISTS "health";
