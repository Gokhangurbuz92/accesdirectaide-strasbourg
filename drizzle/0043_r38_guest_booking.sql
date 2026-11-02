-- R38: optional account-free (« sans compte ») booking, opted in per structure (StructureRdvSettings.allowGuestBooking) AND per service
-- (ProRdvService.guestBookable), both default false; the guest's e-mail and phone are sealed on ProAppointment, only hashes of the e-mail, the code and the
-- manage token are kept. Additive only: new nullable / defaulted columns, two unique indexes, two CHECKs, and the AppointmentNotice kind CHECK
-- widened with BOOKED_BY_GUEST and GUEST_CODE (the notice ledger of an account-free booking); no existing row or column changes.
ALTER TABLE "ProAppointment" ADD COLUMN "guestEmail" text;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "guestEmailHash" text;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "guestPhone" text;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "guestMailConsentAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "guestHoldExpiresAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "guestCodeHash" text;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "guestCodeAttempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "guestConfirmedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "guestManageTokenHash" text;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "guestManageExpiresAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "ProRdvService" ADD COLUMN "guestBookable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "StructureRdvSettings" ADD COLUMN "allowGuestBooking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ProAppointment_guest_idempotency_key" ON "ProAppointment" USING btree ("structureId","guestEmailHash","idempotencyKey") WHERE "citizenUserId" IS NULL AND "guestEmailHash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ProAppointment_guestManageTokenHash_key" ON "ProAppointment" USING btree ("guestManageTokenHash");--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD CONSTRAINT "ProAppointment_guest_xor_citizen_check" CHECK ("guestEmailHash" IS NULL OR "citizenUserId" IS NULL);--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD CONSTRAINT "ProAppointment_guestCodeAttempts_check" CHECK ("guestCodeAttempts" BETWEEN 0 AND 5);--> statement-breakpoint
ALTER TABLE "AppointmentNotice" DROP CONSTRAINT "AppointmentNotice_kind_check";--> statement-breakpoint
ALTER TABLE "AppointmentNotice" ADD CONSTRAINT "AppointmentNotice_kind_check" CHECK ("kind" IN ('BOOKED_BY_STRUCTURE', 'CANCELLED_BY_CITIZEN', 'CANCELLED_BY_STRUCTURE', 'RESCHEDULED', 'REMINDER_J1', 'VISIO_APPROVED', 'VISIO_REVOKED', 'BOOKED_BY_GUEST', 'GUEST_CODE'));
