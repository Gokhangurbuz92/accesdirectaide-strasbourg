-- PKG-2 rollback of drizzle/0016_pkg2_mon_espace.sql (documentation + tested by the migration stage). Run only against a disposable or backed-up database.
-- Dropping these tables discards every Parcours, favourite, history entry and Coffre document ROW; the encrypted Coffre blobs must be purged from object storage separately.
DROP TRIGGER IF EXISTS "ParcoursEvent_append_only" ON "ParcoursEvent";
DROP FUNCTION IF EXISTS "ParcoursEvent_no_update"();
DROP TABLE IF EXISTS "ParcoursEvent";
DROP TABLE IF EXISTS "ParcoursItem";
DROP TABLE IF EXISTS "CitizenFavorite";
DROP TABLE IF EXISTS "CitizenHistoryEntry";
DROP TABLE IF EXISTS "CitizenDocument";
ALTER TABLE "CitizenProfile" DROP COLUMN IF EXISTS "historyEnabled";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0016>;
