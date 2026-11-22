/**
 * Legal drafts v7-2026-11-18 (owner, 18/11/2026; diff CONTROL/v2/V7_METIN_FARKI_FR.md) — v7 = v6 + THREE appended sentences of the privacy notice
 * (the third closes a v6 gap: the § 6 Upstash entry now names the erasure traces § 4 places at Upstash):
 * § 4 « Historique de restauration » (the encrypted second copy of the erasure trace at Cloudflare, D5 b) and the Cloudflare entry of § 6 (provider-role
 * consistency §§ 3 / 5 / 6 required by the owner; §§ 3 and 5 list no storage per provider). v6 and v7 COEXIST, each approvable by
 * name; v7 stays a draft until approved by name; the tombstone copy is written only while the approved notice is v7 or later (fail closed).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGAL_DRAFT_DOCUMENTS_V6, LEGAL_DRAFT_DOCUMENTS_V7, LEGAL_DRAFTS_V6, LEGAL_DRAFTS_V7, LEGAL_DRAFTS_V7_SENTENCE, LEGAL_DRAFTS_V7_PROCESSOR_SENTENCE, LEGAL_DRAFTS_V7_UPSTASH_SENTENCE, LEGAL_DRAFTS_VERSION, LEGAL_DRAFT_VERSIONS,
  LEGAL_NOTICE_VARIANT_DOCUMENT_V6, LEGAL_NOTICE_VARIANT_DOCUMENT_V7, LEGAL_DRAFT_STATUS, draftFor, draftByPath, draftVisibility, approvedVersionOf, approvedAtLeast } from '../../src/config/legal-drafts.js';
import { citizenTermsInForce } from '../../api/_utils/terms-in-force.js';
import { termsReference } from '../../api/_utils/terms-acceptance.js';
import { copyWriteConfig, tombstoneCopyFromEnv } from '../../api/_services/erasure-tombstone-copy.js';
import { checkLegalPublisher } from '../../scripts/check-legal-publisher.mjs';

const LANGS = ['en', 'tr', 'ar', 'de', 'uk'];
const locale = (/** @type {string} */ lang) => JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
const V6 = `cgu-citoyen@${LEGAL_DRAFTS_V6},notice-confidentialite@${LEGAL_DRAFTS_V6}`;
const V7 = `cgu-citoyen@${LEGAL_DRAFTS_V7},notice-confidentialite@${LEGAL_DRAFTS_V7}`;
const figures = (/** @type {string} */ t) => (String(t).replace(/يوم واحد|سنة واحدة/g, ' 1 ').match(/\d+/g) || []).sort().join(',');
const COPY = { TOMBSTONE_COPY_S3_ENDPOINT: 'https://abc123.eu.r2.cloudflarestorage.com', TOMBSTONE_COPY_S3_BUCKET: 'ada-erasure-tombstones',
  TOMBSTONE_COPY_S3_ACCESS_KEY_ID: 'id', TOMBSTONE_COPY_S3_SECRET_ACCESS_KEY: 'secret', TOMBSTONE_COPY_KEY: 'ab'.repeat(32) };

