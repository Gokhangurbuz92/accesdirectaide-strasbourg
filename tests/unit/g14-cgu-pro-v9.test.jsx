// @vitest-environment jsdom
/**
 * G14 (22/11/2026) — cgu-professionnel v9-2026-11-22, a DRAFT for the opening of the `pro` surface (owner approved the notice v9-2026-11-19 on 22/11/2026:
 * proof of a professional's acceptance kept 12 months, disabled professional accounts erased by hand after 12 months).
 *  - the three v8 sentences that become false at the pro opening are gone; the corrected ones are present (French and the five translations);
 *  - retention and legal bases are those of the notice v9 (word for word where the notice says it);
 *  - video only « si la visioconférence est activée », no provider named;
 *  - NOT approved: Production keeps cgu-professionnel v8 in force and the sign-up records the APPROVED version only.
 * Owner sheet: CONTROL/master/G14_CGU_PRO_V9_ONAY_TR.md.
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
  LEGAL_DRAFT_DOCUMENTS, LEGAL_DRAFT_DOCUMENTS_V8, LEGAL_DRAFT_DOCUMENTS_V9, LEGAL_DRAFT_DOCUMENTS_V9_PRO, LEGAL_DRAFT_STATUS, LEGAL_DRAFT_VERSIONS,
  LEGAL_DRAFTS_V8, LEGAL_DRAFTS_V9_P4P, LEGAL_DRAFTS_V9_PRO, LEGAL_DRAFTS_V9_PRO_ACCOUNT_RETENTION, LEGAL_DRAFTS_V9_PRO_DOCUMENT_IDS, LEGAL_DRAFTS_CGU_PRO_V9_REPLACED,
  LEGAL_DRAFTS_V9_PRO_ACCOUNT_PARAGRAPH, approvedVersionOf, draftFor, draftTextKeys, draftVisibility, knownApprovalToken, latestDraftVersionOf,
} from '../../src/config/legal-drafts.js';
import { proTermsInForce, proTermsReference, recordProTermsAcceptance } from '../../api/_utils/pro-terms.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';

const ID = 'cgu-professionnel';
const LANGS = ['en', 'de', 'tr', 'ar', 'uk'];
/** Production after the owner's 22/11 approval of the notice v9 (cgu-professionnel still v8) */
const WITH_NOTICE_V9 = 'cgu-citoyen@v7-2026-11-18,notice-confidentialite@v9-2026-11-19,cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19';
const WITH_PRO_V9 = 'cgu-citoyen@v7-2026-11-18,notice-confidentialite@v9-2026-11-19,cgu-professionnel@v9-2026-11-22,conditions-structures@v8-2026-11-19';
const locale = (/** @type {string} */ lang) => JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
const v9 = /** @type {any} */ (LEGAL_DRAFT_DOCUMENTS_V9_PRO.find((d) => d.id === ID));
const v8 = /** @type {any} */ (LEGAL_DRAFT_DOCUMENTS_V8.find((d) => d.id === ID));
const frText = (/** @type {any} */ d) => draftTextKeys(d).map(([, t]) => t).join('\n');
const section = (/** @type {any} */ d, /** @type {string} */ id) => d.sections.find((/** @type {any} */ s) => s.id === id);
const sha = (/** @type {unknown} */ v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const prod = (/** @type {string | undefined} */ approved) => ({ approved, production: true });

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules(); vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token'); });

describe('cgu-professionnel v9-2026-11-22 — listed as a draft', () => {
  it('a new version for the professional terms only, a draft, the newest draft of that document; the others and v8 unchanged', () => {
    expect(LEGAL_DRAFTS_V9_PRO).toBe('v9-2026-11-22');
    // G14 merge: v10 / v11 (Mon Parcours: citizen terms and notice) come after it; v9-2026-11-22 follows v9-2026-11-19
    expect(LEGAL_DRAFT_VERSIONS.indexOf(LEGAL_DRAFTS_V9_PRO)).toBe(LEGAL_DRAFT_VERSIONS.indexOf('v9-2026-11-19') + 1);
    expect([...LEGAL_DRAFTS_V9_PRO_DOCUMENT_IDS]).toEqual([ID]);
    expect(LEGAL_DRAFT_DOCUMENTS_V9_PRO.map((d) => d.id)).toEqual([ID]);
    expect(v9.version).toBe(LEGAL_DRAFTS_V9_PRO);
    expect(v9.status).toBe(LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL);
    expect(v9.path).toBe('/cgu/professionnel');
    expect(latestDraftVersionOf(ID)).toBe('v11-2026-11-24');   // G14 ADA Pro opening: v10-2026-11-23, then the release-3 draft v11-2026-11-24 are newer (tests/unit/g14-legal-v12.test.js); v9 stays approvable by name
    expect(LEGAL_DRAFT_DOCUMENTS.map((d) => `${d.id}@${d.version}`)).toEqual(['cgu-citoyen@v13-2026-11-24', 'cgu-professionnel@v11-2026-11-24', 'conditions-structures@v9-2026-11-23', 'notice-confidentialite@v14-2026-11-24']);   // G14-R3 drafts (24/11/2026); G14 merge: Mon Parcours v10 / v11, expansion v12 / v13
    // hashes taken from the commit before this change (99a6c11)
    expect(sha(LEGAL_DRAFT_DOCUMENTS_V8)).toBe('adc97403b2533d6b534d933c46ddac666ae1f967f5957ffd136a61c79c1451bb');
    expect(sha(LEGAL_DRAFT_DOCUMENTS_V9)).toBe('9b49394eac64574239478f217f7071758fd841485d9b335d900399069dc72e34');
  });

  it('v9 = v8 except the listed changes, each with its own « _v9 » key', () => {
    const a = Object.fromEntries(draftTextKeys(v8)); const b = Object.fromEntries(draftTextKeys(v9));
    expect(Object.keys(b).filter((k) => a[k] !== b[k]).sort()).toEqual(['account.i1_v9', 'appointments.p3_v9', 'data.p1_v9', 'end.p1_v9', 'end.p2_v9', 'intro_v9']);
    // only the v8 entries replaced by those keys disappear
    expect(Object.keys(a).filter((k) => !(k in b)).sort()).toEqual(['account.i1', 'data.p1_v8', 'end.p1', 'intro']);
  });
});

describe('the three sentences that become false at the pro opening', () => {
  it('the false v8 sentences are absent from v9 (they stay in v8, which is unchanged)', () => {
    const t9 = frText(v9); const t8 = frText(v8);
    for (const s of LEGAL_DRAFTS_CGU_PRO_V9_REPLACED) { expect(t8).toContain(s); expect(t9).not.toContain(s); }
    expect(t9).not.toMatch(/bases légales proposées/);
    expect(t9).not.toMatch(/créé(?:e)? (?:sur|à l')invitation de (?:votre|leur) structure/);
    expect(t9).not.toMatch(/Vous et votre structure en êtes informés/);
  });

  it('« créé sur invitation »: by an administrator of the structure OR by the operator (platform invitation), as in the notice v9 § 11', () => {
    expect(v9.intro).toBe("Ces conditions s'appliquent aux professionnels qui utilisent un compte ADA Pro, créé sur invitation d'un administrateur de leur structure ou de l'exploitant.");
    expect(section(v9, 'account').items[0]).toBe("Le compte est créé sur invitation envoyée à votre adresse électronique professionnelle par un administrateur de votre structure ou par l'exploitant (par exemple pour le premier administrateur d'une structure). Il est personnel : ne le partagez pas.");
    expect(LEGAL_DRAFTS_V9_PRO_ACCOUNT_PARAGRAPH).toContain("par un administrateur de votre structure ou par l'exploitant");
    // the code: the platform (SUPERADMIN) invites into a verified, active structure
    expect(readFileSync('api/_handlers/pro/invite.js', 'utf8')).toContain('authorizePlatformInvitation');
  });

  it('« bases légales »: the bases decided in the notice v9 § 3 (P4p), no longer « proposées »', () => {
    const p1 = section(v9, 'data').paras[0];
    expect(p1).toContain("Ces traitements reposent sur l'exécution des présentes conditions (article 6, 1, b du RGPD) et, pour la sécurité des comptes et le journal des actions, sur l'intérêt légitime de l'exploitant et de votre structure à protéger les accès (article 6, 1, f).");
    expect(p1).toContain('(section 3, P4p)');
    expect(LEGAL_DRAFTS_V9_P4P).toMatch(/exécution des conditions d'utilisation des professionnels acceptées à l'inscription \(art\. 6, 1, b\) ; sécurité des comptes et journal des actions : intérêt légitime de l'exploitant et de la structure à protéger les accès \(art\. 6, 1, f\)/);
    for (const part of ['adresse électronique professionnelle', 'votre rôle', 'votre structure', 'mot de passe sous forme hachée', 'secret de votre double authentification', 'journal de vos actions', 'préférences de notification', 'si vous les indiquez, votre nom affiché et votre fonction']) expect(p1).toContain(part);
  });

  it('« vous et votre structure en êtes informés »: a neutral, true statement (no automatic notice), no new commitment', () => {
    const [p1] = section(v9, 'end').paras;
    expect(p1).toBe("En cas d'usage contraire à ces conditions ou d'incident de sécurité, l'administrateur de votre structure ou l'exploitant peut désactiver votre compte : vos sessions prennent fin aussitôt. Aucun avis automatique ne vous est envoyé lorsque votre compte est désactivé.");
    // owner condition 22/11/2026: no obligation beyond his approvals — no promise to inform, in any language
    expect(frText(v9)).not.toMatch(/en informe|informé|par écrit/);
    for (const lang of LANGS) expect(locale(lang)['cguPro.end.p1_v9'], lang).not.toMatch(/in writing|schriftlich|yazılı|كتابي|письмово/i);
    const admin = readFileSync('api/_services/pro-account-admin.js', 'utf8');
    expect(admin).not.toMatch(/sendMail|createNotification/);
    expect(admin).toContain('"sessionsValidAfter" = NOW()');
  });
});

describe('retention (owner decisions 22/11/2026) and video', () => {
  it('disabled account 12 months then erased by hand; proof of acceptance 12 months after the erasure — the same words as the notice v9 § 4', () => {
    const p2 = section(v9, 'end').paras[1];
    for (const s of ['gardé 12 mois au plus, pour permettre sa réactivation et la preuve des actions', 'Lorsque l\'espace de votre structure est fermé, les comptes de son équipe sont effacés de la même façon.',
      "(identifiant du compte, document, version et date, sans votre adresse) est gardée 12 mois après l'effacement ; cette suppression n'est pas encore automatisée."]) {
      expect(p2).toContain(s); expect(LEGAL_DRAFTS_V9_PRO_ACCOUNT_RETENTION).toContain(s);
    }
    expect(p2).toContain("puis effacé par l'exploitant ; cet effacement n'est pas encore automatisé.");
    expect(p2).toContain('{{contact}}');
  });

  it('video: conditional only, no provider named (no DPA yet), in every language', () => {
    const p3 = section(v9, 'appointments').paras[2];
    expect(p3).toBe("Si la visioconférence est activée pour votre structure (elle ne l'est pas à ce jour), son traitement et son prestataire sont décrits dans la notice de confidentialité.");
    const all = [frText(v9), ...LANGS.map((l) => Object.entries(locale(l)).filter(([k]) => k.startsWith('cguPro.') && k.endsWith('_v9')).map(([, v]) => v).join('\n'))].join('\n');
    expect(all).not.toMatch(/8x8|JaaS|Jitsi/i);
  });

  it('every key translated in the five languages with the same placeholders; no entitlement claim', () => {
    expect(claimsEntitlement(frText(v9))).toBe(false);
    const ph = (/** @type {string} */ v) => (v.match(/\{\{\w+\}\}/g) || []).sort();
    for (const lang of LANGS) {
      const tr = locale(lang);
      for (const [k, fr] of draftTextKeys(v9)) {
        const key = `cguPro.${k}`;
        expect(tr[key], `${lang} ${key}`).toBeTruthy();
        expect(ph(tr[key]), `${lang} ${key}`).toEqual(ph(fr));
      }
      expect(tr['cguPro.end.p2_v9']).toMatch(/12/);
    }
  });
});

describe('not approved: Production and the acceptance record', () => {
  it('Production with the notice v9 approved: cgu-professionnel stays v8 in force; the sign-up records v8, never the v9 draft', () => {
    const d = /** @type {any} */ (draftFor(ID, prod(WITH_NOTICE_V9)));
    expect(d.version).toBe(LEGAL_DRAFTS_V8); expect(draftVisibility(d, prod(WITH_NOTICE_V9))).toBe('IN_FORCE');
    expect(approvedVersionOf(ID, WITH_NOTICE_V9)).toBe(LEGAL_DRAFTS_V8);
    expect(proTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: WITH_NOTICE_V9 })).toBe(true);
    expect(proTermsReference(ID, { VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: WITH_NOTICE_V9 })).toBe('cgu-professionnel@v8-2026-11-19');
    // the notice's bare version approves nothing of the professional terms; a v9 token of another document does not exist
    expect(approvedVersionOf(ID, 'v9-2026-11-19')).toBe(null);
    expect(knownApprovalToken('cgu-professionnel@v9-2026-11-22')).toBe(true);
    expect(knownApprovalToken('conditions-structures@v9-2026-11-22')).toBe(false);
    expect(knownApprovalToken('notice-confidentialite@v9-2026-11-22')).toBe(false);
  });

  it('Production with nothing professional approved: v9 hidden, sign-up closed', () => {
    const now = 'cgu-citoyen@v7-2026-11-18,notice-confidentialite@v9-2026-11-19';
    expect(draftVisibility(/** @type {any} */ (draftFor(ID, prod(now))), prod(now))).toBe('HIDDEN');
    expect(proTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: now })).toBe(false);
  });

  it('only once the owner names cgu-professionnel@v9-2026-11-22 is v9 in force and recorded; outside Production the draft is recorded', () => {
    expect(approvedVersionOf(ID, WITH_PRO_V9)).toBe(LEGAL_DRAFTS_V9_PRO);
    expect(proTermsReference(ID, { VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: WITH_PRO_V9 })).toBe('cgu-professionnel@v9-2026-11-22');
    expect(proTermsReference('conditions-structures', { VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: WITH_PRO_V9 })).toBe('conditions-structures@v8-2026-11-19');
    expect(proTermsReference(ID, { VERCEL_ENV: 'preview' })).toBe('cgu-professionnel@v11-2026-11-24');   // the newest draft
  });

  it('recordProTermsAcceptance writes the approved version (v8) in Production, not the draft', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', WITH_NOTICE_V9);
    /** @type {any[]} */ const rows = [];
    const dbh = { insert: () => ({ values: async (/** @type {any[]} */ v) => { rows.push(...v); } }) };
    await recordProTermsAcceptance(dbh, 'u-1', 'STRUCTURE_ADMIN');
    expect(rows.map((r) => r.policy_version)).toEqual(['cgu-professionnel@v8-2026-11-19', 'conditions-structures@v8-2026-11-19']);
    expect(rows.every((r) => r.proof_level === 'CONTRACT_ACCEPTANCE' && r.subject_type === 'PRO_USER')).toBe(true);
  });
});

