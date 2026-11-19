// @vitest-environment jsdom
/**
 * G8 (19/11/2026) — v9-2026-11-19 of the privacy notice (notice-confidentialite): the notice that must be in force before ADA Pro opens to a pilot
 * structure (surfaces admin,accounts,pro; no capability; no data about the people a structure accompanies). The v8 notice says P4p (professional
 * accounts) is « pas en service » (§ 3 bis), covers personal accounts only (§ 2), gives no retention for a professional account (§ 4) and offers
 * self-service rights ADA Pro does not have (§ 8). v9 = v8 + exactly the listed changes; v6 / v7 / v8 of the notice unchanged byte for byte; the other
 * documents keep their versions. Every retention sentence is checked against the code: a duration that no purge executes is said « pas encore automatisé ».
 * Diff: CONTROL/v2/V9_NOTICE_FARKI_FR.md.
 */
import '@testing-library/jest-dom/vitest';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEGAL_DRAFT_DOCUMENTS, LEGAL_DRAFT_DOCUMENTS_V6, LEGAL_DRAFT_DOCUMENTS_V7, LEGAL_DRAFT_DOCUMENTS_V8, LEGAL_DRAFT_DOCUMENTS_V9, LEGAL_DRAFT_STATUS,
  LEGAL_DRAFTS_V7, LEGAL_DRAFTS_V8, LEGAL_DRAFTS_V8_BROWSER_ONLY_PARAGRAPH, LEGAL_DRAFTS_V9, LEGAL_DRAFTS_V9_DOCUMENT_IDS, LEGAL_DRAFTS_V9_P4P, LEGAL_DRAFTS_V9_PRO_ACCOUNT_PARAGRAPH,
  LEGAL_DRAFTS_V9_PRO_ACCOUNT_RETENTION, LEGAL_DRAFTS_V9_PRO_LINKS_RETENTION, LEGAL_DRAFTS_V9_PRO_LOGS_RETENTION, LEGAL_DRAFTS_V9_PRO_RIGHTS,
  LEGAL_DRAFTS_V9_STATUS_PARAGRAPH, approvedAtLeast, approvedVersionOf, draftFor, draftTextKeys, draftVisibility, latestDraftVersionOf,
} from '../../src/config/legal-drafts.js';
import { proTermsInForce } from '../../api/_utils/pro-terms.js';
import { citizenTermsInForce } from '../../api/_utils/terms-in-force.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { checkLegalPublisher } from '../../scripts/check-legal-publisher.mjs';
import { RETENTION_POLICY } from '../../api/_services/retention-policy.js';
import { extractKeys } from '../../scripts/i18n-check.mjs';

