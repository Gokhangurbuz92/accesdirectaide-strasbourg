ALTER TABLE "Dispositif" ADD COLUMN "falc_origin" text;--> statement-breakpoint
ALTER TABLE "Dispositif" ADD COLUMN "auto_check" jsonb;--> statement-breakpoint
ALTER TABLE "SourceRegistryEntry" ADD COLUMN "health" jsonb;--> statement-breakpoint
ALTER TABLE "SourceRegistryEntry" ADD COLUMN "content_version" text;--> statement-breakpoint
ALTER TABLE "SourceRegistryEntry" ADD COLUMN "last_change_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "SourceRegistryEntry" ADD COLUMN "redirects" jsonb;--> statement-breakpoint
ALTER TABLE "SourceRegistryEntry" ADD COLUMN "successor_source_id" text;--> statement-breakpoint
ALTER TABLE "Dispositif" ADD CONSTRAINT "Dispositif_falc_origin_check" CHECK ("falc_origin" IS NULL OR "falc_origin" IN ('IMPORTED', 'HUMAN', 'AI_LOCAL', 'DETERMINISTIC'));