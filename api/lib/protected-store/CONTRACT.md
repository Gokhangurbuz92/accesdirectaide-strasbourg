# ProtectedStore — storage contract for HDS-relevant blobs (R46)

Scope: the encrypted blobs of **Mon Coffre** (C09) and of the **files of shared dossiers** (C14, C17; pro upload and download).
Code: `api/lib/protected-store/index.js` (selection and refusal), `certified-host.js` (HTTP client of this contract).
Status: the LAB driver exists; **no certified host is contracted**. Nothing in this document states that ADA is HDS-hosted.

## 1. Selection (`ADA_PROTECTED_STORE`)

| Value | Driver | Where it may serve |
|---|---|---|
| empty / `lab` | existing object storage (`api/lib/storage.js`: local filesystem in the LAB, S3-compatible bucket) | development / test only |
| `certified` | HTTP client of § 3 at `ADA_PROTECTED_STORE_ENDPOINT` | anywhere its configuration is valid |
| anything else | — | nowhere (refused) |

In **production and preview** (`VERCEL_ENV`), every operation is refused unless `ADA_HDS_CERTIFIED_HOSTING` holds a valid, unexpired
attestation token (format in `api/_utils/capabilities.js`, `HDS_TOKEN_FORMAT`), and the `lab` driver is refused there whatever the token.
The refusal is `503 PROTECTED_STORE_REFUSED`, no data read or written. **Erasure is never blocked**: `delete` of a key goes to the driver that
wrote it (unprefixed key → object storage; `phs1/` key → certified client, when configured) whatever the HDS gate says. This is a second lock beside the capability gate
(`citizen.vault`, `citizen.shared_dossier` have `requiresHds: true`). A token is a statement by the controller, not a verification of the certificate.

## 2. What ADA guarantees to the host

- Bytes are **already encrypted** by ADA (envelope encryption, `api/lib/data-keys.js`, AES-256-GCM, purpose- and context-bound). The host never
  receives a file name, a category, a person identifier or any metadata other than the object id, length and SHA-256.
- Object ids are random UUIDs chosen by ADA (no personal data in a URL). Keys stored in ADA's database are `phs1/<uuid>`.

## 3. HTTP interface the host must expose

Base: `ADA_PROTECTED_STORE_ENDPOINT` (https). Authentication: `Authorization: Bearer <ADA_PROTECTED_STORE_TOKEN>`. Every request carries
`Idempotency-Key: <uuid>`. Redirects are refused by the client.

| Request | Success | Other answers |
|---|---|---|
| `PUT /v1/objects/{uuid}` body = octet stream, `Content-Type`, `X-Content-SHA256: <hex>` | `201` (or `200` if the same id/digest already exists) with JSON `{ "id": "<uuid>", "sha256": "<hex>" }` — the digest of what was stored | `409` same id, different digest; `413` too large; `401/403` credential |
| `GET /v1/objects/{uuid}` | `200` bytes + header `X-Content-SHA256` | `404` absent |
| `DELETE /v1/objects/{uuid}` | `204` (`200` accepted) | `404` = already absent (treated as success: idempotent) |

The client retries network errors, `429` and `5xx` up to 3 attempts with linear backoff (PUT is safe to retry: same id); timeout per request
`ADA_PROTECTED_STORE_TIMEOUT_MS` (default 8 s). A digest mismatch on PUT or GET is an error (integrity), never silently accepted.

## 4. What the host must provide outside this interface (activation phase, not engineering)

HDS certificate covering the hosting activities used (physical + infrastructure + application hosting as contracted), contract clauses of
CSP art. L1111-8 / R1111-11, location in the EEA, backup and restore with the same guarantees, deletion on request with proof, audit access
for the controller, incident notification, reversibility (export of all objects by id). The legal review of these points is in the R44-LR / R45
documents; this file only fixes the technical interface.

## 5. Migration of existing blobs

Keys written by the `lab` driver (no `phs1/` prefix) are only readable through the `lab` driver, and `phs1/` keys only through `certified`
(mixing is refused: `KEY_OF_ANOTHER_DRIVER`). Moving LAB blobs to a certified host is a separate, owner-approved operation; there is no real data
to move today (the capabilities are closed in production).

## 6. Verification

`tests/unit/r46-protected-store.test.js` runs the selection rules and the full § 3 contract against a local mock host (retries, idempotent
delete, digest checks, refusal in production / preview, refusal of the lab driver there). `node scripts/protected-store-status.mjs` prints the
driver state of the current environment (never a value).
