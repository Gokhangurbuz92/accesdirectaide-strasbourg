/**
 * R45 / ENG-LR-6 — capability registry and server-side capability gates (CONTROL/r45/R45_CAPABILITY_GATES_EN.md).
 *
 * The AIPD (CONTROL/r44/R44_AIPD_VERSION_REVUE_FINALE_FR.md § 2.1, condition C-PER, measure P-7) covers, for the first opening only: sign-up,
 * authentication, appointment search and booking, the optional message, assignment, notifications, Outlook busy/free, audit, rights, logs and
 * backups, purge. Everything else stays CLOSED until the AIPD is extended — and, for a capability that may host health data, until certified
 * health-data hosting (HDS) exists. Closed is not removed: every handler stays in the code and in the 173-feature scope.
 *
 * Opening rule (fail-closed, exact names, no wildcard):
 *   in-AIPD capability   open when its surface is open (during the restricted beta: ADA_BETA_OPEN_SURFACES; outside the beta: always)
 *   out-of-AIPD          ALSO needs ADA_CAPABILITIES_OPEN to name it (comma list; an unknown name opens nothing)
 *   requiresHds          ALSO needs ADA_HDS_CERTIFIED_HOSTING to hold a well-formed, unexpired attestation token (HDS_TOKEN_FORMAT below)
 *   openable: false      never opens (no switch)
 *
 * Enforcement (lead decision R45, binding): ON when the restricted beta is on, OR VERCEL_ENV is production / preview, OR ADA_CAPABILITY_ENFORCEMENT=1.
 * It is OFF only in development / test without any of these (the LAB runs the full product). No value turns it off in production or preview.
 *
 * `requiresHds` follows the HDS feature matrix (CONTROL/r45/R45_HDS_FEATURE_MATRIX_FR.md § 3, [PROPOSITION] [REVUE JURIDIQUE]): HDS applicability depends on
 * where the data come from and on whose behalf they are hosted; the ANS reads « suivi social et médico-social » as the follow-up of an ESSMS (CASF L312-1).
 * Vault = HDS (the ANS example); shared dossiers and referrals probable; ProCase notes yes for an ESSMS (`hdsDependsOnStructure`: HDS is waived only for a
 * structure positively classified NOT_ESSMS — an unknown category fails closed, and no reviewed classification table exists yet, matrix § 5.5 step 1);
 * saved diagnostic uncertain, leaning no (it stays closed anyway: outside the AIPD). There is no platform-wide « HDS everything » switch. A token is a
 * statement recorded by the controller that a certificate exists, not a verification of it.
 */
import { accountsExtraCapabilities, accountsScope, isPublicBetaRestricted, openSurfaces } from './public-beta.js';
import { HDS_SERVICE_CAPABILITIES, hdsGatewayState, hdsModuleReady, hdsServiceRoute, isDeployed, sendHdsServiceRefusal } from './hds-gateway.js';

export const CAPABILITY_NOT_OPEN = 'CAPABILITY_NOT_OPEN';
export const CAPABILITY_NOT_OPEN_MESSAGE = 'Cette fonction n’est pas encore ouverte : elle sera disponible lorsque son analyse d’impact sur la protection des données '
  + '(et, si nécessaire, un hébergement certifié des données de santé) sera en place. Aucune donnée n’a été lue ni enregistrée.';

const M = 'R45_HDS_FEATURE_MATRIX_FR.md § 3';

/**
 * @typedef {{ description: string, aipd: 'in' | 'out', requiresHds: boolean, hdsDependsOnStructure?: boolean, hdsCheckedPerRecord?: boolean, hdsNote?: string, surface: string, accountsFull?: boolean,
 *   openable?: boolean, aipdRef: string }} Capability
 */
