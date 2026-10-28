CREATE TABLE "AiOutputReview" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"entityType" text NOT NULL,
	"entityId" text NOT NULL,
	"field" text NOT NULL,
	"origin" text NOT NULL,
	"model" text,
	"sourceTextHash" text NOT NULL,
	"outputText" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"reviewedBy" text,
	"reviewedAt" timestamp (3),
	"reviewNote" text
);
--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN "falc_reviewed_by" text;--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN "falc_reviewed_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN "falc_origin" text;--> statement-breakpoint
ALTER TABLE "Demarche" ADD COLUMN "falc_reviewed_by" text;--> statement-breakpoint
ALTER TABLE "Demarche" ADD COLUMN "falc_reviewed_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "Demarche" ADD COLUMN "falc_origin" text;--> statement-breakpoint
ALTER TABLE "Structure" ADD COLUMN "falc_reviewed_by" text;--> statement-breakpoint
ALTER TABLE "Structure" ADD COLUMN "falc_reviewed_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "Structure" ADD COLUMN "falc_origin" text;--> statement-breakpoint
CREATE INDEX "AiOutputReview_status_idx" ON "AiOutputReview" USING btree ("status","createdAt");--> statement-breakpoint
ALTER TABLE "AiOutputReview" ADD CONSTRAINT "AiOutputReview_kind_check" CHECK ("kind" IN ('FALC') AND "entityType" IN ('aide', 'demarche', 'structure') AND "field" IN ('summary_falc', 'conditions_falc', 'montant_falc'));--> statement-breakpoint
ALTER TABLE "AiOutputReview" ADD CONSTRAINT "AiOutputReview_origin_check" CHECK ("origin" IN ('AI_LOCAL', 'DETERMINISTIC'));--> statement-breakpoint
ALTER TABLE "AiOutputReview" ADD CONSTRAINT "AiOutputReview_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED') AND ("status" = 'PENDING' OR ("reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "Aide" ADD CONSTRAINT "Aide_falc_review_check" CHECK (("falc_origin" IS NULL OR "falc_origin" IN ('IMPORTED', 'HUMAN', 'AI_LOCAL', 'DETERMINISTIC')) AND (("falc_reviewed_by" IS NULL) = ("falc_reviewed_at" IS NULL)));--> statement-breakpoint
ALTER TABLE "Demarche" ADD CONSTRAINT "Demarche_falc_review_check" CHECK (("falc_origin" IS NULL OR "falc_origin" IN ('IMPORTED', 'HUMAN', 'AI_LOCAL', 'DETERMINISTIC')) AND (("falc_reviewed_by" IS NULL) = ("falc_reviewed_at" IS NULL)));--> statement-breakpoint
ALTER TABLE "Structure" ADD CONSTRAINT "Structure_falc_review_check" CHECK (("falc_origin" IS NULL OR "falc_origin" IN ('IMPORTED', 'HUMAN', 'AI_LOCAL', 'DETERMINISTIC')) AND (("falc_reviewed_by" IS NULL) = ("falc_reviewed_at" IS NULL)));
