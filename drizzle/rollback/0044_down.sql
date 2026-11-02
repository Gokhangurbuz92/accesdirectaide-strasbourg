-- Rollback of 0044_r39_guest_reminder_consent (R39), run BEFORE 0043_down.sql.
-- Effect: account-free bookings lose their optional J-1 reminder consent (no guest reminder is sent any more; the bookings themselves, their booking-mail
-- consent and their personal links stay). Roll back only with the code.
ALTER TABLE "ProAppointment" DROP COLUMN IF EXISTS "guestReminderConsentAt";
-- forget the migration too (its journal row, by the journal's « when » of 0044), otherwise a later `migrate` believes 0044 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1793659117545;
