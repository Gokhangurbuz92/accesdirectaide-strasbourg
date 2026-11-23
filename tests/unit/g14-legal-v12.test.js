/**
 * G14 (23/11/2026) — the expansion capabilities X04 (events), X02 (testimonials), X01 (community stories) and the DSA « signalements et décisions »
 * block in the legal documents, with the owner as the sole named moderator. PROPOSED (not approved by the owner yet):
 *   v12-2026-11-23  cgu-citoyen = v10 + § 7 bis + one § 8 paragraph; notice-confidentialite = v10 (no ADA Pro text) + the expansion texts → X04 / X01 / X02 opening;
 *   v13-2026-11-23  notice-confidentialite = v11 (ADA Pro) + the same expansion texts + the 8x8 JaaS video texts → only at the ADA Pro (K8) opening.
 * Bases unchanged byte for byte; every figure is the code's (retention-policy.js, moderation-dsa.js, academy-events.js, video-provider.js); six languages.
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LEGAL_DRAFT_DOCUMENTS, LEGAL_DRAFT_DOCUMENTS_V10, LEGAL_DRAFT_DOCUMENTS_V11, LEGAL_DRAFT_DOCUMENTS_V12, LEGAL_DRAFT_DOCUMENTS_V13, LEGAL_DRAFT_STATUS, LEGAL_DRAFT_VERSIONS,
  LEGAL_DRAFTS_V10, LEGAL_DRAFTS_V11, LEGAL_DRAFTS_V12, LEGAL_DRAFTS_V12_DOCUMENT_IDS, LEGAL_DRAFTS_V12_STATUS, LEGAL_DRAFTS_V13, LEGAL_DRAFTS_V13_ACTIVATION,
  LEGAL_DRAFTS_V13_DOCUMENT_IDS, approvedVersionOf, draftFor, draftTextKeys, draftVisibility, knownApprovalToken, latestDraftVersionOf,
} from '../../src/config/legal-drafts.js';
import { citizenTermsInForce } from '../../api/_utils/terms-in-force.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { RETENTION_POLICY } from '../../api/_services/retention-policy.js';
import { APPEAL_MONTHS, SOLE_REVIEW_DELAY_MS, SUSPENSION_MAX_DAYS, SUSPENSION_MIN_DAYS, WARNING_WINDOW_DAYS } from '../../api/_services/moderation-dsa.js';
import { REMINDER_WINDOW_HOURS } from '../../api/_services/academy-events.js';
import { VIDEO_JOIN_EARLY_MINUTES, VIDEO_JOIN_LATE_MINUTES } from '../../api/lib/video-provider.js';

const sha = (/** @type {unknown} */ v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const keys = (/** @type {any} */ d) => Object.fromEntries(draftTextKeys(d));
const find = (/** @type {any[]} */ set, /** @type {string} */ id) => /** @type {any} */ (set.find((d) => d.id === id));
const N = 'notice-confidentialite';
const NOTICE_V10 = find(LEGAL_DRAFT_DOCUMENTS_V10, N); const CGU_V10 = find(LEGAL_DRAFT_DOCUMENTS_V10, 'cgu-citoyen'); const NOTICE_V11 = find(LEGAL_DRAFT_DOCUMENTS_V11, N);
const n12 = find(LEGAL_DRAFT_DOCUMENTS_V12, N); const cgu = find(LEGAL_DRAFT_DOCUMENTS_V12, 'cgu-citoyen'); const n13 = find(LEGAL_DRAFT_DOCUMENTS_V13, N);
/** the X04 / X01 / X02 opening value, and the later ADA Pro (K8) value */
const OPEN_EXP = 'cgu-citoyen@v12-2026-11-23,notice-confidentialite@v12-2026-11-23,cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19';
const OPEN_K8 = 'cgu-citoyen@v12-2026-11-23,notice-confidentialite@v13-2026-11-23,cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19';
const LANGS = ['en', 'de', 'tr', 'ar', 'uk'];
const locale = (/** @type {string} */ lang) => JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
const prod = (/** @type {string | undefined} */ approved) => ({ approved, production: true });
const diff = (/** @type {any} */ a, /** @type {any} */ b) => Object.keys(b).filter((k) => a[k] !== b[k]).sort();
const D = RETENTION_POLICY.durations;

