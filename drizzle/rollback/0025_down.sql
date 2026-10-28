-- PKG-5 rollback of drizzle/0025 (documentation + tested by the migration stage): PROVIDER_ACCEPTED rows map back to the older wording DELIVERED.
ALTER TABLE "AppointmentNotice" DROP CONSTRAINT IF EXISTS "AppointmentNotice_status_check";
UPDATE "AppointmentNotice" SET status = 'DELIVERED' WHERE status = 'PROVIDER_ACCEPTED';
ALTER TABLE "AppointmentNotice" ADD CONSTRAINT "AppointmentNotice_status_check" CHECK ("status" IN ('DELIVERED', 'TEST_RECORDED', 'NOT_DELIVERED', 'NO_CONSENT', 'NO_RECIPIENT', 'FAILED'));
ALTER TABLE "ParcoursReminder" DROP CONSTRAINT IF EXISTS "ParcoursReminder_status_check";
UPDATE "ParcoursReminder" SET status = 'DELIVERED' WHERE status = 'PROVIDER_ACCEPTED';
ALTER TABLE "ParcoursReminder" ADD CONSTRAINT "ParcoursReminder_status_check" CHECK ("status" IN ('CLAIMED', 'DELIVERED', 'TEST_RECORDED', 'NOT_DELIVERED', 'NO_CONSENT', 'FAILED'));
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0025>;
