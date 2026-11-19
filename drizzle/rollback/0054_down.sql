-- Rollback of 0054_x02_testimonials (X02 testimonials). Independent of every other migration (0053 included).
-- Effect: every testimonial and every report is DELETED with the two tables. The consent proofs stay in ConsentLog (append-only ledger, its own
-- retention). Export a copy first if the content must be kept. The code then behaves as on a database without 0054 (nothing listed, writes « not available »).
DROP TABLE IF EXISTS "TestimonialReport";
DROP TABLE IF EXISTS "Testimonial";
-- forget the migration too (its journal row, by the journal's « when » of 0054), otherwise a later run believes 0054 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794960000000;
