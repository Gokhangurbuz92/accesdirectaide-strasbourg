# FA-D7 — Partner referral adapter (`ada.partner-referral/1`) and ecosystem mapping

Status: **LAB engineering, closed.** No partner organization is connected, no agreement exists, nothing is configured in any deployed environment.
Narrowed-scope note: the owner narrowed X10 (« external partner API product ») on 21/10/2026; this adapter is not a public API product — it is a
permission-gated integration of ONE receiving organization's own tool with the referral workflow (references/07: « native ADA Pro or approved adapters
to existing partner systems »). Whether to keep it as a target is an owner decision (see the FA-D7/D8 report).

## 1. Why
A receiving organization should not have to migrate to ADA Pro to receive a referral the person authorized. Two ways stay possible:
1. **native** — the organization works in ADA Pro (unchanged, the default);
2. **adapter** — the organization's own tool is told that a referral reached it and answers from that tool; its staff still open the dossier in ADA Pro
   with their own accounts, through the grant the person gave.

## 2. Contract (versioned)
- Name and version: `ada.partner-referral/1` (field `contract` in every body, header `ADA-Contract`). A breaking change is `/2`, served side by side.
- OpenAPI: `docs/openapi.json` — path `/monitor/partner/referral-events`, `x-webhooks.partnerReferralEvent`, schemas `PartnerReferralEvent` and
  `PartnerReferralCallback` (`additionalProperties: false`), security scheme `PartnerSignature`.
- Code: `api/lib/partner-adapter/contract.js` (pure), `api/lib/partner-adapter/config.js` (configuration, transport), `api/_services/partner-adapter.js`
  (database side), `api/_handlers/monitor/partner-referral-events.js` (inbound), `api/_handlers/cron/partner-outbox.js` (outbound job).

| Direction | What | Data |
|---|---|---|
| ADA → partner | `referral.received` (the person authorized, or the sender answered a request for information), `referral.cancelled` (sender cancelled / person withdrew), `referral.expired`, `referral.closed` | referral id, state, controlled reason code, due date, link to ADA Pro. **No** name, address, e-mail, dossier content, message, note, citizen id |
| partner → ADA | `acknowledge`, `accept`, `decline` (OUT_OF_SCOPE, NO_CAPACITY, ALREADY_SUPPORTED, OTHER), `needs_info` (message), `start`, `complete` (controlled outcome, optional summary for the person) | the same fields the native receiver enters; free texts are sealed like the native ones |

Not in v1: redirect suggestion (needs ADA identifiers of other organizations), appointments, documents, sender-side actions.

## 3. Security properties (tested)
- **Signature**: `ADA-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<canonical JSON>")>`; canonical JSON = keys sorted at every level, no
  whitespace (the router parses the body first, so the signature is defined on the canonical form); tolerance 300 s; constant-time comparison; one secret
  per partner (≥ 32 characters, env `ADA_PARTNER_SECRET_<ID>`).
- **Idempotency**: outbound `Idempotency-Key` = ReferralEvent id, identical on every retry (the partner deduplicates); inbound `idempotencyKey` stored in
  AuditLog (`PARTNER_CALLBACK_APPLIED/REFUSED`, entity `PartnerCallback`, id `<partner>:<key>`): a replay returns the first answer with `replay: true`, the
  same key for another command is refused 409; the referral transition (one conditional UPDATE) guarantees that concurrent duplicates apply one step.
- **Retries**: 3 attempts per run (network error, timeout 8 s, 408/425/429/5xx; `Retry-After` honoured up to 10 s; no redirect followed); a 4xx is
  final; a failed event is retried on the next runs and abandoned after 6 failed runs (`PARTNER_EVENT_ABANDONED`) — the native inbox and notices never
  depended on the partner.
- **Audit**: every delivery and callback is an AuditLog row with identifiers only (partner id, event type, attempts, HTTP status, referral id, action,
  delegate id) — never a text, an address, a secret or the endpoint.
- **Accountability**: each inbound step runs through the native `act()` **as the partner's named delegate member** (`delegateProUserId`): the same
  membership, grant, case-assignment and state rules as a click in ADA Pro; `ReferralEvent.actorId` = that member. An inactive delegate → 409.
- **Isolation**: a callback can only touch a referral addressed to the partner's own organization (otherwise the same 404 as an unknown id).
- **Consent first**: no event before the person's authorization (`sentAt`); a refused or withdrawn-before-consent proposal is never disclosed.
- **Graceful no-integration**: without configuration the job reads nothing and the callback answers 404; referrals follow the native path unchanged.

