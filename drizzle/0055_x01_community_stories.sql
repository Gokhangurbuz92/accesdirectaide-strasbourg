-- X01 (expansion, founder authorization 19/11/2026) — Community stories (« histoires ») with moderation: the community's PSEUDONYMOUS principal
-- (CommunityMember, R47 § 8: the account is never exposed), the stories written under it (CommunityStory) and the reports of abuse on a published story
-- (CommunityStoryReport). Number 0055, AFTER 0054 (X02 testimonials, itself after 0053 X04): the journal must stay contiguous. ADDITIVE only: three new
-- tables, their CHECKs, indexes and four foreign keys (member → CitizenUser, story → member, report → story, report → CitizenUser, all ON DELETE CASCADE:
-- deleting an account — self-service deletion, DSR erasure, purge step 6c — deletes its pseudonym, its stories and its reports). No existing table, column,
-- constraint or row changes; nothing is backfilled and NO story or member is seeded (only real stories, written by the persons themselves). The title and
-- the text exist only while the story is pending or published (CHECK CommunityStory_text_state_check): withdrawal, rejection and takedown erase them.
-- The pseudonym is unique without regard to case (CommunityMember_pseudonym_key), 3–24 characters, no « @ », no space.
-- The consent proof is a ConsentLog row (existing ledger, purpose COMMUNITY_STORY_PUBLICATION): no column here duplicates it.
-- Only writer: api/_services/community-stories.js. The code works on a database WITHOUT this migration (the service asks the catalogue): the public list is
-- empty, every write answers 503 STORIES_NOT_AVAILABLE, the export sections are empty. Closed by default anyway: capability « community.stories » (outside
-- the AIPD), surface « stories » (not opened anywhere). NOT for Production until the owner runs it (after 0053 and 0054).
-- Rollback: drizzle/rollback/0055_down.sql. Note: docs/vision/X01_0055_MIGRATION_NOTE.md.
CREATE TABLE "CommunityMember" (
	"id" text PRIMARY KEY NOT NULL,
	"citizenUserId" text NOT NULL,
	"pseudonym" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "CommunityMember_pseudonym_check" CHECK (char_length("CommunityMember"."pseudonym") BETWEEN 3 AND 24 AND "CommunityMember"."pseudonym" !~ '[@[:space:]]')
);
--> statement-breakpoint
CREATE TABLE "CommunityStory" (
	"id" text PRIMARY KEY NOT NULL,
	"memberId" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"title" text,
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
	CONSTRAINT "CommunityStory_status_check" CHECK ("CommunityStory"."status" IN ('pending', 'published', 'rejected', 'withdrawn', 'taken_down')),
	CONSTRAINT "CommunityStory_lang_check" CHECK ("CommunityStory"."lang" IN ('fr', 'en', 'de', 'tr', 'ar', 'uk')),
	CONSTRAINT "CommunityStory_text_state_check" CHECK (("CommunityStory"."status" IN ('pending', 'published') AND "CommunityStory"."title" IS NOT NULL AND "CommunityStory"."body" IS NOT NULL) OR ("CommunityStory"."status" NOT IN ('pending', 'published') AND "CommunityStory"."title" IS NULL AND "CommunityStory"."body" IS NULL)),
	CONSTRAINT "CommunityStory_length_check" CHECK (("CommunityStory"."title" IS NULL OR char_length("CommunityStory"."title") BETWEEN 5 AND 120) AND ("CommunityStory"."body" IS NULL OR char_length("CommunityStory"."body") BETWEEN 50 AND 3000)),
	CONSTRAINT "CommunityStory_published_check" CHECK ("CommunityStory"."status" <> 'published' OR ("CommunityStory"."publishedAt" IS NOT NULL AND "CommunityStory"."moderatedBy" IS NOT NULL)),
	CONSTRAINT "CommunityStory_reason_check" CHECK ("CommunityStory"."moderationReason" IS NULL OR "CommunityStory"."moderationReason" IN ('HEALTH_DETAIL', 'PERSONAL_DATA', 'OFFENSIVE', 'MISLEADING', 'ADVERTISING', 'OFF_TOPIC'))
);
--> statement-breakpoint
CREATE TABLE "CommunityStoryReport" (
	"id" text PRIMARY KEY NOT NULL,
	"storyId" text NOT NULL,
	"reporterUserId" text NOT NULL,
	"reason" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "CommunityStoryReport_reason_check" CHECK ("CommunityStoryReport"."reason" IN ('HEALTH_DETAIL', 'PERSONAL_DATA', 'OFFENSIVE', 'MISLEADING', 'ADVERTISING', 'OFF_TOPIC'))
);
--> statement-breakpoint
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_user_fkey" FOREIGN KEY ("citizenUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CommunityStory" ADD CONSTRAINT "CommunityStory_member_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."CommunityMember"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CommunityStoryReport" ADD CONSTRAINT "CommunityStoryReport_story_fkey" FOREIGN KEY ("storyId") REFERENCES "public"."CommunityStory"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CommunityStoryReport" ADD CONSTRAINT "CommunityStoryReport_user_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "CommunityMember_user_key" ON "CommunityMember" USING btree ("citizenUserId");--> statement-breakpoint
CREATE UNIQUE INDEX "CommunityMember_pseudonym_key" ON "CommunityMember" USING btree (lower("pseudonym"));--> statement-breakpoint
CREATE INDEX "CommunityStory_member_idx" ON "CommunityStory" USING btree ("memberId","submittedAt");--> statement-breakpoint
CREATE INDEX "CommunityStory_public_idx" ON "CommunityStory" USING btree ("status","publishedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "CommunityStoryReport_once_key" ON "CommunityStoryReport" USING btree ("storyId","reporterUserId");--> statement-breakpoint
CREATE INDEX "CommunityStoryReport_reporter_idx" ON "CommunityStoryReport" USING btree ("reporterUserId","createdAt");