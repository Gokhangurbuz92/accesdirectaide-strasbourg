/**
 * G14 (22/11/2026) — Mon Parcours (limited) in the legal documents, approved by the controller (« G14 toplu onay », point 2). Mon Parcours opens BEFORE
 * ADA Pro, and the notice must never describe ADA Pro as open while it is closed:
 *   v10-2026-11-22  cgu-citoyen = v7 (in force) + one item; notice-confidentialite = v8 (in force) + three texts → the Mon Parcours opening;
 *   v11-2026-11-22  notice-confidentialite = v9 (owner-approved, ADA Pro) + the same three texts → only at the ADA Pro (K8) opening.
 * Bases unchanged byte for byte; every figure is the code's (730 days = 24 months, 30-day notice, 35-day backups); six languages; approval by name.
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LEGAL_DRAFT_DOCUMENTS_V7, LEGAL_DRAFT_DOCUMENTS_V8, LEGAL_DRAFT_DOCUMENTS_V9, LEGAL_DRAFT_DOCUMENTS_V10, LEGAL_DRAFT_DOCUMENTS_V11, LEGAL_DRAFT_STATUS, LEGAL_DRAFT_VERSIONS,
  LEGAL_DRAFTS_V10, LEGAL_DRAFTS_V10_DOCUMENT_IDS, LEGAL_DRAFTS_V11, LEGAL_DRAFTS_V11_ACTIVATION, LEGAL_DRAFTS_V11_DOCUMENT_IDS, approvedVersionOf, draftFor, draftTextKeys,
  draftVisibility, knownApprovalToken,
} from '../../src/config/legal-drafts.js';
import { citizenTermsInForce } from '../../api/_utils/terms-in-force.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { RETENTION_POLICY } from '../../api/_services/retention-policy.js';

const sha = (/** @type {unknown} */ v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const keys = (/** @type {any} */ d) => Object.fromEntries(draftTextKeys(d));
const find = (/** @type {any[]} */ set, /** @type {string} */ id) => /** @type {any} */ (set.find((d) => d.id === id));
const N = 'notice-confidentialite';
const NOTICE_V8 = find(LEGAL_DRAFT_DOCUMENTS_V8, N); const NOTICE_V9 = find(LEGAL_DRAFT_DOCUMENTS_V9, N); const CGU_V7 = find(LEGAL_DRAFT_DOCUMENTS_V7, 'cgu-citoyen');
const n10 = find(LEGAL_DRAFT_DOCUMENTS_V10, N); const n11 = find(LEGAL_DRAFT_DOCUMENTS_V11, N); const cgu = find(LEGAL_DRAFT_DOCUMENTS_V10, 'cgu-citoyen');
/** (a) the Mon Parcours opening, (b) the later ADA Pro (K8) opening — the professional documents keep their versions here */
const OPEN_MP = 'cgu-citoyen@v10-2026-11-22,notice-confidentialite@v10-2026-11-22,cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19';
const OPEN_K8 = 'cgu-citoyen@v10-2026-11-22,notice-confidentialite@v11-2026-11-22,cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19';
const LANGS = ['en', 'de', 'tr', 'ar', 'uk'];
const locale = (/** @type {string} */ lang) => JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
const prod = (/** @type {string | undefined} */ approved) => ({ approved, production: true });

