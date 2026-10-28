-- PKG-3 rollback of drizzle/0019_pkg3_reschedule.sql (documentation + tested by the migration stage). Only forgets how many times appointments were moved; the appointments keep their current time.
ALTER TABLE "ProAppointment" DROP CONSTRAINT IF EXISTS "ProAppointment_reschedule_count_check";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "rescheduledAt";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "rescheduleCount";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0019>;
