-- R43-E: the AppointmentNotice ledger accepts the four notice kinds of the account-required booking (R42): BOOKED_BY_CITIZEN (Mode A, the structure is
-- told), REQUEST_RECEIVED (Mode B request), REQUEST_ACCEPTED, REQUEST_REFUSED (the structure's answer). Only the "kind" CHECK changes: no table, no column,
-- no index, no row is touched. The code skips (and counts) these kinds on a database without this migration (api/_utils/schema-features.js).
-- Applicable on Production 0042 WITHOUT the obsolete guest migrations 0043 / 0044, and on a LAB database that has them: the two account-free kinds of
-- 0043 (BOOKED_BY_GUEST, GUEST_CODE) stay allowed only where the current CHECK already allows them, so no existing row can violate the new CHECK and
-- 0043's kinds are never introduced on a database that never had 0043. Idempotent: running it twice gives the same CHECK.
DO $$
DECLARE
  previous text := (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'AppointmentNotice' AND t.relnamespace = current_schema()::regnamespace AND c.conname = 'AppointmentNotice_kind_check');
  kinds text := '''BOOKED_BY_STRUCTURE'', ''CANCELLED_BY_CITIZEN'', ''CANCELLED_BY_STRUCTURE'', ''RESCHEDULED'', ''REMINDER_J1'', ''VISIO_APPROVED'', ''VISIO_REVOKED''';
BEGIN
  IF previous IS NOT NULL AND position('''BOOKED_BY_GUEST''' IN previous) > 0 THEN
    kinds := kinds || ', ''BOOKED_BY_GUEST'', ''GUEST_CODE''';
  END IF;
  kinds := kinds || ', ''BOOKED_BY_CITIZEN'', ''REQUEST_RECEIVED'', ''REQUEST_ACCEPTED'', ''REQUEST_REFUSED''';
  ALTER TABLE "AppointmentNotice" DROP CONSTRAINT IF EXISTS "AppointmentNotice_kind_check";
  EXECUTE format('ALTER TABLE "AppointmentNotice" ADD CONSTRAINT "AppointmentNotice_kind_check" CHECK ("kind" IN (%s))', kinds);
END $$;