describe('legal drafts v10 / v11 (22/11/2026) — Mon Parcours (limited)', () => {
  it('v10 = cgu-citoyen + notice, v11 = notice only, both after v9; the bases (cgu v7, notice v8 and v9) unchanged byte for byte', () => {
    // mergeable with g14-cgupro (cgu-professionnel v9-2026-11-22 sits between v9-2026-11-19 and v10): only the relative order is required
    const order = [...LEGAL_DRAFT_VERSIONS];
    expect(order.indexOf(LEGAL_DRAFTS_V10)).toBeGreaterThan(order.indexOf('v9-2026-11-19'));
    expect(order.indexOf(LEGAL_DRAFTS_V11)).toBe(order.indexOf(LEGAL_DRAFTS_V10) + 1);   // G14 expansion: v12 / v13 follow (tests/unit/g14-legal-v12.test.js)
    expect([...LEGAL_DRAFTS_V10_DOCUMENT_IDS]).toEqual(['cgu-citoyen', N]);
    expect([...LEGAL_DRAFTS_V11_DOCUMENT_IDS]).toEqual([N]);
    expect(sha(NOTICE_V8)).toBe('f9093d3282a487f7bca854c1497ea4732d8f7d2b551655da27bee00adda74778');
    expect(sha(NOTICE_V9)).toBe('a2bf96edf8549c2894f1c96642574e240f5f66699dfd3189a70c5f08a1eb8031');
    expect(sha(CGU_V7)).toBe('f29d0e1a1a13ef78f8ccab77de2a15960c6477644af0f4a0a3eb60d1203fa775');
    expect(LEGAL_DRAFTS_V11_ACTIVATION).toMatch(/^APPROVED_FOR_ACTIVATION_AT_K8/);
    for (const d of [n10, n11, cgu]) expect(d.status).toBe(LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL);   // in force only when named by the build
  });

  it('notice v10 = v8 + exactly three texts and says nothing of ADA Pro being open; v11 = v9 + the same three texts', () => {
    const a = keys(NOTICE_V8); const b = keys(n10);
    expect(Object.keys(b).filter((k) => a[k] !== b[k]).sort()).toEqual(['purposes.p17_v10', 'retention.i14_v10', 'retention.parcours_v10']);
    expect(Object.keys(a).filter((k) => !(k in b))).toEqual(['retention.i14']);
    expect(b['retention.i14_v10']).toBe(a['retention.i14'].replace(', suivi des démarches', ''));
    expect(JSON.stringify(n10)).not.toMatch(/P4p — Comptes professionnels ADA Pro|Dans ADA Pro, seules sont ouvertes/);
    const c = keys(NOTICE_V9); const d = keys(n11);
    expect(Object.keys(d).filter((k) => c[k] !== d[k]).sort()).toEqual(['purposes.p17_v10', 'retention.i14_v11', 'retention.parcours_v10']);
    expect(Object.keys(c).filter((k) => !(k in d))).toEqual(['retention.i14_v9']);
    expect(d['retention.i14_v11']).toBe(c['retention.i14_v9'].replace(', suivi des démarches', ''));
    for (const k of ['purposes.p17_v10', 'retention.parcours_v10']) expect(d[k]).toBe(b[k]);
    const e = keys(CGU_V7); const f = keys(cgu);
    expect(Object.keys(f).filter((k) => e[k] !== f[k])).toEqual(['account.parcours_v10']);
    expect(Object.keys(e).filter((k) => !(k in f))).toEqual([]);
  });

  it('the texts say what the code does: no free text, excluded categories, owner only, in-app reminders only, 24 months, 30 days, 35 days', () => {
    const p17 = keys(n10)['purposes.p17_v10']; const ret = keys(n10)['retention.parcours_v10']; const t = keys(cgu)['account.parcours_v10'];
    expect(p17).toMatch(/^P17 — Mon Parcours/); expect(p17).toContain('art. 6, 1, b');
    for (const w of ['aucun texte libre', 'santé', 'handicap', 'infraction', 'droit au séjour', 'violences', 'protection de l\'enfance', 'protection juridique', 'grande précarité',
      'visibles que par vous', 'jamais par e-mail ni par SMS']) expect(p17).toContain(w);
    expect(RETENTION_POLICY.durations.PARCOURS_CLOSED_STEP_DAYS.days).toBe(730);
    expect(ret).toContain('24 mois après sa clôture'); expect(ret).toContain('30 jours avant'); expect(ret).toContain('35 jours'); expect(ret).toContain('réapparaître');
    expect(RETENTION_POLICY.durations.BACKUP_KEEP_DAYS.days).toBe(35);
    expect(t).toContain('déclaratif'); expect(t).toContain('aucun texte libre'); expect(t).toContain('24 mois');
    for (const x of [p17, ret, t]) expect(claimsEntitlement(x)).toBe(false);
  });

  it('six languages: every new key translated, same figures, the « not open » lists one item shorter than their base', () => {
    const fr = { ...Object.fromEntries([...draftTextKeys(n10), ...draftTextKeys(n11)].map(([k, v]) => [`privacyNotice.${k}`, v])),
      ...Object.fromEntries(draftTextKeys(cgu).map(([k, v]) => [`cguCitoyen.${k}`, v])) };
    const added = Object.keys(fr).filter((k) => /_v1[01]$/.test(k)).sort();
    expect(added).toEqual(['cguCitoyen.account.parcours_v10', 'privacyNotice.purposes.p17_v10', 'privacyNotice.retention.i14_v10', 'privacyNotice.retention.i14_v11', 'privacyNotice.retention.parcours_v10']);
    const figures = (/** @type {string} */ s) => (s.match(/\d+/g) || []).join(',');
    for (const lang of LANGS) {
      const tr = locale(lang);
      for (const k of added) {
        expect(typeof tr[k], `${lang} ${k}`).toBe('string');
        expect(claimsEntitlement(tr[k]), `${lang} ${k}`).toBe(false);
        const base = k.endsWith('i14_v10') ? tr['privacyNotice.retention.i14'] : k.endsWith('i14_v11') ? tr['privacyNotice.retention.i14_v9'] : null;
        if (base) { expect(base.length).toBeGreaterThan(tr[k].length); expect(tr[k].split(')')[1]).toBe(base.split(')')[1]); }
        else expect(figures(tr[k]), `${lang} ${k}`).toBe(figures(fr[k]));
      }
    }
  });

  it('approval by name: (a) Mon Parcours opening → cgu v10 + notice v10; (b) ADA Pro opening → notice v11; today’s value unchanged', () => {
    for (const t of ['cgu-citoyen@v10-2026-11-22', 'notice-confidentialite@v10-2026-11-22', 'notice-confidentialite@v11-2026-11-22']) expect(knownApprovalToken(t)).toBe(true);
    expect(knownApprovalToken('cgu-citoyen@v11-2026-11-22')).toBe(false);
    expect(approvedVersionOf('cgu-citoyen', OPEN_MP)).toBe(LEGAL_DRAFTS_V10);
    expect(approvedVersionOf(N, OPEN_MP)).toBe(LEGAL_DRAFTS_V10);
    expect(approvedVersionOf(N, OPEN_K8)).toBe(LEGAL_DRAFTS_V11);
    expect(approvedVersionOf('cgu-professionnel', OPEN_MP)).toBe('v8-2026-11-19');
    for (const v of [OPEN_MP, OPEN_K8]) {
      expect(citizenTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: v })).toBe(true);
      expect(draftVisibility(/** @type {any} */ (draftFor(N, prod(v))), prod(v))).toBe('IN_FORCE');
    }
    const now = 'cgu-citoyen@v7-2026-11-18,notice-confidentialite@v8-2026-11-19,cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19';
    expect(approvedVersionOf('cgu-citoyen', now)).toBe('v7-2026-11-18');
    expect(approvedVersionOf(N, now)).toBe('v8-2026-11-19');
    // the notice v11 is never in force by the Mon Parcours value (no ADA Pro text before K8)
    expect(draftFor(N, prod(OPEN_MP))?.version).toBe(LEGAL_DRAFTS_V10);
  });
});
