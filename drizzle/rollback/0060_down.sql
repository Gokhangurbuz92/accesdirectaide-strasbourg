-- Rollback of 0060_g14_ai_bge_m3_index (G14-AI bge-m3 index of the aides). Independent of 0053–0059. Only derived data is dropped (vectors recomputable
-- from the public fiches with scripts/reindex-embeddings.mjs --provider=workers_ai). Idempotent: a second run changes nothing.
DROP INDEX IF EXISTS "Aide_embedding_m3_hnsw_idx";
ALTER TABLE "Aide" DROP COLUMN IF EXISTS "embedding_m3_at";
ALTER TABLE "Aide" DROP COLUMN IF EXISTS "embedding_m3_sha256";
ALTER TABLE "Aide" DROP COLUMN IF EXISTS "embedding_m3";
-- forget the migration too (its journal row, by the journal's « when » of 0060)
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795020000000;
