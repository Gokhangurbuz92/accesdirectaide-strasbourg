-- X05 (expansion, founder authorization 19/11/2026) — Inclusive employment job board: the listings of EMPLOYERS that ADA verified (an existing Structure
-- with statut 'actif' AND verification_status 'VERIFIED' — the organization verification of E01, by an ADA reviewer with MFA, audited). Number 0056, AFTER
-- 0055 (X01, itself after 0054 X02 and 0053 X04): the journal must stay contiguous. ADDITIVE only: one new table "JobListing", its CHECKs, two indexes and one
-- foreign key (listing → Structure, ON DELETE CASCADE). No existing table, column, constraint or row changes; nothing is backfilled and NO listing is seeded.
-- Lifecycle in « status »: draft → pending (moderation) → published → expired (its own end date « expiresOn »), or rejected / withdrawn / taken_down.
-- APPLICANTS: none. The listing names the employer's OWN application channel (an https address or an e-mail address, CHECK JobListing_apply_check); ADA keeps
-- no applicant, no application, no click. No column for a discriminatory criterion exists (Code du travail L1132-1; the service refuses such fields) and no
-- column names the professional who wrote the listing (the audit trail does).
-- Only writer: api/_services/job-board.js. The code works on a database WITHOUT this migration (the service asks the catalogue): the public list is empty,
-- every write answers 503 JOBS_NOT_AVAILABLE. Closed by default anyway: capability « community.employment » (outside the AIPD), surface « employment » (not
-- opened anywhere). NOT for Production until the owner runs it (after 0053, 0054 and 0055).
-- Rollback: drizzle/rollback/0056_down.sql. Note: docs/vision/X05_0056_MIGRATION_NOTE.md.
CREATE TABLE "JobListing" (
	"id" text PRIMARY KEY NOT NULL,
	"structureId" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"contractType" text NOT NULL,
	"city" text NOT NULL,
	"postalCode" text NOT NULL,
	"description" text NOT NULL,
	"accommodations" text[] NOT NULL,
	"applyMethod" text NOT NULL,
	"applyTarget" text NOT NULL,
	"expiresOn" date NOT NULL,
	"moderationReason" text,
	"moderatedBy" text,
	"moderatedAt" timestamp (3),
	"submittedAt" timestamp (3),
	"publishedAt" timestamp (3),
	"withdrawnAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "JobListing_status_check" CHECK ("JobListing"."status" IN ('draft', 'pending', 'published', 'rejected', 'withdrawn', 'taken_down', 'expired')),
	CONSTRAINT "JobListing_contract_check" CHECK ("JobListing"."contractType" IN ('CDI', 'CDD', 'CDDI', 'INTERIM', 'APPRENTISSAGE', 'PROFESSIONNALISATION', 'STAGE')),
	CONSTRAINT "JobListing_length_check" CHECK (char_length("JobListing"."title") BETWEEN 5 AND 120 AND char_length("JobListing"."city") BETWEEN 2 AND 80 AND char_length("JobListing"."description") BETWEEN 50 AND 3000),
	CONSTRAINT "JobListing_postal_check" CHECK ("JobListing"."postalCode" ~ '^[0-9]{5}$'),
	CONSTRAINT "JobListing_accommodations_check" CHECK (cardinality("JobListing"."accommodations") BETWEEN 1 AND 10 AND "JobListing"."accommodations" <@ ARRAY['STEP_FREE_ACCESS', 'ADAPTED_WORKSTATION', 'FLEXIBLE_HOURS', 'PART_TIME_POSSIBLE', 'TUTOR_SUPPORT', 'EASY_READ_INSTRUCTIONS', 'SIGN_LANGUAGE_INTERPRETING', 'NO_DIPLOMA_REQUIRED', 'BEGINNERS_WELCOME', 'PUBLIC_TRANSPORT_ACCESS']::text[]),
	CONSTRAINT "JobListing_apply_check" CHECK ("JobListing"."applyMethod" IN ('url', 'email') AND char_length("JobListing"."applyTarget") BETWEEN 6 AND 300 AND ("JobListing"."applyMethod" <> 'url' OR "JobListing"."applyTarget" ~ '^https://')),
	CONSTRAINT "JobListing_published_check" CHECK ("JobListing"."status" <> 'published' OR ("JobListing"."publishedAt" IS NOT NULL AND "JobListing"."moderatedBy" IS NOT NULL)),
	CONSTRAINT "JobListing_reason_check" CHECK ("JobListing"."moderationReason" IS NULL OR "JobListing"."moderationReason" IN ('DISCRIMINATORY_CRITERION', 'MISLEADING_OR_ENTITLEMENT', 'HEALTH_DATA_REQUESTED', 'APPLICATION_CHANNEL', 'NOT_A_JOB_OFFER', 'INCOMPLETE'))
);
--> statement-breakpoint
ALTER TABLE "JobListing" ADD CONSTRAINT "JobListing_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "JobListing_structure_idx" ON "JobListing" USING btree ("structureId","createdAt");--> statement-breakpoint
CREATE INDEX "JobListing_public_idx" ON "JobListing" USING btree ("status","expiresOn");