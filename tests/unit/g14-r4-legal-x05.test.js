/**
 * G14-R4 (24/11/2026, PROPOSED — drafts for the owner's approval, no lawyer or expert review claimed):
 *   - notice-confidentialite v15-2026-11-24 / cgu-citoyen v14-2026-11-24: shared dossiers at the HDS host (P30), attachments (P31), the Mon Coffre recovery
 *     code (P28), the job board X05 (P32), § 13 job listings; every new passage conditioned on its function being open; six languages, same figures;
 *   - release preflight legal.r4_texts + moderation reminder; X03 stays closed;
 *   - register lines T35–T37 (X02, X01, X05); moderation deadlines 24 h / 7 days in the queue.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../src/db/index.js', () => ({ db: {} }));

const L = await import('../../src/config/legal-drafts.js');
const { r4LegalChecks, evaluateReleasePreflight } = await import('../../scripts/release-preflight.mjs');
const { claimsEntitlement } = await import('../../api/lib/entitlementWording.js');
const { NOTICE_SLA_HOURS, noticeDueAt } = await import('../../api/_services/moderation-dsa.js');

const keys = (/** @type {any} */ d) => Object.fromEntries(L.draftTextKeys(d));
const n15 = keys(L.LEGAL_DRAFT_DOCUMENTS_R4_NOTICE[0]); const n14 = keys(L.LEGAL_DRAFT_DOCUMENTS_R3_NOTICE[0]);
const c14 = keys(L.LEGAL_DRAFT_DOCUMENTS_R4_CGU[0]); const c13 = keys(L.LEGAL_DRAFT_DOCUMENTS_R3_CGU[0]);
const NOTICE_CHANGED = ['purposes.p28_v15', 'purposes.p29_v15', 'purposes.p30_v15', 'purposes.p31_v15', 'purposes.p32_v15', 'retention.dossiers_v15', 'retention.attachments_v15',
  'retention.jobs_v15', 'recipients.dossiers_v15', 'processors.scalingo_v15', 'rights.r4_v15', 'moderation.p1_v15'];
const CGU_CHANGED = ['account.vault_v14', 'account.dossiers_v14', 'account.jobs_v14', 'appointments.messaging_v14'];

