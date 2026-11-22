/**
 * X05 (expansion) — inclusive job board, offline: the capability is outside the AIPD and closed in every Production configuration (current one, « pro »
 * opened, beta lifted, everything else listed, preview); its surface « employment » is opened by nothing and takes its routes away from « pro » and « admin »;
 * the listing rules (required fields, closed lists, the https / e-mail application channel, the end date in Paris days, contacts and markup in the text,
 * entitlement wording); the refusal of any discriminatory criterion field (Code du travail L1132-1) and of any unknown field; the closed lists are the same in
 * the service, the screens and the database; NO applicant data anywhere (no route, no column, no form field); no seed or sample listing; the activation
 * simulator keeps it out of the final configuration. Nothing here touches a database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, capabilitiesOfRoute, capabilityState } from '../../api/_utils/capabilities.js';
import { SURFACES, isAllowedInPublicBeta, surfaceOf } from '../../api/_utils/public-beta.js';
import { proModuleStates } from '../../api/_utils/pro-modules.js';
import * as svc from '../../api/_services/job-board.js';
import * as front from '../../src/lib/jobBoard.js';
import { isBetaRestrictedPath, employmentOpened } from '../../src/lib/publicBeta.js';
import { moduleOfScreen } from '../../src/lib/proModules.js';
import { routes } from '../../api/routes.js';

const ROUTES = ['employment', 'pro/employment', 'admin/employment'];
const PROD_NOW = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts' };
const OTHERS = Object.keys(CAPABILITIES).filter((c) => c !== 'community.employment').join(',');
const TODAY = '2026-11-19';
const OK = { title: 'Agent d’accueil', contractType: 'CDI', city: 'Strasbourg', postalCode: '67000',
  description: 'Accueil du public, orientation des visiteurs, tenue du standard. Formation assurée à la prise de poste.', accommodations: ['FLEXIBLE_HOURS'],
  applyMethod: 'url', applyTarget: 'https://employeur.example.test/candidature', expiresOn: '2026-12-19' };
const problems = (over) => svc.listingProblems(svc.normalize({ ...OK, ...over }), TODAY);

describe('X05 — closed by default (fail-closed)', () => {
  it('« community.employment » is a known capability OUTSIDE the AIPD, on its own surface « employment », not HDS-bound', () => {
    expect(CAPABILITIES['community.employment']).toMatchObject({ aipd: 'out', surface: 'employment', requiresHds: false });
    expect(SURFACES.employment).toEqual(ROUTES);
  });
  it('closed in the current Production configuration, with « pro » opened, without the beta, with every other capability listed, in preview — open only when named AND its surface opened', () => {
    for (const env of [PROD_NOW, { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro' }, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'production', ADA_CAPABILITIES_OPEN: OTHERS },
      { VERCEL_ENV: 'preview' }, { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro,employment' }, { ...PROD_NOW, ADA_CAPABILITIES_OPEN: 'community.employment' },
      { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro,stories', ADA_CAPABILITIES_OPEN: 'community.stories,community.employment' },
      { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,employment', ADA_CAPABILITIES_OPEN: 'community.*' }]) {
      expect(capabilityState('community.employment', env).open, JSON.stringify(env)).toBe(false);
    }
    expect(capabilityState('community.employment', { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,employment', ADA_CAPABILITIES_OPEN: 'community.employment' }).open).toBe(true);
    expect(capabilityState('community.employment', { VERCEL_ENV: 'production', ADA_CAPABILITIES_OPEN: 'community.employment' }).open).toBe(true);
  });
  it('every route of the surface needs the capability and is refused by the beta gate with the Production surfaces, « pro » included', () => {
    for (const r of ROUTES) {
      expect(surfaceOf(r), r).toBe('employment');
      expect(capabilitiesOfRoute(r), r).toEqual(['community.employment']);
      for (const open of ['admin,accounts', 'admin,accounts,pro']) for (const m of ['GET', 'POST']) expect(isAllowedInPublicBeta(m, r, { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: open }), `${m} ${r} ${open}`).toBe(false);
    }
    expect(surfaceOf('pro/structure')).toBe('pro'); expect(surfaceOf('cron/actualites')).toBe('jobs');
    const table = routes.map((r) => r.path);
    for (const p of ROUTES) expect(table).toContain(p);
  });
  it('the console module and the screens follow the « employment » surface only (never « pro »)', () => {
    expect(proModuleStates({ ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro' }).employment).toBe(false);
    expect(proModuleStates({ ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro,employment', ADA_CAPABILITIES_OPEN: 'community.employment' }).employment).toBe(true);
    expect(moduleOfScreen('/pro/offres-emploi')).toBe('employment');
    for (const p of ['/offres-emploi', '/pro/offres-emploi', '/admin/offres-emploi']) {
      expect(isBetaRestrictedPath(p, ['admin', 'accounts', 'pro']), p).toBe(true);
      expect(isBetaRestrictedPath(p, ['employment']), p).toBe(false);
    }
    expect(employmentOpened(true, ['admin', 'accounts'])).toBe(false); expect(employmentOpened(false, [])).toBe(true);
  });
  it('the activation simulator keeps X05 out of the final configuration (an expansion item opened by its own owner decision)', async () => {
    const sim = await import('../../scripts/activation-simulator.mjs');
    expect(sim.EXPANSION_SURFACES).toContain('employment');
  });
});

describe('X05 — applicants: nothing stored (« GDPR for applicants » by minimisation)', () => {
  it('no application route, no applicant table or column, no form field to apply: the listing gives the employer’s own channel', () => {
    expect(routes.map((r) => r.path).filter((p) => /employ|job|candidat|appl/i.test(p)).sort()).toEqual(['admin/employment', 'employment', 'pro/employment']);
    const schema = fs.readFileSync('src/db/schema.ts', 'utf8');
    expect(schema).not.toMatch(/pgTable\('Job(?!Listing')/); expect(schema).not.toMatch(/pgTable\('[A-Za-z]*(Application|Applicant|Candida)/);
    const sql = fs.readFileSync('drizzle/0056_x05_job_board.sql', 'utf8').split('\n').filter((l) => !l.startsWith('--')).join('\n');
    expect(sql).not.toMatch(/applicant|candidat|createdBy|email"/i);
    const pub = fs.readFileSync('src/pages/JobBoard.jsx', 'utf8');
    expect(pub).not.toMatch(/<form|<input|<textarea|type="file"|POST/);
    expect(fs.readFileSync('api/_handlers/employment.js', 'utf8')).toMatch(/req\.method !== 'GET' && req\.method !== 'HEAD'/);
  });
});

describe('X05 — listing rules', () => {
  it('a complete listing passes; required fields are enforced', () => {
    expect(problems({})).toEqual([]);
    expect(problems({ title: 'abc' })).toContain('TITLE_TOO_SHORT');
    expect(problems({ contractType: '' })).toContain('CONTRACT_TYPE_REQUIRED');
    expect(problems({ city: '' })).toContain('CITY_REQUIRED');
    expect(problems({ postalCode: '6700A' })).toContain('POSTAL_CODE_INVALID');
    expect(problems({ description: 'trop court' })).toContain('DESCRIPTION_TOO_SHORT');
    expect(problems({ accommodations: [] })).toContain('ACCOMMODATION_REQUIRED');
    expect(problems({ accommodations: 'FLEXIBLE_HOURS' })).toContain('ACCOMMODATION_REQUIRED');
    expect(problems({ accommodations: ['FLEXIBLE_HOURS', 'FREE_CAR'] })).toContain('ACCOMMODATION_UNKNOWN');
  });
  it('the application channel: an https address without credentials, or an e-mail address — nothing else', () => {
    for (const ok of ['https://employeur.example.test/x', 'https://www.example.fr/emploi?id=3']) expect(problems({ applyTarget: ok }), ok).toEqual([]);
    for (const bad of ['http://employeur.example.test', 'javascript:alert(1)', 'https://user:pw@example.test/x', 'https://localhost/x', 'https://a b.example.test', 'ftp://x.example.test']) {
      expect(problems({ applyTarget: bad }), bad).toContain('APPLY_TARGET_INVALID');
    }
    expect(problems({ applyMethod: 'email', applyTarget: 'recrutement@example.test' })).toEqual([]);
    expect(problems({ applyMethod: 'email', applyTarget: 'mailto:recrutement@example.test?subject=x' })).toContain('APPLY_TARGET_INVALID');
    expect(problems({ applyMethod: 'form' })).toContain('APPLY_METHOD_REQUIRED');
  });
  it('the end date counts in Paris days: after today, at most 90 days ahead, a real date', () => {
    expect(problems({ expiresOn: TODAY })).toContain('EXPIRY_IN_PAST');
    expect(problems({ expiresOn: '2027-02-17' })).toEqual([]);
    expect(problems({ expiresOn: '2027-02-18' })).toContain('EXPIRY_TOO_FAR');
    expect(problems({ expiresOn: '2026-11-31' })).toContain('EXPIRY_INVALID');
    // 23:30 UTC on 19/11 is already 20/11 in Paris
    expect(svc.parisDay(new Date('2026-11-19T23:30:00Z'))).toBe('2026-11-20');
    expect(svc.addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('contacts, links, phone numbers and markup in the text are refused (the only contact is the application channel); entitlement wording too', () => {
    expect(problems({ description: `${OK.description} Écrivez à rh@example.test.` })).toContain('CONTACT_IN_TEXT');
    expect(problems({ description: `${OK.description} Voir www.example.fr.` })).toContain('CONTACT_IN_TEXT');
    expect(problems({ description: `${OK.description} Tél. 03 88 00 00 00.` })).toContain('CONTACT_IN_TEXT');
    expect(problems({ description: `${OK.description} <b>urgent</b>` })).toContain('IMAGE_OR_MARKUP');
    expect(problems({ title: 'Vous avez droit à un emploi' })).toContain('ENTITLEMENT_WORDING');
  });
});

describe('X05 — discriminatory criteria (Code du travail L1132-1): refused as fields, whatever their value', () => {
  it('every name of the closed list — in any case, with accents or separators — is FORBIDDEN, never « unknown »', () => {
    for (const k of ['age', 'Age', 'age_max', 'ageMin', 'âge', 'sexe', 'Gender', 'nationalité', 'origine', 'santé', 'handicap', 'disability', 'grossesse', 'situation-familiale',
      'religion', 'orientation_sexuelle', 'apparence physique', 'lieu_de_residence', 'photo', 'date_de_naissance']) {
      expect(svc.extraFields({ ...OK, [k]: 'x' }), k).toEqual({ forbidden: [k], unknown: [] });
    }
    expect(svc.extraFields({ ...OK, action: 'create', id: 'x' })).toEqual({ forbidden: [], unknown: [] });
    expect(svc.extraFields({ ...OK, salary: '2000', remote: true })).toEqual({ forbidden: [], unknown: ['salary', 'remote'] });
    expect(svc.L1132_1).toBe('Code du travail, article L1132-1');
  });
  it('the employer service refuses them before anything is stored (400 FORBIDDEN_CRITERION with the legal reference; 400 UNKNOWN_FIELD otherwise)', async () => {
    const calls = [];
    const db = { execute: async () => ({ rows: [{ ok: true }] }), insert: () => { calls.push('insert'); return { values: async () => {} }; } };
    const e = svc.employerListings({ db, audit: async () => {} });
    const ctx = { structureId: 's', userId: 'u', role: 'structure_admin' };
    expect(await e.create(ctx, { ...OK, ageMax: 30 })).toMatchObject({ ok: false, status: 400, code: 'FORBIDDEN_CRITERION', fields: ['ageMax'], legalBasis: 'Code du travail, article L1132-1' });
    expect(await e.create(ctx, { ...OK, bonus: 1 })).toMatchObject({ ok: false, status: 400, code: 'UNKNOWN_FIELD' });
    expect(await e.create({ ...ctx, role: 'pro' }, OK)).toMatchObject({ ok: false, status: 403, code: 'STRUCTURE_ADMIN_REQUIRED' });
    expect(calls).toEqual([]);
  });
  it('the database has no column for such a criterion; the listing fields are a closed list', () => {
    expect(svc.LISTING_FIELDS).toEqual(['title', 'contractType', 'city', 'postalCode', 'description', 'accommodations', 'applyMethod', 'applyTarget', 'expiresOn']);
    for (const f of svc.LISTING_FIELDS) expect(svc.FORBIDDEN_CRITERIA_FIELDS).not.toContain(f.toLowerCase());
  });
});

describe('X05 — one vocabulary', () => {
  it('contract types, accommodations and reasons are identical in the service, the screens and the database CHECKs', () => {
    const migration = fs.readFileSync('drizzle/0056_x05_job_board.sql', 'utf8');
    expect(front.CONTRACT_TYPES).toEqual(svc.CONTRACT_TYPES); expect(front.ACCOMMODATIONS).toEqual(svc.ACCOMMODATIONS); expect(front.REASONS).toEqual(svc.REASONS);
    expect(front.EXPIRY_MAX_DAYS).toBe(svc.EXPIRY_MAX_DAYS); expect(front.DESCRIPTION_MAX).toBe(svc.DESCRIPTION_MAX); expect(front.TITLE_MAX).toBe(svc.TITLE_MAX);
    for (const v of [...svc.CONTRACT_TYPES, ...svc.ACCOMMODATIONS, ...svc.REASONS, ...Object.values(svc.STATES)]) expect(migration, v).toContain(`'${v}'`);
  });
  it('the only writer of JobListing is api/_services/job-board.js; no seed, no sample listing', () => {
    const hits = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['node_modules', 'locales'].includes(e.name)) walk(p); } else if (/\.(m?js|jsx|ts|sql)$/.test(e.name) && /INSERT INTO "JobListing"|insert\(JobListing\)|update\(JobListing\)|UPDATE "JobListing"/.test(fs.readFileSync(p, 'utf8'))) hits.push(p); } };
    for (const d of ['api', 'src', 'scripts', 'drizzle']) walk(d);
    // G14: the retention steps of the decided durations (q23, q25) write it too — expiry, erased channel, deletion — and nothing else does
    expect(hits.sort()).toEqual(['api/_services/gdpr-purge-expansion-steps.js', 'api/_services/job-board.js']);
  });
});
