import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * OpenAPI contract tests — vérifier le handler et le fichier spec.
 */
describe('OpenAPI contract', () => {
  it('openapi handler exists and exports default', async () => {
    const mod = await import('../../api/_handlers/openapi.js');
    expect(typeof mod.default).toBe('function');
  });

  it('openapi.json exists and is valid', () => {
    const file = resolve('docs/openapi.json');
    if (!existsSync(file)) {
      // Skip si pas de fichier — le handler le génère à la volée
      return;
    }
    const content = readFileSync(file, 'utf-8');
    const json = JSON.parse(content);
    expect(json.openapi || json.swagger).toBeDefined();
    expect(json.info).toBeDefined();
    expect(json.paths).toBeDefined();
  });

  // Audit A22 / V-X10 — route coverage: the two tests above only parsed the file, so 21 professional routes and every institution route were missing unnoticed.
  describe('route coverage against api/routes.js', () => {
    const routes = [...readFileSync(resolve('api/routes.js'), 'utf-8').matchAll(/\{\s*path:\s*'([^']+)',\s*match:\s*'(exact|prefix)'/g)].map((m) => ({ path: m[1].replace(/\/$/, ''), match: m[2] }));
    const spec = JSON.parse(readFileSync(resolve('docs/openapi.json'), 'utf-8'));
    const paths = Object.keys(spec.paths);
    // an exact route is documented under its own path; a prefix route under its own path or under paths below it
    const documented = (r) => paths.some((p) => p === `/${r.path}` || (r.match === 'prefix' && p.startsWith(`/${r.path}/`)));

    it('reads the route table (a parsing change must not empty this test)', () => {
      expect(routes.length).toBeGreaterThan(200);
      expect(routes.length).toBe((readFileSync(resolve('api/routes.js'), 'utf-8').match(/\bpath:\s*'/g) || []).length);
    });

    it('every route is in the spec or in the frozen list of routes not documented yet; a NEW route must be documented', () => {
      const missing = routes.filter((r) => !documented(r) && !NOT_DOCUMENTED_YET.includes(r.path)).map((r) => r.path);
      expect(missing, 'routes of api/routes.js absent from docs/openapi.json').toEqual([]);
    });

    it('the frozen list only shrinks: no entry that is documented, unknown, or of the professional / institution spaces', () => {
      const known = new Set(routes.map((r) => r.path));
      expect(NOT_DOCUMENTED_YET.filter((p) => !known.has(p)), 'not a route any more').toEqual([]);
      expect(NOT_DOCUMENTED_YET.filter((p) => documented(routes.find((r) => r.path === p))), 'documented: remove it from the list').toEqual([]);
      expect(NOT_DOCUMENTED_YET.filter((p) => /^(pro|institution)(\/|$)/.test(p)), 'professional and institution routes are always documented').toEqual([]);
      expect(new Set(NOT_DOCUMENTED_YET).size).toBe(NOT_DOCUMENTED_YET.length);
    });

    it('every professional and institution route is documented, with its HTTP methods and a tag that exists', () => {
      const scoped = routes.filter((r) => /^(pro|institution)(\/|$)/.test(r.path));
      expect(scoped.length).toBeGreaterThan(55);
      expect(scoped.filter((r) => !documented(r)).map((r) => r.path)).toEqual([]);
      for (const p of ['login', 'forgot', 'reset', 'password', 'logout', 'me', 'observatoire', 'export']) expect(paths, p).toContain(`/institution/${p}`);
      const tags = new Set(spec.tags.map((t) => t.name));
      for (const [p, item] of Object.entries(spec.paths)) for (const [method, op] of Object.entries(item)) {
        expect(['get', 'post', 'put', 'patch', 'delete'], `${p} ${method}`).toContain(method);
        for (const t of op.tags || []) expect(tags.has(t), `${p}: tag ${t}`).toBe(true);
        expect(Object.keys(op.responses || {}).length, `${p} ${method}: responses`).toBeGreaterThan(0);
      }
    });

    it('the institution statistics are documented as scoped: bearer of the institution family, no territory parameter, the refusals', () => {
      for (const p of ['/institution/observatoire', '/institution/export']) {
        const op = spec.paths[p].get;
        expect(op.security).toEqual([{ InstitutionBearer: [] }]);
        expect((op.parameters || []).map((x) => x.name).filter((n) => n !== 'period')).toEqual([]);
        expect(Object.keys(op.responses)).toEqual(expect.arrayContaining(['200', '400', '401', '403']));
        expect(op.responses['403'].description).toMatch(/TERRITORY_SCOPE_UNDEFINED/);
      }
      expect(spec.components.securitySchemes.InstitutionBearer).toMatchObject({ type: 'http', scheme: 'bearer' });
      expect(Object.keys(spec.components.schemas.InstitutionObservatoire.properties)).toEqual(expect.arrayContaining(['scope', 'byNeed', 'byCommune', 'trend', 'totals', 'methodology']));
    });
  });
});

/** Routes that existed without documentation when the coverage test was added (audit A22). Remove an entry when its route is documented; never add one. */
const NOT_DOCUMENTED_YET = [
  'health/live', 'health/ready', 'health/diagnostic', 'status', 'monitor/csp-report', 'monitor/mail-events/mailjet', 'monitor/sms-inbound/twilio',
  'robots.txt', 'robots', 'sitemap.xml', 'public/page', 'sitemap', 'support', 'auth/delete-account', 'auth/franceconnect', 'auth/export-data',
  'messages', 'public/dossier-grants', 'aids', 'search-pro', 'translations', 'glossaire', 'cron/veille', 'cron/referral-timeouts',
  'cron/parcours-reminder', 'cron/gdpr-purge', 'cron/health-alert', 'admin/content-verification', 'admin/news-editorial', 'admin/veille',
  'admin/content', 'admin/structure-proposals', 'admin/duplicates', 'admin/dsr-review', 'admin/dsr-erasure', 'admin/org-closure',
  'admin/processing-restrictions', 'admin/mail-suppressions', 'admin/guardianships', 'admin/service-sensitivity', 'admin/organizations',
  'admin/ws2-queue', 'admin/login', 'admin/elevation', 'admin/sessions', 'admin/content-versions', 'admin/audit-log', 'admin/platform',
  'admin/provider-status', 'admin/security-signals', 'admin/privacy', 'admin/support', 'admin/data-quality', 'admin/institutions', 'admin/funding',
  'admin/pilot', 'admin/falc', 'admin/ai-oversight', 'citizen/profile', 'citizen/age-declaration', 'citizen/email-change',
  'citizen/email-change-confirm', 'citizen/phone', 'citizen/household', 'citizen/guardians', 'citizen/preferences', 'citizen/push', 'citizen/shares',
  'citizen/parcours', 'citizen/favorites', 'citizen/history', 'citizen/coffre', 'citizen/notifications', 'citizen/espace', 'citizen/dossier',
  'citizen/delegations', 'citizen/referrals', 'citizen/restriction', 'admin/orchestrator', 'share/thread',
];