/** @type {Readonly<Record<string, Capability>>} */
export const CAPABILITIES = Object.freeze({
  // ── inside the AIPD (first opening)
  'citizen.account': { description: 'citizen sign-up, sign-in, verification, password, sign-out, deletion, export, profile, adult statement, contact rectification, e-mail preferences, restriction, Mon Espace summary',
    aipd: 'in', requiresHds: false, surface: 'accounts', aipdRef: 'P2 P3 P13' },
  'citizen.booking': { description: 'appointment search, booking, rescheduling, cancellation, the person’s own appointments', aipd: 'in', requiresHds: false, surface: 'appointments', aipdRef: 'P4 P5' },
  'citizen.booking_message': { description: 'the optional short message of a booking and the message state of the account', aipd: 'in', requiresHds: false, surface: 'appointments', aipdRef: 'P6' },
  'citizen.push': { description: 'Web Push notifications on the person’s device (C-PER: part of the full accounts scope)', aipd: 'in', requiresHds: false, surface: 'accounts', accountsFull: true, aipdRef: 'P10' },
  'pro.account': { description: 'professional sign-in, MFA (invitation-bound), profile, notifications, own audit trail', aipd: 'in', requiresHds: false, surface: 'pro', aipdRef: 'P3 P10 P12' },
  'pro.structure_admin': { description: 'team, invitations, structure record, aggregate statistics of the structure', aipd: 'in', requiresHds: false, surface: 'pro', aipdRef: 'P7 P12' },
  'pro.agenda': { description: 'opening hours, slots, time off, booking settings, services, the structure’s appointments and their assignment', aipd: 'in', requiresHds: false, surface: 'appointments', aipdRef: 'P5 P7' },
  'pro.platform_ops': { description: 'technical health and maintenance counters of the professional console (no personal data returned)', aipd: 'in', requiresHds: false, surface: 'pro', aipdRef: 'P14' },
  'calendar.outlook': { description: 'Outlook busy/free of a professional (its own OUTLOOK_ENABLED / CALENDAR_PRODUCTION_APPROVED switches still apply)', aipd: 'in', requiresHds: false, surface: 'appointments', aipdRef: 'P11' },
  // ── outside the AIPD: closed until the AIPD is extended (C-PER)
  'citizen.household': { description: 'household members of the account (C03)', aipd: 'out', requiresHds: false, hdsNote: `${M} row 2 (ordinary account): no`, surface: 'accounts', accountsFull: true, aipdRef: 'C-PER' },
  'citizen.guardians': { description: 'minor ↔ legal guardian link (C05); minors’ independent accounts stay closed', aipd: 'out', requiresHds: false, hdsNote: `${M} row 2 (ordinary account): no`, surface: 'accounts', accountsFull: true, aipdRef: 'C-PER' },
  'citizen.parcours': { description: 'Mon Parcours: the person’s own tracking of démarches and deadlines (C07 C12)', aipd: 'out', requiresHds: false, hdsNote: `not a matrix row; self-tracking, not care or ESSMS follow-up: no (art. 9 may apply)`, surface: 'accounts', accountsFull: true, aipdRef: 'C-PER' },
  'citizen.favorites': { description: 'kept records (C10)', aipd: 'out', requiresHds: false, surface: 'accounts', accountsFull: true, aipdRef: 'C-PER' },
  'citizen.history': { description: 'opt-in consultation history (C11)', aipd: 'out', requiresHds: false, surface: 'accounts', accountsFull: true, aipdRef: 'C-PER' },
  'citizen.franceconnect': { description: 'FranceConnect sign-in and account link (N08 / C26: OIDC adapter; needs the DataPass habilitation and FRANCECONNECT_PRODUCTION_APPROVED)',
    aipd: 'out', requiresHds: false, surface: 'accounts', aipdRef: 'C-PER' },
  'citizen.delegations': { description: 'trusted persons with read-only access', aipd: 'out', requiresHds: false, hdsNote: `${M} row 2 (ordinary account): no`, surface: 'accounts', accountsFull: true, aipdRef: 'C-PER' },
  // G14-R3G (owner 24/11/2026, release-3 package): the representative of a protected adult (tutelle, curatelle, habilitation familiale, mandat spécial;
  // a relative or an MJPM). Effective only after an administrator examined the court decision outside the platform; never Mon Coffre (HDS), never the
  // account's security. Needs notice v14 / cgu v13 in force (preflight legal.r3_legal_protection) and migration 0064 (pending: answers « not installed »).
  'citizen.legal_protection': { description: 'representative of a protected adult under a verified court measure (tutelle, curatelle, habilitation familiale, mandat spécial)',
    aipd: 'out', requiresHds: false, hdsNote: `${M} row 2 (ordinary account): no — the decision is never stored; sensitive steps stay hidden; the vault is never reachable`, surface: 'accounts', accountsFull: true, aipdRef: 'C-PER' },
  // G14-AID (owner 23/11/2026): « mode accompagnant » — a helper acts WITH the person: next to them on their own signed-in device (password + consent, ≤ 2 h,
  // the areas they chose, never the account's security) and, together with citizen.delegations, a trusted person's action requests confirmed one by one by
  // the person (or « agir pour moi » for one part). HDS-gated parts stay unreachable to a professional helper (api/_services/assisted-mode.js).
  'citizen.assisted_mode': { description: 'assisted mode: a helper next to the person (password + consent, ≤ 2 h, chosen areas) and confirmed action requests of a trusted person',
    aipd: 'out', requiresHds: false, hdsNote: `${M} row 2 (ordinary account): no — the vault (HDS) is never opened to a professional helper`, surface: 'accounts', accountsFull: true, aipdRef: 'C-PER' },
  'citizen.orientation_records': { description: 'the person’s orientations / referral proposals', aipd: 'out', requiresHds: true, hdsNote: `${M} row 10: yes for medical pieces, probable to / from an ESSMS — closed until HDS`, surface: 'accounts', accountsFull: true, aipdRef: 'P8' },
  'citizen.vault': { description: 'Mon Coffre: the person’s encrypted documents (C09)', aipd: 'out', requiresHds: true, hdsNote: `${M} row 8: yes (ANS example of hosting on behalf of the patient)`, surface: 'documents', aipdRef: 'AIPD § 2.1 « coffre »' },
  'citizen.shared_dossier': { description: 'dossiers shared with organisations, their grants, files, passport, downloads and the professional side (consent, attestation, export)', aipd: 'out', requiresHds: true, hdsNote: `${M} row 7: probable once the dossier serves an ESSMS or holds medical pieces — closed until HDS`, surface: 'documents', aipdRef: 'P9' },
  'citizen.saved_diagnostic': { description: 'saving the results of the questionnaire / rights estimate as a dossier', aipd: 'out', requiresHds: false, hdsNote: `${M} row 11: uncertain, leaning no — stays closed (outside the AIPD) until counsel decides`, surface: 'diagnostic', aipdRef: 'AIPD § 2.1 « questionnaire / estimation »' },
  'diagnostic.questionnaire': { description: 'the questionnaire / rights estimate computation itself', aipd: 'out', requiresHds: false, hdsNote: `${M} row 11 / § 5.1: no while health answers are not stored`, surface: 'diagnostic', aipdRef: 'AIPD § 2.1 « questionnaire / estimation »' },
  'pro.case_management': { description: 'ProCase follow-up, notes, history, members (R03–R11)', aipd: 'out', requiresHds: true, hdsDependsOnStructure: true, hdsNote: `${M} row 9: yes / probable for an ESSMS (L312-1); not under L1111-8 for a non-ESSMS — unknown category fails closed`, surface: 'pro', aipdRef: 'P9' },
  'pro.referrals': { description: 'referrals between organisations (R09 R10 E06)', aipd: 'out', requiresHds: true, hdsNote: `${M} row 10: yes / probable — closed until HDS`, surface: 'pro', aipdRef: 'P8' },
  'pro.orientation_selections': { description: 'orientation baskets of an organisation (R18)', aipd: 'out', requiresHds: false, hdsNote: `not a matrix row; selections of public catalogue records: no`, surface: 'pro', aipdRef: 'P8' },
  // FA-D7: the signed adapter to a partner organization's OWN tool (ada.partner-referral/1): referral states out, the receiver's answers in — no partner exists
  'partner.referral_adapter': { description: 'partner referral adapter: signed referral events to a connected organization’s own tool and its signed answers (api/_services/partner-adapter.js); needs a partner agreement and ADA_PARTNER_ADAPTERS',
    aipd: 'out', requiresHds: true, hdsNote: `${M} row 10 (referrals): yes / probable — closed until HDS`, surface: 'pro', aipdRef: 'P8' },
  'pro.siao_interop': { description: 'SI-SIAO interoperability export of a dossier', aipd: 'out', requiresHds: true, hdsNote: `${M} rows 7 and 10 (dossier of an orientation): probable`, surface: 'pro', aipdRef: 'AIPD § 2.1 « SIAO »' },
  'ai.processing': { description: 'assistant, AI recommendations, FALC summaries, AI discovery agents, AI dossier synthesis', aipd: 'out', requiresHds: false, hdsNote: `not a matrix row: no (the AI policy and art. 9 apply separately)`, surface: 'diagnostic', aipdRef: 'AIPD § 2.1 « assistant »' },
  // G14-AI (owner 23/11/2026): the citizen assistant ALONE (POST assistant/chat), answered by Cloudflare Workers AI (processor Cloudflare, Inc., US) from verified
  // public fiches. Its own surface « assistant » and its own name: opening it opens neither ai.processing (recommendations, FALC, agents, pro synthesis)
  // nor the diagnostic. Needs ADA_BETA_OPEN_SURFACES=assistant (during the beta) AND this name in ADA_CAPABILITIES_OPEN (AIPD line « assistant » signed).
  'ai.citizen_assistant': { description: 'citizen assistant (assistant/chat): grounded answers from verified public fiches by the approved AI provider (AI_PROVIDER, api/lib/ai-policy.js); no account, no conversation stored',
    aipd: 'out', requiresHds: false, hdsNote: 'not a matrix row: no (no dossier, no follow-up; medical questions are refused, art. 9 data are not asked)', surface: 'assistant', aipdRef: 'AIPD § 2.1 « assistant » (Workers AI line to sign)' },
  // R3 (24/11/2026, owner « messaging complete and ready in Production »): the two-way conversation between a person and the structure of ONE of their
  // appointments (RdvConversation*: citizen « Mes messages », ADA Pro « Messages », the appointment's message tab). Outside the AIPD (P6 covers only the
  // optional booking message). HDS: R44 AIPD § 11.5 and R45 matrix row 5 — free text is « probable » HDS in scenario O (ESSMS or health structure) or
  // when the service itself reveals health (art. 9). So the HDS need depends on the conversation: waived ONLY when the structure is positively
  // classified NOT_ESSMS by the reviewed rule of the social referral (api/lib/social-referral-policy.js) AND the appointment's service is reviewed
  // « ordinary » (api/lib/service-sensitivity.js); anything else (ESSMS, health, unknown kind, sensitive or unreviewed service) needs the HDS attestation.
  // The route gate assumes the best case (`hdsCheckedPerRecord`); the handlers re-check every conversation (api/_services/messaging-policy.js).
  'messaging.conversations': { description: 'appointment conversations between a person and the structure of their appointment (text, notifications, read state)',
    aipd: 'out', requiresHds: true, hdsDependsOnStructure: true, hdsCheckedPerRecord: true,
    hdsNote: `${M} row 5 / R44 § 11.5: free text — HDS waived only for a NOT_ESSMS structure and an ordinary service; otherwise closed until HDS`, surface: 'communications', aipdRef: 'AIPD § 2.1 « messagerie » (line to sign)' },
  // R3: a file attached to a conversation message (PDF / image) can be a medical document whatever the structure: it stays closed until certified HDS
  // hosting exists, even when messaging.conversations is open for a NOT_ESSMS structure.
  'messaging.attachments': { description: 'one PDF / PNG / JPEG file attached to a conversation message (encrypted object storage)',
    aipd: 'out', requiresHds: true, hdsNote: `${M} rows 5 and 8: a file can be a medical document — closed until HDS, whatever the structure`, surface: 'communications', aipdRef: 'AIPD § 2.1 « messagerie » (line to sign)' },
  'institution.portal': { description: 'territory / institution space and the creation of institution accounts', aipd: 'out', requiresHds: false, surface: 'institution', aipdRef: 'AIPD § 2.1 « institution »' },
  video: { description: 'video appointments: offering the VIDEO modality, consent, approval, joining (its own VIDEO_* switches still apply)', aipd: 'out', requiresHds: false, hdsNote: `not a matrix row: no (transient stream, no recording)`, surface: 'video', aipdRef: 'AIPD § 2.1 « visio »' },
  // X04 (EXPANSION, founder 19/11/2026 — not one of the 173): academy pages and events, the registration of a signed-in adult citizen (optional closed-list
  // accessibility need), cancellation, in-app reminder, the editorial side (admin, MFA writes). A new personal-data processing: outside the AIPD until its
  // own AIPD line is signed (CONTROL/master/completion/G4_X04_ACADEMY_EVENTS_2026-11-19.md), on its own surface « events » that nothing opens.
  'community.events': { description: 'academy pages and public events (X04 expansion): public reading, registration of a signed-in adult citizen, cancellation, in-app reminder, editorial administration',
    aipd: 'out', requiresHds: false, hdsNote: 'not a matrix row: no (an accessibility need from a closed list, no care or ESSMS follow-up; art. 9 may apply — explicit choice)', surface: 'events', aipdRef: 'X04 (AIPD line to sign)' },
  // X02 (EXPANSION, founder 19/11/2026 — not one of the 173): testimonials of signed-in adult citizens with explicit consent (ConsentLog), withdrawal at any
  // time (text erased), moderation (admin, MFA, audited), reports of abuse by signed-in citizens. A new personal-data processing: outside the AIPD until its
  // own AIPD line is signed (CONTROL/master/completion/G5_X02_TESTIMONIALS_2026-11-19.md), on its own surface « testimonials » that nothing opens.
  'community.testimonials': { description: 'testimonials (X02 expansion): public reading of moderated testimonials, submission with consent and withdrawal by a signed-in adult citizen, reports, moderation',
    aipd: 'out', requiresHds: false, hdsNote: 'not a matrix row: no (free text written by the person, health detail discouraged and moderated out; no care follow-up)', surface: 'testimonials', aipdRef: 'X02 (AIPD line to sign)' },
  // X01 (EXPANSION, founder 19/11/2026 — not one of the 173): community stories under a PSEUDONYMOUS principal (CommunityMember, R47 § 8) of signed-in adult
  // citizens, explicit consent per story (ConsentLog), withdrawal at any time (text erased), moderation (admin, MFA, audited), reports of abuse, takedown.
  // A new personal-data processing: outside the AIPD until its own AIPD line is signed (CONTROL/master/completion/G6_X01_COMMUNITY_2026-11-19.md), on its own
  // surface « stories » that nothing opens.
  'community.stories': { description: 'community stories (X01 expansion): public reading of moderated stories under a pseudonym, joining / posting / withdrawal by a signed-in adult citizen, reports, moderation and takedown',
    aipd: 'out', requiresHds: false, hdsNote: 'not a matrix row: no (free text written by the person under a pseudonym, health detail discouraged and moderated out; no care follow-up)', surface: 'stories', aipdRef: 'X01 (AIPD line to sign)' },
  // X05 (EXPANSION, founder 19/11/2026 — not one of the 173): the inclusive job board — listings of employers ADA verified (E01), written by a STRUCTURE_ADMIN,
  // moderated (admin, MFA, audited), published until their end date. Applicants apply through the employer's own channel: ADA stores nothing about them.
  // Outside the AIPD until its own AIPD line is signed (CONTROL/master/completion/G6_X05_JOB_BOARD_2026-11-19.md), on its own surface « employment » that nothing opens.
  'community.employment': { description: 'inclusive job board (X05 expansion): public reading of moderated listings of verified employers, listings written by a structure administrator, moderation and takedown; no applicant data',
    aipd: 'out', requiresHds: false, hdsNote: 'not a matrix row: no (organization listings; no applicant data is received or stored)', surface: 'employment', aipdRef: 'X05 (AIPD line to sign)' },
  // X03 (EXPANSION, founder 19/11/2026 — not one of the 173): ENTRAIDE, peer support between adults under a PSEUDONYMOUS principal of its own (EntraideMember),
  // closed lists of practical help categories and coarse areas, anonymous offers browsed by the person (no score, no automatic matching), double opt-in, e-mail
  // shown only after mutual acceptance (explicit, revocable), charter (ConsentLog), reports, blocks, moderation (admin, MFA, audited) able to suspend.
  // ⚠ AIPD GUARD: matching people on their needs is a SENSITIVE INFERENCE — a DEDICATED AIPD (draft: CONTROL/master/completion/G6_X03_ENTRAIDE_2026-11-19.md
  // § 3) MUST be signed by the controller BEFORE ANY OPENING, together with the charter text and the safeguarding policy. Until then: outside the AIPD, on its
  // own surface « entraide » that nothing opens; never add it to an opening list, a simulator final state or a release configuration.
  'community.entraide': { description: 'Entraide (X03 expansion): peer support between signed-in adults under a pseudonym — anonymous offers in closed categories and areas, double opt-in, e-mail shown only after mutual acceptance, reports, blocks, moderation and suspension',
    aipd: 'out', requiresHds: false, hdsNote: 'not a matrix row: no (practical help only; no health, disability or other sensitive category exists; logistics note with a health warning)', surface: 'entraide', aipdRef: 'X03 (DEDICATED AIPD mandatory before any opening)' },
  // G14-PS (owner decision 23/11/2026: « we do not host health data and we pay nothing ») — the SOCIAL referral: closed reasons (no health, disability,
  // sexual life, penal, residence, violence, child or legal protection code), no free text, no document, only between organisations classified NOT_ESSMS
  // (no FINESS registration, reviewed non-medical kind: api/lib/social-referral-policy.js), with the person's consent (Mon Espace, or on the professional's
  // screen with re-authentication) and withdrawal at any time. NO HDS: it hosts no health data and serves no ESSMS follow-up by construction — the HDS
  // referral of a dossier (`pro.referrals`) stays closed. A new processing: outside the AIPD until its line is signed, on its own surface « social_referrals ».
  'pro.referrals_social': { description: 'social referrals (G14-PS): closed-list reasons, no free text or document, between NOT_ESSMS verified organisations, consent and withdrawal by the person, statuses for both organisations',
    aipd: 'out', requiresHds: false, hdsNote: 'not a matrix row 10 referral: no health data by construction (closed non-health reasons, no text, no document) and no ESSMS party (FINESS-registered or unreviewed kinds refused)', surface: 'social_referrals', aipdRef: 'G14-PS (AIPD line to sign)' },
  // ── never opened by a switch
  'citizen.minor_accounts': { description: 'independent accounts of minors (closed by the age policy; R42-A07)', aipd: 'out', requiresHds: false, surface: 'accounts', openable: false, aipdRef: 'AIPD § 2.2' },
});

