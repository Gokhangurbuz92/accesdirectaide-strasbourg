// @vitest-environment jsdom
/**
 * G3 (19/11/2026) — the diagnostic result's « Partager le dossier » button POSTs /api/share/create, which the server keeps closed with the documents
 * surface (api/_utils/public-beta.js: 'share' ∈ documents). It was shown whenever the diagnostic was open, so in a beta that opens the diagnostic but not
 * the documents it could only fail. It is now offered only when the documents surface is open (outside the beta, or the build opens `documents`).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAssessment } from '../../api/lib/assessmentContract.js';
import { UNSUPPORTED_RIGHTS } from '../../api/lib/diagnosticAssessment.js';
import { shareOpened } from '../../src/lib/publicBeta.js';

const env = vi.hoisted(() => ({ frontendEnv: null }));
vi.mock('../../src/config/env.js', async (importOriginal) => { const real = await importOriginal(); env.frontendEnv = { ...real.frontendEnv, flags: { ...real.frontendEnv.flags, publicBeta: false } }; return { ...real, frontendEnv: env.frontendEnv }; });
const { default: DiagnosticOutcome } = await import('../../src/components/diagnostic/DiagnosticOutcome.jsx');

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); env.frontendEnv.flags.publicBeta = false; });
// G14-R4: the server says whether it serves the sharing (GET /api/status features.diagnosticShare)
const serverSays = (diagnosticShare) => { const f = vi.fn(async (url) => (url === '/api/status' ? { ok: true, json: async () => ({ features: { sharedDossiers: diagnosticShare, diagnosticShare } }) } : { ok: false, json: async () => ({}) })); vi.stubGlobal('fetch', f); return f; };
const ANSWERS = { birthDate: '1992-03-10', householdSize: 1, territory: '67000', income: {}, housing: { status: 'tenant', rent: 480 } };
const results = { assessment: buildAssessment({ answers: ANSWERS, unsupportedRights: UNSUPPORTED_RIGHTS }), period: '2026-09', meta: { requestId: 'r', duration_ms: 1 } };
const show = () => render(h(MemoryRouter, null, h(DiagnosticOutcome, { results, situation: {}, structureLoader: async () => [] })));
const shareButton = () => screen.queryByRole('button', { name: /Partager le dossier/ });

describe('shareOpened', () => {
  it('outside the beta: open; in the beta: only when the build opens documents', () => {
    expect(shareOpened(false, [])).toBe(true);
    expect(shareOpened(true, [])).toBe(false);
    expect(shareOpened(true, ['diagnostic', 'accounts', 'admin'])).toBe(false);
    expect(shareOpened(true, ['diagnostic', 'documents'])).toBe(true);
  });
});

describe('DiagnosticOutcome « Partager le dossier »', () => {
  it('is hidden in a beta build that opens the diagnostic but not the documents', () => {
    env.frontendEnv.flags.publicBeta = true;
    vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'diagnostic,accounts,admin');
    show();
    expect(shareButton()).toBeNull();
    expect(screen.getByRole('button', { name: /Télécharger PDF/ })).toBeInTheDocument();   // the PDF is local: it stays
  });
  it('is shown when the build opens the documents surface and the server serves the sharing', async () => {
    env.frontendEnv.flags.publicBeta = true;
    vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'diagnostic,documents');
    serverSays(true);
    show();
    await waitFor(() => expect(shareButton()).toBeInTheDocument());
    expect(screen.getByTestId('plan-step-share')).toBeInTheDocument();
  });
  it('G14-R4: documents open in the build but the capability closed on the server (503) — no button, no « Partager » step', async () => {
    env.frontendEnv.flags.publicBeta = true;
    vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'diagnostic,documents');
    const f = serverSays(false);
    show();
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/status', expect.anything()));
    await new Promise((r) => setTimeout(r, 10));
    expect(shareButton()).toBeNull();
    expect(screen.queryByTestId('plan-step-share')).toBeNull();
    expect(screen.getByRole('button', { name: /Télécharger PDF/ })).toBeInTheDocument();
  });
  it('G14-R4: an unreachable status (network error, old server) offers nothing (fail closed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    show();
    await new Promise((r) => setTimeout(r, 10));
    expect(shareButton()).toBeNull();
  });
  it('is shown outside the beta when the server serves it', async () => {
    serverSays(true);
    show();
    await waitFor(() => expect(shareButton()).toBeInTheDocument());
  });
});
