-- X03 (expansion, founder authorization 19/11/2026) — ENTRAIDE: peer support between adults. Its own PSEUDONYMOUS principal (EntraideMember — never the
-- account, never the X01 story pseudonym), offers of practical help (EntraideOffer), requests sent on ONE offer (EntraideRequest: the double opt-in), the
-- e-mail a side chose to show after mutual acceptance (EntraideContactShare: explicit, revocable), reports (EntraideReport) and blocks (EntraideBlock).
-- ⚠ A DEDICATED AIPD IS MANDATORY BEFORE ANY OPENING (matching people on their needs is a sensitive inference) — draft in
-- CONTROL/master/completion/G6_X03_ENTRAIDE_2026-11-19.md. Closed by default anyway: capability « community.entraide » (outside the AIPD), surface
-- « entraide » (opened by nothing).
-- Number 0057, AFTER 0056 (X05, itself after 0055 X01, 0054 X02, 0053 X04): the journal must stay contiguous. ADDITIVE only: six new tables, their CHECKs,
-- indexes and ten foreign keys, ALL ON DELETE CASCADE (deleting the account — self-service deletion, DSR erasure, purge step 6c — deletes the member, and
-- deleting the member — leaving Entraide — deletes its offers, requests, shared e-mails, reports and blocks). No existing table, column, constraint or row
-- changes; nothing is backfilled and NOTHING is seeded. Privacy by design in the database itself: CLOSED lists of help categories (no health, disability,
-- addiction, legal-status, religion, sexuality or ethnicity category) and of coarse areas (commune / quartier — no address, no position column exists); notes
-- ≤ 280 characters, erased when the offer closes or the request leaves pending / accepted; no score, no matching column; a suspension needs a reason from
-- the closed list. The consent proofs (charter, shared e-mail) are ConsentLog rows (existing ledger): no column here duplicates them.
-- Only writer: api/_services/entraide.js. The code works on a database WITHOUT this migration (the service asks the catalogue): every route answers
-- 503 ENTRAIDE_NOT_AVAILABLE or « not available », the export sections are empty. NOT for Production until the owner runs it (after 0053–0056).
-- Rollback: drizzle/rollback/0057_down.sql. Note: docs/vision/X03_0057_MIGRATION_NOTE.md.
CREATE TABLE "EntraideBlock" (
	"id" text PRIMARY KEY NOT NULL,
	"blockerId" text NOT NULL,
	"blockedId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "EntraideBlock_self_check" CHECK ("EntraideBlock"."blockerId" <> "EntraideBlock"."blockedId")
);
--> statement-breakpoint
CREATE TABLE "EntraideContactShare" (
	"id" text PRIMARY KEY NOT NULL,
	"requestId" text NOT NULL,
	"memberId" text NOT NULL,
	"email" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "EntraideContactShare_email_check" CHECK (char_length("EntraideContactShare"."email") BETWEEN 6 AND 254 AND "EntraideContactShare"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')
);
--> statement-breakpoint
CREATE TABLE "EntraideMember" (
	"id" text PRIMARY KEY NOT NULL,
	"citizenUserId" text NOT NULL,
	"pseudonym" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"charterVersion" text NOT NULL,
	"charterAcceptedAt" timestamp (3) NOT NULL,
	"suspendedAt" timestamp (3),
	"suspensionReason" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "EntraideMember_pseudonym_check" CHECK (char_length("EntraideMember"."pseudonym") BETWEEN 3 AND 24 AND "EntraideMember"."pseudonym" !~ '[@[:space:]]'),
	CONSTRAINT "EntraideMember_status_check" CHECK (("EntraideMember"."status" = 'active' AND "EntraideMember"."suspendedAt" IS NULL AND "EntraideMember"."suspensionReason" IS NULL) OR ("EntraideMember"."status" = 'suspended' AND "EntraideMember"."suspendedAt" IS NOT NULL AND "EntraideMember"."suspensionReason" IS NOT NULL AND "EntraideMember"."suspensionReason" IN ('HARASSMENT', 'MONEY_REQUEST', 'UNSAFE_BEHAVIOUR', 'INAPPROPRIATE_CONTENT', 'SENSITIVE_DATA', 'SPAM')))
);
--> statement-breakpoint
CREATE TABLE "EntraideOffer" (
	"id" text PRIMARY KEY NOT NULL,
	"memberId" text NOT NULL,
	"category" text NOT NULL,
	"area" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"closedAt" timestamp (3),
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "EntraideOffer_status_check" CHECK ("EntraideOffer"."status" IN ('open', 'paused', 'closed')),
	CONSTRAINT "EntraideOffer_category_check" CHECK ("EntraideOffer"."category" IN ('ADMIN_APPOINTMENT', 'SHOPPING', 'DIGITAL_HELP', 'FRENCH_CONVERSATION', 'PET_CARE', 'MOVING_HELP')),
	CONSTRAINT "EntraideOffer_area_check" CHECK ("EntraideOffer"."area" IN ('STRASBOURG_CENTRE', 'STRASBOURG_GARE', 'STRASBOURG_KRUTENAU_ESPLANADE', 'STRASBOURG_ORANGERIE_CONSEIL_DES_XV', 'STRASBOURG_ROBERTSAU_WACKEN', 'STRASBOURG_CRONENBOURG', 'STRASBOURG_HAUTEPIERRE_POTERIES', 'STRASBOURG_KOENIGSHOFFEN_MONTAGNE_VERTE_ELSAU', 'STRASBOURG_MEINAU', 'STRASBOURG_NEUDORF_PORT_DU_RHIN', 'STRASBOURG_NEUHOF', 'SCHILTIGHEIM', 'BISCHHEIM', 'HOENHEIM', 'ILLKIRCH_GRAFFENSTADEN', 'LINGOLSHEIM', 'OSTWALD', 'AUTRE_EUROMETROPOLE')),
	CONSTRAINT "EntraideOffer_note_check" CHECK (("EntraideOffer"."note" IS NULL OR char_length("EntraideOffer"."note") BETWEEN 1 AND 280) AND ("EntraideOffer"."status" <> 'closed' OR ("EntraideOffer"."note" IS NULL AND "EntraideOffer"."closedAt" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "EntraideReport" (
	"id" text PRIMARY KEY NOT NULL,
	"reporterId" text NOT NULL,
	"targetId" text NOT NULL,
	"reason" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "EntraideReport_reason_check" CHECK ("EntraideReport"."reason" IN ('HARASSMENT', 'MONEY_REQUEST', 'UNSAFE_BEHAVIOUR', 'INAPPROPRIATE_CONTENT', 'SENSITIVE_DATA', 'SPAM')),
	CONSTRAINT "EntraideReport_self_check" CHECK ("EntraideReport"."reporterId" <> "EntraideReport"."targetId")
);
--> statement-breakpoint
CREATE TABLE "EntraideRequest" (
	"id" text PRIMARY KEY NOT NULL,
	"offerId" text NOT NULL,
	"requesterId" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"decidedAt" timestamp (3),
	"closedAt" timestamp (3),
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "EntraideRequest_status_check" CHECK ("EntraideRequest"."status" IN ('pending', 'accepted', 'declined', 'withdrawn', 'ended')),
	CONSTRAINT "EntraideRequest_note_check" CHECK (("EntraideRequest"."note" IS NULL OR char_length("EntraideRequest"."note") BETWEEN 1 AND 280) AND ("EntraideRequest"."note" IS NULL OR "EntraideRequest"."status" IN ('pending', 'accepted')))
);
--> statement-breakpoint
ALTER TABLE "EntraideBlock" ADD CONSTRAINT "EntraideBlock_blocker_fkey" FOREIGN KEY ("blockerId") REFERENCES "public"."EntraideMember"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntraideBlock" ADD CONSTRAINT "EntraideBlock_blocked_fkey" FOREIGN KEY ("blockedId") REFERENCES "public"."EntraideMember"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntraideContactShare" ADD CONSTRAINT "EntraideContactShare_request_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."EntraideRequest"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntraideContactShare" ADD CONSTRAINT "EntraideContactShare_member_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."EntraideMember"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntraideMember" ADD CONSTRAINT "EntraideMember_user_fkey" FOREIGN KEY ("citizenUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntraideOffer" ADD CONSTRAINT "EntraideOffer_member_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."EntraideMember"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntraideReport" ADD CONSTRAINT "EntraideReport_reporter_fkey" FOREIGN KEY ("reporterId") REFERENCES "public"."EntraideMember"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntraideReport" ADD CONSTRAINT "EntraideReport_target_fkey" FOREIGN KEY ("targetId") REFERENCES "public"."EntraideMember"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntraideRequest" ADD CONSTRAINT "EntraideRequest_offer_fkey" FOREIGN KEY ("offerId") REFERENCES "public"."EntraideOffer"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntraideRequest" ADD CONSTRAINT "EntraideRequest_requester_fkey" FOREIGN KEY ("requesterId") REFERENCES "public"."EntraideMember"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "EntraideBlock_pair_key" ON "EntraideBlock" USING btree ("blockerId","blockedId");--> statement-breakpoint
CREATE INDEX "EntraideBlock_blocked_idx" ON "EntraideBlock" USING btree ("blockedId");--> statement-breakpoint
CREATE UNIQUE INDEX "EntraideContactShare_once_key" ON "EntraideContactShare" USING btree ("requestId","memberId");--> statement-breakpoint
CREATE UNIQUE INDEX "EntraideMember_user_key" ON "EntraideMember" USING btree ("citizenUserId");--> statement-breakpoint
CREATE UNIQUE INDEX "EntraideMember_pseudonym_key" ON "EntraideMember" USING btree (lower("pseudonym"));--> statement-breakpoint
CREATE INDEX "EntraideOffer_member_idx" ON "EntraideOffer" USING btree ("memberId","createdAt");--> statement-breakpoint
CREATE INDEX "EntraideOffer_browse_idx" ON "EntraideOffer" USING btree ("status","category","area");--> statement-breakpoint
CREATE UNIQUE INDEX "EntraideReport_once_key" ON "EntraideReport" USING btree ("reporterId","targetId");--> statement-breakpoint
CREATE INDEX "EntraideReport_target_idx" ON "EntraideReport" USING btree ("targetId");--> statement-breakpoint
CREATE INDEX "EntraideReport_reporter_idx" ON "EntraideReport" USING btree ("reporterId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "EntraideRequest_active_key" ON "EntraideRequest" USING btree ("offerId","requesterId") WHERE "EntraideRequest"."status" IN ('pending', 'accepted');--> statement-breakpoint
CREATE INDEX "EntraideRequest_requester_idx" ON "EntraideRequest" USING btree ("requesterId","createdAt");