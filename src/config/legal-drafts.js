/**
 * R45 (ENG-LR-5) — draft legal documents: citizen terms, professional terms, structure conditions, privacy notice (GDPR art. 13 and 14), and the
 * A-I / A-II variant of the legal notice (ENG-LR-4). French is the authoritative text (keys of the « legaldraft » namespace; the five other languages
 * are translations, labelled as such). The French masters with the owner approval box are in STRASBOURG_FULL_PRODUCT_PLAN/CONTROL/r45/.
 *
 * STATUS: every document is DRAFT_PENDING_OWNER_APPROVAL. Nothing here is a final legal claim, a decision of the controller or a legal opinion.
 *  - Production build (VERCEL_ENV=production): a draft is neither linked nor shown, unless VITE_LEGAL_DOCS_APPROVED_VERSION names it
 *    (« id@version », or the bare version, comma-separated) — then it is in force.
 *  - Any other build with VITE_LEGAL_DRAFT_PREVIEW=1 (LAB): the drafts render with a visible « Projet — non approuvé » banner.
 *  - Otherwise: hidden (fail-closed). The existing in-force pages (/cgu, /politique-confidentialite, /mentions-legales) are not affected.
 * Proposed legal bases (section 3 bis: functions not open yet) come from CONTROL/r44/R44_DECISIONS_RGPD_D1_D6_FR_v2.md (annexes A and B), NOT approved (D2).
 * The retention periods of section 4 are the APPROVED policy of api/_services/retention-policy.js (controller, 09/11/2026): no « proposé » badge since v4.
 * A notice-only change still moves the ONE shared version (v4, v5, v6): every document carries LEGAL_DRAFTS_VERSION, and Production keeps hiding all of them
 * until VITE_LEGAL_DOCS_APPROVED_VERSION names « id@version ».
 */

export const LEGAL_DRAFT_STATUS = Object.freeze({
  DRAFT_PENDING_OWNER_APPROVAL: 'DRAFT_PENDING_OWNER_APPROVAL',
});

/**
 * the version shared by the R45 drafts; a change of any French text below needs a new version (the owner approves a version, not a file).
 * Since v7 (18/11/2026) TWO versions coexist, each approvable by name: v6 (texts below, unchanged byte for byte) and v7 = v6 + one sentence of the
 * privacy notice § 4 (LEGAL_DRAFTS_V7_SENTENCE). The build shows the NEWEST version that VITE_LEGAL_DOCS_APPROVED_VERSION names (draftFor), the
 * newest draft in LAB preview. LEGAL_DRAFTS_VERSION = v7, the version shared by the citizen terms, the notice and the A-I / A-II variant. Since v8
 * (19/11/2026) a version may cover only some documents: v8 exists for the two professional documents only (see LEGAL_DRAFTS_V8 below).
 */
export const LEGAL_DRAFTS_V6 = 'v6-2026-11-17';   // Owner conditions N2 / C3 / C4 / C6 on v5 (17/11/2026, CONTROL/v2/V6_METIN_FARKI_FR.md): § 4 the Mailjet deletion sentence describes the real outcomes (asked before our erasure, retried 3 days at most inside the one-month deadline, then erased anyway and flagged for a person; 6c and the old address of a change: one attempt), Vercel logs by criterion (1 day on Pro, 30 days with Observability Plus — the option's state is NOT verified); § 3 P16, § 5, § 6 provider roles made consistent (processor for your data; Vercel, Sinch and Upstash also controllers for some technical data, « notamment »); § 7 framework list re-read 17/11/2026. NOT approved: Production keeps hiding the drafts until VITE_LEGAL_DOCS_APPROVED_VERSION names v6; v5 was never in force. v5-2026-11-15 = provider verification (15/11/2026, CONTROL/v2/V4_SAGLAYICI_DOGRULAMA_2026-11-15.md): § 4 Mailjet retention by objective criterion (90 days free plan / 13 months paid plan), recipient address kept as a contact and deleted at Mailjet when the account is erased, Vercel logs 1 day, Neon history tied to the free plan; § 6 Vercel and Sinch also act as controllers for some technical data; § 7 clauses incorporated, official Data Privacy Framework list (see the comment above the notice). v4-2026-11-15 = final review (15/11/2026): approved retention periods without the « proposé » badge, § 7 transfers rewritten from primary sources, § 11 basis and period no longer « proposées », § 4 consent / support lines, § 6 Vercel network, § 8 post-mortem directives (see the comment above the notice). v3-2026-11-14 = V2 legal review (14/11/2026): booking, assistant, contact form and rendez-vous recipients marked « pas encore ouvert »; Mon Espace self-service rights. v2-2026-11-09 = V2 final candidate (09/11/2026): + security review D3/D6 (erasure on request, hashed counters, unactivated accounts 7 days). Release B (D2 V2, 08/11/2026): notice split V2 / later waves, A7 preference, no phone, Mailjet

/**
 * @typedef {{ id: string, title: string, paras?: string[], items?: string[], proposed?: boolean, itemKeys?: Record<number, string>, paraKeys?: Record<number, string>, titleKey?: string }} DraftSection
 * @typedef {{ id: string, key: string, path: string | null, version: string, status: string, title: string, intro: string, introKey?: string, sections: DraftSection[] }} DraftDocument
 */

const V2_STATUS_NOTE = 'Cette notice décrit les traitements des comptes personnels (section 3). Les rendez-vous, les messages, les rappels et le partage de dossiers ne sont pas encore ouverts : leurs bases légales sont indiquées à titre de proposition (section 3 bis) et seront confirmées avant leur ouverture.';