const NOTICE_ADDED = ['moderation.p1_v12', 'moderation.p2_v12', 'moderation.p3_v12', 'moderation.p4_v12', 'moderation.p5_v12', 'moderation.p6_v12', 'moderation.p7_v12',
  'moderation.title_v12', 'participation.events_v12', 'participation.p1_v12', 'participation.stories_v12', 'participation.testimonials_v12', 'participation.title_v12',
  'recipients.expansion_v12', 'retention.content_v12', 'retention.decisions_v12', 'retention.events_v12', 'retention.notices_v12', 'retention.proofs_v12',
  'rights.expansion_v12', 'status.expansion_v12'];

describe('legal drafts v12 / v13 (23/11/2026) — X04, X01, X02 and the moderation block', () => {
  it('v12 = cgu-citoyen + notice, v13 = notice only, after v11; v10 / v11 unchanged byte for byte; proposed, not approved', () => {
    const order = [...LEGAL_DRAFT_VERSIONS];
    expect(order.slice(-4)).toEqual([LEGAL_DRAFTS_V10, LEGAL_DRAFTS_V11, LEGAL_DRAFTS_V12, LEGAL_DRAFTS_V13]);
    expect([...LEGAL_DRAFTS_V12_DOCUMENT_IDS]).toEqual(['cgu-citoyen', N]);
    expect([...LEGAL_DRAFTS_V13_DOCUMENT_IDS]).toEqual([N]);
    expect(sha(NOTICE_V10)).toBe('a43604b8dd9087a2ca4db08cb1478fdad30f780e1e2e22a0f690f09e01f2e571');
    expect(sha(CGU_V10)).toBe('3471b8b21efc7b4a885498de79e70187925558a3c8fc9684f4d6748bea67b6e4');
    expect(sha(NOTICE_V11)).toBe('482d1511b2ee940cbb34d134330cdb38caa854cb24353a70f9199e77cbd12fea');
    expect(LEGAL_DRAFTS_V12_STATUS).toMatch(/^PROPOSED/);
    expect(LEGAL_DRAFTS_V13_ACTIVATION).toMatch(/^APPROVED_FOR_ACTIVATION_AT_K8 — proposée .*pas encore approuvée/);
    for (const d of [n12, n13, cgu]) expect(d.status).toBe(LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL);
    expect(latestDraftVersionOf(N)).toBe(LEGAL_DRAFTS_V13);
    expect(latestDraftVersionOf('cgu-citoyen')).toBe(LEGAL_DRAFTS_V12);
    expect(find(LEGAL_DRAFT_DOCUMENTS, N).version).toBe(LEGAL_DRAFTS_V13);
  });

  it('notice v12 = v10 + the expansion texts only (two new sections, Mailjet item); v13 = v11 + the same texts + the video texts', () => {
    const a = keys(NOTICE_V10); const b = keys(n12);
    expect(diff(a, b)).toEqual([...NOTICE_ADDED, 'processors.i4_v12'].sort());
    expect(Object.keys(a).filter((k) => !(k in b))).toEqual(['processors.i4']);
    expect(n12.sections.map((/** @type {any} */ s) => s.id)).toEqual(['controller', 'status', 'purposes', 'purposes-later', 'participation', 'retention', 'recipients',
      'processors', 'transfers', 'rights', 'booking', 'sensitive', 'art14', 'language', 'moderation']);
    const c = keys(NOTICE_V11); const d = keys(n13);
    expect(diff(c, d)).toEqual([...NOTICE_ADDED, 'processors.i4_v13', 'processors.provider_v13', 'processors.video_v13', 'transfers.video_v13'].sort());
    expect(Object.keys(c).filter((k) => !(k in d))).toEqual(['processors.i4_v9']);
    for (const k of NOTICE_ADDED) expect(d[k], k).toBe(b[k]);
    // the retention items sit right after Mon Parcours, before the « not open yet » list
    const r12 = n12.sections.find((/** @type {any} */ s) => s.id === 'retention'); const r13 = n13.sections.find((/** @type {any} */ s) => s.id === 'retention');
    for (const r of [r12, r13]) {
      const ks = Object.values(r.itemKeys);
      expect(ks.slice(ks.indexOf('parcours_v10'), ks.indexOf('parcours_v10') + 7)).toEqual(['parcours_v10', 'events_v12', 'content_v12', 'notices_v12', 'proofs_v12', 'decisions_v12', ks.at(-1)]);
      expect(String(ks.at(-1))).toMatch(/^i14_v1[01]$/);
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

  it('v12 says nothing of ADA Pro, video, job listings or entraide being open; v13 only of video as « pas encore ouverte »', () => {
    const t12 = JSON.stringify([n12, cgu]);
    expect(t12).not.toMatch(/P4p — Comptes professionnels ADA Pro|Dans ADA Pro, seules sont ouvertes|8x8|Jitsi|visioconférence/i);
    expect(t12).not.toMatch(/offres? d'emploi|entraide|X0[1-5]/i);
    const v13 = keys(n13);
    for (const k of ['processors.provider_v13', 'processors.video_v13', 'transfers.video_v13']) expect(v13[k], k).toMatch(/pas encore ouverte/);
    expect(JSON.stringify(n13)).not.toMatch(/offres? d'emploi|entraide/i);
    expect(JSON.stringify(n13)).toMatch(/Dans ADA Pro, seules sont ouvertes/);   // the v9 / v11 professional texts are kept
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
    // no purge step of the expansion is approved yet: no « retiré automatiquement », and no duration for decisions (none decided)
    for (const id of ['testimonialsPendingExpired', 'storiesPendingExpired', 'contentNoticesDeleted']) expect(RETENTION_POLICY.approvedSteps?.[id]).toBeUndefined();
    for (const x of [b['retention.content_v12'], f['publishing.i3_v12']]) { expect(x).toMatch(/60 jours est retiré/); expect(x).not.toMatch(/automatiquement/); }
    expect(b['retention.decisions_v12']).toMatch(/n'est pas encore fixée/);
    expect(b['retention.decisions_v12']).not.toMatch(/\d/);
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
    expect(v['processors.provider_v13']).toMatch(/pas encore ouverte/);
    expect(v['transfers.video_v13']).toMatch(/2021\/914, module 2 : de responsable du traitement à sous-traitant/);
    const p = n13.sections.find((/** @type {any} */ s) => s.id === 'processors');
    const data = p.paras[Object.entries(p.paraKeys).find(([, k]) => k === 'video_v13')?.[0] ?? -1];
    expect(data).toMatch(/15 minutes avant le début à 15 minutes après la fin.*nom de salle calculé.*« Personne accompagnée » ou « Conseiller·e ».*ni votre nom, ni votre adresse électronique/);
    expect(data).toMatch(/L'enregistrement, la diffusion en direct, la transcription, les appels téléphoniques et l'envoi de fichiers sont désactivés/);
  });

  it('no entitlement wording, no « vous avez droit », in French and in the five translations; same figures in every language', () => {
    const fr = { ...Object.fromEntries([...draftTextKeys(n12), ...draftTextKeys(n13)].map(([k, x]) => [`privacyNotice.${k}`, x])),
      ...Object.fromEntries(draftTextKeys(cgu).map(([k, x]) => [`cguCitoyen.${k}`, x])) };
    const added = Object.keys(fr).filter((k) => /_v1[23]$/.test(k)).sort();
    expect(added.length).toBe(38);
    for (const d of [n12, n13, cgu]) { const ks = draftTextKeys(d).map(([k]) => k); expect(new Set(ks).size, d.version).toBe(ks.length); }   // no translation key shared by two texts
    for (const k of added) { expect(claimsEntitlement(fr[k]), k).toBe(false); expect(fr[k], k).not.toMatch(/vous avez droit/i); }
    const figures = (/** @type {string} */ s) => (s.match(/\d+/g) || []).join(',');
    for (const lang of LANGS) {
      const tr = locale(lang);
      for (const k of added) {
        expect(typeof tr[k], `${lang} ${k}`).toBe('string');
        expect(figures(tr[k]), `${lang} ${k}`).toBe(figures(fr[k]));
      }
    }
  });

  it('approval by name: X04 / X01 / X02 opening → cgu v12 + notice v12; ADA Pro (K8) → notice v13; today’s values unchanged', () => {
    for (const t of ['cgu-citoyen@v12-2026-11-23', 'notice-confidentialite@v12-2026-11-23', 'notice-confidentialite@v13-2026-11-23']) expect(knownApprovalToken(t)).toBe(true);
    expect(knownApprovalToken('cgu-citoyen@v13-2026-11-23')).toBe(false);
    expect(approvedVersionOf('cgu-citoyen', OPEN_EXP)).toBe(LEGAL_DRAFTS_V12);
    expect(approvedVersionOf(N, OPEN_EXP)).toBe(LEGAL_DRAFTS_V12);
    expect(approvedVersionOf(N, OPEN_K8)).toBe(LEGAL_DRAFTS_V13);
    expect(approvedVersionOf('cgu-professionnel', OPEN_EXP)).toBe('v8-2026-11-19');
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
