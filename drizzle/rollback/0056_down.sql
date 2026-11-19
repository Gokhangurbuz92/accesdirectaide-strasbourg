-- Rollback of 0056_x05_job_board (X05 inclusive job board). Independent of every other migration (0053, 0054 and 0055 included).
-- Effect: every job listing (draft, pending, published or ended) is DELETED with the table. No applicant data exists anywhere (none was ever stored). Export a
-- copy first if the listings must be kept. The code then behaves as on a database without 0056 (nothing listed, writes « not available »).
DROP TABLE IF EXISTS "JobListing";
-- forget the migration too (its journal row, by the journal's « when » of 0056), otherwise a later run believes 0056 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794980000000;
