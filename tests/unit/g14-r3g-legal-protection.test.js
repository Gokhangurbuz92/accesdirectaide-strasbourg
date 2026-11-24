/**
 * G14-R3G (24/11/2026, release-3 package) — the representative of a protected adult (tutelle, curatelle, habilitation familiale, mandat spécial; a relative
 * or an MJPM). APPROVED by the owner on 24/11/2026 (OWNER_VALIDATED, not a lawyer's review). Covers, without a database:
 *   - the narrow gate: ADA_BETA_ACCOUNTS_EXTRA=legal_protection + ADA_CAPABILITIES_OPEN=citizen.legal_protection, closed by default; routes and screens;
 *   - the law as data: which measure carries which mode, who can hold it, the longest end date (Code civil art. 439, 441, 442, 494-1, 494-6; CASF L471-1
 *     and L471-2, read on Légifrance 24/11/2026), the areas a decision can cover;
 *   - the powers: ACT only for tutelle / habilitation générale en représentation, CONFIRM otherwise; nothing before VERIFIED, nothing after validUntil
 *     or while SUSPENDED;
 *   - the pending migration 0064 (not in the journal: the guard stays green) and its constraints;
 *   - the decided durations and purge steps (executable only once approved), the preflight check, the notice v14 P27 / cgu v13 texts (figures = code, six
 *     languages), the register line T33, the « mode accompagnant » role.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../src/db/index.js', () => ({ db: {} }));

const { isAllowedInPublicBeta, ACCOUNTS_EXTRAS } = await import('../../api/_utils/public-beta.js');
const { CAPABILITIES, capabilityState, capabilitiesOfRoute } = await import('../../api/_utils/capabilities.js');
const { isBetaRestrictedPath, ACCOUNTS_EXTRA_SCREENS } = await import('../../src/lib/publicBeta.js');
const LP = await import('../../api/_services/legal-protection.js');
const { HELPER_ROLES } = await import('../../api/_services/assisted-mode.js');
const { RETENTION_POLICY, R3_DECISION, stepApprovalProblem } = await import('../../api/_services/retention-policy.js');
const { PURGE_STEPS, legalProtectionStaleWhere, legalProtectionRejectedWhere, legalProtectionEndedWhere } = await import('../../api/_handlers/cron/gdpr-purge.js');
const L = await import('../../src/config/legal-drafts.js');
const { claimsEntitlement } = await import('../../api/lib/entitlementWording.js');
const { loadMigrations, verifyJournal } = await import('../../scripts/db-migrate-guard.mjs');

const R2 = Object.freeze({ VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro,appointments,video,assistant,social_referrals,diagnostic',
  ADA_BETA_ACCOUNTS_EXTRA: 'parcours,push,assist', ADA_CAPABILITIES_OPEN: 'citizen.parcours,citizen.assisted_mode,ai.citizen_assistant,pro.referrals_social,video,diagnostic.questionnaire' });
const R3 = Object.freeze({ ...R2, ADA_BETA_OPEN_SURFACES: `${R2.ADA_BETA_OPEN_SURFACES},events`, ADA_BETA_ACCOUNTS_EXTRA: `${R2.ADA_BETA_ACCOUNTS_EXTRA},household,guardians,delegations`,
  ADA_CAPABILITIES_OPEN: `${R2.ADA_CAPABILITIES_OPEN},citizen.household,citizen.guardians,citizen.delegations,community.events` });
const R3G = Object.freeze({ ...R3, ADA_BETA_ACCOUNTS_EXTRA: `${R3.ADA_BETA_ACCOUNTS_EXTRA},legal_protection`, ADA_CAPABILITIES_OPEN: `${R3.ADA_CAPABILITIES_OPEN},citizen.legal_protection` });
const OPEN_R2 = 'cgu-citoyen@v12-2026-11-23,notice-confidentialite@v13-2026-11-23,cgu-professionnel@v10-2026-11-23,conditions-structures@v9-2026-11-23';
const OPEN_R3 = 'cgu-citoyen@v13-2026-11-24,notice-confidentialite@v14-2026-11-24,cgu-professionnel@v10-2026-11-23,conditions-structures@v9-2026-11-23';
const TODAY = '2026-11-24';
const base = (o = {}) => ({ measure: 'TUTELLE', representativeKind: 'FAMILLE', scopePerson: true, scopeAssets: true, courtName: 'tribunal judiciaire de Strasbourg',
  decisionDate: '2025-06-02', measureEndsOn: '2030-06-02', ...o });

describe('G14-R3G gate — closed by default, opened by name', () => {
  it('capability: out of the AIPD, account surface, never HDS; one route each side; closed in release 3 unless named', () => {
    expect(CAPABILITIES['citizen.legal_protection']).toMatchObject({ aipd: 'out', requiresHds: false, surface: 'accounts', accountsFull: true });
    expect(capabilitiesOfRoute('citizen/legal-protection')).toEqual(['citizen.legal_protection']);
    expect(capabilitiesOfRoute('admin/legal-protection')).toEqual(['citizen.legal_protection']);
    expect(ACCOUNTS_EXTRAS.legal_protection).toEqual({ routes: ['citizen/legal-protection'], capabilities: ['citizen.legal_protection'] });
    expect(ACCOUNTS_EXTRA_SCREENS.legal_protection).toEqual(['/compte/protection-juridique']);
    expect(capabilityState('citizen.legal_protection', R3).open).toBe(false);
    expect(capabilityState('citizen.legal_protection', { ...R3, ADA_BETA_ACCOUNTS_EXTRA: `${R3.ADA_BETA_ACCOUNTS_EXTRA},legal_protection` }).reason).toBe('NOT_LISTED_IN_ADA_CAPABILITIES_OPEN');
    expect(capabilityState('citizen.legal_protection', { ...R3, ADA_CAPABILITIES_OPEN: `${R3.ADA_CAPABILITIES_OPEN},citizen.legal_protection` }).reason).toBe('SURFACE_CLOSED');
    expect(capabilityState('citizen.legal_protection', R3G).open).toBe(true);
    // opening it opens nothing else
    const open = (/** @type {any} */ env) => Object.keys(CAPABILITIES).filter((c) => capabilityState(c, env).open).sort();
    expect(open(R3G).filter((c) => !open(R3).includes(c))).toEqual(['citizen.legal_protection']);
  });
  it('routes and screens pass the beta gate only with the module named', () => {
    for (const m of ['GET', 'POST']) { expect(isAllowedInPublicBeta(m, 'citizen/legal-protection', R3G)).toBe(true); expect(isAllowedInPublicBeta(m, 'citizen/legal-protection', R3)).toBe(false); }
    const surfaces = R3G.ADA_BETA_OPEN_SURFACES.split(',');
    const sub = { accountsScope: /** @type {'booking'} */ ('booking'), proSelfRegistration: false, accountsExtras: ['legal_protection'] };
    expect(isBetaRestrictedPath('/compte/protection-juridique', surfaces, sub)).toBe(false);
    expect(isBetaRestrictedPath('/compte/protection-juridique', surfaces, { ...sub, accountsExtras: ['delegations'] })).toBe(true);
  });
});

