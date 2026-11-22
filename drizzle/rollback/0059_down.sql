-- Rollback of 0059_g14_moderation_dsa (G14 moderation staffing and DSA flows). Independent of 0053–0058.
-- REFUSED while a moderation decision, a notice or an appeal exists (they are statements of reasons and complaints owed to persons: export them first,
-- then delete them deliberately). Roles and sanctions alone do not block (they are re-created by the owner). Idempotent: a second run changes nothing.
DO $$ BEGIN
  IF to_regclass('"ModerationDecision"') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "ModerationDecision") OR EXISTS (SELECT 1 FROM "ContentNotice") OR EXISTS (SELECT 1 FROM "ModerationAppeal") THEN
      RAISE EXCEPTION '0059_down refused: moderation decisions, notices or appeals exist';
    END IF;
  END IF;
END $$;
DROP TABLE IF EXISTS "ModerationAppeal";
DROP TABLE IF EXISTS "ModerationSanction";
DROP TABLE IF EXISTS "ModerationDecision";
DROP TABLE IF EXISTS "ContentNotice";
DROP TABLE IF EXISTS "ModerationRole";
-- forget the migration too (its journal row, by the journal's « when » of 0059)
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795010000000;
