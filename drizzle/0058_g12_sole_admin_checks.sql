ALTER TABLE "LegalHold" ADD COLUMN "releaseSoleAdministrator" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "OwnershipRecoveryCase" ADD COLUMN "soleAdministrator" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- G12 (owner 20/11/2026): while there is ONE enabled MFA administrator, the proposer may confirm a legal-hold release or an ownership recovery after 24 h
-- (api/_services/sole-admin.js). The two-person CHECK rules of 0026 now admit proposer = decider only when the row says soleAdministrator.
ALTER TABLE "LegalHold" DROP CONSTRAINT "LegalHold_two_person_release_check";--> statement-breakpoint
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_two_person_release_check" CHECK ("releasedBy" IS NULL OR ("releaseProposedBy" IS NOT NULL AND ("releasedBy" <> "releaseProposedBy" OR "releaseSoleAdministrator")));--> statement-breakpoint
ALTER TABLE "OwnershipRecoveryCase" DROP CONSTRAINT "OwnershipRecoveryCase_status_check";--> statement-breakpoint
ALTER TABLE "OwnershipRecoveryCase" ADD CONSTRAINT "OwnershipRecoveryCase_status_check" CHECK ("status" IN ('PROPOSED', 'APPROVED', 'REJECTED') AND ("status" = 'PROPOSED' OR ("decidedBy" IS NOT NULL AND "decidedAt" IS NOT NULL)) AND ("decidedBy" IS NULL OR "decidedBy" <> "proposedBy" OR "soleAdministrator"));
