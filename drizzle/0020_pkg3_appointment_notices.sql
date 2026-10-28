CREATE TABLE "AppointmentNotice" (
	"id" text PRIMARY KEY NOT NULL,
	"appointmentId" text NOT NULL,
	"kind" text NOT NULL,
	"recipient" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "beneficiaryConsentAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "AppointmentNotice" ADD CONSTRAINT "AppointmentNotice_appointment_fkey" FOREIGN KEY ("appointmentId") REFERENCES "public"."ProAppointment"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AppointmentNotice_appointment_idx" ON "AppointmentNotice" USING btree ("appointmentId");--> statement-breakpoint
ALTER TABLE "AppointmentNotice" ADD CONSTRAINT "AppointmentNotice_kind_check" CHECK ("kind" IN ('BOOKED_BY_STRUCTURE', 'CANCELLED_BY_CITIZEN', 'CANCELLED_BY_STRUCTURE', 'RESCHEDULED', 'REMINDER_J1', 'VISIO_APPROVED', 'VISIO_REVOKED'));--> statement-breakpoint
ALTER TABLE "AppointmentNotice" ADD CONSTRAINT "AppointmentNotice_recipient_check" CHECK ("recipient" IN ('citizen', 'structure'));--> statement-breakpoint
ALTER TABLE "AppointmentNotice" ADD CONSTRAINT "AppointmentNotice_channel_check" CHECK ("channel" IN ('email', 'sms', 'in_app'));--> statement-breakpoint
ALTER TABLE "AppointmentNotice" ADD CONSTRAINT "AppointmentNotice_status_check" CHECK ("status" IN ('DELIVERED', 'NOT_DELIVERED', 'NO_CONSENT', 'NO_RECIPIENT', 'FAILED'));
