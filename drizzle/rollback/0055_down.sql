-- Rollback of 0055_x01_community_stories (X01 community stories). Independent of every other migration (0053 and 0054 included).
-- Effect: every pseudonym, every story and every report is DELETED with the three tables. The consent proofs stay in ConsentLog (append-only ledger, its
-- own retention). Export a copy first if the content must be kept. The code then behaves as on a database without 0055 (nothing listed, writes « not available »).
DROP TABLE IF EXISTS "CommunityStoryReport";
DROP TABLE IF EXISTS "CommunityStory";
DROP TABLE IF EXISTS "CommunityMember";
-- forget the migration too (its journal row, by the journal's « when » of 0055), otherwise a later run believes 0055 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794970000000;
