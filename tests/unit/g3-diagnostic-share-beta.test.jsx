// @vitest-environment jsdom
/**
 * G3 (19/11/2026) — the diagnostic result's « Partager le dossier » button POSTs /api/share/create, which the server keeps closed with the documents
 * surface (api/_utils/public-beta.js: 'share' ∈ documents). It was shown whenever the diagnostic was open, so in a beta that opens the diagnostic but not
 * the documents it could only fail. It is now offered only when the documents surface is open (outside the beta, or the build opens `documents`).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAssessment } from '../../api/lib/assessmentContract.js';
import { UNSUPPORTED_RIGHTS } from '../../api/lib/diagnosticAssessment.js';
import { shareOpened } from '../../src/lib/publicBeta.js';

const env = vi.hoisted(() => ({ frontendEnv: null }));
vi.mock('../../src/config/env.js', async (importOriginal) => { const real = await importOriginal(); env.frontendEnv = { ...real.frontendEnv, flags: { ...real.frontendEnv.flags, publicBeta: false } }; return { ...real, frontendEnv: env.frontendEnv }; });
const { default: DiagnosticOutcome } = await import('../../src/components/diagnostic/DiagnosticOutcome.jsx');

afterEach(() => { cleanup(); vi.unstubAllEnvs(); env.frontendEnv.flags.publicBeta = false; });
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
  it('is shown when the build opens the documents surface', () => {
    env.frontendEnv.flags.publicBeta = true;
    vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'diagnostic,documents');
    show();
    expect(shareButton()).toBeInTheDocument();
  });
  it('is shown outside the beta', () => {
    show();
    expect(shareButton()).toBeInTheDocument();
  });
});
