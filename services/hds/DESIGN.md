# HDS service (G14-R3, R4) — design

Status: built and tested in the LAB; **not deployed**. Target: the existing Scalingo app `ada-hds-strasbourg` (osc-fr1, HDS option chosen at creation, no addon, no container yet). Plan: `CONTROL/master/G14_HDS_MIGRATION_PLAN.md` (option 1). Nothing here states that ADA is HDS-hosted today.

## 1. Data flow

```
Browser (SPA, Vercel)
  ├─ GET /api/citizen/hds-ticket?cap=citizen.vault   (cookie session; Vercel reads the session + age policy only)
  │     ← { ticket (ES256, 60 s, single use), origin }
  └─ fetch <HDS origin>/v1/vault/...   Authorization: Bearer <ticket>, no cookie, CORS exact origin
        body = END-TO-END encrypted boxes { iv, ct } (src/lib/vaultCrypto.js)
        ↓
     ada-hds (Scalingo osc-fr1, HDS)  →  PostgreSQL Business (HDS)   — ciphertext only
```

Vercel / Neon never receive a document, a file name, a category or a dossier content. In a deployed environment every Vercel route of `citizen.vault` / `citizen.shared_dossier` answers `409 HDS_SERVICE_REQUIRED` (open) or `503` (closed) before its handler runs (`api/_utils/hds-gateway.js`, `api/_utils/capabilities.js`).

## 2. End-to-end encryption (owner 24/11/2026)

- Passphrase → PBKDF2-SHA256 (600 000 iterations, 16-byte salt) → passphrase key (non-extractable) → unwraps the **vault key** (32 random bytes, stored only wrapped: `hds.vault_keyring`).
- Per document: random file key; `content` = AES-GCM(file key, bytes); `meta` = AES-GCM(file key, {name, category, type}); `dek` = AES-GCM(vault key, file key).
- The service checks sizes, quotas, ownership, tickets — never content. It cannot sniff the type or run an antivirus (stated: `scanStatus = NOT_SCANNED`); the type check runs in the browser.
- **Server layer on top (defence in depth)**: each stored object (blob, boxes, keyring, dossier) is sealed again with its own data key wrapped by a KEK from `HDS_DATA_KEYS` (Scalingo env only). A dump without the KEK opens nothing; a dump with the KEK still yields only client ciphertext.
- Consequence: a forgotten passphrase = documents lost (said on screen). Host and operator access to health data is practically never needed (no readable content exists on the server), which supports a non-health-professional HDS contact person.
- Clear metadata kept (minimal): opaque account id of the main app, ciphertext length, dates, optional expiry date, organisation id of a grant, content-free access events.

## 3. Storage

Scalingo offers no HDS object storage. Ciphertext is stored in the HDS PostgreSQL (`hds.blob`, bytea, ≤ 3 MB per file, 50 MB per person = ≤ 10 GB included in Business 512M for ~200 full vaults; extra storage €0.0007/GB-h). The blob interface (`pgBlobStore`: put/get/delete by random id) is the one an S3-compatible HDS bucket driver would implement later (e.g. an HDS-certified Outscale bucket under its own contract) — not needed at this volume. Same backups / PITR as the database, inside the HDS perimeter.

## 4. Tickets

ES256 (P-256), `iss=ada-main`, `aud=ada-hds`, `kid`, closed claim set (`sub typ caps str role jti iat nbf exp`), TTL 60 s (service refuses > 120 s, skew 30 s), **single use** (`hds.ticket_use`, replay → 401). The service holds public keys only (`HDS_TICKET_PUBLIC_KEYS`, rotation = two entries); `JWT_SECRET` is never shared. `vault.write` is granted only when the main age policy allows storing documents. `system` tickets (`hds.erase`) let the main API erase an account.

## 5. Fail-closed switch (main app)

Deployed, `citizen.vault` opens only with: AIPD listing (`ADA_CAPABILITIES_OPEN`), the documents surface, a valid `ADA_HDS_CERTIFIED_HOSTING` token **of provider `scalingo`**, `HDS_PRODUCTION_APPROVED=true`, `HDS_SERVICE_URL` an https origin on the code-reviewed allow-list (`*.osc-fr1.scalingo.io`, `*.osc-secnum-fr1.scalingo.io`), a valid signing key/kid, and the module marked `ported`. `citizen.shared_dossier` (R4), `messaging.attachments` and the payload capabilities `pro.referrals`, `partner.referral_adapter`, `citizen.orientation_records` follow the same rule. Release preflight `hds.gateway` FAILs a partial configuration and a CSP `connect-src` that does not allow the HDS origin (vercel.json still `'self'` — the CSP change belongs to the opening commit).