describe('G14-R3G the law as data (Légifrance, version in force 23/11/2026, read 24/11/2026)', () => {
  it('modes by measure: tutelle = représentation (art. 473), curatelle = assistance (art. 467), habilitation / mandat spécial either', () => {
    expect(LP.MEASURES.TUTELLE.modes).toEqual(['REPRESENTATION']);
    for (const c of ['CURATELLE_SIMPLE', 'CURATELLE_RENFORCEE', 'CURATELLE_AMENAGEE']) expect(LP.MEASURES[c].modes, c).toEqual(['ASSISTANCE']);
    for (const c of ['HABILITATION_FAMILIALE_GENERALE', 'HABILITATION_FAMILIALE_SPECIALE', 'SAUVEGARDE_MANDAT_SPECIAL']) expect(LP.MEASURES[c].modes, c).toEqual(['REPRESENTATION', 'ASSISTANCE']);
    // art. 494-1: the habilitation familiale only for relatives; CASF L471-1: an MJPM holds mandat spécial, curatelle, tutelle
    expect(LP.MEASURES.HABILITATION_FAMILIALE_GENERALE.kinds).toEqual(['FAMILLE']);
    expect(LP.MEASURES.SAUVEGARDE_MANDAT_SPECIAL.kinds).toEqual(['FAMILLE', 'MJPM']);
    // CASF L471-2: the three categories of the préfet's list
    expect(LP.MJPM_FORMS).toEqual(['SERVICE', 'INDIVIDUEL', 'PREPOSE']);
  });
  it('checkFacts: the declared mode is forced where the law leaves no choice; an MJPM cannot hold a habilitation familiale', () => {
    const t = LP.checkFacts(base({ mode: 'ASSISTANCE' }), { today: TODAY });
    expect(t.ok && t.facts.mode).toBe('REPRESENTATION');
    expect(LP.checkFacts(base({ measure: 'HABILITATION_FAMILIALE_GENERALE', representativeKind: 'MJPM', mjpmForm: 'SERVICE' }), { today: TODAY }).code).toBe('KIND_NOT_ALLOWED');
    expect(LP.checkFacts(base({ measure: 'HABILITATION_FAMILIALE_GENERALE' }), { today: TODAY }).code).toBe('INVALID_MODE');
    expect(LP.checkFacts(base({ representativeKind: 'MJPM' }), { today: TODAY }).code).toBe('INVALID_MJPM_FORM');
    expect(LP.checkFacts(base({ representativeKind: 'MJPM', mjpmForm: 'SERVICE', siret: '12345678901234' }), { today: TODAY }).code).toBe('INVALID_SIRET');
    const mj = LP.checkFacts(base({ representativeKind: 'MJPM', mjpmForm: 'SERVICE', siret: '732 829 320 00074' }), { today: TODAY });
    expect(mj.ok && mj.facts.siret).toBe('73282932000074');
    expect(LP.checkFacts(base({ scopePerson: false, scopeAssets: false }), { today: TODAY }).code).toBe('INVALID_SCOPE');
  });
  it('end dates: the longest the law allows after the decision (art. 441 / 442: 20 years at most; art. 439: sauvegarde 1 year; 494-6), never past, never before the decision', () => {
    expect(LP.checkFacts(base({ measureEndsOn: '2045-06-03' }), { today: TODAY }).ok).toBe(true);
    expect(LP.checkFacts(base({ measureEndsOn: '2045-06-04' }), { today: TODAY }).code).toBe('END_DATE_BEYOND_LAW');
    const sauv = { measure: 'SAUVEGARDE_MANDAT_SPECIAL', mode: 'ASSISTANCE', decisionDate: '2026-03-01' };
    expect(LP.checkFacts(base({ ...sauv, measureEndsOn: '2027-03-02' }), { today: TODAY }).ok).toBe(true);
    expect(LP.checkFacts(base({ ...sauv, measureEndsOn: '2027-06-01' }), { today: TODAY }).code).toBe('END_DATE_BEYOND_LAW');
    expect(LP.checkFacts(base({ measureEndsOn: '2026-11-24' }), { today: TODAY }).code).toBe('MEASURE_ALREADY_ENDED');
    expect(LP.checkFacts(base({ decisionDate: '2026-12-01' }), { today: TODAY }).code).toBe('INVALID_DECISION_DATE');
    expect(LP.checkFacts(base({ measureEndsOn: '2025-06-01' }), { today: TODAY }).code).toBe('INVALID_END_DATE');
    // the habilitation familiale spéciale has no term (art. 494-6 / 494-11 4°): no end date is asked
    const hs = LP.checkFacts(base({ measure: 'HABILITATION_FAMILIALE_SPECIALE', mode: 'REPRESENTATION', measureEndsOn: undefined }), { today: TODAY });
    expect(hs.ok && hs.facts.measureEndsOn).toBe(null);
  });
  it('the administrator chooses covered areas; the appointments are about the person, never covered by a measure limited to the property', () => {
    expect(LP.checkFacts(base(), { today: TODAY, admin: true }).code).toBe('INVALID_AREAS');
    expect(LP.checkFacts(base({ areas: ['COFFRE'] }), { today: TODAY, admin: true }).code).toBe('INVALID_AREAS');
    expect(LP.checkFacts(base({ scopePerson: false, areas: ['RDV'] }), { today: TODAY, admin: true }).code).toBe('AREA_OUTSIDE_SCOPE');
    const ok = LP.checkFacts(base({ scopePerson: false, areas: ['PARCOURS'] }), { today: TODAY, admin: true });
    expect(ok.ok && ok.facts.areas).toEqual(['PARCOURS']);
    expect(LP.AREAS).toEqual(['RDV', 'PARCOURS']);   // never Mon Coffre (HDS), never the account's security
  });
});

