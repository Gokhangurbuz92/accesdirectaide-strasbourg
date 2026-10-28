-- PKG-3 rollback of drizzle/0021_pkg3_modes_visio.sql (documentation + tested by the migration stage). Forgets the modality of every appointment (they become indistinct
-- in-person bookings for older code), the video approvals and consents, and the modalities of services and opening periods. Run only after exporting VIDEO appointments.
ALTER TABLE "ProAvailabilityRule" DROP CONSTRAINT IF EXISTS "ProAvailabilityRule_modes_check";
ALTER TABLE "ProRdvService" DROP CONSTRAINT IF EXISTS "ProRdvService_modes_check";
ALTER TABLE "ProAppointment" DROP CONSTRAINT IF EXISTS "ProAppointment_visio_only_video_check";
ALTER TABLE "ProAppointment" DROP CONSTRAINT IF EXISTS "ProAppointment_mode_check";
ALTER TABLE "ProRdvService" DROP COLUMN IF EXISTS "modes";
ALTER TABLE "ProAvailabilityRule" DROP COLUMN IF EXISTS "modes";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "visioCitizenConsentAt";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "visioApprovedByProUserId";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "visioApprovedAt";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "mode";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0021>;