## 6. Logging

`src/log.js` only: allow-listed fields (`evt rid m route s ms code n reason`), route templates, values matching a short safe pattern (else `[redacted]`). No body, query, header, ticket or id. No Sentry (boot refuses `SENTRY_DSN`), no log drain. Query strings are refused (nothing rides in URLs).

## 7. Erasure, backups, restore

- Account erasure (`api/_services/privacy.js` → `api/lib/hds-erasure.js`) erases the HDS side **first**; failure = nothing erased, request stays approved.
- `hds.erasure_tombstone` (sha256 of the subject) + `scripts/tombstones.js export|reapply`: after restoring a backup, erased subjects are erased again. Export the tombstones regularly (content-free) outside the HDS DB.
- Scalingo Business backups (daily + PITR, up to 50 backups per the pricing page) stay inside the HDS perimeter; **never** dump the HDS DB to K3 / R2 / a laptop.
- LAB drill (tests/integration/g14-hds-service-db.test.js): pg_dump → erase → pg_restore → resurrected → reapply → gone; the other person's document decrypts after restore; a restore with another KEK opens nothing.

## 8. G14-R4 — shared dossiers, organisation keys, referral payloads, attachments (`src/sharing.js`, migration `0002_hds_r4_sharing.sql`)

- **Keys.** Each professional creates a personal ECDH P-256 pair; its private half is wrapped by their passphrase (PBKDF2, as Mon Coffre) — `hds.member_key`. An administrator (ticket role `STRUCTURE_ADMIN`) creates the organisation pair in the browser and wraps its private half for each member (ECIES to the member's public key) — `hds.org_key`, `hds.org_key_member`. Rotation adds a kid, retires the previous one and re-issues every wrap (a removed member is simply not re-wrapped). A person has a « box » pair (private half wrapped by the vault key) so an organisation can encrypt for them — `hds.citizen_box_key`.
- **Dossier.** Content, file keys and thread-message keys are encrypted with a random dossier key; the owner keeps it wrapped by the vault key (`owner_key`), each recipient organisation receives it wrapped (ECIES) to its CURRENT public key (`dossier_grant.wrapped_key`, `kid` checked). A grant needs the explicit consent to the approved text version (`HDS_SHARE_CONSENT_VERSION`; absent = every new grant refused), may carry an end date, and is recorded in `consent_record` (purpose `dossier_share`).
- **Revocation re-wraps.** A revoke voids the grant and signals `rekeyRequired`; the owner's browser sends ONE atomic re-key: new dossier key, content re-encrypted, every file / message key re-wrapped (file bytes keep their own key), every remaining grant re-wrapped; an incomplete payload changes nothing. `key_epoch` makes stale writes fail.
- **Referral payload** (`pro.referrals`, FA-D7 bridge). The sending organisation wraps the dossier key for the receiver → a `pending_citizen` grant + an encrypted note; only the person activates (consent) or refuses (note erased). The main application keeps the workflow (closed codes, states) with a content-free pointer row and asks the service, with a system ticket, only « does structure X hold an active grant of dossier D, whose is it » (`/v1/internal/dossier-ref`). The partner event names the dossier by id (`dossierRef`), never its content.
- **Attachments** (`messaging.attachments`). The ticket carries `obj = rdvconv:<conversation>:<citizen>:<structure>` set by the main API after checking the party; the file key is wrapped for the person's box key AND the organisation key; another conversation, person or organisation gets « not found ». The main API stores only `{ hdsAttachmentId, byteLength, sha256 }`; deployed, file bytes are refused there.
- **Export, erasure, retention.** `/v1/vault/export` returns everything the person owns, as stored; the browser decrypts it. Erasure covers the new tables (and a professional's key and wraps). `scripts/maintenance.js purge-expired` (PROPOSED schedule) erases dossiers past their end date + 30 days and closes expired grants.
- **Not ported (stated):** account-free share links (a guest without an account) have no HDS equivalent; AI synthesis of a dossier (`ai.processing`) stays closed; the SI-SIAO automated interface does not exist (the SIAO sheet is prepared in the browser).

## 9. Files

`server.js` · `migrate.js` (Procfile `postdeploy`) · `src/{config,ticket,envelope,db,service,sharing,app,log}.js` · `migrations/0001_hds_init.sql`, `0002_hds_r4_sharing.sql` (+ `rollback/`) · `scripts/tombstones.js`, `scripts/maintenance.js` · `scripts/owner-deploy.sh` · `Procfile` · `scalingo.json` · `package.json` (`pg` only).
