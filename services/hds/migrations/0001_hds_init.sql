-- G14-R3 — HDS service schema (separate database, separate migrations; never applied to Neon).
-- END-TO-END encryption: documents, their names / categories / types and dossier contents are encrypted IN THE BROWSER with keys the service never
-- holds (src/lib/vaultCrypto.js). The service stores only client ciphertext (« boxes »), which it seals AGAIN with a per-object data key wrapped by a
-- KEK of HDS_DATA_KEYS (defence in depth: a database dump alone opens nothing). Metadata kept in clear, minimal: opaque ids of the main application,
-- ciphertext length, dates, optional expiry date, the organisation id of a grant. No column holds a file name, a category, a type or a content.
CREATE SCHEMA IF NOT EXISTS hds;

-- object storage of the HDS perimeter: ciphertext only, addressed by a random id (driver "pg"; an S3-compatible HDS bucket can replace it, same interface)
CREATE TABLE hds.blob (
  id uuid PRIMARY KEY,
  content bytea NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_length integer NOT NULL CHECK (byte_length >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Mon Coffre (C09): the person's keyring (vault key wrapped by a passphrase-derived key, in the browser) — opaque to the service
CREATE TABLE hds.vault_keyring (
  owner_id text PRIMARY KEY,
  kek_id text NOT NULL,
  dek_wrapped bytea NOT NULL,
  keyring_sealed bytea NOT NULL,        -- server-sealed client JSON {v, kdf, iterations, salt, wrapped, verifier}
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hds.vault_document (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  kek_id text NOT NULL,
  dek_wrapped bytea NOT NULL,
  boxes_sealed bytea NOT NULL,          -- server-sealed client boxes {meta, dek}: name, category, type and the document key, all client-encrypted
  byte_length integer NOT NULL CHECK (byte_length > 0),          -- of the client ciphertext (quota)
  cipher_sha256 text NOT NULL CHECK (cipher_sha256 ~ '^[0-9a-f]{64}$'),   -- of the client ciphertext (integrity)
  blob_id uuid NOT NULL REFERENCES hds.blob(id),
  scan_status text NOT NULL DEFAULT 'NOT_SCANNED',                -- end-to-end encrypted: no server-side scan is possible
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vault_document_owner_idx ON hds.vault_document (owner_id, created_at DESC);

-- explicit consent (RGPD art. 9.2.a) to keep health documents, per person and text version
CREATE TABLE hds.consent_record (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('vault_health_documents')),
  text_version text NOT NULL,
  given_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz
);
CREATE INDEX consent_record_owner_idx ON hds.consent_record (owner_id, purpose);

-- shared dossier (C14 / C17) — data plane of the port; the capability stays closed until the whole module is ported (api/_utils/hds-gateway.js)
CREATE TABLE hds.dossier (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  kek_id text NOT NULL,
  dek_wrapped bytea NOT NULL,
  content_sealed bytea NOT NULL,        -- server-sealed client box
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dossier_owner_idx ON hds.dossier (owner_id);

CREATE TABLE hds.dossier_grant (
  dossier_id uuid NOT NULL REFERENCES hds.dossier(id) ON DELETE CASCADE,
  structure_id text NOT NULL,
  wrapped_key bytea,                    -- the dossier key wrapped (client-side) for the organisation; opaque to the service
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (dossier_id, structure_id)
);

CREATE TABLE hds.dossier_file (
  id uuid PRIMARY KEY,
  dossier_id uuid NOT NULL REFERENCES hds.dossier(id) ON DELETE CASCADE,
  structure_id text,                    -- the organisation that added it or to which it was sent (visible to it only)
  added_by text NOT NULL CHECK (added_by IN ('citizen', 'pro')),
  kek_id text NOT NULL,
  dek_wrapped bytea NOT NULL,
  boxes_sealed bytea NOT NULL,
  byte_length integer NOT NULL CHECK (byte_length > 0),
  cipher_sha256 text NOT NULL CHECK (cipher_sha256 ~ '^[0-9a-f]{64}$'),
  blob_id uuid NOT NULL REFERENCES hds.blob(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dossier_file_dossier_idx ON hds.dossier_file (dossier_id);

-- content-free access trail (what the person sees: who opened their dossier). No IP, no staff identifier in clear (hashed), no content.
CREATE TABLE hds.access_event (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  owner_id text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('citizen', 'pro', 'system')),
  actor_ref text NOT NULL,              -- sha256 prefix of the actor id
  structure_id text,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id uuid
);
CREATE INDEX access_event_owner_idx ON hds.access_event (owner_id, at DESC);

-- replay protection: every ticket is single-use
CREATE TABLE hds.ticket_use (
  jti text PRIMARY KEY,
  exp timestamptz NOT NULL
);
CREATE INDEX ticket_use_exp_idx ON hds.ticket_use (exp);

-- anti-resurrection: subjects erased (sha256 of the subject id). Exported regularly (content-free) and re-applied after a restore.
CREATE TABLE hds.erasure_tombstone (
  subject_hash text PRIMARY KEY CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  erased_at timestamptz NOT NULL DEFAULT now()
);
