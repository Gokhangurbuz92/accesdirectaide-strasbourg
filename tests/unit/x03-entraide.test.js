/**
 * X03 (expansion) — Entraide, offline: the capability is outside the AIPD and closed in every Production configuration (current one, beta lifted, everything
 * else listed, preview, « community.* »); its surface « entraide » is opened by nothing, takes its routes away from « citizen » and « admin », has no anonymous
 * route, and the activation simulator keeps it closed in the final configuration; the AIPD guard comment is present where an opening would be made;
 * privacy by design: CLOSED lists (no health / disability / addiction / legal-status / religion / sexuality / ethnicity category; areas are communes or
 * quartiers, no address or position column), note rules (contacts, links, phones, markup and money REFUSED), no score / ranking / matching column or code,
 * no messaging route; the same vocabulary in the service, the screens and the database; export sections and lineage; NO seed or sample offer anywhere.
 * Nothing here touches a database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { CAPABILITIES, capabilitiesOfRoute, capabilityState } from '../../api/_utils/capabilities.js';
import { SURFACES, isAllowedInPublicBeta, surfaceOf } from '../../api/_utils/public-beta.js';
import { EXPORT_SECTION_TABLES } from '../../api/_services/export-account-sections.js';
import { USER_PERSONAL_DATA_LINEAGE } from '../../api/_services/privacy.js';
import * as svc from '../../api/_services/entraide.js';
import * as front from '../../src/lib/entraide.js';
import { entraideOpened, isBetaRestrictedPath } from '../../src/lib/publicBeta.js';
import { routes } from '../../api/routes.js';

const ROUTES = ['citizen/entraide', 'admin/entraide'];
const PROD_NOW = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts' };
const OTHERS = Object.keys(CAPABILITIES).filter((c) => c !== 'community.entraide').join(',');
const MIGRATION = fs.readFileSync('drizzle/0057_x03_entraide.sql', 'utf8');

describe('X03 — closed by default (fail-closed), dedicated AIPD first', () => {
  it('« community.entraide » is a known capability OUTSIDE the AIPD, on its own surface « entraide », not HDS-bound; its reference names the dedicated AIPD', () => {
    expect(CAPABILITIES['community.entraide']).toMatchObject({ aipd: 'out', surface: 'entraide', requiresHds: false });
    expect(CAPABILITIES['community.entraide'].aipdRef).toMatch(/DEDICATED AIPD mandatory before any opening/);
    expect(SURFACES.entraide).toEqual(ROUTES);
  });
  it('closed in the current Production configuration, without the beta, with every other capability listed, « community.* », in preview — open only when named AND its surface opened', () => {
    for (const env of [PROD_NOW, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'production', ADA_CAPABILITIES_OPEN: OTHERS }, { ...PROD_NOW, ADA_CAPABILITIES_OPEN: OTHERS, ADA_BETA_ACCOUNTS_SCOPE: 'full' },
      { VERCEL_ENV: 'preview' }, { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,entraide' }, { ...PROD_NOW, ADA_CAPABILITIES_OPEN: 'community.entraide' },
      { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,stories', ADA_CAPABILITIES_OPEN: 'community.stories,community.entraide' },
      { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,entraide', ADA_CAPABILITIES_OPEN: 'community.*' }]) {
      expect(capabilityState('community.entraide', env).open, JSON.stringify(env)).toBe(false);
    }
    expect(capabilityState('community.entraide', { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,entraide', ADA_CAPABILITIES_OPEN: 'community.entraide' }).open).toBe(true);
  });
  it('every route of the surface needs the capability; the beta gate refuses them with the Production surfaces (accounts « full » included); no anonymous route', () => {
    for (const r of ROUTES) {
      expect(surfaceOf(r), r).toBe('entraide');
      expect(capabilitiesOfRoute(r), r).toEqual(['community.entraide']);
      for (const m of ['GET', 'POST']) {
        expect(isAllowedInPublicBeta(m, r, PROD_NOW), `${m} ${r}`).toBe(false);
        expect(isAllowedInPublicBeta(m, r, { ...PROD_NOW, ADA_BETA_ACCOUNTS_SCOPE: 'full' }), `${m} ${r} full`).toBe(false);
      }
    }
    const table = routes.map((r) => r.path).filter((p) => /entraide|peer|match|mutual|volunteer|benevol/i.test(p));
    expect(table.sort()).toEqual(['admin/entraide', 'citizen/entraide']);
  });
  it('no messaging surface: no route, handler action or table for messages / chat; no score, ranking or matching column or code', () => {
    const handler = fs.readFileSync('api/_handlers/citizen/entraide.js', 'utf8');
    expect(handler.match(/case '([a-z_]+)'/g).map((x) => x.slice(6, -1)).sort()).toEqual(['accept_charter', 'block', 'contact_revoke', 'contact_share', 'join', 'leave',
      'offer_close', 'offer_create', 'offer_pause', 'offer_reopen', 'report', 'request_accept', 'request_create', 'request_decline', 'request_end', 'unblock'].sort());
    expect(MIGRATION).not.toMatch(/"(?:message|body|chat|thread|score|rank|match\w*|latitude|longitude|lat|lng|geom|address|adresse|postalCode|street)"/i);
    const service = fs.readFileSync('api/_services/entraide.js', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(service).not.toMatch(/\bscore|similarity|distance|ORDER BY .*rank|orderBy\([^)]*(?:score|rank)/i);
  });
  it('the screens follow ONLY the « entraide » surface (/compte and /admin do not open them); the simulator keeps it closed in the final configuration', async () => {
    for (const p of ['/compte/entraide', '/admin/entraide']) {
      expect(isBetaRestrictedPath(p, ['admin', 'accounts'], { accountsScope: 'full', proSelfRegistration: false }), p).toBe(true);
      expect(isBetaRestrictedPath(p, ['entraide']), p).toBe(false);
    }
    expect(entraideOpened(true, ['admin', 'accounts'])).toBe(false); expect(entraideOpened(false, [])).toBe(true);
    const sim = await import('../../scripts/activation-simulator.mjs');
    expect(sim.EXPANSION_SURFACES).toContain('entraide');
    const item = sim.buildItems().find((i) => i.id === 'surface.entraide');
    expect(item).toMatchObject({ finalExpected: 'closed', features: ['X03'] });
  });
  it('the AIPD guard is written where an opening would be made (capability, surface, service, handlers, migration)', () => {
    for (const f of ['api/_utils/capabilities.js', 'api/_utils/public-beta.js', 'api/_services/entraide.js', 'api/_handlers/citizen/entraide.js', 'api/_handlers/admin/entraide.js', 'drizzle/0057_x03_entraide.sql']) {
      expect(fs.readFileSync(f, 'utf8'), f).toMatch(/dedicated AIPD/i);
    }
  });
});

describe('X03 — privacy by design: closed lists', () => {
  it('categories are practical help only: none names health, disability, addiction, legal status, religion, sexuality, ethnicity or debt', () => {
    expect(svc.CATEGORIES.length).toBeGreaterThanOrEqual(5);
    for (const c of svc.CATEGORIES) expect(svc.FORBIDDEN_CATEGORY_TOPICS.test(c), c).toBe(false);
    // the guard itself works
    for (const bad of ['HEALTH_SUPPORT', 'SANTE_MENTALE', 'DISABILITY_HELP', 'ADDICTION', 'LEGAL_STATUS', 'TITRE_DE_SEJOUR', 'RELIGIOUS', 'SEXUALITY', 'ETHNIC_COMMUNITY', 'DEBT']) {
      expect(svc.FORBIDDEN_CATEGORY_TOPICS.test(bad), bad).toBe(true);
    }
  });
  it('areas are communes / quartiers of the Eurométropole only — no address, number, postal code or coordinates', () => {
    for (const a of svc.AREAS) expect(a, a).toMatch(/^[A-Z_]+$/);
    expect(svc.AREAS).toContain('AUTRE_EUROMETROPOLE');
  });
  it('one vocabulary for the service, the screens and the database CHECKs', () => {
    expect([...front.CATEGORIES]).toEqual([...svc.CATEGORIES]);
    expect([...front.AREAS]).toEqual([...svc.AREAS]);
    expect([...front.REASONS]).toEqual([...svc.REASONS]);
    expect([front.CHARTER_VERSION, front.CONTACT_VERSION, front.NOTE_MAX]).toEqual([svc.CHARTER_VERSION, svc.CONTACT_VERSION, svc.NOTE_MAX]);
    const list = (xs) => xs.map((x) => `'${x}'`).join(', ');
    expect(MIGRATION).toContain(`"EntraideOffer"."category" IN (${list(svc.CATEGORIES)})`);
    expect(MIGRATION).toContain(`"EntraideOffer"."area" IN (${list(svc.AREAS)})`);
    expect(MIGRATION).toContain(`"EntraideReport"."reason" IN (${list(svc.REASONS)})`);
    expect(MIGRATION).toContain(`"EntraideMember"."suspensionReason" IN (${list(svc.REASONS)})`);
    expect(MIGRATION).toContain(`char_length("EntraideOffer"."note") BETWEEN 1 AND ${svc.NOTE_MAX}`);
    expect(svc.CHARTER_VERSION).toMatch(/projet/); expect(svc.CONTACT_VERSION).toMatch(/projet/);
    expect([svc.CHARTER_PURPOSE, svc.CONTACT_PURPOSE]).toEqual(['ENTRAIDE_VOLUNTEER_CHARTER', 'ENTRAIDE_CONTACT_SHARE']);
  });
  it('every category and reason has a French label on screen (no raw code shown)', () => {
    const t = (_k, fb) => fb;
    for (const c of front.CATEGORIES) expect(front.categoryLabel(c, t)).not.toBe(c);
    for (const r of front.REASONS) expect(front.reasonLabel(r, t)).not.toBe(r);
    for (const a of front.AREAS) expect(front.areaLabel(a, t)).not.toBe(a);
  });
});

describe('X03 — the logistics note (refused, never silently cleaned)', () => {
  it('a practical note passes; an empty note is allowed; length is enforced', () => {
    expect(svc.noteProblems('Disponible le samedi matin, je parle aussi turc.')).toEqual([]);
    expect(svc.noteProblems('')).toEqual([]); expect(svc.noteProblems(null)).toEqual([]);
    expect(svc.noteProblems('x'.repeat(281))).toContain('NOTE_TOO_LONG');
  });
  it('contacts, links, handles, phone numbers and markup are refused (the e-mail goes through the explicit reveal only)', () => {
    expect(svc.noteProblems('Écrivez-moi : lune@example.test')).toContain('CONTACT_OR_LINK_IN_TEXT');
    expect(svc.noteProblems('Voir https://exemple.test')).toContain('CONTACT_OR_LINK_IN_TEXT');
    expect(svc.noteProblems('Suivez @lune_67')).toContain('CONTACT_OR_LINK_IN_TEXT');
    expect(svc.noteProblems('Appelez le 06 12 34 56 78')).toContain('PHONE_IN_TEXT');
    expect(svc.noteProblems('<b>urgent</b>')).toContain('IMAGE_OR_MARKUP');
  });
  it('money is refused: Entraide is free (prices, amounts, payment)', () => {
    for (const bad of ['10 € de l’heure', 'contre 20 euros', 'je peux payer', 'paiement en liquide', 'à prix libre', 'rémunération possible', 'cash only']) {
      expect(svc.noteProblems(bad), bad).toContain('MONEY_IN_NOTE');
    }
    for (const ok of ['Je peux aider le mardi', 'Je connais bien le quartier', 'Paysage de la Robertsau']) expect(svc.noteProblems(ok), ok).toEqual([]);
  });
});

describe('X03 — data rights', () => {
  it('the export has a section for each table, and the six tables cascade with the account (lineage, foreign keys)', () => {
    expect(EXPORT_SECTION_TABLES).toMatchObject({ entraideMember: 'EntraideMember', entraideOffers: 'EntraideOffer', entraideRequests: 'EntraideRequest',
      entraideRequestsReceived: 'EntraideRequest', entraideContactShares: 'EntraideContactShare', entraideReports: 'EntraideReport', entraideBlocks: 'EntraideBlock' });
    expect(USER_PERSONAL_DATA_LINEAGE.CitizenProfile.storageEntities).toEqual(expect.arrayContaining(['EntraideMember', 'EntraideOffer', 'EntraideRequest',
      'EntraideContactShare', 'EntraideReport', 'EntraideBlock']));
    const fks = [...MIGRATION.matchAll(/ADD CONSTRAINT "(\w+)" FOREIGN KEY .* ON DELETE (\w+)/g)].map((m) => [m[1], m[2]]);
    expect(fks).toHaveLength(10);
    for (const [name, rule] of fks) expect(rule, name).toBe('cascade');
    expect(MIGRATION).toMatch(/"EntraideMember_user_fkey" FOREIGN KEY \("citizenUserId"\) REFERENCES "public"."CitizenUser"\("id"\) ON DELETE cascade/);
  });
  it('the export of received requests leaves out the requester’s note; the reports and blocks exports leave out whom', () => {
    const d = new PgDialect();
    const text = (q) => d.sqlToQuery(q).sql.split(/\bFROM\b/)[0];
    expect(text(svc.entraideRequestsReceivedExportSql('u'))).not.toMatch(/note|requesterId|pseudonym/);
    expect(text(svc.entraideReportsExportSql('u'))).not.toMatch(/targetId/);
    expect(text(svc.entraideBlocksExportSql('u'))).not.toMatch(/blockedId/);
  });
});

describe('X03 — only real offers: no seed, no sample', () => {
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'tests', 'coverage', 'meta', 'e2e-r47'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out); else if (/\.(m?js|jsx|ts|tsx|sql|json)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  it('the only writer of the six tables is api/_services/entraide.js; no SQL file inserts into them; no seed script names them', () => {
    const files = ['api', 'src', 'scripts', 'drizzle', 'public'].filter((d) => fs.existsSync(d)).flatMap((d) => walk(d)).concat(fs.readdirSync('.').filter((f) => /^seed/.test(f)));
    const writers = files.filter((f) => /insert\(\s*Entraide\w*\b|INSERT INTO\s+"?Entraide\w*"?\s*\(/.test(fs.readFileSync(f, 'utf8')));
    expect(writers).toEqual([path.join('api', '_services', 'entraide.js')]);
    for (const f of files.filter((x) => /seed/i.test(x))) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/Entraide/i);
  });
  it('the screens hold no sample offer: they only show what the API returns, and an empty list says so', () => {
    for (const f of ['src/pages/CompteEntraide.jsx', 'src/pages/admin/EntraideAdmin.jsx', 'src/lib/entraide.js']) {
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/\b(?:SAMPLE|DEMO|FAKE|PLACEHOLDER)_?OFFERS?\b|exampleOffers|mockOffers/i);
    }
    expect(fs.readFileSync('src/pages/CompteEntraide.jsx', 'utf8')).toContain('entraide:browse.empty');
  });
  it('every answer of the member side and of the moderation is never cached', () => {
    expect(fs.readFileSync('api/_utils/citizen-handler.js', 'utf8')).toMatch(/Cache-Control', 'no-store'/);
    expect(fs.readFileSync('api/_handlers/admin/entraide.js', 'utf8')).toMatch(/Cache-Control', 'no-store'/);
  });
});