describe('notice v15 / cgu-citoyen v14 — NEW drafts on top of the release-3 drafts', () => {
  it('exactly the Release-4 passages change; everything else of v14 / v13 is kept word for word', () => {
    expect([L.LEGAL_DRAFTS_R4_NOTICE, L.LEGAL_DRAFTS_R4_CGU]).toEqual(['v15-2026-11-24', 'v14-2026-11-24']);
    expect(Object.keys(n15).filter((k) => n14[k] !== n15[k]).sort()).toEqual([...NOTICE_CHANGED].sort());
    expect(Object.keys(n14).filter((k) => !(k in n15)).sort()).toEqual(['moderation.p1_v12', 'processors.scalingo_v14', 'purposes.p28_v14', 'purposes.p29_v14']);
    expect(Object.keys(c14).filter((k) => c13[k] !== c14[k]).sort()).toEqual([...CGU_CHANGED].sort());
    expect(L.LEGAL_DRAFTS_R4_STATUS).toMatch(/^DRAFT — proposée le 24\/11\/2026/);
    expect(L.knownApprovalToken('notice-confidentialite@v15-2026-11-24')).toBe(true);
    expect(L.knownApprovalToken('cgu-citoyen@v14-2026-11-24')).toBe(true);
    expect(L.approvedVersionOf('notice-confidentialite', 'notice-confidentialite@v14-2026-11-24')).toBe('v14-2026-11-24');   // v14 stays approvable by name
    expect(L.approvedAtLeast('cgu-citoyen', 'v13-2026-11-24', 'cgu-citoyen@v14-2026-11-24')).toBe(true);
  });
  it('every new citizen-facing passage is conditioned on its function being open (true while closed)', () => {
    const OPEN = /\(lorsque cette fonction est ouverte\)|\(lorsqu'il est ouvert\)|lorsqu'ils sont ouverts|lorsque cette fonction est ouverte/;
    for (const k of ['purposes.p28_v15', 'purposes.p29_v15', 'purposes.p30_v15', 'purposes.p31_v15', 'purposes.p32_v15', 'processors.scalingo_v15', 'moderation.p1_v15']) expect(n15[k], k).toMatch(OPEN);
    for (const k of CGU_CHANGED) expect(c14[k], k).toMatch(OPEN);
  });
  it('facts of the code: end to end, HDS certificate, consent per organisation, re-encryption on withdrawal, nothing on applicants, recovery code', () => {
    const p30 = n15['purposes.p30_v15'];
    for (const rx of [/chiffré dans votre navigateur/, /38436/, /jamais pré-cochée/, /art\. 9, 2, a/, /chiffré à nouveau avec une nouvelle clé/, /rien n'est transmis sans votre accord/, /SIAO/]) expect(p30).toMatch(rx);
    expect(n15['purposes.p28_v15']).toMatch(/code de secours/); expect(n15['purposes.p28_v15']).toMatch(/à la fois votre phrase secrète et votre code de secours/);
    expect(n15['purposes.p29_v15']).not.toMatch(/pièces jointes ne sont pas ouvertes/);
    expect(n15['purposes.p32_v15']).toMatch(/n'enregistre rien sur les personnes qui consultent une offre ou qui postulent/);
    expect(n15['retention.jobs_v15']).toMatch(/30 jours.*12 mois.*6 mois/);
    expect(n15['retention.dossiers_v15']).toMatch(/proposée, à approuver/);
    expect(n15['moderation.p1_v15']).toMatch(/offres d'emploi/);
    expect(c14['account.vault_v14']).toMatch(/code de secours/);
    expect(c14['account.jobs_v14']).toMatch(/santé, un handicap, votre âge ou votre origine/);
    expect(L.SHARE_CONSENT_VERSION_PROPOSED).toMatch(/^[a-z0-9-]+@v[0-9][A-Za-z0-9.-]{0,40}$/);   // the format services/hds/src/config.js accepts
  });
  it('no entitlement wording, no claim of review; six languages with the same figures', () => {
    const fr = { ...Object.fromEntries(NOTICE_CHANGED.map((k) => [`privacyNotice.${k}`, n15[k]])), ...Object.fromEntries(CGU_CHANGED.map((k) => [`cguCitoyen.${k}`, c14[k]])) };
    for (const [k, t] of Object.entries(fr)) { expect(claimsEntitlement(t), k).toBe(false); expect(t, k).not.toMatch(/avocat|juriste|expert/i); }
    const digits = (/** @type {string} */ t) => (t.match(/\d+/g) || []).join(',');
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      const loc = JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
      for (const [k, t] of Object.entries(fr)) { expect(typeof loc[k], `${lang} ${k}`).toBe('string'); expect(digits(loc[k]), `${lang} ${k}`).toBe(digits(t)); }
    }
  });
});

describe('release preflight — Release-4 texts, X01 / X02 / X05 and the moderation reminder', () => {
  const get = (/** @type {Record<string, string>} */ e) => (/** @type {string} */ k) => String(e[k] ?? '').trim();
  const base = { ADA_CAPABILITY_ENFORCEMENT: '1' };
  it('nothing open: no line; X05 open under older texts: FAIL; with notice v15 / cgu v14: PASS and the named-moderator reminder', () => {
    expect(r4LegalChecks(base, { get: get(base) })).toEqual([]);
    const jobs = { ...base, ADA_CAPABILITIES_OPEN: 'community.employment', VITE_LEGAL_DOCS_APPROVED_VERSION: 'cgu-citoyen@v12-2026-11-23,notice-confidentialite@v13-2026-11-23' };
    const r1 = r4LegalChecks(jobs, { get: get(jobs) });
    expect(r1[0]).toEqual(['legal.r4_texts', 'FAIL', expect.stringMatching(/notice-confidentialite@v15-2026-11-24.*cgu-citoyen@v14-2026-11-24/)]);
    expect(r1.find((x) => x[0] === 'moderation.named_moderator')?.[1]).toBe('WARN');
    const ok = { ...jobs, VITE_LEGAL_DOCS_APPROVED_VERSION: 'cgu-citoyen@v14-2026-11-24,notice-confidentialite@v15-2026-11-24' };
    expect(r4LegalChecks(ok, { get: get(ok) })[0][1]).toBe('PASS');
  });
  it('X01 / X02 need only the expansion texts (v12 or later); X03 opened is a FAIL', () => {
    const st = { ...base, ADA_CAPABILITIES_OPEN: 'community.stories,community.testimonials', VITE_LEGAL_DOCS_APPROVED_VERSION: 'cgu-citoyen@v12-2026-11-23,notice-confidentialite@v13-2026-11-23' };
    expect(r4LegalChecks(st, { get: get(st) })[0][1]).toBe('PASS');
    const x3 = { ...base, ADA_CAPABILITIES_OPEN: 'community.entraide' };
    expect(r4LegalChecks(x3, { get: get(x3) })).toContainEqual(['moderation.entraide_closed', 'FAIL', expect.any(String)]);
    expect(evaluateReleasePreflight(st).find((/** @type {any} */ x) => x.id === 'legal.r4_texts')?.status).toBe('PASS');
  });
});

describe('register T35–T37 and the moderation deadlines', () => {
  it('X02, X01, X05 lines: closed, AIPD line not signed, named moderator, durations decided but steps not approved; X05 stores nothing on applicants', () => {
    const reg = JSON.parse(readFileSync('REGISTRE_RGPD.json', 'utf8'));
    const t = (/** @type {string} */ id) => reg.traitements.find((/** @type {any} */ x) => x.id === id);
    for (const id of ['T35', 'T36', 'T37']) { expect(t(id).statut).toMatch(/fermée/); expect(t(id).statut).toMatch(/ligne AIPD X0[125] non signée/); expect(t(id).statut).toMatch(/modérateur nommé requis/); }
    expect(t('T37').mesures_securite).toMatch(/Aucun formulaire de candidature, aucun compteur de clics/);
    expect(t('T03').statut_r4).toMatch(/G14-R4/);
    expect(new Set(reg.traitements.map((/** @type {any} */ x) => x.id)).size).toBe(reg.traitements.length);
  });
  it('urgent notices are due in 24 hours, the others in 7 days (charter § 5, notice § 13)', () => {
    expect(NOTICE_SLA_HOURS).toEqual({ urgent: 24, trusted: 168, ordinary: 168 });
    const at = '2026-11-24T10:00:00.000Z';
    expect(noticeDueAt({ priority: 'urgent', createdAt: at }).toISOString()).toBe('2026-11-25T10:00:00.000Z');
    expect(noticeDueAt({ priority: 'ordinary', createdAt: at }).toISOString()).toBe('2026-12-01T10:00:00.000Z');
    expect(noticeDueAt({ priority: 'unknown', createdAt: at }).toISOString()).toBe('2026-12-01T10:00:00.000Z');
  });
});
