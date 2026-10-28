-- PKG-3 rollback of drizzle/0020_pkg3_appointment_notices.sql (documentation + tested by the migration stage). Forgets the notice ledger and the recorded consent dates of
-- professional-created appointments; appointments themselves are unchanged.
DROP TABLE IF EXISTS "AppointmentNotice";
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "beneficiaryConsentAt";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0020>;
