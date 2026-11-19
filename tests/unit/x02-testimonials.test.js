/**
 * X02 (expansion) — testimonials, offline: the capability is outside the AIPD and closed in every Production configuration (current one, beta lifted,
 * everything else listed, preview); its surface « testimonials » is opened by nothing and takes its routes away from « citizen » and « admin »; the content
 * rules (chosen first name or pseudonym, length, no contact, no link, no phone, no entitlement wording at approval); the closed lists are the same in the
 * service, the screens and the database; the export sections; and NO seed or sample testimonial anywhere outside the clearly labelled test fixtures.
 * Nothing here touches a database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, capabilitiesOfRoute, capabilityState } from '../../api/_utils/capabilities.js';
import { SURFACES, isAllowedInPublicBeta, surfaceOf } from '../../api/_utils/public-beta.js';
import { EXPORT_SECTION_TABLES } from '../../api/_services/export-account-sections.js';
import { USER_PERSONAL_DATA_LINEAGE } from '../../api/_services/privacy.js';
import * as svc from '../../api/_services/testimonials.js';
import * as front from '../../src/lib/testimonials.js';
import { routes } from '../../api/routes.js';

const ROUTES = ['testimonials', 'citizen/testimonials', 'admin/testimonials'];
const PROD_NOW = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts' };
const OTHERS = Object.keys(CAPABILITIES).filter((c) => c !== 'community.testimonials').join(',');
const OK_BODY = 'Le site m’a aidée à trouver la bonne structure près de chez moi et à préparer mon rendez-vous.';

describe('X02 — closed by default (fail-closed)', () => {
  it('« community.testimonials » is a known capability OUTSIDE the AIPD, on its own surface « testimonials », not HDS-bound', () => {
    expect(CAPABILITIES['community.testimonials']).toMatchObject({ aipd: 'out', surface: 'testimonials', requiresHds: false });
    expect(SURFACES.testimonials).toEqual(ROUTES);
  });
  it('closed in the current Production configuration, without the beta, with every other capability listed, in preview — open only when named AND its surface opened', () => {
    for (const env of [PROD_NOW, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'production', ADA_CAPABILITIES_OPEN: OTHERS }, { ...PROD_NOW, ADA_CAPABILITIES_OPEN: OTHERS, ADA_BETA_ACCOUNTS_SCOPE: 'full' },
      { VERCEL_ENV: 'preview' }, { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,testimonials' }, { ...PROD_NOW, ADA_CAPABILITIES_OPEN: 'community.testimonials' },
      { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,events', ADA_CAPABILITIES_OPEN: 'community.events,community.testimonials' },
      { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,testimonials', ADA_CAPABILITIES_OPEN: 'community.*' }]) {
      expect(capabilityState('community.testimonials', env).open, JSON.stringify(env)).toBe(false);
    }
    expect(capabilityState('community.testimonials', { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,testimonials', ADA_CAPABILITIES_OPEN: 'community.testimonials' }).open).toBe(true);
    expect(capabilityState('community.testimonials', { VERCEL_ENV: 'production', ADA_CAPABILITIES_OPEN: 'community.testimonials' }).open).toBe(true);
  });
  it('every route of the surface needs the capability, and the beta gate refuses them all with the Production surfaces', () => {
    for (const r of ROUTES) {
      expect(surfaceOf(r), r).toBe('testimonials');
      expect(capabilitiesOfRoute(r), r).toEqual(['community.testimonials']);
      for (const m of ['GET', 'POST']) expect(isAllowedInPublicBeta(m, r, PROD_NOW), `${m} ${r}`).toBe(false);
    }
    expect(surfaceOf('citizen/events')).toBe('events'); expect(surfaceOf('citizen/notifications')).toBe('accounts'); expect(surfaceOf('admin/resources')).toBe('admin');
    const table = routes.map((r) => r.path);
    for (const p of ROUTES) expect(table).toContain(p);
  });
});

describe('X02 — content rules', () => {
  it('a first name or a pseudonym — one word, an optional initial; never an e-mail, digits or « first name + surname »', () => {
    for (const ok of ['Marie', 'Jean-Pierre', 'Marie D.', 'Zoé', 'Ayşe', 'Олена', 'فاطمة', "N'Golo", 'Lune'] ) expect(svc.DISPLAY_NAME.test(ok), ok).toBe(true);
    for (const bad of ['marie@example.test', 'Marie Dupont', 'M', 'Marie2', 'Jean Pierre Martin', '', '  ', '<b>x</b>']) expect(svc.DISPLAY_NAME.test(bad), bad).toBe(false);
  });
  it('length, contact details, links and phone numbers are refused; markup is removed', () => {
    expect(svc.contentProblems({ displayName: 'Marie', body: OK_BODY })).toEqual([]);
    expect(svc.contentProblems({ displayName: 'Marie', body: 'Trop court.' })).toContain('BODY_TOO_SHORT');
    expect(svc.contentProblems({ displayName: 'Marie', body: 'x'.repeat(1501) })).toContain('BODY_TOO_LONG');
    expect(svc.contentProblems({ displayName: 'Marie', body: `${OK_BODY} Écrivez-moi : marie@example.test` })).toContain('CONTACT_OR_LINK_IN_TEXT');
    expect(svc.contentProblems({ displayName: 'Marie', body: `${OK_BODY} Voir https://exemple.test/x` })).toContain('CONTACT_OR_LINK_IN_TEXT');
    expect(svc.contentProblems({ displayName: 'Marie', body: `${OK_BODY} Appelez le 06 12 34 56 78.` })).toContain('PHONE_IN_TEXT');
    expect(svc.contentProblems({ displayName: 'Marie Dupont', body: OK_BODY })).toContain('DISPLAY_NAME_INVALID');
    expect(svc.plain('<script>alert(1)</script>Bonjour\u0000 à tous')).toBe('alert(1)Bonjour à tous');
  });
  it('the approval refuses entitlement wording (« vous avez droit ») — the moderator sees it as a problem', () => {
    expect(svc.approvalProblems({ displayName: 'Marie', body: `${OK_BODY} Vous avez droit à cette aide, allez-y.` })).toContain('ENTITLEMENT_WORDING');
    expect(svc.approvalProblems({ displayName: 'Marie', body: OK_BODY })).toEqual([]);
  });
});

describe('X02 — one vocabulary for the service, the screens and the database', () => {
  it('reasons, languages, consent version and limits are identical', () => {
    expect([...front.REASONS]).toEqual([...svc.REASONS]);
    expect([...front.TESTIMONIAL_LANGS]).toEqual([...svc.LANGS]);
    expect(front.TESTIMONIAL_CONSENT_VERSION).toBe(svc.TESTIMONIAL_CONSENT_VERSION);
    expect([front.BODY_MIN, front.BODY_MAX]).toEqual([svc.BODY_MIN, svc.BODY_MAX]);
    const migration = fs.readFileSync('drizzle/0054_x02_testimonials.sql', 'utf8');
    const reasons = svc.REASONS.map((r) => `'${r}'`).join(', ');
    expect(migration).toContain(`"Testimonial"."moderationReason" IN (${reasons})`);
    expect(migration).toContain(`"TestimonialReport"."reason" IN (${reasons})`);
    expect(migration).toContain(`BETWEEN ${svc.BODY_MIN} AND ${svc.BODY_MAX}`);
  });
  it('the export has a section for each table, and both tables cascade with the account (lineage)', () => {
    expect(EXPORT_SECTION_TABLES).toMatchObject({ testimonials: 'Testimonial', testimonialReports: 'TestimonialReport' });
    expect(USER_PERSONAL_DATA_LINEAGE.CitizenProfile.storageEntities).toEqual(expect.arrayContaining(['Testimonial', 'TestimonialReport']));
    const migration = fs.readFileSync('drizzle/0054_x02_testimonials.sql', 'utf8');
    for (const fk of ['Testimonial_user_fkey', 'TestimonialReport_testimonial_fkey', 'TestimonialReport_user_fkey']) expect(migration).toMatch(new RegExp(`"${fk}" FOREIGN KEY .* ON DELETE cascade`));
  });
});

describe('X02 — only real testimonials: no seed, no sample', () => {
  /** every text file of the repository that ships or seeds something (tests excluded: their fixtures are labelled synthetic) */
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'tests', 'coverage', 'meta', 'e2e-r47'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out); else if (/\.(m?js|jsx|ts|tsx|sql|json)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  it('the only writer of Testimonial is api/_services/testimonials.js; no SQL file inserts a testimonial; no seed script names it', () => {
    const files = ['api', 'src', 'scripts', 'drizzle', 'public'].filter((d) => fs.existsSync(d)).flatMap((d) => walk(d)).concat(fs.readdirSync('.').filter((f) => /^seed/.test(f)));
    const writers = files.filter((f) => /insert\(\s*Testimonial\b|INSERT INTO\s+"?Testimonial"?\s*\(/.test(fs.readFileSync(f, 'utf8')));
    expect(writers).toEqual([path.join('api', '_services', 'testimonials.js')]);
    for (const f of files.filter((x) => /seed/i.test(x))) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/Testimonial|t[ée]moignage/i);
  });
  it('the screens hold no sample testimonial: they only show what the API returns, and an empty list says so', () => {
    for (const f of ['src/pages/Testimonials.jsx', 'src/pages/CompteTemoignages.jsx', 'src/pages/admin/TestimonialsAdmin.jsx', 'src/lib/testimonials.js']) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\b(?:SAMPLE|DEMO|FAKE|PLACEHOLDER)_?TESTIMONIALS?\b|exampleTestimonials|mockTestimonials/i);
    }
    expect(fs.readFileSync('src/pages/Testimonials.jsx', 'utf8')).toContain('testimonials:list.empty');
  });
  it('the public answer is never cached (a withdrawal is effective at once)', () => {
    expect(fs.readFileSync('api/_handlers/testimonials.js', 'utf8')).toMatch(/Cache-Control', 'no-store'/);
  });
});
