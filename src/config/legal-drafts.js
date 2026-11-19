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
 * referrals, dossiers, appointments, messages and the assistant CLOSED). v8 exists for the TWO professional documents only (LEGAL_DRAFTS_V8_DOCUMENT_IDS):
 * the citizen terms, the privacy notice and the A-I / A-II variant stay at v7 (no v8 of them exists, so « cgu-citoyen@v8-… » approves nothing). v8 = v7
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
export const LEGAL_DRAFTS_V8_DOCUMENT_IDS = Object.freeze(['cgu-professionnel', 'conditions-structures']);
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
      0: ["Pour votre compte, la plateforme traite votre adresse électronique professionnelle, votre rôle, votre structure, votre mot de passe chiffré, le secret de votre double authentification, le journal de vos actions et vos préférences de notification. Lorsque la prise de rendez-vous est ouverte pour votre structure, elle traite aussi vos créneaux. La notice de confidentialité décrit ces traitements, leurs bases légales proposées et leurs durées.", 'p1_v8'],
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
});
/**
 * @param {Record<number, string[]> | undefined} ch @param {string[] | undefined} list @param {Record<number, string> | undefined} keys
 * @returns {[string[] | undefined, Record<number, string> | undefined]}
 */
const applyV8 = (ch, list, keys) => (ch && list
  ? [list.map((x, i) => (ch[i] ? ch[i][0] : x)), { ...(keys || {}), ...Object.fromEntries(Object.entries(ch).map(([i, a]) => [Number(i), a[1]])) }]
  : [list, keys]);
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
/** @type {DraftDocument[]} the two professional documents only */
export const LEGAL_DRAFT_DOCUMENTS_V8 = LEGAL_DRAFT_DOCUMENTS_V7.filter((d) => LEGAL_DRAFTS_V8_DOCUMENT_IDS.includes(d.id)).map(toV8);

/**
 * The versions, oldest first. Since v8 a version need not cover every document: LEGAL_DRAFTS_VERSION is the version shared by the citizen terms, the privacy
 * notice and the A-I / A-II variant (v7); the professional documents are at LEGAL_DRAFTS_V8. LEGAL_DRAFT_DOCUMENTS = the newest draft of each document
 * (LAB preview, tests); latestDraftVersionOf(id) = its version.
 */
export const LEGAL_DRAFTS_VERSION = LEGAL_DRAFTS_V7;
export const LEGAL_DRAFT_DOCUMENTS = LEGAL_DRAFT_DOCUMENTS_V7.map((d) => LEGAL_DRAFT_DOCUMENTS_V8.find((x) => x.id === d.id) || d);
export const LEGAL_NOTICE_VARIANT_DOCUMENT = LEGAL_NOTICE_VARIANT_DOCUMENT_V7;
export const LEGAL_DRAFT_VERSIONS = Object.freeze([LEGAL_DRAFTS_V6, LEGAL_DRAFTS_V7, LEGAL_DRAFTS_V8]);
/** @type {Readonly<Record<string, ReadonlyArray<{ id: string, version: string, path?: string | null }>>>} */
const SETS = Object.freeze({ [LEGAL_DRAFTS_V6]: [...LEGAL_DRAFT_DOCUMENTS_V6, LEGAL_NOTICE_VARIANT_DOCUMENT_V6], [LEGAL_DRAFTS_V7]: [...LEGAL_DRAFT_DOCUMENTS_V7, LEGAL_NOTICE_VARIANT_DOCUMENT_V7],
  [LEGAL_DRAFTS_V8]: [...LEGAL_DRAFT_DOCUMENTS_V8] });

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