const ID = 'notice-confidentialite';
/** Production today (G4): notice v8 */
const PROD_NOW = 'cgu-citoyen@v7-2026-11-18,notice-confidentialite@v8-2026-11-19,cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19';
/** the value the owner sets to put the notice v9 in force (the other documents unchanged) */
const WITH_V9 = 'cgu-citoyen@v7-2026-11-18,notice-confidentialite@v9-2026-11-19,cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19';
const LANGS = ['en', 'de', 'tr', 'ar', 'uk'];
const locale = (/** @type {string} */ lang) => JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
const src = (/** @type {string} */ p) => readFileSync(p, 'utf8');
const doc = (/** @type {any[]} */ set) => /** @type {any} */ (set.find((d) => d.id === ID));
const v8 = doc(LEGAL_DRAFT_DOCUMENTS_V8); const v9 = doc(LEGAL_DRAFT_DOCUMENTS_V9);
const keys = (/** @type {any} */ d) => Object.fromEntries(draftTextKeys(d));
const section = (/** @type {any} */ d, /** @type {string} */ id) => d.sections.find((/** @type {any} */ s) => s.id === id);
const sha = (/** @type {unknown} */ v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const prod = (/** @type {string | undefined} */ approved) => ({ approved, production: true });
const prodEnv = (/** @type {string} */ approved) => ({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: approved });
const NOT_AUTOMATED = /n'est pas encore automatisée?|ne sont pas encore automatisées/;
const V9_KEYS = ['art14.p3_v9', 'processors.i3_v9', 'processors.i4_v9', 'purposes.p4p_v9', 'purposes.title_v9', 'recipients.pro_v9', 'retention.i14_v9',
  'retention.proAccount_v9', 'retention.proLinks_v9', 'retention.proLogs_v9', 'rights.pro_v9', 'status.p1_v9'];

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules(); vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token'); });

describe('privacy notice v9-2026-11-19 — professional accounts of ADA Pro', () => {
  it('v9 exists for the notice only, still a draft; v6 / v7 / v8 of the notice and the other documents unchanged byte for byte', () => {
    expect([...LEGAL_DRAFTS_V9_DOCUMENT_IDS]).toEqual([ID]);
    expect(LEGAL_DRAFT_DOCUMENTS_V9.map((d) => d.id)).toEqual([ID]);
    expect(v9.version).toBe(LEGAL_DRAFTS_V9);
    expect(v9.status).toBe(LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL);
    expect(latestDraftVersionOf(ID)).toBe(LEGAL_DRAFTS_V9);
    expect(LEGAL_DRAFT_DOCUMENTS.map((d) => `${d.id}@${d.version}`)).toEqual(['cgu-citoyen@v7-2026-11-18', 'cgu-professionnel@v8-2026-11-19', 'conditions-structures@v8-2026-11-19', `${ID}@${LEGAL_DRAFTS_V9}`]);
    // hashes taken from the commit before this change (c231397)
    expect(sha(doc(LEGAL_DRAFT_DOCUMENTS_V6))).toBe('f7cb5dec60ab2186797f89eaf64de5780f7e07221ba4b521c7e627ebf37d8966');
    expect(sha(doc(LEGAL_DRAFT_DOCUMENTS_V7))).toBe('4ac5e148ef8a26337c40545a0f249c7c660546b21d0be8cce110adc3c35470e6');
    expect(sha(v8)).toBe('f9093d3282a487f7bca854c1497ea4732d8f7d2b551655da27bee00adda74778');
    expect(sha(LEGAL_DRAFT_DOCUMENTS_V8.find((d) => d.id === 'cgu-professionnel'))).toBe('9f226da6df309e5b4ce36ef55a9dae99ba6df0d9881629460ed02cbb45529913');
    expect(sha(LEGAL_DRAFT_DOCUMENTS_V8.find((d) => d.id === 'conditions-structures'))).toBe('51b988dce038d1a155ebbb9844a9d1f4ff6f17ed31d544382f37067a8e9f7821');
    expect(sha(LEGAL_DRAFT_DOCUMENTS_V7.find((d) => d.id === 'cgu-citoyen'))).toBe('f29d0e1a1a13ef78f8ccab77de2a15960c6477644af0f4a0a3eb60d1203fa775');
  });

  it('v9 = v8 except the listed texts, each with its own « _v9 » key; every other v8 text kept word for word under its own key', () => {
    const a = keys(v8); const b = keys(v9);
    expect(Object.keys(b).filter((k) => a[k] !== b[k]).sort()).toEqual(V9_KEYS);
    expect(Object.keys(a).filter((k) => !(k in b)).sort()).toEqual(['art14.p3_v8', 'processors.i3_v7', 'processors.i4', 'purposes-later.i2', 'purposes.title', 'retention.i14', 'status.p1']);
    // what v8 says that v9 corrects
    expect(a['purposes-later.i2']).toMatch(/^P4p — Comptes des professionnels/);
    expect(section(v8, 'purposes-later').paras[0]).toContain('Ces traitements ne sont pas en service');
    expect(a['status.p1']).toMatch(/^Cette notice décrit les traitements des comptes personnels \(section 3\)\. Les rendez-vous/);
    expect(a['art14.p3_v8']).toMatch(/Les sections 3 à 8 s'appliquent aussi à vous\.$/);
    // only the removed P4p leaves § 3 bis; P4 (the professionals' names in a booking) stays proposed: appointments are closed
    expect(section(v9, 'purposes-later').items).toEqual(section(v8, 'purposes-later').items.filter((/** @type {string} */ x) => !x.startsWith('P4p')));
    expect(section(v9, 'purposes-later').proposed).toBe(true);
    expect(section(v9, 'purposes').items.map((/** @type {string} */ x) => x.split(' — ')[0])).toEqual(['P1', 'P2', 'P2b', 'P3', 'P4p', 'P10a', 'P12', 'P13', 'P14', 'P15', 'P16']);
    expect(section(v9, 'purposes').proposed).toBeUndefined();
    expect(b['purposes.p4p_v9']).toBe(LEGAL_DRAFTS_V9_P4P);
    expect(LEGAL_DRAFTS_V9_P4P).not.toMatch(/\bproposée?s?\b|pas en service/);
    expect(b['status.p1_v9']).toBe(LEGAL_DRAFTS_V9_STATUS_PARAGRAPH);
    expect(b['art14.p3_v9']).toBe(LEGAL_DRAFTS_V9_PRO_ACCOUNT_PARAGRAPH);
    // the professional rules sit next to the personal ones: § 4 right after the personal account, § 5 / § 8 right after the citizen paragraph
    expect(section(v9, 'retention').items.slice(1, 4)).toEqual([LEGAL_DRAFTS_V9_PRO_ACCOUNT_RETENTION, LEGAL_DRAFTS_V9_PRO_LINKS_RETENTION, LEGAL_DRAFTS_V9_PRO_LOGS_RETENTION]);
    expect(section(v9, 'rights').paras[1]).toBe(LEGAL_DRAFTS_V9_PRO_RIGHTS);
    for (const t of Object.values(b)) expect(claimsEntitlement(t)).toBe(false);
    // nothing about functions that stay closed being open
    for (const k of V9_KEYS) expect(b[k], k).not.toMatch(/parcours|événement|evenement/i);
  });

  it('§ 4 professional account — every duration is the code\'s, and what no purge executes is said « pas encore automatisé »', () => {
    const acc = LEGAL_DRAFTS_V9_PRO_ACCOUNT_RETENTION; const links = LEGAL_DRAFTS_V9_PRO_LINKS_RETENTION; const logs = LEGAL_DRAFTS_V9_PRO_LOGS_RETENTION;
    const d = /** @type {any} */ (RETENTION_POLICY.durations);
    const purge = src('api/_handlers/cron/gdpr-purge.js');
    const approvedSteps = Object.keys(/** @type {any} */ (RETENTION_POLICY).approvedSteps || {});
    // disabled account: 12 months in the approved policy, but the step only REPORTS — erasure by the operator's tool
    expect(d.PRO_USER_DISABLED_DAYS.days).toBe(365);
    expect(purge).toMatch(/id: 'disabledProUsersReport',[^\n]*kind: 'report'/);
    expect(acc).toContain('Un compte désactivé est gardé 12 mois au plus');
    expect(acc).toContain("cet effacement n'est pas encore automatisé : l'exploitant le fait depuis sa console d'administration");
    const admin = src('api/_services/pro-account-admin.js');
    expect(admin).toContain("if (u.status !== 'disabled') return bad('pro_account_active'");
    for (const erased of ['DELETE FROM "Invitation"', 'UPDATE "Invitation" SET email', 'DELETE FROM "ProNotification"', '"displayName" = NULL, "jobTitle" = NULL', 'mfa_secret = NULL', "\"notificationPrefs\" = '{}'::jsonb", 'password_hash = ']) expect(admin, erased).toContain(erased);
    expect(acc).toContain('le compte ne garde que son identifiant technique, son rôle et sa structure');
    // closure of the structure's space: the same erasure for every member, redeemed invitations included (f661851)
    const closure = src('api/_services/org-closure.js');
    expect(closure).toContain(`UPDATE "Invitation" SET email = 'closed-' || id || '@closed.invalid'`);
    expect(closure).toMatch(/UPDATE "ProUser" SET email = 'closed-' \|\| id \|\| '@closed\.invalid', password_hash/);
    expect(acc).toContain("Lorsque l'espace de votre structure est fermé, les comptes de son équipe sont effacés de la même façon.");
    // proof of the acceptance: ConsentLog PRO_USER rows — no purge step covers them: « 12 mois » + not automated
    expect(src('api/_utils/pro-terms.js')).toContain("subject_type: 'PRO_USER'");
    expect(purge).not.toMatch(/subject_type, 'PRO_USER'|'PRO_USER'\)/);
    expect(acc).toMatch(/La preuve de votre acceptation des conditions des professionnels \(identifiant du compte, document, version et date, sans votre adresse\) est gardée 12 mois après l'effacement ; cette suppression n'est pas encore automatisée\.$/);
    // links and sessions
    expect(src('api/_handlers/pro/invite.js')).toContain('new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)');
    expect(src('api/_utils/pro-mfa-enrolment.js')).toContain('MFA_INVITATION_TTL_MS = 72 * 3600 * 1000');
    expect(src('api/_handlers/pro/auth/forgot-password.js')).toMatch(/kv\.set\(key, \{ userId: user\.id \}, \{ ex: 3600 \}\)/);
    expect(src('api/_utils/auth.js')).toContain('PRO_SESSION_MAX_AGE_SECONDS = 12 * 3600');
    expect(src('api/_utils/rateLimit.js')).toMatch(/LOGIN_PRO: \{ limit: 5, window: 900 \}/);
    expect(d.INVITATION_GRACE_DAYS.days).toBe(30);
    for (const part of ["l'invitation est valable 7 jours et une seule fois", 'double authentification 72 heures', 'mot de passe 1 heure', 'Session de connexion : 12 heures au plus',
      'Au-delà de 5 tentatives de connexion en 15 minutes', 'une invitation expirée est supprimée 30 jours après son expiration — cette suppression n\'est pas encore automatisée']) expect(links, part).toContain(part);
    // notifications and journal: approved durations, steps not approved
    expect(d.PRO_NOTIFICATION_DAYS.days).toBe(180); expect(d.AUDIT_LOG_DAYS.days).toBe(365);
    for (const step of ['deletedInvitationsCount', 'proNotificationsDeleted', 'deletedAuditCount', 'consentLogsAfterErasureDeleted']) expect(approvedSteps).not.toContain(step);
    expect(logs).toContain('gardées 180 jours'); expect(logs).toContain('(12 mois). Ces suppressions ne sont pas encore automatisées.');
    // the journal keeps the sign-in IP (AuditLog.ip), never the address
    expect(src('api/_utils/auth.js')).toMatch(/await db\.insert\(AuditLog\)\.values\(\{[\s\S]{0,200}ip,\s*\n\s*ip_hash: hashIp\(ip\)/);
    expect(logs).toContain('adresse IP de connexion ; sans votre adresse électronique');
    // the Mailjet contact deletion is not wired for professional accounts: said as such
    for (const f of ['api/_services/pro-account-admin.js', 'api/_services/org-closure.js']) expect(src(f), f).not.toMatch(/mail-contact-erasure|eraseMailContact/);
    expect(logs).toContain("la demande de suppression de l'adresse chez Mailjet n'est pas encore faite pour un compte professionnel");
    for (const t of [acc, links, logs]) expect(t).toMatch(NOT_AUTOMATED);
    // the « 1 an » of a future appointment is unchanged; « notifications des professionnels » no longer listed as not open (in-app notices exist)
    expect(keys(v9)['retention.i14_v9']).not.toContain('notifications des professionnels');
    expect(src('api/_services/structure-proposals.js')).toContain("await import('./pro-notifications.js')");
  });

  it('§ 3 P4p, § 5, § 6, § 8, § 11: checked against the code', () => {
    // MFA mandatory in Production, invitation by a structure administrator or the platform
    expect(src('api/_utils/auth.js')).toContain("return process.env.VERCEL_ENV === 'production' || process.env.PRO_MFA_REQUIRED === 'true';");
    expect(src('api/_handlers/pro/invite.js')).toMatch(/requireProRole\(handler, \[AUTH_ROLE\.STRUCTURE_ADMIN, AUTH_ROLE\.SUPERADMIN\]\)/);
    // the narrow opening: pro.account / pro.structure_admin, no HDS
    const caps = src('api/_utils/capabilities.js');
    expect(caps).toMatch(/'pro\.account': \{[^}]*requiresHds: false, surface: 'pro'/);
    expect(caps).toMatch(/'pro\/profile': \['pro\.account'\]/);
    // display name / job title: ProProfile, optional, self-service; not on the public site (search-pro has no surface)
    const schema = src('src/db/schema.ts');
    const proProfile = schema.slice(schema.indexOf("export const ProProfile = pgTable('ProProfile'"), schema.indexOf("export const ProProfile = pgTable('ProProfile'") + 600);
    expect(proProfile).toContain("displayName: text('displayName')"); expect(proProfile).toContain("jobTitle: text('jobTitle')");
    expect(src('api/_utils/public-beta.js')).toContain('« search-pro » left the allowlist');
    expect(LEGAL_DRAFTS_V9_PRO_ACCOUNT_PARAGRAPH).toContain('ainsi que, si vous les indiquez, votre nom affiché et votre fonction');
    // § 5: the administrator exports the team (address, role, status, preferences) and the structure journal
    const exp = src('api/_services/structure-proposals.js');
    expect(exp).toMatch(/const team = await db\.select\(\{ email: ProUser\.email, role: ProUser\.role, status: ProUser\.status, createdAt: ProUser\.createdAt,\s*notificationEmailEnabled: ProUser\.notificationEmailEnabled, notificationPrefs: ProUser\.notificationPrefs \}\)/);
    expect(keys(v9)['recipients.pro_v9']).toContain('votre adresse professionnelle, votre rôle, l\'état de votre compte, vos préférences de notification et le journal des actions de la structure');
    // § 6: the pro reset link lives at Upstash (the KV store) 1 hour; § 8: no self-service export / erasure in ADA Pro
    expect(src('api/_handlers/pro/auth/forgot-password.js')).toContain("import { kv } from '../../../_utils/kv.js';");
    expect(keys(v9)['processors.i3_v9']).toContain('pendant 1 heure, les liens de réinitialisation du mot de passe des comptes professionnels');
    expect(LEGAL_DRAFTS_V9_PRO_RIGHTS).toContain("ces fonctions de libre-service n'existent pas : écrivez à {{contact}}");
    expect(src('api/_services/pro-public-profile.js')).toContain('every professional their OWN name (self-service)');
    expect(src('api/_services/pro-notifications.js')).toMatch(/export async function setPreferences\(ctx/);
    // § 11: which sections carry the professional rules
    expect(LEGAL_DRAFTS_V9_PRO_ACCOUNT_PARAGRAPH).toMatch(/finalité et base en section 3 \(P4p\), durées en section 4, destinataires en section 5, exercice de vos droits en section 8\.$/);
  });

  it('five translations: every v9 key, the same placeholders, figures and names; no stale key', () => {
    const fr = keys(v9);
    const figures = (/** @type {string} */ v) => [...new Set((v.match(/\d+/g) || []).filter((n) => Number(n) > 1))].sort();
    const names = (/** @type {string} */ v) => ['{{contact}}', 'ADA', 'P4p', 'Mailjet', 'Upstash', 'IP'].filter((n) => v.includes(n));
    for (const lang of LANGS) {
      const tr = locale(lang);
      for (const [k] of draftTextKeys(v9)) expect(tr[`${v9.key}.${k}`], `${lang} ${k}`).toBeTruthy();
      for (const k of V9_KEYS) {
        const t = tr[`${v9.key}.${k}`];
        expect(figures(t), `${lang} ${k}`).toEqual(figures(fr[k]));
        expect(names(t), `${lang} ${k}`).toEqual(names(fr[k]));
        expect(claimsEntitlement(t), `${lang} ${k}`).toBe(false);
      }
      expect(Object.keys(tr).filter((k) => k.startsWith(`${v9.key}.`) && k.endsWith('_v9')).sort(), lang).toEqual(V9_KEYS.map((k) => `${v9.key}.${k}`));
    }
  });
});

describe('/politique-confidentialite and the i18n gate', () => {
  it('every literal t() key of the privacy page has a French default (CI i18n-check: « keys without a French default » failed on the G8 candidate)', () => {
    const file = 'src/pages/Confidentialite.jsx';
    expect(extractKeys(src(file), file).filter((k) => !Object.keys(k.defaults).length).map((k) => k.key)).toEqual([]);
    // the browser-only paragraph is still the approved v8 text and its translations
    expect(src(file)).toContain(`t('legaldraft:privacyNotice.purposes.p3_v8', ${JSON.stringify(LEGAL_DRAFTS_V8_BROWSER_ONLY_PARAGRAPH)})`);   // literal default = the approved constant
  });
});

describe('notice v9 approval', () => {
  it('Production today (notice v8 approved): v8 still in force, v9 hidden; nothing approved: hidden', () => {
    expect(draftFor(ID, prod(PROD_NOW))?.version).toBe(LEGAL_DRAFTS_V8);
    expect(approvedVersionOf(ID, PROD_NOW)).toBe(LEGAL_DRAFTS_V8);
    expect(draftVisibility(v9, prod(PROD_NOW))).toBe('HIDDEN');
    expect(draftVisibility(v9, prod(undefined))).toBe('HIDDEN');
    expect(draftVisibility(v9, { production: true, preview: '1' })).toBe('HIDDEN');
    expect(draftVisibility(v9, { production: false, preview: '1' })).toBe('PREVIEW');
    expect(proTermsInForce(prodEnv(PROD_NOW))).toBe(true);
    // an approval of v8 does not carry over to v9, and the bare v9 token approves the notice only
    expect(draftVisibility(v9, prod('notice-confidentialite@v8-2026-11-19'))).toBe('HIDDEN');
    expect(approvedVersionOf('cgu-professionnel', 'v9-2026-11-19')).toBe(null);
  });

  it(`Production with ${WITH_V9}: the notice v9 is in force; citizen and professional sign-ups open; the publisher knows every token`, () => {
    const d = /** @type {any} */ (draftFor(ID, prod(WITH_V9)));
    expect(d.version).toBe(LEGAL_DRAFTS_V9);
    expect(draftVisibility(d, prod(WITH_V9))).toBe('IN_FORCE');
    expect(approvedVersionOf(ID, WITH_V9)).toBe(LEGAL_DRAFTS_V9);
    expect(approvedVersionOf('cgu-professionnel', WITH_V9)).toBe(LEGAL_DRAFTS_V8);
    expect(approvedVersionOf('cgu-citoyen', WITH_V9)).toBe(LEGAL_DRAFTS_V7);
    expect(citizenTermsInForce(prodEnv(WITH_V9))).toBe(true);
    expect(proTermsInForce(prodEnv(WITH_V9))).toBe(true);
    // the restore-history copy (announced since v7) stays legally announced under v9
    expect(approvedAtLeast(ID, LEGAL_DRAFTS_V7, WITH_V9)).toBe(true);
    expect(checkLegalPublisher({ VITE_LEGAL_DOCS_APPROVED_VERSION: WITH_V9 }, { defaults: [] }).find((/** @type {any} */ x) => x.id === 'legal.approved_versions_known')).toBeUndefined();
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
const sectionText = (/** @type {HTMLElement} */ c, /** @type {string} */ id) => c.querySelector(`[aria-labelledby="${ID}-${id}"]`)?.textContent || '';

describe('notice v9 rendering (LegalDraftDocument.jsx)', () => {
  it('Production with v9 named: in force, P4p in § 3 and no longer in § 3 bis, the professional retention, rights and § 11', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', WITH_V9);
    const { container } = await renderNotice();
    expect(container.querySelector('[data-legal-draft-state]')?.getAttribute('data-legal-draft-state')).toBe('IN_FORCE');
    expect(container.querySelector('[data-legal-draft-version]')).toHaveTextContent(`${ID}@${LEGAL_DRAFTS_V9}`);
    expect(sectionText(container, 'purposes')).toContain(LEGAL_DRAFTS_V9_P4P);
    expect(sectionText(container, 'purposes-later')).not.toContain('P4p');
    for (const t of [LEGAL_DRAFTS_V9_STATUS_PARAGRAPH, LEGAL_DRAFTS_V9_PRO_LINKS_RETENTION, LEGAL_DRAFTS_V9_PRO_LOGS_RETENTION]) expect(container.textContent).toContain(t);
    expect(sectionText(container, 'retention')).toContain('Compte professionnel ADA Pro (adresse électronique professionnelle');
    expect(sectionText(container, 'rights')).toContain('Pour un compte professionnel, ces fonctions de libre-service n\'existent pas');
    expect(sectionText(container, 'art14')).toContain('durées en section 4');
  });

  it('Production with v8 only (today): the v8 text — P4p still in § 3 bis, no professional retention', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', PROD_NOW);
    const { container } = await renderNotice();
    expect(container.querySelector('[data-legal-draft-version]')).toHaveTextContent(`${ID}@${LEGAL_DRAFTS_V8}`);
    expect(sectionText(container, 'purposes-later')).toContain('P4p — Comptes des professionnels');
    expect(container.textContent).not.toContain(LEGAL_DRAFTS_V9_P4P);
    expect(container.textContent).not.toContain('Compte professionnel ADA Pro');
  });

  it('English and Arabic: the v9 page renders the versioned translations', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', WITH_V9);
    for (const lang of ['en', 'ar']) {
      const { container } = await renderNotice(lang);
      for (const k of ['purposes.p4p_v9', 'retention.proLinks_v9', 'status.p1_v9', 'purposes.title_v9']) expect(container.textContent, `${lang} ${k}`).toContain(locale(lang)[`privacyNotice.${k}`]);
      expect(container.textContent).not.toContain(locale(lang)['privacyNotice.purposes-later.i2']);
      cleanup();
    }
  });
});
