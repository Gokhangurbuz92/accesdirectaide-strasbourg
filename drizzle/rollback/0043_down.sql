-- Rollback of 0043_r38_guest_booking (R38), run BEFORE 0042_down.sql.
-- Effect: account-free bookings lose their sealed e-mail / phone, their pending holds and their manage links (the appointments themselves stay, with the
-- sealed name), their notice-ledger rows of the two R38 kinds are deleted; the structures' and services' « sans compte » opt-ins are dropped. Cancel or contact the pending guest bookings first. Roll back only with the code.
DELETE FROM "AppointmentNotice" WHERE "kind" IN ('BOOKED_BY_GUEST', 'GUEST_CODE');
ALTER TABLE "AppointmentNotice" DROP CONSTRAINT IF EXISTS "AppointmentNotice_kind_check";
ALTER TABLE "AppointmentNotice" ADD CONSTRAINT "AppointmentNotice_kind_check" CHECK ("kind" IN ('BOOKED_BY_STRUCTURE', 'CANCELLED_BY_CITIZEN', 'CANCELLED_BY_STRUCTURE', 'RESCHEDULED', 'REMINDER_J1', 'VISIO_APPROVED', 'VISIO_REVOKED'));
ALTER TABLE "ProAppointment" DROP CONSTRAINT IF EXISTS "ProAppointment_guestCodeAttempts_check";
ALTER TABLE "ProAppointment" DROP CONSTRAINT IF EXISTS "ProAppointment_guest_xor_citizen_check";
DROP INDEX IF EXISTS "ProAppointment_guestManageTokenHash_key";
DROP INDEX IF EXISTS "ProAppointment_guest_idempotency_key";
ALTER TABLE "StructureRdvSettings" DROP COLUMN IF EXISTS "allowGuestBooking";
ALTER TABLE "ProRdvService" DROP COLUMN IF EXISTS "guestBookable";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "guestManageExpiresAt";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "guestManageTokenHash";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "guestConfirmedAt";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "guestCodeAttempts";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "guestCodeHash";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "guestHoldExpiresAt";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "guestMailConsentAt";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "guestPhone";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "guestEmailHash";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "guestEmail";
