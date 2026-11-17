-- P19 (RECON public A-6): a content report about a dispositif gets its own kind. Until now POST /api/feedback filed it under AIDE with its target written
-- « dispositif:<id> » (the "ContentType" enum had no value for it). Additive only: one enum value appended; no table, column, constraint or row changes, and
-- nothing is rewritten — reports already filed as AIDE + « dispositif:… » stay as they are (a reclassification is a separate, owner-approved data step:
-- docs/vision/P19_DISPOSITIF_CONTENT_TYPE_MIGRATION_NOTE.md). IF NOT EXISTS makes a second run a no-op. PostgreSQL 12+ accepts ADD VALUE inside the
-- migration transaction; the value is only USED after commit (by the code, which asks pg_enum first: api/_utils/schema-features.js contentTypeSchema()).
-- The code works on a database without it: dispositif reports are then filed as before (AIDE + « dispositif:<id> »).
ALTER TYPE "public"."ContentType" ADD VALUE IF NOT EXISTS 'DISPOSITIF';
