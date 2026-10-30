// @vitest-environment jsdom
/**
 * Restricted public beta (owner directive 29/10/2026): the API serves only the public read-only information routes, the release gate drops only the
 * services those refused routes need, and the browser explains the closed screens in French.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { isAllowedInPublicBeta, isPublicBetaRestricted, PUBLIC_BETA_MESSAGE } from '../../api/_utils/public-beta.js';
import { evaluateReleasePreflight } from '../../scripts/release-preflight.mjs';
import { isBetaRestrictedPath, openLinks } from '../../src/lib/publicBeta.js';
import { PublicBetaBanner, PublicBetaUnavailable } from '../../src/components/beta/PublicBeta.jsx';

vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');

describe('server allowlist', () => {
  it('serves the public information routes, read-only', () => {
    for (const p of ['health', 'aides', 'aides/aide-x', 'structures', 'demarches/d-1', 'dispositifs', 'search', 'glossaire', 'taxonomy', 'public/page', 'sitemap.xml', 'auth/me'])
      expect(isAllowedInPublicBeta('GET', p), p).toBe(true);
    expect(isAllowedInPublicBeta('HEAD', 'aides')).toBe(true);
  });
  it('refuses accounts, uploads, bookings, sharing, forms, the assistant, admin and crons, and every write', () => {
    for (const p of ['auth/login', 'auth/signup', 'pro/auth/register', 'institution/login', 'admin/login', 'citizen/coffre', 'pro/dossier/upload-secure', 'rdv/x',
      'share/create', 'share/get', 'contact', 'support', 'feedback', 'assistant/chat', 'public/assistant/orient', 'cron/veille', 'cron/health-alert', 'messages/x',
      'diagnostic', 'pdf/x', 'download', 'health/deeper', 'aidesx', 'monitor/csp-report'])
      expect(isAllowedInPublicBeta('GET', p), p).toBe(false);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(isAllowedInPublicBeta(m, 'aides'), m).toBe(false);
    // the citizen searches read only, through a POST body; nothing else is written
    expect(isAllowedInPublicBeta('POST', 'search')).toBe(true);
    expect(isAllowedInPublicBeta('POST', 'search-pro')).toBe(true);
    expect(isAllowedInPublicBeta('PUT', 'search')).toBe(false);
  });
  it('is off unless ADA_PUBLIC_BETA_RESTRICTED is 1/true', () => {
    expect(isPublicBetaRestricted({})).toBe(false);
    expect(isPublicBetaRestricted({ ADA_PUBLIC_BETA_RESTRICTED: '1' })).toBe(true);
    expect(isPublicBetaRestricted({ ADA_PUBLIC_BETA_RESTRICTED: 'TRUE' })).toBe(true);
    expect(isPublicBetaRestricted({ ADA_PUBLIC_BETA_RESTRICTED: '0' })).toBe(false);
  });
});

describe('API entry with the beta on', () => {
  const call = async (method, url) => {
    vi.resetModules();
    const { default: handler } = await import('../../api/index.js');
    const headers = {}; let body;
    const res = {
      statusCode: 200, headersSent: false,
      setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, removeHeader(k) { delete headers[k.toLowerCase()]; },
      status(c) { this.statusCode = c; return this; }, json(b) { body = b; this.headersSent = true; return this; }, send() { this.headersSent = true; return this; },
      end() { this.headersSent = true; return this; }, on() { return this; }, once() { return this; },
    };
    await handler({ method, url, headers: { host: 'x', authorization: 'Bearer x' }, query: {}, cookies: {}, body: {} }, res);
    return { status: res.statusCode, body };
  };
  it('refuses an account route with the French notice before any handler runs', async () => {
    vi.stubEnv('ADA_PUBLIC_BETA_RESTRICTED', '1');
    for (const [m, u] of [['POST', '/api/auth/signup'], ['POST', '/api/citizen/coffre'], ['GET', '/api/admin/dashboard'], ['POST', '/api/cron/veille']]) {
      const r = await call(m, u);
      expect(r.status, u).toBe(503);
      expect(r.body).toMatchObject({ error: 'PUBLIC_BETA_RESTRICTED', message: PUBLIC_BETA_MESSAGE });
    }
    vi.unstubAllEnvs(); vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
  });
  it('a record page reached through the hosting rewrite (original URL /annuaire/<slug>) is the page, not the JSON API nor a refusal', async () => {
    vi.stubEnv('ADA_PUBLIC_BETA_RESTRICTED', '1');
    vi.resetModules();
    const { default: handler } = await import('../../api/index.js');
    const headers = {}; let body; let sent;
    const res = {
      statusCode: 200, headersSent: false,
      setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, removeHeader(k) { delete headers[k.toLowerCase()]; },
      status(c) { this.statusCode = c; return this; }, json(b) { body = b; this.headersSent = true; return this; }, send(b) { sent = b; this.headersSent = true; return this; },
      end(b) { sent = b; this.headersSent = true; return this; }, on() { return this; }, once() { return this; },
    };
    const req = { method: 'GET', url: '/annuaire/mairie-x', headers: { host: 'x' }, query: { path: '/annuaire/mairie-x' }, cookies: {} };
    await handler(req, res);
    expect(body?.error).not.toBe('PUBLIC_BETA_RESTRICTED');
    expect(req.query.path).toBe('/annuaire/mairie-x');
    expect(String(headers['content-type'] || '')).not.toMatch(/json/);
    vi.unstubAllEnvs(); vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
  });
});

describe('record pages served by the API', () => {
  it('carry the same Content-Security-Policy as the static pages (vercel.json)', async () => {
    const { readFileSync } = await import('node:fs');
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const pageCsp = vercel.headers.flatMap((h) => h.headers).find((x) => x.key === 'Content-Security-Policy').value;
    const { PAGE_CSP, pageHeaders } = await import('../../api/_services/page-head.js');
    expect(PAGE_CSP).toBe(pageCsp);
    expect(pageHeaders({ status: 200, etag: 'x', robots: 'index' })['Content-Security-Policy']).toBe(pageCsp);
    expect(pageCsp).toContain("'sha256-Ji1RDZFcXHYwXORx2Mz2R71m8j2Y73X371QJqvYvIHQ='");
  });
});

describe('release gate in the beta', () => {
  const ENV = { AUTH_MODE: 'jwt', AUTH_SECRET: 's'.repeat(40), JWT_SECRET: 'j'.repeat(40), ADA_ENCRYPTION_KEY: 'ab'.repeat(32), CRON_SECRET: 'c'.repeat(32),
    DATABASE_URL: 'postgresql://u@db.example.test/prod', APP_BASE_URL: 'https://www.example.test', ADA_VAULT_KEY: 'cd'.repeat(32), KV_REST_API_URL: 'https://kv.example.test',
    KV_REST_API_TOKEN: 'kv-synthetic', DATABASE_SSL_VERIFY: 'true', MAILER_PROVIDER: 'noop', ADA_PUBLIC_BETA_RESTRICTED: '1' };
  const by = (rs, id) => rs.find((r) => r.id === id).status;
  it('drops only mail, storage and alerts; everything else still fails closed', () => {
    const rs = evaluateReleasePreflight(ENV, { legalText: 'complete' });
    expect(rs.filter((r) => r.status === 'FAIL')).toEqual([]);
    expect(by(rs, 'alerts.webhook')).toBe('WARN');
    const missing = evaluateReleasePreflight({ ADA_PUBLIC_BETA_RESTRICTED: '1' }, { legalText: 'complete' });
    for (const id of ['env.boot_required', 'auth.mode_jwt', 'crypto.encryption_key', 'kv.configured', 'db.tls_verified', 'app.base_url_https']) expect(by(missing, id), id).toBe('FAIL');
  });
  it('still requires the publisher identity and a noop mailer', () => {
    expect(by(evaluateReleasePreflight(ENV, { legalText: '[À COMPLÉTER : éditeur]' }), 'legal.publisher_complete')).toBe('FAIL');
    expect(by(evaluateReleasePreflight({ ...ENV, MAILER_PROVIDER: 'resend' }, { legalText: 'complete' }), 'beta.mailer_noop')).toBe('FAIL');
  });
});

describe('edge middleware: direct api/ functions', () => {
  it('never serves api/lib or api/routes, and refuses api/cron and api/monitor in the beta', async () => {
    const { directFunctionResponse, config } = await import('../../middleware.js');
    const u = (p) => new URL(`https://www.accesdirectaide.fr${p}`);
    expect(directFunctionResponse(u('/api/lib/geography/COGIngestion')).status).toBe(404);
    expect(directFunctionResponse(u('/api/routes')).status).toBe(404);
    expect(directFunctionResponse(u('/api/cron/ingest-aids'))).toBeNull();
    vi.stubEnv('ADA_PUBLIC_BETA_RESTRICTED', '1');
    for (const p of ['/api/cron/ingest-aids', '/api/cron/actualites', '/api/monitor/core']) {
      const r = directFunctionResponse(u(p));
      expect(r.status, p).toBe(503);
      expect(await r.json()).toMatchObject({ error: 'PUBLIC_BETA_RESTRICTED' });
    }
    for (const p of ['/api/aides', '/api/health', '/api/sitemap.xml']) expect(directFunctionResponse(u(p)), p).toBeNull();
    expect(config.matcher).toEqual(expect.arrayContaining(['/api/lib/:path*', '/api/cron/:path*', '/api/monitor/:path*']));
    vi.unstubAllEnvs(); vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
  });
});

describe('legal identity from build-time variables', () => {
  it('fills the publisher fields from VITE_LEGAL_* and the release gate passes only then', async () => {
    const names = ['VITE_LEGAL_PUBLISHER_IDENTITY', 'VITE_LEGAL_PUBLICATION_DIRECTOR', 'VITE_LEGAL_DATA_PROTECTION_CONTACT', 'VITE_LEGAL_SECURITY_CONTACT', 'VITE_LEGAL_RIGHTS_HOLDER'];
    vi.resetModules();
    const before = await import('../../src/config/legal-documents.js');
    expect(JSON.stringify(before.LEGAL_PLACEHOLDERS)).toContain('[À COMPLÉTER');
    for (const n of names) vi.stubEnv(n, `valeur de test ${n}`);
    vi.resetModules();
    const after = await import('../../src/config/legal-documents.js');
    expect(JSON.stringify(after.LEGAL_PLACEHOLDERS)).not.toContain('[À COMPLÉTER');
    expect(after.LEGAL_PLACEHOLDERS.publisherIdentity).toBe('valeur de test VITE_LEGAL_PUBLISHER_IDENTITY');
    vi.unstubAllEnvs(); vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
  });
});

describe('browser side', () => {
  it('closes the account, booking, upload and form screens, keeps the public ones', () => {
    for (const p of ['/login', '/auth/signup', '/compte/coffre', '/pro', '/pro/login', '/admin/dashboard', '/rdv/x/booking', '/contact', '/institution', '/share/abc', '/diagnostic', '/assistant'])
      expect(isBetaRestrictedPath(p), p).toBe(true);
    for (const p of ['/', '/aides', '/aides/aide-x', '/demarches', '/annuaire', '/structures/x', '/dispositifs', '/mentions-legales', '/confidentialite', '/glossaire', '/proposition'])
      expect(isBetaRestrictedPath(p), p).toBe(false);
  });
  it('shows the French beta notice and the unavailable page', () => {
    render(createElement(MemoryRouter, null, createElement(PublicBetaBanner), createElement(PublicBetaUnavailable)));
    expect(screen.getByTestId('public-beta-banner').textContent).toContain('Bêta publique');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Cette fonction n’est pas encore ouverte');
    expect(screen.getByRole('link', { name: 'Rechercher une aide' }).getAttribute('href')).toBe('/aides');
    expect(screen.queryByTestId('public-beta-contact')).toBeNull();   // not on a screen other than the contact form
  });
  it('a closed screen is not offered as a link (home tiles, footer); outside the beta every link stays', () => {
    const links = [{ to: '/aides' }, { to: '/orientation' }, { to: '/diagnostic' }, { to: '/contact?sujet=signalement_erreur' }, { to: '/structures' }];
    expect(openLinks(links, true, (l) => l.to).map((l) => l.to)).toEqual(['/aides', '/structures']);
    expect(openLinks(links, false, (l) => l.to)).toHaveLength(5);
    expect(isBetaRestrictedPath('/contact?sujet=partenariat')).toBe(true);
  });
  it('the closed contact form gives the published contact address instead of a dead end', async () => {
    vi.stubEnv('VITE_LEGAL_DATA_PROTECTION_CONTACT', 'Association test — contact@exemple.test');
    vi.resetModules();
    const { PublicBetaUnavailable: Unavailable } = await import('../../src/components/beta/PublicBeta.jsx');
    render(createElement(MemoryRouter, { initialEntries: ['/contact?sujet=signalement_erreur'] }, createElement(Unavailable)));
    const link = screen.getByRole('link', { name: 'contact@exemple.test' });
    expect(link.getAttribute('href')).toBe('mailto:contact@exemple.test');
    vi.unstubAllEnvs(); vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
  });
});

describe('search engines (audit of 31/10/2026)', () => {
  it('the sitemap offers the canonical list of places and no screen closed in the beta', async () => {
    vi.stubEnv('ADA_PUBLIC_BETA_RESTRICTED', '1');
    const { buildSitemapXml } = await import('../../api/_handlers/sitemap.js');
    const xml = buildSitemapXml('https://www.accesdirectaide.fr', [{ slug: 'apl', updatedAt: new Date('2026-10-30') }], [], [{ slug: 'mairie-x', updatedAt: new Date('2026-10-30') }]);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace('https://www.accesdirectaide.fr', ''));
    expect(locs).toEqual(expect.arrayContaining(['/', '/aides', '/demarches', '/structures', '/dispositifs', '/aides/apl', '/structures/mairie-x']));
    for (const closed of ['/orientation', '/contact', '/annuaire']) expect(locs, closed).not.toContain(closed);
    vi.stubEnv('ADA_PUBLIC_BETA_RESTRICTED', '0');
    expect(buildSitemapXml('https://x.test', [], [], [])).toContain('<loc>https://x.test/contact</loc>');   // outside the beta the form is a public page
    vi.unstubAllEnvs(); vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
  });
  it('the public read data may be crawled to render the pages but is never indexed; the record pages, the sitemap and robots are', async () => {
    const { isTechnicalNoIndexPath } = await import('../../api/_utils/robots.js');
    for (const p of ['aides', 'aides/apl', 'structures', 'taxonomy', 'auth/me', 'health']) expect(isTechnicalNoIndexPath(p), p).toBe(true);
    for (const p of ['public/page', 'sitemap.xml', 'robots.txt']) expect(isTechnicalNoIndexPath(p), p).toBe(false);
    const { readFileSync } = await import('node:fs');
    const robots = readFileSync('public/robots.txt', 'utf8');
    for (const r of ['Disallow: /api/', 'Allow: /api/aides', 'Allow: /api/demarches', 'Allow: /api/structures', 'Sitemap: https://www.accesdirectaide.fr/sitemap.xml']) expect(robots).toContain(r);
    expect(robots).not.toMatch(/Allow: \/api\/(auth|admin|cron|search|assistant)/);
  });
  it('one canonical list of places: /annuaire answers 308 to /structures (the app route), never the reverse', async () => {
    const { readFileSync } = await import('node:fs');
    const redirects = JSON.parse(readFileSync('vercel.json', 'utf8')).redirects;
    expect(redirects).toContainEqual({ source: '/annuaire', destination: '/structures', permanent: true });
    expect(redirects.find((r) => r.source === '/structures')).toBeUndefined();
  });
  it('the readable summary of a record page says where the information comes from and when it was checked', async () => {
    const { renderPage } = await import('../../api/_services/page-head.js');
    const html = renderPage('<html><head><title>x</title></head><body><div id="root"></div></body></html>', { status: 200, title: 'APL — AccesDirectAide', description: 'd', canonical: 'https://www.accesdirectaide.fr/aides/apl', robots: 'index, follow',
      summary: { label: 'Aide', name: 'APL', text: 'Aide au loyer.', source: new URL('https://www.service-public.gouv.fr/particuliers/vosdroits/F12006'), verifiedAt: new Date('2026-10-30T10:00:00Z') } });
    expect(html).toContain('Source officielle : <a href="https://www.service-public.gouv.fr/particuliers/vosdroits/F12006" rel="noopener">service-public.gouv.fr</a>.');
    expect(html).toContain('Vérifiée le 30 octobre 2026.');
  });
  it('the shell promises nothing the beta does not offer and reads without JavaScript', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8'); const manifest = readFileSync('public/manifest.json', 'utf8');
    for (const t of [html, manifest]) { expect(t).not.toMatch(/rendez-vous/i); expect(t).not.toMatch(/lumière sur vos démarches/i); }
    expect(html).toMatch(/<noscript>[\s\S]*href="\/sitemap\.xml"[\s\S]*<\/noscript>/);
    expect(html.match(/<noscript>[\s\S]*<\/noscript>/)[0]).not.toMatch(/style=|<h1/);   // no inline style (CSP), no second h1 on a record page
  });
});