/** @type {DraftDocument[]} */
export const LEGAL_DRAFT_DOCUMENTS_V6 = [
  {
    id: 'cgu-citoyen',
    key: 'cguCitoyen',
    path: '/cgu/citoyen',
    version: LEGAL_DRAFTS_V6,
    status: LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL,
    title: "Conditions d'utilisation — particuliers",
    intro: "Ces conditions s'appliquent à toute personne qui utilise AccesDirectAide pour elle-même, avec ou sans compte.",
    sections: [
      { id: 'operator', title: '1. Qui propose le service', paras: [
        "Le service est proposé par {{operator}}, personne physique, qui exploite AccesDirectAide à titre personnel et bénévole. Aucune association n'a été créée à ce jour.",
        'Contact : {{contact}}.',
      ] },
      { id: 'free', title: '2. Un service gratuit', paras: [
        "Le service est gratuit. Aucun paiement ne vous est demandé, ni par AccesDirectAide ni, par son intermédiaire, par une structure. Le site ne contient pas de publicité.",
      ] },
      { id: 'noDecision', title: "3. Ce que le service ne fait pas", paras: [
        "AccesDirectAide n'est pas un site de l'administration. Il vous aide à trouver une information, à vérifier si une aide peut vous concerner et à contacter une structure. Il ne prend aucune décision sur vos droits : seul l'organisme compétent (Caf, CPAM, France Travail, Collectivité européenne d'Alsace, CCAS…) décide.",
        "Les informations sont données à titre indicatif, avec leur source officielle et leur date. Elles peuvent changer : vérifiez-les auprès de la source indiquée.",
      ] },
      { id: 'ai', title: "4. L'assistant automatique (pas encore ouvert)", paras: [
        "L'assistant automatique n'est pas encore ouvert. Quand il le sera, il pourra chercher, expliquer et proposer un brouillon. Il pourra se tromper. Il ne donnera pas de conseil juridique et ne décidera de rien.",
        "Lorsqu'il sera ouvert, n'y écrivez pas d'information sur votre santé, un handicap, votre situation administrative ou celle d'une autre personne.",
      ] },
      { id: 'account', title: '5. Votre compte', items: [
        "Un compte vous donne accès à votre espace personnel (Mon Espace). Il sera nécessaire pour demander un rendez-vous lorsque cette fonction sera ouverte ; elle ne l'est pas encore.",
        'Vous devez avoir 18 ans ou plus pour créer un compte.',
        'Vous donnez des informations exactes et gardez votre mot de passe secret.',
        "Votre compte est personnel : n'agissez pas au nom d'une autre personne sans son accord.",
      ] },
      { id: 'appointments', title: '6. Les rendez-vous (pas encore ouverts)', paras: [
        "La demande de rendez-vous n'est pas encore ouverte. Les règles ci-dessous s'appliqueront lorsqu'elle le sera ; ces conditions seront alors mises à jour et les titulaires d'un compte en seront informés.",
        "Une demande de rendez-vous ne sera pas un rendez-vous confirmé : c'est la structure qui confirmera, proposera un autre créneau ou refusera. Elle pourra aussi modifier ou annuler un rendez-vous ; vous en serez informé dans votre espace.",
        "Vous pourrez annuler votre demande ou votre rendez-vous depuis votre espace. Il faudra prévenir le plus tôt possible.",
        "Chaque structure fixe ses propres règles d'accueil. AccesDirectAide ne garantit ni une place disponible ni l'attribution d'une aide.",
        "Le message joint à une demande sera facultatif. Il ne sera transmis qu'avec votre accord, que vous pourrez retirer à tout moment depuis votre espace.",
      ] },
      { id: 'use', title: '7. Utilisation correcte', items: [
        "Ne publiez ni n'envoyez de contenu illicite, injurieux ou qui porte atteinte à une autre personne.",
        "Ne cherchez pas à accéder aux données d'autrui ni à perturber le service.",
        "N'utilisez pas de programme pour extraire le contenu en masse ou pour utiliser une fonction du service de façon automatisée, y compris, lorsqu'elle sera ouverte, la réservation de créneaux.",
      ] },
      { id: 'deletion', title: '8. Supprimer votre compte', paras: [
        "Vous pouvez demander la suppression de votre compte à tout moment, depuis votre espace ou en écrivant à {{contact}}. Une personne vérifie la demande avant la suppression, pour éviter une erreur ou une usurpation.",
        "Certaines données peuvent être gardées pour une durée limitée quand une obligation ou la défense d'un droit l'exige ; la notice de confidentialité en donne la liste.",
        "En cas d'usage contraire à ces conditions, le compte peut être suspendu. Vous en êtes informé avec le motif, sauf urgence de sécurité, et vous pouvez présenter vos observations.",
      ] },
      { id: 'liability', title: '9. Responsabilité', paras: [
        "L'exploitant prend des moyens raisonnables pour que l'information soit exacte et le service disponible. Il ne peut pas garantir l'absence de toute erreur ni un fonctionnement sans interruption. Il corrige les erreurs signalées dans les meilleurs délais.",
        "Il n'est pas responsable des décisions des organismes et des structures, ni du contenu des sites extérieurs vers lesquels il renvoie.",
        "Il reste responsable de ses fautes dans les conditions prévues par la loi. Aucune clause de ces conditions ne réduit les droits que la loi vous reconnaît.",
      ] },
      { id: 'changes', title: '10. Évolution et fin du service', paras: [
        "Ces conditions peuvent évoluer. Chaque version est publiée avec sa date. Avant un changement important, les titulaires d'un compte sont informés et peuvent supprimer leur compte.",
        "Si le service s'arrête ou est repris par une autre personne, par exemple une association créée plus tard, les titulaires d'un compte sont informés à l'avance. Aucune donnée n'est transmise sans information préalable.",
      ] },
      { id: 'law', title: '11. Droit applicable et litiges', paras: [
        "Ces conditions sont soumises au droit français. En cas de difficulté, écrivez d'abord à {{contact}} : une solution amiable est recherchée.",
        "Médiation de la consommation : son application à un service gratuit édité par un particulier, hors de toute activité professionnelle, est à vérifier. Aucun médiateur n'est désigné à ce jour.",
        'À défaut de solution amiable, vous pouvez saisir la juridiction compétente selon les règles de droit commun.',
        'La version française de ces conditions est la seule juridiquement de référence ; les traductions sont une aide à la compréhension.',
      ] },
    ],
  },
  {
    id: 'cgu-professionnel',
    key: 'cguPro',
    path: '/cgu/professionnel',
    version: LEGAL_DRAFTS_V6,
    status: LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL,
    title: "Conditions d'utilisation — professionnels",
    intro: "Ces conditions s'appliquent aux professionnels qui utilisent un compte ADA Pro créé à l'invitation de leur structure.",
    sections: [
      { id: 'operator', title: '1. Qui propose le service', paras: [
        "Le service est proposé par {{operator}}, personne physique, qui exploite AccesDirectAide à titre personnel et bénévole. Aucune association n'a été créée à ce jour. Contact : {{contact}}.",
        "Le service est gratuit pour les professionnels et pour leur structure. Rien n'est facturé.",
      ] },
      { id: 'account', title: '2. Votre compte professionnel', items: [
        "Le compte est créé sur invitation de votre structure. Il est personnel : ne le partagez pas.",
        "La double authentification est obligatoire. Gardez vos moyens de connexion secrets.",
        "Votre structure gère les accès de son équipe et désactive votre compte quand vous la quittez.",
      ] },
      { id: 'use', title: '3. Utilisation au service des personnes', items: [
        "Utilisez le compte seulement pour les missions de votre structure.",
        "N'ouvrez les informations d'une personne que lorsque c'est nécessaire à sa demande.",
        "Ne copiez pas ces informations hors des outils prévus par votre structure.",
        "Respectez le secret professionnel et les règles de votre structure.",
        "N'écrivez pas de donnée de santé ou de handicap dans un champ libre, sauf si c'est indispensable à la demande.",
      ] },
      { id: 'appointments', title: '4. Rendez-vous', paras: [
        "Vous confirmez, proposez un autre créneau ou refusez les demandes qui vous sont adressées, dans un délai raisonnable. Tenez vos créneaux à jour.",
        "La plateforme et son assistant ne décident d'aucun droit. Un brouillon proposé par l'assistant doit être vérifié avant tout usage.",
      ] },
      { id: 'data', title: '5. Vos propres données', paras: [
        "Pour votre compte, la plateforme traite votre nom, votre adresse électronique professionnelle, votre rôle, vos créneaux et le journal de vos actions. La notice de confidentialité décrit ces traitements, leurs bases légales proposées et leurs durées.",
        'Vos actions sont journalisées pour la sécurité et le contrôle des accès.',
      ] },
      { id: 'incident', title: '6. Incident de sécurité', paras: [
        "Signalez sans délai à {{contact}} toute perte d'un moyen de connexion, tout accès suspect ou toute erreur d'envoi.",
      ] },
      { id: 'end', title: '7. Suspension et fin', paras: [
        "En cas d'usage contraire à ces conditions, le compte peut être suspendu. Vous et votre structure en êtes informés, sauf urgence de sécurité.",
      ] },
      { id: 'liability', title: '8. Responsabilité et droit applicable', paras: [
        "Chacun répond de ses propres fautes dans les conditions prévues par la loi. L'exploitant n'est pas responsable des décisions de votre structure ni des organismes.",
        "Ces conditions sont soumises au droit français. En cas de difficulté, écrivez d'abord à {{contact}}.",
        'La version française de ces conditions est la seule juridiquement de référence ; les traductions sont une aide à la compréhension.',
      ] },
    ],
  },
  {
    id: 'conditions-structures',
    key: 'structures',
    path: '/conditions-structures',
    version: LEGAL_DRAFTS_V6,
    status: LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL,
    title: 'Conditions pour les structures',
    intro: "Ces conditions décrivent les règles proposées aux structures (associations, services publics, établissements) qui figurent dans l'annuaire ou qui reçoivent des demandes de rendez-vous. Aucune structure ne les a signées à ce jour.",
    sections: [
      { id: 'directory', title: "1. Fiche dans l'annuaire", paras: [
        "Les fiches viennent de sources officielles ou publiques : FINESS, data·inclusion, l'Annuaire de l'administration (Service-Public / DILA). Chaque fiche indique sa source et sa date.",
        "Une fiche signale qu'un service existe. Elle ne garantit ni une place ni une admission.",
        'La structure peut demander la correction ou la mise à jour de sa fiche à {{contact}}.',
      ] },
      { id: 'agreement', title: '2. Raccordement aux rendez-vous', paras: [
        "Pour recevoir des demandes de rendez-vous, une convention écrite est signée entre la structure et l'exploitant. Elle désigne un référent. Le raccordement est gratuit : aucune somme n'est versée par la structure ni à la structure.",
        "L'exploitant est {{operator}}, personne physique, qui exploite AccesDirectAide à titre personnel et bénévole. Aucune association n'a été créée à ce jour. Contact : {{contact}}.",
      ] },
      { id: 'roles', title: '3. Rôles pour les données personnelles', paras: [
        "Pour ce qu'elle reçoit (demandes, coordonnées, message accepté par la personne), la structure est responsable de son propre traitement, dans ses dossiers et selon ses obligations.",
        "Pour la gestion de la demande dans la plateforme, l'exploitant et la structure seraient responsables conjoints (RGPD, art. 26). Un accord le précisera ; ses grandes lignes seront mises à la disposition des personnes.",
        "Si la structure utilise l'outil comme son propre agenda, l'exploitant agirait comme sous-traitant (RGPD, art. 28), sous un contrat écrit.",
      ] },
      { id: 'commitments', title: '4. Engagements de la structure', items: [
        'Répondre aux demandes dans un délai raisonnable et tenir ses créneaux à jour.',
        "Gérer les comptes de son équipe : inviter, retirer les droits et désactiver un compte au départ d'une personne.",
        'Informer les personnes comme le prévoient ses propres obligations.',
        "Déclarer, avant l'ouverture, les services dont la nature peut révéler une donnée de santé ou de handicap.",
        "Appliquer le retrait par une personne de son accord au message : effacer toute copie, ou la garder sous sa propre responsabilité en l'en informant.",
      ] },
      { id: 'sensitive', title: '5. Services sensibles', paras: [
        "La réservation des services dont la nature peut révéler une donnée de santé ou de handicap est fermée à ce jour. Son ouverture suppose un indicateur « service sensible », le consentement explicite de la personne et une vérification des exigences d'hébergement des données de santé (à vérifier).",
      ] },
      { id: 'operatorCommitments', title: "6. Engagements de l'exploitant", items: [
        'Fournir le service gratuitement, avec des mesures de sécurité adaptées.',
        'Prévenir la structure sans retard injustifié de tout incident touchant les données qui la concernent.',
        "Ne pas utiliser ces données à d'autres fins et ne jamais les vendre.",
      ] },
      { id: 'end', title: '7. Durée, fin et droit applicable', paras: [
        "Chaque partie peut mettre fin au raccordement avec un préavis fixé dans la convention. À la fin, les données sont restituées ou effacées selon la convention.",
        "Chacun répond de ses propres fautes. Ces conditions sont soumises au droit français ; une solution amiable est recherchée d'abord.",
        'La version française de ces conditions est la seule juridiquement de référence ; les traductions sont une aide à la compréhension.',
      ] },
    ],
  },
  /*
   * v6-2026-11-17 — sources read on 17/11/2026 (this session; public pages only, no provider account opened) for what v6 changes:
   *  § 4  Mailjet deletion: https://dev.mailjet.com/docs/email-api/contact-management/gdpr-delete-contacts (« 200 OK »; « Any other response will indicate
   *       that the deletion was not successfully processed »; « Contact details are immediately anonymized and all records will be deleted after 30 days »).
   *       The outcomes the sentence describes are the code's: api/_services/privacy.js (mailContactRetryWindow: 3 days after the first failure, never later
   *       than 3 days before the one-month deadline of api/_services/dsr-deadline.js), api/_services/dsr-erasure-review.js (parking, « Relancer », daily
   *       retry in execute mode), api/_services/mail-contact-failures.js (address-free record « intervention humaine requise »), gdpr-purge step 6c and
   *       api/_services/email-change.js (one attempt). Tests: tests/unit/v6-mail-contact-erasure.test.js, tests/integration/v6-mail-contact-erasure-db.test.js.
   *       Send API: « If you send an email to a contact that does not exist yet in Mailjet, the contact is automatically created and saved. »
   *       (https://dev.mailjet.com/email/guides/send-api-v31/).
   *  § 4  Mailjet M1 re-read in a browser: « On Free plans, statistics and campaigns are kept for 90 days. On Paid plans, statistics and campaigns are kept
   *       for 13 months. » ; « Your templates and contacts are kept for the lifetime of your account. » The plan of our account is NOT verified → both figures.
   *  § 4  Vercel: https://vercel.com/docs/logs/runtime (last updated 2026-08-28; table « Plan / Retention time »: Hobby 1 hour, Pro 1 day, Pro with
   *       Observability Plus 30 days, Enterprise 3 days, Enterprise with Observability Plus 30 days) and https://vercel.com/docs/observability/observability-plus
   *       (last updated 2026-07-06): « For teams created or upgraded to Pro on or after April 3, 2026, Observability Plus is enabled by default »; it can be
   *       disabled in Billing, and a project can be excluded. Read-only API check 17/11/2026 (Vercel CLI 65.7.0, `vercel api`, GET only): team
   *       billing.plan « pro », status « active », no trial, Pro invoice item since 21/01/2026 (before the 03/04/2026 default); GET
   *       /v1/observability/manage/configuration/projects answered « Observability Plus is not enabled » (404) → 1 day applies today. The text keeps the
   *       criterion because the option can be switched on at any time (owner confirms in the dashboard).
   *  § 6  Roles: Vercel DPA (Last Updated March 17, 2026) § 4.a / § 4.b; Sinch DPA version 8 (29 October 2025) § 3(a)(iv) « independent data controller »;
   *       Upstash DPA (Last Update Date: April, 2025), scope: the DPA « does not apply to Upstash's Processing of any Personal Data for its own
   *       business/customer relationship administration purposes, its own marketing activities or service analytics, its own information and systems security
   *       purposes »; Databricks DPA v3 § 2.1 (processor only; the MCSA was not re-read). « notamment » because the terms of Microsoft, Scaleway and
   *       Cloudflare were not re-read on this point.
   *  § 7  dataprivacyframework.gov/list re-read in a browser on 17/11/2026: Vercel Inc., Upstash, Inc., Databricks, Inc. « Active » (EU-U.S., UK
   *       Extension, Swiss-U.S.); Mailgun Technologies, Inc. « Active » (EU-U.S., UK Extension) — still never stated for Mailjet.
   *
   * v5-2026-11-15 — sources read on 15/11/2026 for the factual claims of the privacy notice (primary / official pages only). The provider claims were
   * re-read for v5 (verification report CONTROL/v2/V4_SAGLAYICI_DOGRULAMA_2026-11-15.md, sources V1–V7, M1–M8, U1–U5, N1–N5):
   *  § 4  CONSENT_SUPERSEDED_DAYS = 1095 (created_at of a decision replaced by a newer one) and SUPPORT_REQUEST_DAYS = 365 (closedAt):
   *       api/_services/retention-policy.js; purge steps deletedConsentLogsCount / supportRequestsDeleted in api/_handlers/cron/gdpr-purge.js; a help request
   *       is a row of « SupportRequest » written by the help form (api/_services/support.js, categories ACCOUNT…; surface « support » closed in the V2 scope).
   *  § 4  Vercel runtime logs: https://vercel.com/docs/logs/runtime (table « Plan / Retention time »: Hobby 1 hour, Pro 1 day, Pro with Observability Plus
   *       30 days, Enterprise 3 days). The team is on Pro (CLI `vercel teams ls`, 15/11/2026) → « 1 jour ». Account fact NOT verified: Observability Plus off.
   *  § 4  Mailjet (M1) Help Center « How long are my statistics kept? », https://documentation.mailjet.com/hc/en-us/articles/360042755094-How-long-are-my-statistics-kept
   *       (read in a browser; refuses automated fetch): statistics and campaigns 90 days on Free plans, 13 months on paid plans; templates and contacts kept
   *       for the lifetime of the account. The plan of our account is NOT recorded → both figures, by criterion (« formule gratuite » / « formule payante »).
   *       (M2) Sinch DPA v8 (29/10/2025), https://sinch.com/legal/terms-and-conditions/other-sinch-terms-conditions/data-processing-agreement/ § 11(b):
   *       deletion within 90 days following termination of the account; § 3(a)(iv): Sinch « independent data controller » for transmitting messages
   *       (anti-spam, fraud, network security). No source states a period for message CONTENT → « Mailjet ne publie pas de durée… ».
   *       (M4) Send API v3.1 guide, https://dev.mailjet.com/email/guides/send-api-v31/: the Send API saves each recipient address as a contact.
   *  § 4  « L'adresse enregistrée chez Mailjet est supprimée lorsque votre compte est effacé » is true through api/_services/mail-contact-erasure.js
   *       (Mailjet « GDPR Delete contacts », https://dev.mailjet.com/docs/email-api/contact-management/gdpr-delete-contacts: the contact is anonymised at once,
   *       its records deleted after 30 days), called by the account erasure, purge step 6c and the confirmed change of address (tests/unit/v5-mail-contact-erasure.test.js).
   *  § 4  Neon history window: https://neon.com/docs/introduction/plans (Free: 6 hours; Launch up to 7 days, Scale up to 30) → tied to the free plan in the text.
   *  § 6  Vercel: docs/production-hosting.md § 1 (« fonctions à Francfort (fra1) ; pages et fichiers publics distribués par le réseau mondial de Vercel »).
   *  § 6  Roles: Vercel DPA https://vercel.com/legal/dpa § 4.a (processor of Customer Data, Pro and Enterprise), § 4.b (Vercel « is the Controller » of
   *       Service-Generated Data); Sinch DPA § 3(a)(iv) (above). DPAs incorporated by the terms: Vercel Terms § 11.1, Upstash Terms § D.5, Mailjet Terms § 4.
   *  § 7  SCC, Commission Implementing Decision (EU) 2021/914 of 4 June 2021 (https://eur-lex.europa.eu/legal-content/FR/ALL/?uri=CELEX%3A32021D0914), named by:
   *       Vercel DPA § 13.3 and Schedule 3 (Module Two) ; Upstash DPA https://upstash.com/trust/dpa.pdf § 3.2(B), Annex 2 (the Data Privacy Framework first,
   *       SCC if it does not cover the transfer or is invalidated) ; Sinch DPA § 12 (c)–(d) ; Cloudflare DPA https://www.cloudflare.com/cloudflare-customer-dpa/
   *       (1.1 g). Microsoft: SCC offered through its DPA (https://learn.microsoft.com/en-us/compliance/regulatory/offering-eu-model-clauses).
   *       Neon / Databricks (N4): Databricks DPA v3 (2023-07-21), https://www.databricks.com/legal/dpa § 8.1 and Annex B — SCC « deemed incorporated »,
   *       Modules Two and Three; https://neon.com/dpa names Databricks, Inc. as the contracting party.
   *  § 7  EU–US Data Privacy Framework: stated by the provider and Active on dataprivacyframework.gov/list, read 15/11/2026 — Vercel Inc. (privacy policy
   *       https://vercel.com/legal/privacy-policy ; changelog of 4 June 2024), Upstash, Inc. (https://upstash.com/trust/privacy.pdf), Databricks, Inc.
   *       The list is a status on the day it was read: re-read it at each notice version. NOT stated for Mailjet / Sinch: the listed company is Mailgun
   *       Technologies, Inc., a US affiliate — Mailjet SAS is a French company.
   *  § 7  Sinch AB (publ) is « a Swedish limited liability company » (https://www.group.sinch.com/corporate-governance); US entities of the group (Sinch America Inc.,
   *       Mailgun Technologies, Inc.) and Mailjet SAS (France): https://sinch.com/legal/data-protection-agreement-sub-processors/.
   *  § 8  Loi n° 78-17 du 6 janvier 1978, article 85 (LEGIARTI000039280582, version in force since 01/01/2020), I:
   *       https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000039280582/2026-11-15.
   */
  {
    id: 'notice-confidentialite',
    key: 'privacyNotice',
    path: '/confidentialite/notice',
    version: LEGAL_DRAFTS_V6,
    status: LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL,
    title: 'Notice de confidentialité (RGPD, articles 13 et 14)',
    intro: 'Cette notice explique quelles données personnelles AccesDirectAide traite, pourquoi, sur quelle base, pendant combien de temps, et quels sont vos droits.',
    sections: [
      { id: 'controller', title: '1. Responsable du traitement', paras: [
        "Le responsable du traitement est {{controller}}, personne physique, qui exploite AccesDirectAide à titre personnel et bénévole. Aucune association n'a été créée à ce jour. Aucun délégué à la protection des données n'est désigné.",
        "Pour vos données : écrivez à {{contact}}. Plusieurs droits peuvent aussi être exercés directement depuis votre espace (section 8).",
      ] },
      { id: 'status', title: '2. Statut de cette notice', paras: [V2_STATUS_NOTE] },
      { id: 'purposes', title: '3. Finalités et bases légales des comptes personnels', items: [
        "P1 — Fonctionnement et sécurité du site public (journaux techniques, limitation du nombre de requêtes, cookie de sécurité « __csrf ») : intérêt légitime (art. 6, 1, f).",
        "P2 — Création et tenue du compte (adresse électronique vérifiée, mot de passe protégé, déclaration « 18 ans ou plus », preuve de l'acceptation des conditions d'utilisation et de leur version) : exécution du contrat que sont les conditions d'utilisation (art. 6, 1, b), pour les seules données nécessaires au compte. L'acceptation des conditions et la déclaration de majorité ne sont pas des consentements au sens du RGPD. Aucun numéro de téléphone n'est demandé.",
        "P2b — Réglages d'affichage facultatifs (taille du texte, contraste, animations réduites, lecture à voix haute, FALC) : ils sont enregistrés uniquement dans votre navigateur, sur votre appareil (stockage local). Ils ne sont pas envoyés à AccesDirectAide et ne sont pas enregistrés dans votre compte : nous ne les recevons pas. Ils ne se synchronisent donc pas entre vos appareils ; sur un autre appareil ou un autre navigateur, il faut les choisir à nouveau. Ils restent sur l'appareil après la déconnexion. Vous pouvez les modifier ou les remettre à zéro à tout moment (« Réinitialiser l'affichage »), ou les effacer avec les données de votre navigateur. Ils servent uniquement à l'affichage que vous avez choisi : ils ne disent rien de votre santé ou d'un handicap, et aucune information de ce type n'est demandée. Ce stockage sur votre appareil, fait à votre demande pour adapter l'affichage, ne fait pas l'objet d'une demande de consentement (article 82 de la loi Informatique et Libertés).",
        "P3 — Connexion et verrouillage après plusieurs échecs : exécution du contrat (art. 6, 1, b) pour la connexion ; intérêt légitime de protéger les comptes (art. 6, 1, f) pour les mesures de sécurité.",
        "P10a — E-mails de service liés au compte (vérification de l'adresse, mot de passe, changement d'adresse, avis du compte) : exécution du contrat (art. 6, 1, b).",
        "P12 — Journal des actions d'administration : intérêt légitime (art. 6, 1, f).",
        "P13 — Exercice de vos droits : obligation légale (art. 6, 1, c ; articles 12 à 22 du RGPD). Conservation bloquée (« gel ») d'une donnée précise : obligation légale lorsqu'une autorité ou un juge l'exige (art. 6, 1, c) ; sinon, pour constater, exercer ou défendre un droit en justice, intérêt légitime (art. 6, 1, f) et, pour une donnée sensible, art. 9, 2, f — accès restreint, durée limitée au litige.",
        "P14 — Journaux de sécurité : intérêt légitime (art. 6, 1, f).",
        "P15 — Effacement aux échéances : obligation légale (art. 6, 1, c ; art. 5, 1, e et 17 du RGPD). Archives de preuve à accès restreint (par exemple la preuve d'un consentement ou d'une demande d'exercice des droits) : intérêt légitime (art. 6, 1, f), pour la durée indiquée en section 4.",
        "P16 — Prestataires techniques : pour vos données, ils agissent sur instruction (art. 28) et n'ont pas de base propre ; ce que certains traitent aussi pour leur propre compte relève de leur propre responsabilité (section 6).",
      ], paras: [
        "Aucune finalité ne repose sur une mission d'intérêt public. Aucune décision produisant des effets juridiques n'est prise de façon automatisée : le service ne décide d'aucun droit.",
        "Sans adresse électronique, aucun compte ne peut être créé ; les champs facultatifs peuvent rester vides.",
      ] },
      { id: 'purposes-later', title: '3 bis. Fonctions non encore ouvertes (bases proposées)', proposed: true, paras: [
        "Ces traitements ne sont pas en service. Leurs bases légales seront confirmées par le responsable du traitement avant leur ouverture ; cette notice sera alors mise à jour.",
      ], items: [
        "P4 — Recherche d'un rendez-vous et affichage du nom des professionnels : pour vous, exécution des conditions (art. 6, 1, b) ; pour les professionnels, intérêt légitime de l'exploitant et de leur structure (art. 6, 1, f).",
        "P4p — Comptes des professionnels, y compris leur double authentification : intérêt légitime (art. 6, 1, f) ; exécution des conditions professionnelles acceptées (art. 6, 1, b).",
        "P5 — Demande, report, annulation, confirmation ou refus d'un rendez-vous, et messages de service liés : exécution des conditions (art. 6, 1, b).",
        "P5s — Rendez-vous auprès d'un service dont la nature peut révéler une donnée de santé ou de handicap : exécution des conditions (art. 6, 1, b) et consentement explicite (art. 9, 2, a) par une case distincte. Cette réservation n'est pas ouverte.",
        "P6 — Message facultatif joint à une demande : consentement (art. 6, 1, a) et consentement explicite (art. 9, 2, a), retirable à tout moment.",
        "P7 — Affectation d'un professionnel à un rendez-vous : exécution des conditions (art. 6, 1, b) ; choix « sans préférence » : intérêt légitime de la structure (art. 6, 1, f).",
        "P8 — Orientations entre professionnels (fonction fermée) : consentement à chaque partage (art. 6, 1, a ; art. 9, 2, a).",
        "P9 — Dossiers partagés et suivi (fonction fermée) : consentement au partage (art. 6, 1, a ; art. 9, 2, a).",
        "P10b/P10c — Rappel la veille et notifications du navigateur : consentement (art. 6, 1, a), retirable à tout moment.",
        "P11 — Disponibilités Outlook d'une structure (désactivé) : base choisie par la structure ; l'exploitant agit pour elle.",
      ] },
      { id: 'retention', title: '4. Durées de conservation', items: [
        "Compte (adresse électronique, mot de passe protégé, nom affiché, langue, préférences de notification, date de la dernière connexion) : tant que vous l'utilisez. Vous pouvez demander son effacement à tout moment depuis votre espace : une personne vérifie la demande, pour éviter une erreur ou une usurpation, puis efface le compte dans un délai d'un mois au plus.",
        "Compte inactif : un compte sans activité de votre part (connexion) pendant 24 mois pourra être effacé. Cet effacement n'est pas encore en service ; avant qu'il le soit, cette notice indiquera comment vous serez prévenu. Compte jamais activé (adresse électronique jamais confirmée) : effacé avec la trace de son inscription au plus tard 8 jours après sa création : l'effacement automatique a lieu une fois par jour dès que le compte a 7 jours.",
        "Liens de vérification de l'adresse, de mot de passe et de changement d'adresse : valables 15 minutes (30 minutes pour un changement d'adresse) ; un lien expiré ou déjà utilisé ne fonctionne plus. Nous n'en gardons qu'une empreinte (et, pour un changement d'adresse, la nouvelle adresse chiffrée) ; leur suppression automatique après expiration n'est pas encore activée : ils sont supprimés avec le compte.",
        "Session de connexion : 7 jours au plus. Après 5 échecs de connexion, le compte est verrouillé 15 minutes.",
        "Compteurs de limitation des requêtes (votre adresse IP et, pour la connexion, la création de compte et l'envoi de liens, une empreinte de votre adresse électronique, jamais l'adresse elle-même) : effacés à la fin de leur fenêtre, de quelques minutes à une heure. Les journaux n'en gardent qu'une empreinte condensée.",
        "E-mails de service : leur contenu n'est pas conservé par AccesDirectAide ; la trace de l'envoi (numéro du message chez le prestataire) est gardée 12 mois. Si une adresse refuse définitivement les messages, une empreinte de l'adresse (pas l'adresse elle-même) bloque les envois ; ce blocage est revu après 12 mois et supprimé s'il n'est plus justifié. Lorsque votre compte est effacé, nous demandons à Mailjet de supprimer l'adresse qu'il a enregistrée, avant de l'effacer chez nous ; quand Mailjet confirme, il l'anonymise aussitôt et efface ses enregistrements après 30 jours. S'il ne confirme pas, nous réessayons pendant 3 jours au plus, sans dépasser le délai d'un mois pour répondre à votre demande ; si l'échec persiste, votre compte est quand même effacé chez nous, une personne est avertie pour intervenir, et l'adresse peut rester chez Mailjet selon la règle indiquée plus bas (journaux techniques des prestataires). Pour un compte jamais activé, la demande à Mailjet est faite au moment de son effacement automatique, sans nouvel essai. Après un changement d'adresse, la même demande est faite pour l'ancienne adresse, sans nouvel essai.",
        "Archives à accès restreint après l'effacement d'un compte : preuve de l'acceptation des conditions d'utilisation et de la déclaration « 18 ans ou plus », 12 mois ; demandes d'exercice des droits, 3 ans après leur clôture. Elles ne servent qu'à prouver ou à se défendre en cas de litige.",
        "Décisions de consentement remplacées par une décision plus récente : 3 ans après leur enregistrement.",
        "Demandes d'aide adressées au support par le formulaire d'aide (pas encore ouvert), y compris pour retrouver l'accès à un compte : 12 mois après la clôture de la demande.",
        "Journaux d'administration et de sécurité (sans votre adresse électronique) : 12 mois.",
        "Conservation bloquée (« gel ») d'une donnée précise, lorsqu'une autorité l'exige ou qu'un litige l'impose : jusqu'à la fin de la procédure ; la trace de la levée est gardée 12 mois.",
        "Journaux techniques des prestataires : l'hébergeur (Vercel) garde ses journaux d'exécution 1 jour avec son offre Pro, et 30 jours lorsque son option « Observability Plus » est activée pour le site. Le prestataire d'e-mails (Mailjet) garde les statistiques d'envoi 90 jours avec la formule gratuite de Mailjet, 13 mois avec une formule payante ; il enregistre l'adresse du destinataire comme contact et la garde tant que notre compte Mailjet existe, sauf si nous la supprimons avant ; à la fin de notre contrat, il efface les données dans un délai de 90 jours. Mailjet ne publie pas de durée pour le contenu des messages.",
        "Historique de restauration : copies de sauvegarde chiffrées, 35 jours au plus ; historique de la base de données chez Neon, 6 heures au plus avec la formule gratuite de Neon, que nous utilisons. Une donnée effacée peut subsister dans ces copies pendant ces durées ; elle n'est utilisée que pour réparer un incident. Pour qu'une restauration ne fasse pas revenir une personne effacée, une trace de chaque effacement (identifiant technique du compte et de la demande, date ; ni adresse ni nom) est gardée 40 jours hors de la base, chez Upstash (Francfort).",
        "Fonctions pas encore ouvertes (notamment rendez-vous, message facultatif, notifications des professionnels, assistant, membres du foyer, historique de consultation, favoris, suivi des démarches) : leurs durées seront annoncées dans cette notice avant leur ouverture. Pour les rendez-vous confirmés, tenus ou manqués, la durée envisagée est de 1 an après la date du rendez-vous, puis anonymisation.",
      ], paras: [
        "Aucune de ces durées n'est imposée par un texte : elles sont fixées par le responsable du traitement. La suppression automatique à ces échéances n'est pas encore entièrement activée ; vous pouvez demander l'effacement à tout moment.",
      ] },
      { id: 'recipients', title: '5. Destinataires', paras: [
        "Vos données ne sont ni vendues ni louées. Y ont accès : l'exploitant ; les prestataires techniques de la section 6, sur instruction pour vos données (la section 6 indique aussi ce que certains traitent pour leur propre compte).",
        "Lorsque les rendez-vous seront ouverts (ils ne le sont pas encore), la structure que vous choisirez pour un rendez-vous recevra aussi ce qui lui sera transmis (section 9).",
      ] },
      { id: 'processors', title: '6. Prestataires techniques (sous-traitants)', items: [
        'Vercel Inc. : hébergement du site et des fonctions serveur, exécutées à Francfort ; les pages elles-mêmes (contenu statique, sans donnée de compte) sont distribuées par le réseau mondial de Vercel.',
        'Neon (contrat Databricks, Inc.) : base de données hébergée à Francfort.',
        'Upstash, Inc. : compteurs de sécurité et limitation du nombre de requêtes, à Francfort.',
        "Mailjet (groupe Sinch) : envoi des e-mails de service (vérification de l'adresse, mot de passe, avis du compte) ; données hébergées par Google Cloud à Francfort (Allemagne) et Saint-Ghislain (Belgique).",
        'Microsoft : boîte de réception de l\'adresse de contact.',
        "Scaleway SAS (France) et Cloudflare, Inc. : copies de sauvegarde de la base de données. La tâche de sauvegarde s'exécute chez Scaleway, à Paris, et chiffre la copie avant tout envoi ; Cloudflare la stocke dans l'Union européenne sans pouvoir la lire.",
      ], paras: [
        "Pour vos données, chacun de ces prestataires agit sur instruction, comme sous-traitant, dans le cadre d'un accord de traitement des données (article 28 du RGPD) intégré à ses conditions de service. Certains traitent aussi, pour leur propre compte et sous leur propre responsabilité, des données techniques liées à l'utilisation de leur service, notamment : Vercel, pour les données d'usage générées par son service ; Sinch (Mailjet), pour acheminer les messages, lutter contre le spam et la fraude et sécuriser son réseau ; Upstash, pour la sécurité et l'analyse de son propre service.",
      ] },
      { id: 'transfers', title: '7. Transferts hors de l\'Union européenne', paras: [
        "La plupart de ces prestataires appartiennent à des groupes établis aux États-Unis ; Mailjet appartient au groupe suédois Sinch, qui a des filiales aux États-Unis : un accès depuis les États-Unis est possible. Les garanties prévues sont les clauses contractuelles types de la Commission européenne (décision d'exécution (UE) 2021/914), intégrées aux conditions de chaque prestataire. Vercel Inc. et Upstash, Inc. sont en outre inscrites sur la liste officielle du cadre de protection des données UE–États-Unis (consultée le 17 novembre 2026) ; Upstash s'appuie d'abord sur ce cadre, et sur les clauses contractuelles types s'il ne s'applique plus. Databricks, Inc. (Neon) y est également inscrite. Scaleway SAS fait exception : c'est une société française, qui exécute la tâche de sauvegarde à Paris.",
      ] },
      { id: 'rights', title: '8. Vos droits', items: [
        "Accès, rectification, effacement et limitation de vos données.",
        "Portabilité, pour les données traitées sur la base des conditions d'utilisation ou de votre consentement.",
        "Opposition, pour les traitements fondés sur l'intérêt légitime.",
        "Retrait de votre consentement à tout moment, aussi simplement que vous l'avez donné. Le retrait ne remet pas en cause ce qui a été fait avant.",
        "Directives sur le sort de vos données après votre décès (conservation, effacement, communication) : vous pouvez en définir, selon l'article 85 de la loi Informatique et Libertés.",
      ], paras: [
        "Depuis votre espace, vous pouvez vous-même : télécharger une copie de vos données (export), corriger les informations de votre compte, demander l'effacement de votre compte et demander la limitation de l'utilisation de vos données.",
        'Vous pouvez aussi écrire à {{contact}}, pour ces droits comme pour les autres. Une réponse vous est donnée dans un délai d\'un mois.',
        'Vous pouvez aussi adresser une réclamation à la CNIL (www.cnil.fr).',
      ] },
      { id: 'booking', title: '9. Quand vous demanderez un rendez-vous (projet)', paras: [
        "La demande de rendez-vous n'est pas encore ouverte. Ce qui suit s'appliquera lorsqu'elle le sera.",
        "La structure choisie recevra votre nom, votre adresse électronique, votre téléphone si vous l'indiquez, le créneau demandé et, si vous l'avez accepté, votre message.",
        "Pour ce qu'elle recevra, la structure sera responsable de son propre traitement : elle décidera de ce qu'elle en fait dans ses dossiers, selon ses obligations. Vous pourrez exercer vos droits auprès d'elle.",
        "Pour la gestion de la demande dans la plateforme, l'exploitant et la structure seraient responsables conjoints ; un accord le précisera et ses grandes lignes seront publiées. Aucune structure n'a signé d'accord à ce jour.",
      ] },
      { id: 'sensitive', title: '10. Services sensibles (projet)', paras: [
        "Certains services peuvent révéler une information sur votre santé ou un handicap, par exemple un service de santé mentale ou d'addictologie. Une demande de rendez-vous auprès de ces services ne serait traitée qu'avec votre consentement explicite, donné par une case distincte non cochée. Retirer ce consentement annulerait la demande.",
        'La réservation de ces services est fermée à ce jour.',
      ] },
      { id: 'art14', title: '11. Professionnels et contacts des structures (article 14)', paras: [
        "L'annuaire contient des informations sur des structures et, le cas échéant, sur leurs contacts professionnels (nom de la structure, adresse de l'établissement, téléphone et adresse électronique professionnels, parfois le nom d'un responsable). Elles ne sont pas collectées auprès de vous : elles viennent de sources officielles ou publiques — FINESS, data·inclusion, l'Annuaire de l'administration (Service-Public / DILA). Chaque fiche indique sa source et sa date.",
        "Finalité : informer le public sur les services qui existent. Base : intérêt légitime (article 6, paragraphe 1, f) du RGPD. Durée : tant que la source officielle publie l'information ; mise à jour à chaque import.",
        "Si votre structure vous crée un compte professionnel, elle fournit votre nom et votre adresse professionnelle : les sections 3 à 8 s'appliquent aussi à vous.",
        'Vous pouvez demander une rectification ou vous opposer à l\'affichage d\'une donnée qui vous concerne : {{contact}}.',
      ] },
      { id: 'language', title: '12. Langue de référence', paras: [
        'La version française de cette notice est la seule juridiquement de référence ; les traductions sont une aide à la compréhension.',
      ] },
    ],
  },
];

