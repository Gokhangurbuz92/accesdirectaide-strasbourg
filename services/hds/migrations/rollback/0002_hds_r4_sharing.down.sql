-- Rollback of 0002_hds_r4_sharing.sql (HDS database only). Run ONLY after a snapshot (Scalingo backup / PITR point) and only if the R4 sharing release is
-- withdrawn: it destroys the R4 objects (organisation and member keys, dossier threads, message attachments) and the R4 columns. 0001 data is untouched.
BEGIN;
DELETE FROM hds.blob WHERE id IN (SELECT blob_id FROM hds.message_attachment);
DROP TABLE IF EXISTS hds.message_attachment;
DROP TABLE IF EXISTS hds.dossier_message;
ALTER TABLE hds.consent_record DROP COLUMN IF EXISTS structure_id;
ALTER TABLE hds.consent_record DROP COLUMN IF EXISTS object_id;
DELETE FROM hds.consent_record WHERE purpose = 'dossier_share';
ALTER TABLE hds.consent_record DROP CONSTRAINT IF EXISTS consent_record_purpose_check;
ALTER TABLE hds.consent_record ADD CONSTRAINT consent_record_purpose_check CHECK (purpose IN ('vault_health_documents'));
ALTER TABLE hds.dossier_file DROP COLUMN IF EXISTS key_epoch;
DELETE FROM hds.dossier_grant WHERE status IN ('pending_citizen', 'refused');
ALTER TABLE hds.dossier_grant DROP COLUMN IF EXISTS purposes, DROP COLUMN IF EXISTS key_epoch, DROP COLUMN IF EXISTS consent_version, DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS proposed_by_structure, DROP COLUMN IF EXISTS referral_ref, DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS status;
ALTER TABLE hds.dossier DROP COLUMN IF EXISTS expires_at, DROP COLUMN IF EXISTS kind, DROP COLUMN IF EXISTS key_epoch, DROP COLUMN IF EXISTS owner_key;
DROP TABLE IF EXISTS hds.org_key_member;
DROP TABLE IF EXISTS hds.org_key;
DROP TABLE IF EXISTS hds.member_key;
DROP TABLE IF EXISTS hds.citizen_box_key;
DELETE FROM public.hds_schema_migrations WHERE name = '0002_hds_r4_sharing.sql';
COMMIT;