describe('G14-R3G powers — nothing before verification, nothing after the end, nothing while contested', () => {
  const now = Date.parse('2026-11-24T10:00:00Z');
  const m = (o = {}) => ({ measure: 'TUTELLE', mode: 'REPRESENTATION', status: 'VERIFIED', areas: ['RDV', 'PARCOURS'], validUntil: '2030-06-02', ...o });
  it('ACT only for tutelle and habilitation familiale générale en représentation; CONFIRM for every other measure', () => {
    expect(LP.platformMode(m())).toBe('ACT');
    expect(LP.platformMode(m({ measure: 'HABILITATION_FAMILIALE_GENERALE' }))).toBe('ACT');
    expect(LP.platformMode(m({ measure: 'HABILITATION_FAMILIALE_GENERALE', mode: 'ASSISTANCE' }))).toBe('CONFIRM');
    for (const x of ['CURATELLE_SIMPLE', 'CURATELLE_RENFORCEE', 'CURATELLE_AMENAGEE']) expect(LP.platformMode(m({ measure: x, mode: 'ASSISTANCE' })), x).toBe('CONFIRM');
    expect(LP.platformMode(m({ measure: 'HABILITATION_FAMILIALE_SPECIALE' }))).toBe('CONFIRM');
    expect(LP.platformMode(m({ measure: 'SAUVEGARDE_MANDAT_SPECIAL' }))).toBe('CONFIRM');
  });
  it('powersOf: VERIFIED and before validUntil (Paris calendar) only', () => {
    expect(LP.powersOf(m(), now)).toEqual({ mode: 'ACT', areas: ['RDV', 'PARCOURS'] });
    for (const status of ['DECLARED', 'SUSPENDED', 'REJECTED', 'ENDED']) expect(LP.powersOf(m({ status }), now), status).toBe(null);
    expect(LP.stateOf(m({ validUntil: '2026-11-24' }), now)).toBe('EXPIRED');
    expect(LP.powersOf(m({ validUntil: '2026-11-24' }), now)).toBe(null);
    expect(LP.powersOf(m({ validUntil: '2026-11-25' }), now)).not.toBe(null);
    // 23:30 UTC on 24/11 is already 25/11 in Strasbourg: a measure ending on 25/11 has ended
    expect(LP.parisToday(Date.parse('2026-11-24T23:30:00Z'))).toBe('2026-11-25');
    expect(LP.powersOf(m({ validUntil: '2026-11-25' }), Date.parse('2026-11-24T23:30:00Z'))).toBe(null);
    expect(LP.powersOf(m({ areas: [] }), now)).toBe(null);
  });
  it('the case number is kept only as a keyed HMAC, normalised; the helper code is 8 digits, bound to the link and the representative', () => {
    const a = LP.decisionRefHmac('RG 24/01234', 's3cret'); const b = LP.decisionRefHmac('rg2401234', 's3cret');
    expect(a).toMatch(/^[0-9a-f]{64}$/); expect(a).toBe(b); expect(a).not.toContain('2401234');
    expect(LP.decisionRefHmac('12', 's3cret')).toBe(null);
    expect(LP.decisionRefHmac('RG 24/01234', '')).toBe(null);
    const c1 = LP.representativeHelperCode('m1', 'r1', now, 's'); expect(c1).toMatch(/^\d{8}$/);
    expect(LP.representativeHelperCode('m1', 'r2', now, 's')).not.toBe(c1);
    expect(LP.representativeHelperCode('m2', 'r1', now, 's')).not.toBe(c1);
  });
  it('the « mode accompagnant » knows the verified representative role', () => {
    expect(HELPER_ROLES).toContain('REPRESENTANT_LEGAL');
  });
});

