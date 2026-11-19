-- X02 (expansion, founder authorization 19/11/2026) — Testimonials with consent and moderation: a testimonial written by a signed-in adult citizen
-- (Testimonial) and the reports of abuse on a published one (TestimonialReport). Number 0054, AFTER 0053 (X04 academy and events, branch
-- g4-x04-academy-events, on which this branch is stacked): the journal must stay contiguous. ADDITIVE only: two new tables, their CHECKs, indexes and
-- three foreign keys (testimonial → CitizenUser, report → Testimonial, report → CitizenUser, all ON DELETE CASCADE: deleting an account — self-service
-- deletion, DSR erasure, purge step 6c — deletes its testimonials and its reports). No existing table, column, constraint or row changes; nothing is
-- backfilled and NO testimonial is seeded (only real testimonials, written by the persons themselves). The text and the chosen first name / pseudonym
-- exist only while the testimonial is pending or published (CHECK Testimonial_text_state_check): withdrawal, rejection and takedown erase them.
-- The consent proof is a ConsentLog row (existing ledger, purpose TESTIMONIAL_PUBLICATION): no column here duplicates it.
-- Only writer: api/_services/testimonials.js. The code works on a database WITHOUT this migration (the service asks the catalogue): the public list is
-- empty, every write answers 503 TESTIMONIALS_NOT_AVAILABLE, the export section is empty. Closed by default anyway: capability « community.testimonials »
-- (outside the AIPD), surface « testimonials » (not opened anywhere). NOT for Production until the owner runs it.
-- Rollback: drizzle/rollback/0054_down.sql. Note: docs/vision/X02_0054_MIGRATION_NOTE.md.
CREATE TABLE "Testimonial" (
	"id" text PRIMARY KEY NOT NULL,
	"citizenUserId" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"displayName" text,
	"body" text,
	"lang" text NOT NULL,
	"consentVersion" text NOT NULL,
	"moderationReason" text,
	"moderatedBy" text,
	"moderatedAt" timestamp (3),
	"submittedAt" timestamp (3) DEFAULT now() NOT NULL,
	"publishedAt" timestamp (3),
	"withdrawnAt" timestamp (3),
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "Testimonial_status_check" CHECK ("Testimonial"."status" IN ('pending', 'published', 'rejected', 'withdrawn', 'taken_down')),
	CONSTRAINT "Testimonial_lang_check" CHECK ("Testimonial"."lang" IN ('fr', 'en', 'de', 'tr', 'ar', 'uk')),
	CONSTRAINT "Testimonial_text_state_check" CHECK (("Testimonial"."status" IN ('pending', 'published') AND "Testimonial"."body" IS NOT NULL AND "Testimonial"."displayName" IS NOT NULL) OR ("Testimonial"."status" NOT IN ('pending', 'published') AND "Testimonial"."body" IS NULL AND "Testimonial"."displayName" IS NULL)),
	CONSTRAINT "Testimonial_length_check" CHECK (("Testimonial"."body" IS NULL OR char_length("Testimonial"."body") BETWEEN 30 AND 1500) AND ("Testimonial"."displayName" IS NULL OR char_length("Testimonial"."displayName") BETWEEN 2 AND 40)),
	CONSTRAINT "Testimonial_published_check" CHECK ("Testimonial"."status" <> 'published' OR ("Testimonial"."publishedAt" IS NOT NULL AND "Testimonial"."moderatedBy" IS NOT NULL)),
	CONSTRAINT "Testimonial_reason_check" CHECK ("Testimonial"."moderationReason" IS NULL OR "Testimonial"."moderationReason" IN ('HEALTH_DETAIL', 'PERSONAL_DATA', 'OFFENSIVE', 'MISLEADING', 'ADVERTISING', 'OFF_TOPIC'))
);
--> statement-breakpoint
CREATE TABLE "TestimonialReport" (
	"id" text PRIMARY KEY NOT NULL,
	"testimonialId" text NOT NULL,
	"reporterUserId" text NOT NULL,
	"reason" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "TestimonialReport_reason_check" CHECK ("TestimonialReport"."reason" IN ('HEALTH_DETAIL', 'PERSONAL_DATA', 'OFFENSIVE', 'MISLEADING', 'ADVERTISING', 'OFF_TOPIC'))
);
--> statement-breakpoint
ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_user_fkey" FOREIGN KEY ("citizenUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TestimonialReport" ADD CONSTRAINT "TestimonialReport_testimonial_fkey" FOREIGN KEY ("testimonialId") REFERENCES "public"."Testimonial"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TestimonialReport" ADD CONSTRAINT "TestimonialReport_user_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "Testimonial_active_user_key" ON "Testimonial" USING btree ("citizenUserId") WHERE status IN ('pending', 'published');--> statement-breakpoint
CREATE INDEX "Testimonial_public_idx" ON "Testimonial" USING btree ("status","publishedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "TestimonialReport_once_key" ON "TestimonialReport" USING btree ("testimonialId","reporterUserId");--> statement-breakpoint
CREATE INDEX "TestimonialReport_reporter_idx" ON "TestimonialReport" USING btree ("reporterUserId","createdAt");