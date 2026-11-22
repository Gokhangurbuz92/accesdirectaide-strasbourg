/**
 * G14 (22/11/2026) — v10-2026-11-22 of the citizen terms (cgu-citoyen) and the privacy notice (notice-confidentialite): Mon Parcours, limited version,
 * approved by the controller (« G14 toplu onay », point 2). v10 = notice v9 / cgu-citoyen v7 + exactly the listed texts; the earlier versions unchanged
 * byte for byte; every figure is the code's (730 days = 24 months, 30-day notice, 35-day backups); six languages; approval by name.
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LEGAL_DRAFT_DOCUMENTS_V7, LEGAL_DRAFT_DOCUMENTS_V9, LEGAL_DRAFT_DOCUMENTS_V10, LEGAL_DRAFTS_V10, LEGAL_DRAFTS_V10_DOCUMENT_IDS, approvedVersionOf, draftFor, draftTextKeys,
  draftVisibility, knownApprovalToken,
} from '../../src/config/legal-drafts.js';
import { citizenTermsInForce } from '../../api/_utils/terms-in-force.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { RETENTION_POLICY } from '../../api/_services/retention-policy.js';

const sha = (/** @type {unknown} */ v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const keys = (/** @type {any} */ d) => Object.fromEntries(draftTextKeys(d));
const NOTICE_V9 = /** @type {any} */ (LEGAL_DRAFT_DOCUMENTS_V9.find((d) => d.id === 'notice-confidentialite'));
const CGU_V7 = /** @type {any} */ (LEGAL_DRAFT_DOCUMENTS_V7.find((d) => d.id === 'cgu-citoyen'));
const notice = /** @type {any} */ (LEGAL_DRAFT_DOCUMENTS_V10.find((d) => d.id === 'notice-confidentialite'));
const cgu = /** @type {any} */ (LEGAL_DRAFT_DOCUMENTS_V10.find((d) => d.id === 'cgu-citoyen'));
/** the value that puts v10 in force (the professional documents keep their versions) */
const WITH_V10 = 'cgu-citoyen@v10-2026-11-22,notice-confidentialite@v10-2026-11-22,cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19';
const LANGS = ['en', 'de', 'tr', 'ar', 'uk'];
const locale = (/** @type {string} */ lang) => JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));

