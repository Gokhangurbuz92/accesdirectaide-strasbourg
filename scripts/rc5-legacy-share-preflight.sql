-- RC5 LEGACY SHARE MIGRATION GATE - READ ONLY.
-- Run by the data owner (psql / read-only role) against the TARGET database BEFORE setting ADA_LEGACY_SHARE_READ=0 and before removing the legacy compatibility path.
-- It changes nothing. It never prints a secret, a situation or a result: only counts and dates.
--
-- "Legacy" = SharedDiagnostic rows created before RC5 (shareTokenHash IS NULL): their single link secret was both the read link and the (only) destructive secret.
-- Since RC5 such a link is NEVER proof of ownership (no owner exists for these rows); it can only read / be redeemed while ADA_LEGACY_SHARE_READ is not '0'.
--
-- GATE:
--   live_legacy_shares = 0           -> nothing to preserve: set ADA_LEGACY_SHARE_READ=0 now (the compatibility path is then inert) and delete the path in the next release.
--   live_legacy_shares > 0           -> do NOT delete or expire them. Keep the flag until last_legacy_expiry (<= 7 days after the last pre-RC5 share was created, they expire by themselves
--                                        and the existing purge removes them). Owners of such rows can be helped by an ASSISTED, identity-verified erasure / re-share (ADA Admin privacy
--                                        console, NC dependency); a link alone is never accepted as proof of ownership.
--   live_legacy_grants > 0           -> organizations that redeemed a legacy link (grantedVia = 'legacy_link'): list them below, they lose access when the row expires.
SELECT
  count(*) FILTER (WHERE "shareTokenHash" IS NULL)                                  AS legacy_rows_total,
  count(*) FILTER (WHERE "shareTokenHash" IS NULL AND "expiresAt" > now())          AS live_legacy_shares,
  min("expiresAt") FILTER (WHERE "shareTokenHash" IS NULL AND "expiresAt" > now())  AS first_legacy_expiry,
  max("expiresAt") FILTER (WHERE "shareTokenHash" IS NULL AND "expiresAt" > now())  AS last_legacy_expiry,
  count(*) FILTER (WHERE "shareTokenHash" IS NOT NULL)                              AS rc5_rows_total
FROM "SharedDiagnostic";

SELECT count(*) AS live_legacy_grants
FROM "SharedDossierGrant" g
JOIN "SharedDiagnostic" d ON d.id = g."sharedDiagnosticId"
WHERE g."grantedVia" = 'legacy_link' AND g."revokedAt" IS NULL AND d."expiresAt" > now();

-- legacy shares that carry citizen-visible work (uploaded files / organization notes): these deserve a human look before the flag is turned off
SELECT count(*) AS live_legacy_shares_with_files_or_notes
FROM "SharedDiagnostic"
WHERE "shareTokenHash" IS NULL AND "expiresAt" > now()
  AND (jsonb_typeof(results -> '_files') = 'array' OR results ? '_followUp' OR results ? '_followUps' OR results ? '_consent');
