-- PKG-4 batch 3 rollback of drizzle/0024_pkg4_batch3.sql (documentation + tested by the migration stage). Purge the attachment blobs first (storage keys of
-- "RdvMessageAttachment"); TEST_RECORDED notice rows are mapped back to NOT_DELIVERED (the honest older meaning: nothing reached a real mailbox).
DROP TABLE IF EXISTS "RdvMessageAttachment";
ALTER TABLE "ProUser" DROP CONSTRAINT IF EXISTS "ProUser_notification_prefs_check";
ALTER TABLE "ProUser" DROP COLUMN IF EXISTS "notificationPrefs";
ALTER TABLE "DSRRequest" DROP COLUMN IF EXISTS "reviewOutcome";
ALTER TABLE "StructureProposal" DROP COLUMN IF EXISTS "reviewSourceUrl";
ALTER TABLE "AppointmentNotice" DROP CONSTRAINT IF EXISTS "AppointmentNotice_status_check";
UPDATE "AppointmentNotice" SET status = 'NOT_DELIVERED' WHERE status = 'TEST_RECORDED';
ALTER TABLE "AppointmentNotice" ADD CONSTRAINT "AppointmentNotice_status_check" CHECK ("status" IN ('DELIVERED', 'NOT_DELIVERED', 'NO_CONSENT', 'NO_RECIPIENT', 'FAILED'));
ALTER TABLE "ParcoursReminder" DROP CONSTRAINT IF EXISTS "ParcoursReminder_status_check";
UPDATE "ParcoursReminder" SET status = 'NOT_DELIVERED' WHERE status = 'TEST_RECORDED';
ALTER TABLE "ParcoursReminder" ADD CONSTRAINT "ParcoursReminder_status_check" CHECK ("status" IN ('CLAIMED', 'DELIVERED', 'NOT_DELIVERED', 'NO_CONSENT', 'FAILED'));
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0024>;
