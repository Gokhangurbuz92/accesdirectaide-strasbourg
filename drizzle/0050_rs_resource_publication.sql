-- C12 (owner decision b, 17/11/2026) — a trustworthy publication path for the documents of /ressources (register P11 / P12). ADDITIVE and idempotent:
-- eight nullable columns on "ResourceAccessibility", one CHECK that holds for every existing row (they all have verified_at NULL), one new append-only
-- ledger table with two CHECKs, one index and one trigger. No existing column, constraint or row is changed; NOTHING is backfilled: rows created before
-- 0050 get no source publisher, no verification date and no reviewer — they are never public until a named administrator completes and verifies them.
-- Only writer: api/_services/resource-publication.js. The code works on a database WITHOUT this migration (api/_utils/schema-features.js
-- resourcePublicationSchema): /ressources then lists no document (as today) and the administration tool answers « not available ».
-- Rollback: drizzle/rollback/0050_down.sql. Note: docs/vision/C12_RESSOURCES_PUBLICATION_MIGRATION_NOTE.md.
CREATE TABLE IF NOT EXISTS "ResourcePublicationEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"resourceId" text NOT NULL,
	"action" text NOT NULL,
	"fromStatus" text,
	"toStatus" text NOT NULL,
	"actorType" text NOT NULL,
	"actorId" text NOT NULL,
	"sourceUrl" text,
	"sourcePublisher" text,
	"contentVersion" text,
	"note" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "ResourcePublicationEvent" DROP CONSTRAINT IF EXISTS "ResourcePublicationEvent_action_check";--> statement-breakpoint
ALTER TABLE "ResourcePublicationEvent" ADD CONSTRAINT "ResourcePublicationEvent_action_check" CHECK ("ResourcePublicationEvent"."action" IN ('CREATE', 'EDIT', 'VERIFY', 'PUBLISH', 'WITHDRAW'));--> statement-breakpoint
ALTER TABLE "ResourcePublicationEvent" DROP CONSTRAINT IF EXISTS "ResourcePublicationEvent_status_check";--> statement-breakpoint
ALTER TABLE "ResourcePublicationEvent" ADD CONSTRAINT "ResourcePublicationEvent_status_check" CHECK ("ResourcePublicationEvent"."toStatus" IN ('draft', 'published', 'withdrawn'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ResourcePublicationEvent_resource_idx" ON "ResourcePublicationEvent" USING btree ("resourceId","createdAt");--> statement-breakpoint
-- append-only: who published, verified or withdrew what, and when, can never be rewritten or erased ("ada_append_only" exists since 0022)
DROP TRIGGER IF EXISTS "ResourcePublicationEvent_append_only" ON "ResourcePublicationEvent";--> statement-breakpoint
CREATE TRIGGER "ResourcePublicationEvent_append_only" BEFORE UPDATE OR DELETE ON "ResourcePublicationEvent" FOR EACH ROW EXECUTE FUNCTION "ada_append_only"();--> statement-breakpoint
ALTER TABLE "ResourceAccessibility" ADD COLUMN IF NOT EXISTS "source_publisher" text;--> statement-breakpoint
ALTER TABLE "ResourceAccessibility" ADD COLUMN IF NOT EXISTS "verified_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "ResourceAccessibility" ADD COLUMN IF NOT EXISTS "reviewer_type" text;--> statement-breakpoint
ALTER TABLE "ResourceAccessibility" ADD COLUMN IF NOT EXISTS "reviewer_id" text;--> statement-breakpoint
ALTER TABLE "ResourceAccessibility" ADD COLUMN IF NOT EXISTS "verified_version" text;--> statement-breakpoint
ALTER TABLE "ResourceAccessibility" ADD COLUMN IF NOT EXISTS "published_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "ResourceAccessibility" ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "ResourceAccessibility" ADD COLUMN IF NOT EXISTS "withdrawal_reason" text;--> statement-breakpoint
-- a verification date never stands alone: it comes with its reviewer, the publisher, the official address and the content version confirmed
ALTER TABLE "ResourceAccessibility" DROP CONSTRAINT IF EXISTS "ResourceAccessibility_verification_check";--> statement-breakpoint
ALTER TABLE "ResourceAccessibility" ADD CONSTRAINT "ResourceAccessibility_verification_check" CHECK ("ResourceAccessibility"."verified_at" IS NULL OR ("ResourceAccessibility"."reviewer_type" IS NOT NULL AND "ResourceAccessibility"."reviewer_id" IS NOT NULL AND "ResourceAccessibility"."source_publisher" IS NOT NULL AND "ResourceAccessibility"."source_url" IS NOT NULL AND "ResourceAccessibility"."verified_version" IS NOT NULL));
