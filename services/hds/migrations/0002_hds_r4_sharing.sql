-- G14-R4 — shared dossiers, organisation keys, referral payloads and message attachments in the HDS service (separate database; never applied to Neon).
-- ADDITIVE ONLY: new tables, new nullable columns, a widened CHECK. Rollback: services/hds/migrations/rollback/0002_hds_r4_sharing.down.sql (drops only
-- what this file adds; the 0001 tables and their rows are untouched). Every new object holds client ciphertext or public keys only; clear metadata is limited
-- to opaque ids of the main application, dates, sizes and closed codes.

-- ── keys of the people and organisations (public halves in clear, private halves only WRAPPED in the browser)
-- a citizen's « box » key pair (ECDH P-256): lets an organisation encrypt FOR the person (attachments, files added by a professional) without any shared secret.
-- The private half is wrapped by the person's Mon Coffre vault key (client box); the service cannot open it.
CREATE TABLE hds.citizen_box_key (
  owner_id text PRIMARY KEY,
  public_jwk text NOT NULL,              -- ECDH P-256 public key (JWK, x/y only)
  private_wrapped text NOT NULL,         -- client box { iv, ct } (private JWK sealed by the vault key)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- a professional's personal key pair (ECDH P-256): the private half is wrapped by a passphrase-derived key of that professional (client keyring, as Mon Coffre)
CREATE TABLE hds.member_key (
  member_id text PRIMARY KEY,            -- the ProUser id of the main application (ticket sub of a pro ticket)
  structure_id text NOT NULL,
  public_jwk text NOT NULL,
  keyring_sealed bytea NOT NULL,         -- server-sealed client keyring { v, kdf, iterations, salt, wrapped (private JWK), verifier }
  kek_id text NOT NULL,
  dek_wrapped bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_key_structure_idx ON hds.member_key (structure_id);

-- an organisation's key pair (ECDH P-256), one ACTIVE kid at a time; rotation adds a kid and retires the previous one (still used to open older grants)
CREATE TABLE hds.org_key (
  structure_id text NOT NULL,
  kid text NOT NULL CHECK (kid ~ '^[A-Za-z0-9_-]{4,40}$'),
  public_jwk text NOT NULL,
  created_by_ref text NOT NULL,          -- sha256 prefix of the administrator id
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  PRIMARY KEY (structure_id, kid)
);
CREATE UNIQUE INDEX org_key_active_key ON hds.org_key (structure_id) WHERE retired_at IS NULL;

-- the organisation's private key wrapped FOR one member (ECIES to the member's public key, in the administrator's browser)
CREATE TABLE hds.org_key_member (
  structure_id text NOT NULL,
  kid text NOT NULL,
  member_id text NOT NULL,
  wrapped_private text NOT NULL,         -- client box { v, epk, iv, ct }
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (structure_id, kid, member_id),
  FOREIGN KEY (structure_id, kid) REFERENCES hds.org_key (structure_id, kid) ON DELETE CASCADE
);
CREATE INDEX org_key_member_member_idx ON hds.org_key_member (member_id);

-- ── dossiers: the owner's copy of the dossier key, a key epoch (each revocation re-keys), an optional expiry, a kind
ALTER TABLE hds.dossier ADD COLUMN owner_key text;                          -- client box: the dossier key wrapped by the owner's vault key
ALTER TABLE hds.dossier ADD COLUMN key_epoch integer NOT NULL DEFAULT 1;
ALTER TABLE hds.dossier ADD COLUMN kind text NOT NULL DEFAULT 'dossier' CHECK (kind IN ('dossier', 'passport'));
ALTER TABLE hds.dossier ADD COLUMN expires_at timestamptz;

-- grants: who proposed it (the person, or a referral by an organisation), its state, expiry, the consent text version, the kid it was wrapped for
ALTER TABLE hds.dossier_grant ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending_citizen', 'active', 'revoked', 'refused'));
ALTER TABLE hds.dossier_grant ADD COLUMN source text NOT NULL DEFAULT 'citizen' CHECK (source IN ('citizen', 'referral'));
ALTER TABLE hds.dossier_grant ADD COLUMN referral_ref text;                 -- the Referral id of the main application (opaque)
ALTER TABLE hds.dossier_grant ADD COLUMN proposed_by_structure text;
ALTER TABLE hds.dossier_grant ADD COLUMN expires_at timestamptz;
ALTER TABLE hds.dossier_grant ADD COLUMN consent_version text;
ALTER TABLE hds.dossier_grant ADD COLUMN key_epoch integer NOT NULL DEFAULT 1;
ALTER TABLE hds.dossier_grant ADD COLUMN purposes text NOT NULL DEFAULT 'PURP-06';
UPDATE hds.dossier_grant SET status = 'revoked' WHERE revoked_at IS NOT NULL;

-- files: the epoch of the dossier key their file key is wrapped with
ALTER TABLE hds.dossier_file ADD COLUMN key_epoch integer NOT NULL DEFAULT 1;

-- consents: the dossier share purpose joins the health-documents one
ALTER TABLE hds.consent_record DROP CONSTRAINT IF EXISTS consent_record_purpose_check;
ALTER TABLE hds.consent_record ADD CONSTRAINT consent_record_purpose_check CHECK (purpose IN ('vault_health_documents', 'dossier_share'));
ALTER TABLE hds.consent_record ADD COLUMN object_id uuid;                  -- the dossier of a dossier_share consent
ALTER TABLE hds.consent_record ADD COLUMN structure_id text;

-- ── the dossier's thread (citizen ↔ one organisation), end-to-end encrypted with the dossier key
CREATE TABLE hds.dossier_message (
  id uuid PRIMARY KEY,
  dossier_id uuid NOT NULL REFERENCES hds.dossier(id) ON DELETE CASCADE,
  structure_id text NOT NULL,            -- the organisation of the thread
  author text NOT NULL CHECK (author IN ('citizen', 'pro')),
  kind text NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'referral_note')),
  referral_ref text,
  key_epoch integer NOT NULL,
  kek_id text NOT NULL,
  dek_wrapped bytea NOT NULL,
  body_sealed bytea NOT NULL,            -- server-sealed client box
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dossier_message_dossier_idx ON hds.dossier_message (dossier_id, structure_id, created_at);

-- ── appointment-conversation attachments (messaging.attachments), end-to-end: one file key wrapped for the person AND for the organisation
CREATE TABLE hds.message_attachment (
  id uuid PRIMARY KEY,
  binding text NOT NULL,                 -- « rdvconv:<conversation>:<citizen>:<structure> », set by the main API in the ticket (obj claim)
  owner_id text NOT NULL,                -- the citizen of the conversation
  structure_id text NOT NULL,
  uploader text NOT NULL CHECK (uploader IN ('citizen', 'pro')),
  kek_id text NOT NULL,
  dek_wrapped bytea NOT NULL,
  boxes_sealed bytea NOT NULL,           -- server-sealed { meta, keyCitizen, keyOrg } client boxes
  byte_length integer NOT NULL CHECK (byte_length > 0),
  cipher_sha256 text NOT NULL CHECK (cipher_sha256 ~ '^[0-9a-f]{64}$'),
  blob_id uuid NOT NULL REFERENCES hds.blob(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_attachment_binding_idx ON hds.message_attachment (binding);
CREATE INDEX message_attachment_owner_idx ON hds.message_attachment (owner_id);
