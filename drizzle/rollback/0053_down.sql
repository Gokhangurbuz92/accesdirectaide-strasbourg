-- Rollback of 0053_x04_academy_events (X04 academy and events). Independent of every other migration.
-- Effect: every academy page, every event and every registration is DELETED with the two tables (registrations: account id, event id, state, dates and
-- the optional accessibility need). Export a copy first if the content must be kept. The code then behaves as on a database without 0053 (nothing listed,
-- registration « not available »).
DROP TABLE IF EXISTS "EventRegistration";
DROP TABLE IF EXISTS "AcademyItem";
-- forget the migration too (its journal row, by the journal's « when » of 0053), otherwise a later run believes 0053 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794950000000;
