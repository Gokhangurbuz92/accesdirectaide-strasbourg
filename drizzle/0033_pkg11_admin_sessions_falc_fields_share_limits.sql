ALTER TABLE "AdminUser" ADD COLUMN "sessionsValidAfter" timestamp (3);--> statement-breakpoint
ALTER TABLE "AdminUser" ADD COLUMN "disabledAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN "falc_field_reviews" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "Demarche" ADD COLUMN "falc_field_reviews" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "Structure" ADD COLUMN "falc_field_reviews" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "SharedDiagnostic" ADD CONSTRAINT "SharedDiagnostic_situation_size_check" CHECK (octet_length("SharedDiagnostic"."situation"::text) <= 65536);--> statement-breakpoint
ALTER TABLE "SharedDiagnostic" ADD CONSTRAINT "SharedDiagnostic_results_size_check" CHECK (octet_length("SharedDiagnostic"."results"::text) <= 1048576);