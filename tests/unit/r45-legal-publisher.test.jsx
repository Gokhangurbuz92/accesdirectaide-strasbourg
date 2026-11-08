// @vitest-environment jsdom
/**
 * R45 (ENG-LR-4 / ENG-LR-5) — LCEN publisher variant (A-I / A-II), its build guard, and the draft state of the new legal documents.
 * Synthetic values only: the address « 1 rue de l'Exemple 00000 Testville » and the telephone « 01 00 00 00 00 » are invented test data.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkLegalPublisher, findAddressPatterns, readLegalDefaults } from '../../scripts/check-legal-publisher.mjs';
import { resolvePublisherConfig, HOST, A_I_APPROVAL_TOKEN } from '../../src/config/legal-publisher.js';
import { LEGAL_DRAFT_DOCUMENTS, LEGAL_DRAFTS_VERSION, LEGAL_NOTICE_VARIANT_DOCUMENT, LEGAL_DRAFT_STATUS, draftVisibility } from '../../src/config/legal-drafts.js';
import { ENTITLEMENT_CLAIMS } from '../../scripts/i18n-check.mjs';

const FAKE_ADDRESS = "1 rue de l'Exemple 00000 Testville";
const FAKE_PHONE = '01 00 00 00 00';
const fails = (/** @type {any[]} */ r) => r.filter((x) => x.status === 'FAIL').map((x) => x.id);
const clean = { defaults: [] };

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules(); vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token'); });

