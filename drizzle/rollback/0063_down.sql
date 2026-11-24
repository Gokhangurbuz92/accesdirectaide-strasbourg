-- Rollback of 0063_g14_r3_booking_needs_external (G14 release 3: needs of bookable services, external booking pages). Independent of 0060–0062.
-- Dropping the tables loses the needs tagged on services and the recorded external booking pages (and their review); no person's data is in either.
-- Idempotent: a second run changes nothing.
DROP TABLE IF EXISTS "StructureExternalBooking";
DROP TABLE IF EXISTS "ProRdvServiceSubdomain";
-- forget the migration too (its journal row, by the journal's « when » of 0063)
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795050000000;
