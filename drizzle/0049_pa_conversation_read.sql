-- RECON Pro B02: a professional's read marker for an appointment conversation. One row per (conversation, member): the moment that member last opened the
-- thread. The unread count of « Messages » is computed from it (a person's message newer than the member's marker AND newer than the team's last reply).
-- Additive only: one new table, two foreign keys, one index; no existing table, column, constraint or row changes. Nothing is backfilled: until a member
-- opens a thread, a conversation whose latest message is the person's (never answered by the team) counts as unread for that member — which is what it is.
-- The code works on a database without this table (api/_services/conversation-read.js asks the catalogue): the unread message count is then « unknown »,
-- as before. Rows disappear with their conversation or their member (ON DELETE CASCADE); they hold no content, only two ids and a time.
CREATE TABLE "RdvConversationRead" (
	"conversationId" text NOT NULL,
	"proUserId" text NOT NULL,
	"lastReadAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "RdvConversationRead_pkey" PRIMARY KEY("conversationId","proUserId")
);
--> statement-breakpoint
ALTER TABLE "RdvConversationRead" ADD CONSTRAINT "RdvConversationRead_conversation_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."RdvConversation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RdvConversationRead" ADD CONSTRAINT "RdvConversationRead_proUser_fkey" FOREIGN KEY ("proUserId") REFERENCES "public"."ProUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "RdvConversationRead_proUser_idx" ON "RdvConversationRead" USING btree ("proUserId");