describe('G14-R3G migration 0064 — in the journal after 0063 (release 3 integration)', () => {
  const sqlText = readFileSync('drizzle/0064_r3g_legal_protection.sql', 'utf8');
  const down = readFileSync('drizzle/rollback/0064_down.sql', 'utf8');
  it('journal idx 64 after 0063, « when » greater than 0063\'s; the guard stays green; the table is declared in the Drizzle schema', () => {
    const real = loadMigrations('drizzle');
    const e63 = real.entries.find((e) => e.idx === 63); const e64 = real.entries.find((e) => e.idx === 64);
    expect(e63.tag).toBe('0063_g14_r3_booking_needs_external');
    expect(e64).toMatchObject({ tag: '0064_r3g_legal_protection', when: 1795060000000 });
    expect(e64.when).toBeGreaterThan(e63.when);
    expect(verifyJournal(real).ok).toBe(true);
    expect(readFileSync('src/db/schema.ts', 'utf8')).toMatch(/export const LegalProtectionMandate = pgTable\('LegalProtectionMandate'/);
    expect(readFileSync('drizzle/meta/0064_snapshot.json', 'utf8')).toMatch(/"public\.LegalProtectionMandate"/);
    expect(down).toMatch(/1795060000000/);
  });
  it('additive only, with the legal constraints in the database', () => {
    expect(sqlText).not.toMatch(/\bDROP\b|ALTER TABLE "(?!LegalProtectionMandate")/);
    for (const c of ['_measure_mode_check', '_habilitation_family_check', '_mjpm_form_check', '_term_check', '_verified_check', '_areas_check', '_not_self_check', '_live_key'])
      expect(sqlText, c).toContain(`LegalProtectionMandate${c}`);
    expect(sqlText).toMatch(/'SERVICE', 'INDIVIDUEL', 'PREPOSE'/);
    expect(sqlText).toMatch(/ARRAY\['RDV', 'PARCOURS'\]/);
    expect(sqlText).not.toMatch(/"decisionText"|"document"|"file"|"certificat"/i);
    expect(down).toMatch(/DROP TABLE IF EXISTS "LegalProtectionMandate"/);
  });
});

