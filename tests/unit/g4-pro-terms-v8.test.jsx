// @vitest-environment jsdom
/**
 * G4 (19/11/2026) — legal drafts v8-2026-11-19 for the TWO professional documents only (cgu-professionnel, conditions-structures), for the planned
 * opening of the ADA Pro accounts (invitation only, double authentication, structure administration only; appointments, messages and the assistant closed).
 *  - cgu-professionnel § 5: no « votre nom » (ProUser has no name column) — the exact list of what the account holds; « vos créneaux » only once open.
 *  - cgu-professionnel § 4: appointments conditional, no assistant claim (no AI runs in Production).
 *  - conditions-structures: intro / § 2 / § 3 p1 / § 4 i1 i5 no longer describe closed functions as working.
 *  - v6 and v7 unchanged byte for byte; the citizen terms and the A-I / A-II variant stay at v7 (no v8 of them exists; the privacy notice joined v8
 *    later the same day: tests/unit/g4-notice-v8.test.jsx).
 *  - Production: v8 in force only when VITE_LEGAL_DOCS_APPROVED_VERSION names it; proTermsInForce follows.
 * Diff: CONTROL/v2/V8_METIN_FARKI_FR.md.
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
  LEGAL_DRAFT_DOCUMENTS, LEGAL_DRAFT_DOCUMENTS_V6, LEGAL_DRAFT_DOCUMENTS_V7, LEGAL_DRAFT_DOCUMENTS_V8, LEGAL_DRAFT_STATUS, LEGAL_DRAFT_VERSIONS, LEGAL_DRAFTS_V7,
  LEGAL_DRAFTS_V8, LEGAL_DRAFTS_V8_DOCUMENT_IDS, LEGAL_NOTICE_VARIANT_DOCUMENT, LEGAL_NOTICE_VARIANT_DOCUMENT_V6, approvedVersionOf, draftFor, draftTextKeys,
  draftVisibility, knownApprovalToken, latestDraftVersionOf,
} from '../../src/config/legal-drafts.js';
import { proTermsInForce, proTermsReference } from '../../api/_utils/pro-terms.js';
import { citizenTermsInForce } from '../../api/_utils/terms-in-force.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { checkLegalPublisher } from '../../scripts/check-legal-publisher.mjs';

/** the two professional documents (the privacy notice joined v8 later: tests/unit/g4-notice-v8.test.jsx) */
const PRO_IDS = ['cgu-professionnel', 'conditions-structures'];
const PROD_NOW = 'cgu-citoyen@v7-2026-11-18,notice-confidentialite@v7-2026-11-18';
const WITH_V8 = `${PROD_NOW},cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19`;
const LANGS = ['en', 'de', 'tr', 'ar', 'uk'];
const locale = (/** @type {string} */ lang) => JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
const v8 = (/** @type {string} */ id) => /** @type {any} */ (LEGAL_DRAFT_DOCUMENTS_V8.find((d) => d.id === id));
const v7 = (/** @type {string} */ id) => /** @type {any} */ (LEGAL_DRAFT_DOCUMENTS_V7.find((d) => d.id === id));
const frText = (/** @type {any} */ d) => draftTextKeys(d).map(([, t]) => t).join('\n');
/** « your name » in each language (the v6 wording the v8 removes) */
const NAME = { fr: /votre nom\b/i, en: /your name\b/i, de: /Ihren Namen/, tr: /adınız/i, ar: /اسمك/, uk: /ваше ім'я|ім'я/i };
const sha = (/** @type {unknown} */ v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const prod = (/** @type {string | undefined} */ approved) => ({ approved, production: true });

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules(); vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token'); });

describe('legal drafts v8-2026-11-19 — the professional documents only', () => {
  it('three approvable versions; v8 has exactly the two professional documents, still drafts; the others stay at v7', () => {
    expect(LEGAL_DRAFT_VERSIONS).toEqual(['v6-2026-11-17', 'v7-2026-11-18', 'v8-2026-11-19', 'v9-2026-11-19', 'v9-2026-11-22']);   // G8: v9 = the privacy notice only; G14: v9-2026-11-22 = the professional terms only
    expect(LEGAL_DRAFT_DOCUMENTS_V8.map((d) => d.id)).toEqual(['cgu-professionnel', 'conditions-structures', 'notice-confidentialite']);
    expect([...LEGAL_DRAFTS_V8_DOCUMENT_IDS]).toEqual(['cgu-professionnel', 'conditions-structures', 'notice-confidentialite']);
    for (const d of LEGAL_DRAFT_DOCUMENTS_V8) { expect(d.version).toBe(LEGAL_DRAFTS_V8); expect(d.status).toBe(LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL); }
    expect(LEGAL_DRAFT_DOCUMENTS.map((d) => `${d.id}@${d.version}`)).toEqual(['cgu-citoyen@v7-2026-11-18', 'cgu-professionnel@v9-2026-11-22', 'conditions-structures@v8-2026-11-19', 'notice-confidentialite@v9-2026-11-19']);   // G8: the notice's newest draft is v9; G14: the professional terms' is v9-2026-11-22 (tests/unit/g14-cgu-pro-v9.test.jsx)
    expect(LEGAL_NOTICE_VARIANT_DOCUMENT.version).toBe(LEGAL_DRAFTS_V7);
    for (const id of ['cgu-citoyen', LEGAL_NOTICE_VARIANT_DOCUMENT.id]) expect(latestDraftVersionOf(id)).toBe(LEGAL_DRAFTS_V7);
  });

  it('v6 and v7 are unchanged byte for byte (hashes taken from the commit before v8)', () => {
    expect(sha([LEGAL_DRAFT_DOCUMENTS_V6, LEGAL_NOTICE_VARIANT_DOCUMENT_V6])).toBe('8bcfabbb012be087016bdbe92c8a9251a01643d79d309efa869d2780b0b23650');
    expect(sha(LEGAL_DRAFT_DOCUMENTS_V7)).toBe('caafe227266e15020005862c7f3f31ba3a0428e649044470ebd527936ea9ae52');
    // the v6 / v7 wording is still there for those versions (it is what they say; v8 corrects it)
    expect(frText(v7('cgu-professionnel'))).toContain('la plateforme traite votre nom');
  });

  it('v8 = v7 except the listed changes, each with its own translation key', () => {
    const diff = (/** @type {string} */ id) => {
      const a = Object.fromEntries(draftTextKeys(v7(id))); const b = Object.fromEntries(draftTextKeys(v8(id)));
      return Object.keys(b).filter((k) => a[k] !== b[k]).sort();
    };
    expect(diff('cgu-professionnel')).toEqual(['appointments.p1_v8', 'appointments.p2_v8', 'appointments.title_v8', 'data.p1_v8']);
    expect(diff('conditions-structures')).toEqual(['agreement.p1_v8', 'agreement.title_v8', 'commitments.i1_v8', 'commitments.i5_v8', 'intro_v8', 'roles.p1_v8']);
    for (const id of PRO_IDS) expect(draftTextKeys(v8(id)).length).toBe(draftTextKeys(v7(id)).length);
  });

  it('cgu-professionnel § 5 lists exactly what a professional account holds — no name (ProUser has no name column)', () => {
    const schema = readFileSync('src/db/schema.ts', 'utf8');
    const proUser = schema.slice(schema.indexOf("export const ProUser = pgTable('ProUser'"), schema.indexOf('}, (ProUser) =>'));
    expect(proUser).toContain("email: text('email')");
    expect(proUser).not.toMatch(/\b(name|nom|prenom|firstName|lastName|displayName)\s*:/i);
    const p1 = v8('cgu-professionnel').sections.find((/** @type {any} */ s) => s.id === 'data').paras[0];
    for (const part of ['adresse électronique professionnelle', 'votre rôle', 'votre structure', 'mot de passe sous forme hachée', 'secret de votre double authentification', 'journal de vos actions', 'préférences de notification']) expect(p1).toContain(part);
    expect(p1).toMatch(/Lorsque la prise de rendez-vous est ouverte pour votre structure, elle traite aussi vos créneaux\./);
  });

  it('cgu-professionnel § 4: appointments conditional, no assistant (no AI in Production)', () => {
    const s = v8('cgu-professionnel').sections.find((/** @type {any} */ x) => x.id === 'appointments');
    expect(s.title).toBe('4. Rendez-vous (pas encore ouverts)');
    expect(s.paras[0]).toMatch(/^La prise de rendez-vous n'est pas encore ouverte\. Lorsqu'elle est ouverte pour votre structure, /);
    expect(frText(v8('cgu-professionnel'))).not.toMatch(/assistant|brouillon/i);
    // § 3 « N'ouvrez les informations d'une personne… » kept as a rule
    expect(frText(v8('cgu-professionnel'))).toContain("N'ouvrez les informations d'une personne que lorsque c'est nécessaire à sa demande.");
  });

  it('conditions-structures: no structure receives requests today; closed functions are conditional; facts kept', () => {
    const t = frText(v8('conditions-structures'));
    expect(t).toContain('Aucune structure ne les a signées à ce jour.');
    expect(t).not.toMatch(/qui reçoivent des demandes de rendez-vous|Pour recevoir des demandes de rendez-vous, une convention écrite est signée/);
    expect(t).toContain('2. Raccordement aux rendez-vous (pas encore ouvert)');
    expect(t).toMatch(/Lorsque la prise de rendez-vous sera ouverte : répondre aux demandes/);
    expect(t).toMatch(/Lorsque le message joint à une demande sera ouvert : appliquer le retrait/);
    expect(t).toContain('FINESS, data·inclusion');
    expect(t).toContain('est fermée à ce jour');
  });

  it('no « votre nom » in the v8 professional documents, in any language; every key translated with the same placeholders; no entitlement claim', () => {
    for (const id of PRO_IDS) {
      expect(frText(v8(id))).not.toMatch(NAME.fr);
      expect(claimsEntitlement(frText(v8(id)))).toBe(false);
      for (const lang of LANGS) {
        const tr = locale(lang);
        for (const [k, fr] of draftTextKeys(v8(id))) {
          const key = `${v8(id).key}.${k}`;
          expect(tr[key], `${lang} ${key}`).toBeTruthy();
          const ph = (/** @type {string} */ v) => (v.match(/\{\{\w+\}\}/g) || []).sort();
          expect(ph(tr[key]), `${lang} ${key}`).toEqual(ph(fr));
          expect(tr[key], `${lang} ${key}`).not.toMatch(/** @type {any} */ (NAME)[lang]);
          expect(tr[key], `${lang} ${key}`).not.toMatch(/assistant|Assistent|asistan|помічник|المساعد/i);
        }
      }
    }
  });
});

describe('v8 approval: Production, LAB, professional sign-up', () => {
  it('Production today (citizen + notice v7): the professional documents are not in force and proTermsInForce fails', () => {
    for (const id of PRO_IDS) expect(draftVisibility(/** @type {any} */ (draftFor(id, prod(PROD_NOW))), prod(PROD_NOW))).toBe('HIDDEN');
    expect(proTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: PROD_NOW })).toBe(false);
    expect(citizenTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: PROD_NOW })).toBe(true);
  });

  it('with v8 added: in force at v8, proTermsInForce passes, the sign-up records v8; the citizen documents stay at v7', () => {
    for (const id of PRO_IDS) {
      const d = /** @type {any} */ (draftFor(id, prod(WITH_V8)));
      expect(d.version).toBe(LEGAL_DRAFTS_V8); expect(draftVisibility(d, prod(WITH_V8))).toBe('IN_FORCE');
      expect(approvedVersionOf(id, WITH_V8)).toBe(LEGAL_DRAFTS_V8);
    }
    expect(proTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: WITH_V8 })).toBe(true);
    expect(proTermsReference('conditions-structures', { VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: WITH_V8 })).toBe('conditions-structures@v8-2026-11-19');
    expect(proTermsReference('conditions-structures', { VERCEL_ENV: 'preview' })).toBe('conditions-structures@v8-2026-11-19');   // G14: cgu-professionnel's newest draft is v9-2026-11-22
    expect(approvedVersionOf('cgu-citoyen', WITH_V8)).toBe(LEGAL_DRAFTS_V7);
    expect(approvedVersionOf('notice-confidentialite', WITH_V8)).toBe(LEGAL_DRAFTS_V7);
    // one professional document alone is not enough; an approval of v6 / v7 does not carry over to v8
    expect(proTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: `${PROD_NOW},cgu-professionnel@v8-2026-11-19` })).toBe(false);
    expect(draftFor('cgu-professionnel', prod(`${PROD_NOW},cgu-professionnel@${LEGAL_DRAFTS_V7}`))?.version).toBe(LEGAL_DRAFTS_V7);
  });

  it('LAB preview shows the v8 professional drafts and the v7 citizen drafts', () => {
    const lab = { preview: '1', production: false };
    expect(draftFor('conditions-structures', lab)?.version).toBe(LEGAL_DRAFTS_V8);   // G14: cgu-professionnel's newest draft is v9-2026-11-22
    expect(draftFor('cgu-citoyen', lab)?.version).toBe(LEGAL_DRAFTS_V7);
    expect(draftVisibility(/** @type {any} */ (draftFor('conditions-structures', lab)), lab)).toBe('PREVIEW');
  });

  it('the legal publisher knows the v8 professional tokens and warns on a v8 of a document that has none', () => {
    expect(knownApprovalToken('cgu-professionnel@v8-2026-11-19')).toBe(true);
    expect(knownApprovalToken('cgu-citoyen@v8-2026-11-19')).toBe(false);
    const known = (/** @type {string} */ a) => checkLegalPublisher({ VITE_LEGAL_DOCS_APPROVED_VERSION: a }, { defaults: [] }).find((/** @type {any} */ x) => x.id === 'legal.approved_versions_known');
    expect(known(WITH_V8)).toBeUndefined();
    expect(known(`${WITH_V8},cgu-citoyen@v8-2026-11-19`)?.status).toBe('WARN');
  });
});