describe('legal drafts v7-2026-11-18 — v6 + one sentence', () => {
  it('two approvable versions; v7 is the newest draft, still pending approval', () => {
    // G4 (19/11/2026): v8 follows, for the two professional documents only (g4-pro-terms-v8.test.js); v7 stays the citizen / notice version
    expect(LEGAL_DRAFT_VERSIONS).toEqual(['v6-2026-11-17', 'v7-2026-11-18', 'v8-2026-11-19', 'v9-2026-11-19', 'v9-2026-11-22']);   // G8: v9 = the privacy notice only; G14: v9-2026-11-22 = the professional terms only
    expect(LEGAL_DRAFTS_VERSION).toBe('v7-2026-11-18');
    for (const d of [...LEGAL_DRAFT_DOCUMENTS_V7, LEGAL_NOTICE_VARIANT_DOCUMENT_V7]) { expect(d.version).toBe(LEGAL_DRAFTS_V7); expect(d.status).toBe(LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL); }
    for (const d of [...LEGAL_DRAFT_DOCUMENTS_V6, LEGAL_NOTICE_VARIANT_DOCUMENT_V6]) expect(d.version).toBe(LEGAL_DRAFTS_V6);
  });
  it('the ONLY differences are the sentences appended to § 4 « Historique de restauration » and to the Upstash and Cloudflare entries of § 6', () => {
    const strip = (/** @type {any} */ docs, /** @type {string} */ v) => JSON.parse(JSON.stringify(docs).replaceAll(v, 'V'));
    const a = strip(LEGAL_DRAFT_DOCUMENTS_V6, LEGAL_DRAFTS_V6); const b = strip(LEGAL_DRAFT_DOCUMENTS_V7, LEGAL_DRAFTS_V7);
    const nb = b.find((/** @type {any} */ d) => d.id === 'notice-confidentialite'); const na = a.find((/** @type {any} */ d) => d.id === 'notice-confidentialite');
    const rb = nb.sections.find((/** @type {any} */ s) => s.id === 'retention'); const ra = na.sections.find((/** @type {any} */ s) => s.id === 'retention');
    expect(rb.items[12]).toBe(`${ra.items[12]} ${LEGAL_DRAFTS_V7_SENTENCE}`);
    expect(ra.items[12]).toContain('chez Upstash (Francfort).');
    expect(LEGAL_DRAFTS_V7_SENTENCE).toBe("Une seconde copie chiffrée de cette trace, que Cloudflare ne peut pas lire, est gardée 40 jours chez Cloudflare dans l'Union européenne.");
    const pb = nb.sections.find((/** @type {any} */ s) => s.id === 'processors'); const pa = na.sections.find((/** @type {any} */ s) => s.id === 'processors');
    expect(pa.items[5]).toMatch(/^Scaleway SAS \(France\) et Cloudflare, Inc\. : copies de sauvegarde/);
    expect(pb.items[5]).toBe(`${pa.items[5]} ${LEGAL_DRAFTS_V7_PROCESSOR_SENTENCE}`);
    expect(LEGAL_DRAFTS_V7_PROCESSOR_SENTENCE).toBe("Cloudflare garde aussi, dans l'Union européenne et sans pouvoir la lire, la seconde copie chiffrée des traces d'effacement (section 4).");
    // §§ 3 and 5 unchanged (they list no storage per provider)
    for (const id of ['purposes', 'recipients']) expect(nb.sections.find((/** @type {any} */ s) => s.id === id)).toEqual(na.sections.find((/** @type {any} */ s) => s.id === id));
    expect(pa.items[2]).toBe('Upstash, Inc. : compteurs de sécurité et limitation du nombre de requêtes, à Francfort.');
    expect(pb.items[2]).toBe(`${pa.items[2]} ${LEGAL_DRAFTS_V7_UPSTASH_SENTENCE}`);
    expect(LEGAL_DRAFTS_V7_UPSTASH_SENTENCE).toBe("Upstash garde aussi, à Francfort, les traces d'effacement (section 4).");
    expect(ra.items[12]).toMatch(/trace de chaque effacement[^.]*chez Upstash \(Francfort\)\./);   // what § 4 says, now consistent with § 6
    rb.items[12] = ra.items[12]; delete rb.itemKeys; pb.items[5] = pa.items[5]; pb.items[2] = pa.items[2]; delete pb.itemKeys;
    expect(b).toEqual(a);
  });
  it('six languages: the extended items are translated (« i13_v7 » / « i6_v7 » = the v6 translation + the sentence, same figures); v6 keys unchanged', () => {
    const notice = LEGAL_DRAFT_DOCUMENTS_V7.find((d) => d.id === 'notice-confidentialite');
    const fr = notice.sections.find((s) => s.id === 'retention'); const fp = notice.sections.find((s) => s.id === 'processors');
    expect(fr.itemKeys).toEqual({ 12: 'i13_v7' }); expect(fp.itemKeys).toEqual({ 2: 'i3_v7', 5: 'i6_v7' });
    for (const lang of LANGS) {
      const t = locale(lang);
      expect(t['privacyNotice.processors.i6_v7'].startsWith(`${t['privacyNotice.processors.i6']} `), lang).toBe(true);
      expect(figures(t['privacyNotice.processors.i6_v7']), lang).toBe(figures(fp.items[5]));
      expect(t['privacyNotice.processors.i6_v7'].split('Cloudflare').length, lang).toBeGreaterThan(t['privacyNotice.processors.i6'].split('Cloudflare').length);
      expect(t['privacyNotice.processors.i3_v7'].startsWith(`${t['privacyNotice.processors.i3']} `), lang).toBe(true);
      expect(figures(t['privacyNotice.processors.i3_v7']), lang).toBe(figures(fp.items[2]));
      expect(t['privacyNotice.processors.i3_v7'].split('Upstash').length, lang).toBe(3);
    }
    for (const lang of LANGS) {
      const t = locale(lang);
      expect(t['privacyNotice.retention.i13_v7'].startsWith(`${t['privacyNotice.retention.i13']} `), lang).toBe(true);
      expect(figures(t['privacyNotice.retention.i13_v7']), lang).toBe(figures(fr.items[12]));
      expect(t['privacyNotice.retention.i13_v7'], lang).toMatch(/Cloudflare[\s\S]*Cloudflare/);
      expect(t['privacyNotice.retention.i13'], lang).not.toContain('Cloudflare');
    }
  });
});