/**
 * Route → capabilities (ALL must be open). Longest prefix wins, like the surfaces of public-beta.js. A route of no entry is not gated by this layer (public
 * information, administration, jobs, the public forms of communications): the surface gate and its own checks still apply. tests/unit/r45-capability-gates.test.js requires
 * every route of the accounts, appointments, pro, documents, diagnostic, institution and video surfaces to be listed here.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const ROUTE_CAPABILITIES = Object.freeze({
  // accounts
  auth: ['citizen.account'], 'login-pro-guard': ['citizen.account'], 'auth/franceconnect': ['citizen.account', 'citizen.franceconnect'],
  // R47: the status line answers { available:false, reason } itself when citizen.franceconnect is closed (no 503 noise on every sign-in page)
  'auth/franceconnect/status': ['citizen.account'],
  // G-3 (07/11/2026, V1a): « auth/me » is the identity probe of EVERY session kind (administrator, professional, citizen). Gating it on citizen.account
  // refused the administrator console whenever « accounts » is closed (503 before the handler, shown as an outage). The route itself is not gated here;
  // the handler answers each session kind only when ITS surface / capability is open (admin surface, pro.account, citizen.account) — otherwise 401.
  'auth/me': [],
  'citizen/profile': ['citizen.account'], 'citizen/age-declaration': ['citizen.account'], 'citizen/email-change': ['citizen.account'],
  'citizen/email-change-confirm': ['citizen.account'], 'citizen/phone': ['citizen.account'], 'citizen/preferences': ['citizen.account'],
  'citizen/restriction': ['citizen.account'], 'citizen/espace': ['citizen.account'], 'citizen/notifications': ['citizen.account'],
  'citizen/push': ['citizen.push'], 'citizen/household': ['citizen.household'], 'citizen/guardians': ['citizen.guardians'],
  'citizen/parcours': ['citizen.parcours'], 'citizen/favorites': ['citizen.favorites'], 'citizen/history': ['citizen.history'],
  // G14: my moderation decisions and appeals — the account capability; the handler also answers 503 unless a content capability is open
  'citizen/moderation': ['citizen.account'],
  'citizen/delegations': ['citizen.delegations'], 'citizen/referrals': ['citizen.orientation_records'], 'citizen/shares': ['citizen.shared_dossier'],
  // G14-AID: the assisted session of the person (start with password + consent, end, history) — and the professional's one-time helper code
  'citizen/assist': ['citizen.assisted_mode'],
  // G14-R3G: both sides of the legal-protection link, and the administrator's verification queue
  'citizen/legal-protection': ['citizen.legal_protection'], 'admin/legal-protection': ['citizen.legal_protection'],
  // appointments
  rdv: ['citizen.booking'], 'auth/callback/outlook': ['calendar.outlook'],
  'pro/slots': ['pro.agenda'], 'pro/availability': ['pro.agenda'], 'pro/timeoff': ['pro.agenda'], 'pro/rdv': ['pro.agenda'], 'pro/appointments': ['pro.agenda'],
  'pro/outlook': ['calendar.outlook'], 'pro/services': ['pro.agenda'],
  // pro
  'pro/auth': ['pro.account'], 'pro/me': ['pro.account'], 'pro/profile': ['pro.account'], 'pro/mfa-setup': ['pro.account'], 'pro/mfa-enrolment': ['pro.account'], 'pro/mfa-invitation': ['pro.account'],
  'pro/notifications': ['pro.account'], 'pro/audit': ['pro.account'],
  'pro/assist-code': ['pro.account', 'citizen.assisted_mode'],
  'pro/team': ['pro.structure_admin'], 'pro/regional-stats': ['pro.structure_admin'], 'pro/invite': ['pro.structure_admin'], 'pro/resend-invite': ['pro.structure_admin'],
  'pro/structure': ['pro.structure_admin'], 'pro/reports': ['pro.structure_admin'],
  'pro/health-check': ['pro.platform_ops'], 'pro/system-maintenance': ['pro.platform_ops'],
  'pro/cases': ['pro.case_management'], 'pro/referrals': ['pro.referrals'], 'pro/selections': ['pro.orientation_selections'],
  'pro/consent': ['citizen.shared_dossier'], 'pro/attestation-data': ['citizen.shared_dossier'],
  'pro/interop-siao': ['pro.siao_interop', 'citizen.shared_dossier'],
  // FA-D7: the partner's signed answers apply referral steps (refused 503 before the handler while closed)
  'monitor/partner': ['partner.referral_adapter', 'pro.referrals'],
  'pro/dossier-synthesis': ['ai.processing', 'citizen.shared_dossier'],
  'pro/agent-discovery': ['ai.processing'], 'pro/agent-scheduler': ['ai.processing'],
  // documents
  // G14-R3: the single-use ticket for the HDS service — the handler checks the capability it is asked for (citizen.vault | citizen.shared_dossier)
  'citizen/hds-ticket': [],
  'citizen/coffre': ['citizen.vault'], 'citizen/dossier': ['citizen.shared_dossier'], 'pro/dossier': ['citizen.shared_dossier'],
  share: ['citizen.shared_dossier'], 'share/create': ['citizen.saved_diagnostic', 'citizen.shared_dossier'],
  'public/dossier-revoke': ['citizen.shared_dossier'], 'public/dossier-grants': ['citizen.shared_dossier'], 'public/passport': ['citizen.shared_dossier'],
  download: ['citizen.shared_dossier'],
  // diagnostic / AI
  diagnostic: ['diagnostic.questionnaire'], assistant: ['ai.processing'], 'assistant/chat': ['ai.citizen_assistant'], 'public/assistant': ['ai.processing'], 'public/falc': ['ai.processing'],
  // institution, video
  'admin/guardianships': ['citizen.guardians'],   // R46 / C05 verifier side
  institution: ['institution.portal'], 'admin/institutions': ['institution.portal'],
  // R3 messaging: every conversation route (citizen, professional, the appointment's message tab, the legacy secure-messages thread of an appointment);
  // the handlers re-check each conversation (structure NOT_ESSMS + ordinary service, or HDS) and the attachments (messaging.attachments)
  messages: ['messaging.conversations'], 'pro/messages': ['messaging.conversations'], 'secure-messages': ['messaging.conversations'],
  // the file of a message (download), keyed without its ids like the visio route below: refused at the route while attachments are closed
  'messages/attachments': ['messaging.conversations', 'messaging.attachments'], 'pro/messages/attachments': ['messaging.conversations', 'messaging.attachments'],
  'pro/appointments/visio': ['video'], 'rdv/appointments/visio': ['video'],
  // X04 (expansion): every route of the « events » surface — public reading included — is refused 503 before its handler while the capability is closed
  events: ['community.events'], 'citizen/events': ['community.events'], 'admin/events': ['community.events'],
  // X02 (expansion): every route of the « testimonials » surface — public reading included — is refused 503 before its handler while the capability is closed
  testimonials: ['community.testimonials'], 'citizen/testimonials': ['community.testimonials'], 'admin/testimonials': ['community.testimonials'],
  // X01 (expansion): every route of the « stories » surface — public reading included — is refused 503 before its handler while the capability is closed
  stories: ['community.stories'], 'citizen/stories': ['community.stories'], 'admin/stories': ['community.stories'],
  // X05 (expansion): every route of the « employment » surface — public reading included — is refused 503 before its handler while the capability is closed
  employment: ['community.employment'], 'pro/employment': ['community.employment'], 'admin/employment': ['community.employment'],
  // X03 (expansion): every route of the « entraide » surface is refused 503 before its handler while the capability is closed (dedicated AIPD first)
  'citizen/entraide': ['community.entraide'], 'admin/entraide': ['community.entraide'],
  // G14-PS: both sides of the social referral are refused 503 before their handler while the capability is closed
  'pro/social-referrals': ['pro.referrals_social'], 'citizen/social-referrals': ['pro.referrals_social'],
});
const ROUTE_PREFIXES = Object.keys(ROUTE_CAPABILITIES).sort((a, b) => b.length - a.length);

/** the capabilities a route needs (all must be open), [] = not gated by this layer @param {string} path normalized API path @returns {readonly string[]} */
export function capabilitiesOfRoute(path) {
  let p = String(path || '').replace(/\/+$/, '');
  // rdv/appointments/<id>/visio: the citizen side of a video appointment (the id segment is not part of the key)
  if (/^rdv\/appointments\/[^/]+\/visio$/.test(p)) p = 'rdv/appointments/visio';
  // R3: messages/conversations/<id>/attachments/<id> (citizen) and pro/messages/conversations/<id>/attachments/<id> (professional)
  if (/^messages\/conversations\/[^/]+\/attachments(\/|$)/.test(p)) p = 'messages/attachments';
  if (/^pro\/messages\/conversations\/[^/]+\/attachments(\/|$)/.test(p)) p = 'pro/messages/attachments';
  const key = ROUTE_PREFIXES.find((x) => p === x || p.startsWith(`${x}/`));
  return key ? ROUTE_CAPABILITIES[key] : [];
}

