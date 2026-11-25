-- TG (owner decision 24/11/2026: notifications = Web Push → e-mail (Mailjet) → OPTIONAL Telegram, all 0 €; WhatsApp rejected) — the person's optional
-- Telegram link (capability citizen.telegram, closed by default) and the « telegram » channel of the Mon Parcours reminder ledger.
--
-- Journal idx 65, « when » 1795070000000 (> 0064's 1795060000000). Rollback: drizzle/rollback/0065_down.sql; snapshot drizzle/meta/0065_snapshot.json;
-- the table is declared in src/db/schema.ts. The code reads it behind a presence check (api/_services/telegram.js telegramInstalled): on a database without
-- 0065 the card says « pas encore proposé » and the reminder jobs leave the telegram channel out (no INSERT that the old CHECK would refuse).
--
-- Additive: one new table (no row of any existing table is touched; nothing is backfilled; the only NOT NULL columns have defaults or are set at insert) and
-- the ParcoursReminder channel CHECK widened from ('email', 'sms', 'push') to ('email', 'sms', 'push', 'telegram') — every existing row satisfies it.
-- Valid on LAB (PostgreSQL 17) and Production (PostgreSQL 18). A release carrying it needs the qa_migrate coverage update (journal 66 entries).
--
-- A row holds: the account; while a link is pending, the SHA-256 of a single-use random code and its expiry (10 min); once linked, the Telegram chat id
-- SEALED with the data keys (purpose « telegram-chat ») and a keyed HMAC of it (unique: one chat = one account), the link time, delivery counters.
CREATE TABLE "TelegramLink" (
	"userId" text PRIMARY KEY NOT NULL,
	"linkCodeHash" text,
	"linkCodeExpiresAt" timestamp (3),
	"chatIdEncrypted" text,
	"chatIdHmac" text,
	"linkedAt" timestamp (3),
	"failureCount" integer DEFAULT 0 NOT NULL,
	"lastSuccessAt" timestamp (3),
	"lastFailureAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "TelegramLink_linkCodeHash_unique" UNIQUE("linkCodeHash"),
	CONSTRAINT "TelegramLink_chatIdHmac_unique" UNIQUE("chatIdHmac"),
	CONSTRAINT "TelegramLink_state_check" CHECK (("TelegramLink"."chatIdEncrypted" IS NULL) = ("TelegramLink"."chatIdHmac" IS NULL) AND ("TelegramLink"."chatIdEncrypted" IS NULL) = ("TelegramLink"."linkedAt" IS NULL) AND ("TelegramLink"."linkCodeHash" IS NULL) = ("TelegramLink"."linkCodeExpiresAt" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_user_fkey" FOREIGN KEY ("userId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ParcoursReminder" DROP CONSTRAINT IF EXISTS "ParcoursReminder_channel_check";--> statement-breakpoint
ALTER TABLE "ParcoursReminder" ADD CONSTRAINT "ParcoursReminder_channel_check" CHECK ("channel" IN ('email', 'sms', 'push', 'telegram'));