describe('v7 — approval by name, coexistence with v6', () => {
  it('Production: nothing approved → hidden; v6 approved → v6 in force; v7 approved → v7; both → the newest', () => {
    const ctx = (/** @type {string | undefined} */ approved) => ({ approved, production: true });
    expect(draftVisibility(draftFor('notice-confidentialite', ctx(undefined)), ctx(undefined))).toBe('HIDDEN');
    expect(draftFor('notice-confidentialite', ctx(V6)).version).toBe(LEGAL_DRAFTS_V6);
    expect(draftVisibility(draftFor('notice-confidentialite', ctx(V6)), ctx(V6))).toBe('IN_FORCE');
    expect(draftFor('notice-confidentialite', ctx(V7)).version).toBe(LEGAL_DRAFTS_V7);
    expect(draftFor('notice-confidentialite', ctx(`${V6},${V7}`)).version).toBe(LEGAL_DRAFTS_V7);
    expect(draftByPath('/confidentialite/notice', ctx(V6)).version).toBe(LEGAL_DRAFTS_V6);
    expect(draftByPath('/confidentialite/notice').version).toBe('v9-2026-11-19');   // G4 notice v8, then G8 notice v9 (19/11/2026): the newest draft (tests/unit/g8-notice-v9.test.jsx)
    expect(approvedVersionOf('notice-confidentialite', V6)).toBe(LEGAL_DRAFTS_V6);
    expect(approvedVersionOf('notice-confidentialite', 'v5-2026-11-15')).toBe(null);
  });
  it('sign-up opens on v6 OR v7 and records the version in force', () => {
    for (const a of [V6, V7]) expect(citizenTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: a })).toBe(true);
    expect(citizenTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: 'v5-2026-11-15' })).toBe(false);
    expect(termsReference({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: V6 })).toBe(`cgu-citoyen@${LEGAL_DRAFTS_V6}`);
    expect(termsReference({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: V7 })).toBe(`cgu-citoyen@${LEGAL_DRAFTS_V7}`);
    expect(termsReference({})).toBe(`cgu-citoyen@${LEGAL_DRAFTS_V7}`);
  });
  it('the legal publisher knows both versions (no « unknown token » warning for v6 or v7)', () => {
    for (const a of [V6, V7]) {
      const out = checkLegalPublisher({ VITE_LEGAL_DOCS_APPROVED_VERSION: a }, { defaults: [] });
      expect(out.find((/** @type {any} */ x) => x.id === 'legal.approved_versions_known')).toBeUndefined();
    }
  });
});

describe('v7 — the tombstone copy is written only while the approved notice is v7 or later (fail closed)', () => {
  it('variables present, notice v6 or none approved → OFF with COPY_LEGAL_VERSION_NOT_APPROVED; v7 → on', () => {
    for (const approved of [undefined, '', V6, `notice-confidentialite@${LEGAL_DRAFTS_V6}`, `cgu-citoyen@${LEGAL_DRAFTS_V7}`]) {
      expect(copyWriteConfig({ ...COPY, VITE_LEGAL_DOCS_APPROVED_VERSION: approved }), String(approved)).toEqual({ enabled: false, invalid: true, reason: 'COPY_LEGAL_VERSION_NOT_APPROVED' });
      expect(tombstoneCopyFromEnv({ ...COPY, VITE_LEGAL_DOCS_APPROVED_VERSION: approved })).toBe(null);
    }
    for (const approved of [V7, `${V6},${V7}`, LEGAL_DRAFTS_V7]) expect(copyWriteConfig({ ...COPY, VITE_LEGAL_DOCS_APPROVED_VERSION: approved }).enabled).toBe(true);
    expect(approvedAtLeast('notice-confidentialite', LEGAL_DRAFTS_V7, V7)).toBe(true);
    expect(approvedAtLeast('notice-confidentialite', 'v99-2099-01-01', V7)).toBe(false);
    // no variables: off and silent, whatever the notice
    expect(copyWriteConfig({ VITE_LEGAL_DOCS_APPROVED_VERSION: V6 })).toEqual({ enabled: false, invalid: false });
  });
});
