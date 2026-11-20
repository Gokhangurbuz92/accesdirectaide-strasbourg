// @vitest-environment jsdom
/**
 * G13 — admin Observabilité in the restricted public beta.
 *   - GET /api/health/deep passes the beta gate (exact path, GET / HEAD only), because its handler refuses an anonymous caller (401) BEFORE probing the
 *     database, the cache, the storage or the scheduled jobs.
 *   - The page reads the environment and the release from the deep check (/api/healthz returns neither); while the deep check is not read, the news
 *     freshness and the e-mail cards say « Non lu », never « no run » / « no e-mail is sent », and no text names the local LAB.
 * Synthetic data, no secret.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const probes = vi.hoisted(() => ({ db: vi.fn(), freshness: vi.fn(), kv: vi.fn(), admin: vi.fn(async () => false), cron: vi.fn(() => ({ ok: false })) }));
vi.mock('../../src/db/index.js', () => ({ db: { execute: probes.db, select: probes.db } }));
vi.mock('../../api/_utils/auth.js', () => ({ verifyAdmin: probes.admin }));
vi.mock('../../api/_utils/cronAuth.js', () => ({ getCronAuth: probes.cron }));
vi.mock('../../api/_utils/cron-freshness.js', () => ({ getActualitesCronFreshness: probes.freshness }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { set: probes.kv, get: probes.kv, del: probes.kv } }));

const api = vi.hoisted(() => ({ apiClient: { health: { check: vi.fn(), deep: vi.fn() }, admin: { getCronRuns: vi.fn() }, get: vi.fn() } }));
vi.mock('@/api/client', () => api);
vi.mock('@/components/SEO', () => ({ default: () => null }));

import { isAllowedInPublicBeta } from '../../api/_utils/public-beta.js';
import deepHandler from '../../api/_handlers/health-deep.js';
import AdminObservability from '../../src/pages/admin/Observability.jsx';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mockRes = () => {
  const headers = {}; const res = { statusCode: 200, body: undefined,
    setHeader(k, v) { headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return res;
};

describe('G13 — the deep check passes the beta gate, and only it', () => {
  const BETA = { ADA_PUBLIC_BETA_RESTRICTED: '1' };
  it('GET / HEAD on the exact path only', () => {
    expect(isAllowedInPublicBeta('GET', 'health/deep', BETA)).toBe(true);
    expect(isAllowedInPublicBeta('HEAD', 'health/deep', BETA)).toBe(true);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(isAllowedInPublicBeta(m, 'health/deep', BETA), m).toBe(false);
    for (const p of ['health/deeper', 'health/deep/x', 'health/diagnostic', 'health/deepx']) expect(isAllowedInPublicBeta('GET', p, BETA), p).toBe(false);
  });

  it('an anonymous caller gets 401 and no dependency is probed (database, cache, storage, scheduled jobs)', async () => {
    for (const method of ['GET', 'HEAD']) {
      const res = mockRes();
      await deepHandler({ method, headers: {}, query: {}, cookies: {} }, res);
      expect(res.statusCode, method).toBe(401);
      expect(res.body).toMatchObject({ error: 'Unauthorized' });
      expect(res.body.deps).toBeUndefined();
    }
    expect(probes.admin).toHaveBeenCalled();
    expect(probes.db).not.toHaveBeenCalled();
    expect(probes.kv).not.toHaveBeenCalled();
    expect(probes.freshness).not.toHaveBeenCalled();
  });

  it('a write method is refused before authentication (405)', async () => {
    const res = mockRes();
    await deepHandler({ method: 'POST', headers: {}, query: {}, cookies: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(probes.admin).not.toHaveBeenCalled();
    expect(probes.db).not.toHaveBeenCalled();
  });

  it('the authentication check stays ahead of every probe in the handler source', () => {
    const src = fs.readFileSync('api/_handlers/health-deep.js', 'utf8');
    const body = src.slice(src.indexOf('export default async function handler'));
    const refuse = body.indexOf("return res.status(401)");
    expect(refuse).toBeGreaterThan(0);
    for (const probe of ['checkDb()', 'checkKv(', 'checkStorage()', 'getActualitesCronFreshness()', 'checkTerritoryReference()', 'evaluateReleasePreflight(']) expect(body.indexOf(probe), probe).toBeGreaterThan(refuse);
  });
});

describe('G13 — Observabilité page', () => {
  const page = () => render(createElement(MemoryRouter, {}, createElement(AdminObservability)));
  const base = () => {
    api.apiClient.health.check.mockResolvedValue({ ok: true, status: 'ok', requestId: 'req-public' });
    api.apiClient.get.mockResolvedValue({ data: null });
  };

  it('deep check not read: « Non lu » on freshness and e-mail, « - » for environment and version, never a « LAB local » claim', async () => {
    base();
    api.apiClient.health.deep.mockRejectedValue({ status: 503 });
    api.apiClient.admin.getCronRuns.mockRejectedValue({ status: 503 });
    const { container } = page();
    await waitFor(() => expect(screen.getByTestId('obs-freshness-state')).toHaveTextContent('Non lu'));
    expect(screen.getByTestId('obs-mail-provider')).toHaveTextContent('Non lu');
    expect(screen.getByTestId('obs-mail-from')).toHaveTextContent('Non lu');
    expect(screen.getByTestId('obs-runs-empty')).toHaveTextContent('Non lu');
    expect(screen.getByTestId('obs-public-env')).toHaveTextContent('-');
    expect(screen.getByTestId('obs-public-release')).toHaveTextContent('-');
    expect(container.textContent).not.toMatch(/LAB|aucun e-mail n’est envoyé|NON\b/);
  });

  it('deep check read: environment / version from the deep check, real freshness and mailer state', async () => {
    base();
    api.apiClient.health.deep.mockResolvedValue({ ok: true, requestId: 'req-deep', deps: {
      db: { ok: true, durationMs: 3 }, kv: { ok: true, durationMs: 2 }, storage: { ok: 'skipped' },
      cron: { actualites: { state: 'missing', lastRunAt: null, lastSuccessAt: null } },
      mailer: { provider: 'mailjet', fromPresent: true }, sentry: { dsnPresent: true, environment: 'production', release: 'a3894f28deadbeef' } } });
    api.apiClient.admin.getCronRuns.mockResolvedValue({ items: [] });
    page();
    await waitFor(() => expect(screen.getByTestId('obs-public-env')).toHaveTextContent('production'));
    expect(screen.getByTestId('obs-public-release')).toHaveTextContent('a3894f28');
    expect(screen.getByTestId('obs-freshness-state')).toHaveTextContent('Aucune exécution enregistrée');
    expect(screen.getByTestId('obs-mail-provider')).toHaveTextContent('mailjet');
    expect(screen.getByTestId('obs-mail-from')).toHaveTextContent('OUI');
    expect(screen.getByTestId('obs-runs-empty')).toHaveTextContent('Aucune exécution enregistrée pour cette tâche.');
  });

  it('no locale names the local LAB in the observability texts', () => {
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      const d = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/admin.json`, 'utf8'));
      for (const [k, v] of Object.entries(d)) if (k.startsWith('observability.')) expect(String(v), `${lang} ${k}`).not.toMatch(/\bLAB\b/);
      expect(d['observability.not_read'], lang).toBeTruthy();
    }
    expect(fs.readFileSync('src/pages/admin/Observability.jsx', 'utf8')).not.toMatch(/'[^']*LAB local[^']*'/);
  });
});