/** The A-I / A-II legal notice texts live in the « legal » namespace (MentionsLegales.jsx); this entry gives them the same approval state. */
export const LEGAL_NOTICE_VARIANT_DOCUMENT_V6 = Object.freeze({
  id: 'mentions-legales-a1-a2',
  key: 'mentionsVariant',
  path: null,
  version: LEGAL_DRAFTS_V6,
  status: LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL,
});

/*
 * v7-2026-11-18 — owner decision D5 b (17/11/2026): the erasure trace also has an encrypted second copy in the K3 object storage (Cloudflare R2, EU
 * jurisdiction; api/_services/erasure-tombstone-copy.js). v7 = v6 + three appended sentences of the privacy notice, nothing else (diff:
 * CONTROL/v2/V7_METIN_FARKI_FR.md): § 4 « Historique de restauration » (LEGAL_DRAFTS_V7_SENTENCE) and, for the provider-role consistency the owner requires
 * between §§ 3, 5 and 6, the Cloudflare entry of § 6 (LEGAL_DRAFTS_V7_PROCESSOR_SENTENCE) and the Upstash entry of § 6, which in v6 did not name the
 * erasure traces § 4 places there (LEGAL_DRAFTS_V7_UPSTASH_SENTENCE; §§ 3 and 5 list no storage per provider: unchanged). Cloudflare's
 * role is the one § 6 already states for the backups (processor; Cloudflare DPA https://www.cloudflare.com/cloudflare-customer-dpa/, cited above for v5).
 * The copy is written only while v7 is approved (copyWriteConfig): Production can open on v6 with the copy off. The translations of the extended items
 * are the « i13_v7 » / « i3_v7 » / « i6_v7 » keys (itemKeys).
 */
export const LEGAL_DRAFTS_V7 = 'v7-2026-11-18';
export const LEGAL_DRAFTS_V7_SENTENCE = "Une seconde copie chiffrée de cette trace, que Cloudflare ne peut pas lire, est gardée 40 jours chez Cloudflare dans l'Union européenne.";
export const LEGAL_DRAFTS_V7_PROCESSOR_SENTENCE = "Cloudflare garde aussi, dans l'Union européenne et sans pouvoir la lire, la seconde copie chiffrée des traces d'effacement (section 4).";
/** v7 also closes a v6 gap: § 4 places the erasure traces at Upstash (since v3) but the § 6 Upstash entry did not name them */
export const LEGAL_DRAFTS_V7_UPSTASH_SENTENCE = "Upstash garde aussi, à Francfort, les traces d'effacement (section 4).";
/** v7 additions: section → { item index (0-based) → [appended sentence, translation key] } (notice-confidentialite only) */
export const LEGAL_DRAFTS_V7_ADDITIONS = Object.freeze({ retention: { 12: [LEGAL_DRAFTS_V7_SENTENCE, 'i13_v7'] }, processors: { 2: [LEGAL_DRAFTS_V7_UPSTASH_SENTENCE, 'i3_v7'], 5: [LEGAL_DRAFTS_V7_PROCESSOR_SENTENCE, 'i6_v7'] } });
/** @param {DraftDocument} d @returns {DraftDocument} */
const toV7 = (d) => ({ ...d, version: LEGAL_DRAFTS_V7, sections: d.sections.map((s) => {
  /** @type {Record<number, string[]> | undefined} */ const add = d.id === 'notice-confidentialite' ? /** @type {any} */ (LEGAL_DRAFTS_V7_ADDITIONS)[s.id] : undefined;
  if (!add || !s.items) return s;
  return { ...s, items: s.items.map((x, i) => (add[i] ? `${x} ${add[i][0]}` : x)), itemKeys: Object.fromEntries(Object.entries(add).map(([i, a]) => [Number(i), a[1]])) };
}) });
/** @type {DraftDocument[]} */
export const LEGAL_DRAFT_DOCUMENTS_V7 = LEGAL_DRAFT_DOCUMENTS_V6.map(toV7);
export const LEGAL_NOTICE_VARIANT_DOCUMENT_V7 = Object.freeze({ ...LEGAL_NOTICE_VARIANT_DOCUMENT_V6, version: LEGAL_DRAFTS_V7 });

/*
 * v8-2026-11-19 — G4 (19/11/2026): planned opening of the ADA Pro accounts (invitation only, double authentication, structure administration only; cases,
 * referrals, dossiers, appointments, messages and the assistant CLOSED). v8 exists for the TWO professional documents only (LEGAL_DRAFTS_V8_DOCUMENT_IDS;
 * the privacy notice joined v8 later the same day, see below): the citizen terms and the A-I / A-II variant stay at v7 (no v8 of them exists, so « cgu-citoyen@v8-… » approves nothing). v8 = v7
 * (= v6 byte for byte for these two documents) with the factual errors corrected, nothing else (diff: CONTROL/v2/V8_METIN_FARKI_FR.md; French masters:
 * CONTROL/r45/R45_CGU_PROFESSIONNEL_FR_v8-2026-11-19.md and R45_CONDITIONS_STRUCTURES_FR_v8-2026-11-19.md):
 *  cgu-professionnel § 5  « votre nom » removed — ProUser has no name column (src/db/schema.ts: email, password_hash, role, status, structureId, notification
 *                         preferences, MFA); the list is exactly what the account holds; « vos créneaux » only once appointments are open for the structure.
 *  cgu-professionnel § 4  appointments are closed: conditional (« lorsqu'elle est ouverte pour votre structure ») and « (pas encore ouverts) » in the title;
 *                         the assistant sentence removed (no AI runs in Production: capability ai.processing is out of the AIPD, api/_utils/capabilities.js).
 *  conditions-structures  intro: structures do not receive appointment requests today, and a structure administrator accepts these conditions at the invited
 *                         sign-up (api/_utils/pro-terms.js) — the scope names the ADA Pro accounts; § 2, § 3 p1 and § 4 i1 / i5: appointments and the message
 *                         are closed — conditional. § 1 (directory: public listings carry their official source and verification date, api/lib/publicVisibility.js),
 *                         § 5, § 6, § 7 and the other items are true as written: unchanged.
 * Translations: the changed texts have their own keys (« title_v8 », « intro_v8 », « p1_v8 », « i1_v8 »… : titleKey / introKey / paraKeys / itemKeys); the v6
 * keys keep the v6 translations, which v6 and v7 still render.
 */
export const LEGAL_DRAFTS_V8 = 'v8-2026-11-19';
export const LEGAL_DRAFTS_V8_DOCUMENT_IDS = Object.freeze(['cgu-professionnel', 'conditions-structures', 'notice-confidentialite']);
/*
 * notice-confidentialite v8 (G4 notice, 19/11/2026; diff CONTROL/v2/V8_NOTICE_FARKI_FR.md, master CONTROL/r45/R45_NOTICE_CONFIDENTIALITE_FR_v8-2026-11-19.md).
 * v8 = v7 + exactly two changes; the citizen terms and the A-I / A-II variant stay at v7, v6 / v7 of the notice unchanged byte for byte.
 *  § 11 p3  « elle fournit votre nom » removed: ProUser has no name column (src/db/schema.ts: email, password_hash, role, status, structureId,
 *           notificationEmailEnabled / notificationPrefs, mfa_secret). The invitation (Invitation.email) is sent by a structure administrator or by the
 *           platform (api/_handlers/pro/invite.js: STRUCTURE_ADMIN or SUPERADMIN, authorizePlatformInvitation); the password is a one-way scrypt hash
 *           (api/_utils/password-hash.js); actions go to AuditLog (logProAudit, api/_utils/auth.js); the acceptance of cgu-professionnel (and
 *           conditions-structures for a STRUCTURE_ADMIN) is recorded « document@version » in ConsentLog, proof level CONTRACT_ACCEPTANCE
 *           (api/_utils/pro-terms.js) — not a GDPR consent.
 *  § 3 p3   (new) /droits (static view bundled at build time, no field, no request of its own: G3_RIGHTS_VIEW) and /orientation in the browser-only
 *           mode (VITE_ORIENTATION_BROWSER_ONLY=1: computed in the page, no answer sent, no storage: G4_ORIENTATION_BROWSER). What remains is the
 *           host's ordinary logs of page requests, already described: P1 (§ 3) and « Journaux techniques des prestataires » (§ 4) — Vercel runtime
 *           logs include static requests served from its cache (https://vercel.com/docs/logs/runtime, « Available log types », read 19/11/2026).
 */
export const LEGAL_DRAFTS_V8_PRO_ACCOUNT_PARAGRAPH = "Si un compte professionnel vous est ouvert, c'est sur invitation envoyée à votre adresse électronique professionnelle par un administrateur de votre structure ou par l'exploitant. Ce compte contient votre adresse électronique professionnelle, votre rôle, votre structure, votre mot de passe sous forme hachée (irréversible), le secret de votre double authentification, le journal de vos actions et vos préférences de notification. Votre acceptation des conditions d'utilisation des professionnels (et, pour un administrateur de structure, des conditions des structures) est enregistrée avec leur version dans le registre des consentements ; ce n'est pas un consentement au sens du RGPD. Les sections 3 à 8 s'appliquent aussi à vous.";
export const LEGAL_DRAFTS_V8_BROWSER_ONLY_PARAGRAPH = "La page publique « Explorer les droits par besoin » (/droits) et le questionnaire d'orientation (/orientation), lorsqu'il fonctionne entièrement dans votre navigateur, font leurs calculs dans votre navigateur : ils n'envoient aucune de vos réponses à AccesDirectAide et n'enregistrent rien, ni chez nous ni sur votre appareil. Seuls subsistent, comme pour toute page du site, les journaux techniques habituels de l'hébergeur sur les pages demandées (P1 ci-dessus ; durée en section 4, « Journaux techniques des prestataires »).";
/** v8 changes: document → { intro?: [text, key], sections: { section → { title?: [text, key], paras?: { index → [text, key] }, items?: { index → [text, key] } } } } */
export const LEGAL_DRAFTS_V8_CHANGES = Object.freeze({
  'cgu-professionnel': { sections: {
    appointments: {
      title: ['4. Rendez-vous (pas encore ouverts)', 'title_v8'],
      paras: {
        0: ["La prise de rendez-vous n'est pas encore ouverte. Lorsqu'elle est ouverte pour votre structure, vous confirmez, proposez un autre créneau ou refusez les demandes qui vous sont adressées, dans un délai raisonnable, et vous tenez vos créneaux à jour.", 'p1_v8'],
        1: ["La plateforme ne décide d'aucun droit : seul l'organisme compétent décide.", 'p2_v8'],
      },
    },
    data: { paras: {
      0: ["Pour votre compte, la plateforme traite votre adresse électronique professionnelle, votre rôle, votre structure, votre mot de passe sous forme hachée (irréversible), le secret de votre double authentification, le journal de vos actions et vos préférences de notification. Lorsque la prise de rendez-vous est ouverte pour votre structure, elle traite aussi vos créneaux. La notice de confidentialité décrit ces traitements, leurs bases légales proposées et leurs durées.", 'p1_v8'],
    } },
  } },
  'conditions-structures': {
    intro: ["Ces conditions décrivent les règles proposées aux structures (associations, services publics, établissements) qui figurent dans l'annuaire, dont l'équipe utilise des comptes ADA Pro ou qui recevront des demandes de rendez-vous lorsque cette fonction sera ouverte ; elle ne l'est pas encore. Aucune structure ne les a signées à ce jour.", 'intro_v8'],
    sections: {
      agreement: {
        title: ['2. Raccordement aux rendez-vous (pas encore ouvert)', 'title_v8'],
        paras: { 0: ["La prise de rendez-vous n'est pas encore ouverte. Lorsqu'elle le sera, une structure ne recevra des demandes de rendez-vous qu'après la signature d'une convention écrite avec l'exploitant, qui désignera un référent. Le raccordement sera gratuit : aucune somme ne sera versée par la structure ni à la structure.", 'p1_v8'] },
      },
      roles: { paras: {
        0: ["Lorsque la prise de rendez-vous sera ouverte, la structure sera responsable de son propre traitement pour ce qu'elle recevra (demandes, coordonnées, message accepté par la personne), dans ses dossiers et selon ses obligations.", 'p1_v8'],
      } },
      commitments: { items: {
        0: ['Lorsque la prise de rendez-vous sera ouverte : répondre aux demandes dans un délai raisonnable et tenir ses créneaux à jour.', 'i1_v8'],
        4: ["Lorsque le message joint à une demande sera ouvert : appliquer le retrait par une personne de son accord à ce message, c'est-à-dire effacer toute copie, ou la garder sous sa propre responsabilité en l'en informant.", 'i5_v8'],
      } },
    },
  },
  'notice-confidentialite': { sections: {
    purposes: { paras: {
      2: [LEGAL_DRAFTS_V8_BROWSER_ONLY_PARAGRAPH, 'p3_v8'],
    } },
    art14: { paras: {
      2: [LEGAL_DRAFTS_V8_PRO_ACCOUNT_PARAGRAPH, 'p3_v8'],
    } },
  } },
});
/**
 * @param {Record<number, string[]> | undefined} ch @param {string[] | undefined} list @param {Record<number, string> | undefined} keys
 * @returns {[string[] | undefined, Record<number, string> | undefined]}
 */
const applyV8 = (ch, list, keys) => (ch && list
  ? [[...list.map((x, i) => (ch[i] ? ch[i][0] : x)), ...Object.keys(ch).map(Number).filter((i) => i >= list.length).sort((a, b) => a - b).map((i) => ch[i][0])],
    { ...(keys || {}), ...Object.fromEntries(Object.entries(ch).map(([i, a]) => [Number(i), a[1]])) }]
  : [list, keys]);   // an index at or past the end of the list appends a new text (notice v8: § 3 p3)
/** @param {DraftDocument} d @returns {DraftDocument} */
const toV8 = (d) => {
  const c = /** @type {any} */ (LEGAL_DRAFTS_V8_CHANGES)[d.id];
  return { ...d, version: LEGAL_DRAFTS_V8, ...(c.intro ? { intro: c.intro[0], introKey: c.intro[1] } : {}), sections: d.sections.map((s) => {
    const sc = c.sections[s.id];
    if (!sc) return s;
    const [paras, paraKeys] = applyV8(sc.paras, s.paras, s.paraKeys);
    const [items, itemKeys] = applyV8(sc.items, s.items, s.itemKeys);
    return { ...s, ...(sc.title ? { title: sc.title[0], titleKey: sc.title[1] } : {}), ...(paras ? { paras, paraKeys } : {}), ...(items ? { items, itemKeys } : {}) };
  }) };
};
/** @type {DraftDocument[]} the two professional documents and the privacy notice */
export const LEGAL_DRAFT_DOCUMENTS_V8 = LEGAL_DRAFT_DOCUMENTS_V7.filter((d) => LEGAL_DRAFTS_V8_DOCUMENT_IDS.includes(d.id)).map(toV8);

/*
 * v9-2026-11-19 — G8 (19/11/2026): the privacy notice that must be in force before ADA Pro opens to a pilot structure (surfaces admin,accounts,pro; NO
 * capability open; no data about the people a structure accompanies). v9 exists for the privacy notice ONLY (LEGAL_DRAFTS_V9_DOCUMENT_IDS): the citizen
 * terms and the A-I / A-II variant stay v7, the professional terms and the structure conditions stay v8; v6 / v7 / v8 of the notice unchanged byte for byte.
 * Diff: CONTROL/v2/V9_NOTICE_FARKI_FR.md; master CONTROL/r45/R45_NOTICE_CONFIDENTIALITE_FR_v9-2026-11-19.md. Why: v8 § 3 bis lists P4p (professional accounts)
 * among the functions « pas en service », § 2 says the notice covers personal accounts only, § 4 gives no retention for a professional account, § 8 offers
 * self-service rights that ADA Pro does not have, and § 11 p3_v8 sends the professional to §§ 3–8 as if they applied unchanged. Code facts per text:
 *  § 2 p1_v9     the narrow opening: api/_utils/capabilities.js (pro.account / pro.structure_admin, aipd in, no HDS) — referrals, cases, dossiers,
 *                appointments, messages behind closed capabilities / surfaces (tests/integration/g8-pro-pilot-onboarding-db.test.js: every such route 503).
 *  § 3 p4p_v9    (moved from § 3 bis, basis no longer « proposée »): invitation api/_handlers/pro/invite.js; MFA mandatory in Production
 *                (proMfaRequired, api/_utils/auth.js); team / invitations / structure record proposals / reports (ROUTE_CAPABILITIES pro.structure_admin);
 *                display name and job title optional (api/_services/pro-public-profile.js); notifications (api/_services/pro-notifications.js, e.g.
 *                structure-proposals.js); journal logProAudit → AuditLog. The acceptance of cgu-professionnel is recorded (api/_utils/pro-terms.js).
 *  § 3 bis       P4p removed (it is now in § 3); P4 (display of professionals' names for a booking) stays: appointments are closed.
 *  § 4 proAccount_v9  ProUser columns (src/db/schema.ts) + ProProfile.displayName / jobTitle; departure = disable (api/_handlers/pro/team.js, sessions end);
 *                PRO_USER_DISABLED_DAYS = 365 in the APPROVED policy (api/_services/retention-policy.js) but the purge step disabledProUsersReport is
 *                kind « report » (api/_handlers/cron/gdpr-purge.js): « pas encore automatisé », done by the operator with ERASE_PRO_ACCOUNT
 *                (api/_services/pro-account-admin.js: only an already disabled account; address, password hash, factor, preferences, public profile,
 *                notifications, invitations erased / anonymised; the row keeps id, role, structure); closure of the structure's space: same erasure for
 *                every member (api/_services/org-closure.js, incl. redeemed invitations since f661851). Proof of the terms acceptance: ConsentLog
 *                subject PRO_USER (id + document@version, no address) — NO purge step covers it (CONSENT_AFTER_ERASURE_DAYS only for CITIZEN_USER rows,
 *                anchored on a citizen DSRRequest): « 12 mois », the citizen figure, is an OWNER DECISION and « pas encore automatisée ».
 *  § 4 proLinks_v9    invitation 7 days single use, only its hash stored (invite.js, api/_utils/invite-token.js); MFA activation link 72 h
 *                (mfa-invitation.js); password reset 1 hour in KV = Upstash (forgot-password.js, key « reset:pro:<sha256> », ex 3600);
 *                INVITATION_GRACE_DAYS = 30 (step deletedInvitationsCount NOT among approvedSteps: not automated); session 12 h at most
 *                (PRO_SESSION_MAX_AGE_SECONDS); LOGIN_PRO 5 per 15 min per IP and per address (rateLimit.js, address keyed-hashed).
 *  § 4 proLogs_v9     PRO_NOTIFICATION_DAYS = 180 and AUDIT_LOG_DAYS = 365, steps not approved (not automated); logProAudit stores the IP (AuditLog.ip)
 *                and never the address (R47); the Mailjet contact deletion (api/_services/mail-contact-erasure.js) is NOT called by pro-account-admin.js
 *                nor org-closure.js — said as such.
 *  § 4 i14_v9    « notifications des professionnels » no longer « pas encore ouvertes » (in-app notices exist: proLogs_v9); orientations named instead.
 *  § 5 pro_v9    the structure administrator sees and exports the team (email, role, status, notification preferences) and the structure journal
 *                (exportOrganization, api/_services/structure-proposals.js); display name / title: not published (the professional search endpoint is in no surface list and booking is closed).
 *  § 6 i3_v9 / i4_v9  Upstash also holds the pro reset links (1 h); Mailjet also sends the invitations and notices of professional accounts.
 *  § 8 pro_v9    no self-service export / erasure in ADA Pro: by writing; self-service of display name, title (pro-public-profile.js) and
 *                notification preferences (setPreferences, pro-notifications.js).
 *  § 11 p3_v9    p3_v8 + display name / job title + which sections carry the professional rules.
 * Translations: every changed or new text has its own « …_v9 » key; inserted / removed list entries keep the keys of the other entries (explicit keys).
 */
export const LEGAL_DRAFTS_V9 = 'v9-2026-11-19';
export const LEGAL_DRAFTS_V9_DOCUMENT_IDS = Object.freeze(['notice-confidentialite']);
export const LEGAL_DRAFTS_V9_STATUS_PARAGRAPH = "Cette notice décrit les traitements des comptes personnels (section 3) et des comptes professionnels ADA Pro (section 3, P4p, et section 11). Dans ADA Pro, seules sont ouvertes les fonctions de compte, d'équipe et de fiche de la structure (avec son journal et ses statistiques) : les fonctions qui traiteraient des informations sur les personnes accompagnées sont fermées. Les rendez-vous, les messages, les rappels, les orientations entre professionnels et le partage de dossiers ne sont pas encore ouverts : leurs bases légales sont indiquées à titre de proposition (section 3 bis) et seront confirmées avant leur ouverture.";
export const LEGAL_DRAFTS_V9_P4P = "P4p — Comptes professionnels ADA Pro (création sur invitation, connexion avec double authentification obligatoire, gestion de l'équipe et des invitations par l'administrateur de la structure, propositions de mise à jour de la fiche de la structure, nom affiché et fonction facultatifs, notifications et e-mails de service, journal des actions) : exécution des conditions d'utilisation des professionnels acceptées à l'inscription (art. 6, 1, b) ; sécurité des comptes et journal des actions : intérêt légitime de l'exploitant et de la structure à protéger les accès (art. 6, 1, f).";
export const LEGAL_DRAFTS_V9_PRO_ACCOUNT_RETENTION = "Compte professionnel ADA Pro (adresse électronique professionnelle, rôle, structure, mot de passe sous forme hachée, secret de double authentification, préférences de notification et, si vous les indiquez, nom affiché et fonction) : tant que vous êtes membre de l'équipe de votre structure. Lorsque vous la quittez, l'administrateur de votre structure, ou l'exploitant, désactive le compte : vos sessions prennent fin aussitôt. Un compte désactivé est gardé 12 mois au plus, pour permettre sa réactivation et la preuve des actions, puis effacé ; cet effacement n'est pas encore automatisé : l'exploitant le fait depuis sa console d'administration. Vous pouvez demander l'effacement plus tôt en écrivant à {{contact}}. L'effacement supprime votre adresse, votre mot de passe, votre double authentification, vos préférences, votre nom affiché et votre fonction, vos notifications et votre adresse dans les invitations qui vous ont été envoyées ; le compte ne garde que son identifiant technique, son rôle et sa structure, auxquels renvoient les journaux. Lorsque l'espace de votre structure est fermé, les comptes de son équipe sont effacés de la même façon. La preuve de votre acceptation des conditions des professionnels (identifiant du compte, document, version et date, sans votre adresse) est gardée 12 mois après l'effacement ; cette suppression n'est pas encore automatisée.";
export const LEGAL_DRAFTS_V9_PRO_LINKS_RETENTION = "Compte professionnel — invitations, liens et sessions : l'invitation est valable 7 jours et une seule fois, le lien d'activation de la double authentification 72 heures, le lien de réinitialisation du mot de passe 1 heure (il est gardé chez Upstash, à Francfort, pendant cette heure). D'un lien d'invitation, nous ne gardons qu'une empreinte, avec l'adresse invitée et le rôle ; une invitation expirée est supprimée 30 jours après son expiration — cette suppression n'est pas encore automatisée — et elle est dans tous les cas effacée ou anonymisée avec votre compte. Session de connexion : 12 heures au plus. Au-delà de 5 tentatives de connexion en 15 minutes depuis la même adresse IP ou pour la même adresse électronique, les tentatives suivantes sont refusées pendant 15 minutes au plus.";
export const LEGAL_DRAFTS_V9_PRO_LOGS_RETENTION = "Compte professionnel — notifications, journal et e-mails : les notifications affichées dans ADA Pro sont gardées 180 jours ; le journal de vos actions (date, action, structure, adresse IP de connexion ; sans votre adresse électronique) suit la règle des journaux d'administration et de sécurité ci-dessous (12 mois). Ces suppressions ne sont pas encore automatisées. Les e-mails qui vous sont envoyés (invitation, mot de passe, avis) suivent la règle « E-mails de service » ci-dessous ; toutefois, la demande de suppression de l'adresse chez Mailjet n'est pas encore faite pour un compte professionnel : l'adresse enregistrée chez Mailjet lors de ces envois peut y rester selon la règle « Journaux techniques des prestataires ».";
export const LEGAL_DRAFTS_V9_PRO_RECIPIENTS = "Pour un compte professionnel, les administrateurs de votre structure voient aussi votre adresse professionnelle, votre rôle, l'état de votre compte, vos préférences de notification et le journal des actions de la structure, et peuvent les exporter (export des données de la structure). Votre nom affiché et votre fonction, si vous les indiquez, ne sont pas publiés sur le site public.";
export const LEGAL_DRAFTS_V9_PRO_RIGHTS = "Pour un compte professionnel, ces fonctions de libre-service n'existent pas : écrivez à {{contact}} pour accéder à vos données, en obtenir une copie, les faire corriger ou effacer, ou en demander la limitation. Dans ADA Pro, vous pouvez vous-même modifier votre nom affiché, votre fonction et vos préférences de notification.";
export const LEGAL_DRAFTS_V9_PRO_ACCOUNT_PARAGRAPH = "Si un compte professionnel vous est ouvert, c'est sur invitation envoyée à votre adresse électronique professionnelle par un administrateur de votre structure ou par l'exploitant. Ce compte contient votre adresse électronique professionnelle, votre rôle, votre structure, votre mot de passe sous forme hachée (irréversible), le secret de votre double authentification, le journal de vos actions et vos préférences de notification, ainsi que, si vous les indiquez, votre nom affiché et votre fonction. Votre acceptation des conditions d'utilisation des professionnels (et, pour un administrateur de structure, des conditions des structures) est enregistrée avec leur version dans le registre des consentements ; ce n'est pas un consentement au sens du RGPD. Les sections 3 à 8 s'appliquent aussi à vous, avec les règles propres aux comptes professionnels qu'elles indiquent : finalité et base en section 3 (P4p), durées en section 4, destinataires en section 5, exercice de vos droits en section 8.";
/**
 * v9 changes (notice-confidentialite only): section → { title?: [text, key], paras? / items?: { replace?: { index → [text, key] },
 * insertAfter?: { index → [[text, key], …] }, remove?: index[] } } — indexes are those of the v8 list.
 */
