CREATE TABLE "StructureDuplicateDecision" (
	"id" text PRIMARY KEY NOT NULL,
	"structureA" text NOT NULL,
	"structureB" text NOT NULL,
	"decision" text NOT NULL,
	"primaryId" text,
	"evidenceUrl" text NOT NULL,
	"note" text NOT NULL,
	"reviewerId" text NOT NULL,
	"versionA" text NOT NULL,
	"versionB" text NOT NULL,
	"decidedAt" timestamp (3) DEFAULT now() NOT NULL,
	"supersededAt" timestamp (3),
	CONSTRAINT "StructureDuplicateDecision_ordered_check" CHECK ("structureA" < "structureB"),
	CONSTRAINT "StructureDuplicateDecision_decision_check" CHECK ("decision" IN ('SAME_ENTITY', 'DISTINCT')),
	CONSTRAINT "StructureDuplicateDecision_primary_check" CHECK (("decision" = 'DISTINCT' AND "primaryId" IS NULL) OR ("decision" = 'SAME_ENTITY' AND "primaryId" IS NOT NULL AND "primaryId" IN ("structureA", "structureB")))
);
--> statement-breakpoint
ALTER TABLE "AdminUser" ADD COLUMN "mfaLastTimeStep" integer;--> statement-breakpoint
ALTER TABLE "AdminUser" ADD COLUMN "displayName" text;--> statement-breakpoint
ALTER TABLE "ContentVerification" ADD COLUMN "contentVersion" text;--> statement-breakpoint
ALTER TABLE "ProUser" ADD COLUMN "mfa_last_time_step" integer;--> statement-breakpoint
ALTER TABLE "StructureDuplicateDecision" ADD CONSTRAINT "StructureDuplicateDecision_a_fkey" FOREIGN KEY ("structureA") REFERENCES "public"."Structure"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StructureDuplicateDecision" ADD CONSTRAINT "StructureDuplicateDecision_b_fkey" FOREIGN KEY ("structureB") REFERENCES "public"."Structure"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "StructureDuplicateDecision_active_pair_key" ON "StructureDuplicateDecision" USING btree ("structureA","structureB") WHERE "supersededAt" IS NULL;