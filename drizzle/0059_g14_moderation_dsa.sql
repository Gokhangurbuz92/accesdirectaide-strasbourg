-- G14 (owner decisions 22/11/2026, formulaire G14) — moderation staffing and DSA flows for the expansion content (X01, X02, X05; X03 later). Number 0059,
-- AFTER 0058: the journal must stay contiguous. ADDITIVE only: five new tables, their CHECKs, indexes and foreign keys. No existing table, column,
-- constraint or row changes; nothing is backfilled and NO row is seeded (a role exists only once the owner assigns it to a named MFA administrator).
--   ModerationRole      named roles on EXISTING AdminUser accounts: MODERATOR, ENTRAIDE_SAFETY_OFFICER (fail closed while none is assigned)
--   ContentNotice       account-free notices (Regulation (EU) 2022/2065, art. 16) — public form or e-mail recorded by a moderator
--   ModerationDecision  statements of reasons (art. 16(5), 17); « automated » is always false (CHECK)
--   ModerationAppeal    internal complaints, six months (art. 20, applied by owner decision 30)
--   ModerationSanction  warning then time-limited suspension for repeated misuse (art. 23)
-- Only writer: api/_services/moderation-dsa.js. The code works WITHOUT this migration (the service asks the catalogue): every staffed action then refuses
-- (MODERATION_NOT_AVAILABLE), so nothing can be published or approved. NOT for Production until the owner runs it (after 0053–0058).
-- Rollback: drizzle/rollback/0059_down.sql. The QA maker inventory and the owner migration script must list 0059 (outside this repository).
CREATE TABLE "ContentNotice" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"contentType" text NOT NULL,
	"contentRef" text NOT NULL,
	"category" text NOT NULL,
	"explanation" text NOT NULL,
	"notifierName" text,
	"notifierEmail" text,
	"notifierKey" text,
	"goodFaith" boolean NOT NULL,
	"declaredTrustedFlagger" boolean DEFAULT false NOT NULL,
	"priority" text DEFAULT 'ordinary' NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"outcome" text,
	"decisionId" text,
	"appealTokenHash" text,
	"acknowledgedAt" timestamp (3),
	"decidedAt" timestamp (3),
	"decidedBy" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "ContentNotice_channel_check" CHECK ("ContentNotice"."channel" IN ('public_form', 'email')),
	CONSTRAINT "ContentNotice_type_check" CHECK ("ContentNotice"."contentType" IN ('testimonial', 'story', 'job_listing', 'entraide', 'other')),
	CONSTRAINT "ContentNotice_category_check" CHECK ("ContentNotice"."category" IN ('ILLEGAL_CONTENT', 'TERMS_VIOLATION', 'SAFETY_THREAT', 'CHILD_SAFETY')),
	CONSTRAINT "ContentNotice_length_check" CHECK (char_length("ContentNotice"."contentRef") BETWEEN 3 AND 500 AND char_length("ContentNotice"."explanation") BETWEEN 20 AND 3000 AND ("ContentNotice"."notifierName" IS NULL OR char_length("ContentNotice"."notifierName") BETWEEN 2 AND 120) AND ("ContentNotice"."notifierEmail" IS NULL OR (char_length("ContentNotice"."notifierEmail") BETWEEN 6 AND 254 AND "ContentNotice"."notifierEmail" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'))),
	CONSTRAINT "ContentNotice_identity_check" CHECK ("ContentNotice"."category" = 'CHILD_SAFETY' OR ("ContentNotice"."notifierName" IS NOT NULL AND "ContentNotice"."notifierEmail" IS NOT NULL)),
	CONSTRAINT "ContentNotice_good_faith_check" CHECK ("ContentNotice"."goodFaith" = true),
	CONSTRAINT "ContentNotice_priority_check" CHECK ("ContentNotice"."priority" IN ('urgent', 'trusted', 'ordinary')),
	CONSTRAINT "ContentNotice_status_check" CHECK (("ContentNotice"."status" = 'received' AND "ContentNotice"."outcome" IS NULL AND "ContentNotice"."decidedAt" IS NULL) OR ("ContentNotice"."status" = 'decided' AND "ContentNotice"."outcome" IN ('action_taken', 'no_action', 'not_processed') AND "ContentNotice"."decidedAt" IS NOT NULL AND "ContentNotice"."decidedBy" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ModerationAppeal" (
	"id" text PRIMARY KEY NOT NULL,
	"decisionId" text NOT NULL,
	"appellantKind" text NOT NULL,
	"appellantUserId" text,
	"noticeId" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"response" text,
	"reviewedBy" text,
	"reviewedAt" timestamp (3),
	"soleModerator" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "ModerationAppeal_kind_check" CHECK ("ModerationAppeal"."appellantKind" IN ('author', 'notifier') AND (("ModerationAppeal"."appellantUserId" IS NOT NULL) <> ("ModerationAppeal"."noticeId" IS NOT NULL))),
	CONSTRAINT "ModerationAppeal_body_check" CHECK (char_length("ModerationAppeal"."body") BETWEEN 10 AND 2000),
	CONSTRAINT "ModerationAppeal_status_check" CHECK (("ModerationAppeal"."status" = 'open' AND "ModerationAppeal"."reviewedAt" IS NULL) OR ("ModerationAppeal"."status" IN ('upheld', 'reversed', 'modified') AND "ModerationAppeal"."reviewedAt" IS NOT NULL AND "ModerationAppeal"."reviewedBy" IS NOT NULL AND char_length("ModerationAppeal"."response") BETWEEN 10 AND 2000))
);
--> statement-breakpoint
CREATE TABLE "ModerationDecision" (
	"id" text PRIMARY KEY NOT NULL,
	"contentType" text NOT NULL,
	"contentId" text NOT NULL,
	"action" text NOT NULL,
	"reasonCode" text NOT NULL,
	"facts" text NOT NULL,
	"legalGround" text,
	"termsClause" text NOT NULL,
	"source" text NOT NULL,
	"automated" boolean DEFAULT false NOT NULL,
	"manifestlyIllegal" boolean DEFAULT false NOT NULL,
	"restrictionEndsAt" timestamp (3),
	"subjectUserId" text,
	"subjectStructureId" text,
	"notifierUserIds" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"noticeId" text,
	"decidedBy" text NOT NULL,
	"decidedAt" timestamp (3) DEFAULT now() NOT NULL,
	"appealUntil" timestamp (3) NOT NULL,
	"statementChannel" text DEFAULT 'none' NOT NULL,
	"statementSentAt" timestamp (3),
	"authoritiesInformedAt" timestamp (3),
	CONSTRAINT "ModerationDecision_type_check" CHECK ("ModerationDecision"."contentType" IN ('testimonial', 'story', 'job_listing', 'entraide_member', 'entraide_offer', 'notice')),
	CONSTRAINT "ModerationDecision_action_check" CHECK ("ModerationDecision"."action" IN ('rejected', 'taken_down', 'offer_closed', 'member_suspended', 'member_reinstated', 'reports_dismissed', 'notice_no_action')),
	CONSTRAINT "ModerationDecision_source_check" CHECK ("ModerationDecision"."source" IN ('notice', 'report', 'own_initiative', 'pre_publication_review')),
	CONSTRAINT "ModerationDecision_human_check" CHECK ("ModerationDecision"."automated" = false),
	CONSTRAINT "ModerationDecision_length_check" CHECK (char_length("ModerationDecision"."facts") BETWEEN 10 AND 2000 AND char_length("ModerationDecision"."termsClause") BETWEEN 3 AND 300 AND ("ModerationDecision"."legalGround" IS NULL OR char_length("ModerationDecision"."legalGround") BETWEEN 3 AND 1000)),
	CONSTRAINT "ModerationDecision_illegal_check" CHECK ("ModerationDecision"."manifestlyIllegal" = false OR "ModerationDecision"."legalGround" IS NOT NULL),
	CONSTRAINT "ModerationDecision_channel_check" CHECK ("ModerationDecision"."statementChannel" IN ('email', 'in_app', 'none') AND (("ModerationDecision"."statementChannel" = 'none') = ("ModerationDecision"."statementSentAt" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "ModerationRole" (
	"id" text PRIMARY KEY NOT NULL,
	"adminUserId" text NOT NULL,
	"role" text NOT NULL,
	"charterAcknowledgedAt" timestamp (3) NOT NULL,
	"assignedBy" text NOT NULL,
	"assignedAt" timestamp (3) DEFAULT now() NOT NULL,
	"revokedAt" timestamp (3),
	"revokedBy" text,
	CONSTRAINT "ModerationRole_role_check" CHECK ("ModerationRole"."role" IN ('MODERATOR', 'ENTRAIDE_SAFETY_OFFICER')),
	CONSTRAINT "ModerationRole_revoke_check" CHECK (("ModerationRole"."revokedAt" IS NULL) = ("ModerationRole"."revokedBy" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ModerationSanction" (
	"id" text PRIMARY KEY NOT NULL,
	"subjectUserId" text,
	"notifierKey" text,
	"scope" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"endsAt" timestamp (3),
	"liftedAt" timestamp (3),
	"liftedBy" text,
	CONSTRAINT "ModerationSanction_subject_check" CHECK (("ModerationSanction"."subjectUserId" IS NOT NULL) <> ("ModerationSanction"."notifierKey" IS NOT NULL)),
	CONSTRAINT "ModerationSanction_scope_check" CHECK ("ModerationSanction"."scope" IN ('publishing', 'notices')),
	CONSTRAINT "ModerationSanction_kind_check" CHECK (("ModerationSanction"."kind" = 'warning' AND "ModerationSanction"."endsAt" IS NULL) OR ("ModerationSanction"."kind" = 'suspension' AND "ModerationSanction"."endsAt" IS NOT NULL AND "ModerationSanction"."endsAt" > "ModerationSanction"."createdAt")),
	CONSTRAINT "ModerationSanction_reason_check" CHECK (char_length("ModerationSanction"."reason") BETWEEN 10 AND 1000),
	CONSTRAINT "ModerationSanction_lift_check" CHECK (("ModerationSanction"."liftedAt" IS NULL) = ("ModerationSanction"."liftedBy" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "ModerationAppeal" ADD CONSTRAINT "ModerationAppeal_decision_fkey" FOREIGN KEY ("decisionId") REFERENCES "public"."ModerationDecision"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ModerationAppeal" ADD CONSTRAINT "ModerationAppeal_user_fkey" FOREIGN KEY ("appellantUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ModerationAppeal" ADD CONSTRAINT "ModerationAppeal_notice_fkey" FOREIGN KEY ("noticeId") REFERENCES "public"."ContentNotice"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ModerationDecision" ADD CONSTRAINT "ModerationDecision_subject_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ModerationDecision" ADD CONSTRAINT "ModerationDecision_structure_fkey" FOREIGN KEY ("subjectStructureId") REFERENCES "public"."Structure"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ModerationDecision" ADD CONSTRAINT "ModerationDecision_notice_fkey" FOREIGN KEY ("noticeId") REFERENCES "public"."ContentNotice"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ModerationRole" ADD CONSTRAINT "ModerationRole_admin_fkey" FOREIGN KEY ("adminUserId") REFERENCES "public"."AdminUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ModerationSanction" ADD CONSTRAINT "ModerationSanction_user_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ContentNotice_queue_idx" ON "ContentNotice" USING btree ("status","priority","createdAt");--> statement-breakpoint
CREATE INDEX "ContentNotice_notifier_idx" ON "ContentNotice" USING btree ("notifierKey","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "ModerationAppeal_user_once_key" ON "ModerationAppeal" USING btree ("decisionId","appellantUserId") WHERE "ModerationAppeal"."appellantUserId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ModerationAppeal_notice_once_key" ON "ModerationAppeal" USING btree ("decisionId","noticeId") WHERE "ModerationAppeal"."noticeId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ModerationAppeal_queue_idx" ON "ModerationAppeal" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "ModerationDecision_content_idx" ON "ModerationDecision" USING btree ("contentType","contentId");--> statement-breakpoint
CREATE INDEX "ModerationDecision_subject_idx" ON "ModerationDecision" USING btree ("subjectUserId","decidedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "ModerationRole_active_key" ON "ModerationRole" USING btree ("adminUserId","role") WHERE "ModerationRole"."revokedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "ModerationSanction_user_idx" ON "ModerationSanction" USING btree ("subjectUserId","scope");--> statement-breakpoint
CREATE INDEX "ModerationSanction_key_idx" ON "ModerationSanction" USING btree ("notifierKey","scope");