export const LEGAL_DRAFTS_V9_CHANGES = Object.freeze({
  'notice-confidentialite': { sections: {
    status: { paras: { replace: { 0: [LEGAL_DRAFTS_V9_STATUS_PARAGRAPH, 'p1_v9'] } } },
    purposes: { title: ['3. Finalités et bases légales des comptes personnels et professionnels', 'title_v9'], items: { insertAfter: { 3: [[LEGAL_DRAFTS_V9_P4P, 'p4p_v9']] } } },
    'purposes-later': { items: { remove: [1] } },
    retention: { items: {
      insertAfter: { 0: [[LEGAL_DRAFTS_V9_PRO_ACCOUNT_RETENTION, 'proAccount_v9'], [LEGAL_DRAFTS_V9_PRO_LINKS_RETENTION, 'proLinks_v9'], [LEGAL_DRAFTS_V9_PRO_LOGS_RETENTION, 'proLogs_v9']] },
      replace: { 13: ["Fonctions pas encore ouvertes (notamment rendez-vous, message facultatif, orientations entre professionnels, assistant, membres du foyer, historique de consultation, favoris, suivi des démarches) : leurs durées seront annoncées dans cette notice avant leur ouverture. Pour les rendez-vous confirmés, tenus ou manqués, la durée envisagée est de 1 an après la date du rendez-vous, puis anonymisation.", 'i14_v9'] },
    } },
    recipients: { paras: { insertAfter: { 0: [[LEGAL_DRAFTS_V9_PRO_RECIPIENTS, 'pro_v9']] } } },
    processors: { items: { replace: {
      2: ["Upstash, Inc. : compteurs de sécurité et limitation du nombre de requêtes, à Francfort. Upstash garde aussi, à Francfort, les traces d'effacement (section 4) et, pendant 1 heure, les liens de réinitialisation du mot de passe des comptes professionnels.", 'i3_v9'],
      3: ["Mailjet (groupe Sinch) : envoi des e-mails de service (vérification de l'adresse, mot de passe, avis du compte, invitations et avis des comptes professionnels) ; données hébergées par Google Cloud à Francfort (Allemagne) et Saint-Ghislain (Belgique).", 'i4_v9'],
    } } },
    rights: { paras: { insertAfter: { 0: [[LEGAL_DRAFTS_V9_PRO_RIGHTS, 'pro_v9']] } } },
    art14: { paras: { replace: { 2: [LEGAL_DRAFTS_V9_PRO_ACCOUNT_PARAGRAPH, 'p3_v9'] } } },
  } },
});
/**
 * applies one v9 list change; every entry of the result gets an explicit key (the v8 key of a kept entry, so an insertion or a removal never shifts a
 * translation onto another text)
 * @param {any} ch @param {string[] | undefined} list @param {Record<number, string> | undefined} keys @param {'i' | 'p'} prefix
 * @returns {[string[] | undefined, Record<number, string> | undefined]}
 */
const applyV9 = (ch, list, keys, prefix) => {
  if (!ch || !list) return [list, keys];
  /** @type {Array<[string, string]>} */ const out = [];
  list.forEach((x, i) => {
    if (!(ch.remove || []).includes(i)) out.push(ch.replace?.[i] ? [ch.replace[i][0], ch.replace[i][1]] : [x, keys?.[i] || `${prefix}${i + 1}`]);
    for (const [t, k] of ch.insertAfter?.[i] || []) out.push([t, k]);
  });
  return [out.map((e) => e[0]), Object.fromEntries(out.map((e, i) => [i, e[1]]))];
};
/** @param {DraftDocument} d @returns {DraftDocument} */
const toV9 = (d) => {
  const c = /** @type {any} */ (LEGAL_DRAFTS_V9_CHANGES)[d.id];
  return { ...d, version: LEGAL_DRAFTS_V9, sections: d.sections.map((s) => {
    const sc = c.sections[s.id];
    if (!sc) return s;
    const [paras, paraKeys] = applyV9(sc.paras, s.paras, s.paraKeys, 'p');
    const [items, itemKeys] = applyV9(sc.items, s.items, s.itemKeys, 'i');
    return { ...s, ...(sc.title ? { title: sc.title[0], titleKey: sc.title[1] } : {}), ...(paras ? { paras, paraKeys } : {}), ...(items ? { items, itemKeys } : {}) };
  }) };
};
/** @type {DraftDocument[]} the privacy notice only */
export const LEGAL_DRAFT_DOCUMENTS_V9 = LEGAL_DRAFT_DOCUMENTS_V8.filter((d) => LEGAL_DRAFTS_V9_DOCUMENT_IDS.includes(d.id)).map(toV9);

/*
 * cgu-professionnel v9-2026-11-22 — G14 (22/11/2026; owner approved notice-confidentialite v9-2026-11-19 on 22/11/2026 with « pro kabul kanıtı 12 ay » and
 * « devre dışı pro hesapları 12 ay sonra elle silinecek », and asked for this draft; owner sheet CONTROL/master/G14_CGU_PRO_V9_ONAY_TR.md, master
 * CONTROL/r45/R45_CGU_PROFESSIONNEL_FR_v9-2026-11-22.md). v9-2026-11-22 exists for the professional terms ONLY (LEGAL_DRAFTS_V9_PRO_DOCUMENT_IDS): the
 * structure conditions stay v8, the notice v9-2026-11-19, the citizen terms v7; v6 / v7 / v8 of cgu-professionnel unchanged byte for byte. NOT approved.
 * v9 = v8 with the sentences that become false when the `pro` surface opens corrected, the two owner retention decisions, and nothing else:
 *  intro_v9 / § 2 i1_v9  « créé(e) sur / à l'invitation de votre structure » — the FIRST administrator of a pilot structure (and the successor of a sole
 *                administrator) is invited by the platform (SUPERADMIN, api/_services/platform-invitation.js, api/_handlers/pro/invite.js; runbook G8 § 5
 *                step 4, § 6.2). Same wording as the notice v9 § 11 p3.
 *  § 4 p3_v9     (new) video only « si la visioconférence est activée »: capability `video` closed and out of the AIPD (api/_utils/capabilities.js),
 *                VIDEO_PROVIDER off by default. No provider named (8x8 JaaS has no DPA yet) and no promise: a reference to the notice (whose § 2 / § 4
 *                already say functions not open yet are described there before opening).
 *  § 5 p1_v9     « bases légales proposées » — the notice v9 § 3 P4p gives the bases as decided: art. 6, 1, b (these terms) and art. 6, 1, f (account
 *                security, journal). + display name and job title, optional (ProProfile, api/_services/pro-public-profile.js), as in the notice v9.
 *  § 7 p1_v9     « Vous et votre structure en êtes informés » — neither DISABLE_PRO_ACCOUNT (api/_services/pro-account-admin.js) nor the team screen
 *                (api/_handlers/pro/team.js, USER_DISABLED) sends any notice to the person: a neutral, true statement, no new commitment (owner condition
 *                22/11/2026: no obligation beyond his existing approvals).
 *  § 7 p2_v9     (new) owner decisions 22/11/2026, word for word the notice v9 § 4 proAccount_v9: disabled account 12 months at most, then erased by the
 *                operator (ERASE_PRO_ACCOUNT; purge step disabledProUsersReport is a report only: « pas encore automatisé »); closure of the structure's
 *                space erases the team the same way (api/_services/org-closure.js); proof of acceptance (ConsentLog PRO_USER, id + document@version, no
 *                address; api/_utils/pro-terms.js) 12 months after the erasure, no purge step: « pas encore automatisée ».
 * The sole-administrator rule (api/_services/sole-admin.js) governs ADA's own « propose, then confirm » reviews; the professional terms name no review rule:
 * nothing to change. Acceptance recording is unchanged: Production records the APPROVED version only (proTermsReference).
 * Translations: every changed or new text has its own « …_v9 » key (explicit keys, as for the notice v9).
 */
export const LEGAL_DRAFTS_V9_PRO = 'v9-2026-11-22';
export const LEGAL_DRAFTS_V9_PRO_DOCUMENT_IDS = Object.freeze(['cgu-professionnel']);
export const LEGAL_DRAFTS_CGU_PRO_V9_INTRO = "Ces conditions s'appliquent aux professionnels qui utilisent un compte ADA Pro, créé sur invitation d'un administrateur de leur structure ou de l'exploitant.";
export const LEGAL_DRAFTS_CGU_PRO_V9_INVITATION = "Le compte est créé sur invitation envoyée à votre adresse électronique professionnelle par un administrateur de votre structure ou par l'exploitant (par exemple pour le premier administrateur d'une structure). Il est personnel : ne le partagez pas.";
export const LEGAL_DRAFTS_CGU_PRO_V9_VIDEO = "Si la visioconférence est activée pour votre structure (elle ne l'est pas à ce jour), son traitement et son prestataire sont décrits dans la notice de confidentialité.";
export const LEGAL_DRAFTS_CGU_PRO_V9_DATA = "Pour votre compte, la plateforme traite votre adresse électronique professionnelle, votre rôle, votre structure, votre mot de passe sous forme hachée (irréversible), le secret de votre double authentification, le journal de vos actions et vos préférences de notification, ainsi que, si vous les indiquez, votre nom affiché et votre fonction. Lorsque la prise de rendez-vous est ouverte pour votre structure, elle traite aussi vos créneaux. Ces traitements reposent sur l'exécution des présentes conditions (article 6, 1, b du RGPD) et, pour la sécurité des comptes et le journal des actions, sur l'intérêt légitime de l'exploitant et de votre structure à protéger les accès (article 6, 1, f). La notice de confidentialité les décrit (section 3, P4p), avec leurs durées (section 4) et la façon d'exercer vos droits (section 8).";
export const LEGAL_DRAFTS_CGU_PRO_V9_SUSPENSION = "En cas d'usage contraire à ces conditions ou d'incident de sécurité, l'administrateur de votre structure ou l'exploitant peut désactiver votre compte : vos sessions prennent fin aussitôt. Aucun avis automatique ne vous est envoyé lorsque votre compte est désactivé.";
export const LEGAL_DRAFTS_CGU_PRO_V9_RETENTION = "Un compte désactivé est gardé 12 mois au plus, pour permettre sa réactivation et la preuve des actions, puis effacé par l'exploitant ; cet effacement n'est pas encore automatisé. Vous pouvez demander l'effacement plus tôt en écrivant à {{contact}}. Lorsque l'espace de votre structure est fermé, les comptes de son équipe sont effacés de la même façon. La preuve de votre acceptation de ces conditions (identifiant du compte, document, version et date, sans votre adresse) est gardée 12 mois après l'effacement ; cette suppression n'est pas encore automatisée.";
/** the v8 sentences v9 corrects (kept here for the tests and the owner sheet; v8 itself is unchanged) */
export const LEGAL_DRAFTS_CGU_PRO_V9_REPLACED = Object.freeze([
  "Le compte est créé sur invitation de votre structure.",
  'leurs bases légales proposées',
  'Vous et votre structure en êtes informés',
]);
/** v9 changes (cgu-professionnel only): same shape as LEGAL_DRAFTS_V9_CHANGES (indexes are those of the v8 list) */
export const LEGAL_DRAFTS_CGU_PRO_V9_CHANGES = Object.freeze({
  'cgu-professionnel': { intro: [LEGAL_DRAFTS_CGU_PRO_V9_INTRO, 'intro_v9'], sections: {
    account: { items: { replace: { 0: [LEGAL_DRAFTS_CGU_PRO_V9_INVITATION, 'i1_v9'] } } },
    appointments: { paras: { insertAfter: { 1: [[LEGAL_DRAFTS_CGU_PRO_V9_VIDEO, 'p3_v9']] } } },
    data: { paras: { replace: { 0: [LEGAL_DRAFTS_CGU_PRO_V9_DATA, 'p1_v9'] } } },
    end: { paras: { replace: { 0: [LEGAL_DRAFTS_CGU_PRO_V9_SUSPENSION, 'p1_v9'] }, insertAfter: { 0: [[LEGAL_DRAFTS_CGU_PRO_V9_RETENTION, 'p2_v9']] } } },
  } },
});
/** @param {DraftDocument} d @returns {DraftDocument} */
const toV9Pro = (d) => {
  const c = /** @type {any} */ (LEGAL_DRAFTS_CGU_PRO_V9_CHANGES)[d.id];
  return { ...d, version: LEGAL_DRAFTS_V9_PRO, ...(c.intro ? { intro: c.intro[0], introKey: c.intro[1] } : {}), sections: d.sections.map((s) => {
    const sc = c.sections[s.id];
    if (!sc) return s;
    const [paras, paraKeys] = applyV9(sc.paras, s.paras, s.paraKeys, 'p');
    const [items, itemKeys] = applyV9(sc.items, s.items, s.itemKeys, 'i');
    return { ...s, ...(paras ? { paras, paraKeys } : {}), ...(items ? { items, itemKeys } : {}) };
  }) };
};
/** @type {DraftDocument[]} the professional terms only */
export const LEGAL_DRAFT_DOCUMENTS_V9_PRO = LEGAL_DRAFT_DOCUMENTS_V8.filter((d) => LEGAL_DRAFTS_V9_PRO_DOCUMENT_IDS.includes(d.id)).map(toV9Pro);

/*
 * v10-2026-11-22 / v11-2026-11-22 — G14 (22/11/2026): Mon Parcours, LIMITED version (owner batch approval « G14 toplu onay », point 2, 22/11/2026; masters:
 * CONTROL/master/completion/G14_MON_PARCOURS_NOTICE_CGU_V10_FR.md). Mon Parcours opens BEFORE ADA Pro (K8 has no date) and the notice must never describe
 * ADA Pro as open while it is closed, so the Mon Parcours texts exist on two bases:
 *  v10  cgu-citoyen            = v7 (in force) + one item in § 5 « Votre compte » (account.parcours_v10): declarative, no free text, deletion.
 *       notice-confidentialite = v8 (in force in Production since G4) + three texts: § 3 item P17 (purposes.p17_v10), § 4 item « Mon Parcours »
 *                                (retention.parcours_v10: 24 months after closure, notice 30 days before, backups up to 35 days, possible reappearance after a
 *                                restore), § 4 « functions not open yet » without « suivi des démarches » (retention.i14_v10, from the v8 list).
 *       → put in force at the Mon Parcours opening.
 *  v11  notice-confidentialite = v9 (approved by the owner on 22/11/2026 for the ADA Pro opening) + the SAME three texts (retention.i14_v11 from the v9 list).
 *       APPROVED FOR ACTIVATION AT THE ADA PRO (K8) OPENING ONLY (LEGAL_DRAFTS_V11_ACTIVATION); a draft until VITE_LEGAL_DOCS_APPROVED_VERSION names it.
 * Every earlier version unchanged byte for byte. Translations: the « …_v10 » / « …_v11 » keys of src/i18n/locales/<lang>/legaldraft.json.
 */
export const LEGAL_DRAFTS_V10 = 'v10-2026-11-22';
export const LEGAL_DRAFTS_V10_DOCUMENT_IDS = Object.freeze(['cgu-citoyen', 'notice-confidentialite']);
export const LEGAL_DRAFTS_V11 = 'v11-2026-11-22';
export const LEGAL_DRAFTS_V11_DOCUMENT_IDS = Object.freeze(['notice-confidentialite']);
/** v11 is approved (owner, 22/11/2026) but goes into force only with the ADA Pro opening (K8): it carries the v9 texts on professional accounts */
export const LEGAL_DRAFTS_V11_ACTIVATION = 'APPROVED_FOR_ACTIVATION_AT_K8 — approuvée le 22/11/2026, à mettre en vigueur seulement à l’ouverture d’ADA Pro (K8)';
export const LEGAL_DRAFTS_V10_P17 = "P17 — Mon Parcours, le suivi personnel de vos démarches (une démarche choisie dans une liste fermée de démarches courantes, un lieu public publié si vous le choisissez, l'état que vous indiquez, une échéance avec la fiche officielle qui s'y rapporte, l'historique des changements sans texte) : exécution des conditions d'utilisation (art. 6, 1, b). Mon Parcours n'enregistre aucun texte libre et ne propose aucune démarche liée à la santé, au handicap, à la vie sexuelle, à une infraction ou une procédure pénale, au droit au séjour, à des violences subies, à la protection de l'enfance, à une mesure de protection juridique ou à une situation de grande précarité. Vos étapes ne sont visibles que par vous : aucune structure, aucun professionnel, aucune personne de confiance et aucun administrateur ne les voit dans le service. Les rappels d'échéance se font seulement dans les notifications de Mon Espace, jamais par e-mail ni par SMS pour le moment.";
export const LEGAL_DRAFTS_V10_PARCOURS_RETENTION = "Mon Parcours : une étape en cours est gardée tant que vous la gardez ; vous pouvez la supprimer à tout moment. Une étape terminée ou abandonnée est effacée, avec son historique, 24 mois après sa clôture ; un avis vous prévient dans Mon Espace 30 jours avant, et vous pouvez télécharger vos données à tout moment. Une étape effacée peut subsister jusqu'à 35 jours dans les copies de sauvegarde (« Historique de restauration » ci-dessous) ; si une restauration avait lieu pendant ce délai, une étape que vous aviez supprimée pourrait réapparaître : vous en seriez prévenu et pourriez la supprimer à nouveau.";
/** v10 (from v8): the v8 list without « suivi des démarches » */
export const LEGAL_DRAFTS_V10_NOT_OPEN = "Fonctions pas encore ouvertes (notamment rendez-vous, message facultatif, notifications des professionnels, assistant, membres du foyer, historique de consultation, favoris) : leurs durées seront annoncées dans cette notice avant leur ouverture. Pour les rendez-vous confirmés, tenus ou manqués, la durée envisagée est de 1 an après la date du rendez-vous, puis anonymisation.";
/** v11 (from v9): the v9 list without « suivi des démarches » */
export const LEGAL_DRAFTS_V11_NOT_OPEN = "Fonctions pas encore ouvertes (notamment rendez-vous, message facultatif, orientations entre professionnels, assistant, membres du foyer, historique de consultation, favoris) : leurs durées seront annoncées dans cette notice avant leur ouverture. Pour les rendez-vous confirmés, tenus ou manqués, la durée envisagée est de 1 an après la date du rendez-vous, puis anonymisation.";
export const LEGAL_DRAFTS_V10_CGU_PARCOURS = "Mon Parcours : vous pouvez y suivre vous-même des démarches choisies dans une liste proposée par le service, avec, si vous le souhaitez, un lieu public et une échéance. Ce que vous y indiquez est déclaratif : ce n'est ni une demande, ni un dépôt, ni la preuve d'une démarche, et cela n'engage ni AccesDirectAide ni aucun organisme ; seul l'organisme compétent décide. Mon Parcours n'accepte aucun texte libre. Vous pouvez supprimer une étape à tout moment ; une étape terminée est effacée 24 mois après sa clôture.";
/** changes in the v9 change format; indexes = those of the base document (cgu-citoyen v7, notice v8 for v10, notice v9 for v11) */
export const LEGAL_DRAFTS_V10_CHANGES = Object.freeze({
  'notice-confidentialite': { sections: {
    purposes: { items: { insertAfter: { 9: [[LEGAL_DRAFTS_V10_P17, 'p17_v10']] } } },
    retention: { items: { insertAfter: { 12: [[LEGAL_DRAFTS_V10_PARCOURS_RETENTION, 'parcours_v10']] }, replace: { 13: [LEGAL_DRAFTS_V10_NOT_OPEN, 'i14_v10'] } } },
  } },
  'cgu-citoyen': { sections: {
    account: { items: { insertAfter: { 0: [[LEGAL_DRAFTS_V10_CGU_PARCOURS, 'parcours_v10']] } } },
  } },
});
export const LEGAL_DRAFTS_V11_CHANGES = Object.freeze({
  'notice-confidentialite': { sections: {
    purposes: { items: { insertAfter: { 10: [[LEGAL_DRAFTS_V10_P17, 'p17_v10']] } } },
    retention: { items: { insertAfter: { 15: [[LEGAL_DRAFTS_V10_PARCOURS_RETENTION, 'parcours_v10']] }, replace: { 16: [LEGAL_DRAFTS_V11_NOT_OPEN, 'i14_v11'] } } },
  } },
});
/** @param {any} changes @param {string} version @returns {(d: DraftDocument) => DraftDocument} */
const withChanges = (changes, version) => (d) => {
  const c = changes[d.id];
  return { ...d, version, sections: d.sections.map((s) => {
    const sc = c.sections[s.id];
    if (!sc) return s;
    const [paras, paraKeys] = applyV9(sc.paras, s.paras, s.paraKeys, 'p');
    const [items, itemKeys] = applyV9(sc.items, s.items, s.itemKeys, 'i');
    return { ...s, ...(paras ? { paras, paraKeys } : {}), ...(items ? { items, itemKeys } : {}) };
  }) };
};
/** @param {DraftDocument[]} set @param {string} id @returns {DraftDocument} */
const docOf = (set, id) => /** @type {DraftDocument} */ (set.find((d) => d.id === id));
/** @type {DraftDocument[]} the citizen terms (from v7) and the privacy notice (from v8, the version in force) — Mon Parcours opening */
export const LEGAL_DRAFT_DOCUMENTS_V10 = [
  withChanges(LEGAL_DRAFTS_V10_CHANGES, LEGAL_DRAFTS_V10)(docOf(LEGAL_DRAFT_DOCUMENTS_V7, 'cgu-citoyen')),
  withChanges(LEGAL_DRAFTS_V10_CHANGES, LEGAL_DRAFTS_V10)(docOf(LEGAL_DRAFT_DOCUMENTS_V8, 'notice-confidentialite')),
];
/** @type {DraftDocument[]} the privacy notice (from v9) — to be put in force at the ADA Pro (K8) opening only */
export const LEGAL_DRAFT_DOCUMENTS_V11 = [withChanges(LEGAL_DRAFTS_V11_CHANGES, LEGAL_DRAFTS_V11)(docOf(LEGAL_DRAFT_DOCUMENTS_V9, 'notice-confidentialite'))];

