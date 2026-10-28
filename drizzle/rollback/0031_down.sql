-- Rollback of 0031_pkg11_retrieval_relations (PKG-11 / D16 + P09), run BEFORE 0030_down.sql.
-- Effect: the embedding staleness markers and the dispositif links to aides / structures are dropped (the embeddings themselves stay); roll back only with the code.
ALTER TABLE "Dispositif" DROP COLUMN IF EXISTS "related_structure_ids";
ALTER TABLE "Dispositif" DROP COLUMN IF EXISTS "related_aide_ids";
ALTER TABLE "Aide" DROP COLUMN IF EXISTS "embedded_at";
ALTER TABLE "Aide" DROP COLUMN IF EXISTS "embedded_text_sha256";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792743987428;   -- journal "when" of 0031