describe('G14-R3G durations and purge steps — decided by the owner 24/11/2026, executable only once approved', () => {
  const D = RETENTION_POLICY.durations;
  const ids = ['legalProtectionStaleDeclarationsDeleted', 'legalProtectionRejectedDeleted', 'legalProtectionEndedDeleted'];
  it('three durations decided on 24/11/2026 (no pendingApproval); the new policy version; special review 365 days', () => {
    expect(D.LEGAL_PROTECTION_DECLARED_STALE_DAYS).toMatchObject({ days: 90, ecode: 'C23', decidedOn: '2026-11-24', basis: R3_DECISION });
    expect(D.LEGAL_PROTECTION_REJECTED_DAYS).toMatchObject({ days: 90, ecode: 'C23', decidedOn: '2026-11-24', basis: R3_DECISION });
    expect(D.LEGAL_PROTECTION_ENDED_DAYS).toMatchObject({ days: 365, ecode: 'C23', decidedOn: '2026-11-24', basis: R3_DECISION });
    for (const k of ['LEGAL_PROTECTION_DECLARED_STALE_DAYS', 'LEGAL_PROTECTION_REJECTED_DAYS', 'LEGAL_PROTECTION_ENDED_DAYS']) expect(D[k].pendingApproval, k).toBeUndefined();
    expect(RETENTION_POLICY.version).toBe('g14-r3-2026-11-24-a7-365d');
    expect(LP.SPECIAL_REVIEW_DAYS).toBe(365);
  });
  it('the steps are refused without an approval record, accepted with a complete one; their SQL keeps held rows and protected persons', () => {
    const rec = { approvedOn: '2026-11-24', dryRunReviewedOn: '2026-11-24', backupVerified: 'synthetic backup proof' };
    const withRecords = { ...RETENTION_POLICY, approvedSteps: { ...RETENTION_POLICY.approvedSteps, ...Object.fromEntries(ids.map((i) => [i, rec])) } };
    for (const id of ids) {
      const step = PURGE_STEPS.find((s) => s.id === id);
      expect(step, id).toMatchObject({ kind: 'delete', table: 'LegalProtectionMandate' });
      expect(step.tables).toContain('LegalProtectionMandate');
      expect(stepApprovalProblem(RETENTION_POLICY, step), id).toBe('STEP_NOT_APPROVED_IN_POLICY');
      expect(RETENTION_POLICY.decidedSteps[id], id).toMatchObject({ decidedOn: '2026-11-24' });
      expect(stepApprovalProblem(withRecords, step), id).toBeNull();
    }
    const d = new PgDialect(); const q = (/** @type {any} */ w) => d.sqlToQuery(w).sql; const at = new Date('2026-01-01T00:00:00Z');
    const a = q(legalProtectionStaleWhere(at)); const b = q(legalProtectionRejectedWhere(at)); const c = q(legalProtectionEndedWhere(at));
    expect(a).toMatch(/"createdAt" < /); expect(b).toMatch(/"endedAt" < /); expect(c).toMatch(/"validUntil"::timestamp < /);
    for (const s of [a, b, c]) { expect(s).toMatch(/"LegalHold"/); expect(s).toMatch(/"DSRRequest"/); expect(s).toMatch(/"representativeUserId"/); }
  });
});

