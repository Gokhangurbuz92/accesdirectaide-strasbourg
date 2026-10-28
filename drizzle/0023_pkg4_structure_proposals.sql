CREATE TABLE "StructureProposal" (
	"id" text PRIMARY KEY NOT NULL,
	"structureId" text NOT NULL,
	"proposedByProUserId" text,
	"field" text NOT NULL,
	"proposedValue" text NOT NULL,
	"previousValue" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reviewedBy" text,
	"reviewedAt" timestamp (3),
	"reviewNote" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "StructureProposal" ADD CONSTRAINT "StructureProposal_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StructureProposal" ADD CONSTRAINT "StructureProposal_author_fkey" FOREIGN KEY ("proposedByProUserId") REFERENCES "public"."ProUser"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "StructureProposal_status_idx" ON "StructureProposal" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "StructureProposal_structure_idx" ON "StructureProposal" USING btree ("structureId");--> statement-breakpoint
ALTER TABLE "StructureProposal" ADD CONSTRAINT "StructureProposal_field_check" CHECK ("field" IN ('adresse', 'code_postal', 'ville', 'horaires', 'telephone', 'email', 'site_web', 'accessibilite_pmr', 'summary_falc', 'service_area'));--> statement-breakpoint
ALTER TABLE "StructureProposal" ADD CONSTRAINT "StructureProposal_status_check" CHECK ("status" IN ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'));--> statement-breakpoint
ALTER TABLE "StructureProposal" ADD CONSTRAINT "StructureProposal_reviewed_check" CHECK (("status" IN ('ACCEPTED', 'REJECTED')) = ("reviewedAt" IS NOT NULL AND "reviewedBy" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "StructureProposal" ADD CONSTRAINT "StructureProposal_value_check" CHECK (length("proposedValue") BETWEEN 1 AND 4000);
--> statement-breakpoint
CREATE UNIQUE INDEX "StructureProposal_pending_key" ON "StructureProposal" ("structureId", "field") WHERE "status" = 'PENDING';