/** renders the page with the current (stubbed) environment, optionally in another language */
async function renderPage(/** @type {string} */ path, /** @type {string} */ lang = 'fr') {
  vi.resetModules();
  const { setLanguage } = await import('../../src/i18n/index.js');
  await setLanguage(lang, { persist: false });
  const mod = await import('../../src/pages/LegalDraftDocument.jsx');
  return render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] }, createElement(mod.default))));
}

describe('v8 rendering (LegalDraftDocument.jsx)', () => {
  it('LAB preview: v8 with the « Projet — non approuvé » banner', async () => {
    vi.stubEnv('VITE_LEGAL_DRAFT_PREVIEW', '1');
    const { container } = await renderPage('/cgu/professionnel');
    expect(screen.getByTestId('legal-draft-banner')).toHaveTextContent('Projet — non approuvé');
    expect(screen.getByTestId('legal-draft-banner')).toHaveTextContent('cgu-professionnel@v9-2026-11-22');   // G14: the newest draft (v9 keeps the v8 § 4)
    expect(container.textContent).toContain('4. Rendez-vous (pas encore ouverts)');
    expect(container.textContent).not.toMatch(/la plateforme traite votre nom|assistant/);
  });

  it('Production with v8 named: in force, no banner, v8 text; without it: hidden', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', WITH_V8);
    let r = await renderPage('/conditions-structures');
    expect(screen.queryByTestId('legal-draft-banner')).toBeNull();
    expect(r.container.querySelector('[data-legal-draft-state]')?.getAttribute('data-legal-draft-state')).toBe('IN_FORCE');
    expect(r.container.querySelector('[data-legal-draft-version]')).toHaveTextContent('conditions-structures@v8-2026-11-19');
    expect(r.container.textContent).toContain('2. Raccordement aux rendez-vous (pas encore ouvert)');
    cleanup();
    vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', PROD_NOW);
    r = await renderPage('/cgu/professionnel');
    expect(screen.getByTestId('legal-draft-hidden')).toBeInTheDocument();
  });

  it('English: the v8 page renders the v8 translations (versioned keys), never « your name »', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', WITH_V8);
    const { container } = await renderPage('/cgu/professionnel', 'en');
    expect(container.textContent).toContain('4. Appointments (not open yet)');
    expect(container.textContent).toContain(locale('en')['cguPro.data.p1_v8']);
    expect(container.textContent).not.toMatch(/your name|assistant/i);
  });

  it('English, v7 approved: the v7 page keeps the v7 translation', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', `${PROD_NOW},cgu-professionnel@${LEGAL_DRAFTS_V7}`);
    const { container } = await renderPage('/cgu/professionnel', 'en');
    expect(container.textContent).toContain(locale('en')['cguPro.data.p1']);
  });
});