/*
 * v12-2026-11-23 / v13-2026-11-23 — G14 (23/11/2026): the expansion capabilities X04 (Académie, events), X02 (testimonials) and X01 (community stories),
 * with the « signalements et décisions » block (DSA notice and action, statement of reasons, internal complaint, repeated misuse), to open right after
 * Mon Parcours. Master: CONTROL/master/completion/G14_LEGAL_V12_V13_FR.md, from G14_EXPANSION_NOTICE_CGU_FR.md (written as a diff on notice v9; here
 * carried on the v10 / v11 bases) and the code of the expansion (api/_services/academy-events.js, testimonials.js, community-stories.js,
 * moderation-dsa.js, gdpr-purge-expansion-steps.js, retention-policy.js G14 durations). NOT X05 (job listings: needs the `pro` surface) and NOT X03
 * (entraide: closed until its dedicated AIPD). The owner is the sole named moderator (owner, 23/11/2026): the texts say « le responsable du traitement /
 * l'exploitant, qui assure lui-même la modération », without his name. APPROVED by the owner on 23/11/2026 (verbatim: CONTROL/master/
 * G14_OWNER_LEGAL_APPROVAL_2026-11-23.md; OWNER_VALIDATED — the controller's own approval, not a lawyer's or an expert's review): cgu-citoyen v12,
 * notice v12 and v13, cgu-professionnel v10, conditions-structures v9; the « à valider » points decided as proposed (P18 / P19 / P20: legitimate
 * interest, art. 6, 1, f; social referrals: 12 months after closure; Cloudflare DPA v6.4 accepted online).
 *  v12  cgu-citoyen            = v10 + § « 7 bis. Contenus que vous publiez » (new section `publishing`, ten items) + one paragraph in § 8.
 *       notice-confidentialite = v10 (Mon Parcours, from v8: no ADA Pro text) + § 2 one paragraph, new § « 3 ter » (`participation`), § 4 five items,
 *                                § 5 one paragraph, § 6 Mailjet item (moderation e-mails), § 8 one paragraph, new § « 13 » (`moderation`).
 *       → put in force at the X04 / X01 / X02 opening (with cgu-professionnel@v8 and conditions-structures@v8 unchanged).
 *  v13  notice-confidentialite = v11 (ADA Pro, from v9) + the SAME expansion texts (Mailjet item from the v9 wording) + the ADA Pro opening texts
 *       (owner decision 23/11/2026: no pilot structure, public sign-up verified by the operator, appointments, 8x8 JaaS video, Outlook free / busy):
 *       § 2 p1_v13, § 3 P4p_v13 + P4 / P5 / P7 moved word for word from § 3 bis + P11 without « (désactivé) », § 4 appointments / Outlook / not-open list,
 *       § 5 p2_v13, § 6 Microsoft / 8x8 items and video paragraph, § 7 video paragraph, § 9 booking (the structure receives neither name, e-mail nor
 *       phone: rdv.js), § 11 p3_v13 (sign-up). Approved for activation at the ADA Pro opening (LEGAL_DRAFTS_V13_ACTIVATION), with
 *       cgu-professionnel v10-2026-11-23 and conditions-structures v9-2026-11-23 (below).
 * Facts by text (code wins over the master; differences listed in the master file):
 *  participation  X04 adult account only (isAdultAccount), one need from a closed list with a separate never-pre-ticked agreement, proof in ConsentLog
 *                 (EVENT_ACCESSIBILITY_NEED, true / false), organizer counts only (registrationCounts), reminder in the notification centre from 48 h
 *                 before (REMINDER_WINDOW_HOURS). X02 / X01: consent per text (TESTIMONIAL_PUBLICATION / COMMUNITY_STORY_PUBLICATION), withdrawal erases
 *                 text and name, pseudonym member row with its own id, LEAVE deletes it with the stories.
 *  retention      EVENT_NEED_AFTER_END_DAYS 1, EVENT_REGISTRATION_AFTER_END_DAYS 30, ACADEMY_EVENT_ENDED_DAYS 365, *_PENDING_DAYS 60, *_REVIEW_DAYS 1095
 *                 (report only), *_SKELETON_DAYS 365, UGC_REPORT_DAYS 90, COMMUNITY_MEMBER_INACTIVE_DAYS 730, CONTENT_NOTICE_AFTER_DECISION_DAYS 365 (kept
 *                 while an appeal is open: contentNoticesDeleted). Owner decisions 23/11/2026: « retiré automatiquement » after 60 days (steps decided,
 *                 approved after their dry run; § 4 p0 already says the automatic deletion is not fully active); decisions / appeals / sanctions erased
 *                 1 year after the case is closed (MODERATION_CASE_CLOSED_DAYS, steps moderationDecisionsDeleted / moderationSanctionsDeleted, policy
 *                 g14-expansion-2-2026-11-23-a7-365d). Public charter /charte-de-moderation (src/pages/CharteModeration.jsx): one moderator, 24 hours /
 *                 7 days; § 13 p7, CGU § 7 bis i2 / i5 point to it. Conditions des structures v9 / notice v13 § 9: the essence of the art. 26 arrangement.
 *  moderation     moderation-dsa.js: public form (four elements of art. 16(2), identity optional for CHILD_SAFETY), acknowledgement + appeal code by
 *                 e-mail, statementText (art. 17(3) a–f, e-mail + /compte/moderation), six-month free appeal, sole moderator = same person after 24 h
 *                 (SOLE_REVIEW_DELAY_MS) and the answer says so, warnings then 1–180 days (WARNING_WINDOW_DAYS 365), notifier keyed by HMAC (notifierKey).
 *  video (v13)    api/lib/video-provider.js issueJaasJoin: room = HMAC (no name, date, structure), user id = HMAC per appointment, generic display name,
 *                 moderator flag, nbf / exp = 15 min before / after; recording, live streaming, transcription, calls, file upload off. 8x8 Global DPA
 *                 2025-02 (owner accepted 23/11/2026): processor, SCC 2021/914 module 2. Opens with ADA Pro (owner 23/11/2026).
 *  appointments   gdpr-purge.js: A7 = 365 (approvedChoices) confirmed, 90 unconfirmed / refused / expired after startAt, 90 cancelled after cancelledAt,
 *  (v13)          30 message (LEAST(startAt, cancelledAt)); Outlook tokens 30 days after expiry; busy read kept 2 min in memory (CALENDAR_FRESH_MS).
 * Every earlier version unchanged byte for byte. Translations: the « …_v12 » / « …_v13 » keys of src/i18n/locales/<lang>/legaldraft.json.
 */
export const LEGAL_DRAFTS_V12 = 'v12-2026-11-23';
export const LEGAL_DRAFTS_V12_DOCUMENT_IDS = Object.freeze(['cgu-citoyen', 'notice-confidentialite']);
export const LEGAL_DRAFTS_V13 = 'v13-2026-11-23';
export const LEGAL_DRAFTS_V13_DOCUMENT_IDS = Object.freeze(['notice-confidentialite']);
/** v12 and v13 are approved by the owner (23/11/2026, OWNER_VALIDATED); v13 carries the v9 / v11 texts on professional accounts and the video provider */
export const LEGAL_DRAFTS_V12_STATUS = 'APPROVED — approuvée le 23/11/2026 par le responsable, à mettre en vigueur à l’ouverture de X04, X01 et X02';
export const LEGAL_DRAFTS_V13_ACTIVATION = 'APPROVED_FOR_ACTIVATION — approuvée le 23/11/2026 par le responsable, à mettre en vigueur à l’ouverture d’ADA Pro, décidée le 23/11/2026 sans structure pilote (inscription vérifiée, rendez-vous, visioconférence, Outlook), avec cgu-professionnel v10-2026-11-23 et conditions-structures v9-2026-11-23';

export const LEGAL_DRAFTS_V12_STATUS_PARAGRAPH = "Elle décrit aussi, lorsqu'elles sont ouvertes, les fonctions de participation (section 3 ter) et la manière dont les contenus publiés sont signalés et modérés (section 13).";
export const LEGAL_DRAFTS_V12_EVENTS = "Événements de l'Académie : vous inscrire à un événement, annuler votre inscription et recevoir un rappel dans les notifications de Mon Espace à partir de 48 heures avant le début : exécution des conditions d'utilisation (art. 6, 1, b). Si vous le choisissez, un seul besoin d'accessibilité dans une liste (par exemple une interprétation en langue des signes) : votre consentement explicite (art. 9, 2, a), donné par une case distincte jamais cochée d'avance. Chaque accord et chaque retrait est enregistré comme preuve. Vous pouvez retirer ce besoin à tout moment depuis « Mes événements » ; l'annulation de l'inscription l'efface aussi. L'organisateur ne reçoit que des nombres (combien de personnes inscrites, combien de besoins de chaque sorte), jamais votre nom ni votre adresse.";
export const LEGAL_DRAFTS_V12_TESTIMONIALS = "Témoignages : publier votre témoignage après relecture, sous le prénom ou le pseudonyme que vous choisissez : votre consentement (art. 6, 1, a), donné pour chaque texte par une case jamais cochée d'avance, que vous pouvez retirer à tout moment ; le texte et le nom sont alors effacés. N'écrivez rien sur votre santé, un handicap ou une autre personne : un texte qui en parle n'est pas publié. Signalements et relecture : intérêt légitime (art. 6, 1, f).";
export const LEGAL_DRAFTS_V12_STORIES = "Histoires de la communauté : même règle, sous un pseudonyme que vous choisissez et qui n'est jamais relié publiquement à votre compte. Quitter la communauté supprime votre pseudonyme et vos histoires.";
export const LEGAL_DRAFTS_V12_PARTICIPATION_NOTE = "Ces fonctions sont réservées aux comptes de personnes qui ont déclaré avoir 18 ans ou plus. Leurs durées de conservation sont indiquées en section 4, leurs destinataires en section 5, les signalements et décisions de modération en section 13.";
export const LEGAL_DRAFTS_V12_EVENTS_RETENTION = "Événements : le besoin d'accessibilité est effacé dès que vous annulez, et au plus tard le lendemain de la fin de l'événement ; l'inscription est supprimée 30 jours après la fin de l'événement (ou après votre annulation si elle vient avant) ; la page d'un événement terminé est supprimée après 12 mois.";
export const LEGAL_DRAFTS_V12_CONTENT_RETENTION = "Témoignages et histoires : un texte qui n'a pas été relu dans les 60 jours est retiré automatiquement (texte effacé, retrait de votre accord enregistré) ; un texte publié reste en ligne tant que vous ne le retirez pas, et nous vous demanderons de le confirmer après 3 ans (rien n'est retiré sans votre réponse ou une décision) ; après un retrait ou un refus, le texte est effacé aussitôt et la ligne qui garde l'état et les dates, sans texte, est supprimée après 12 mois ; un signalement est supprimé à la décision, et au plus tard après 90 jours ; un pseudonyme sans histoire publiée ni en attente est supprimé après 24 mois sans activité.";
export const LEGAL_DRAFTS_V12_NOTICES_RETENTION = "Signalements envoyés sans compte (formulaire « Signaler un contenu ») : supprimés 12 mois après la décision, et gardés tant qu'une contestation est en cours.";
export const LEGAL_DRAFTS_V12_PROOFS_RETENTION = "Preuves d'accord (témoignages, histoires, besoin d'accessibilité) : selon la règle des décisions de consentement ci-dessus.";
export const LEGAL_DRAFTS_V12_DECISIONS_RETENTION = "Décisions de modération, contestations et mesures contre les abus : effacées 1 an après la clôture du dossier. Une décision est close lorsque le délai de contestation et la mesure ont pris fin et qu'aucune contestation n'est en cours (ses contestations sont effacées avec elle) ; un avertissement, 12 mois après avoir été donné ; une suspension, à sa fin ou à sa levée.";
export const LEGAL_DRAFTS_V12_RECIPIENTS = "Ce que vous choisissez de publier (témoignage, histoire, avec le nom ou le pseudonyme choisi) est visible de tous. La modération est assurée par le responsable du traitement lui-même, personne physique, seul modérateur nommé à la date de cette version, avec un compte d'administration à son nom protégé par une double authentification. Dans l'outil de modération, il voit le texte et le nom ou le pseudonyme choisi, jamais votre adresse électronique ni votre compte, ni qui a signalé un contenu ; l'auteur n'apprend pas non plus qui l'a signalé.";
export const LEGAL_DRAFTS_V12_RIGHTS = "Retirer un témoignage ou une histoire, retirer un besoin d'accessibilité, quitter la communauté : depuis votre espace, en un geste. Les décisions de modération qui vous concernent et vos contestations sont dans « Décisions de modération ». L'export de vos données comprend ces éléments.";
export const LEGAL_DRAFTS_V12_MAILJET = "Mailjet (groupe Sinch) : envoi des e-mails de service (vérification de l'adresse, mot de passe, avis du compte et, pour les contenus publiés, accusés de réception des signalements, décisions de modération et réponses aux contestations) ; données hébergées par Google Cloud à Francfort (Allemagne) et Saint-Ghislain (Belgique).";
export const LEGAL_DRAFTS_V13_MAILJET = "Mailjet (groupe Sinch) : envoi des e-mails de service (vérification de l'adresse, mot de passe, avis du compte, invitations et avis des comptes professionnels et, pour les contenus publiés, accusés de réception des signalements, décisions de modération et réponses aux contestations) ; données hébergées par Google Cloud à Francfort (Allemagne) et Saint-Ghislain (Belgique).";
/** § 13 — the DSA block (notice and action, statement of reasons, internal complaint, repeated misuse) */
export const LEGAL_DRAFTS_V12_MODERATION = Object.freeze([
  "AccesDirectAide stocke et publie, à votre demande, les contenus que vous écrivez (témoignages, histoires). Pour ces contenus, il fournit un service d'hébergement au sens du règlement (UE) 2022/2065 sur les services numériques.",
  "Signaler. Toute personne, avec ou sans compte, peut signaler un contenu qu'elle estime illicite ou contraire à la charte de modération (page « Charte de modération ») ou aux règles de la section 7 bis des conditions d'utilisation des particuliers, depuis la page « Signaler un contenu » ou en écrivant au point de contact indiqué dans les mentions légales. Le signalement indique pourquoi le contenu pose problème, où il se trouve (l'adresse de la page), votre nom et votre adresse électronique — sauf pour un contenu mettant en danger un enfant — et vous déclarez de bonne foi que ces informations sont exactes et complètes. Les titulaires d'un compte peuvent aussi signaler depuis la page du contenu. Si vous avez donné une adresse, vous recevez un accusé de réception, puis la décision et les recours possibles. Nom et adresse servent seulement à cela ; l'auteur du contenu ne les voit jamais. Base : intérêt légitime (art. 6, 1, f).",
  "Décider. Le responsable du traitement, qui assure lui-même la modération, examine chaque signalement ; aucun contenu n'est retiré automatiquement et aucune décision n'est automatisée. Un signalement qui laisse craindre une menace pour la vie ou la sécurité d'une personne est traité en priorité, dans les 24 heures ; les autres signalements, dans les 7 jours. S'il fait soupçonner une infraction de ce type, les autorités sont informées. En cas de danger immédiat, appelez le 112 (ou le 15, le 17) : AccesDirectAide n'est pas un service d'urgence.",
  "Motiver. Si votre contenu n'est pas publié ou est retiré, ou si votre participation est suspendue, vous recevez un exposé des motifs : la mesure et sa durée, les faits, si la décision fait suite à un signalement, la règle appliquée ou, pour un contenu jugé illicite, le texte de loi en cause, l'absence de moyen automatisé, et vos recours. Il vous est envoyé par e-mail et reste dans votre espace (« Décisions de modération »).",
  "Contester. Vous pouvez contester gratuitement une décision pendant six mois — que vous soyez l'auteur du contenu ou la personne qui l'a signalé — depuis votre espace, ou, sans compte, avec la référence et le code de votre accusé de réception. Lorsqu'une autre personne assure aussi la modération, c'est elle qui réexamine la décision. À la date de cette version, une seule personne assure la modération : elle réexamine elle-même la décision, au plus tôt 24 heures après votre contestation, et la réponse vous le dit. La réponse est motivée. Vous pouvez aussi saisir le juge.",
  "Abus répétés. Une personne qui publie à plusieurs reprises des contenus manifestement illicites, ou qui envoie à plusieurs reprises des signalements ou contestations manifestement infondés, reçoit d'abord un avertissement ; si cela se reproduit dans les 12 mois, la publication, ou le traitement de ses signalements, peut être suspendu pour une durée de 1 à 180 jours, fixée au cas par cas (nombre, proportion, gravité, intention). La personne en reçoit les motifs et peut contester. Pour une personne sans compte, la mesure est enregistrée avec une empreinte de son adresse calculée avec une clé secrète, jamais avec l'adresse elle-même.",
  "Règles appliquées. Les contenus refusés, les délais et les recours sont décrits dans la charte de modération, publiée sur la page « Charte de modération », et à la section 7 bis des conditions d'utilisation des particuliers. Aucun organe certifié de règlement extrajudiciaire des litiges n'est proposé.",
]);
/** cgu-citoyen § 7 bis (ten items) and § 8 (one paragraph) */
export const LEGAL_DRAFTS_V12_CGU_PUBLISHING = Object.freeze([
  "Certaines fonctions vous permettent de publier un texte (témoignage, histoire). Vous en êtes l'auteur et vous en répondez ; vous ne publiez que ce que vous êtes libre de publier.",
  "Avant toute publication, l'exploitant, qui assure lui-même la modération, relit le texte. Il refuse un texte contraire à la charte de modération (page « Charte de modération ») : information sur la santé ou un handicap, coordonnées ou détails qui permettent de reconnaître une personne, propos injurieux, menaçants ou discriminatoires, publicité, information trompeuse ou promesse de droit, texte hors sujet, et tout contenu illicite. En cas de doute sur la santé ou la reconnaissance d'un tiers, le texte est refusé et vous pouvez le réécrire.",
  "Vous pouvez retirer votre texte à tout moment ; il est alors effacé. Un texte qui n'a pas été relu dans les 60 jours est retiré automatiquement.",
  "En publiant, vous autorisez AccesDirectAide à afficher gratuitement votre texte sur le site, sous le nom ou le pseudonyme choisi, tant que vous ne le retirez pas. Cette autorisation n'est pas cédée à des tiers.",
  "Signaler. Toute personne, avec ou sans compte, peut signaler un contenu qu'elle estime illicite ou contraire à la charte de modération (notice de confidentialité, section 13). Un signalement ne retire jamais un texte à lui seul : une personne décide.",
  "Délais : accusé de réception d'un signalement envoyé par e-mail sous 2 jours ouvrés ; relecture d'un texte en attente sous 5 jours ouvrés ; signalement de sécurité (menace pour la vie ou la sécurité d'une personne, enfant en danger) dans les 24 heures, avec mesure conservatoire possible ; autres signalements dans les 7 jours ; réponse à une contestation sous 15 jours ouvrés.",
  "Motifs et recours. Si votre texte est refusé ou retiré, ou si votre participation est suspendue, vous recevez un exposé des motifs. Vous pouvez contester pendant six mois, gratuitement, depuis votre espace ; la décision est réexaminée et la réponse est motivée. Vous pouvez aussi saisir le juge.",
  "Abus répétés. Après un avertissement, la publication — ou le traitement de vos signalements — peut être suspendu de 1 à 180 jours en cas de contenus manifestement illicites, ou de signalements ou contestations manifestement infondés, répétés dans les 12 mois (notice de confidentialité, section 13).",
  "Danger pour une personne. Si un contenu laisse penser qu'une infraction menaçant la vie ou la sécurité d'une personne a été commise ou risque de l'être, AccesDirectAide en informe les autorités. En cas d'urgence, appelez le 112 (ou le 15, le 17).",
  "Âge. Ces fonctions sont réservées aux personnes qui déclarent avoir 18 ans ou plus.",
]);
export const LEGAL_DRAFTS_V12_CGU_SUSPENSION = "La participation à une fonction (communauté, témoignages) peut aussi être suspendue seule, sans toucher au reste du compte, avec les mêmes garanties (motifs et recours de la section 7 bis).";
/** v13 only — 8x8 JaaS (video stays closed, like the appointments) */
export const LEGAL_DRAFTS_V13_VIDEO_PROCESSOR = "8x8, Inc. (États-Unis) : visioconférence des rendez-vous (service « Jitsi as a Service »). 8x8 agit comme sous-traitant selon son accord de traitement des données (« Global Data Processing Addendum », version de février 2025), intégré à ses conditions de service.";
export const LEGAL_DRAFTS_V13_VIDEO_DATA = "Visioconférence : elle n'est proposée que pour un rendez-vous dont la structure a validé la visioconférence et pour lequel vous avez donné votre accord ; sa base est celle des rendez-vous (P5, section 3). AccesDirectAide transmet alors à 8x8 seulement un jeton d'accès valable de 15 minutes avant le début à 15 minutes après la fin du rendez-vous, qui contient un nom de salle calculé (une suite de caractères qui ne contient ni votre nom, ni la date, ni la structure), un identifiant technique propre au rendez-vous, un nom affiché générique (« Personne accompagnée » ou « Conseiller·e ») et le rôle dans la salle ; ni votre nom, ni votre adresse électronique, ni l'objet du rendez-vous. Pendant l'appel, votre navigateur se connecte directement aux serveurs de 8x8 : le son, l'image et les messages écrits dans la salle passent par eux, et 8x8 reçoit les données techniques de la connexion (notamment votre adresse IP). L'appel n'est pas enregistré : l'enregistrement, la diffusion en direct, la transcription, les appels téléphoniques et l'envoi de fichiers sont désactivés.";
export const LEGAL_DRAFTS_V13_VIDEO_TRANSFER = "Visioconférence : 8x8, Inc. est établie aux États-Unis ; les données de la visioconférence peuvent y être transférées. La garantie prévue est celle des clauses contractuelles types de la Commission européenne (décision d'exécution (UE) 2021/914, module 2 : de responsable du traitement à sous-traitant), prévues par l'accord de traitement des données de 8x8.";

