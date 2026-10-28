CREATE TABLE "CitizenDocument" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"category" text NOT NULL,
	"filenameEncrypted" text NOT NULL,
	"mimeType" text NOT NULL,
	"byteLength" integer NOT NULL,
	"checksumSha256" text NOT NULL,
	"storageKey" text NOT NULL,
	"scanStatus" text DEFAULT 'NOT_SCANNED' NOT NULL,
	"expiresAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CitizenFavorite" (
	"userId" text NOT NULL,
	"entityType" text NOT NULL,
	"entityId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "CitizenFavorite_pk" PRIMARY KEY("userId","entityType","entityId")
);
--> statement-breakpoint
CREATE TABLE "CitizenHistoryEntry" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"ref" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ParcoursEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"itemId" text NOT NULL,
	"userId" text NOT NULL,
	"kind" text NOT NULL,
	"fromStatus" text,
	"toStatus" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ParcoursItem" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"origin" text NOT NULL,
	"sourceShareId" text,
	"planKey" text,
	"stepKind" text NOT NULL,
	"itemCodes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"dueDate" timestamp (3),
	"dueSourceUrl" text,
	"note" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "CitizenProfile" ADD COLUMN "historyEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "CitizenDocument" ADD CONSTRAINT "CitizenDocument_user_fkey" FOREIGN KEY ("userId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CitizenFavorite" ADD CONSTRAINT "CitizenFavorite_user_fkey" FOREIGN KEY ("userId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CitizenHistoryEntry" ADD CONSTRAINT "CitizenHistoryEntry_user_fkey" FOREIGN KEY ("userId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ParcoursEvent" ADD CONSTRAINT "ParcoursEvent_item_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."ParcoursItem"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ParcoursItem" ADD CONSTRAINT "ParcoursItem_user_fkey" FOREIGN KEY ("userId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ParcoursItem" ADD CONSTRAINT "ParcoursItem_share_fkey" FOREIGN KEY ("sourceShareId") REFERENCES "public"."SharedDiagnostic"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "CitizenDocument_user_idx" ON "CitizenDocument" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "CitizenHistoryEntry_user_idx" ON "CitizenHistoryEntry" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "ParcoursEvent_item_idx" ON "ParcoursEvent" USING btree ("itemId");--> statement-breakpoint
CREATE INDEX "ParcoursItem_user_idx" ON "ParcoursItem" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "ParcoursItem_user_planKey_key" ON "ParcoursItem" USING btree ("userId","planKey");--> statement-breakpoint
ALTER TABLE "ParcoursItem" ADD CONSTRAINT "ParcoursItem_origin_check" CHECK ("origin" IN ('PLAN', 'MANUAL'));--> statement-breakpoint
ALTER TABLE "ParcoursItem" ADD CONSTRAINT "ParcoursItem_stepKind_check" CHECK ("stepKind" IN ('complete', 'verify', 'prepare', 'accompany', 'share', 'urgent', 'custom'));--> statement-breakpoint
ALTER TABLE "ParcoursItem" ADD CONSTRAINT "ParcoursItem_status_check" CHECK ("status" IN ('NOT_STARTED', 'IN_PROGRESS', 'DOCUMENTS_REQUIRED', 'READY', 'SUBMITTED', 'WAITING_ORGANIZATION', 'ADDITIONAL_INFORMATION', 'DECISION_POSITIVE', 'DECISION_NEGATIVE', 'CLOSED'));--> statement-breakpoint
ALTER TABLE "ParcoursItem" ADD CONSTRAINT "ParcoursItem_due_source_check" CHECK ("dueDate" IS NULL OR ("dueSourceUrl" IS NOT NULL AND "dueSourceUrl" LIKE 'https://%'));--> statement-breakpoint
ALTER TABLE "ParcoursItem" ADD CONSTRAINT "ParcoursItem_plan_origin_check" CHECK ("origin" = 'MANUAL' OR "planKey" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "ParcoursEvent" ADD CONSTRAINT "ParcoursEvent_kind_check" CHECK ("kind" IN ('CREATED', 'STATUS', 'DEADLINE', 'NOTE'));--> statement-breakpoint
ALTER TABLE "CitizenFavorite" ADD CONSTRAINT "CitizenFavorite_entityType_check" CHECK ("entityType" IN ('aide', 'demarche', 'structure'));--> statement-breakpoint
ALTER TABLE "CitizenHistoryEntry" ADD CONSTRAINT "CitizenHistoryEntry_kind_check" CHECK ("kind" IN ('search', 'aide', 'demarche', 'structure', 'diagnostic', 'plan'));--> statement-breakpoint
ALTER TABLE "CitizenDocument" ADD CONSTRAINT "CitizenDocument_category_check" CHECK ("category" IN ('identite', 'revenus', 'logement', 'famille', 'sante', 'emploi', 'autre'));--> statement-breakpoint
ALTER TABLE "CitizenDocument" ADD CONSTRAINT "CitizenDocument_scan_check" CHECK ("scanStatus" IN ('NOT_SCANNED', 'CLEAN', 'QUARANTINED'));--> statement-breakpoint
ALTER TABLE "CitizenDocument" ADD CONSTRAINT "CitizenDocument_size_check" CHECK ("byteLength" > 0 AND "byteLength" <= 10485760);--> statement-breakpoint
CREATE FUNCTION "ParcoursEvent_no_update"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ParcoursEvent is append-only' USING ERRCODE = 'integrity_constraint_violation'; END; $$;--> statement-breakpoint
CREATE TRIGGER "ParcoursEvent_append_only" BEFORE UPDATE ON "ParcoursEvent" FOR EACH ROW EXECUTE FUNCTION "ParcoursEvent_no_update"();
