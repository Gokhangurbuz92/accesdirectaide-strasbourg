/**
 * G14 (23/11/2026) — the expansion capabilities X04 (events), X02 (testimonials), X01 (community stories) and the DSA « signalements et décisions »
 * block in the legal documents, with the owner as the sole named moderator. PROPOSED (not approved by the owner yet):
 *   v12-2026-11-23  cgu-citoyen = v10 + § 7 bis + one § 8 paragraph; notice-confidentialite = v10 (no ADA Pro text) + the expansion texts → X04 / X01 / X02 opening;
 *   v13-2026-11-23  notice-confidentialite = v11 (ADA Pro) + the same expansion texts + the ADA Pro opening texts (owner 23/11/2026: verified public
 *                   sign-up, appointments, 8x8 JaaS video, Outlook free / busy), with cgu-professionnel v10-2026-11-23 and conditions-structures v9-2026-11-23.
 * Bases unchanged byte for byte; every figure is the code's (retention-policy.js, moderation-dsa.js, academy-events.js, video-provider.js); six languages.
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LEGAL_DRAFT_DOCUMENTS, LEGAL_DRAFT_DOCUMENTS_V10, LEGAL_DRAFT_DOCUMENTS_V11, LEGAL_DRAFT_DOCUMENTS_V12, LEGAL_DRAFT_DOCUMENTS_V13, LEGAL_DRAFT_STATUS, LEGAL_DRAFT_VERSIONS,
  LEGAL_DRAFTS_V10, LEGAL_DRAFTS_V11, LEGAL_DRAFTS_V12, LEGAL_DRAFTS_V12_DOCUMENT_IDS, LEGAL_DRAFTS_V12_STATUS, LEGAL_DRAFTS_V13, LEGAL_DRAFTS_V13_ACTIVATION,
  LEGAL_DRAFTS_V13_DOCUMENT_IDS, LEGAL_DRAFT_DOCUMENTS_V8, LEGAL_DRAFT_DOCUMENTS_V9_PRO, LEGAL_DRAFT_DOCUMENTS_PRO_V10, LEGAL_DRAFT_DOCUMENTS_STRUCTURES_V9,
  LEGAL_DRAFTS_PRO_V10, LEGAL_DRAFTS_STRUCTURES_V9, approvedVersionOf, draftFor, draftTextKeys, draftVisibility, knownApprovalToken, latestDraftVersionOf,
} from '../../src/config/legal-drafts.js';
import { citizenTermsInForce } from '../../api/_utils/terms-in-force.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { RETENTION_POLICY } from '../../api/_services/retention-policy.js';
import { APPEAL_MONTHS, SOLE_REVIEW_DELAY_MS, SUSPENSION_MAX_DAYS, SUSPENSION_MIN_DAYS, WARNING_WINDOW_DAYS } from '../../api/_services/moderation-dsa.js';
import { REMINDER_WINDOW_HOURS } from '../../api/_services/academy-events.js';
import { VIDEO_JOIN_EARLY_MINUTES, VIDEO_JOIN_LATE_MINUTES } from '../../api/lib/video-provider.js';
import { OUTLOOK_SCOPES } from '../../api/_services/calendar-outlook.js';
import { CALENDAR_FRESH_MS } from '../../api/_services/rdv-calendar-busy.js';

const sha = (/** @type {unknown} */ v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const keys = (/** @type {any} */ d) => Object.fromEntries(draftTextKeys(d));
const find = (/** @type {any[]} */ set, /** @type {string} */ id) => /** @type {any} */ (set.find((d) => d.id === id));
const N = 'notice-confidentialite';
const NOTICE_V10 = find(LEGAL_DRAFT_DOCUMENTS_V10, N); const CGU_V10 = find(LEGAL_DRAFT_DOCUMENTS_V10, 'cgu-citoyen'); const NOTICE_V11 = find(LEGAL_DRAFT_DOCUMENTS_V11, N);
const n12 = find(LEGAL_DRAFT_DOCUMENTS_V12, N); const cgu = find(LEGAL_DRAFT_DOCUMENTS_V12, 'cgu-citoyen'); const n13 = find(LEGAL_DRAFT_DOCUMENTS_V13, N);
/** the X04 / X01 / X02 opening value, and the later ADA Pro (K8) value */
const OPEN_EXP = 'cgu-citoyen@v12-2026-11-23,notice-confidentialite@v12-2026-11-23,cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19';
const OPEN_K8 = 'cgu-citoyen@v12-2026-11-23,notice-confidentialite@v13-2026-11-23,cgu-professionnel@v10-2026-11-23,conditions-structures@v9-2026-11-23';
const PRO_V9 = find(LEGAL_DRAFT_DOCUMENTS_V9_PRO, 'cgu-professionnel'); const STRUCT_V8 = find(LEGAL_DRAFT_DOCUMENTS_V8, 'conditions-structures');
const pro = find(LEGAL_DRAFT_DOCUMENTS_PRO_V10, 'cgu-professionnel'); const struct = find(LEGAL_DRAFT_DOCUMENTS_STRUCTURES_V9, 'conditions-structures');
const LANGS = ['en', 'de', 'tr', 'ar', 'uk'];
const locale = (/** @type {string} */ lang) => JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
const prod = (/** @type {string | undefined} */ approved) => ({ approved, production: true });
const diff = (/** @type {any} */ a, /** @type {any} */ b) => Object.keys(b).filter((k) => a[k] !== b[k]).sort();
const D = RETENTION_POLICY.durations;

