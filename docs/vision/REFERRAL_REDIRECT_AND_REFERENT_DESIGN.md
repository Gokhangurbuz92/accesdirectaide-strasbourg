# Referral redirect (G3) and « référent de parcours » (G5) — design note

Status: IMPLEMENTED in LAB (M2, migrations 0047 / 0048 — see `docs/vision/M2_MIGRATION_NOTE.md`). Nothing here is active in Production: the migrations are
not applied there and the surfaces stay closed. Differences from the proposal below, as built: the référent's displayed name is a text the professional
enters and agrees to show (`displayName` + `displayNameConsentAt`; ProUser holds no first name); the redirect list of organizations is served by
`GET /api/pro/referrals?suggestFor=<id>&receivers=<q>`; a follow-up may also start from an EXPIRED referral or one CLOSED without an outcome; one live
follow-up per declined referral (unique index); a pending redirect is cancelled when the person withdraws the proposing organization's access or stops
sharing; `followUpNotifiedAt` carries the one « needs a human follow-up » notice. The referral inbox does not show the sending side's référent (open question, left closed).
Invariants kept: consent before disclosure, minimal disclosure, tenant filters, append-only `ReferralEvent`, one conditional UPDATE per transition.
The platform records who said what; it never decides, never guarantees a place, never becomes the person's legal « référent ».

## G3 — decline with a suggested alternative (redirect)

Problem: a receiver that declines can only say why. The sender must guess the next organization, and the chain between the two referrals is lost.

Columns (`Referral`):
- `previousReferralId text NULL` → `Referral(id)` ON DELETE SET NULL; index; CHECK `previousReferralId <> id`.
- `suggestedStructureId text NULL` → `Structure(id)` ON DELETE SET NULL; CHECK `suggestedStructureId IS NULL OR status IN ('DECLINED','CLOSED')`.
- `responseCode` gains `REDIRECT_SUGGESTED` (extend `Referral_response_check`).

States: none added. A redirect is a DECLINED referral carrying a suggestion, followed by a NEW referral (`previousReferralId` = the declined one) that
starts at PENDING_CITIZEN like any other. No automatic forwarding: the declining organization never passes the dossier on, and its own access is revoked
exactly as for a plain decline.

API (`POST /api/pro/referrals`):
- `decline { id, responseCode: 'REDIRECT_SUGGESTED', suggestedStructureId, message? }` — receiver; the suggestion must pass `eligibleReceivers`
  (verified, active, staffed, not the sender, not itself). Only an identifier is stored: no free text about the person is required.
- `propose { caseId, toStructureId, reasonCode, previousReferralId? }` — sender; `previousReferralId` must be a DECLINED/CLOSED referral of the same
  dossier and the same sending organization. The UI pre-fills `toStructureId` from the suggestion; the professional may choose another organization.
- `GET ?id=` returns `suggested: { id, name }` and `previous` / `next` ids (statuses only) to both sides of each referral — never the other chain's texts.

Who learns what:
- Sender: in-app `referral_declined` (existing catalogue event; title « Orientation déclinée — autre structure suggérée »), with `referralId` only.
  The detail page shows the suggested organization and a « Proposer à cette structure » action. The decision stays the professional's.
- Citizen: the existing DECLINED notice, plus one sentence: the organization suggested another one; nothing is transmitted unless the supporting
  organization proposes it and the person accepts. `/compte/orientations` shows the chain (« suite de l'orientation vers … ») and the new proposal
  appears under « À décider ». The suggested name is public directory data; no reason or message is e-mailed.
- Suggested organization: nothing, until the citizen authorizes the new referral.

## G5 — named « référent de parcours »

Problem: the person does not know which human follows the whole path; organizations do not know whom to call. The platform must show a name
without implying a legal mandate (CASF référent, mesure de protection, etc. are decided outside the platform).

Table `DossierReferent` (one current row per dossier, history kept):
- `id`, `sharedDiagnosticId` → SharedDiagnostic ON DELETE CASCADE, `structureId` → Structure, `proUserId` → ProUser ON DELETE SET NULL,
- `status` CHECK IN (`PROPOSED`, `ACCEPTED_BY_CITIZEN`, `ENDED`), `proposedAt`, `citizenDecisionAt`, `endedAt`,
- `endedBy` CHECK IN (`CITIZEN`, `PROFESSIONAL`, `DEPARTURE`, `ACCESS_REVOKED`, `ORGANIZATION_CLOSED`), `displayNameConsentAt` (the professional agrees
  that first name + organization are shown to the person and to organizations holding an active grant).
- UNIQUE (`sharedDiagnosticId`) WHERE `status` IN (`PROPOSED`, `ACCEPTED_BY_CITIZEN`); append-only event table `DossierReferentEvent` (actor, from, to).

Rules:
- A professional with case access VOLUNTEERS (`PROPOSED`); only the citizen makes it effective (`ACCEPTED_BY_CITIZEN`) and can end it at any time.
- It ends automatically, in the same transaction, when the organization's grant is revoked, the member leaves (successor is NOT inherited: the
  successor may volunteer, the citizen decides again) or the organization closes. The person and the organization are told; the field shows « aucun ».
- It grants NO extra access and no authority over other organizations: visibility only (name, organization, professional contact of the structure).
- Wording everywhere: « personne de contact pour votre parcours, désignée avec votre accord ». Never « responsable », « mandataire » or a legal title;
  the screens state that the role is declarative, creates no obligation of result and replaces no legal or contractual designation.

API: `POST /api/pro/cases { action: 'referent_volunteer' | 'referent_step_down', id }`, `POST /api/citizen/dossier { action: 'referent_decide',
accept }` / `referent_end`; `GET` views add `referent: { firstName, organization, since } | null` for the citizen and for grant holders.

Open questions for the owner / legal review: retention of ended rows (proposal: with the dossier), whether the first name alone is enough, AIPD update
(new personal data about professionals), and whether a referral inbox should show the referent of the sending side (proposal: yes, name only).
