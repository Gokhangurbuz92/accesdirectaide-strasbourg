-- Rollback of 0045_r43_appointment_notice_kinds (R43-E), run on its own (Production 0042 + 0045) or BEFORE 0044_down.sql (LAB 0044 + 0045).
-- Effect: the ledger rows of the four booking kinds (BOOKED_BY_CITIZEN, REQUEST_RECEIVED, REQUEST_ACCEPTED, REQUEST_REFUSED) are DELETED — they only record
-- the outcome of a notice (kind, recipient, channel, status; never a text or an address); the notices themselves were sent and stay in the members' in-app
-- notifications. Export them first if they are needed (`COPY (SELECT * FROM "AppointmentNotice" WHERE kind IN (…)) TO STDOUT WITH CSV HEADER`). The CHECK
-- returns to the kinds of 0020 (plus BOOKED_BY_GUEST / GUEST_CODE where 0043 had allowed them). After it the code keeps working: it skips these kinds again.
DELETE FROM "AppointmentNotice" WHERE "kind" IN ('BOOKED_BY_CITIZEN', 'REQUEST_RECEIVED', 'REQUEST_ACCEPTED', 'REQUEST_REFUSED');
DO $$
DECLARE
  previous text := (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'AppointmentNotice' AND t.relnamespace = current_schema()::regnamespace AND c.conname = 'AppointmentNotice_kind_check');
  kinds text := '''BOOKED_BY_STRUCTURE'', ''CANCELLED_BY_CITIZEN'', ''CANCELLED_BY_STRUCTURE'', ''RESCHEDULED'', ''REMINDER_J1'', ''VISIO_APPROVED'', ''VISIO_REVOKED''';
BEGIN
  IF previous IS NOT NULL AND position('''BOOKED_BY_GUEST''' IN previous) > 0 THEN
    kinds := kinds || ', ''BOOKED_BY_GUEST'', ''GUEST_CODE''';
  END IF;
  ALTER TABLE "AppointmentNotice" DROP CONSTRAINT IF EXISTS "AppointmentNotice_kind_check";
  EXECUTE format('ALTER TABLE "AppointmentNotice" ADD CONSTRAINT "AppointmentNotice_kind_check" CHECK ("kind" IN (%s))', kinds);
END $$;
-- forget the migration too (its journal row, by the journal's « when » of 0045), otherwise a later run believes 0045 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1793792402360;
