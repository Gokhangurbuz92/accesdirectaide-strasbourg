CREATE TABLE "VeilleEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN "etapes_falc" jsonb;--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN "auto_check" jsonb;--> statement-breakpoint
ALTER TABLE "Demarche" ADD COLUMN "etapes_falc" jsonb;--> statement-breakpoint
ALTER TABLE "Demarche" ADD COLUMN "auto_check" jsonb;--> statement-breakpoint
ALTER TABLE "SourceRegistryEntry" ADD COLUMN "level" text;--> statement-breakpoint
ALTER TABLE "SourceRegistryEntry" ADD COLUMN "attestation" text;--> statement-breakpoint
ALTER TABLE "SourceRegistryEntry" ADD COLUMN "attestation_url" text;--> statement-breakpoint
ALTER TABLE "Structure" ADD COLUMN "auto_check" jsonb;--> statement-breakpoint
CREATE INDEX "VeilleEvent_entity_idx" ON "VeilleEvent" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "VeilleEvent_run_idx" ON "VeilleEvent" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "VeilleEvent_created_idx" ON "VeilleEvent" USING btree ("created_at");