-- X04 (expansion, founder authorization 19/11/2026) — Academy and events: editorial pages and dated public events (AcademyItem), and the registration of a
-- signed-in adult citizen to an event (EventRegistration). Number 0053 after 0052 (C8); other expansion branches may claim 0053 too: the integrator orders
-- them. ADDITIVE only: two new tables, their CHECKs, indexes and two foreign keys (registration → event, registration → CitizenUser, both ON DELETE
-- CASCADE: deleting an account — self-service deletion, DSR erasure, purge step 6c — deletes its registrations). No existing table, column, constraint or
-- row changes; nothing is backfilled. AcademyItem holds no personal data (organizer = an organisation name, a public venue). EventRegistration holds the
-- account id, the event id, the state, timestamps and at most ONE accessibility need from a closed list (no free text), cleared on cancellation.
-- Only writer: api/_services/academy-events.js. The code works on a database WITHOUT this migration (the service asks the catalogue): the public pages
-- list nothing, registration answers « not available », the export and the notification centre skip the part. Closed by default anyway: capability
-- « community.events » (outside the AIPD), surface « events » (not opened anywhere). NOT for Production until the owner runs it.
-- Rollback: drizzle/rollback/0053_down.sql. Note: docs/vision/X04_0053_MIGRATION_NOTE.md.
CREATE TABLE "AcademyItem" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"slug" text,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"organizerName" text,
	"startsAt" timestamp (3),
	"endsAt" timestamp (3),
	"registrationClosesAt" timestamp (3),
	"venueName" text,
	"venueAddress" text,
	"venueCommune" text,
	"capacity" integer,
	"accessibilityFeatures" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"accessibilityNote" text,
	"reviewNote" text,
	"statusNote" text,
	"createdBy" text NOT NULL,
	"updatedBy" text NOT NULL,
	"submittedBy" text,
	"approvedBy" text,
	"approvedAt" timestamp (3),
	"publishedAt" timestamp (3),
	"cancelledAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "AcademyItem_kind_check" CHECK ("AcademyItem"."kind" IN ('LESSON', 'EVENT')),
	CONSTRAINT "AcademyItem_status_check" CHECK ("AcademyItem"."status" IN ('draft', 'review', 'published', 'cancelled', 'withdrawn')),
	CONSTRAINT "AcademyItem_capacity_check" CHECK ("AcademyItem"."capacity" IS NULL OR ("AcademyItem"."capacity" >= 1 AND "AcademyItem"."capacity" <= 5000)),
	CONSTRAINT "AcademyItem_dates_check" CHECK ("AcademyItem"."startsAt" IS NULL OR "AcademyItem"."endsAt" IS NULL OR "AcademyItem"."endsAt" > "AcademyItem"."startsAt"),
	CONSTRAINT "AcademyItem_published_check" CHECK ("AcademyItem"."status" IN ('draft', 'review') OR ("AcademyItem"."slug" IS NOT NULL AND "AcademyItem"."publishedAt" IS NOT NULL AND "AcademyItem"."approvedBy" IS NOT NULL)),
	CONSTRAINT "AcademyItem_event_check" CHECK ("AcademyItem"."kind" = 'LESSON' OR "AcademyItem"."status" IN ('draft', 'review') OR ("AcademyItem"."startsAt" IS NOT NULL AND "AcademyItem"."endsAt" IS NOT NULL AND "AcademyItem"."capacity" IS NOT NULL AND "AcademyItem"."venueName" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "EventRegistration" (
	"id" text PRIMARY KEY NOT NULL,
	"itemId" text NOT NULL,
	"citizenUserId" text NOT NULL,
	"status" text DEFAULT 'REGISTERED' NOT NULL,
	"accessibilityNeed" text,
	"accessibilityNeedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"cancelledAt" timestamp (3),
	CONSTRAINT "EventRegistration_status_check" CHECK ("EventRegistration"."status" IN ('REGISTERED', 'CANCELLED')),
	CONSTRAINT "EventRegistration_need_check" CHECK ("EventRegistration"."accessibilityNeed" IS NULL OR "EventRegistration"."accessibilityNeed" IN ('STEP_FREE_ACCESS', 'LSF_INTERPRETATION', 'LIVE_CAPTIONS', 'HEARING_LOOP', 'FALC_MATERIALS', 'LARGE_PRINT_MATERIALS', 'QUIET_SPACE', 'ACCOMPANYING_PERSON')),
	CONSTRAINT "EventRegistration_need_state_check" CHECK (("EventRegistration"."accessibilityNeed" IS NULL) = ("EventRegistration"."accessibilityNeedAt" IS NULL) AND ("EventRegistration"."status" = 'REGISTERED' OR "EventRegistration"."accessibilityNeed" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_item_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."AcademyItem"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_user_fkey" FOREIGN KEY ("citizenUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "AcademyItem_slug_key" ON "AcademyItem" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "AcademyItem_public_idx" ON "AcademyItem" USING btree ("kind","status","startsAt");--> statement-breakpoint
CREATE UNIQUE INDEX "EventRegistration_item_user_key" ON "EventRegistration" USING btree ("itemId","citizenUserId");--> statement-breakpoint
CREATE INDEX "EventRegistration_user_idx" ON "EventRegistration" USING btree ("citizenUserId");