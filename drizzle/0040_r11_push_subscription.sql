CREATE TABLE "PushSubscription" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"endpointHash" text NOT NULL,
	"subscriptionEncrypted" text NOT NULL,
	"pushHost" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"failureCount" integer DEFAULT 0 NOT NULL,
	"lastSuccessAt" timestamp (3),
	"lastFailureAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PushSubscription_endpointHash_unique" UNIQUE("endpointHash"),
	CONSTRAINT "PushSubscription_status_check" CHECK ("PushSubscription"."status" IN ('ACTIVE', 'FAILING'))
);
--> statement-breakpoint
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_user_fkey" FOREIGN KEY ("userId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "PushSubscription_user_idx" ON "PushSubscription" USING btree ("userId");--> statement-breakpoint
ALTER TABLE "ParcoursReminder" DROP CONSTRAINT "ParcoursReminder_channel_check";--> statement-breakpoint
ALTER TABLE "ParcoursReminder" ADD CONSTRAINT "ParcoursReminder_channel_check" CHECK ("channel" IN ('email', 'sms', 'push'));