async function renderPage(/** @type {string} */ path, /** @type {string} */ lang = 'fr') {
  vi.resetModules();
  const { setLanguage } = await import('../../src/i18n/index.js');
  await setLanguage(lang, { persist: false });
  const mod = await import('../../src/pages/LegalDraftDocument.jsx');
  return render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] }, createElement(mod.default))));
}

describe('rendering (LegalDraftDocument.jsx)', () => {
  it('LAB preview: v9 with the « Projet — non approuvé » banner and the corrected sentences', async () => {
    vi.stubEnv('VITE_LEGAL_DRAFT_PREVIEW', '1');
    const { container } = await renderPage('/cgu/professionnel');
    expect(screen.getByTestId('legal-draft-banner')).toHaveTextContent('Projet — non approuvé');
    expect(screen.getByTestId('legal-draft-banner')).toHaveTextContent('cgu-professionnel@v11-2026-11-24');   // release-3 follow-up: the newest draft
    expect(container.textContent).toContain('Aucun avis automatique ne vous est envoyé lorsque votre compte est désactivé.');
    expect(container.textContent).not.toContain('bases légales proposées');
  });

  it('Production (notice v9 approved, terms v8): the v8 text, no banner', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', WITH_NOTICE_V9);
    const { container } = await renderPage('/cgu/professionnel');
    expect(screen.queryByTestId('legal-draft-banner')).toBeNull();
    expect(container.querySelector('[data-legal-draft-version]')).toHaveTextContent('cgu-professionnel@v8-2026-11-19');
    expect(container.textContent).toContain('Vous et votre structure en êtes informés');
  });

  it('English, v9 approved: the v9 translations (versioned keys)', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', WITH_PRO_V9);
    const { container } = await renderPage('/cgu/professionnel', 'en');
    for (const k of ['intro_v9', 'account.i1_v9', 'appointments.p3_v9', 'end.p1_v9']) expect(container.textContent).toContain(locale('en')[`cguPro.${k}`]);
  });
});
