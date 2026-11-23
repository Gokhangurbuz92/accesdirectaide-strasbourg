-- G14-PS (owner decision 23/11/2026: « we do not host health data and we pay nothing ») — the SOCIAL referral (« orientation sociale »), non-HDS by
-- construction: closed reasons (1 to 3, CHECK), no free-text column, no document column, closed decline motives (CHECK), only between organisations the
-- server classifies NOT_ESSMS (api/lib/social-referral-policy.js). Number 0061: 0060 is taken by branch g14-ai (0060_g14_ai_bge_m3_index). Journaled at
-- the g14-r2 integration (idx 61, « when » 1795030000000, between 0060 and 0062; snapshot drizzle/meta/0061_snapshot.json). ADDITIVE and idempotent:
-- two new tables, their CHECKs, indexes, foreign keys and the append-only trigger of the history (function "ada_append_only" from 0022). No existing table,
-- column, constraint or row changes; nothing is backfilled or seeded. "Referral" (the HDS referral of a dossier) is untouched.
-- Only writer: api/_services/social-referrals.js. The code works WITHOUT this migration: every route answers 503 SOCIAL_REFERRALS_NOT_AVAILABLE and
-- the timeouts job skips it. NOT for Production until the owner runs it. Rollback: drizzle/rollback/0061_down.sql.
CREATE TABLE IF NOT EXISTS "SocialReferral" (
	"id" text PRIMARY KEY NOT NULL,
	"fromStructureId" text NOT NULL,
	"toStructureId" text NOT NULL,
	"createdByProUserId" text,
	"citizenId" text,
	"status" text DEFAULT 'PENDING_CITIZEN' NOT NULL,
	"reasonCodes" text[] NOT NULL,
	"responseCode" text,
	"claimCodeHash" text,
	"claimExpiresAt" timestamp (3),
	"shareEmail" boolean DEFAULT false NOT NULL,
	"sharePhone" boolean DEFAULT false NOT NULL,
	"consentChannel" text,
	"citizenDecisionAt" timestamp (3),
	"sentAt" timestamp (3),
	"dueAt" timestamp (3),
	"overdueNotifiedAt" timestamp (3),
	"respondedAt" timestamp (3),
	"closedAt" timestamp (3),
	"idempotencyKey" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "SocialReferral_claimCodeHash_unique" UNIQUE("claimCodeHash")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "SocialReferralEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"referralId" text NOT NULL,
	"actorType" text NOT NULL,
	"actorId" text,
	"fromStatus" text,
	"toStatus" text NOT NULL,
	"channel" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "SocialReferral" DROP CONSTRAINT IF EXISTS "SocialReferral_from_fkey";--> statement-breakpoint
ALTER TABLE "SocialReferral" ADD CONSTRAINT "SocialReferral_from_fkey" FOREIGN KEY ("fromStructureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SocialReferral" DROP CONSTRAINT IF EXISTS "SocialReferral_to_fkey";--> statement-breakpoint
ALTER TABLE "SocialReferral" ADD CONSTRAINT "SocialReferral_to_fkey" FOREIGN KEY ("toStructureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SocialReferral" DROP CONSTRAINT IF EXISTS "SocialReferral_creator_fkey";--> statement-breakpoint
ALTER TABLE "SocialReferral" ADD CONSTRAINT "SocialReferral_creator_fkey" FOREIGN KEY ("createdByProUserId") REFERENCES "public"."ProUser"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SocialReferral" DROP CONSTRAINT IF EXISTS "SocialReferral_citizen_fkey";--> statement-breakpoint
ALTER TABLE "SocialReferral" ADD CONSTRAINT "SocialReferral_citizen_fkey" FOREIGN KEY ("citizenId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SocialReferralEvent" DROP CONSTRAINT IF EXISTS "SocialReferralEvent_referral_fkey";--> statement-breakpoint
ALTER TABLE "SocialReferralEvent" ADD CONSTRAINT "SocialReferralEvent_referral_fkey" FOREIGN KEY ("referralId") REFERENCES "public"."SocialReferral"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "SocialReferral_idempotency_key" ON "SocialReferral" USING btree ("fromStructureId","idempotencyKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SocialReferral_to_status_idx" ON "SocialReferral" USING btree ("toStructureId","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SocialReferral_from_idx" ON "SocialReferral" USING btree ("fromStructureId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SocialReferral_citizen_idx" ON "SocialReferral" USING btree ("citizenId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SocialReferralEvent_referral_idx" ON "SocialReferralEvent" USING btree ("referralId","createdAt");--> statement-breakpoint
ALTER TABLE "SocialReferral" DROP CONSTRAINT IF EXISTS "SocialReferral_status_check";--> statement-breakpoint
ALTER TABLE "SocialReferral" ADD CONSTRAINT "SocialReferral_status_check" CHECK ("status" IN ('PENDING_CITIZEN', 'SENT', 'ACCEPTED', 'DECLINED', 'COMPLETED', 'CANCELLED', 'WITHDRAWN', 'EXPIRED', 'CLOSED'));--> statement-breakpoint
-- closed reasons: 1 to 3 codes of the list (no health, disability, sexual life, penal, residence, violence, child protection or legal protection code exists)
ALTER TABLE "SocialReferral" DROP CONSTRAINT IF EXISTS "SocialReferral_reasons_check";--> statement-breakpoint
ALTER TABLE "SocialReferral" ADD CONSTRAINT "SocialReferral_reasons_check" CHECK (cardinality("reasonCodes") BETWEEN 1 AND 3 AND "reasonCodes" <@ ARRAY['HOUSING', 'EMPLOYMENT', 'TRAINING', 'INCOME_BUDGET', 'ENERGY', 'ADMIN_PROCEDURES', 'ACCESS_TO_RIGHTS', 'MOBILITY', 'DIGITAL', 'FOOD']::text[]);--> statement-breakpoint
ALTER TABLE "SocialReferral" DROP CONSTRAINT IF EXISTS "SocialReferral_response_check";--> statement-breakpoint
ALTER TABLE "SocialReferral" ADD CONSTRAINT "SocialReferral_response_check" CHECK (("responseCode" IS NULL AND "status" <> 'DECLINED') OR ("status" = 'DECLINED' AND "responseCode" IS NOT NULL AND "responseCode" IN ('OUT_OF_SCOPE', 'NO_CAPACITY', 'ALREADY_SUPPORTED', 'OUT_OF_TERRITORY')));--> statement-breakpoint
ALTER TABLE "SocialReferral" DROP CONSTRAINT IF EXISTS "SocialReferral_channel_check";--> statement-breakpoint
ALTER TABLE "SocialReferral" ADD CONSTRAINT "SocialReferral_channel_check" CHECK ("consentChannel" IS NULL OR "consentChannel" IN ('MON_ESPACE', 'ASSISTED_ON_SCREEN'));--> statement-breakpoint
ALTER TABLE "SocialReferral" DROP CONSTRAINT IF EXISTS "SocialReferral_distinct_check";--> statement-breakpoint
ALTER TABLE "SocialReferral" ADD CONSTRAINT "SocialReferral_distinct_check" CHECK ("fromStructureId" <> "toStructureId");--> statement-breakpoint
-- the person's agreement is a fact of the row: never sent without who consented, when and through which channel
ALTER TABLE "SocialReferral" DROP CONSTRAINT IF EXISTS "SocialReferral_consent_check";--> statement-breakpoint
ALTER TABLE "SocialReferral" ADD CONSTRAINT "SocialReferral_consent_check" CHECK ("status" NOT IN ('SENT', 'ACCEPTED', 'DECLINED', 'COMPLETED', 'WITHDRAWN') OR ("citizenId" IS NOT NULL AND "citizenDecisionAt" IS NOT NULL AND "consentChannel" IS NOT NULL AND "sentAt" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "SocialReferral" DROP CONSTRAINT IF EXISTS "SocialReferral_closed_check";--> statement-breakpoint
ALTER TABLE "SocialReferral" ADD CONSTRAINT "SocialReferral_closed_check" CHECK (("status" IN ('PENDING_CITIZEN', 'SENT', 'ACCEPTED')) = ("closedAt" IS NULL));--> statement-breakpoint
ALTER TABLE "SocialReferralEvent" DROP CONSTRAINT IF EXISTS "SocialReferralEvent_actor_check";--> statement-breakpoint
ALTER TABLE "SocialReferralEvent" ADD CONSTRAINT "SocialReferralEvent_actor_check" CHECK ("actorType" IN ('SENDER', 'RECEIVER', 'CITIZEN', 'SYSTEM'));--> statement-breakpoint
DROP TRIGGER IF EXISTS "SocialReferralEvent_append_only" ON "SocialReferralEvent";--> statement-breakpoint
CREATE TRIGGER "SocialReferralEvent_append_only" BEFORE UPDATE ON "SocialReferralEvent" FOR EACH ROW EXECUTE FUNCTION "ada_append_only"();
