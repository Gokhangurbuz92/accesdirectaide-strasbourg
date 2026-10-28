ALTER TABLE "ProAppointment" ADD COLUMN "rescheduleCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "rescheduledAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD CONSTRAINT "ProAppointment_reschedule_count_check" CHECK ("rescheduleCount" BETWEEN 0 AND 2);
