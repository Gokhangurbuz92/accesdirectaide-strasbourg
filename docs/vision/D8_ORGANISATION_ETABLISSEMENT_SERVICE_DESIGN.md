# D8 — Organisation / Établissement / Service / Droits-dispositifs / Routes d'orientation

Owner decision D8 (17/11/2026): restructuring in Production is **deferred**. Engineering analysis, fixes that need no schema change, the target model, the migration design and a read-only adapter are prepared in LAB. Nothing here changes Production, applies a migration or journals one. The draft SQL lives outside `drizzle/`: `docs/vision/d8-draft-migration.sql`.

Base: `297c2b3` (Production; Production DB at migration 0052). Branch `d8-structure-model`.

## 1. Why it matters

ADA keeps one table, `Structure`, for five things the product treats as different (CLAUDE.md §1: *organisation ≠ establishment ≠ service ≠ right ≠ referral route*):

| Concept | What it is | Official key | Where it lives today |
|---|---|---|---|
| Organisation | the legal or operating body (collectivité, association, établissement public, entreprise) | SIREN (INSEE, 9 digits); RNA (associations); FINESS EJ (health and social register) | nowhere as such. `Structure.rna_id` (unique) is organisation-level; the SIREN is only the first 9 digits of a SIRET; the FINESS EJ is read by the importers and dropped |
| Établissement | a place (or a phone line) of that body | SIRET (SIRENE establishment); FINESS ET; Annuaire de l'administration entry | `Structure` row (`siret` unique, `numero_finess` unique, `source_annuaire`) |
| Service | what is offered there | FINESS authorised activity; data·inclusion service; ADA Pro bookable service | `Structure.services` (text[]), `Structure.services_externes` (jsonb, attributed), `ProRdvService` (per structure) |
| Droit / dispositif | the right or scheme a service helps with | DILA fiche, Légifrance | `Aide`, `Demarche`, `Dispositif` (+ `Dispositif.related_structure_ids`, `Aide.structures_links`) |
| Route d'orientation | « for this need, in this territory, orient to this service » | none (curated) | not modelled: `Referral.toStructureId` + `reasonCode` |

The tenant of ADA Pro is also a `Structure` row (`ProUser.structureId`, NOT NULL). Twenty-eight tables reference a structure id by column (29 with `Aide.structures_links`, a text array) — ProUser, ProRdvService, ProAppointment, SharedDossierGrant, Referral ×3, ProCase, StructureDuplicateDecision ×3, …

## 2. Evidence-based analysis

Method: code reading of every path that creates, identifies, groups or targets a `Structure`; one public open-data read (opendata.strasbourg.eu `mediation_numerique_lieux`, 69 records, read 17/11/2026, no personal data sent); a failing test on real PostgreSQL (LAB database `ada_d8_structure`, migrations 0000–0052) for each defect **before** its fix. File:line refer to `297c2b3`.

