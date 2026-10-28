CREATE TABLE "ParcoursReminder" (
	"itemId" text NOT NULL,
	"threshold" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "ParcoursReminder_pk" PRIMARY KEY("itemId","threshold","channel")
);
--> statement-breakpoint
ALTER TABLE "ParcoursReminder" ADD CONSTRAINT "ParcoursReminder_item_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."ParcoursItem"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ParcoursReminder" ADD CONSTRAINT "ParcoursReminder_threshold_check" CHECK ("threshold" IN ('J7', 'J1'));--> statement-breakpoint
ALTER TABLE "ParcoursReminder" ADD CONSTRAINT "ParcoursReminder_channel_check" CHECK ("channel" IN ('email', 'sms'));--> statement-breakpoint
ALTER TABLE "ParcoursReminder" ADD CONSTRAINT "ParcoursReminder_status_check" CHECK ("status" IN ('CLAIMED', 'DELIVERED', 'NOT_DELIVERED', 'NO_CONSENT', 'FAILED'));
