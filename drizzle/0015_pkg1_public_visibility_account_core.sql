CREATE TABLE "CitizenProfile" (
	"userId" text PRIMARY KEY NOT NULL,
	"displayName" text,
	"preferredLanguage" text DEFAULT 'fr' NOT NULL,
	"ageBand" text,
	"departement" text,
	"accessibilityPrefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prefillConsent" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ContentVerification" (
	"id" text PRIMARY KEY NOT NULL,
	"entityType" text NOT NULL,
	"entityId" text NOT NULL,
	"outcome" text NOT NULL,
	"reviewerId" text NOT NULL,
	"reviewerRole" text NOT NULL,
	"sourceUrl" text,
	"evidenceNote" text,
	"territoryConfirmed" boolean DEFAULT false NOT NULL,
	"verifiedAt" timestamp (3) DEFAULT now() NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "HouseholdMember" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"relation" text NOT NULL,
	"ageBand" text,
	"label" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "NotificationPreference" (
	"userId" text NOT NULL,
	"channel" text NOT NULL,
	"category" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "NotificationPreference_pk" PRIMARY KEY("userId","channel","category")
);
--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN "launch_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN "verification_status" text DEFAULT 'UNVERIFIED' NOT NULL;--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN "verified_by" text;--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN "territory_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN "publication_hold" text;--> statement-breakpoint
ALTER TABLE "Aide" ADD COLUMN "data_origin" text DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE "Demarche" ADD COLUMN "launch_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Demarche" ADD COLUMN "verification_status" text DEFAULT 'UNVERIFIED' NOT NULL;--> statement-breakpoint
ALTER TABLE "Demarche" ADD COLUMN "verified_by" text;--> statement-breakpoint
ALTER TABLE "Demarche" ADD COLUMN "territory_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Demarche" ADD COLUMN "publication_hold" text;--> statement-breakpoint
ALTER TABLE "Demarche" ADD COLUMN "data_origin" text DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE "Dispositif" ADD COLUMN "date_verification" timestamp (3);--> statement-breakpoint
ALTER TABLE "Dispositif" ADD COLUMN "launch_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Dispositif" ADD COLUMN "verification_status" text DEFAULT 'UNVERIFIED' NOT NULL;--> statement-breakpoint
ALTER TABLE "Dispositif" ADD COLUMN "verified_by" text;--> statement-breakpoint
ALTER TABLE "Dispositif" ADD COLUMN "territory_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Dispositif" ADD COLUMN "publication_hold" text;--> statement-breakpoint
ALTER TABLE "Dispositif" ADD COLUMN "data_origin" text DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE "SharedDiagnostic" ADD COLUMN "ownerCitizenId" text;--> statement-breakpoint
ALTER TABLE "Structure" ADD COLUMN "launch_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Structure" ADD COLUMN "verification_status" text DEFAULT 'UNVERIFIED' NOT NULL;--> statement-breakpoint
ALTER TABLE "Structure" ADD COLUMN "verified_by" text;--> statement-breakpoint
ALTER TABLE "Structure" ADD COLUMN "territory_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Structure" ADD COLUMN "publication_hold" text;--> statement-breakpoint
ALTER TABLE "Structure" ADD COLUMN "data_origin" text DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE "CitizenProfile" ADD CONSTRAINT "CitizenProfile_user_fkey" FOREIGN KEY ("userId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_user_fkey" FOREIGN KEY ("userId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_user_fkey" FOREIGN KEY ("userId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ContentVerification_entity_idx" ON "ContentVerification" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX "HouseholdMember_user_idx" ON "HouseholdMember" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "SharedDiagnostic_ownerCitizen_idx" ON "SharedDiagnostic" USING btree ("ownerCitizenId");--> statement-breakpoint
CREATE FUNCTION "ContentVerification_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ContentVerification is append-only' USING ERRCODE = 'integrity_constraint_violation'; END; $$;--> statement-breakpoint
CREATE TRIGGER "ContentVerification_no_update_delete" BEFORE UPDATE OR DELETE ON "ContentVerification" FOR EACH ROW EXECUTE FUNCTION "ContentVerification_append_only"();
