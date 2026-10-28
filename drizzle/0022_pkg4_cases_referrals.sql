CREATE TABLE "ProCase" (
	"id" text PRIMARY KEY NOT NULL,
	"sharedDiagnosticId" text NOT NULL,
	"structureId" text NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"assigneeProUserId" text,
	"outcome" text,
	"outcomeCitizenSummary" text,
	"openedAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"closedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "ProCaseEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"caseId" text NOT NULL,
	"structureId" text NOT NULL,
	"actorProUserId" text,
	"kind" text NOT NULL,
	"fromValue" text,
	"toValue" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProCaseNote" (
	"id" text PRIMARY KEY NOT NULL,
	"caseId" text NOT NULL,
	"structureId" text NOT NULL,
	"authorProUserId" text,
	"visibility" text NOT NULL,
	"bodyEncrypted" text NOT NULL,
	"mentions" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Referral" (
	"id" text PRIMARY KEY NOT NULL,
	"sharedDiagnosticId" text NOT NULL,
	"fromStructureId" text NOT NULL,
	"toStructureId" text NOT NULL,
	"fromCaseId" text,
	"createdByProUserId" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"reasonCode" text NOT NULL,
	"messageEncrypted" text,
	"responseCode" text,
	"responseMessageEncrypted" text,
	"outcome" text,
	"outcomeCitizenSummary" text,
	"grantId" text,
	"appointmentId" text,
	"idempotencyKey" text,
	"citizenDecisionAt" timestamp (3),
	"sentAt" timestamp (3),
	"acknowledgedAt" timestamp (3),
	"respondedAt" timestamp (3),
	"dueAt" timestamp (3),
	"overdueNotifiedAt" timestamp (3),
	"closedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ReferralEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"referralId" text NOT NULL,
	"actorType" text NOT NULL,
	"actorId" text,
	"fromStatus" text,
	"toStatus" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ProCase" ADD CONSTRAINT "ProCase_dossier_fkey" FOREIGN KEY ("sharedDiagnosticId") REFERENCES "public"."SharedDiagnostic"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProCase" ADD CONSTRAINT "ProCase_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProCase" ADD CONSTRAINT "ProCase_assignee_fkey" FOREIGN KEY ("assigneeProUserId") REFERENCES "public"."ProUser"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProCaseEvent" ADD CONSTRAINT "ProCaseEvent_case_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."ProCase"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProCaseNote" ADD CONSTRAINT "ProCaseNote_case_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."ProCase"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProCaseNote" ADD CONSTRAINT "ProCaseNote_author_fkey" FOREIGN KEY ("authorProUserId") REFERENCES "public"."ProUser"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_dossier_fkey" FOREIGN KEY ("sharedDiagnosticId") REFERENCES "public"."SharedDiagnostic"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_from_fkey" FOREIGN KEY ("fromStructureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_to_fkey" FOREIGN KEY ("toStructureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_case_fkey" FOREIGN KEY ("fromCaseId") REFERENCES "public"."ProCase"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_creator_fkey" FOREIGN KEY ("createdByProUserId") REFERENCES "public"."ProUser"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_appointment_fkey" FOREIGN KEY ("appointmentId") REFERENCES "public"."ProAppointment"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ReferralEvent" ADD CONSTRAINT "ReferralEvent_referral_fkey" FOREIGN KEY ("referralId") REFERENCES "public"."Referral"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "ProCase_dossier_structure_key" ON "ProCase" USING btree ("sharedDiagnosticId","structureId");--> statement-breakpoint
CREATE INDEX "ProCase_structure_status_idx" ON "ProCase" USING btree ("structureId","status");--> statement-breakpoint
CREATE INDEX "ProCase_assignee_idx" ON "ProCase" USING btree ("assigneeProUserId");--> statement-breakpoint
CREATE INDEX "ProCaseEvent_case_idx" ON "ProCaseEvent" USING btree ("caseId");--> statement-breakpoint
CREATE INDEX "ProCaseNote_case_idx" ON "ProCaseNote" USING btree ("caseId");--> statement-breakpoint
CREATE INDEX "Referral_to_status_idx" ON "Referral" USING btree ("toStructureId","status");--> statement-breakpoint
CREATE INDEX "Referral_from_idx" ON "Referral" USING btree ("fromStructureId");--> statement-breakpoint
CREATE INDEX "Referral_dossier_idx" ON "Referral" USING btree ("sharedDiagnosticId");--> statement-breakpoint
CREATE UNIQUE INDEX "Referral_idempotency_key" ON "Referral" USING btree ("fromStructureId","idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "Referral_live_key" ON "Referral" USING btree ("sharedDiagnosticId","toStructureId") WHERE "status" IN ('DRAFT', 'PENDING_CITIZEN', 'SENT', 'ACKNOWLEDGED', 'NEEDS_INFO', 'ACCEPTED', 'IN_PROGRESS');--> statement-breakpoint
CREATE INDEX "ReferralEvent_referral_idx" ON "ReferralEvent" USING btree ("referralId");--> statement-breakpoint
ALTER TABLE "ProCase" ADD CONSTRAINT "ProCase_status_check" CHECK ("status" IN ('NEW', 'IN_PROGRESS', 'WAITING_CITIZEN', 'WAITING_PARTNER', 'REFERRED', 'CLOSED'));--> statement-breakpoint
ALTER TABLE "ProCase" ADD CONSTRAINT "ProCase_outcome_check" CHECK ("outcome" IS NULL OR "outcome" IN ('SUPPORT_COMPLETED', 'APPLICATION_FILED', 'INFORMATION_PROVIDED', 'REFERRED_ELSEWHERE', 'CITIZEN_WITHDREW', 'NO_RESPONSE', 'OTHER'));--> statement-breakpoint
ALTER TABLE "ProCase" ADD CONSTRAINT "ProCase_closed_check" CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "ProCaseEvent" ADD CONSTRAINT "ProCaseEvent_kind_check" CHECK ("kind" IN ('OPENED', 'STATUS', 'ASSIGNED', 'UNASSIGNED', 'HANDOVER', 'NOTE_INTERNAL', 'NOTE_CITIZEN', 'OUTCOME', 'CLOSED', 'REOPENED', 'REFERRAL'));--> statement-breakpoint
ALTER TABLE "ProCaseNote" ADD CONSTRAINT "ProCaseNote_visibility_check" CHECK ("visibility" IN ('INTERNAL', 'CITIZEN'));--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_status_check" CHECK ("status" IN ('DRAFT', 'PENDING_CITIZEN', 'SENT', 'ACKNOWLEDGED', 'NEEDS_INFO', 'ACCEPTED', 'DECLINED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'CLOSED'));--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_reason_check" CHECK ("reasonCode" IN ('SPECIALISED_SUPPORT', 'ACCESS_TO_RIGHTS', 'HOUSING', 'EMPLOYMENT', 'HEALTH', 'FOOD_AID', 'DIGITAL_SUPPORT', 'LEGAL', 'OTHER'));--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_response_check" CHECK ("responseCode" IS NULL OR "responseCode" IN ('OUT_OF_SCOPE', 'NO_CAPACITY', 'ALREADY_SUPPORTED', 'NEEDS_MORE_INFORMATION', 'OTHER'));--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_outcome_check" CHECK ("outcome" IS NULL OR "outcome" IN ('SUPPORT_COMPLETED', 'APPLICATION_FILED', 'INFORMATION_PROVIDED', 'REFERRED_ELSEWHERE', 'CITIZEN_WITHDREW', 'NO_RESPONSE', 'OTHER'));--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_distinct_check" CHECK ("fromStructureId" <> "toStructureId");--> statement-breakpoint
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_sent_needs_citizen_check" CHECK ("status" IN ('DRAFT', 'PENDING_CITIZEN', 'CANCELLED') OR ("citizenDecisionAt" IS NOT NULL AND "grantId" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "ReferralEvent" ADD CONSTRAINT "ReferralEvent_actor_check" CHECK ("actorType" IN ('SENDER', 'RECEIVER', 'CITIZEN', 'SYSTEM'));--> statement-breakpoint
ALTER TABLE "SharedDossierGrant" ADD CONSTRAINT "SharedDossierGrant_via_check" CHECK ("grantedVia" IN ('invite', 'legacy_link', 'referral'));--> statement-breakpoint
CREATE FUNCTION "ada_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation'; END; $$;--> statement-breakpoint
CREATE TRIGGER "ProCaseEvent_append_only" BEFORE UPDATE ON "ProCaseEvent" FOR EACH ROW EXECUTE FUNCTION "ada_append_only"();--> statement-breakpoint
CREATE TRIGGER "ReferralEvent_append_only" BEFORE UPDATE ON "ReferralEvent" FOR EACH ROW EXECUTE FUNCTION "ada_append_only"();
