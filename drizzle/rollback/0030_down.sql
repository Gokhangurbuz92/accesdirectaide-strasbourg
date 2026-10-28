-- PKG-11 rollback of drizzle/0030 (tested by the migration stage): recorded consent decisions become modifiable again — roll back only with the code.
-- The function "ada_append_only" belongs to 0022 and stays.
DROP TRIGGER IF EXISTS "ConsentLog_append_only" ON "ConsentLog";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0030>;