describe('G14-R3G texts — notice v14 P27 and cgu v13 (same draft versions, extended)', () => {
  const keys = (/** @type {any} */ doc) => Object.fromEntries(L.draftTextKeys(doc));
  const n14 = keys(L.LEGAL_DRAFT_DOCUMENTS_R3_NOTICE.find((x) => x.id === 'notice-confidentialite'));
  const c13 = keys(L.LEGAL_DRAFT_DOCUMENTS_R3_CGU.find((x) => x.id === 'cgu-citoyen'));
  const ADDED = { 'privacyNotice.purposes.p27_v14': n14['purposes.p27_v14'], 'privacyNotice.retention.legal_protection_v14': n14['retention.legal_protection_v14'],
    'privacyNotice.recipients.legal_protection_v14': n14['recipients.legal_protection_v14'], 'privacyNotice.rights.legal_protection_v14': n14['rights.legal_protection_v14'],
    'cguCitoyen.account.legal_protection_v13': c13['account.legal_protection_v13'] };
  it('same versions; P27 says what the code does: decision never received, no AI, facts only, powers by measure, contest = suspension', () => {
    expect([L.LEGAL_DRAFTS_R3_NOTICE, L.LEGAL_DRAFTS_R3_CGU]).toEqual(['v14-2026-11-24', 'v13-2026-11-24']);
    const p = n14['purposes.p27_v14'];
    for (const w of ['n\'est ni envoyée ni conservée', 'intelligence artificielle', 'aucun certificat médical', 'n\'ouvre aucun accès', 'jusqu\'à la date de fin',
      'sans les étapes sensibles', 'Mon Coffre', 'suspendu', 'forme chiffrée', 'mandataire judiciaire à la protection des majeurs']) expect(p, w).toContain(w);
    expect(p).toMatch(/Base : intérêt légitime \(art\. 6, 1, f\)/);
    expect(p).toMatch(/donnée concernant la santé, son enregistrement repose aussi sur l'art\. 9, 2, f \(constatation, exercice ou défense d'un droit en justice\)\.$/);   // owner 24/11/2026
    expect(n14['purposes.p25_v14']).toMatch(/se déclare à part \(P27\)/);
    expect(n14['purposes.p25_v14']).not.toMatch(/la vérification de ces mesures n'existe pas/);
  });
  it('figures = code: 90 days / 90 days / 12 months, journal 1 year (AuditLog 365 days)', () => {
    const D = RETENTION_POLICY.durations; const r = n14['retention.legal_protection_v14'];
    expect(r).toMatch(new RegExp(`${D.LEGAL_PROTECTION_DECLARED_STALE_DAYS.days} jours après avoir été faite`));
    expect(r).toMatch(new RegExp(`${D.LEGAL_PROTECTION_REJECTED_DAYS.days} jours après le refus`));
    expect(D.LEGAL_PROTECTION_ENDED_DAYS.days).toBe(365); expect(r).toMatch(/12 mois après sa fin/);
    expect(D.AUDIT_LOG_DAYS.days).toBe(365); expect(r).toMatch(/gardé 1 an/);
  });
  it('the representative\'s obligations in the cgu; no entitlement, no claim of review; six languages with the same figures', () => {
    expect(c13['account.legal_protection_v13']).toMatch(/Vous ne déclarez qu'une décision qui existe, qui vous désigne et qui est en cours/);
    expect(c13['account.legal_protection_v13']).toMatch(/relève du juge/);
    const digits = (/** @type {string} */ t) => (t.match(/\d+/g) || []).join(',');
    for (const [k, t] of Object.entries(ADDED)) { expect(claimsEntitlement(t), k).toBe(false); expect(t, k).not.toMatch(/avocat|juriste|expert/i); }
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      const loc = JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
      for (const [k, t] of Object.entries(ADDED)) { expect(typeof loc[k], `${lang} ${k}`).toBe('string'); expect(digits(loc[k]), `${lang} ${k}`).toBe(digits(t)); }
      expect(loc['privacyNotice.purposes.p25_v14'], lang).toMatch(/P27/);
      const ui = JSON.parse(readFileSync(`src/i18n/locales/${lang}/legalprotection.json`, 'utf8'));
      // FALC: six short sentences for the protected person; the French legal names stay in French in every language
      for (const i of [1, 2, 3, 4, 5, 6]) expect(ui[`falc.${i}`].length, `${lang} falc.${i}`).toBeLessThan(160);
      expect(ui['measure.tutelle']).toMatch(/tutelle/); expect(ui['measure.curatelle_renforcee']).toMatch(/curatelle renforcée/);
    }
  });
});