/** v13 — the ADA Pro opening (owner 23/11/2026: no pilot structure, public sign-up verified by the operator, appointments, video and Outlook open) */
export const LEGAL_DRAFTS_V13_STATUS_PARAGRAPH = "Cette notice décrit les traitements des comptes personnels (section 3) et des comptes professionnels ADA Pro (section 3, P4p, et section 11). Dans ADA Pro sont ouvertes les fonctions de compte, d'équipe et de fiche de la structure (avec son journal et ses statistiques), les rendez-vous (demande, confirmation, report, annulation, affectation à un professionnel), la visioconférence des rendez-vous et la lecture des disponibilités Outlook (occupé ou libre) des professionnels qui connectent leur calendrier. Les orientations sociales entre structures (P23) et les notifications du navigateur (P10c) sont aussi ouvertes. Le message joint à une demande, le rappel la veille par e-mail, les orientations de dossiers entre professionnels et le partage de dossiers ne sont pas encore ouverts : leurs bases légales sont indiquées à titre de proposition (section 3 bis) et seront confirmées avant leur ouverture.";
export const LEGAL_DRAFTS_V13_P4P = "P4p — Comptes professionnels ADA Pro (création sur invitation ou sur demande d'inscription d'une structure avec son numéro SIRET, vérifiée par l'exploitant sur une source officielle, connexion avec double authentification obligatoire, gestion de l'équipe et des invitations par l'administrateur de la structure, propositions de mise à jour de la fiche de la structure, nom affiché et fonction facultatifs, notifications et e-mails de service, journal des actions) : exécution des conditions d'utilisation des professionnels acceptées à l'inscription (art. 6, 1, b) ; sécurité des comptes et journal des actions : intérêt légitime de l'exploitant et de la structure à protéger les accès (art. 6, 1, f).";
export const LEGAL_DRAFTS_V13_P11 = "P11 — Disponibilités Outlook d'un professionnel qui connecte son calendrier (occupé ou libre seulement) : base choisie par la structure ; l'exploitant agit pour elle.";
export const LEGAL_DRAFTS_V13_APPOINTMENTS_RETENTION = "Rendez-vous : un rendez-vous confirmé, tenu ou manqué est anonymisé 1 an après sa date ; une demande refusée, expirée ou restée sans réponse est anonymisée 90 jours après la date prévue du rendez-vous, et un rendez-vous annulé 90 jours après son annulation ; le message joint à une demande, lorsque cette fonction est ouverte, est effacé 30 jours après la date du rendez-vous (ou après l'annulation si elle vient avant).";
export const LEGAL_DRAFTS_V13_OUTLOOK_RETENTION = "Calendrier Outlook d'un professionnel : les jetons de connexion, chiffrés, sont gardés tant que la connexion est active ; un jeton expiré et non renouvelé est supprimé 30 jours après son expiration. Les plages occupées ou libres lues ne sont pas enregistrées dans la base de données : elles sont gardées 2 minutes au plus, en mémoire.";
export const LEGAL_DRAFTS_V13_NOT_OPEN = "Fonctions pas encore ouvertes (notamment message facultatif, rappel la veille par e-mail, orientations de dossiers entre professionnels, membres du foyer, historique de consultation, favoris) : leurs durées seront annoncées dans cette notice avant leur ouverture.";
export const LEGAL_DRAFTS_V13_RECIPIENTS = "La structure que vous choisissez pour un rendez-vous reçoit aussi ce qui lui est transmis (section 9). Lorsqu'un professionnel a connecté son calendrier Outlook, Microsoft reçoit les demandes de disponibilité (occupé ou libre) de ce calendrier ; aucune information sur vous ne lui est envoyée.";
export const LEGAL_DRAFTS_V13_MICROSOFT = "Microsoft : boîte de réception de l'adresse de contact ; pour les professionnels qui connectent leur calendrier Outlook, lecture des seules plages occupées ou libres de ce calendrier (autorisation « Calendars.ReadBasic »), sans l'objet, les participants ni le lieu des événements ; rien n'est écrit dans le calendrier. Selon les règles de l'organisation Microsoft du professionnel, l'accord de son administrateur peut être nécessaire.";
export const LEGAL_DRAFTS_V13_BOOKING = Object.freeze([
  "Une demande de rendez-vous se fait depuis votre compte. Selon le choix de la structure, le rendez-vous est confirmé aussitôt, ou la structure confirme, propose un autre créneau ou refuse.",
  "La structure choisie reçoit dans ADA Pro le service, le créneau et la modalité (sur place ou en visioconférence) que vous avez choisis et, lorsque cette fonction est ouverte et que vous l'avez accepté, votre message. La plateforme ne lui communique ni votre nom, ni votre adresse électronique, ni votre téléphone ; les avis sur le rendez-vous vous sont envoyés par la plateforme.",
  "Pour ce qu'elle reçoit, la structure est responsable de son propre traitement : elle décide de ce qu'elle en fait dans ses dossiers, selon ses obligations. Vous pouvez exercer vos droits auprès d'elle.",
  "Pour la gestion de la demande dans la plateforme, l'exploitant et la structure sont responsables conjoints (article 26 du RGPD). L'essentiel de leur accord : l'exploitant fait fonctionner la plateforme et traite les demandes d'exercice des droits faites par son intermédiaire ; la structure est responsable du rendez-vous lui-même et de ses suites en dehors de la plateforme. Vous pouvez exercer vos droits auprès de l'un ou de l'autre.",
]);
export const LEGAL_DRAFTS_V13_PRO_ACCOUNT_PARAGRAPH = "Si un compte professionnel vous est ouvert, c'est sur invitation envoyée à votre adresse électronique professionnelle par un administrateur de votre structure ou par l'exploitant, ou à la suite de la demande d'inscription de votre structure que vous avez faite vous-même (nom de la structure, numéro SIRET, votre adresse électronique professionnelle, un mot de passe et votre acceptation des conditions d'utilisation des professionnels). Dans ce cas, le compte ne donne accès à rien tant que l'exploitant n'a pas vérifié la structure sur une source officielle et activé votre espace ; vous recevez alors un e-mail pour activer votre accès avec la double authentification. Si la demande est refusée, le compte est désactivé et la preuve de votre acceptation des conditions est gardée. Ce compte contient votre adresse électronique professionnelle, votre rôle, votre structure, votre mot de passe sous forme hachée (irréversible), le secret de votre double authentification, le journal de vos actions et vos préférences de notification, ainsi que, si vous les indiquez, votre nom affiché et votre fonction. Votre acceptation des conditions d'utilisation des professionnels (et, pour un administrateur de structure, des conditions des structures) est enregistrée avec leur version dans le registre des consentements ; ce n'est pas un consentement au sens du RGPD. Les sections 3 à 8 s'appliquent aussi à vous, avec les règles propres aux comptes professionnels qu'elles indiquent : finalité et base en section 3 (P4p), durées en section 4, destinataires en section 5, exercice de vos droits en section 8.";
/*
 * G14 consolidation (23/11/2026) — the citizen and professional functions finished on other branches, integrated into v12 (citizen side, opens without
 * ADA Pro) and v13 (= the v12 citizen texts + the professional side). Branch facts (heads read 23/11/2026):
 *  situation  g14-rg cff79996   /situation works in the browser (like /droits, /orientation): typed words and the commune are neither sent nor stored;
 *                               « Ajouter à Mon Parcours » stores the closed-list code only; « Aider l'Observatoire » (opt-in) sends the situation id only.
 *  P18        g14-of cd9bc867   the questionnaire answers (and the optional Eurométropole commune) go to our own OpenFisca engine at Scaleway (fr-par);
 *                               nothing stored; indicative estimate. Basis: legitimate interest (owner, 23/11/2026).
 *  P19        g14-ai 31eb23f2   api/lib/workers-ai.js: Cloudflare Workers AI; question (identifiers masked, NIR / IBAN / card refused) + verified public
 *                               extracts, from our server, no account, no IP; no conversation stored, anonymous counters 90 days. Cloudflare DPA v6.4
 *                               (3 April 2026): processor (2.3), EU SCC 2021/914 module 2 (6.2(a)(i)), DPF (6.4); Workers AI data usage page (16/10/2026):
 *                               no training, no retention for standard inference. Basis: legitimate interest (owner, 23/11/2026); DPA v6.4 accepted online.
 *  P20        g14-obs 2fcab762  demand signals: closed-list codes, day, commune except sensitive subjects; daily counts deleted at the quarterly freeze;
 *                               quarterly tables, values < 5 masked, Licence Ouverte 2.0. Basis: legitimate interest (owner, 23/11/2026).
 *  P21        g14-aid 81e00197  assisted mode: person's consent + password, 30 / 60 / 120 minutes, never security / deletion / full export / new access,
 *                               Coffre only if ticked and never for a professional; remote trusted person; every action logged (AuditLog, 1 year).
 *  offline    g14-lite 0cb05297 opt-in local copy of Mon Parcours (IndexedDB), unencrypted, erased on untick / sign-out / account change; read-only offline.
 *  passeport  g14-ps 6e37ee65   the Passeport Social is encrypted on the device only: not a processing of AccesDirectAide.
 *  P23 (v13)  g14-ps 6e37ee65   social referrals (api/_services/social-referrals.js): consent with a one-time code, closed reasons, status, optional contact
 *                               seen by the receiving structure only while open; no document, no health data; retention 12 months after closure (owner, 23/11/2026).
 *  P10c (v13) g14-chan-a11y aea83e30  Web Push reminders (encrypted payload via the browser vendor's push service), .ics with date, time and public address
 *                               for non-sensitive services only; subscription kept until disabled / account erased (failing subscriptions: PUSH_FAILING_DAYS 30).
 * The Piper « siwis » credit (CC BY 4.0) belongs to the FALC audio page of g14-chan-a11y, not to the notice.
 */
export const LEGAL_DRAFTS_G14C_SITUATION = "La page « Ma situation » (/situation) fonctionne de la même façon : les mots que vous tapez et la commune que vous choisissez restent dans votre navigateur ; ils ne sont ni envoyés ni enregistrés. Si vous êtes connecté et choisissez « Ajouter à Mon Parcours », seul le code de la démarche, pris dans une liste fermée, est enregistré (P17). Si vous cochez « Aider l'Observatoire », seul l'identifiant de la situation choisie est envoyé, sans rien qui vous identifie (P20).";
export const LEGAL_DRAFTS_G14C_OFFLINE = "Mon Parcours hors ligne : si vous le cochez, une copie de vos étapes est gardée sur votre appareil, dans le stockage de votre navigateur, sans chiffrement ; ne l'activez pas sur un appareil partagé. Elle est effacée quand vous décochez la case, quand vous vous déconnectez ou quand vous changez de compte ; hors connexion, elle se consulte seulement. Le site garde aussi sur l'appareil des fichiers techniques publics. Ce stockage est strictement nécessaire au service que vous demandez (article 82 de la loi Informatique et Libertés) : il ne demande pas d'autre accord.";
export const LEGAL_DRAFTS_G14C_PASSEPORT = "Le Passeport Social est gardé chiffré sur votre appareil seulement : AccesDirectAide n'en reçoit rien et ne peut pas le récupérer ; si vous perdez l'appareil ou sa clé, il est perdu. Vous seul décidez de le montrer ou de le transmettre. Ce n'est pas un traitement d'AccesDirectAide.";
export const LEGAL_DRAFTS_G14C_P18 = "P18 — Calcul indicatif d'aides à partir du questionnaire : vos réponses (dont, si vous la choisissez, votre commune de l'Eurométropole) sont envoyées à notre propre moteur de calcul OpenFisca, hébergé par Scaleway SAS en France, qui agit comme sous-traitant ; elles n'y sont pas enregistrées. Le résultat est une estimation indicative : seul l'organisme compétent décide. Base : intérêt légitime de l'exploitant à informer le public (art. 6, 1, f).";
export const LEGAL_DRAFTS_G14C_P19 = "P19 — Assistant citoyen : votre question et des extraits de fiches publiques vérifiées sont envoyés depuis notre serveur à Cloudflare, Inc. (service Workers AI), qui agit comme sous-traitant (art. 28) ; ni votre adresse IP ni votre compte ne lui sont transmis. Les adresses électroniques et les numéros de téléphone sont masqués, et une question qui contient un numéro de sécurité sociale, un IBAN ou un numéro de carte bancaire est refusée. Nous n'enregistrons pas la conversation. L'assistant ne donne ni conseil médical ni conseil juridique, ne se prononce pas sur vos droits, cite ses sources et rappelle les numéros d'urgence. Base : intérêt légitime de l'exploitant à informer le public (art. 6, 1, f).";
export const LEGAL_DRAFTS_G14C_P20 = "P20 — Observatoire des droits et des services : lors de certaines recherches et consultations, le service compte, pour le jour, des codes pris dans des listes fermées et, sauf pour les sujets sensibles, la commune ; jamais votre identité, votre adresse IP, l'heure ni un texte. Sur « Ma situation », rien n'est compté si vous ne cochez pas « Aider l'Observatoire ». Les comptes du jour sont supprimés à la clôture de chaque trimestre ; les tableaux trimestriels, dans lesquels les valeurs inférieures à 5 sont masquées, sont publiés sous Licence Ouverte 2.0. Base : intérêt légitime (art. 6, 1, f).";
export const LEGAL_DRAFTS_G14C_P21 = "P21 — Mode accompagnant : à votre demande, une personne qui vous aide (un proche, un travailleur social, un conseiller France Services, un professionnel) utilise votre compte à côté de vous, pendant 2 heures au plus, avec votre accord, après que vous avez saisi votre mot de passe. Elle ne peut jamais modifier vos réglages de sécurité, supprimer le compte, faire l'export complet de vos données ni donner un nouvel accès ; Mon Coffre seulement si vous l'avez coché, et jamais pour un professionnel. Une personne de confiance à distance peut seulement demander des actions que vous confirmez, sauf si vous lui avez permis d'« agir pour moi » pour une partie de votre espace. Tout ce qui est fait est inscrit dans un journal que vous voyez. Ce mode ne remplace ni une tutelle, ni une curatelle, ni un mandat ; il est réservé aux comptes de personnes majeures. Base : votre consentement (art. 6, 1, a).";
export const LEGAL_DRAFTS_G14C_RETENTION = Object.freeze([
  ["Assistant citoyen : aucune conversation n'est enregistrée ; des compteurs techniques anonymes sont gardés 90 jours. Calcul indicatif (P18) : vos réponses ne sont pas enregistrées.", 'assistant_g14c'],
  ["Mode accompagnant : le journal de ce qui a été fait avec l'aide d'une autre personne est gardé 1 an ; votre accord suit la règle des décisions de consentement ci-dessus.", 'assisted_g14c'],
  ["Observatoire : les comptes du jour sont supprimés à la clôture du trimestre ; les tableaux trimestriels publiés ne contiennent aucune donnée personnelle.", 'observatory_g14c'],
]);
/** v12: the v10 list without « assistant » (now open) */
export const LEGAL_DRAFTS_G14C_NOT_OPEN_V12 = "Fonctions pas encore ouvertes (notamment rendez-vous, message facultatif, notifications des professionnels, membres du foyer, historique de consultation, favoris) : leurs durées seront annoncées dans cette notice avant leur ouverture. Pour les rendez-vous confirmés, tenus ou manqués, la durée envisagée est de 1 an après la date du rendez-vous, puis anonymisation.";
export const LEGAL_DRAFTS_G14C_CLOUDFLARE = "Cloudflare, Inc. (service Workers AI) : réponses de l'assistant citoyen, à partir de la question et d'extraits de fiches publiques envoyés par notre serveur. Cloudflare indique ne pas utiliser ces contenus pour entraîner des modèles et ne pas les conserver après la réponse pour une demande ordinaire.";
export const LEGAL_DRAFTS_G14C_SCALEWAY = "Scaleway SAS (France) : hébergement de notre moteur de calcul OpenFisca, à Paris ; les réponses au questionnaire n'y sont pas enregistrées.";
export const LEGAL_DRAFTS_G14C_TRANSFER = "Assistant citoyen : Cloudflare, Inc. est établie aux États-Unis. Son accord de traitement des données (version 6.4 du 3 avril 2026) prévoit les clauses contractuelles types de la Commission européenne (décision d'exécution (UE) 2021/914, module 2 : de responsable du traitement à sous-traitant), et Cloudflare déclare respecter le cadre de protection des données UE–États-Unis.";
export const LEGAL_DRAFTS_G14C_CGU_AI = Object.freeze([
  ["4. L'assistant automatique", 'title_g14c'],
  ["L'assistant automatique cherche dans les fiches vérifiées, explique et cite ses sources. Il peut se tromper. Il ne donne ni conseil médical ni conseil juridique et ne décide de rien sur vos droits ; en cas d'urgence, appelez le 112.", 'p1_g14c'],
  ["N'y écrivez pas d'information sur votre santé, un handicap, votre situation administrative ou celle d'une autre personne.", 'p2_g14c'],
]);
export const LEGAL_DRAFTS_G14C_CGU_ESTIMATE = "Les montants calculés à partir du questionnaire sont des estimations indicatives : seul l'organisme compétent décide.";
export const LEGAL_DRAFTS_G14C_CGU_ASSISTED = "Mode accompagnant : vous pouvez laisser une personne de votre choix vous aider dans votre compte, à côté de vous, pendant 2 heures au plus, après avoir saisi votre mot de passe ; elle ne peut jamais modifier votre sécurité, supprimer le compte ni donner un nouvel accès, et tout ce qu'elle fait est inscrit dans un journal que vous voyez. Ce mode ne remplace ni une tutelle, ni une curatelle, ni un mandat.";
/** v13 — professional side */
export const LEGAL_DRAFTS_G14C_P23 = "P23 — Orientation sociale vers une autre structure (hors santé) : un professionnel vous propose une orientation et vous la confirmez dans Mon Espace avec un code à usage unique. Sont traités les structures d'envoi et d'accueil, des motifs pris dans une liste fermée, l'état de l'orientation et, si vous le cochez, votre adresse électronique ou votre téléphone, que seule la structure d'accueil voit tant que l'orientation est en cours. Aucun document ni aucune information de santé. Vous pouvez retirer votre accord à tout moment. Pour la gestion de l'orientation dans la plateforme, l'exploitant et les structures sont responsables conjoints, selon l'accord décrit en section 9. Base : votre consentement (art. 6, 1, a).";
export const LEGAL_DRAFTS_G14C_P10C = "P10c — Notifications du navigateur (Web Push), si vous les activez : un court rappel chiffré passe par le service de notification de l'éditeur de votre navigateur (Apple, Google, Mozilla ou Microsoft), qui peut se trouver hors de l'Union européenne ; il ne contient ni votre nom, ni la structure, ni aucune information de santé. L'e-mail reste l'avis qui fait foi. Le fichier de calendrier (.ics) contient seulement la date, l'heure et l'adresse publique du lieu, et seulement pour un service qui n'est pas sensible. Base : votre consentement (art. 6, 1, a), retirable à tout moment.";
export const LEGAL_DRAFTS_G14C_P10B = "P10b — Rappel la veille par e-mail : consentement (art. 6, 1, a), retirable à tout moment.";
export const LEGAL_DRAFTS_G14C_PRO_RETENTION = Object.freeze([
  ["Orientations sociales : 12 mois après la clôture de l'orientation ; votre accord et son retrait suivent la règle des décisions de consentement ci-dessus.", 'socialReferrals_g14c'],
  ["Notifications du navigateur : l'abonnement est gardé jusqu'à ce que vous désactiviez les notifications ou que votre compte soit effacé ; un abonnement qui ne fonctionne plus est supprimé 30 jours après.", 'push_g14c'],
]);
export const LEGAL_DRAFTS_G14C_PUSH_TRANSFER = "Notifications du navigateur : le service de notification de l'éditeur de votre navigateur peut se trouver hors de l'Union européenne ; il ne transmet qu'un rappel chiffré, qu'il ne peut pas lire.";
/** @type {DraftSection} the new § 3 ter of the notice (v12 and v13) */
const PARTICIPATION_SECTION = Object.freeze({ id: 'participation', title: '3 ter. Fonctions de participation', titleKey: 'title_v12',
  items: [LEGAL_DRAFTS_V12_EVENTS, LEGAL_DRAFTS_V12_TESTIMONIALS, LEGAL_DRAFTS_V12_STORIES], itemKeys: { 0: 'events_v12', 1: 'testimonials_v12', 2: 'stories_v12' },
  paras: [LEGAL_DRAFTS_V12_PARTICIPATION_NOTE], paraKeys: { 0: 'p1_v12' } });
/** @type {DraftSection} the new § 13 of the notice (v12 and v13) */
const MODERATION_SECTION = Object.freeze({ id: 'moderation', title: '13. Contenus publiés, signalements et décisions de modération', titleKey: 'title_v12',
  paras: [...LEGAL_DRAFTS_V12_MODERATION], paraKeys: Object.fromEntries(LEGAL_DRAFTS_V12_MODERATION.map((_, i) => [i, `p${i + 1}_v12`])) });
/** @type {DraftSection} the new § 7 bis of the citizen terms (v12) */
const PUBLISHING_SECTION = Object.freeze({ id: 'publishing', title: '7 bis. Contenus que vous publiez', titleKey: 'title_v12',
  items: [...LEGAL_DRAFTS_V12_CGU_PUBLISHING], itemKeys: Object.fromEntries(LEGAL_DRAFTS_V12_CGU_PUBLISHING.map((_, i) => [i, `i${i + 1}_v12`])) });
const RETENTION_V12 = [[LEGAL_DRAFTS_V12_EVENTS_RETENTION, 'events_v12'], [LEGAL_DRAFTS_V12_CONTENT_RETENTION, 'content_v12'], [LEGAL_DRAFTS_V12_NOTICES_RETENTION, 'notices_v12'],
  [LEGAL_DRAFTS_V12_PROOFS_RETENTION, 'proofs_v12'], [LEGAL_DRAFTS_V12_DECISIONS_RETENTION, 'decisions_v12']];
/**
 * changes in the v9 change format, plus `addSections: { <id of the section they follow>: [section, …] }` (new sections, v12+); indexes = those of the base
 * document (cgu-citoyen v10, notice v10 for v12, notice v11 for v13)
 */
