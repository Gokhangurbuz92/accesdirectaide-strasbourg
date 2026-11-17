-- Rollback of 0049_pa_conversation_read (RECON Pro B02). Independent of every other migration.
-- Effect: the professionals' read markers are DELETED with the table (two ids and a time per row; no message, no personal content). Conversations, messages
-- and notifications are untouched. After it the code keeps working: the unread message count is « unknown » again (messages: null), as before 0049; if the
-- migration is applied again later, every never-answered conversation counts as unread until a member opens it.
DROP TABLE IF EXISTS "RdvConversationRead";
-- forget the migration too (its journal row, by the journal's « when » of 0049), otherwise a later run believes 0049 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794770972252;
