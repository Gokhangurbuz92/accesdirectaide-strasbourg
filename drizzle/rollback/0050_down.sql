-- Rollback of 0050_rs_resource_publication (C12, /ressources publication). Independent of every other migration; run it on its own.
-- Data effect: the publication ledger "ResourcePublicationEvent" is DROPPED (who created, verified, published or withdrew each document, and when) and the
-- eight publication columns of "ResourceAccessibility" are DROPPED (source publisher, verification date, reviewer, verified version, publication and
-- withdrawal times, withdrawal reason). The documents themselves (title, type, text, source address, status) stay. Export first if the record is needed:
--   COPY (SELECT * FROM "ResourcePublicationEvent") TO STDOUT WITH CSV HEADER;
--   COPY (SELECT id, source_publisher, verified_at, reviewer_type, reviewer_id, verified_version, published_at, withdrawn_at, withdrawal_reason FROM "ResourceAccessibility") TO STDOUT WITH CSV HEADER;
-- After it the code keeps working as before 0050: /ressources lists no document and the administration tool answers « not available ».
-- Idempotent: running it twice gives the same schema.
DROP TABLE IF EXISTS "ResourcePublicationEvent";
ALTER TABLE "ResourceAccessibility" DROP CONSTRAINT IF EXISTS "ResourceAccessibility_verification_check";
ALTER TABLE "ResourceAccessibility" DROP COLUMN IF EXISTS "source_publisher", DROP COLUMN IF EXISTS "verified_at", DROP COLUMN IF EXISTS "reviewer_type",
  DROP COLUMN IF EXISTS "reviewer_id", DROP COLUMN IF EXISTS "verified_version", DROP COLUMN IF EXISTS "published_at", DROP COLUMN IF EXISTS "withdrawn_at",
  DROP COLUMN IF EXISTS "withdrawal_reason";
-- forget the migration too (its journal row, by the journal's « when » of 0050), otherwise a later run believes 0050 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794911505815;