const G14C_PURPOSE_PARAS = [[LEGAL_DRAFTS_G14C_SITUATION, 'situation_g14c'], [LEGAL_DRAFTS_G14C_OFFLINE, 'offline_g14c'], [LEGAL_DRAFTS_G14C_PASSEPORT, 'passeport_g14c']];
const G14C_PURPOSE_ITEMS = [[LEGAL_DRAFTS_G14C_P18, 'p18_g14c'], [LEGAL_DRAFTS_G14C_P19, 'p19_g14c'], [LEGAL_DRAFTS_G14C_P20, 'p20_g14c'], [LEGAL_DRAFTS_G14C_P21, 'p21_g14c']];
const G14C_PROCESSORS = [[LEGAL_DRAFTS_G14C_CLOUDFLARE, 'cloudflare_g14c'], [LEGAL_DRAFTS_G14C_SCALEWAY, 'scaleway_g14c']];
/** cgu-citoyen v12 (base v10): § 3 estimate, § 4 assistant open, § 5 assisted mode, § 8 participation suspension */
const G14C_CGU_SECTIONS = {
  noDecision: { paras: { insertAfter: { 1: [[LEGAL_DRAFTS_G14C_CGU_ESTIMATE, 'estimate_g14c']] } } },
  ai: { title: LEGAL_DRAFTS_G14C_CGU_AI[0], paras: { replace: { 0: LEGAL_DRAFTS_G14C_CGU_AI[1], 1: LEGAL_DRAFTS_G14C_CGU_AI[2] } } },
  account: { items: { insertAfter: { 1: [[LEGAL_DRAFTS_G14C_CGU_ASSISTED, 'assisted_g14c']] } } },
  deletion: { paras: { insertAfter: { 2: [[LEGAL_DRAFTS_V12_CGU_SUSPENSION, 'participation_v12']] } } },
};
export const LEGAL_DRAFTS_V12_CHANGES = Object.freeze({
  'notice-confidentialite': { addSections: { 'purposes-later': [PARTICIPATION_SECTION], language: [MODERATION_SECTION] }, sections: {
    status: { paras: { insertAfter: { 0: [[LEGAL_DRAFTS_V12_STATUS_PARAGRAPH, 'expansion_v12']] } } },
    purposes: { paras: { insertAfter: { 2: G14C_PURPOSE_PARAS } }, items: { insertAfter: { 10: G14C_PURPOSE_ITEMS } } },
    retention: { items: { insertAfter: { 13: [...RETENTION_V12, ...LEGAL_DRAFTS_G14C_RETENTION] }, replace: { 14: [LEGAL_DRAFTS_G14C_NOT_OPEN_V12, 'i14_v12'] } } },
    recipients: { paras: { insertAfter: { 0: [[LEGAL_DRAFTS_V12_RECIPIENTS, 'expansion_v12']] } } },
    processors: { items: { replace: { 3: [LEGAL_DRAFTS_V12_MAILJET, 'i4_v12'] }, insertAfter: { 5: G14C_PROCESSORS } } },
    transfers: { paras: { insertAfter: { 0: [[LEGAL_DRAFTS_G14C_TRANSFER, 'cloudflare_g14c']] } } },
    rights: { paras: { insertAfter: { 0: [[LEGAL_DRAFTS_V12_RIGHTS, 'expansion_v12']] } } },
  } },
  'cgu-citoyen': { addSections: { use: [PUBLISHING_SECTION] }, sections: G14C_CGU_SECTIONS },
});
/** the § 3 bis items of notice v11 (P4 … P11), some of which move to § 3 in v13 */
const V11_LATER = /** @type {string[]} */ (/** @type {any} */ (docOf(LEGAL_DRAFT_DOCUMENTS_V11, 'notice-confidentialite').sections.find((x) => x.id === 'purposes-later')).items);
export const LEGAL_DRAFTS_V13_CHANGES = Object.freeze({
  'notice-confidentialite': { addSections: { 'purposes-later': [PARTICIPATION_SECTION], language: [MODERATION_SECTION] }, sections: {
    status: { paras: { replace: { 0: [LEGAL_DRAFTS_V13_STATUS_PARAGRAPH, 'p1_v13'] }, insertAfter: { 0: [[LEGAL_DRAFTS_V12_STATUS_PARAGRAPH, 'expansion_v12']] } } },
    // P4, P5, P7 move from § 3 bis to § 3 word for word (their translations are copied under the new keys); P11 without « (désactivé) »
    purposes: { paras: { insertAfter: { 2: G14C_PURPOSE_PARAS } }, items: { replace: { 4: [LEGAL_DRAFTS_V13_P4P, 'p4p_v13'] },
      insertAfter: { 4: [[V11_LATER[0], 'p4_v13'], [V11_LATER[1], 'p5_v13'], [V11_LATER[4], 'p7_v13'], [LEGAL_DRAFTS_V13_P11, 'p11_v13'], [LEGAL_DRAFTS_G14C_P10C, 'p10c_g14c']],
        11: [...G14C_PURPOSE_ITEMS, [LEGAL_DRAFTS_G14C_P23, 'p23_g14c']] } } },
    // P10b/P10c (§ 3 bis) becomes P10b only: the browser notifications (P10c) open with ADA Pro
    'purposes-later': { items: { remove: [0, 1, 4, 8], replace: { 7: [LEGAL_DRAFTS_G14C_P10B, 'p10b_g14c'] } } },
    retention: { items: { insertAfter: { 16: [...RETENTION_V12, ...LEGAL_DRAFTS_G14C_RETENTION, [LEGAL_DRAFTS_V13_APPOINTMENTS_RETENTION, 'appointments_v13'],
      [LEGAL_DRAFTS_V13_OUTLOOK_RETENTION, 'outlook_v13'], ...LEGAL_DRAFTS_G14C_PRO_RETENTION] },
      replace: { 17: [LEGAL_DRAFTS_V13_NOT_OPEN, 'i14_v13'] } } },
    recipients: { paras: { insertAfter: { 0: [[LEGAL_DRAFTS_V12_RECIPIENTS, 'expansion_v12']] }, replace: { 2: [LEGAL_DRAFTS_V13_RECIPIENTS, 'p2_v13'] } } },
    processors: { paras: { insertAfter: { 0: [[LEGAL_DRAFTS_V13_VIDEO_DATA, 'video_v13']] } },
      items: { replace: { 3: [LEGAL_DRAFTS_V13_MAILJET, 'i4_v13'], 4: [LEGAL_DRAFTS_V13_MICROSOFT, 'i5_v13'] }, insertAfter: { 5: [[LEGAL_DRAFTS_V13_VIDEO_PROCESSOR, 'provider_v13'], ...G14C_PROCESSORS] } } },
    transfers: { paras: { insertAfter: { 0: [[LEGAL_DRAFTS_V13_VIDEO_TRANSFER, 'video_v13'], [LEGAL_DRAFTS_G14C_TRANSFER, 'cloudflare_g14c'], [LEGAL_DRAFTS_G14C_PUSH_TRANSFER, 'push_g14c']] } } },
    rights: { paras: { insertAfter: { 0: [[LEGAL_DRAFTS_V12_RIGHTS, 'expansion_v12']] } } },
    booking: { title: ['9. Quand vous demandez un rendez-vous', 'title_v13'],
      paras: { replace: Object.fromEntries(LEGAL_DRAFTS_V13_BOOKING.map((t, i) => [i, [t, `p${i + 1}_v13`]])) } },
    art14: { paras: { replace: { 2: [LEGAL_DRAFTS_V13_PRO_ACCOUNT_PARAGRAPH, 'p3_v13'] } } },
  } },
});
/** withChanges + new sections inserted after the section they follow @param {any} changes @param {string} version @returns {(d: DraftDocument) => DraftDocument} */
const withSections = (changes, version) => (d) => {
  const doc = withChanges(changes, version)(d);
  const c = changes[d.id]; const add = c.addSections || {};
  const titled = doc.sections.map((s) => (c.sections[s.id]?.title ? { ...s, title: c.sections[s.id].title[0], titleKey: c.sections[s.id].title[1] } : s));
  return { ...doc, ...(c.intro ? { intro: c.intro[0], introKey: c.intro[1] } : {}), sections: titled.flatMap((s) => [s, ...(add[s.id] || []).map((/** @type {any} */ x) => ({ ...x, ...(x.items ? { items: [...x.items], itemKeys: { ...x.itemKeys } } : {}),
    ...(x.paras ? { paras: [...x.paras], paraKeys: { ...x.paraKeys } } : {}) }))]) };
};
/** @type {DraftDocument[]} the citizen terms (from v10) and the privacy notice (from v10: no ADA Pro text) — X04 / X01 / X02 opening */
export const LEGAL_DRAFT_DOCUMENTS_V12 = [
  withSections(LEGAL_DRAFTS_V12_CHANGES, LEGAL_DRAFTS_V12)(docOf(LEGAL_DRAFT_DOCUMENTS_V10, 'cgu-citoyen')),
  withSections(LEGAL_DRAFTS_V12_CHANGES, LEGAL_DRAFTS_V12)(docOf(LEGAL_DRAFT_DOCUMENTS_V10, 'notice-confidentialite')),
];
/** @type {DraftDocument[]} the privacy notice (from v11) — approved (23/11/2026) for the ADA Pro opening */
export const LEGAL_DRAFT_DOCUMENTS_V13 = [withSections(LEGAL_DRAFTS_V13_CHANGES, LEGAL_DRAFTS_V13)(docOf(LEGAL_DRAFT_DOCUMENTS_V11, 'notice-confidentialite'))];

/*
 * cgu-professionnel v10-2026-11-23 and conditions-structures v9-2026-11-23 — G14 (owner decision 23/11/2026): ADA Pro opens WITHOUT a pilot structure, by
 * the public sign-up of a structure verified by the operator on an official source (api/_handlers/pro/auth/register.js; verification and MFA invitation:
 * branch g14-pro, api/_services/pro-mfa-invitation.js « Vérifier et activer »), with appointments, video (8x8 JaaS) and Outlook free / busy. Only the
 * statements that the opening makes false are removed or adjusted; no new obligation (owner condition). The signed-convention precondition of the
 * appointments is dropped by owner decision. Opened with notice-confidentialite v13-2026-11-23. APPROVED by the owner on 23/11/2026 (OWNER_VALIDATED).
 *  cgu-professionnel      intro_v10 / account.i1_v10: sign-up of the structure besides the invitation; appointments.title_v10 / p1_v10: no « pas encore
 *                         ouverte »; p3_v10: video offered by the structure (8x8, see the notice); p4_v10: Outlook free / busy only; data.p1_v10: + Outlook.
 *  conditions-structures  intro_v9: appointments open, « aucune structure ne les a signées » removed; agreement.title_v9 / p1_v9: no convention, no referent;
 *                         roles.p1_v9 / p2_v9: present tense, « coordonnées » removed (the structure receives no name, address or phone: rdv.js values,
 *                         pro appointments list without citizenEmailSnapshot); commitments.i1_v9; end.p1_v9: no notice period « fixé dans la convention ».
 */
export const LEGAL_DRAFTS_PRO_V10 = 'v10-2026-11-23';
export const LEGAL_DRAFTS_PRO_V10_DOCUMENT_IDS = Object.freeze(['cgu-professionnel']);
export const LEGAL_DRAFTS_STRUCTURES_V9 = 'v9-2026-11-23';
export const LEGAL_DRAFTS_STRUCTURES_V9_DOCUMENT_IDS = Object.freeze(['conditions-structures']);
export const LEGAL_DRAFTS_PRO_V10_CHANGES = Object.freeze({
  'cgu-professionnel': { intro: ["Ces conditions s'appliquent aux professionnels qui utilisent un compte ADA Pro, créé sur invitation d'un administrateur de leur structure ou de l'exploitant, ou ouvert par l'inscription de leur structure.", 'intro_v10'], sections: {
    account: { items: { replace: { 0: ["Le compte est créé sur invitation envoyée à votre adresse électronique professionnelle par un administrateur de votre structure ou par l'exploitant (par exemple pour le premier administrateur d'une structure), ou à la suite d'une demande d'inscription de votre structure faite par vous-même, avec son nom, son numéro SIRET, votre adresse électronique professionnelle, un mot de passe et votre acceptation des présentes conditions. Dans ce cas, le compte ne donne accès à rien tant que l'exploitant n'a pas vérifié la structure sur une source officielle et activé son espace ; vous recevez alors un e-mail pour activer votre accès avec la double authentification. Si la demande est refusée, le compte est désactivé et la preuve de votre acceptation est gardée. Le compte est personnel : ne le partagez pas.", 'i1_v10'] } } },
    appointments: { title: ['4. Rendez-vous', 'title_v10'], paras: {
      replace: {
        0: ["Lorsque la prise de rendez-vous est ouverte pour votre structure, vous confirmez, proposez un autre créneau ou refusez les demandes qui vous sont adressées, dans un délai raisonnable, et vous tenez vos créneaux à jour.", 'p1_v10'],
        2: ["Si votre structure propose la visioconférence pour un rendez-vous, son traitement et son prestataire (8x8) sont décrits dans la notice de confidentialité.", 'p3_v10'],
      },
      insertAfter: { 2: [["Si vous connectez votre calendrier Outlook, seules vos plages occupées ou libres sont lues, pour ne pas proposer un créneau où vous êtes occupé ; rien n'est écrit dans votre calendrier. Vous pouvez le déconnecter à tout moment.", 'p4_v10']] },
    } },
    data: { paras: { replace: { 0: ["Pour votre compte, la plateforme traite votre adresse électronique professionnelle, votre rôle, votre structure, votre mot de passe sous forme hachée (irréversible), le secret de votre double authentification, le journal de vos actions et vos préférences de notification, ainsi que, si vous les indiquez, votre nom affiché et votre fonction. Lorsque la prise de rendez-vous est ouverte pour votre structure, elle traite aussi vos créneaux et, si vous connectez votre calendrier Outlook, les jetons de connexion chiffrés et vos plages occupées ou libres. Ces traitements reposent sur l'exécution des présentes conditions (article 6, 1, b du RGPD) et, pour la sécurité des comptes et le journal des actions, sur l'intérêt légitime de l'exploitant et de votre structure à protéger les accès (article 6, 1, f). La notice de confidentialité les décrit (section 3, P4p et P11), avec leurs durées (section 4) et la façon d'exercer vos droits (section 8).", 'p1_v10'] } } },
  } },
});
export const LEGAL_DRAFTS_STRUCTURES_V9_CHANGES = Object.freeze({
  'conditions-structures': { intro: ["Ces conditions décrivent les règles proposées aux structures (associations, services publics, établissements) qui figurent dans l'annuaire, dont l'équipe utilise des comptes ADA Pro ou qui reçoivent des demandes de rendez-vous.", 'intro_v9'], sections: {
    agreement: { title: ['2. Raccordement aux rendez-vous', 'title_v9'], paras: { replace: { 0: ["Une structure reçoit des demandes de rendez-vous lorsqu'elle a ouvert la prise de rendez-vous dans son espace ADA Pro. Le raccordement est gratuit : aucune somme n'est versée par la structure ni à la structure.", 'p1_v9'] } } },
    roles: { paras: { replace: {
      0: ["La structure est responsable de son propre traitement pour ce qu'elle reçoit (demandes et, lorsque cette fonction est ouverte, message accepté par la personne), dans ses dossiers et selon ses obligations.", 'p1_v9'],
      1: ["Pour la gestion d'une demande de rendez-vous ou d'une orientation sociale dans la plateforme, l'exploitant et la structure sont responsables conjoints (RGPD, art. 26). Leur accord est le suivant : l'exploitant fait fonctionner la plateforme et traite les demandes d'exercice des droits qui lui sont adressées par son intermédiaire ; la structure est responsable du rendez-vous ou de l'accompagnement lui-même et de ses suites en dehors de la plateforme. Les personnes peuvent exercer leurs droits auprès de l'un ou de l'autre. L'essentiel de cet accord est mis à leur disposition dans la notice de confidentialité (section 9).", 'p2_v9'],
    } } },
    commitments: { items: { replace: { 0: ['Répondre aux demandes de rendez-vous dans un délai raisonnable et tenir ses créneaux à jour.', 'i1_v9'] } } },
    end: { paras: { replace: { 0: ["Chaque partie peut mettre fin au raccordement. Les données sont ensuite traitées selon les durées indiquées dans la notice de confidentialité.", 'p1_v9'] } } },
  } },
});
/** @type {DraftDocument[]} the professional terms (from v9-2026-11-22) — ADA Pro opening */
export const LEGAL_DRAFT_DOCUMENTS_PRO_V10 = [withSections(LEGAL_DRAFTS_PRO_V10_CHANGES, LEGAL_DRAFTS_PRO_V10)(docOf(LEGAL_DRAFT_DOCUMENTS_V9_PRO, 'cgu-professionnel'))];
/** @type {DraftDocument[]} the structure conditions (from v8) — ADA Pro opening */
export const LEGAL_DRAFT_DOCUMENTS_STRUCTURES_V9 = [withSections(LEGAL_DRAFTS_STRUCTURES_V9_CHANGES, LEGAL_DRAFTS_STRUCTURES_V9)(docOf(LEGAL_DRAFT_DOCUMENTS_V8, 'conditions-structures'))];

/*
 * G14-R3 (24/11/2026, founder's yes to preparing the release-3 package) — notice-confidentialite v14-2026-11-24 and cgu-citoyen v13-2026-11-24, for the
 * opening of « Mon foyer » (C03, citizen.household), the trusted persons (C23, citizen.delegations), the minor ↔ legal guardian link in its guarded form
 * (C05, citizen.guardians: minors' own accounts stay closed, no NEW link can be declared — api/_services/guardianship.js MINOR_ACCOUNTS_CLOSED) and the
 * Académie / events (X04, community.events: its texts are already in notice v12 / v13, § 3 ter and § 4, approved on 23/11/2026 — nothing new here).
 * PROPOSED, NOT APPROVED: drafts until VITE_LEGAL_DOCS_APPROVED_VERSION names them (draftVisibility); no lawyer or expert review is claimed. Master:
 * CONTROL/master/completion/R3_HANE_VEKALET_ETKINLIK_FR.md. Facts read in the code (branch g14-r3c, from f357f6d):
 *  C03  api/_services/citizen-account.js addHouseholdMember: relation in HOUSEHOLD_RELATIONS, optional age band (AGE_BAND_KEYS), optional label ≤ 30
 *       characters, MAX_HOUSEHOLD = 12; read only when citizen.household is open; shown on /compte/profil, in the export, deleted with the account.
 *  C23  api/_services/delegation.js: invitation by e-mail (Mailjet), INVITE_DAYS = 7, DELEGATION_DURATIONS 30 / 90 / 180 / 365, scopes limited to the
 *       parts open on the service (RDV_READ with citizen.booking; PARCOURS_READ needs ADA_PARCOURS_DELEGATE_READ=on; COFFRE_LIST needs the vault — HDS,
 *       closed), roles TUTEUR / CURATEUR / REPRESENTANT stay PROOF_REQUIRED (open nothing), every view logged (DelegationAccessEvent), either side ends it.
 *  C05  guardianship.js: links are declared from a minor's account only; no strong method configured (POLICY_PENDING): a link has no effect.
 *  Durations of C23 / C05: PROPOSED (retention-policy.js DELEGATION_* / GUARDIAN_LINK_REVOKED_DAYS, pendingApproval).
 *  v14 notice  = notice v13 (in force since release 2) + § 3 P24 / P25 / P26, § 4 three items and the « not open » list without « membres du foyer »,
 *                § 5 one paragraph, § 6 Mailjet item (+ invitations of trusted persons), § 8 one paragraph.
 *  v13 cgu     = cgu-citoyen v12 + § 5 two items (Mon foyer; trusted persons — the trusted person's obligations are new) and the corrections of the
 *                statements that the release-2 opening of appointments made false (§ 5 item 1, § 6, § 7 item 3).
 */
export const LEGAL_DRAFTS_R3_NOTICE = 'v14-2026-11-24';
export const LEGAL_DRAFTS_R3_CGU = 'v13-2026-11-24';
export const LEGAL_DRAFTS_R3_NOTICE_DOCUMENT_IDS = Object.freeze(['notice-confidentialite']);
export const LEGAL_DRAFTS_R3_CGU_DOCUMENT_IDS = Object.freeze(['cgu-citoyen']);
export const LEGAL_DRAFTS_R3_STATUS = 'DRAFT — proposée le 24/11/2026, en attente de l’approbation du responsable ; à mettre en vigueur à l’ouverture de la release 3 (foyer, personnes de confiance, lien avec un représentant légal, événements)';
export const LEGAL_DRAFTS_R3_P24 = "P24 — Mon foyer : si vous le souhaitez, vous décrivez dans votre profil les personnes qui vivent avec vous, 12 au plus : pour chacune, le lien (conjoint ou partenaire, enfant, parent, frère ou sœur, autre), une tranche d'âge facultative et un nom court facultatif (30 caractères au plus). N'y indiquez ni nom complet ni information sur la santé. Ces informations ne servent qu'à vous les montrer, dans votre espace et dans la copie de vos données ; elles ne sont transmises à personne. Base : exécution des conditions d'utilisation (art. 6, 1, b) ; pour les personnes que vous décrivez, qui n'ont pas de compte, intérêt légitime (art. 6, 1, f) : vous permettre de garder la composition de votre foyer avec le minimum d'informations.";
export const LEGAL_DRAFTS_R3_P25 = "P25 — Personnes de confiance : vous pouvez inviter une personne, par son adresse électronique, à consulter en lecture seule les parties de votre espace que vous choisissez parmi celles qui sont ouvertes (à ce jour, vos rendez-vous à venir : date, heure, structure et état), pour 30, 90, 180 ou 365 jours. Sont traités : l'adresse de la personne invitée, le rôle que vous indiquez, les parties choisies, les dates et le journal de chaque consultation, que vous voyez. L'invitation lui est envoyée par e-mail avec votre adresse électronique ; elle est valable 7 jours et ne peut être acceptée que depuis un compte dont l'adresse vérifiée est celle invitée. Chacun de vous deux voit l'adresse électronique de l'autre et peut mettre fin à la délégation à tout moment. Un rôle de tuteur, de curateur ou de représentant indiqué ici n'ouvre aucun accès : une mesure de protection juridique se déclare à part (P27). Base : votre consentement (art. 6, 1, a) ; pour la personne invitée, intérêt légitime (art. 6, 1, f) à recevoir votre invitation et à y répondre.";
export const LEGAL_DRAFTS_R3_P26 = "P26 — Lien avec un représentant légal : il relie le compte d'une personne mineure au compte d'un parent ou d'un autre représentant légal. Les comptes de personnes mineures ne sont pas ouverts : aucun nouveau lien ne peut être créé. Pour un lien qui existerait déjà, sont traités les deux comptes reliés, l'état du lien et la preuve de chaque étape ; chacune des deux personnes peut le retirer à tout moment. Une confirmation par e-mail ne prouve pas l'autorité parentale ; aucune vérification renforcée n'est en place et le lien n'a aucun effet sur le compte. Base : intérêt légitime (art. 6, 1, f) : permettre à chacun de voir et de retirer un lien existant.";
/*
 * G14-R3G (24/11/2026, same release-3 package, SAME draft versions v14 / v13 — extended, not a new version): the representative of a protected adult
 * (tutelle, curatelle, habilitation familiale, mandat spécial; a relative or an MJPM), capability citizen.legal_protection. Facts read in the code (branch
 * g14-r3g): api/_services/legal-protection.js (declaration with password, verification by an administrator who examines the decision OUTSIDE the platform,
 * facts only + HMAC of the case number, powers ACT / CONFIRM by measure, areas RDV / PARCOURS, sensitive steps hidden, contest = suspension, expiry at
 * validUntil, SPECIAL_REVIEW_DAYS 365 proposed), durations PROPOSED (retention-policy.js LEGAL_PROTECTION_*, pendingApproval). Sources and analysis:
 * CONTROL/master/completion/R3_KORUMA_TEMSIL_FR.md. PROPOSED, NOT APPROVED; no lawyer or expert review is claimed.
 */
