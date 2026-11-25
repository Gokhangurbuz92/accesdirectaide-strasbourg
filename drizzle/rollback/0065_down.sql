-- Rollback of 0065_tg_telegram_link (optional Telegram reminders). Journal idx 65, « when » 1795070000000. Roll back only with the code (or with
-- citizen.telegram closed: the code then never reads the table). Idempotent: a second run changes nothing.
-- Effect: every Telegram link is LOST (a person links again from « Mon compte » after a re-migration); no account, preference or consent row is touched
-- (the telegram preference stays as it was, and nothing is sent without a link). The Mon Parcours reminders already recorded for the telegram channel are
-- removed with the channel, and the CHECK of 0040 is restored (e-mail, SMS, push).
DROP TABLE IF EXISTS "TelegramLink";
DELETE FROM "ParcoursReminder" WHERE channel = 'telegram';
ALTER TABLE "ParcoursReminder" DROP CONSTRAINT IF EXISTS "ParcoursReminder_channel_check";
ALTER TABLE "ParcoursReminder" ADD CONSTRAINT "ParcoursReminder_channel_check" CHECK ("channel" IN ('email', 'sms', 'push'));
-- forget the migration too (journal « when » 1795070000000)
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795070000000;