/** @param {unknown} v */
const flag = (v) => String(v ?? '').trim();

/** is the capability gate enforced in this environment @param {Record<string, string | undefined>} [envVars] */
export function capabilityEnforced(envVars = process.env) {
  if (isPublicBetaRestricted(envVars)) return true;
  if (['production', 'preview'].includes(flag(envVars.VERCEL_ENV).toLowerCase())) return true;
  return flag(envVars.ADA_CAPABILITY_ENFORCEMENT) === '1';
}

/** the names listed in ADA_CAPABILITIES_OPEN that are known capabilities @param {Record<string, string | undefined>} [envVars] @returns {Set<string>} */
export function listedCapabilities(envVars = process.env) {
  return new Set(flag(envVars.ADA_CAPABILITIES_OPEN).split(',').map((x) => x.trim().toLowerCase())
    .filter((x) => Object.prototype.hasOwnProperty.call(CAPABILITIES, x)));
}

/**
 * HDS attestation token (ADA_HDS_CERTIFIED_HOSTING), exact format:
 *   HDS1:<provider-slug>:<certificate-reference>:<valid-until YYYY-MM-DD>:<sha256 of the certificate document, 64 lowercase hex>
 * e.g. HDS1:example-host:CERT-2026-0001:2029-12-31:<64 hex>. Anything else — or a date in the past — is invalid and opens nothing.
 */
