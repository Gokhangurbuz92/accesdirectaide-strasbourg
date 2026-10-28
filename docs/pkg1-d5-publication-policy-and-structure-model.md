# PKG-1 — D-5 publication policy and the structure model (N2)

> **Note (2026-10-26) — superseded criterion.** Owner decision **D-5 v2** of 2026-10-25 (`STRASBOURG_FULL_PRODUCT_PLAN/OWNER_DECISION_D5_V2_AUTOMATIC_VERIFICATION_2026-10-25.md`, one level above the repo) superseded condition 2 below ("real authorized HUMAN verification") and the "human reviewers" dependency of § 1 and § 4. Public information (aides, démarches, dispositifs, structures) is now verified and published **automatically** by the « veille automatique » (`api/_services/verification/chain.js`, system reviewer `ada-veille-automatique`, role `system`), against official sources, with its evidence in the same `ContentVerification` ledger, the same single writer (`content-verification.js`) and the same public rule (`publicVisibility.decide`). It is never presented as a person's review. Fail-closed is kept (no evidence → not published). A person can still verify or hold a record manually; privacy, safety, report and duplicate holds are never lifted by the chain. The language model still has no verification authority: it only drafts texts, deterministic checks decide. `hive-scan` is not scheduled. The text below is kept as the 2026-10-18 history.

Status: LAB design record, 2026-10-18. Prospective product decision; no frozen contract (S2B–S9) is rewritten. Nothing here is native-verified until the single PKG-1 native QA run.

## 1. D-5 — fail-closed publication (owner decision, 2026-10-18)

Public content is presented as verified / launch-ready only if ALL hold:

| # | Condition | Column / source |
|---|-----------|-----------------|
| 1 | official source / provenance established | `source_url` or `source_url_exact` non-empty |
| 2 | real authorized HUMAN verification recorded | `verification_status='VERIFIED'` and `verified_by` set — written only by `api/_services/content-verification.js` (admin JWT **with MFA**) |
| 3 | verification is current | `date_verification` = server clock at verification, not in the future, ≤ 180 d (≤ 90 d "current", 91–180 d "update needed") |
| 4 | launch eligibility and territorial applicability | `launch_eligible`, `territory_verified` |
| 5 | no blocking privacy / safety hold | `publication_hold IS NULL` |
| 6 | published | `statut` ∈ {`publie`} (structures also `actif`) |

`statut='publie'`, a successful import, or a non-null timestamp is **not** sufficient. No date is synthesised (D1: the import time is never a verification date — already enforced in S9, now extended); the language model has no verification authority (a static test asserts that no other file writes the verification columns).

One module defines the rule (`api/lib/publicVisibility.js`: `decide()` in JS, `visibleWhere()` for drizzle, `visibleSql()` for raw SQL) and is applied to: API list/detail, universal search, hybrid search, recommendations/RAG (`gemini.js`), PDFs, prerender, sitemaps, taxonomy, DREES, dispositifs, and the search cache (content epoch bumped on every verification action). Reviewers (admin) keep access to unpublished records, with the reasons they are hidden (`GET admin/content-verification`). Direct URLs of hidden records answer the same 404 as unknown records.

Empty states stay honest: the existing texts are unchanged and `OfficialResourcesNotice` adds links to the official portals themselves (service-public.fr, caf.fr, francetravail.fr, ameli.fr). No fabricated fallback records.

Modes (`ADA_PUBLIC_CONTENT_MODE`): `strict` (default; the only mode honoured when `NODE_ENV`/`VERCEL_ENV` is production) and `lab`, which additionally shows rows whose `data_origin` is `unclassified` or `synthetic_fixture`, always labelled `LAB_UNVERIFIED` ("Contenu de démonstration — non vérifié"), never "verified". A row of any other origin obeys the strict rules even in lab mode. `launchReady:false` (WS2 manifest) is unchanged.

Known limit (honest): the real LAB data (49 WS2 records) has **zero** verified records; in strict mode the public product is therefore empty by design until human reviewers verify records against official sources. A verification workbench UI is deferred (the API and the "why hidden" view exist).

## 2. N1 — personal phone numbers

`scripts/ws2-findings.mjs` gained `PERSONAL_PHONE_REVIEW` (`PRIVACY_REVIEW`): French mobile numbers (`06/07`, `+33 6/7`, `0033 6/7`, spaces/dots/dashes ignored) in a structure record. Hint only, value never reproduced. Real data: 1 hit (Mission Locale). It does not delete or edit data; the reviewer decides (and may place a `publication_hold`).

## 3. N2 — structure classification and Pro tenancy (design, NO new column)

Finding: `type_structure` is empty for all 24 launch structures; no way to tell "citizen reception" from "administrative headquarters" or "phone-only service" (e.g. 115). Decision: **do not bolt an access-mode column onto `Structure`.** Reconcile with the existing model instead:

| Concept | Meaning | Where it lives today / target |
|---------|---------|-------------------------------|
| Organization | a legal/operating body that may hold an ADA Pro account (tenant) | Pro tenancy (`ProOrganization`/members); a public structure is **not** automatically an Organization |
| Site | a physical place where a citizen can be received | `Structure` row with address/coordinates |
| Service | something offered (115, appointment desk, hotline) | not a location: a phone-only service has no Site and must not be rendered on a map or counted as a reception structure |
| Access modality | walk-in / appointment / phone-only | attribute of the Service offered at a Site (or of a phone-only Service), carried by the closed-vocabulary data file, not a new Structure column |
| Headquarters | administrative seat (directorates) | classification (`siege_administratif`) in the closed vocabulary; excluded from the citizen reception list |

Linking a public structure to a Pro organization is an explicit, human-recorded claim (partner agreement), never inferred from name/address. Bounded follow-ups, owned by later campaigns (K-series), not PKG-1: closed vocabulary for `type_structure`, a reviewed mapping of the 24 rows, a directory filter that excludes headquarters, and the Service/AccessModality model once partner organizations exist. PKG-1 only guarantees that none of this is faked: unclassified structures stay unverified and hidden in strict mode.

## 4. Human / legal / external dependencies introduced or confirmed

- DPO/legal: the age policy (`REQUIRES_LEGAL_VALIDATION`), consent wording (`CONSENT_POLICY_VERSION` is a lab proposal), retention of the consent ledger.
- Human reviewers: verification of every record against official sources; privacy review of N1 hits; structure classification.
- OpenFisca: only protocol conformance against a loopback fake engine is proven; legal accuracy of results is not.
