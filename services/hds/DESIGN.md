# HDS service (G14-R3) — design

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

Deployed, `citizen.vault` opens only with: AIPD listing (`ADA_CAPABILITIES_OPEN`), the documents surface, a valid `ADA_HDS_CERTIFIED_HOSTING` token **of provider `scalingo`**, `HDS_PRODUCTION_APPROVED=true`, `HDS_SERVICE_URL` an https origin on the code-reviewed allow-list (`*.osc-fr1.scalingo.io`, `*.osc-secnum-fr1.scalingo.io`), a valid signing key/kid, and the module marked `ported`. `citizen.shared_dossier` is `partial` → stays closed. Release preflight `hds.gateway` FAILs a partial configuration and a CSP `connect-src` that does not allow the HDS origin (vercel.json still `'self'` — the CSP change belongs to the opening commit).

## 6. Logging

`src/log.js` only: allow-listed fields (`evt rid m route s ms code n reason`), route templates, values matching a short safe pattern (else `[redacted]`). No body, query, header, ticket or id. No Sentry (boot refuses `SENTRY_DSN`), no log drain. Query strings are refused (nothing rides in URLs).

## 7. Erasure, backups, restore

- Account erasure (`api/_services/privacy.js` → `api/lib/hds-erasure.js`) erases the HDS side **first**; failure = nothing erased, request stays approved.
- `hds.erasure_tombstone` (sha256 of the subject) + `scripts/tombstones.js export|reapply`: after restoring a backup, erased subjects are erased again. Export the tombstones regularly (content-free) outside the HDS DB.
- Scalingo Business backups (daily + PITR, up to 50 backups per the pricing page) stay inside the HDS perimeter; **never** dump the HDS DB to K3 / R2 / a laptop.
- LAB drill (tests/integration/g14-hds-service-db.test.js): pg_dump → erase → pg_restore → resurrected → reapply → gone; the other person's document decrypts after restore; a restore with another KEK opens nothing.

## 8. Not done (blocks opening of shared dossiers)

Shared-dossier port: share/create (rights estimate inside the HDS service), passport, invitations, threads, secure messages, professional views / export / attestation / SIAO, Parcours import, organisation key distribution (wrapped dossier keys per structure), pro ticket endpoint, frontend. The HDS data plane (dossier, grants with wrapped keys, files, access log, erasure) exists and is tested.

## 9. Files

`server.js` · `migrate.js` (Procfile `postdeploy`) · `src/{config,ticket,envelope,db,service,app,log}.js` · `migrations/0001_hds_init.sql` · `scripts/tombstones.js` · `scripts/owner-deploy.sh` · `Procfile` · `scalingo.json` · `package.json` (`pg` only).
