CREATE TABLE "EmailChangeRequest" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"newEmailEncrypted" text NOT NULL,
	"tokenHash" text NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"usedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "EmailChangeRequest_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
ALTER TABLE "CitizenUser" ADD COLUMN "lastSeenAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "EmailChangeRequest" ADD CONSTRAINT "EmailChangeRequest_user_fkey" FOREIGN KEY ("userId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "EmailChangeRequest_user_idx" ON "EmailChangeRequest" USING btree ("userId");