describe('G14-R3G register line T33 and release preflight', () => {
  it('T33: decided 24/11/2026, durations « non appliqué » (no step approved), art. 9.2.f, no claim of review', () => {
    const reg = JSON.parse(readFileSync('REGISTRE_RGPD.json', 'utf8'));
    const t = reg.traitements.find((/** @type {any} */ x) => x.id === 'T33');
    expect(t.nom).toMatch(/majeur protégé/);
    expect(t.base_legale_proposee).toMatch(/décidé par le responsable le 24\/11\/2026/); expect(t.base_legale_proposee).toMatch(/art\. 9\.2\.f/);
    expect(JSON.stringify(t)).not.toMatch(/à valider|PROPOSÉE|à approuver|question ouverte/);
    const decided = t.conservation.filter((/** @type {any} */ x) => /décidée par le responsable le 24\/11\/2026/.test(x.description));
    expect(decided).toHaveLength(3); for (const c of decided) expect(c.statut).toBe('non appliqué');
    expect(t.mesures_securite).toMatch(/jamais reçue ni stockée/);
    expect(JSON.stringify(t)).not.toMatch(/avocat|juriste a validé|expert a validé|approuvé par le responsable/);
  });
  it('legal.r3_legal_protection: FAIL under the release-2 texts, PASS under notice v14 / cgu v13, absent while closed', async () => {
    const { evaluateReleasePreflight, R3G_LEGAL_CAPABILITY } = await import('../../scripts/release-preflight.mjs');
    expect(R3G_LEGAL_CAPABILITY).toBe('citizen.legal_protection');
    const check = (/** @type {any} */ env) => evaluateReleasePreflight(env, { legalText: 'ok' }).find((/** @type {any} */ x) => x.id === 'legal.r3_legal_protection');
    expect(check({ ...R3G, VITE_LEGAL_DOCS_APPROVED_VERSION: OPEN_R2 }).status).toBe('FAIL');
    expect(check({ ...R3G, VITE_LEGAL_DOCS_APPROVED_VERSION: OPEN_R3 }).status).toBe('PASS');
    expect(check({ ...R3, VITE_LEGAL_DOCS_APPROVED_VERSION: OPEN_R3 })).toBeUndefined();
  });
});