export const HDS_TOKEN_FORMAT = /^HDS1:([a-z0-9][a-z0-9-]{1,39}):([A-Za-z0-9][A-Za-z0-9._-]{2,63}):(\d{4})-(\d{2})-(\d{2}):([0-9a-f]{64})$/;

/** @param {Record<string, string | undefined>} [envVars] @param {Date} [now] @returns {{ valid: boolean, reason: string | null }} */
export function hdsAttestation(envVars = process.env, now = new Date()) {
  const raw = flag(envVars.ADA_HDS_CERTIFIED_HOSTING);
  if (!raw) return { valid: false, reason: 'HDS_ATTESTATION_ABSENT' };
  const m = HDS_TOKEN_FORMAT.exec(raw);
  if (!m) return { valid: false, reason: 'HDS_ATTESTATION_MALFORMED' };
  const [y, mo, d] = [Number(m[3]), Number(m[4]), Number(m[5])];
  const until = new Date(Date.UTC(y, mo - 1, d, 23, 59, 59));
  if (until.getUTCFullYear() !== y || until.getUTCMonth() !== mo - 1 || until.getUTCDate() !== d) return { valid: false, reason: 'HDS_ATTESTATION_MALFORMED' };
  if (until.getTime() < now.getTime()) return { valid: false, reason: 'HDS_ATTESTATION_EXPIRED' };
  return { valid: true, reason: null };
}

