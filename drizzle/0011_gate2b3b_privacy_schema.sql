CREATE TABLE "DSRRequest" (
	"id" text PRIMARY KEY NOT NULL,
	"subjectType" text NOT NULL,
	"subjectId" text NOT NULL,
	"requestType" text NOT NULL,
	"status" text NOT NULL,
	"executionMode" text NOT NULL,
	"affectedDomains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reasonCode" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"completedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "GuardianRelationship" (
	"id" text PRIMARY KEY NOT NULL,
	"minorId" text NOT NULL,
	"guardianId" text NOT NULL,
	"status" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "LegalHold" (
	"id" text PRIMARY KEY NOT NULL,
	"dataCategory" text NOT NULL,
	"recordId" text NOT NULL,
	"reasonCode" text NOT NULL,
	"createdBy" text NOT NULL,
	"status" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"releasedAt" timestamp (3)
);
--> statement-breakpoint
ALTER TABLE "ConsentLog" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "ConsentLog" ADD COLUMN "decision" boolean;--> statement-breakpoint
ALTER TABLE "ConsentLog" ADD COLUMN "withdrawn_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "ConsentLog" ADD COLUMN "superseded_by" text;--> statement-breakpoint
ALTER TABLE "ConsentLog" ADD COLUMN "collection_channel" text;--> statement-breakpoint
ALTER TABLE "ConsentLog" ADD COLUMN "guardian_involved" boolean;--> statement-breakpoint
ALTER TABLE "ConsentLog" ADD COLUMN "proof_level" text;--> statement-breakpoint
ALTER TABLE "SharedDiagnostic" ADD COLUMN "rightsSecretHash" text;--> statement-breakpoint
ALTER TABLE "SharedDiagnostic" ADD COLUMN "privacySubjectId" text;--> statement-breakpoint
ALTER TABLE "SharedDiagnostic" ADD COLUMN "subjectType" text;