Real-data facts found (public dataset):
- two records named « Etape numérique Neuhof Lizé », postal code 67100, same street, are two different operators (different SIRET in the `pivot` field, different telephone);
- 18 places (the « Centres médico-sociaux ») carry **one** SIRET (the manager's); 7 « Agence Pôle emploi » share another one.
So a SIRET is not a place identifier, and « name + postal code » is not one either.

### Findings

| # | Kind | Where (at 297c2b3) | What happened | Test | Severity | Status |
|---|---|---|---|---|---|---|
| F1 | (a) identification, (b) | `api/_handlers/cron/ingest-structures.js:56` `findByIdentity`, `:232`, `:275` | identity = dataset + SIRET, else dataset + name + postal code. Two operators with one name at one address became **one** record; every run overwrote it with the other operator's facts (a version snapshot each run; on a VERIFIED record a review item for a « difference » that is only the other operator); the second operator never had a record. With a manager SIRET on several places, every place was the first one's record (and the insert of another record with that SIRET fails on the UNIQUE). Cron scheduled (`/api/cron/ingest-structures`). | `tests/integration/d8-ingest-identity-db.test.js` (5 of 6 failed before the fix: `updated 2` on every identical run) | **High** for directory truth (a place's phone flips between two operators); limited today because the dataset has no `siret` field (the `pivot` is not read), but the name collision is live | **Fixed** |
| F2 | (a) identification | `api/_services/verification/chain.js:1210` `feedFiness` → `sameRecord` | an establishment of FINESS whose SIRET was held by a record of another register was « already listed », whatever its name and address. A CCAS office of the Annuaire and the EHPAD it manages (one manager SIRET) → the EHPAD was never created. Inconsistent with the duplicate assessor (`duplicate-evidence.js`: two registers, two functions → distinct). | `tests/integration/finess-veille-db.test.js` (extended: `finess:alreadyListed` was 2, expected 1) | **Medium** (an official establishment missing from the directory; no wrong data shown) | **Fixed**: SIRET counts only with the same name or street |
| F3 | (b) duplicates → (c) wrong tenant / (d) misleading destination | `api/_services/referrals.js:137` `eligibleReceivers`; `api/_handlers/public/dossier-grants.js:61,90`; `api/_services/platform-invitation.js:58` | a record that an active SAME_ENTITY decision of the duplicate register put aside stays `actif` + `VERIFIED` with its members: it was offered as a referral receiver, a redirect suggestion, a dossier-sharing destination, and a SUPERADMIN could invite a first STRUCTURE_ADMIN onto it — the same organisation twice in each picker (same name, same town), and a new tenant on the record ADA itself recorded as the duplicate. | `tests/integration/d8-duplicate-destination-db.test.js` (3 of 4 failed before) | **Medium** (privacy-relevant: a dossier or a team lands on the wrong record of the organisation) | **Fixed**: `notPutAsideAsDuplicateSql` / `keptInsteadOf` (`api/_utils/org-eligibility.js`) — an identity rule, kept apart from publication and verification; nothing existing is touched |
| F4 | (c) protection computed at the wrong level | `api/_services/territorial-stats.js:237` (K_ORGS), `:265`, `:278`, `:280` (contributions) | the C8 disclosure rules (« ≥ 3 organisations » per commune, p % rule with a coalition of 2) counted **records**. Three establishments of one SIREN, or a record and its put-aside duplicate, made « 3 organisations » alone or passed the p % rule although one body knows all those shares. | `tests/integration/d8-observatory-entity-db.test.js` (3 of 3 failed before) | **Medium** (privacy, latent: needs several pro-active records of one body in one commune; closed quarters already frozen are unchanged) | **Fixed**: contributor = SIREN of the SIRET, else the record kept by the duplicate register, else the record (never looser than before); new French methodology line `organisations` |
| F5 | (d) misleading choice | `api/_services/referrals.js:141` (`name`, `city` only), `src/pages/pro/Cases.jsx:215`, `src/pages/pro/Referrals.jsx:149`; citizen consent text names `target.name` only | two receiving establishments of one organisation with the same name in the same town cannot be told apart in the picker nor in the person's consent request. | not reproduced as a test (UI) | Low–Medium | **Not fixed — owner decision needed**: which establishment attribute may be shown to another professional and to the person (street address can be confidential: shelters), see §7 |
| F6 | (b) duplicates not detected | `api/_handlers/pro/auth/register.js:111` (self-registration creates a Structure without postal code) + `api/_services/duplicate-register.js:46` (name pairs need the same postal code) | a self-registered tenant is a second `Structure` of a directory organisation and is never proposed as a duplicate candidate (no SIRET, no address, no postal code). | reasoning only | Low (self-registration is closed in Production, R43 E1) | Not fixed (closed path; target model §3 separates tenant from directory record) |
| F7 | (a) model | `src/db/schema.ts:263` `siret` UNIQUE; `:273` `numero_finess` UNIQUE; `:274` `rna_id` UNIQUE | three identifiers of three levels in one table with three UNIQUE constraints: an EHPAD and its SSIAD (two FINESS ET, one SIRET) cannot both carry the SIRET (`finess-veille-db.test.js` asserts the SSIAD's `siret` is NULL); an association with two places cannot carry its RNA twice. Identifiers are lost, not wrong. | existing test (documents it) | Medium (blocks organisation grouping) | Design §3 (stage 4) |
| F8 | (a) model | `api/lib/ingestion/FinessConnector.js:28` (`nofinessej` column documented, not extracted), `api/_services/verification/finess.js:142` (`pmFiness`, `legalName`, `siren` parsed) | the FINESS legal entity (EJ), its legal name and SIREN are parsed and never stored. | reading | Medium (the organisation level is recoverable only by re-reading FINESS) | Design §4 (stage 2 backfill from the official file) |

### Checked and NOT happening (with evidence)

- **Pro sign-in does not grant a structure from a SIRET.** ProConnect keeps the SIRET claim but grants nothing with it (`api/_handlers/pro/auth/proconnect.js:142` matches by verified e-mail only; `api/lib/proconnect-oidc.js:239`). Password sign-in checks every account of an e-mail and opens only the one whose password matches (`api/_handlers/pro/auth/login.js:66-73`).
- **No handler trusts a structure id from the request for access**: the only body `structureId`s are the account choice at sign-in (above), the admin sensitivity review (admin MFA) and the citizen's own sharing choice (`dossier-grants.js:59`, checked against E01 + now F3).
- **Dossier access is per establishment and per case**: `SharedDossierGrant.structureId` + `activeMemberSql` + `caseAccessSql` (`api/_utils/share-access.js:103-145`); a grant to one record never opens another record of the same organisation. Existing suites (`pkg4-cases-referrals-db`, `rc5-sharing-model-db`, `pkg5-e01-entry-db`) pass unchanged.
- **The duplicate assessor already distinguishes SIREN / SIRET / FINESS / Annuaire** (`api/_services/duplicate-evidence.js`) and the veille's SIRET merge was fixed in `3b91d91`/`0b830cd` (ancestor of the base).
- **G1 territory scope** is a label on the institutional account turned into INSEE communes (`api/lib/geography/territoryScope.js`), independent of the Structure model; organisations are placed by declared address. No wrong-level grant found (`g1-territory-scope-db` passes).

## 3. Target model

```
Organisation (SIREN | RNA | FINESS EJ | human evidence)
   └── Établissement = today's Structure row (same id)      ← tenant of ADA Pro stays here
          ├── Service (origin: FINESS activity | data·inclusion | ADA Pro | directory text | reviewed)
          │      └── ServiceRight → Aide / Démarche / Dispositif  (a link, never an entitlement)
          └── OrientationRoute (need × territory → établissement [+ service]), curated, reviewed
Referral: toStructureId (receiving establishment, unchanged) + toServiceId? + routeId?
ProUser: home establishment (unchanged) + ProUserEstablishmentScope (explicit, audited extension)
```

Decisions embedded in the design:
1. **`Structure` becomes the establishment table, with the same id.** All 28 referencing tables, the D-5 publication rule, the verification ledger and the public routes keep working. No rename in Production.
2. **Organisation exists only with an identifier** (SIREN, RNA, FINESS EJ) or a person's decision with an official URL (`identityBasis = HUMAN_EVIDENCE`). Never from a name or an address. The legal name is read from the register (SIRENE / FINESS+), never copied from an establishment's name.
3. **SIRET is not unique in ADA** (one manager SIRET on many places; one SIRET for an EHPAD and its SSIAD). FINESS ET and Annuaire id remain unique per establishment. The unique on `Structure.siret` is dropped only at stage 4.
4. **Service carries its origin** and is never merged across origins; a FINESS activity is an authorisation, never a free place (existing D-5 wording rule).
5. **Tenant ≠ organisation.** A professional's default scope stays the home establishment. An organisation-wide scope is an explicit, audited grant; a citizen's grant stays per establishment (purpose limitation: what the person authorised is never widened to the rest of the organisation).
6. **Routes are curated**: DRAFT → ACTIVE only with a named reviewer (same discipline as D11 for rights). A referral without route keeps working.
7. **Observatory contributor = Organisation id** (replaces the SIREN heuristic of F4 once stage 2 is done; strictly not looser).

## 4. Keys and backfill rules (no invented data)

| Target | Source of truth | Backfill rule | Never |
|---|---|---|---|
| `Organisation.siren` | `Structure.siret` (14 digits) → first 9 digits (INSEE rule) | one Organisation per distinct SIREN; `nom` NULL until the veille reads the SIRENE legal name (annuaire-entreprises, already an allowed source) | use an establishment name as the organisation's name |
| `Organisation.finessEj` | FINESS file `nofinessej` / FINESS+ `numFinessPm` (+ `denominationLonguePmSmsse`, `siren`) | importer change: store it on the next official run (no SQL backfill: not in the DB today) | derive an EJ from an ET number |
| `Organisation.rna` | `Structure.rna_id` | one Organisation per RNA | merge an RNA organisation with a SIREN one without a register saying so (the SIRENE record of an association carries its RNA: link only then) |
| `Structure.organisationId` | the above + active SAME_ENTITY decisions (the put-aside record takes the kept record's organisation) | `organisationBasis` records why; NULL when nothing identifies it | a NULL filled by name/address similarity |
| tenants (self-registered, platform) | none | stay NULL until a human links them with evidence (PKG-1 N2: « never inferred from name/address ») | auto-link a tenant to a directory record |
| `Service` | `Structure.services` (FINESS activities for FINESS records; directory text otherwise), `services_externes.services[]` (data·inclusion, with producer), `ProRdvService` | one row per item with its origin; `proRdvServiceId` set for ADA Pro rows | dedupe across origins, or present data·inclusion as State-verified |
| `ServiceRight` | `Dispositif.related_structure_ids`, `Aide.structures_links` | only where the link is to a service unambiguously (a structure with exactly one service); else left for review | create a right link from a keyword |
| `OrientationRoute` | none | **no backfill**; created by reviewers | infer routes from past referrals |
| `Referral.toServiceId` | none | NULL for every existing referral | guess the service of a past referral |
| `Structure.siteKind` | closed vocabulary (PKG-1 N2, not decided) | NULL | guess from a name (« 115 », « siège ») |

Backfill scripts are idempotent, dry-run first (counts per basis, conflicts listed: one SIREN with two RNA, an EJ whose SIREN disagrees with the establishments' SIRET…), and conflicts go to the duplicate/identity review queue, not to an automatic choice.

## 5. Staged plan

| Stage | Where | Content | Reversible |
|---|---|---|---|
| 0 | LAB (this branch) | F1–F4 fixed without schema change; read-only adapter `api/lib/structure-model.js` (`organisationOf`, `establishmentOf`, `servicesOf`, `structureModelView`, `contributorKey`) | yes (code) |
| 1 | LAB | additive DDL of `d8-draft-migration.sql` (new tables, nullable columns, non-unique SIRET index, two read views) | yes: DOWN section, tested (schema identical after DOWN) |
| 2 | LAB | backfill scripts (§4) + importer changes (store FINESS EJ / legal name / SIREN; data·inclusion and FINESS services as `Service`); dual-read check: adapter vs tables must agree record by record | yes: the new objects hold copies re-derivable from records and official files |
| 3 | LAB | readers switch one by one: observatory contributor → `organisationId`; referral picker shows establishment + service (needs F5 decision, six languages); duplicate register adds « same organisation, distinct establishments »; routes UI for reviewers | yes (feature flags per reader) |
| 4 | LAB | drop UNIQUE on `Structure.siret` (separate migration), then importers write the SIRET on every establishment that has it | re-adding the UNIQUE fails once two records share a SIRET: the DOWN must first clear the duplicates' SIRET (copy kept in `EntityVersion`) — treat as one-way unless rolled back immediately |
| 5 | Production | each stage as its own numbered migration (after the integrator's last, 0053+) with a Neon branch/backup, owner-run, then the stage-2 scripts in dry-run, then real | per stage |

## 6. What a future Production change depends on

1. An explicit owner decision for each stage-5 migration (Production rule: no migration without owner action; backup per D7, RPO 24 h / RTO 1 business day).
2. Owner decision on **membership scope**: whether an organisation-wide professional scope may exist at all, and how it is audited; confirmation that a citizen's grant stays per establishment (DPO view on purpose limitation).
3. The **closed vocabulary** of site kinds (PKG-1 N2, still open) before `siteKind` is filled or used to hide headquarters / phone lines from maps.
4. **Importer changes** reading official files only: FINESS EJ + legal name + SIREN (already parsed in `verification/finess.js:142`), SIRENE legal names (rate-limited lookups, `lookupSiret`), data·inclusion service ids (licence/attribution unchanged).
5. **F5 decision** (which establishment attribute is shown in pickers and in the consent request), then six-language UI text (no machine-invented translations).
6. **Route curation ownership**: who reviews `OrientationRoute` rows (named reviewers, like D11), and their sources.
7. Owner acknowledgement that F4 changes published cells of **future** quarters (stricter; frozen quarters unchanged; the CSV column `organisations_verifiees` still counts records).
8. Integrator renumbering of the migration files and a fresh `drizzle-kit` journal entry; executed migrations are never re-applied.

## 7. Open decisions (owner)

- F5: show postal code? street? an establishment label written by the organisation? (Street addresses of some establishments must stay confidential.)
- Whether a self-registered tenant may ever be linked to a directory organisation without a partner agreement (PKG-1 N2 says no).
- Whether the duplicate register should gain a third outcome « same organisation, distinct establishments » (today SAME_ENTITY puts a record aside, DISTINCT says nothing about the organisation).

## 8. LAB verification done on this branch

- New and extended suites: `d8-ingest-identity-db` (6), `d8-duplicate-destination-db` (4), `d8-observatory-entity-db` (4, incl. the adapter's DB view), `finess-veille-db` (extended), unit `d8-structure-model` (5); each defect test failed before its fix.
- Draft SQL: applied to a disposable copy of the LAB database (UP), views queried and compared by hand with the adapter's rules on five synthetic rows (SIREN, kept-duplicate with SIRET, RNA, kept-duplicate without SIRET, none: same basis and keys), DOWN applied, `pg_dump -s` before/after identical (except pg_dump's random `\restrict` token); the copy was dropped.
- Not verified: behaviour on Production data volumes; the real FINESS/SIRENE files (synthetic fixtures only); any UI.
