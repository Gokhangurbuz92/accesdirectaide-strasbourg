# R31 — product definitions made under the owner's delegation (P27, R18, Q14) and the Q15 premises requirement

The owner delegated these definitions on 31/10/2026 (directive R31). Each one is implemented, tested and reversible (migration 0042 has a rollback,
`drizzle/rollback/0042_down.sql`). None is enabled in the public beta, where the server refuses every account, professional and administration route.

**Status (01/11/2026).** The owner accepted the three definitions as the current **engineering baselines**. That is not operational acceptance, not an
authorization to collect real participant data, and not a permission to open these features in production. Migration 0042 is applied to production
(four empty tables; evidence `evidence/r31/m0042-production-2026-11-01.json` in the plan folder); the features stay closed.

## What was checked first

- Inventory: P27 « Dossier de subventions page » (parent register `COM-*`, status UNKNOWN), R18 « Professional orientation tools / basket » (`PRO-ORIENT`,
  UNKNOWN), Q14 « Measured-outcomes programme (pilot metrics) and evidence log » (`RM-OBSERV`, depends on I04), Q15 « Professional local premises ».
- No document in the LAB defines P27 or R18. The page `SubventionDossier.jsx` cited by the inventory no longer exists anywhere in the LAB. The register
  labels give the only hints: `COM-*` (communication / publisher side) and `PRO-ORIENT` (professional orientation).