export const LEGAL_DRAFTS_R3_P27 = "P27 — Protection juridique d'un majeur : la personne qu'un juge a désignée pour protéger un adulte (tuteur, curateur, personne habilitée dans le cadre d'une habilitation familiale, mandataire spécial d'une sauvegarde de justice), qu'elle soit un proche ou un mandataire judiciaire à la protection des majeurs, peut déclarer cette décision depuis son propre compte. Sont traités : les deux comptes reliés ; la qualité du représentant (proche ou mandataire, sa forme d'exercice et, s'il les indique, le SIRET et la structure) ; les informations tirées de la décision : la mesure, représentation ou assistance, protection de la personne ou des biens, le tribunal, la date de la décision et sa date de fin ; le numéro du dossier au tribunal, s'il est donné, sous une forme chiffrée qui ne permet pas de le relire ; l'état du lien et l'enregistrement de sa vérification (date, administrateur, méthode, courte note) ; le journal de ce que le représentant consulte, demande ou fait. La décision elle-même n'est ni envoyée ni conservée par le service : un administrateur l'examine en dehors de la plateforme (original, copie délivrée par le tribunal ou confirmation du greffe) ; aucun document du tribunal n'est traité par un outil d'intelligence artificielle et aucun certificat médical n'est demandé. Avant cette vérification, la déclaration n'ouvre aucun accès ; la personne protégée la voit dans son espace et peut signaler qu'elle ne reconnaît pas le déclarant. Après vérification, et seulement jusqu'à la date de fin de la mesure, le représentant consulte les parties couvertes par la décision parmi celles qui sont ouvertes (rendez-vous à venir ; Mon Parcours, sans les étapes sensibles) ; selon la mesure, il agit dans ces parties (tutelle, habilitation familiale générale avec représentation) ou demande à la personne de confirmer chaque action (curatelle, habilitation avec assistance ou spéciale, mandat spécial). Il ne se connecte jamais à votre compte et n'accède jamais à Mon Coffre ni à la sécurité du compte. La personne protégée garde l'accès à son compte, voit tout ce qui est consulté ou fait et peut signaler à tout moment un désaccord : le lien est alors suspendu jusqu'à son examen. L'existence d'une mesure peut révéler indirectement l'état de santé d'une personne : elle n'est visible que de la personne, de son représentant et de l'administrateur. Base : intérêt légitime (art. 6, 1, f) : permettre à la personne désignée par le juge d'exercer sa mission dans le service et protéger la personne protégée contre une déclaration fausse.";
export const LEGAL_DRAFTS_R3_LP_RETENTION = Object.freeze(["Protection juridique : une déclaration jamais vérifiée est supprimée 90 jours après avoir été faite ; une déclaration refusée, 90 jours après le refus ; un lien terminé ou expiré, 12 mois après sa fin ; tout est effacé avec le compte de l'une des deux personnes. Le journal de ce que le représentant a consulté, demandé ou fait est gardé 1 an.", 'legal_protection_v14']);
export const LEGAL_DRAFTS_R3_LP_RECIPIENTS = "Si votre représentant désigné par un juge a déclaré sa mission, l'administrateur du service voit cette déclaration et vos deux adresses électroniques pour la vérifier ; une fois la décision vérifiée, votre représentant voit les parties de votre espace qu'elle couvre (section 3, P27).";
export const LEGAL_DRAFTS_R3_LP_RIGHTS = "Signaler que vous ne reconnaissez pas une personne déclarée comme votre représentant, ou que vous n'êtes pas d'accord avec ce qu'elle fait : depuis « Protection juridique », à tout moment ; le lien est suspendu jusqu'à son examen par l'administrateur.";
/** cgu-citoyen v13: § 5, the obligations of the declared representative */
export const LEGAL_DRAFTS_R3_CGU_LEGAL_PROTECTION = "Protection juridique : si un juge vous a désigné pour protéger un adulte (tutelle, curatelle, habilitation familiale, mandat spécial), vous pouvez le déclarer depuis votre propre compte. Vous ne déclarez qu'une décision qui existe, qui vous désigne et qui est en cours ; vous la montrez à l'administrateur quand il vous le demande ; vous n'utilisez l'accès que dans les limites de votre mission et dans l'intérêt de la personne, en l'informant de ce que vous faites ; vous mettez fin au lien quand votre mission se termine. Une fausse déclaration met fin au lien et peut entraîner la suspension de votre compte. Le service vérifie seulement l'existence de la décision ; il ne contrôle pas la façon dont la mesure est exercée, qui relève du juge.";
export const LEGAL_DRAFTS_R3_RETENTION = Object.freeze([
  ["Mon foyer : gardé tant que vous le gardez ; vous pouvez retirer une personne à tout moment ; effacé avec votre compte.", 'household_v14'],
  ["Personnes de confiance : une invitation restée sans réponse est supprimée, avec l'adresse invitée, 30 jours après son expiration ; une délégation terminée, refusée ou expirée est supprimée, avec le journal des consultations, 12 mois après sa fin ; tout est effacé avec votre compte.", 'delegations_v14'],
  ["Lien avec un représentant légal : un lien retiré est supprimé 30 jours après son retrait ; la preuve de chaque étape suit la règle des décisions de consentement ci-dessus.", 'guardians_v14'],
]);
export const LEGAL_DRAFTS_R3_NOT_OPEN = "Fonctions pas encore ouvertes (notamment message facultatif, rappel la veille par e-mail, orientations de dossiers entre professionnels, historique de consultation, favoris) : leurs durées seront annoncées dans cette notice avant leur ouverture.";
export const LEGAL_DRAFTS_R3_RECIPIENTS = "Une personne de confiance que vous avez invitée voit, en lecture seule et pendant la durée choisie, les parties de votre espace que vous lui avez ouvertes et votre adresse électronique (section 3, P25).";
export const LEGAL_DRAFTS_R3_MAILJET = "Mailjet (groupe Sinch) : envoi des e-mails de service (vérification de l'adresse, mot de passe, avis du compte, invitations des personnes de confiance, invitations et avis des comptes professionnels et, pour les contenus publiés, accusés de réception des signalements, décisions de modération et réponses aux contestations) ; données hébergées par Google Cloud à Francfort (Allemagne) et Saint-Ghislain (Belgique).";
export const LEGAL_DRAFTS_R3_RIGHTS = "Retirer une personne de votre foyer, mettre fin à une délégation (donnée ou reçue) ou retirer un lien avec un représentant légal : depuis votre espace, à tout moment. Le journal des consultations de chaque délégation que vous avez donnée y est visible.";
/** cgu-citoyen v13: § 5 */
export const LEGAL_DRAFTS_R3_CGU_ACCOUNT_I1 = "Un compte vous donne accès à votre espace personnel (Mon Espace). Il est nécessaire pour demander un rendez-vous.";
export const LEGAL_DRAFTS_R3_CGU_HOUSEHOLD = "Mon foyer : vous pouvez y décrire les personnes qui vivent avec vous (lien, tranche d'âge, nom court facultatif). N'indiquez que ce qui vous est utile, ni nom complet ni information sur la santé ; ces informations ne sont visibles que par vous.";
export const LEGAL_DRAFTS_R3_CGU_TRUSTED = "Personnes de confiance : vous choisissez qui vous invitez, ce que la personne peut consulter, en lecture seule, et pour combien de temps ; vous pouvez y mettre fin à tout moment. Si vous êtes la personne de confiance, vous utilisez cet accès seulement pour aider la personne qui vous l'a donné, vous ne transmettez pas ce que vous voyez sans son accord et vous y mettez fin si elle vous le demande. Une délégation ne remplace ni une tutelle, ni une curatelle, ni un mandat.";
/** cgu-citoyen v13: § 6 and § 7, the statements made false by the release-2 opening of appointments (notice v13 § 9) */
export const LEGAL_DRAFTS_R3_CGU_APPOINTMENTS = Object.freeze([
  ['6. Les rendez-vous', 'title_v13'],
  ["La demande de rendez-vous se fait depuis votre compte, auprès des structures qui l'ont ouverte.", 'p1_v13'],
  ["Selon le choix de la structure, le rendez-vous est confirmé aussitôt, ou la structure confirme, propose un autre créneau ou refuse. Elle peut aussi modifier ou annuler un rendez-vous ; vous en êtes informé dans votre espace.", 'p2_v13'],
  ["Vous pouvez annuler votre demande ou votre rendez-vous depuis votre espace. Prévenez le plus tôt possible.", 'p3_v13'],
  ["Le message joint à une demande n'est pas encore ouvert. Lorsqu'il le sera, il sera facultatif et ne sera transmis qu'avec votre accord, que vous pourrez retirer à tout moment depuis votre espace.", 'p5_v13'],
]);
export const LEGAL_DRAFTS_R3_CGU_USE_I3 = "N'utilisez pas de programme pour extraire le contenu en masse ou pour utiliser une fonction du service de façon automatisée, y compris la réservation de créneaux.";
/** indexes = those of the base documents (notice v13, cgu-citoyen v12) */
export const LEGAL_DRAFTS_R3_CHANGES = Object.freeze({
  'notice-confidentialite': { sections: {
    purposes: { items: { insertAfter: { 21: [[LEGAL_DRAFTS_R3_P24, 'p24_v14'], [LEGAL_DRAFTS_R3_P25, 'p25_v14'], [LEGAL_DRAFTS_R3_P26, 'p26_v14'], [LEGAL_DRAFTS_R3_P27, 'p27_v14']] } } },
    retention: { items: { insertAfter: { 28: [...LEGAL_DRAFTS_R3_RETENTION, LEGAL_DRAFTS_R3_LP_RETENTION] }, replace: { 29: [LEGAL_DRAFTS_R3_NOT_OPEN, 'i14_v14'] } } },
    recipients: { paras: { insertAfter: { 3: [[LEGAL_DRAFTS_R3_RECIPIENTS, 'trusted_v14'], [LEGAL_DRAFTS_R3_LP_RECIPIENTS, 'legal_protection_v14']] } } },
    processors: { items: { replace: { 3: [LEGAL_DRAFTS_R3_MAILJET, 'i4_v14'] } } },
    rights: { paras: { insertAfter: { 1: [[LEGAL_DRAFTS_R3_RIGHTS, 'r3_v14'], [LEGAL_DRAFTS_R3_LP_RIGHTS, 'legal_protection_v14']] } } },
  } },
  'cgu-citoyen': { sections: {
    account: { items: { replace: { 0: [LEGAL_DRAFTS_R3_CGU_ACCOUNT_I1, 'i1_v13'] }, insertAfter: { 2: [[LEGAL_DRAFTS_R3_CGU_HOUSEHOLD, 'household_v13'], [LEGAL_DRAFTS_R3_CGU_TRUSTED, 'trusted_v13'], [LEGAL_DRAFTS_R3_CGU_LEGAL_PROTECTION, 'legal_protection_v13']] } } },
    appointments: { title: LEGAL_DRAFTS_R3_CGU_APPOINTMENTS[0], paras: { replace: { 0: LEGAL_DRAFTS_R3_CGU_APPOINTMENTS[1], 1: LEGAL_DRAFTS_R3_CGU_APPOINTMENTS[2], 2: LEGAL_DRAFTS_R3_CGU_APPOINTMENTS[3], 4: LEGAL_DRAFTS_R3_CGU_APPOINTMENTS[4] } } },
    use: { items: { replace: { 2: [LEGAL_DRAFTS_R3_CGU_USE_I3, 'i3_v13'] } } },
  } },
});
/** @type {DraftDocument[]} the privacy notice (from v13, in force since release 2) — release-3 opening (PROPOSED) */
export const LEGAL_DRAFT_DOCUMENTS_R3_NOTICE = [withSections(LEGAL_DRAFTS_R3_CHANGES, LEGAL_DRAFTS_R3_NOTICE)(docOf(LEGAL_DRAFT_DOCUMENTS_V13, 'notice-confidentialite'))];
/** @type {DraftDocument[]} the citizen terms (from v12, in force since release 1 / 2) — release-3 opening (PROPOSED) */
export const LEGAL_DRAFT_DOCUMENTS_R3_CGU = [withSections(LEGAL_DRAFTS_R3_CHANGES, LEGAL_DRAFTS_R3_CGU)(docOf(LEGAL_DRAFT_DOCUMENTS_V12, 'cgu-citoyen'))];

/**
 * The versions, oldest first. Since v8 a version need not cover every document: LEGAL_DRAFTS_VERSION is the version shared by the citizen terms and the
 * A-I / A-II variant (v7); the structure conditions are at LEGAL_DRAFTS_V8, the privacy notice at LEGAL_DRAFTS_V9, the professional terms at LEGAL_DRAFTS_V9_PRO
 * (draft; v8 stays approvable); G14: the citizen terms and the notice at LEGAL_DRAFTS_V10 (Mon Parcours opening), the notice also at LEGAL_DRAFTS_V11 (K8); G14 expansion: the citizen terms and the notice at LEGAL_DRAFTS_V12 (X04 / X01 / X02 opening), the notice also at LEGAL_DRAFTS_V13 (ADA Pro opening, with appointments, video and Outlook), the structure conditions at LEGAL_DRAFTS_STRUCTURES_V9 and the professional terms at LEGAL_DRAFTS_PRO_V10 (same opening). LEGAL_DRAFT_DOCUMENTS = the newest draft
 * of each document (LAB preview, tests); latestDraftVersionOf(id) = its version.
 */
export const LEGAL_DRAFTS_VERSION = LEGAL_DRAFTS_V7;
export const LEGAL_DRAFT_DOCUMENTS = LEGAL_DRAFT_DOCUMENTS_V7.map((d) => LEGAL_DRAFT_DOCUMENTS_R3_NOTICE.find((x) => x.id === d.id) || LEGAL_DRAFT_DOCUMENTS_R3_CGU.find((x) => x.id === d.id) || LEGAL_DRAFT_DOCUMENTS_PRO_V10.find((x) => x.id === d.id) || LEGAL_DRAFT_DOCUMENTS_STRUCTURES_V9.find((x) => x.id === d.id) || LEGAL_DRAFT_DOCUMENTS_V13.find((x) => x.id === d.id) || LEGAL_DRAFT_DOCUMENTS_V12.find((x) => x.id === d.id) || LEGAL_DRAFT_DOCUMENTS_V11.find((x) => x.id === d.id) || LEGAL_DRAFT_DOCUMENTS_V10.find((x) => x.id === d.id) || LEGAL_DRAFT_DOCUMENTS_V9_PRO.find((x) => x.id === d.id) || LEGAL_DRAFT_DOCUMENTS_V9.find((x) => x.id === d.id) || LEGAL_DRAFT_DOCUMENTS_V8.find((x) => x.id === d.id) || d);
export const LEGAL_NOTICE_VARIANT_DOCUMENT = LEGAL_NOTICE_VARIANT_DOCUMENT_V7;
export const LEGAL_DRAFT_VERSIONS = Object.freeze([LEGAL_DRAFTS_V6, LEGAL_DRAFTS_V7, LEGAL_DRAFTS_V8, LEGAL_DRAFTS_V9, LEGAL_DRAFTS_V9_PRO, LEGAL_DRAFTS_V10, LEGAL_DRAFTS_V11, LEGAL_DRAFTS_V12, LEGAL_DRAFTS_V13, LEGAL_DRAFTS_STRUCTURES_V9, LEGAL_DRAFTS_PRO_V10,
  LEGAL_DRAFTS_R3_CGU, LEGAL_DRAFTS_R3_NOTICE]);   // G14-R3 (proposed 24/11/2026)
/** @type {Readonly<Record<string, ReadonlyArray<{ id: string, version: string, path?: string | null }>>>} */
const SETS = Object.freeze({ [LEGAL_DRAFTS_V6]: [...LEGAL_DRAFT_DOCUMENTS_V6, LEGAL_NOTICE_VARIANT_DOCUMENT_V6], [LEGAL_DRAFTS_V7]: [...LEGAL_DRAFT_DOCUMENTS_V7, LEGAL_NOTICE_VARIANT_DOCUMENT_V7],
  [LEGAL_DRAFTS_V8]: [...LEGAL_DRAFT_DOCUMENTS_V8], [LEGAL_DRAFTS_V9]: [...LEGAL_DRAFT_DOCUMENTS_V9], [LEGAL_DRAFTS_V9_PRO]: [...LEGAL_DRAFT_DOCUMENTS_V9_PRO],
  [LEGAL_DRAFTS_V10]: [...LEGAL_DRAFT_DOCUMENTS_V10], [LEGAL_DRAFTS_V11]: [...LEGAL_DRAFT_DOCUMENTS_V11],
  [LEGAL_DRAFTS_V12]: [...LEGAL_DRAFT_DOCUMENTS_V12], [LEGAL_DRAFTS_V13]: [...LEGAL_DRAFT_DOCUMENTS_V13],
  [LEGAL_DRAFTS_STRUCTURES_V9]: [...LEGAL_DRAFT_DOCUMENTS_STRUCTURES_V9], [LEGAL_DRAFTS_PRO_V10]: [...LEGAL_DRAFT_DOCUMENTS_PRO_V10],
  [LEGAL_DRAFTS_R3_CGU]: [...LEGAL_DRAFT_DOCUMENTS_R3_CGU], [LEGAL_DRAFTS_R3_NOTICE]: [...LEGAL_DRAFT_DOCUMENTS_R3_NOTICE] });

/** the newest draft of a document (whatever is approved), or null @param {string} id */
const latestDraftOf = (id) => {
  for (const v of [...LEGAL_DRAFT_VERSIONS].reverse()) { const doc = SETS[v].find((d) => d.id === id); if (doc) return doc; }
  return null;
};
/** the newest draft version of a document (the version a LAB / Preview acceptance records), or null @param {string} id */
export const latestDraftVersionOf = (id) => latestDraftOf(id)?.version ?? null;
/** does an approval token (« id@version » or a bare version) name a document version that exists? @param {string} token */
export const knownApprovalToken = (token) => LEGAL_DRAFT_VERSIONS.some((v) => token === v || SETS[v].some((d) => token === `${d.id}@${v}`));

/**
 * the translation key suffixes of a document and their French text: [« title » | « intro » | « <section>.<title|iN|pN or its versioned key> », French]
 * @param {DraftDocument} doc @returns {Array<[string, string]>}
 */
export function draftTextKeys(doc) {
  /** @type {Array<[string, string]>} */ const out = [['title', doc.title], [doc.introKey || 'intro', doc.intro]];
  for (const s of doc.sections) {
    out.push([`${s.id}.${s.titleKey || 'title'}`, s.title]);
    (s.items || []).forEach((x, i) => out.push([`${s.id}.${s.itemKeys?.[i] || `i${i + 1}`}`, x]));
    (s.paras || []).forEach((x, i) => out.push([`${s.id}.${s.paraKeys?.[i] || `p${i + 1}`}`, x]));
  }
  return out;
}

export const ALL_LEGAL_DRAFT_IDS = Object.freeze([...LEGAL_DRAFT_DOCUMENTS.map((d) => d.id), LEGAL_NOTICE_VARIANT_DOCUMENT.id]);

/** @param {unknown} v */
const clean = (v) => String(v ?? '').trim();

/**
 * Visibility of one draft for a given build.
 * @param {{ id: string, version: string }} doc
 * @param {{ approved?: string, preview?: string, production?: boolean }} ctx
 * @returns {'IN_FORCE' | 'PREVIEW' | 'HIDDEN'}
 */
export function draftVisibility(doc, ctx) {
  const tokens = clean(ctx.approved).split(',').map((s) => s.trim()).filter(Boolean);
  if (tokens.includes(`${doc.id}@${doc.version}`) || tokens.includes(doc.version)) return 'IN_FORCE';
  if (!ctx.production && clean(ctx.preview) === '1') return 'PREVIEW';
  return 'HIDDEN';
}

/** this build: VERCEL_ENV=production is injected by vite.config.js (__ADA_PRODUCTION_BUILD__); outside Vite, process.env */
export function currentDraftContext() {
  const nodeEnv = globalThis.process?.env || {};
  let approved; let preview;
  try {
    approved = import.meta.env.VITE_LEGAL_DOCS_APPROVED_VERSION;
    preview = import.meta.env.VITE_LEGAL_DRAFT_PREVIEW;
  } catch { /* not under Vite */ }
  // eslint-disable-next-line no-undef
  const injected = typeof __ADA_PRODUCTION_BUILD__ !== 'undefined' ? __ADA_PRODUCTION_BUILD__ : undefined;
  return {
    approved: approved || nodeEnv.VITE_LEGAL_DOCS_APPROVED_VERSION,
    preview: preview || nodeEnv.VITE_LEGAL_DRAFT_PREVIEW,
    production: injected !== undefined ? Boolean(injected) : nodeEnv.VERCEL_ENV === 'production',
  };
}

/**
 * The version of one document this build uses: the NEWEST approved version (IN_FORCE), else the newest draft (whose visibility is then PREVIEW or HIDDEN).
 * @param {string} id @param {{ approved?: string, preview?: string, production?: boolean }} [ctx]
 * @returns {DraftDocument | null} (the A-I / A-II variant has no sections: it is used for its id, version and visibility only)
 */
export function draftFor(id, ctx = {}) {
  for (const v of [...LEGAL_DRAFT_VERSIONS].reverse()) {
    const doc = SETS[v].find((d) => d.id === id);
    if (doc && draftVisibility(doc, ctx) === 'IN_FORCE') return /** @type {DraftDocument} */ (doc);
  }
  return /** @type {DraftDocument | null} */ (latestDraftOf(id));
}

/** the newest approved version of a document, or null @param {string} id @param {string | undefined} approved */
export function approvedVersionOf(id, approved) {
  const doc = draftFor(id, { approved, production: true });
  return doc && draftVisibility(doc, { approved, production: true }) === 'IN_FORCE' ? doc.version : null;
}

/** is the approved version of `id` at least `version` (order of LEGAL_DRAFT_VERSIONS)? @param {string} id @param {string} version @param {string | undefined} approved */
export function approvedAtLeast(id, version, approved) {
  const v = approvedVersionOf(id, approved);
  return v !== null && LEGAL_DRAFT_VERSIONS.indexOf(v) >= LEGAL_DRAFT_VERSIONS.indexOf(version) && LEGAL_DRAFT_VERSIONS.includes(version);
}

/** @param {string} path @param {{ approved?: string, preview?: string, production?: boolean }} [ctx] the build context (default: the newest draft) */
export function draftByPath(path, ctx) {
  const latest = LEGAL_DRAFT_DOCUMENTS.find((d) => d.path === path);
  return latest ? (ctx ? draftFor(latest.id, ctx) : latest) : null;
}
