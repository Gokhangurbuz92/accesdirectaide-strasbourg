ALTER TABLE "Aide" ADD COLUMN "embedded_text_sha256" text;--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN "embedded_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "Dispositif" ADD COLUMN "related_aide_ids" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "Dispositif" ADD COLUMN "related_structure_ids" text[] DEFAULT '{}' NOT NULL;