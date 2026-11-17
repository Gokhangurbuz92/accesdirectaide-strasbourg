-- Rollback of 0051_p19_dispositif_content_type (P19 / RECON public A-6). MANUAL ONLY: never run automatically, never as a blind rollback.
-- PostgreSQL has no « ALTER TYPE … DROP VALUE »: an enum value cannot be removed in place. The only path is to rebuild the type without it, which needs
-- every row to hold one of the remaining values. This file therefore REFUSES (and changes nothing) while any "ContentReport" row is DISPOSITIF: those rows
-- must first be handled by a human decision — exported, then either reclassified to the pre-0051 form (AIDE + « dispositif:<id> », the statement is in
-- docs/vision/P19_DISPOSITIF_CONTENT_TYPE_MIGRATION_NOTE.md) or kept by not rolling back. It is NOT done here: a rollback never rewrites reports silently.
-- When no row uses the value: the type is rebuilt with the four values of 0000 (an ACCESS EXCLUSIVE lock on "ContentReport" while its column is
-- re-typed; the table is small). After it the code keeps working: it reads pg_enum (at most one minute of cache per process) and files dispositif reports
-- under AIDE + « dispositif:<id> » again; an insert refused in that minute is retried in the pre-0051 form.
DO $$
DECLARE
  n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'ContentType' AND t.typnamespace = 'public'::regnamespace AND e.enumlabel = 'DISPOSITIF') THEN
    RAISE NOTICE '0051_down: "ContentType" has no DISPOSITIF value, nothing to rebuild';
    RETURN;
  END IF;
  SELECT count(*) INTO n FROM "public"."ContentReport" WHERE "contentType"::text = 'DISPOSITIF';
  IF n > 0 THEN
    RAISE EXCEPTION '0051_down refused: % ContentReport row(s) are DISPOSITIF; export and decide on them first (see the P19 migration note)', n;
  END IF;
  LOCK TABLE "public"."ContentReport" IN ACCESS EXCLUSIVE MODE;
  ALTER TYPE "public"."ContentType" RENAME TO "ContentType_0051_old";
  CREATE TYPE "public"."ContentType" AS ENUM('AIDE', 'DEMARCHE', 'STRUCTURE', 'ACTUALITE');
  ALTER TABLE "public"."ContentReport" ALTER COLUMN "contentType" TYPE "public"."ContentType" USING "contentType"::text::"public"."ContentType";
  DROP TYPE "public"."ContentType_0051_old";
END $$;
-- forget the migration too (its journal row, by the journal's « when » of 0051), otherwise a later run believes 0051 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794930000000;
