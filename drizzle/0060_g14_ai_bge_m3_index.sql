-- G14-AI (owner decision 23/11/2026): the semantic index of the aides for the citizen assistant on Cloudflare Workers AI (@cf/baai/bge-m3, 1024 dimensions),
-- beside the local 768-d index (nomic-embed-text, column "embedding"). Additive: three nullable columns and one HNSW index; no row is written here
-- (the index is built by scripts/reindex-embeddings.mjs --provider=workers_ai). Without this migration the assistant ranks lexically.
ALTER TABLE "Aide" ADD COLUMN IF NOT EXISTS "embedding_m3" vector(1024);--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN IF NOT EXISTS "embedding_m3_sha256" text;--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN IF NOT EXISTS "embedding_m3_at" timestamp (3);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Aide_embedding_m3_hnsw_idx" ON "Aide" USING hnsw ("embedding_m3" vector_cosine_ops);