describe('R45 build guard (scripts/check-legal-publisher.mjs)', () => {
  it('unset mode (Production today) passes and is the current rendering', () => {
    expect(fails(checkLegalPublisher({}, clean))).toEqual([]);
    expect(resolvePublisherConfig({}).mode).toBe('UNSET');
  });
  it('an unknown mode fails the build and is treated as unset at run time', () => {
    expect(fails(checkLegalPublisher({ VITE_LEGAL_PUBLISHER_MODE: 'identified' }, clean))).toContain('legal.publisher_mode_known');
    expect(resolvePublisherConfig({ VITE_LEGAL_PUBLISHER_MODE: 'identified' }).mode).toBe('UNSET');
  });
  it('A_II with a domicile or a telephone in the build environment fails', () => {
    for (const k of ['LEGAL_A_I_PUBLISHER_DOMICILE', 'LEGAL_A_I_PUBLISHER_PHONE']) {
      const r = checkLegalPublisher({ VITE_LEGAL_PUBLISHER_MODE: 'A_II', VITE_LEGAL_HOST_PHONE: '+1 000', [k]: k.endsWith('PHONE') ? FAKE_PHONE : FAKE_ADDRESS }, clean);
      expect(fails(r)).toEqual(['legal.identification_only_when_approved']);
      expect(JSON.stringify(r)).not.toContain('Testville');   // never prints a value
      expect(JSON.stringify(r)).not.toContain(FAKE_PHONE);
    }
    // also with no mode at all
    expect(fails(checkLegalPublisher({ LEGAL_A_I_PUBLISHER_DOMICILE: FAKE_ADDRESS }, clean))).toContain('legal.identification_only_when_approved');
  });
  it('A_I without the separate owner approval fails (and an approximate approval value does not count)', () => {
    const base = { VITE_LEGAL_PUBLISHER_MODE: 'A_I', VITE_LEGAL_HOST_PHONE: '+1 000', LEGAL_A_I_PUBLISHER_DOMICILE: FAKE_ADDRESS, LEGAL_A_I_PUBLISHER_PHONE: FAKE_PHONE };
    expect(fails(checkLegalPublisher(base, clean))).toEqual(expect.arrayContaining(['legal.a_i_owner_approval', 'legal.identification_only_when_approved']));
    expect(fails(checkLegalPublisher({ ...base, VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED: 'yes' }, clean))).toContain('legal.a_i_approval_value');
    expect(fails(checkLegalPublisher({ ...base, VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED: A_I_APPROVAL_TOKEN }, clean))).toEqual([]);
    expect(fails(checkLegalPublisher({ VITE_LEGAL_PUBLISHER_MODE: 'A_I', VITE_LEGAL_HOST_PHONE: '+1 000', VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED: A_I_APPROVAL_TOKEN }, clean))).toContain('legal.a_i_identification_complete');
  });
  it('the host telephone is not verified (Vercel publishes none): A_I and A_II fail until VITE_LEGAL_HOST_PHONE is set; A_II without contact is a warning', () => {
    const r = checkLegalPublisher({ VITE_LEGAL_PUBLISHER_MODE: 'A_II' }, clean);
    expect(fails(r)).toEqual(['legal.host_phone_verified']);
    expect(r.find((x) => x.id === 'legal.publication_contact')?.status).toBe('WARN');
    expect(fails(checkLegalPublisher({ VITE_LEGAL_PUBLISHER_MODE: 'A_II', VITE_LEGAL_HOST_PHONE: '+1 000', VITE_LEGAL_PUBLICATION_CONTACT_EMAIL: 'publication@example.test' }, clean))).toEqual([]);
  });
  it('a VITE_LEGAL_* variable that carries an address or a telephone fails (it could reach the public bundle)', () => {
    expect(fails(checkLegalPublisher({ VITE_LEGAL_PUBLISHER_DOMICILE: FAKE_ADDRESS }, clean))).toContain('legal.no_public_address_variable');
    expect(fails(checkLegalPublisher({ VITE_LEGAL_PUBLISHER_IDENTITY: `Personne Test, ${FAKE_ADDRESS}` }, clean))).toContain('legal.public_values_no_address');
    expect(fails(checkLegalPublisher({ VITE_LEGAL_CONTROLLER_IDENTITY: `Personne Test — ${FAKE_PHONE}` }, clean))).toContain('legal.public_values_no_address');
    expect(fails(checkLegalPublisher({ VITE_LEGAL_PUBLISHER_IDENTITY: 'Personne Test (personne physique)' }, clean))).toEqual([]);
  });
  it('a Production build never shows a draft: unapproved A-I / A-II text or the LAB preview switch fail', () => {
    const prod = { VERCEL_ENV: 'production', VITE_LEGAL_PUBLISHER_MODE: 'A_II', VITE_LEGAL_HOST_PHONE: '+1 000', VITE_LEGAL_PUBLICATION_CONTACT_EMAIL: 'publication@example.test' };
    expect(fails(checkLegalPublisher(prod, clean))).toEqual(['legal.variant_text_approved']);
    expect(fails(checkLegalPublisher({ ...prod, VITE_LEGAL_DOCS_APPROVED_VERSION: `${LEGAL_NOTICE_VARIANT_DOCUMENT.id}@${LEGAL_DRAFTS_VERSION}` }, clean))).toEqual([]);
    expect(fails(checkLegalPublisher({ VERCEL_ENV: 'production', VITE_LEGAL_DRAFT_PREVIEW: '1' }, clean))).toEqual(['legal.no_draft_preview_in_production']);
    expect(fails(checkLegalPublisher({ VITE_LEGAL_DRAFT_PREVIEW: '1' }, clean))).toEqual([]);   // LAB
  });
  it('detects a postal-address-like or telephone-like pattern in the legal defaults, the providers\' business addresses excepted', () => {
    expect(findAddressPatterns(FAKE_ADDRESS)).toEqual(expect.arrayContaining(['street_fr', 'postcode_city']));
    expect(findAddressPatterns('12 avenue des Tests, 67000 Strasbourg')).not.toEqual([]);
    expect(findAddressPatterns(`appelez le ${FAKE_PHONE}`)).toEqual(['phone_fr']);
    expect(findAddressPatterns(`Vercel Inc., ${HOST.address}`)).toEqual([]);
    expect(findAddressPatterns('Databricks, Inc., 160 Spear Street, Suite 1300, San Francisco, CA 94105, États-Unis')).toEqual([]);
    expect(findAddressPatterns('1 an ou 2 ans ; 24 mois ; loi n° 2004-575 du 21 juin 2004 ; 75 000 euros')).toEqual([]);
    expect(fails(checkLegalPublisher({}, { defaults: [{ file: 'x.js', text: `export const D = '${FAKE_ADDRESS}'` }] }))).toEqual(['legal.defaults_no_postal_address']);
  });
  it('the real legal defaults and translations of the repository contain no address or telephone', () => {
    const files = readLegalDefaults();
    expect(files.length).toBeGreaterThanOrEqual(16);
    expect(files.map((f) => f.file)).toEqual(expect.arrayContaining(['src/config/legal-documents.js', 'src/config/legal-drafts.js', 'src/i18n/locales/ar/legaldraft.json', '.env.example']));
    expect(files.flatMap(({ file, text }) => findAddressPatterns(text).map((id) => `${file}:${id}`))).toEqual([]);
  });
  it('is wired into every Vercel build, the CI workflow and package.json', () => {
    expect(readFileSync('scripts/vercel-build.mjs', 'utf8')).toMatch(/run\('node scripts\/check-legal-publisher\.mjs'\);\s*\n\s*\n\/\/ Step 1/);
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('run: node scripts/check-legal-publisher.mjs');
    expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts['check:legal-publisher']).toBe('node scripts/check-legal-publisher.mjs');
  });
});

