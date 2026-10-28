ALTER TABLE "AiOutputReview" ADD COLUMN "sharedDiagnosticId" text;--> statement-breakpoint
ALTER TABLE "AiOutputReview" ADD COLUMN "scopeStructureId" text;--> statement-breakpoint
ALTER TABLE "AiOutputReview" ADD CONSTRAINT "AiOutputReview_sharedDiagnostic_fkey" FOREIGN KEY ("sharedDiagnosticId") REFERENCES "public"."SharedDiagnostic"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AiOutputReview_sharedDiagnostic_idx" ON "AiOutputReview" USING btree ("sharedDiagnosticId","scopeStructureId");--> statement-breakpoint
ALTER TABLE "AiOutputReview" DROP CONSTRAINT "AiOutputReview_kind_check";--> statement-breakpoint
ALTER TABLE "AiOutputReview" ADD CONSTRAINT "AiOutputReview_kind_check" CHECK (("kind" = 'FALC' AND "entityType" IN ('aide', 'demarche', 'structure') AND "field" IN ('summary_falc', 'conditions_falc', 'montant_falc') AND "sharedDiagnosticId" IS NULL AND "scopeStructureId" IS NULL) OR ("kind" = 'DOSSIER_SYNTHESIS' AND "entityType" = 'shared_diagnostic' AND "field" = 'synthesis' AND "origin" = 'AI_LOCAL' AND "sharedDiagnosticId" IS NOT NULL AND "sharedDiagnosticId" = "entityId" AND "scopeStructureId" IS NOT NULL));
