CREATE TABLE "RdvMessageAttachment" (
	"id" text PRIMARY KEY NOT NULL,
	"conversationId" text NOT NULL,
	"messageId" text NOT NULL,
	"uploaderType" text NOT NULL,
	"storageKey" text NOT NULL,
	"filenameEncrypted" text NOT NULL,
	"mimeType" text NOT NULL,
	"byteLength" integer NOT NULL,
	"checksumSha256" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "DSRRequest" ADD COLUMN "reviewOutcome" jsonb;--> statement-breakpoint
ALTER TABLE "ProUser" ADD COLUMN "notificationPrefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "StructureProposal" ADD COLUMN "reviewSourceUrl" text;--> statement-breakpoint
ALTER TABLE "RdvMessageAttachment" ADD CONSTRAINT "RdvMessageAttachment_conversation_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."RdvConversation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RdvMessageAttachment" ADD CONSTRAINT "RdvMessageAttachment_message_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."RdvConversationMessage"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "RdvMessageAttachment_conversation_idx" ON "RdvMessageAttachment" USING btree ("conversationId");--> statement-breakpoint
ALTER TABLE "RdvMessageAttachment" ADD CONSTRAINT "RdvMessageAttachment_uploader_check" CHECK ("uploaderType" IN ('PRO', 'CITIZEN'));--> statement-breakpoint
ALTER TABLE "RdvMessageAttachment" ADD CONSTRAINT "RdvMessageAttachment_mime_check" CHECK ("mimeType" IN ('application/pdf', 'image/png', 'image/jpeg'));--> statement-breakpoint
ALTER TABLE "RdvMessageAttachment" ADD CONSTRAINT "RdvMessageAttachment_size_check" CHECK ("byteLength" BETWEEN 1 AND 5242880);--> statement-breakpoint
ALTER TABLE "RdvMessageAttachment" ADD CONSTRAINT "RdvMessageAttachment_message_key" UNIQUE ("messageId");--> statement-breakpoint
ALTER TABLE "ProUser" ADD CONSTRAINT "ProUser_notification_prefs_check" CHECK (jsonb_typeof("notificationPrefs") = 'object');--> statement-breakpoint
ALTER TABLE "AppointmentNotice" DROP CONSTRAINT "AppointmentNotice_status_check";--> statement-breakpoint
ALTER TABLE "AppointmentNotice" ADD CONSTRAINT "AppointmentNotice_status_check" CHECK ("status" IN ('DELIVERED', 'TEST_RECORDED', 'NOT_DELIVERED', 'NO_CONSENT', 'NO_RECIPIENT', 'FAILED'));
--> statement-breakpoint
ALTER TABLE "ParcoursReminder" DROP CONSTRAINT "ParcoursReminder_status_check";--> statement-breakpoint
ALTER TABLE "ParcoursReminder" ADD CONSTRAINT "ParcoursReminder_status_check" CHECK ("status" IN ('CLAIMED', 'DELIVERED', 'TEST_RECORDED', 'NOT_DELIVERED', 'NO_CONSENT', 'FAILED'));
