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
import { isBetaRestrictedPath } from '../../src/lib/publicBeta.js';
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
  });
});
