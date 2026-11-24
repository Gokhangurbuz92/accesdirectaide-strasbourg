// @vitest-environment jsdom
/**
 * R3 — live audit 24/11/2026 (R3H § 3): the legacy /cgu text (0.3, « version projet ») stood beside the citizen terms in force at /cgu/citoyen and
 * contradicted them. When a version of cgu-citoyen is in force in the build, /cgu goes to /cgu/citoyen (client route, replace); otherwise (a build
 * where none is approved) the legacy page stays, so /cgu never lands on « Document en préparation ». /cgu is not in the sitemap.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules(); });
const R2 = 'cgu-citoyen@v12-2026-11-23,notice-confidentialite@v13-2026-11-23,cgu-professionnel@v10-2026-11-23,conditions-structures@v9-2026-11-23';
const renderAt = async (approved) => {
  vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
  vi.stubEnv('VITE_PUBLIC_BETA', 'true'); vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'admin,accounts,pro,appointments');
  vi.stubEnv('VERCEL_ENV', 'production');
  if (approved) vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', approved);
  const { default: CGU } = await import('../../src/pages/CGU.jsx');
  return render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/cgu'] },
    createElement(Routes, null, createElement(Route, { path: '/cgu', element: createElement(CGU) }),
      createElement(Route, { path: '/cgu/citoyen', element: createElement('p', { 'data-testid': 'cgu-citoyen' }, 'citoyen') })))));
};

describe('R3 legacy /cgu', () => {
  it('cgu-citoyen in force (release 2 / 3 values): /cgu goes to /cgu/citoyen', async () => {
    await renderAt(R2);
    expect(screen.getByTestId('cgu-citoyen')).toBeInTheDocument();
  });
  it('no version approved in the build: the legacy page stays (never « Document en préparation »)', async () => {
    const { container } = await renderAt('');
    expect(screen.queryByTestId('cgu-citoyen')).toBeNull();
    expect(container).toHaveTextContent('Conditions générales');
  });
  it('/cgu is not in the sitemap; /conditions-generales still goes through /cgu', () => {
    expect(readFileSync('api/_handlers/sitemap.js', 'utf8')).not.toMatch(/'\/cgu'/);
    expect(readFileSync('src/pages/index.jsx', 'utf8')).toMatch(/path="\/conditions-generales" element=\{<Navigate to="\/cgu" replace \/>\}/);
  });
});