describe('legal drafts v10-2026-11-22 — Mon Parcours (limited)', () => {
  it('v10 covers the citizen terms and the notice only; their v9 / v7 bases unchanged byte for byte', () => {
    expect(LEGAL_DRAFTS_V10).toBe('v10-2026-11-22');
    expect([...LEGAL_DRAFTS_V10_DOCUMENT_IDS]).toEqual(['cgu-citoyen', 'notice-confidentialite']);
    expect(sha(NOTICE_V9)).toBe('a2bf96edf8549c2894f1c96642574e240f5f66699dfd3189a70c5f08a1eb8031');
    expect(sha(CGU_V7)).toBe('f29d0e1a1a13ef78f8ccab77de2a15960c6477644af0f4a0a3eb60d1203fa775');
  });

  it('v10 = base + exactly the listed texts, each under its own « _v10 » key', () => {
    const a = keys(NOTICE_V9); const b = keys(notice);
    expect(Object.keys(b).filter((k) => a[k] !== b[k]).sort()).toEqual(['purposes.p17_v10', 'retention.i14_v10', 'retention.parcours_v10']);
    expect(Object.keys(a).filter((k) => !(k in b))).toEqual(['retention.i14_v9']);
    expect(a['retention.i14_v9']).toContain('suivi des démarches');
    expect(b['retention.i14_v10']).toBe(a['retention.i14_v9'].replace(', suivi des démarches', ''));
    const c = keys(CGU_V7); const d = keys(cgu);
    expect(Object.keys(d).filter((k) => c[k] !== d[k])).toEqual(['account.parcours_v10']);
    expect(Object.keys(c).filter((k) => !(k in d))).toEqual([]);
  });

  it('the texts say what the code does: no free text, excluded categories, owner only, in-app reminders only, 24 months, 30 days, 35 days', () => {
    const p17 = keys(notice)['purposes.p17_v10']; const ret = keys(notice)['retention.parcours_v10']; const t = keys(cgu)['account.parcours_v10'];
    expect(p17).toMatch(/^P17 — Mon Parcours/);
    expect(p17).toContain('art. 6, 1, b');
    for (const w of ['aucun texte libre', 'santé', 'handicap', 'infraction', 'droit au séjour', 'violences', 'protection de l\'enfance', 'protection juridique', 'grande précarité',
      'visibles que par vous', 'jamais par e-mail ni par SMS']) expect(p17).toContain(w);
    expect(RETENTION_POLICY.durations.PARCOURS_CLOSED_STEP_DAYS.days).toBe(730);
    expect(ret).toContain('24 mois après sa clôture'); expect(ret).toContain('30 jours avant'); expect(ret).toContain('35 jours');
    expect(RETENTION_POLICY.durations.BACKUP_KEEP_DAYS.days).toBe(35);
    expect(t).toContain('déclaratif'); expect(t).toContain('aucun texte libre'); expect(t).toContain('24 mois');
    for (const x of [p17, ret, t]) expect(claimsEntitlement(x)).toBe(false);
  });

  it('six languages: every v10 key translated, same figures, no entitlement claim', () => {
    const fr = { ...Object.fromEntries(draftTextKeys(notice).map(([k, v]) => [`privacyNotice.${k}`, v])), ...Object.fromEntries(draftTextKeys(cgu).map(([k, v]) => [`cguCitoyen.${k}`, v])) };
    const v10 = Object.keys(fr).filter((k) => k.endsWith('_v10'));
    expect(v10.sort()).toEqual(['cguCitoyen.account.parcours_v10', 'privacyNotice.purposes.p17_v10', 'privacyNotice.retention.i14_v10', 'privacyNotice.retention.parcours_v10']);
    const figures = (/** @type {string} */ s) => (s.match(/\d+/g) || []).join(',');
    for (const lang of LANGS) {
      const tr = locale(lang);
      for (const k of v10) {
        expect(typeof tr[k], `${lang} ${k}`).toBe('string');
        // i14_v10 is the v9 translation with its last listed function (« suivi des démarches ») removed, nothing else
        if (k.endsWith('i14_v10')) { expect(tr['privacyNotice.retention.i14_v9'].length).toBeGreaterThan(tr[k].length); expect(tr[k].split(')')[1]).toBe(tr['privacyNotice.retention.i14_v9'].split(')')[1]); }
        else expect(figures(tr[k]), `${lang} ${k}`).toBe(figures(fr[k]));
        expect(claimsEntitlement(tr[k]), `${lang} ${k}`).toBe(false);
      }
    }
  });

  it('approval by name: Production shows v10 only once VITE_LEGAL_DOCS_APPROVED_VERSION names it; accounts open under it', () => {
    const prod = (/** @type {string | undefined} */ approved) => ({ approved, production: true });
    for (const id of ['cgu-citoyen', 'notice-confidentialite']) {
      expect(knownApprovalToken(`${id}@${LEGAL_DRAFTS_V10}`)).toBe(true);
      expect(approvedVersionOf(id, WITH_V10)).toBe(LEGAL_DRAFTS_V10);
      expect(draftVisibility(/** @type {any} */ (draftFor(id, prod(WITH_V10))), prod(WITH_V10))).toBe('IN_FORCE');
    }
    expect(approvedVersionOf('cgu-professionnel', WITH_V10)).toBe('v8-2026-11-19');
    expect(citizenTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: WITH_V10 })).toBe(true);
    // the current Production value keeps the earlier versions in force (no silent switch)
    const now = 'cgu-citoyen@v7-2026-11-18,notice-confidentialite@v8-2026-11-19,cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19';
    expect(approvedVersionOf('cgu-citoyen', now)).toBe('v7-2026-11-18');
    expect(approvedVersionOf('notice-confidentialite', now)).toBe('v8-2026-11-19');
  });
});
