-- PKG-2 rollback of drizzle/0017_pkg2_parcours_reminders.sql (documentation + tested by the migration stage). Dropping the table only forgets which reminders were already sent.
DROP TABLE IF EXISTS "ParcoursReminder";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0017>;
