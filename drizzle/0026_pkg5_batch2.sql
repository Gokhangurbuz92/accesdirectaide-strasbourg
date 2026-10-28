CREATE TABLE "FeatureFlagOverride" (
	"key" text PRIMARY KEY NOT NULL,
	"forcedOff" boolean NOT NULL,
	"reason" text NOT NULL,
	"setBy" text NOT NULL,
	"setAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "InstitutionAccount" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"passwordHash" text NOT NULL,
	"organisationName" text NOT NULL,
	"territory" text NOT NULL,
	"status" text DEFAULT 'PENDING_AGREEMENT' NOT NULL,
	"agreementId" text,
	"createdBy" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"lastLogin" timestamp (3),
	"failedLoginAttempts" integer DEFAULT 0 NOT NULL,
	"lockoutUntil" timestamp (3),
	CONSTRAINT "InstitutionAccount_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "OwnershipRecoveryCase" (
	"id" text PRIMARY KEY NOT NULL,
	"citizenUserId" text NOT NULL,
	"newEmailEncrypted" text NOT NULL,
	"evidenceNote" text NOT NULL,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"proposedBy" text NOT NULL,
	"proposedAt" timestamp (3) DEFAULT now() NOT NULL,
	"decidedBy" text,
	"decidedAt" timestamp (3),
	"decisionNote" text
);
--> statement-breakpoint
CREATE TABLE "PartnerAgreement" (
	"id" text PRIMARY KEY NOT NULL,
	"partnerName" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"scope" text,
	"documentRef" text,
	"signedAt" timestamp (3),
	"signedByPartner" text,
	"recordedBy" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"endedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "SupportRequest" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"messageEncrypted" text NOT NULL,
	"contactEncrypted" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"assignedTo" text,
	"resolutionNote" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"closedAt" timestamp (3)
);
--> statement-breakpoint
ALTER TABLE "LegalHold" ADD COLUMN "releaseProposedBy" text;--> statement-breakpoint
ALTER TABLE "LegalHold" ADD COLUMN "releaseProposedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "LegalHold" ADD COLUMN "releaseReason" text;--> statement-breakpoint
ALTER TABLE "LegalHold" ADD COLUMN "releasedBy" text;--> statement-breakpoint
ALTER TABLE "InstitutionAccount" ADD CONSTRAINT "InstitutionAccount_agreement_fkey" FOREIGN KEY ("agreementId") REFERENCES "public"."PartnerAgreement"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OwnershipRecoveryCase" ADD CONSTRAINT "OwnershipRecoveryCase_user_fkey" FOREIGN KEY ("citizenUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "SupportRequest_status_idx" ON "SupportRequest" USING btree ("status","createdAt");--> statement-breakpoint
ALTER TABLE "FeatureFlagOverride" ADD CONSTRAINT "FeatureFlagOverride_key_check" CHECK ("key" IN ('PUBLIC_FEEDBACK', 'SUPPORT_FORM', 'OPEN_DATA_EXPORT') AND "forcedOff" = true);--> statement-breakpoint
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_category_check" CHECK ("category" IN ('ACCOUNT', 'BOOKING', 'CONTENT', 'PRIVACY', 'ACCESSIBILITY', 'OTHER'));--> statement-breakpoint
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_status_check" CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'ANSWERED', 'CLOSED') AND ("status" <> 'CLOSED' OR "closedAt" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "PartnerAgreement" ADD CONSTRAINT "PartnerAgreement_kind_check" CHECK ("kind" IN ('CONVENTION', 'DATA_SHARING', 'OTHER'));--> statement-breakpoint
ALTER TABLE "PartnerAgreement" ADD CONSTRAINT "PartnerAgreement_status_check" CHECK ("status" IN ('DRAFT', 'SIGNED', 'ENDED') AND ("status" = 'DRAFT' OR ("signedAt" IS NOT NULL AND "documentRef" IS NOT NULL AND "signedByPartner" IS NOT NULL)) AND ("status" <> 'ENDED' OR "endedAt" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "InstitutionAccount" ADD CONSTRAINT "InstitutionAccount_status_check" CHECK ("status" IN ('PENDING_AGREEMENT', 'ACTIVE', 'SUSPENDED') AND ("status" <> 'ACTIVE' OR "agreementId" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "OwnershipRecoveryCase" ADD CONSTRAINT "OwnershipRecoveryCase_status_check" CHECK ("status" IN ('PROPOSED', 'APPROVED', 'REJECTED') AND ("status" = 'PROPOSED' OR ("decidedBy" IS NOT NULL AND "decidedAt" IS NOT NULL)) AND ("decidedBy" IS NULL OR "decidedBy" <> "proposedBy"));--> statement-breakpoint
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_two_person_release_check" CHECK ("releasedBy" IS NULL OR ("releaseProposedBy" IS NOT NULL AND "releasedBy" <> "releaseProposedBy"));
