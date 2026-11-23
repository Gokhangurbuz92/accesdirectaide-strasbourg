// @vitest-environment jsdom
/**
 * G4 notice (19/11/2026) — v8-2026-11-19 of the privacy notice (notice-confidentialite). v8 = v7 + exactly two changes:
 *  - § 11 p3: « elle fournit votre nom » removed (ProUser has no name column); what a professional account holds, the invitation, the acceptance of the
 *    professional terms recorded with its version in the ledger (api/_utils/pro-terms.js);
 *  - § 3 p3 (new): /droits and the browser-only orientation compute in the browser, send no answer, store nothing; only the host's ordinary logs of page
 *    requests remain (already described: P1 and § 4 « Journaux techniques des prestataires »).
 * v6 / v7 of the notice unchanged byte for byte; the citizen terms stay at v7. Diff: CONTROL/v2/V8_NOTICE_FARKI_FR.md.
 */
import '@testing-library/jest-dom/vitest';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEGAL_DRAFT_DOCUMENTS_V6, LEGAL_DRAFT_DOCUMENTS_V7, LEGAL_DRAFT_DOCUMENTS_V8, LEGAL_DRAFT_STATUS, LEGAL_DRAFTS_V7, LEGAL_DRAFTS_V8,
  LEGAL_DRAFTS_V8_BROWSER_ONLY_PARAGRAPH, LEGAL_DRAFTS_V8_PRO_ACCOUNT_PARAGRAPH, approvedAtLeast, approvedVersionOf, draftFor, draftTextKeys, draftVisibility,
  latestDraftVersionOf,
} from '../../src/config/legal-drafts.js';
import { proTermsInForce } from '../../api/_utils/pro-terms.js';
import { citizenTermsInForce } from '../../api/_utils/terms-in-force.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { checkLegalPublisher } from '../../scripts/check-legal-publisher.mjs';