/** the provider slug of a valid attestation token, or null (G14-R3: it must match the HDS service's certified host) @param {Record<string, string | undefined>} [envVars] @param {Date} [now] */
export function hdsAttestationProvider(envVars = process.env, now = new Date()) {
  if (!hdsAttestation(envVars, now).valid) return null;
  return HDS_TOKEN_FORMAT.exec(flag(envVars.ADA_HDS_CERTIFIED_HOSTING))?.[1] || null;
}

/** is the capability's surface open @param {string} key @param {Capability} cap @param {Record<string, string | undefined>} envVars */
function surfaceOpen(key, cap, envVars) {
  if (!isPublicBetaRestricted(envVars)) return true;   // outside the beta every surface is served (the capability rule still applies)
  if (!openSurfaces(envVars).has(cap.surface)) return false;
  // G4: a capability of the full scope also passes when its module is added by name to the narrow scope (ADA_BETA_ACCOUNTS_EXTRA, e.g. citizen.parcours)
  return !cap.accountsFull || accountsScope(envVars) === 'full' || accountsExtraCapabilities(envVars).has(key);
}

/**
 * @param {string} name
 * @param {Record<string, string | undefined>} [envVars]
 * @param {{ now?: Date, structureCategory?: 'ESSMS' | 'HEALTH' | 'NOT_ESSMS' | 'UNKNOWN' }} [opts] structureCategory: from a reviewed classification only (none exists yet)
 * @returns {{ open: boolean, reason: string | null }}
 */
