CREATE TABLE "SharedDossierInvite" (
	"id" text PRIMARY KEY NOT NULL,
	"sharedDiagnosticId" text NOT NULL,
	"structureId" text NOT NULL,
	"tokenHash" text NOT NULL,
	"purpose" text DEFAULT 'PURP-06' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"usedAt" timestamp (3),
	"usedByProUserId" text,
	"revokedAt" timestamp (3)
);
--> statement-breakpoint
ALTER TABLE "SharedDossierGrant" ADD COLUMN "grantedVia" text DEFAULT 'invite' NOT NULL;--> statement-breakpoint
ALTER TABLE "SharedDossierGrant" ADD COLUMN "inviteId" text;--> statement-breakpoint
ALTER TABLE "SharedDossierGrant" ADD COLUMN "purposes" text DEFAULT 'PURP-06' NOT NULL;--> statement-breakpoint
ALTER TABLE "SharedDossierGrant" ADD COLUMN "purposesUpdatedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "SharedDossierInvite" ADD CONSTRAINT "SharedDossierInvite_sharedDiagnostic_fkey" FOREIGN KEY ("sharedDiagnosticId") REFERENCES "public"."SharedDiagnostic"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SharedDossierInvite" ADD CONSTRAINT "SharedDossierInvite_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "SharedDossierInvite_tokenHash_key" ON "SharedDossierInvite" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "SharedDossierInvite_dossier_structure_idx" ON "SharedDossierInvite" USING btree ("sharedDiagnosticId","structureId");--> statement-breakpoint
CREATE UNIQUE INDEX "SharedDossierInvite_one_pending_key" ON "SharedDossierInvite" USING btree ("sharedDiagnosticId","structureId") WHERE "usedAt" IS NULL AND "revokedAt" IS NULL;