describe('R45 publisher resolution (src/config/legal-publisher.js)', () => {
  it('A_I is effective only with the approval; the identification then comes from the build-only variables', () => {
    const base = { VITE_LEGAL_PUBLISHER_MODE: 'A_I', LEGAL_A_I_PUBLISHER_DOMICILE: FAKE_ADDRESS, LEGAL_A_I_PUBLISHER_PHONE: FAKE_PHONE };
    const off = resolvePublisherConfig(base);
    expect(off.mode).toBe('UNSET'); expect(off.identification).toBeNull(); expect(off.missing).toContain('a_i_owner_approval');
    const on = resolvePublisherConfig({ ...base, VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED: A_I_APPROVAL_TOKEN });
    expect(on.mode).toBe('A_I'); expect(on.identification).toEqual({ domicile: FAKE_ADDRESS, phone: FAKE_PHONE });
    // in a Vite build only the injection counts: a null injection publishes nothing even if the variables are present
    expect(resolvePublisherConfig({ ...base, VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED: A_I_APPROVAL_TOKEN }, { injected: null }).identification).toBeNull();
  });
  it('A_II never carries an identification; publication contact « en cours de désignation » and readiness false until F5 and the host telephone exist', () => {
    const r = resolvePublisherConfig({ VITE_LEGAL_PUBLISHER_MODE: 'A_II', LEGAL_A_I_PUBLISHER_DOMICILE: FAKE_ADDRESS, LEGAL_A_I_PUBLISHER_PHONE: FAKE_PHONE });
    expect(r.mode).toBe('A_II'); expect(r.identification).toBeNull();
    expect(r.publicationContactLabel).toBe('en cours de désignation'); expect(r.ready).toBe(false);
    expect(r.missing).toEqual(['host_phone', 'publication_contact']);
    expect(r.host.phone).toMatch(/^\[À COMPLÉTER : téléphone de l'hébergeur/);
    const ok = resolvePublisherConfig({ VITE_LEGAL_PUBLISHER_MODE: 'A_II', VITE_LEGAL_HOST_PHONE: '+1 000', VITE_LEGAL_PUBLICATION_CONTACT_EMAIL: 'publication@example.test' });
    expect(ok.ready).toBe(true); expect(ok.publicationContact).toBe('publication@example.test');
  });
  it('the host is Vercel Inc. at the address its privacy policy publishes (source and read date recorded)', () => {
    expect(HOST).toMatchObject({ name: 'Vercel Inc.', address: '440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis', source: 'https://vercel.com/legal/privacy-policy', sourceRead: '2026-11-05' });
  });
});

describe('R45 draft documents (src/config/legal-drafts.js)', () => {
  it('every draft is DRAFT_PENDING_OWNER_APPROVAL with the shared version, and four documents exist', () => {
    expect(LEGAL_DRAFT_DOCUMENTS.map((d) => d.id)).toEqual(['cgu-citoyen', 'cgu-professionnel', 'conditions-structures', 'notice-confidentialite']);
    for (const d of [...LEGAL_DRAFT_DOCUMENTS, LEGAL_NOTICE_VARIANT_DOCUMENT]) {
      expect(d.status).toBe(LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL); expect(d.version).toBe(LEGAL_DRAFTS_VERSION);
    }
  });
  it('visibility: hidden in Production unless approved; preview only outside Production; an approval names id@version or the version', () => {
    const d = LEGAL_DRAFT_DOCUMENTS[0];
    expect(draftVisibility(d, { production: true })).toBe('HIDDEN');
    expect(draftVisibility(d, { production: true, preview: '1' })).toBe('HIDDEN');
    expect(draftVisibility(d, { production: false })).toBe('HIDDEN');
    expect(draftVisibility(d, { production: false, preview: '1' })).toBe('PREVIEW');
    expect(draftVisibility(d, { production: true, approved: `${d.id}@${d.version}` })).toBe('IN_FORCE');
    expect(draftVisibility(d, { production: true, approved: `x, ${LEGAL_DRAFTS_VERSION}` })).toBe('IN_FORCE');
    expect(draftVisibility(d, { production: true, approved: `${d.id}@r44-old` })).toBe('HIDDEN');
    expect(draftVisibility(LEGAL_DRAFT_DOCUMENTS[1], { production: true, approved: `${d.id}@${d.version}` })).toBe('HIDDEN');
  });
  const notice = LEGAL_DRAFT_DOCUMENTS.find((d) => d.id === 'notice-confidentialite');
  const text = (/** @type {any} */ d) => [d.title, d.intro, ...d.sections.flatMap((s) => [s.title, ...(s.items || []), ...(s.paras || [])])].join('\n');
  it('the privacy notice covers art. 13 / 14: controller as natural person without address, P1–P16 proposed, A7 pending, processors, transfers, rights, CNIL, booking, sensitive services, art. 14 sources', () => {
    const t = text(notice);
    expect(t).toContain('{{controller}}, personne physique');
    for (const p of ['P1 ', 'P2 ', 'P2b', 'P3 ', 'P4 ', 'P4p', 'P5 ', 'P5s', 'P6 ', 'P7 ', 'P8 ', 'P9 ', 'P10a', 'P10b/P10c', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16']) expect(t, p).toContain(`${p.trim()} —`);
    // Release B (D2 V2): the account purposes (P1, P2, P2b, P3, P10a, P12–P16) are a section of their own, without the « proposed » badge; the later-wave
    // purposes stay proposed (3 bis) with the retention periods (D4 is not approved)
    expect(notice.sections.filter((s) => s.proposed).map((s) => s.id)).toEqual(['purposes-later', 'retention']);
    const v2 = notice.sections.find((s) => s.id === 'purposes');
    expect((v2.items || []).map((x) => x.split(' — ')[0])).toEqual(['P1', 'P2', 'P2b', 'P3', 'P10a', 'P12', 'P13', 'P14', 'P15', 'P16']);
    expect(t).toContain('ne sont pas des consentements au sens du RGPD');
    expect(t).toContain('Aucun numéro de téléphone n\'est demandé');
    expect(t).toContain('aucune information de ce type n\'est demandée');
    expect(t).not.toMatch(/consentement explicite \(art\. 9, 2, a\) si une préférence révèle un handicap/);
    expect(t).toContain('1 an après la date du rendez-vous, puis anonymisation');   // A7 = 365 days: the owner's conditional preference (08/11/2026)
    expect(t).not.toContain('choix en attente');
    for (const w of ['Vercel Inc.', 'Neon', 'Upstash', "Mailjet (groupe Sinch) : envoi des e-mails de service (vérification de l'adresse", 'États-Unis', 'à tout moment', 'CNIL', 'responsable de son propre traitement', 'La réservation de ces services est fermée', 'FINESS', 'data·inclusion', 'Annuaire de l\'administration']) expect(t, w).toContain(w);
    expect(t).toMatch(/Aucun délégué à la protection des données n'est désigné/);
    expect(t).not.toMatch(/SIRET|SIREN|association inscrite|DPO\b|partenaire signé/i);
  });
  it('the terms say free service, no entitlement decision, AI limits, structure confirms, deletion, lawful liability, French law and mediation « à vérifier »', () => {
    const c = text(LEGAL_DRAFT_DOCUMENTS[0]);
    for (const w of ['Le service est gratuit', 'Il ne prend aucune décision sur vos droits', 'Il peut se tromper', "C'est la structure qui confirme", 'suppression de votre compte', 'Aucune clause de ces conditions ne réduit les droits que la loi vous reconnaît', 'droit français', 'est à vérifier']) expect(c, w).toContain(w);
    // no abusive-clause style exclusions (consumer code L212-1; civil code 1171 to be checked by counsel)
    for (const d of LEGAL_DRAFT_DOCUMENTS) expect(text(d)).not.toMatch(/décline toute responsabilité|aucune responsabilité|en aucun cas responsable|sans préavis ni indemnité|tribunaux de Strasbourg seuls compétents/i);
    for (const d of LEGAL_DRAFT_DOCUMENTS) expect(text(d), d.id).toMatch(/version française de ce(?:s conditions| cette notice|tte notice)? est la seule juridiquement de référence|La version française de cette notice/);
  });
  it('no draft states an entitlement, invents an association, a registration, a DPO or a signed partner', () => {
    for (const d of LEGAL_DRAFT_DOCUMENTS) {
      const t = text(d);
      expect(t).not.toMatch(/vous avez droit|vous êtes éligible|vous recevrez/i);
      expect(t).toMatch(/Aucune association n'a été créée|Aucune structure ne les a signées/);
    }
  });
  it('the five translations have every key, the same {{placeholders}}, no empty value and no entitlement claim', () => {
    for (const lang of ['en', 'tr', 'ar', 'de', 'uk']) {
      const tr = JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
      expect(tr['frenchReference'], lang).toBeTruthy(); expect(tr['badge.proposed'], lang).toBeTruthy();
      for (const d of LEGAL_DRAFT_DOCUMENTS) {
        const pairs = [[`${d.key}.title`, d.title], [`${d.key}.intro`, d.intro]];
        for (const s of d.sections) {
          pairs.push([`${d.key}.${s.id}.title`, s.title]);
          (s.items || []).forEach((x, i) => pairs.push([`${d.key}.${s.id}.i${i + 1}`, x]));
          (s.paras || []).forEach((x, i) => pairs.push([`${d.key}.${s.id}.p${i + 1}`, x]));
        }
        for (const [k, fr] of pairs) {
          expect(tr[k], `${lang} ${k}`).toBeTruthy();
          const ph = (/** @type {string} */ v) => (v.match(/\{\{\w+\}\}/g) || []).sort();
          expect(ph(tr[k]), `${lang} ${k}`).toEqual(ph(fr));
          expect(tr[k], `${lang} ${k}`).not.toMatch(ENTITLEMENT_CLAIMS[lang]);
        }
      }
    }
  });
});

/** renders a page with the current (stubbed) environment */
async function renderPage(/** @type {string} */ file, /** @type {string} */ path = '/') {
  vi.resetModules();
  const mod = await import(/* @vite-ignore */ `../../src/pages/${file}`);
  return render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] }, createElement(mod.default))));
}

describe('R45 legal notice rendering (MentionsLegales.jsx)', () => {
  it('unset: today\'s block, unchanged (project status, « personne physique », no variant, no host telephone line)', async () => {
    vi.stubEnv('VITE_LEGAL_PUBLISHER_IDENTITY', 'Personne Test (personne physique)');
    const { container } = await renderPage('MentionsLegales.jsx', '/mentions-legales');
    expect(screen.getByTestId('legal-project-status')).toBeInTheDocument();
    expect(screen.queryByTestId('legal-publisher-variant')).toBeNull();
    expect(screen.queryByTestId('legal-draft-banner')).toBeNull();
    expect((container.textContent.match(/personne physique/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(container.textContent).not.toMatch(/Droit de réponse/);
  });
  it('A_II (LAB preview): non-professional publisher, host name / address / telephone placeholder, contact « en cours de désignation », right of reply, banner; no domicile even if present in the environment', async () => {
    vi.stubEnv('VITE_LEGAL_PUBLISHER_MODE', 'A_II'); vi.stubEnv('VITE_LEGAL_DRAFT_PREVIEW', '1');
    vi.stubEnv('VITE_LEGAL_PUBLISHER_IDENTITY', 'Personne Test');
    vi.stubEnv('LEGAL_A_I_PUBLISHER_DOMICILE', FAKE_ADDRESS); vi.stubEnv('LEGAL_A_I_PUBLISHER_PHONE', FAKE_PHONE);
    const { container } = await renderPage('MentionsLegales.jsx', '/mentions-legales');
    const v = screen.getByTestId('legal-publisher-variant');
    expect(v.getAttribute('data-publisher-mode')).toBe('A_II');
    expect(screen.getByTestId('legal-draft-banner')).toHaveTextContent('Projet — non approuvé');
    expect(screen.getByTestId('legal-a2-anonymity')).toHaveTextContent("article 1-1, II de la loi n° 2004-575");
    expect(screen.getByTestId('legal-host-lcen')).toHaveTextContent('Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis');
    expect(screen.getByTestId('legal-host-lcen')).toHaveTextContent("[À COMPLÉTER : téléphone de l'hébergeur");
    expect(screen.getByTestId('legal-publication-contact')).toHaveTextContent('en cours de désignation');
    expect(screen.getByTestId('legal-right-of-reply')).toHaveTextContent('trois mois');
    expect(v.textContent).not.toContain('Personne Test');   // A-II: the name is not published in the legal notice (it is in the privacy notice)
    expect(container.textContent).not.toContain('Testville');
    expect(container.textContent).not.toContain(FAKE_PHONE);
  });
  it('A_II in a Production build without the text approval keeps today\'s block (fail-closed)', async () => {
    vi.stubEnv('VITE_LEGAL_PUBLISHER_MODE', 'A_II'); vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('VITE_LEGAL_DRAFT_PREVIEW', '1');
    await renderPage('MentionsLegales.jsx', '/mentions-legales');
    expect(screen.queryByTestId('legal-publisher-variant')).toBeNull();
    expect(screen.getByTestId('legal-project-status')).toBeInTheDocument();
  });
  it('A_I without the approval switch: the build check fails and the page never shows the domicile', async () => {
    const env = { VITE_LEGAL_PUBLISHER_MODE: 'A_I', VITE_LEGAL_DRAFT_PREVIEW: '1', LEGAL_A_I_PUBLISHER_DOMICILE: FAKE_ADDRESS, LEGAL_A_I_PUBLISHER_PHONE: FAKE_PHONE, VITE_LEGAL_HOST_PHONE: '+1 000' };
    expect(fails(checkLegalPublisher(env, clean))).toContain('legal.a_i_owner_approval');
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const { container } = await renderPage('MentionsLegales.jsx', '/mentions-legales');
    expect(screen.queryByTestId('legal-publisher-variant')).toBeNull();
    expect(screen.queryByTestId('legal-a1-domicile')).toBeNull();
    expect(container.textContent).not.toContain('Testville');
  });
  it('A_I with the approval switch: name, domicile and telephone come from the environment only', async () => {
    const env = { VITE_LEGAL_PUBLISHER_MODE: 'A_I', VITE_LEGAL_A_I_ADDRESS_PUBLICATION_APPROVED: A_I_APPROVAL_TOKEN, VITE_LEGAL_DRAFT_PREVIEW: '1',
      VITE_LEGAL_PUBLISHER_IDENTITY: 'Personne Test', LEGAL_A_I_PUBLISHER_DOMICILE: FAKE_ADDRESS, LEGAL_A_I_PUBLISHER_PHONE: FAKE_PHONE, VITE_LEGAL_HOST_PHONE: '+1 000 000 0000' };
    expect(fails(checkLegalPublisher(env, clean))).toEqual([]);
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    await renderPage('MentionsLegales.jsx', '/mentions-legales');
    expect(screen.getByTestId('legal-publisher-variant').getAttribute('data-publisher-mode')).toBe('A_I');
    expect(screen.getByTestId('legal-a1-domicile')).toHaveTextContent(FAKE_ADDRESS);
    expect(screen.getByTestId('legal-publisher-variant')).toHaveTextContent(FAKE_PHONE);
    expect(screen.getByTestId('legal-publisher-variant')).toHaveTextContent('Personne Test');
    expect(screen.getByTestId('legal-host-lcen')).toHaveTextContent('+1 000 000 0000');
    // the address exists only in the environment: never in the page source or the configuration
    for (const f of ['src/pages/MentionsLegales.jsx', 'src/config/legal-publisher.js', 'src/config/legal-documents.js']) expect(readFileSync(f, 'utf8')).not.toContain('Testville');
  });
});

describe('R45 draft documents rendering', () => {
  it('Production (not approved): the draft is not rendered, the page says « not in force » and links to the in-force pages; no draft link on /cgu', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const { container } = await renderPage('LegalDraftDocument.jsx', '/cgu/citoyen');
    expect(screen.getByTestId('legal-draft-hidden')).toBeInTheDocument();
    expect(container.textContent).not.toContain('Une demande de rendez-vous');
    cleanup();
    await renderPage('CGU.jsx', '/cgu');
    expect(screen.queryByTestId('legal-draft-links')).toBeNull();
  });
  it('LAB preview: banner « Projet — non approuvé », the proposed badge on purposes and retention, A7 pending; links listed on the privacy page', async () => {
    vi.stubEnv('VITE_LEGAL_DRAFT_PREVIEW', '1'); vi.stubEnv('VITE_LEGAL_CONTROLLER_IDENTITY', 'Personne Test');
    const { container } = await renderPage('LegalDraftDocument.jsx', '/confidentialite/notice');
    expect(screen.getByTestId('legal-draft-banner')).toHaveTextContent('Projet — non approuvé');
    expect(screen.getByTestId('legal-draft-banner')).toHaveTextContent(`notice-confidentialite@${LEGAL_DRAFTS_VERSION}`);
    expect(screen.getAllByTestId('legal-proposed-badge').length).toBe(LEGAL_DRAFT_DOCUMENTS.find((d) => d.id === 'notice-confidentialite').sections.filter((s) => s.proposed).reduce((n, s) => n + (s.items || []).length, 0));
    expect(screen.getAllByTestId('legal-proposed-badge')[0]).toHaveTextContent('proposé — en attente de validation du responsable');
    expect(container.textContent).toContain('1 an après la date du rendez-vous, puis anonymisation');
    expect(container.textContent).toContain('Le responsable du traitement est Personne Test, personne physique');
    expect(container.textContent).not.toMatch(/\{\{/);
    cleanup();
    await renderPage('Confidentialite.jsx', '/politique-confidentialite');
    const links = screen.getByTestId('legal-draft-links');
    for (const p of ['/cgu/citoyen', '/cgu/professionnel', '/conditions-structures', '/confidentialite/notice']) expect(links.querySelector(`a[href="${p}"]`)).not.toBeNull();
  });
  it('approved version: rendered in force, without the banner', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', `cgu-professionnel@${LEGAL_DRAFTS_VERSION}`);
    await renderPage('LegalDraftDocument.jsx', '/cgu/professionnel');
    expect(screen.queryByTestId('legal-draft-banner')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Conditions d'utilisation — professionnels");
  });
  it('the four routes exist and point at the draft page', () => {
    const idx = readFileSync('src/pages/index.jsx', 'utf8');
    for (const p of ['/cgu/citoyen', '/cgu/professionnel', '/conditions-structures', '/confidentialite/notice']) expect(idx).toContain(`<Route path="${p}" element={<LegalDraftDocument />} />`);
    for (const d of LEGAL_DRAFT_DOCUMENTS) expect(['/cgu/citoyen', '/cgu/professionnel', '/conditions-structures', '/confidentialite/notice']).toContain(d.path);
  });
});
