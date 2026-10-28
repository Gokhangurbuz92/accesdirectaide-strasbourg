-- PKG-2 rollback of drizzle/0018_pkg2_delegation.sql (documentation + tested by the migration stage). Dropping the tables ends every delegation and forgets its access log.
DROP TABLE IF EXISTS "DelegationAccessEvent";
DROP FUNCTION IF EXISTS "DelegationAccessEvent_no_update"();
DROP TABLE IF EXISTS "CitizenDelegation";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0018>;
