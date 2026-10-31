-- R31: R18 orientation baskets of ADA Pro (ProOrientationBasket), P27 funding-application workspace (FundingDossier + versions), Q14 pilot sessions
-- (PilotSession: no identity, consent required by a CHECK). Additive only: four new tables, no change to an existing one.
CREATE TABLE "FundingDossier" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"funderName" text,
	"programmeName" text,
	"programmeUrl" text,
	"deadline" timestamp (3),
	"status" text DEFAULT 'EN_PREPARATION' NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"decisionRef" text,
	"decisionAt" timestamp (3),
	"submittedAt" timestamp (3),
	"createdBy" text NOT NULL,
	"updatedBy" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "FundingDossierVersion" (
	"id" text PRIMARY KEY NOT NULL,
	"dossierId" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"content" jsonb NOT NULL,
	"savedBy" text NOT NULL,
	"note" text,
	"savedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PilotSession" (
	"id" text PRIMARY KEY NOT NULL,
	"protocolVersion" text NOT NULL,
	"participantCode" text NOT NULL,
	"journeyCode" text NOT NULL,
	"environment" text DEFAULT 'PRODUCTION' NOT NULL,
	"deviceType" text NOT NULL,
	"assistiveTech" text,
	"outcome" text NOT NULL,
	"assistance" text NOT NULL,
	"durationSeconds" integer,
	"errorCount" integer DEFAULT 0 NOT NULL,
	"clarity" integer,
	"accessibilityIssues" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"observation" text,
	"consentRecorded" boolean NOT NULL,
	"conductedAt" timestamp (3) NOT NULL,
	"recordedBy" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PilotSession_consent_check" CHECK ("PilotSession"."consentRecorded" = true)
);
--> statement-breakpoint
CREATE TABLE "ProOrientationBasket" (
	"id" text PRIMARY KEY NOT NULL,
	"structureId" text NOT NULL,
	"ownerProUserId" text,
	"caseId" text,
	"needCodes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"privateEncrypted" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"sharedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "FundingDossierVersion" ADD CONSTRAINT "FundingDossierVersion_dossier_fkey" FOREIGN KEY ("dossierId") REFERENCES "public"."FundingDossier"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProOrientationBasket" ADD CONSTRAINT "ProOrientationBasket_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProOrientationBasket" ADD CONSTRAINT "ProOrientationBasket_owner_fkey" FOREIGN KEY ("ownerProUserId") REFERENCES "public"."ProUser"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProOrientationBasket" ADD CONSTRAINT "ProOrientationBasket_case_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."ProCase"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "FundingDossierVersion_dossier_version_key" ON "FundingDossierVersion" USING btree ("dossierId","version");--> statement-breakpoint
CREATE INDEX "PilotSession_journey_idx" ON "PilotSession" USING btree ("journeyCode","protocolVersion");--> statement-breakpoint
CREATE INDEX "ProOrientationBasket_owner_idx" ON "ProOrientationBasket" USING btree ("structureId","ownerProUserId","status");