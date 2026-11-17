-- Rollback of 0052_c8_observatory_quarter_snapshot (C8 frozen quarters). Independent of every other migration.
-- Effect: the frozen quarters are DELETED with the table (published cells only: commune codes and names, organization counts per shown commune; no
-- person, no organization id). Every quarter is then computed live again on each read, exactly as before 0052 — which reopens the « re-read the same
-- quarter » difference (docs/security/observatory-disclosure-control.md). If 0052 is applied again later, the freezing job freezes the closed quarters of
-- its window from the data as they are then (not as they were first published).
DROP TABLE IF EXISTS "ObservatoryQuarterSnapshot";
DROP FUNCTION IF EXISTS "observatory_quarter_snapshot_immutable"();
-- forget the migration too (its journal row, by the journal's « when » of 0052), otherwise a later run believes 0052 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794940000000;