export function capabilityState(name, envVars = process.env, opts = {}) {
  const key = String(name || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(CAPABILITIES, key)) return { open: false, reason: 'UNKNOWN_CAPABILITY' };
  if (!capabilityEnforced(envVars)) return { open: true, reason: 'ENFORCEMENT_OFF' };   // development / test LAB only
  const cap = CAPABILITIES[key];
  if (cap.openable === false) return { open: false, reason: 'NOT_OPENABLE' };
  if (!surfaceOpen(key, cap, envVars)) return { open: false, reason: 'SURFACE_CLOSED' };
  if (cap.aipd !== 'in' && !listedCapabilities(envVars).has(key)) return { open: false, reason: 'NOT_LISTED_IN_ADA_CAPABILITIES_OPEN' };
  // a structure-dependent HDS need (ESSMS or not) is waived only for a structure positively classified NOT_ESSMS; unknown = HDS needed (fail-closed)
  const hdsNeeded = cap.requiresHds && !(cap.hdsDependsOnStructure && opts.structureCategory === 'NOT_ESSMS');
  if (hdsNeeded && !hdsAttestation(envVars, opts.now).valid) return { open: false, reason: 'HDS_HOSTING_NOT_ATTESTED' };
  // G14-R3: deployed, a capability served by the HDS service also needs the approved, allow-listed gateway, a matching attestation and a ported module
  if (HDS_SERVICE_CAPABILITIES.includes(key) && isDeployed(envVars)) {
    const gw = hdsGatewayState(envVars, { deployed: true });
    if (!gw.ready) return { open: false, reason: /** @type {string} */ (gw.reason) };
    if (hdsAttestationProvider(envVars, opts.now) !== gw.provider) return { open: false, reason: 'HDS_ATTESTATION_PROVIDER_MISMATCH' };
    if (!hdsModuleReady(key)) return { open: false, reason: 'HDS_MODULE_NOT_PORTED' };
  }
  return { open: true, reason: null };
}

