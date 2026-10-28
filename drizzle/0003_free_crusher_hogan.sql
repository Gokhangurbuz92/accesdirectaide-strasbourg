ALTER TABLE "Aide" ADD COLUMN "embedding" vector(768);--> statement-breakpoint
CREATE INDEX "Aide_embedding_hnsw_idx" ON "Aide" USING hnsw ("embedding" vector_cosine_ops);