-- Rollback of 0040_r11_push_subscription (R11 / N04 web push), run BEFORE 0039_down.sql.
-- Effect: every browser's web push subscription is LOST (the person subscribes again from « Mon compte » after a re-migration); no account, preference or
-- consent row is touched (the push preferences stay as they were, and nothing is sent without a subscription). Roll back only with the code.
DROP TABLE IF EXISTS "PushSubscription";
-- the reminders already sent by push are removed with the channel (the CHECK rule of 0017 is restored: e-mail and SMS only)
DELETE FROM "ParcoursReminder" WHERE channel = 'push';
ALTER TABLE "ParcoursReminder" DROP CONSTRAINT IF EXISTS "ParcoursReminder_channel_check";
ALTER TABLE "ParcoursReminder" ADD CONSTRAINT "ParcoursReminder_channel_check" CHECK ("channel" IN ('email', 'sms'));
