-- M2 (R07 R09 R10 R11 R12 E06) — referral redirect (G3), follow-up notice (G4) and « référent de parcours » (G5). ADDITIVE and idempotent: three nullable
-- columns on "Referral", one CHECK widened ("Referral_response_check" gains REDIRECT_SUGGESTED), two new tables. No existing row is rewritten; every new
-- column is NULL on existing rows. The code works on a database WITHOUT this migration (api/_utils/schema-features.js: the redirect, the follow-up notice
-- and the référent answer « not available » and every earlier path is unchanged). Rollback: drizzle/rollback/0047_down.sql. Note: docs/vision/M2_MIGRATION_NOTE.md.
--
-- Redirect: a receiver that declines may name another organization ("suggestedStructureId", an identifier only — nothing is disclosed to that organization).
-- A NEW referral proposed afterwards points to the declined one ("previousReferralId") and starts at PENDING_CITIZEN like any other: only the person's
-- authorization creates the new receiver's access. No status is added: a redirect is a DECLINED referral whose "responseCode" is REDIRECT_SUGGESTED.
ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "previousReferralId" text;--> statement-breakpoint
ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "suggestedStructureId" text;--> statement-breakpoint
ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "followUpNotifiedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_previous_fkey";--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_previous_fkey" FOREIGN KEY ("previousReferralId") REFERENCES "public"."Referral"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_suggested_fkey";--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_suggested_fkey" FOREIGN KEY ("suggestedStructureId") REFERENCES "public"."Structure"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_previous_check";--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_previous_check" CHECK ("previousReferralId" IS NULL OR "previousReferralId" <> "id");--> statement-breakpoint
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_suggested_check";--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_suggested_check" CHECK ("suggestedStructureId" IS NULL OR ("status" IN ('DECLINED', 'CLOSED') AND "suggestedStructureId" <> "toStructureId" AND "suggestedStructureId" <> "fromStructureId"));--> statement-breakpoint
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_response_check";--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_response_check" CHECK ("responseCode" IS NULL OR "responseCode" IN ('OUT_OF_SCOPE', 'NO_CAPACITY', 'ALREADY_SUPPORTED', 'NEEDS_MORE_INFORMATION', 'OTHER', 'REDIRECT_SUGGESTED'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Referral_previous_idx" ON "Referral" USING btree ("previousReferralId");--> statement-breakpoint
-- one live follow-up per declined referral (a double click or two colleagues cannot fork the chain)
CREATE UNIQUE INDEX IF NOT EXISTS "Referral_previous_live_key" ON "Referral" USING btree ("previousReferralId") WHERE "previousReferralId" IS NOT NULL AND "status" IN ('DRAFT', 'PENDING_CITIZEN', 'SENT', 'ACKNOWLEDGED', 'NEEDS_INFO', 'ACCEPTED', 'IN_PROGRESS');--> statement-breakpoint
-- « Référent de parcours »: a named contact person for the path, DECLARATIVE. The row gives NO access to the dossier and carries no legal responsibility:
-- access stays the SharedDossierGrant alone (api/_utils/share-access.js never reads this table). Effective only once the person accepted
-- ("citizenDecisionAt", enforced below); the person ends it at any time.
CREATE TABLE IF NOT EXISTS "DossierReferent" (
	"id" text PRIMARY KEY NOT NULL,
	"sharedDiagnosticId" text NOT NULL,
	"structureId" text NOT NULL,
	"proUserId" text,
	"displayName" text NOT NULL,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"displayNameConsentAt" timestamp (3) NOT NULL,
	"proposedAt" timestamp (3) DEFAULT now() NOT NULL,
	"citizenDecisionAt" timestamp (3),
	"endedAt" timestamp (3),
	"endedBy" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "DossierReferentEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"referentId" text NOT NULL,
	"actorType" text NOT NULL,
	"actorId" text,
	"fromStatus" text,
	"toStatus" text NOT NULL,
	"reason" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_dossier_fkey";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_dossier_fkey" FOREIGN KEY ("sharedDiagnosticId") REFERENCES "public"."SharedDiagnostic"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_structure_fkey";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_pro_fkey";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_pro_fkey" FOREIGN KEY ("proUserId") REFERENCES "public"."ProUser"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DossierReferentEvent" DROP CONSTRAINT IF EXISTS "DossierReferentEvent_referent_fkey";--> statement-breakpoint
ALTER TABLE "DossierReferentEvent" ADD CONSTRAINT "DossierReferentEvent_referent_fkey" FOREIGN KEY ("referentId") REFERENCES "public"."DossierReferent"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_status_check";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_status_check" CHECK ("status" IN ('PROPOSED', 'ACCEPTED_BY_CITIZEN', 'ENDED'));--> statement-breakpoint
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_endedBy_check";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_endedBy_check" CHECK ("endedBy" IS NULL OR "endedBy" IN ('CITIZEN', 'PROFESSIONAL', 'DEPARTURE', 'ACCESS_REVOKED', 'ORGANIZATION_CLOSED'));--> statement-breakpoint
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_ended_check";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_ended_check" CHECK (("status" = 'ENDED') = ("endedAt" IS NOT NULL) AND ("status" = 'ENDED') = ("endedBy" IS NOT NULL));--> statement-breakpoint
-- the person's agreement is a fact of the row: never « accepted » without the instant of their decision
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_citizen_consent_check";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_citizen_consent_check" CHECK ("status" <> 'ACCEPTED_BY_CITIZEN' OR "citizenDecisionAt" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "DossierReferent" DROP CONSTRAINT IF EXISTS "DossierReferent_name_check";--> statement-breakpoint
ALTER TABLE "DossierReferent" ADD CONSTRAINT "DossierReferent_name_check" CHECK (char_length("displayName") BETWEEN 2 AND 80);--> statement-breakpoint
ALTER TABLE "DossierReferentEvent" DROP CONSTRAINT IF EXISTS "DossierReferentEvent_actor_check";--> statement-breakpoint
ALTER TABLE "DossierReferentEvent" ADD CONSTRAINT "DossierReferentEvent_actor_check" CHECK ("actorType" IN ('PROFESSIONAL', 'CITIZEN', 'SYSTEM'));--> statement-breakpoint
-- one current (proposed or accepted) référent per dossier; ended rows are the history
CREATE UNIQUE INDEX IF NOT EXISTS "DossierReferent_current_key" ON "DossierReferent" USING btree ("sharedDiagnosticId") WHERE "status" IN ('PROPOSED', 'ACCEPTED_BY_CITIZEN');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DossierReferent_structure_idx" ON "DossierReferent" USING btree ("structureId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DossierReferent_pro_idx" ON "DossierReferent" USING btree ("proUserId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DossierReferentEvent_referent_idx" ON "DossierReferentEvent" USING btree ("referentId");--> statement-breakpoint
-- append-only history, like ReferralEvent (the function comes from 0022)
DROP TRIGGER IF EXISTS "DossierReferentEvent_append_only" ON "DossierReferentEvent";--> statement-breakpoint
CREATE TRIGGER "DossierReferentEvent_append_only" BEFORE UPDATE ON "DossierReferentEvent" FOR EACH ROW EXECUTE FUNCTION "ada_append_only"();