const NOTICE_ADDED = ['moderation.p1_v12', 'moderation.p2_v12', 'moderation.p3_v12', 'moderation.p4_v12', 'moderation.p5_v12', 'moderation.p6_v12', 'moderation.p7_v12',
  'moderation.title_v12', 'participation.events_v12', 'participation.p1_v12', 'participation.stories_v12', 'participation.testimonials_v12', 'participation.title_v12',
  'recipients.expansion_v12', 'retention.content_v12', 'retention.decisions_v12', 'retention.events_v12', 'retention.notices_v12', 'retention.proofs_v12',
  'rights.expansion_v12', 'status.expansion_v12'];
/** notice v13: the ADA Pro opening texts (owner 23/11/2026) */
const PRO_OPENING_KEYS = ['art14.p3_v13', 'booking.p1_v13', 'booking.p2_v13', 'booking.p3_v13', 'booking.p4_v13', 'booking.title_v13', 'processors.i4_v13', 'processors.i5_v13',
  'processors.provider_v13', 'processors.video_v13', 'purposes.p11_v13', 'purposes.p4_v13', 'purposes.p4p_v13', 'purposes.p5_v13', 'purposes.p7_v13', 'recipients.p2_v13',
  'retention.appointments_v13', 'retention.i14_v13', 'retention.outlook_v13', 'status.p1_v13', 'transfers.video_v13'];
const PRO_V9_SHA = '7754710dee1e4e3f4531859742029c05c0a28772b597935835588e249fbcc3f5';
const STRUCT_V8_SHA = '51b988dce038d1a155ebbb9844a9d1f4ff6f17ed31d544382f37067a8e9f7821';

