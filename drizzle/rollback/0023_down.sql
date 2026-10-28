-- PKG-4 rollback of drizzle/0023_pkg4_structure_proposals.sql (documentation + tested by the migration stage). Forgets pending / reviewed profile proposals; accepted values
-- already written to "Structure" stay (they were reviewed by a human).
DROP TABLE IF EXISTS "StructureProposal";
-- then: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <journal "when" of 0023>;
