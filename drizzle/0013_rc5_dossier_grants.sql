CREATE TABLE "SharedDossierGrant" (
	"id" text PRIMARY KEY NOT NULL,
	"sharedDiagnosticId" text NOT NULL,
	"structureId" text NOT NULL,
	"grantedByProUserId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"revokedAt" timestamp (3)
);
--> statement-breakpoint
ALTER TABLE "SharedDiagnostic" ADD COLUMN "shareTokenHash" text;--> statement-breakpoint
ALTER TABLE "SharedDossierGrant" ADD CONSTRAINT "SharedDossierGrant_sharedDiagnostic_fkey" FOREIGN KEY ("sharedDiagnosticId") REFERENCES "public"."SharedDiagnostic"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SharedDossierGrant" ADD CONSTRAINT "SharedDossierGrant_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "SharedDossierGrant_diagnostic_structure_key" ON "SharedDossierGrant" USING btree ("sharedDiagnosticId","structureId");