const ID = 'notice-confidentialite';
/** the value the owner sets to put the notice v8 in force (with the professional documents v8, citizen terms v7) */
const APPROVED = 'cgu-citoyen@v7-2026-11-18,notice-confidentialite@v8-2026-11-19,cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19';
const ONLY_V7 = 'cgu-citoyen@v7-2026-11-18,notice-confidentialite@v7-2026-11-18';
const LANGS = ['en', 'de', 'tr', 'ar', 'uk'];
const locale = (/** @type {string} */ lang) => JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
const doc = (/** @type {any[]} */ set) => /** @type {any} */ (set.find((d) => d.id === ID));
const v6 = doc(LEGAL_DRAFT_DOCUMENTS_V6); const v7 = doc(LEGAL_DRAFT_DOCUMENTS_V7); const v8 = doc(LEGAL_DRAFT_DOCUMENTS_V8);
const keys = (/** @type {any} */ d) => Object.fromEntries(draftTextKeys(d));
const section = (/** @type {any} */ d, /** @type {string} */ id) => d.sections.find((/** @type {any} */ s) => s.id === id);
/** « your name » in each language */
const NAME = { fr: /votre nom\b/i, en: /your name\b/i, de: /Ihren Namen/, tr: /adınız/i, ar: /اسمك/, uk: /ваше ім'я|ім'я/i };
const sha = (/** @type {unknown} */ v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const prod = (/** @type {string | undefined} */ approved) => ({ approved, production: true });
const prodEnv = (/** @type {string} */ approved) => ({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: approved });

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules(); vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token'); });

describe('privacy notice v8-2026-11-19 — exactly two changes', () => {
  it('v8 of the notice exists, still a draft; v6 / v7 of the notice unchanged byte for byte; the citizen terms stay at v7', () => {
    expect(v8.version).toBe(LEGAL_DRAFTS_V8);
    expect(v8.status).toBe(LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL);
    expect(latestDraftVersionOf(ID)).toBe('v14-2026-11-24');   // G14-R3 (24/11/2026): v14 proposed   // G14 expansion (23/11/2026): v12 / v13 are newer   // G14 (22/11/2026): v10 (v8 + Mon Parcours) and v11 (v9 + Mon Parcours, for K8) are newer   // G8 (19/11/2026): v9 (professional accounts) is newer; v8 stays approvable by name (tests/unit/g8-notice-v9.test.jsx)
    expect(latestDraftVersionOf('cgu-citoyen')).toBe('v13-2026-11-24');   // G14-R3: v13-2026-11-24 proposed; G14: cgu-citoyen v10 (Mon Parcours), then v12 (expansion)
    // hashes taken from the commit before this change (8d05312)
    expect(sha(v7)).toBe('4ac5e148ef8a26337c40545a0f249c7c660546b21d0be8cce110adc3c35470e6');
    expect(sha(v6)).toBe('f7cb5dec60ab2186797f89eaf64de5780f7e07221ba4b521c7e627ebf37d8966');
    expect(keys(v7)['art14.p3']).toContain('elle fournit votre nom');   // what v6 / v7 say; v8 corrects it
  });

  it('v8 = v7 except § 3 p3 (new) and § 11 p3 (replaced), each with its own translation key', () => {
    const a = keys(v7); const b = keys(v8);
    expect(Object.keys(b).filter((k) => a[k] !== b[k]).sort()).toEqual(['art14.p3_v8', 'purposes.p3_v8']);
    expect(Object.keys(a).filter((k) => !(k in b))).toEqual(['art14.p3']);
    expect(draftTextKeys(v8).length).toBe(draftTextKeys(v7).length + 1);
    expect(b['purposes.p3_v8']).toBe(LEGAL_DRAFTS_V8_BROWSER_ONLY_PARAGRAPH);
    expect(b['art14.p3_v8']).toBe(LEGAL_DRAFTS_V8_PRO_ACCOUNT_PARAGRAPH);
    expect(section(v8, 'purposes').paras.slice(0, 2)).toEqual(section(v7, 'purposes').paras);
    // nothing about functions that are not open (Mon Parcours, events)
    for (const t of [LEGAL_DRAFTS_V8_BROWSER_ONLY_PARAGRAPH, LEGAL_DRAFTS_V8_PRO_ACCOUNT_PARAGRAPH]) {
      expect(t).not.toMatch(/parcours|événement|evenement|agenda/i);
      expect(claimsEntitlement(t)).toBe(false);
    }
  });

  it('§ 11 p3 lists what a professional account holds — checked against the code', () => {
    const p = LEGAL_DRAFTS_V8_PRO_ACCOUNT_PARAGRAPH;
    expect(p).not.toMatch(/\bnom\b/i);
    for (const part of ['adresse électronique professionnelle', 'votre rôle', 'votre structure', 'mot de passe sous forme hachée (irréversible)',
      'secret de votre double authentification', 'journal de vos actions', 'préférences de notification', 'enregistrée avec leur version', 'Les sections 3 à 8 s\'appliquent aussi à vous.']) expect(p).toContain(part);
    const schema = readFileSync('src/db/schema.ts', 'utf8');
    const proUser = schema.slice(schema.indexOf("export const ProUser = pgTable('ProUser'"), schema.indexOf('}, (ProUser) =>'));
    for (const col of ["email: text('email')", "password_hash: text('password_hash')", "role: text('role')", "structureId: text('structureId')", "mfa_secret: text('mfa_secret')", 'notificationPrefs']) expect(proUser).toContain(col);
    expect(proUser).not.toMatch(/\b(name|nom|prenom|firstName|lastName|displayName)\s*:/i);
    expect(readFileSync('api/_utils/password-hash.js', 'utf8')).toMatch(/crypto\.scrypt\(/);   // one-way hash
    // the invitation: a structure administrator or the platform (the operator)
    expect(readFileSync('api/_handlers/pro/invite.js', 'utf8')).toMatch(/requireProRole\(handler, \[AUTH_ROLE\.STRUCTURE_ADMIN, AUTH_ROLE\.SUPERADMIN\]\)/);
    // the acceptance « document@version » in the ledger, a structure administrator also accepts the structure conditions, never a GDPR consent
    const proTerms = readFileSync('api/_utils/pro-terms.js', 'utf8');
    expect(proTerms).toContain("import { ConsentLog }");
    expect(proTerms).toContain("role === 'STRUCTURE_ADMIN' ? ['cgu-professionnel', 'conditions-structures'] : ['cgu-professionnel']");
    expect(proTerms).toMatch(/CONTRACT_ACCEPTANCE \(a contract acceptance, never read as a GDPR consent\)/);
    expect(p).toContain("ce n'est pas un consentement au sens du RGPD");
  });

  it('§ 3 p3: /droits and the browser-only orientation — no answer sent, nothing stored; the host logs it refers to are described where it says', () => {
    const p = LEGAL_DRAFTS_V8_BROWSER_ONLY_PARAGRAPH;
    for (const part of ['(/droits)', '(/orientation)', 'entièrement dans votre navigateur', "n'envoient aucune de vos réponses à AccesDirectAide", "n'enregistrent rien, ni chez nous ni sur votre appareil",
      'journaux techniques habituels de l\'hébergeur sur les pages demandées', 'P1 ci-dessus', 'section 4, « Journaux techniques des prestataires »']) expect(p).toContain(part);
    expect(section(v8, 'purposes').items[0]).toMatch(/^P1 — Fonctionnement et sécurité du site public \(journaux techniques/);
    expect(section(v8, 'retention').title).toBe('4. Durées de conservation');
    expect(section(v8, 'retention').items.some((/** @type {string} */ x) => x.startsWith("Journaux techniques des prestataires : l'hébergeur (Vercel) garde ses journaux d'exécution"))).toBe(true);
    // the page names match the pages (rights page header, orientation route)
    expect(readFileSync('src/pages/Droits.jsx', 'utf8')).toContain("'Explorer les droits par besoin'");
    expect(p).toContain('« Explorer les droits par besoin »');
  });

  it('no « votre nom » in § 11 p3 in any language; in the whole v8 notice the only one left is § 9 (the citizen\'s own name sent with a future booking request)', () => {
    const fr = keys(v8);
    expect(Object.keys(fr).filter((k) => NAME.fr.test(fr[k]))).toEqual(['booking.p2']);
    for (const lang of LANGS) {
      const tr = locale(lang);
      for (const [k, frText] of draftTextKeys(v8)) {
        const key = `${v8.key}.${k}`;
        expect(tr[key], `${lang} ${key}`).toBeTruthy();
        // § 11 p1 (directory: « parfois le nom d'un responsable » of a structure, unchanged) is not about the reader's own account
        if (k === 'art14.p3_v8') expect(tr[key], `${lang} ${key}`).not.toMatch(/** @type {any} */ (NAME)[lang]);
        if (k.endsWith('_v8')) {
          const ph = (/** @type {string} */ v) => (v.match(/\{\{\w+\}\}|\/droits|\/orientation|P1|\b4\b/g) || []).sort();
          expect(ph(tr[key]), `${lang} ${key}`).toEqual(ph(frText));
          if (k.startsWith('purposes.')) expect(tr[key], `${lang} ${key}`).toContain('AccesDirectAide');
        }
      }
      expect(Object.keys(tr).filter((k) => k.startsWith(`${v8.key}.`) && k.endsWith('_v8')).sort(), lang).toEqual([`${v8.key}.art14.p3_v8`, `${v8.key}.purposes.p3_v8`]);
    }
  });
});

describe('notice v8 approval', () => {
  it(`Production with ${APPROVED}: the notice v8 is in force; citizen and professional sign-ups open; the publisher knows every token`, () => {
    const d = /** @type {any} */ (draftFor(ID, prod(APPROVED)));
    expect(d.version).toBe(LEGAL_DRAFTS_V8);
    expect(draftVisibility(d, prod(APPROVED))).toBe('IN_FORCE');
    expect(approvedVersionOf(ID, APPROVED)).toBe(LEGAL_DRAFTS_V8);
    expect(approvedVersionOf('cgu-citoyen', APPROVED)).toBe(LEGAL_DRAFTS_V7);
    expect(citizenTermsInForce(prodEnv(APPROVED))).toBe(true);
    expect(proTermsInForce(prodEnv(APPROVED))).toBe(true);
    // the restore-history copy (announced since v7) stays legally announced under v8
    expect(approvedAtLeast(ID, LEGAL_DRAFTS_V7, APPROVED)).toBe(true);
    expect(checkLegalPublisher({ VITE_LEGAL_DOCS_APPROVED_VERSION: APPROVED }, { defaults: [] }).find((/** @type {any} */ x) => x.id === 'legal.approved_versions_known')).toBeUndefined();
  });

  it('only v7 named: v7 is still served (v8 not in force); an approval of v7 does not carry over to v8', () => {
    const d = /** @type {any} */ (draftFor(ID, prod(ONLY_V7)));
    expect(d.version).toBe(LEGAL_DRAFTS_V7);
    expect(draftVisibility(d, prod(ONLY_V7))).toBe('IN_FORCE');
    expect(citizenTermsInForce(prodEnv(ONLY_V7))).toBe(true);
    expect(draftFor(ID, prod('notice-confidentialite@v6-2026-11-17'))?.version).toBe('v6-2026-11-17');
    expect(draftVisibility(v8, prod(ONLY_V7))).toBe('HIDDEN');
  });
});

/** renders the notice page with the current (stubbed) environment */
async function renderNotice(/** @type {string} */ lang = 'fr') {
  vi.resetModules();
  const { setLanguage } = await import('../../src/i18n/index.js');
  await setLanguage(lang, { persist: false });
  const mod = await import('../../src/pages/LegalDraftDocument.jsx');
  return render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/confidentialite/notice'] }, createElement(mod.default))));
}

describe('notice v8 rendering (LegalDraftDocument.jsx)', () => {
  it('Production with v8 named: in force, both v8 paragraphs, no « votre nom » in § 11', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', APPROVED);
    const { container } = await renderNotice();
    expect(screen.queryByTestId('legal-draft-banner')).toBeNull();
    expect(container.querySelector('[data-legal-draft-state]')?.getAttribute('data-legal-draft-state')).toBe('IN_FORCE');
    expect(container.querySelector('[data-legal-draft-version]')).toHaveTextContent(`${ID}@${LEGAL_DRAFTS_V8}`);
    expect(container.textContent).toContain(LEGAL_DRAFTS_V8_BROWSER_ONLY_PARAGRAPH);
    expect(container.textContent).toContain(LEGAL_DRAFTS_V8_PRO_ACCOUNT_PARAGRAPH);
    expect(container.querySelector(`[aria-labelledby="${ID}-art14"]`)?.textContent).not.toMatch(/votre nom/);
  });

  it('Production with only v7 named: the v7 text, without the v8 paragraphs', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', ONLY_V7);
    const { container } = await renderNotice();
    expect(container.querySelector('[data-legal-draft-version]')).toHaveTextContent(`${ID}@${LEGAL_DRAFTS_V7}`);
    expect(container.textContent).not.toContain(LEGAL_DRAFTS_V8_BROWSER_ONLY_PARAGRAPH);
    expect(container.textContent).toContain(keys(v7)['art14.p3']);
  });

  it('English and Arabic: the v8 page renders the versioned translations, never « your name » in § 11', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', APPROVED);
    for (const lang of ['en', 'ar']) {
      const { container } = await renderNotice(lang);
      expect(container.textContent).toContain(locale(lang)['privacyNotice.purposes.p3_v8']);
      expect(container.textContent).toContain(locale(lang)['privacyNotice.art14.p3_v8']);
      expect(locale(lang)['privacyNotice.art14.p3_v8']).not.toMatch(/** @type {any} */ (NAME)[lang]);
      expect(container.textContent).not.toContain(locale(lang)['privacyNotice.art14.p3']);
      cleanup();
    }
  });
});