describe('legal drafts v12 / v13 (23/11/2026) — X04, X01, X02 and the moderation block', () => {
  it('v12 = cgu-citoyen + notice, v13 = notice only, after v11; v10 / v11 unchanged byte for byte; proposed, not approved', () => {
    const order = [...LEGAL_DRAFT_VERSIONS];
    expect(order.slice(-6)).toEqual([LEGAL_DRAFTS_V10, LEGAL_DRAFTS_V11, LEGAL_DRAFTS_V12, LEGAL_DRAFTS_V13, LEGAL_DRAFTS_STRUCTURES_V9, LEGAL_DRAFTS_PRO_V10]);
    expect([LEGAL_DRAFTS_STRUCTURES_V9, LEGAL_DRAFTS_PRO_V10]).toEqual(['v9-2026-11-23', 'v10-2026-11-23']);
    expect(sha(PRO_V9)).toBe(PRO_V9_SHA); expect(sha(STRUCT_V8)).toBe(STRUCT_V8_SHA);
    expect([...LEGAL_DRAFTS_V12_DOCUMENT_IDS]).toEqual(['cgu-citoyen', N]);
    expect([...LEGAL_DRAFTS_V13_DOCUMENT_IDS]).toEqual([N]);
    expect(sha(NOTICE_V10)).toBe('a43604b8dd9087a2ca4db08cb1478fdad30f780e1e2e22a0f690f09e01f2e571');
    expect(sha(CGU_V10)).toBe('3471b8b21efc7b4a885498de79e70187925558a3c8fc9684f4d6748bea67b6e4');
    expect(sha(NOTICE_V11)).toBe('482d1511b2ee940cbb34d134330cdb38caa854cb24353a70f9199e77cbd12fea');
    expect(LEGAL_DRAFTS_V12_STATUS).toMatch(/^PROPOSED/);
    expect(LEGAL_DRAFTS_V13_ACTIVATION).toMatch(/^APPROVED_FOR_ACTIVATION_AT_K8 — proposée .*pas encore approuvée/);
    for (const d of [n12, n13, cgu, pro, struct]) expect(d.status).toBe(LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL);
    expect(latestDraftVersionOf(N)).toBe(LEGAL_DRAFTS_V13);
    expect(latestDraftVersionOf('cgu-citoyen')).toBe(LEGAL_DRAFTS_V12);
    expect(find(LEGAL_DRAFT_DOCUMENTS, N).version).toBe(LEGAL_DRAFTS_V13);
    expect(latestDraftVersionOf('cgu-professionnel')).toBe(LEGAL_DRAFTS_PRO_V10);
    expect(latestDraftVersionOf('conditions-structures')).toBe(LEGAL_DRAFTS_STRUCTURES_V9);
  });

  it('notice v12 = v10 + the expansion texts only (two new sections, Mailjet item); v13 = v11 + the same texts + the video texts', () => {
    const a = keys(NOTICE_V10); const b = keys(n12);
    expect(diff(a, b)).toEqual([...NOTICE_ADDED, 'processors.i4_v12'].sort());
    expect(Object.keys(a).filter((k) => !(k in b))).toEqual(['processors.i4']);
    expect(n12.sections.map((/** @type {any} */ s) => s.id)).toEqual(['controller', 'status', 'purposes', 'purposes-later', 'participation', 'retention', 'recipients',
      'processors', 'transfers', 'rights', 'booking', 'sensitive', 'art14', 'language', 'moderation']);
    const c = keys(NOTICE_V11); const d = keys(n13);
    expect(diff(c, d)).toEqual([...NOTICE_ADDED, ...PRO_OPENING_KEYS].sort());
    expect(Object.keys(c).filter((k) => !(k in d)).sort()).toEqual(['art14.p3_v9', 'booking.p1', 'booking.p2', 'booking.p3', 'booking.p4', 'booking.title', 'processors.i4_v9', 'processors.i5',
      'purposes-later.i1', 'purposes-later.i10', 'purposes-later.i3', 'purposes-later.i6', 'purposes.p4p_v9', 'recipients.p2', 'retention.i14_v11', 'status.p1_v9']);
    // P4, P5, P7 move from § 3 bis to § 3 word for word
    expect([d['purposes.p4_v13'], d['purposes.p5_v13'], d['purposes.p7_v13']]).toEqual([c['purposes-later.i1'], c['purposes-later.i3'], c['purposes-later.i6']]);
    for (const k of NOTICE_ADDED) expect(d[k], k).toBe(b[k]);
    // the retention items sit right after Mon Parcours, before the « not open yet » list
    const r12 = n12.sections.find((/** @type {any} */ s) => s.id === 'retention'); const r13 = n13.sections.find((/** @type {any} */ s) => s.id === 'retention');
    for (const r of [r12, r13]) {
      const ks = Object.values(r.itemKeys);
      expect(ks.slice(ks.indexOf('parcours_v10'), ks.indexOf('parcours_v10') + 6)).toEqual(['parcours_v10', 'events_v12', 'content_v12', 'notices_v12', 'proofs_v12', 'decisions_v12']);
      expect(String(ks.at(-1))).toMatch(/^i14_v1[013]$/);
    }
    expect(b['processors.i4_v12']).toBe(a['processors.i4'].replace('avis du compte)', 'avis du compte et, pour les contenus publiés, accusés de réception des signalements, décisions de modération et réponses aux contestations)'));
    expect(d['processors.i4_v13']).toBe(c['processors.i4_v9'].replace('avis du compte, invitations et avis des comptes professionnels)', 'avis du compte, invitations et avis des comptes professionnels et, pour les contenus publiés, accusés de réception des signalements, décisions de modération et réponses aux contestations)'));
  });

  it('cgu-citoyen v12 = v10 + § 7 bis (ten items, after § 7) + one paragraph of § 8', () => {
    const e = keys(CGU_V10); const f = keys(cgu);
    expect(diff(e, f)).toEqual(['deletion.participation_v12', 'publishing.title_v12', ...Array.from({ length: 10 }, (_, i) => `publishing.i${i + 1}_v12`)].sort());
    expect(Object.keys(e).filter((k) => !(k in f))).toEqual([]);
    const ids = cgu.sections.map((/** @type {any} */ s) => s.id);
    expect(ids.indexOf('publishing')).toBe(ids.indexOf('use') + 1);
    expect(f['publishing.i4_v12']).toMatch(/autorisez AccesDirectAide à afficher gratuitement votre texte .*n'est pas cédée à des tiers/);
  });

  it('v12 says nothing of ADA Pro, video, job listings or entraide being open; v13 describes the ADA Pro opening (appointments, video, Outlook)', () => {
    const t12 = JSON.stringify([n12, cgu]);
    expect(t12).not.toMatch(/P4p — Comptes professionnels ADA Pro|Dans ADA Pro, seules sont ouvertes|8x8|Jitsi|visioconférence/i);
    expect(t12).not.toMatch(/offres? d'emploi|entraide|X0[1-5]/i);
    const v13 = keys(n13);
    for (const k of ['processors.provider_v13', 'processors.video_v13', 'transfers.video_v13', 'purposes.p11_v13', 'recipients.p2_v13']) expect(v13[k], k).not.toMatch(/pas encore ouverte?s?\b|\(désactivé\)/);
    expect(JSON.stringify(n13)).not.toMatch(/offres? d'emploi|entraide|seules sont ouvertes|Lorsque les rendez-vous seront ouverts/i);
    expect(v13['status.p1_v13']).toMatch(/les rendez-vous .*la visioconférence .*disponibilités Outlook/);
    expect(v13['purposes.p4p_v13']).toMatch(/création sur invitation ou sur demande d'inscription d'une structure avec son numéro SIRET, vérifiée par l'exploitant sur une source officielle/);
    // self-registration as a verified request (branch g14-pro 29c1fefc: name, SIRET, e-mail, password, terms; no access until verified; refusal disables)
    expect(v13['art14.p3_v13']).toMatch(/demande d'inscription de votre structure .*numéro SIRET, votre adresse électronique professionnelle, un mot de passe et votre acceptation .*ne donne accès à rien tant que l'exploitant n'a pas vérifié la structure sur une source officielle et activé votre espace.*Si la demande est refusée, le compte est désactivé et la preuve de votre acceptation des conditions est gardée/);
    // art. 26: the essence of the joint-controller arrangement
    expect(v13['booking.p4_v13']).toMatch(/responsables conjoints \(article 26 du RGPD\)\. L'essentiel de leur accord : l'exploitant fait fonctionner la plateforme .*la structure est responsable du rendez-vous lui-même .*auprès de l'un ou de l'autre/);
    // § 3 bis keeps only what stays closed
    const later = n13.sections.find((/** @type {any} */ s) => s.id === 'purposes-later').items.map((/** @type {string} */ x) => x.split(' — ')[0]);
    expect(later).toEqual(['P5s', 'P6', 'P8', 'P9', 'P10b/P10c']);
    // the structure receives neither name, nor e-mail, nor phone (api/_handlers/rdv.js: beneficiaryName « Particulier », no phone; the pro list leaves out citizenEmailSnapshot)
    expect(v13['booking.p2_v13']).toMatch(/ne lui communique ni votre nom, ni votre adresse électronique, ni votre téléphone/);
    expect(v13['booking.p2_v13']).toMatch(/lorsque cette fonction est ouverte et que vous l'avez accepté, votre message/);
  });

  it('the texts say what the code does (durations, moderation flow, sole moderator, video token)', () => {
    const b = keys(n12); const f = keys(cgu); const v = keys(n13);
    expect([D.EVENT_NEED_AFTER_END_DAYS.days, D.EVENT_REGISTRATION_AFTER_END_DAYS.days, D.ACADEMY_EVENT_ENDED_DAYS.days]).toEqual([1, 30, 365]);
    expect(b['retention.events_v12']).toMatch(/au plus tard le lendemain de la fin.*30 jours après la fin.*après 12 mois/);
    for (const k of ['TESTIMONIAL', 'STORY']) {
      expect(D[`${k}_PENDING_DAYS`].days).toBe(60); expect(D[`${k}_REVIEW_DAYS`].days).toBe(1095); expect(D[`${k}_SKELETON_DAYS`].days).toBe(365);
    }
    expect([D.UGC_REPORT_DAYS.days, D.COMMUNITY_MEMBER_INACTIVE_DAYS.days, D.CONTENT_NOTICE_AFTER_DECISION_DAYS.days]).toEqual([90, 730, 365]);
    expect(b['retention.content_v12']).toMatch(/60 jours.*après 3 ans.*après 12 mois.*90 jours.*24 mois/);
    expect(b['retention.notices_v12']).toMatch(/12 mois après la décision.*contestation est en cours/);
    // owner decisions 23/11/2026: « retiré automatiquement » (steps DECIDED, approved only after their dry run) and decisions / appeals / sanctions 1 year
    // after the case is closed (MODERATION_CASE_CLOSED_DAYS, two decided steps)
    for (const id of ['testimonialsPendingExpired', 'storiesPendingExpired', 'contentNoticesDeleted', 'moderationDecisionsDeleted', 'moderationSanctionsDeleted']) {
      expect(RETENTION_POLICY.approvedSteps?.[id], id).toBeUndefined(); expect(RETENTION_POLICY.decidedSteps?.[id], id).toBeTruthy();
    }
    for (const x of [b['retention.content_v12'], f['publishing.i3_v12']]) expect(x).toMatch(/60 jours est retiré automatiquement/);
    expect(D.MODERATION_CASE_CLOSED_DAYS.days).toBe(365); expect(WARNING_WINDOW_DAYS).toBe(365);
    expect(b['retention.decisions_v12']).toMatch(/effacées 1 an après la clôture du dossier.*un avertissement, 12 mois après avoir été donné ; une suspension, à sa fin ou à sa levée/);
    expect(RETENTION_POLICY.version).toBe('g14-expansion-2-2026-11-23-a7-365d');
    // the charter: 24 hours / 7 days, linked from § 13 and CGU § 7 bis
    expect(b['moderation.p3_v12']).toMatch(/dans les 24 heures ; les autres signalements, dans les 7 jours/);
    expect(f['publishing.i6_v12']).toMatch(/dans les 24 heures.*autres signalements dans les 7 jours/);
    for (const x of [b['moderation.p7_v12'], f['publishing.i2_v12'], f['publishing.i5_v12']]) expect(x).toContain('charte de modération');
    expect(REMINDER_WINDOW_HOURS).toBe(48); expect(b['participation.events_v12']).toContain('48 heures avant le début');
    expect(b['participation.events_v12']).toMatch(/art\. 9, 2, a.*jamais cochée d'avance.*que des nombres/);
    expect(APPEAL_MONTHS).toBe(6); expect(SOLE_REVIEW_DELAY_MS).toBe(24 * 3600 * 1000);
    expect([SUSPENSION_MIN_DAYS, SUSPENSION_MAX_DAYS, WARNING_WINDOW_DAYS]).toEqual([1, 180, 365]);
    expect(b['moderation.p5_v12']).toMatch(/pendant six mois.*une seule personne assure la modération : elle réexamine elle-même la décision, au plus tôt 24 heures/);
    expect(b['moderation.p6_v12']).toMatch(/avertissement.*dans les 12 mois.*de 1 à 180 jours/);
    expect(f['publishing.i8_v12']).toMatch(/de 1 à 180 jours.*dans les 12 mois/);
    expect(b['moderation.p3_v12']).toMatch(/qui assure lui-même la modération.*aucune décision n'est automatisée.*112/);
    expect(b['recipients.expansion_v12']).toMatch(/responsable du traitement lui-même, personne physique, seul modérateur nommé/);
    expect(f['publishing.i2_v12']).toMatch(/l'exploitant, qui assure lui-même la modération, relit le texte/);
    expect(JSON.stringify([n12, n13, cgu])).not.toMatch(/Gurbuz|GURBUZ|Gokhan|Gökhan/);
    expect([VIDEO_JOIN_EARLY_MINUTES, VIDEO_JOIN_LATE_MINUTES]).toEqual([15, 15]);
    expect(v['processors.provider_v13']).toMatch(/8x8, Inc\. \(États-Unis\).*sous-traitant.*Global Data Processing Addendum.*février 2025/);
    expect(v['processors.provider_v13']).not.toMatch(/pas encore ouverte/);
    expect(v['transfers.video_v13']).toMatch(/2021\/914, module 2 : de responsable du traitement à sous-traitant/);
    const p = n13.sections.find((/** @type {any} */ s) => s.id === 'processors');
    const data = p.paras[Object.entries(p.paraKeys).find(([, k]) => k === 'video_v13')?.[0] ?? -1];
    expect(data).toMatch(/15 minutes avant le début à 15 minutes après la fin.*nom de salle calculé.*« Personne accompagnée » ou « Conseiller·e ».*ni votre nom, ni votre adresse électronique/);
    expect(data).toMatch(/L'appel n'est pas enregistré : l'enregistrement, la diffusion en direct, la transcription, les appels téléphoniques et l'envoi de fichiers sont désactivés/);
  });

  it('no entitlement wording, no « vous avez droit », in French and in the five translations; same figures in every language; no shared key', () => {
    /** every text of the new versions that its base does not carry under the same key */
    const fresh = (/** @type {any} */ doc, /** @type {any} */ base) => { const b = keys(base); return draftTextKeys(doc).filter(([k, x]) => b[k] !== x).map(([k, x]) => [`${doc.key}.${k}`, x]); };
    const fr = Object.fromEntries([...fresh(n12, NOTICE_V10), ...fresh(n13, NOTICE_V11), ...fresh(cgu, CGU_V10), ...fresh(pro, PRO_V9), ...fresh(struct, STRUCT_V8)]);
    const added = Object.keys(fr).sort();
    expect(added.length).toBe(69);
    for (const d of [n12, n13, cgu, pro, struct]) { const ks = draftTextKeys(d).map(([k]) => k); expect(new Set(ks).size, d.version).toBe(ks.length); }   // no translation key shared by two texts
    for (const k of added) { expect(claimsEntitlement(fr[k]), k).toBe(false); expect(fr[k], k).not.toMatch(/vous avez droit/i); expect(k, k).toMatch(/_v(9|1[0-3])$/); }
    const figures = (/** @type {string} */ s) => (s.match(/\d+/g) || []).join(',');
    for (const lang of LANGS) {
      const tr = locale(lang);
      for (const k of added) {
        expect(typeof tr[k], `${lang} ${k}`).toBe('string');
        expect(figures(tr[k]), `${lang} ${k}`).toBe(figures(fr[k]));
      }
    }
  });

  it('cgu-professionnel v10 and conditions-structures v9: only the statements the ADA Pro opening makes false are changed; no new obligation', () => {
    const a = keys(PRO_V9); const b = keys(pro);
    expect(diff(a, b)).toEqual(['account.i1_v10', 'appointments.p1_v10', 'appointments.p3_v10', 'appointments.p4_v10', 'appointments.title_v10', 'data.p1_v10', 'intro_v10']);
    expect(b['account.i1_v10']).toMatch(/demande d'inscription de votre structure faite par vous-même, avec son nom, son numéro SIRET, votre adresse électronique professionnelle, un mot de passe et votre acceptation des présentes conditions/);
    expect(b['account.i1_v10']).toMatch(/ne donne accès à rien tant que l'exploitant n'a pas vérifié la structure sur une source officielle.*Si la demande est refusée, le compte est désactivé/);
    expect(keys(struct)['roles.p2_v9']).toMatch(/responsables conjoints \(RGPD, art\. 26\)\. Leur accord est le suivant .*auprès de l'un ou de l'autre\. L'essentiel de cet accord est mis à leur disposition dans la notice de confidentialité \(section 9\)/);
    expect(a['appointments.p1_v8']).toMatch(/^La prise de rendez-vous n'est pas encore ouverte\. Lorsqu'elle est ouverte pour votre structure, /);
    expect(b['appointments.p1_v10']).toBe(a['appointments.p1_v8'].replace("La prise de rendez-vous n'est pas encore ouverte. Lorsqu'elle est ouverte", 'Lorsque la prise de rendez-vous est ouverte'));
    expect(b['appointments.title_v10']).toBe('4. Rendez-vous');
    expect(JSON.stringify(pro)).not.toMatch(/pas encore ouverte?s?\b|elle ne l'est pas à ce jour/);
    const c = keys(STRUCT_V8); const d = keys(struct);
    expect(diff(c, d)).toEqual(['agreement.p1_v9', 'agreement.title_v9', 'commitments.i1_v9', 'end.p1_v9', 'intro_v9', 'roles.p1_v9', 'roles.p2_v9']);
    expect(JSON.stringify(struct)).not.toMatch(/convention|référent|Aucune structure ne les a signées|pas encore ouverte?\b/);   // owner decision: no signed convention before appointments
    expect(d['roles.p1_v9']).not.toMatch(/coordonnées/);
    expect(d['commitments.i1_v9']).toBe(c['commitments.i1_v8'].replace('Lorsque la prise de rendez-vous sera ouverte : répondre aux demandes', 'Répondre aux demandes de rendez-vous'));
    // the other obligations stay word for word
    for (const k of ['commitments.i2', 'commitments.i3', 'commitments.i4', 'commitments.i5_v8', 'operatorCommitments.i1', 'operatorCommitments.i2', 'operatorCommitments.i3', 'sensitive.p1']) expect(d[k], k).toBe(c[k]);
    for (const k of ['use.i1', 'use.i2', 'use.i3', 'use.i4', 'use.i5', 'end.p1_v9', 'end.p2_v9', 'incident.p1']) expect(b[k], k).toBe(a[k]);
  });

  it('the ADA Pro opening texts say what the code does (appointments, Outlook, video)', () => {
    const v = keys(n13);
    expect([D.APPOINTMENT_CONFIRMED_DAYS.days ?? RETENTION_POLICY.approvedChoices?.A7, D.APPOINTMENT_UNCONFIRMED_DAYS.days, D.APPOINTMENT_CANCELLED_DAYS.days, D.APPOINTMENT_MESSAGE_DAYS.days, D.OUTLOOK_TOKEN_GRACE_DAYS.days])
      .toEqual([365, 90, 90, 30, 30]);
    expect(v['retention.appointments_v13']).toMatch(/anonymisé 1 an après sa date.*90 jours après la date prévue.*90 jours après son annulation.*30 jours après la date du rendez-vous/);
    expect(OUTLOOK_SCOPES).toContain('Calendars.ReadBasic'); expect(OUTLOOK_SCOPES).not.toMatch(/Calendars\.Read(Write)?\b(?!Basic)/);
    expect(CALENDAR_FRESH_MS).toBe(2 * 60_000);
    expect(v['retention.outlook_v13']).toMatch(/30 jours après son expiration.*2 minutes au plus/);
    expect(v['processors.i5_v13']).toMatch(/« Calendars\.ReadBasic ».*rien n'est écrit dans le calendrier/);
    expect(v['processors.video_v13']).toMatch(/sa base est celle des rendez-vous \(P5, section 3\).*L'appel n'est pas enregistré/);
    expect(v['retention.i14_v13']).not.toMatch(/rendez-vous/);
  });

  it('approval by name: X04 / X01 / X02 opening → cgu v12 + notice v12; ADA Pro opening → notice v13 + cgu-pro v10 + structures v9; today’s values unchanged', () => {
    for (const t of ['cgu-citoyen@v12-2026-11-23', 'notice-confidentialite@v12-2026-11-23', 'notice-confidentialite@v13-2026-11-23']) expect(knownApprovalToken(t)).toBe(true);
    expect(knownApprovalToken('cgu-citoyen@v13-2026-11-23')).toBe(false);
    expect(approvedVersionOf('cgu-citoyen', OPEN_EXP)).toBe(LEGAL_DRAFTS_V12);
    expect(approvedVersionOf(N, OPEN_EXP)).toBe(LEGAL_DRAFTS_V12);
    expect(approvedVersionOf(N, OPEN_K8)).toBe(LEGAL_DRAFTS_V13);
    expect(approvedVersionOf('cgu-professionnel', OPEN_EXP)).toBe('v8-2026-11-19');
    expect(approvedVersionOf('cgu-professionnel', OPEN_K8)).toBe(LEGAL_DRAFTS_PRO_V10);
    expect(approvedVersionOf('conditions-structures', OPEN_K8)).toBe(LEGAL_DRAFTS_STRUCTURES_V9);
    expect(approvedVersionOf('cgu-citoyen', OPEN_K8)).toBe(LEGAL_DRAFTS_V12);
    for (const t of ['cgu-professionnel@v10-2026-11-23', 'conditions-structures@v9-2026-11-23']) expect(knownApprovalToken(t)).toBe(true);
    expect(knownApprovalToken('notice-confidentialite@v10-2026-11-23')).toBe(false);
    expect(approvedVersionOf('conditions-structures', OPEN_EXP)).toBe('v8-2026-11-19');
    for (const v of [OPEN_EXP, OPEN_K8]) {
      expect(citizenTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: v })).toBe(true);
      expect(draftVisibility(/** @type {any} */ (draftFor(N, prod(v))), prod(v))).toBe('IN_FORCE');
    }
    // the Mon Parcours value keeps v10; the notice v13 is never in force by the expansion value
    const mp = 'cgu-citoyen@v10-2026-11-22,notice-confidentialite@v10-2026-11-22,cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19';
    expect(approvedVersionOf(N, mp)).toBe(LEGAL_DRAFTS_V10);
    expect(approvedVersionOf('cgu-citoyen', mp)).toBe(LEGAL_DRAFTS_V10);
    expect(draftFor(N, prod(OPEN_EXP))?.version).toBe(LEGAL_DRAFTS_V12);
    // nothing approved: a Production build hides both drafts
    expect(draftVisibility(n12, prod(undefined))).toBe('HIDDEN');
    expect(draftVisibility(n13, prod(mp))).toBe('HIDDEN');
  });
});