- Existing functions that must not be duplicated: P16 (public guided orientation), R09/R10 (referral to another organization with the person's consent),
  R06/R08 (case notes), R15 (dossier export), I02/I04 (k-anonymous aggregates).

## P27 — « Dossiers de financement » (administrators, `/admin/financement`)

**Definition.** A workspace where the publisher prepares AccesDirectAide's own subsidy and funding applications. It is not a public page: a public
« dossier de subventions » page would have nothing true to say while the association is not registered.

**Functions.**
- Create a dossier (funder, programme, official address, deadline). It is prefilled with validated facts only, each with the date it was read:
  - the project wording and legal status (brand-config);
  - the measured costs (operating-model document);
  - live counts of the verified aides, démarches and places.
- Sections modelled on Cerfa n° 12156*06 « Association : demande de subvention »: presentation, objectives, audiences, activities, territory, funding
  needs, human and material means, evaluation. Each funder's own list prevails.
- Provisional budget (charges and income), financing plan, milestones, supporting-document checklist. The checklist starts from the usual pieces of an
  association request, adapted to an association under the local law of Alsace-Moselle (registration at the tribunal judiciaire).
- Warnings recomputed on every read:
  - missing sections, an unbalanced budget, amounts left blank, provisional amounts, missing documents;
  - the association's missing registration, a missing funder, a deadline close or passed.
- Status chain « en préparation → prêt pour la validation du porteur → déposé → accordé / refusé » (or « abandonné »).
- Every save and status change is a new version (who, when, note). Two administrators cannot overwrite each other (compare-and-set).
- Export as a Markdown working document (« Document de travail … n'est pas une demande déposée »), and print.

**Honesty rules enforced by the server.**
- A measured or confirmed amount must name its source.
- A financing line marked awarded or refused needs the funder's decision reference.
- A dossier is marked « accordé » or « refusé » only with the decision's reference and date.
- A closed dossier cannot be edited.
- Nothing is ever sent to a funder.

**Evidence.**
- `api/_services/funding-dossiers.js`, `api/_handlers/admin/funding.js`, `src/pages/admin/k5/Funding.jsx`.
- `tests/unit/r31-orientation-funding-pilot.test.js`.
- `tests/integration/r31-orientation-funding-pilot-db.test.js`: the full status chain on PostgreSQL, 5 versions.

**Awaiting the owner.**
- Acceptance of the definition.
- The real content: objectives, budget and the funders to approach.
- The association's registration, which most funders require.

## R18 — « Sélections d'orientation » (ADA Pro, `/pro/selections`)

**Definition.** A professional's working basket. The professional gathers verified aides, démarches and places around a person's needs and sees why
each one is suggested. They mark the follow-up and print a summary. When the person has shared a dossier with the organization, they can send it to the
person's space.

**Functions.**
- Closed list of 11 needs (`src/config/orientationNeeds.js`), matched against the categories the catalogue already carries.
- Search of the verified catalogue only. It applies the same D-5 rule as the public pages, ignores accents, and lists items matching a chosen need first.
- « Why »:
  - the professional sees the matched need, the record's category and their own reason;
  - the person sees only the matched need (« En lien avec votre besoin … »).
- Each item shows its official source and verification date. An item that stops being public is flagged and left out of every summary.
- Follow-up per item: à proposer / proposé / démarche faite / sans suite. Selections can be archived and reopened.
- Summary (print, or a citizen-visible note on a case). It always says that it is an orientation, not a decision.

**Rules.**
- Only the author and the organization's administrators can open a selection, as for cases. Other organizations never can.
- The working label and the reasons are sealed with their own data-key purpose (`orientation-basket`, included in key rotation). They are never
  sent to the person: a test found that the first version did send them, and this was fixed before release.
- A case is linked only if the professional may open it at that moment (grant, membership, assignment). Sending goes through the existing case-note
  rule, so it is refused once the person revokes the grant or the case is closed.
- No dossier data is copied into a selection.

**Not duplicated.**
- P16 stays the public orientation.
- R09 stays the only way to refer a person to another organization. A selection can prepare a referral; it does not replace one.

**Evidence.**
- `api/_services/orientation-basket.js`, `api/_handlers/pro/orientation-baskets.js`, `src/pages/pro/Selections.jsx`.
- Unit and integration tests: 7 R18 scenarios on PostgreSQL, including isolation, revocation and withdrawal.

**Awaiting the owner.** Acceptance of the definition, and the opening of professional accounts (operational gates unchanged).

## Q14 — pilot measures (`/admin/pilote`, protocol `docs/pilot/`)

**Definition.** A measurement foundation in two strictly separated parts.
- **Technical indicators**, measured now from the product with no participant:
  - the freshness of the verified catalogue per type, and records published but held back by D-5;
  - verified news and guides;
  - the Q01 keyboard journeys.
- **Pilot outcomes**, only from sessions observed with consenting participants:
  - per journey: success alone, success with help, failure or abandonment, median duration, median errors, reported clarity, accessibility difficulties;
  - shown only from 5 sessions per journey (below that, only the count).

**Privacy.**
- No audience measurement (ADR-022).
- A session holds no name or contact, but it is **pseudonymised personal data, not anonymous**: the participant code is drawn by the server and written on the
  paper consent form, which carries the name and is kept outside the product (correction of 01/11/2026).
- The assistive technology used can reveal a disability (GDPR art. 9): it is recorded only with a separate explicit consent (box 3 of the form), and so is a
  « screen reader » difficulty. Only the day of a session is kept, not the time.
- The database rejects a session without consent (CHECK constraint). The server rejects contact data and health or disability words in observations.
- Aggregates suppress every count below 5, difficulty counts included. Only administrators (MFA) see sessions.
- Withdrawing consent deletes all of a code's sessions.
- Only aggregates can be exported (CSV).

**Ready to use.**
- `docs/pilot/PROTOCOLE_PILOTE.md`: six journeys with success criteria, participants, consent, data, session procedure, analysis.
- `docs/pilot/FORMULAIRE_CONSENTEMENT.md` (version 2): a template for legal review.
- `docs/pilot/FICHE_ANIMATEUR.md`.

**Not done, and cannot be done by engineering.** The pilot itself: real participants, partner structures, facilitators, the DPO's opinion. Until then
the report says « aucune séance » and no outcome figure exists.

## Q15 — professional local premises (not an engineering feature; stays open)

The premises requirement cannot be met by code, and no address is invented. What a suitable place needs, so the owner can check a real offer:

| Need | Why | Check |
|---|---|---|
| Step-free access, accessible toilet, signage | public reception (ERP rules) | the landlord's accessibility register (registre public d'accessibilité) |
| A closed room for one-to-one meetings | confidentiality of a person's situation | a door that closes, no line of sight from the waiting area |
| Reliable internet and power, a lockable cabinet | pilot sessions, paper consent forms | contract and keys |
| Reach by public transport (tram or bus) in Strasbourg | the people the site serves | CTS network map |
| A written agreement (lease, occupation agreement, or a partner's hosting agreement) | proof of availability | the signed document, kept by the owner |

Until a real agreement exists, Q15 stays open. Pilot sessions can take place at a partner structure that agrees to host them (protocol § 7).