/** @param {string} name @param {Record<string, string | undefined>} [envVars] */
export function capabilityOpen(name, envVars = process.env) {
  return capabilityState(name, envVars).open;
}

/** every capability with its state, for the release gate and the readiness doctor (never a value) @param {Record<string, string | undefined>} [envVars] */
export function capabilityStates(envVars = process.env) {
  return Object.entries(CAPABILITIES).map(([name, cap]) => ({ name, aipd: cap.aipd, requiresHds: cap.requiresHds, ...capabilityState(name, envVars) }));
}

/** the first closed capability of a route, or null @param {string} path @param {Record<string, string | undefined>} [envVars] */
export function closedCapabilityOfRoute(path, envVars = process.env) {
  // R3: a capability whose HDS need depends on the record (hdsCheckedPerRecord) passes the ROUTE gate in its best case (a NOT_ESSMS structure); its
  // handler decides each record with the real classification and refuses the others (fail closed)
  return capabilitiesOfRoute(path).find((c) => !capabilityState(c, envVars, CAPABILITIES[c]?.hdsCheckedPerRecord ? { structureCategory: 'NOT_ESSMS' } : {}).open) || null;
}

/** the refusal body (no data) @param {string} capability */
export function capabilityRefusal(capability) {
  return { error: CAPABILITY_NOT_OPEN, code: CAPABILITY_NOT_OPEN, capability, message: CAPABILITY_NOT_OPEN_MESSAGE };
}

/** write the refusal @param {any} res @param {string} capability */
export function sendCapabilityRefusal(res, capability) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(503).json(capabilityRefusal(capability));
}

/**
 * Handler-level guard: answers 503 CAPABILITY_NOT_OPEN (no data) and returns false when one of the capabilities is closed.
 * @param {any} res @param {string | readonly string[]} names @param {Record<string, string | undefined>} [envVars] @returns {boolean} true = may continue
 */
export function requireCapability(res, names, envVars = process.env) {
  const list = Array.isArray(names) ? names : [names];
  const closed = list.find((n) => !capabilityOpen(n, envVars));
  if (!closed) {
    // G14-R3: deployed, the data of an HDS-served capability are never handled here (the browser calls the HDS service)
    if (hdsServiceRoute(list, envVars)) { sendHdsServiceRefusal(res, envVars); return false; }
    return true;
  }
  sendCapabilityRefusal(res, closed);
  return false;
}

/**
 * Handler-level wrapper: the capability is checked BEFORE the handler and its authentication wrapper run (no session lookup, no database access).
 * @param {string | readonly string[]} names @param {(req: any, res: any) => any} handler @returns {(req: any, res: any) => any}
 */
export function withCapability(names, handler) {
  return async function capabilityGuarded(/** @type {any} */ req, /** @type {any} */ res) {
    if (!requireCapability(res, names)) return undefined;
    return handler(req, res);
  };
}

/** normalized API path of a request, as api/index.js computes it @param {any} req */
function requestPath(req) {
  let p = '';
  try { p = new URL(String(req?.url || '/'), 'http://localhost').pathname; } catch { p = ''; }
  return p.replace(/^\/api(\/|$)/, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Central dispatch hook (used by api/routes.js, so by api/index.js and dev-server.js, without touching the byte-pinned api/index.js): wraps a route so its
 * handler is refused before it runs — whatever the role, the beta flag or the method — when a capability of the route is closed. The module is loaded (the
 * router needs its default export) but none of its code handles the request.
 * @template {{ path: string, match: string, handler: Function }} R @param {R} route @returns {R}
 */
export function gateRoute(route) {
  const load = route.handler;
  const handler = async () => {
      const mod = await load();
      const inner = mod?.default || mod;
      if (typeof inner !== 'function') return mod;
      /** @param {any} req @param {any} res */
      const gated = async (req, res) => {
        const p = requestPath(req);
        const key = p === route.path.replace(/\/$/, '') || p.startsWith(route.path.endsWith('/') ? route.path : `${route.path}/`) ? p : route.path;
        const closed = closedCapabilityOfRoute(key);
        if (closed) return sendCapabilityRefusal(res, closed);
        // G14-R3: deployed, an open HDS-served capability is still never served by this application (no handler run, no database access)
        if (hdsServiceRoute(capabilitiesOfRoute(key))) return sendHdsServiceRefusal(res);
        return inner(req, res);
      };
      return { ...mod, default: gated };
  };
  // R45 integ: route introspection (tests, inventories) reads the loader's source to know which module a route serves — keep it visible
  handler.toString = () => String(load);
  return /** @type {R} */ ({ ...route, handler });
}
