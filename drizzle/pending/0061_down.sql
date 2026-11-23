-- Rollback of 0061_g14_ps_social_referrals (G14-PS social referrals). Independent of every other migration (nothing references these tables).
-- REFUSED while a social referral exists (they are consents and statuses owed to persons and organisations: export them first, then delete them
-- deliberately). Idempotent: a second run changes nothing.
DO $$ BEGIN
  IF to_regclass('"SocialReferral"') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "SocialReferral") THEN
      RAISE EXCEPTION '0061_down refused: social referrals exist';
    END IF;
  END IF;
END $$;
DROP TABLE IF EXISTS "SocialReferralEvent";
DROP TABLE IF EXISTS "SocialReferral";
-- forget the migration too, once its journal entry exists (idx 61; « when » set at merge — replace WHEN_OF_0061 by that value then)
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = WHEN_OF_0061;
