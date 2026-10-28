CREATE TABLE "AiMetric" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"circuit_breaker_open" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "CitizenUser" ADD COLUMN "failedLoginAttempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "CitizenUser" ADD COLUMN "lockoutUntil" timestamp (3);--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "reminder_locked_at" timestamp;