## 4. Locks (all needed to open)
1. Capability `partner.referral_adapter` (outside the AIPD, `requiresHds: true`) listed in `ADA_CAPABILITIES_OPEN`, its surface `pro` open, a valid HDS
   attestation, and `pro.referrals` open.
2. `ADA_PARTNER_ADAPTERS` (+ the partner's secret); in production / preview also `ADA_PARTNER_ADAPTERS_PRODUCTION_APPROVED=true`.
3. Job `partner-outbox` (category C) named in `ADA_BETA_OPEN_JOBS` AND `ADA_JOBS_APPROVED` (R3: scheduled hourly at minute 41 in `vercel.json`; refused while not named).
   Release preflight check `partner.bridge` (scripts/release-preflight.mjs) FAILS on a half-open bridge; the admin page « Fournisseurs » shows the row
   `partner-bridge`. Onboarding kit: `docs/partner-bridge/ONBOARDING_FR.md`; operator runbook: `docs/partner-bridge/RUNBOOK_OPERATEUR_FR.md`;
   conformance tool: `scripts/partner-bridge-kit.mjs`. Key rotation: `ADA_PARTNER_SECRET_<ID>_PREVIOUS` (inbound only). Inbound rate limit 120/min per partner.
4. Outside the code: a written agreement with the organization (processing roles, RGPD art. 28 or joint controllership, security annex), the AIPD
   extension (P8), a certified HDS host if the referral concerns an ESSMS / health data, and the person's information.

## 5. Ecosystem mapping — DORA / La plateforme de l'inclusion (DESIGN ONLY, nothing implemented)
Source: Helpdesk DORA, « Nouveauté novembre 2026 : comprendre l'évolution de l'orientation depuis DORA »,
https://aide.dora.inclusion.gouv.fr/fr/article/nouveaute-novembre-2026-comprendre-levolution-de-lorientation-depuis-dora-1l9013l/ (article updated
30/10/2026; read 18/11/2026). Facts read there:
- from **16 November 2026**, orientation requests started from a DORA service sheet are sent and **tracked on La plateforme de l'inclusion** (dashboard
  « Demandes envoyées », tab « Orientations vers des services »); DORA remains the directory; requests sent before that date stay visible in DORA;
- statuses there: in progress, validated, declined, expired; e-mail on acceptance / refusal; reminders every 10 days, closure after 30 days;
- the prescriber needs a La plateforme de l'inclusion account attached to a validated organization;
- the article mentions **no API or data exchange** for this orientation flow.

Consequences for ADA (binding wording rule): **DORA / La plateforme de l'inclusion do have orientation tracking.** No ADA text may claim that competitors
or public tools lack referral or orientation follow-up. ADA's distinctive elements may be described only positively and factually (e.g. the person's
explicit authorization before any transmission, the person's own view of the referral in Mon Espace), never by denying others' features.

Possible mapping, **if** an official, authorized interface is ever published and an agreement exists (not assumed; no partner API is assumed freely
available):

| ADA (`ada.partner-referral/1`) | La plateforme de l'inclusion (as described by the article) | Note |
|---|---|---|
| `referral.received` (SENT) | request sent to a service | ADA would only ever emit after the person's authorization |
| `accept` | « validée » | |
| `decline` + code | « refusée » | motive vocabularies differ: a mapping table reviewed by both sides would be needed |
| `referral.expired` (5 days + 14 days without answer) | « expirée » (closed after 30 days, reminders every 10 days) | different deadlines: keep each system's own rule, never translate one into the other |
| `needs_info`, `start`, `complete` + outcome | no equivalent named in the article | stays ADA-only |
| ADA Pro deep link | the service's form on La plateforme de l'inclusion | the simplest compliant bridge today is a **link** to the official form, not a data exchange |

Until then, the only honest bridge is informational: ADA's public directory already attributes services « déclaré par la structure sur DORA »
(data·inclusion, Licence Ouverte 2.0); a future « orienter via La plateforme de l'inclusion » link on such a service would open the official form in the
professional's own account — no data from ADA is transmitted.

## 6. Not done / not claimed
No real partner, no partner agreement, no partner security review, no penetration test of the endpoint, no HDS host, no AIPD extension. Tests are
LAB_SYNTHETIC: `tests/unit/fa7-partner-adapter-contract.test.js`, `tests/integration/fa7-partner-adapter-db.test.js` (a local mock partner on 127.0.0.1).
