// @vitest-environment jsdom
/**
 * R3H — live audit 24/11/2026: /cgu, /cookies, /securite-et-rgpd and /politique-confidentialite said « Ne sont pas ouverts : dossiers, messages, documents,
 * rendez-vous, assistant… » while the Production build opens appointments and the citizen assistant
 * (VITE_PUBLIC_BETA_OPEN_SURFACES=admin,accounts,pro,appointments,video,assistant,social_referrals,diagnostic). The notice now follows the build.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
vi.stubEnv('VITE_PUBLIC_BETA', 'true');
const { default: BetaProcessingNotice } = await import('../../src/components/beta/BetaProcessingNotice.jsx');
afterEach(() => cleanup());
const show = () => render(createElement(MemoryRouter, null, createElement(BetaProcessingNotice)));

describe('R3H the beta notice lists only what is really closed', () => {
  it('Production 24/11 build: appointments and assistant are said open, never listed as closed', () => {
    vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'admin,accounts,pro,appointments,video,assistant,social_referrals,diagnostic');
    show();
    const box = screen.getByTestId('beta-processing-notice');
    expect(box).toHaveTextContent('Ne sont pas ouverts : dossiers, messages, documents, mesure d’audience et suivi des erreurs (Sentry).');
    expect(box).not.toHaveTextContent(/rendez-vous, assistant/);
    expect(screen.getByTestId('beta-rdv-open')).toHaveTextContent('Les demandes de rendez-vous sont ouvertes');
    expect(screen.getByTestId('beta-assistant-open')).toHaveTextContent('aucune conversation n’est enregistrée');
    expect(screen.getByTestId('beta-rdv-open').querySelector('a')).toHaveAttribute('href', '/confidentialite/notice');
  });
  it('accounts only: the former sentence, nothing said open', () => {
    vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'accounts');
    show();
    expect(screen.getByTestId('beta-processing-notice')).toHaveTextContent('Ne sont pas ouverts : dossiers, messages, documents, rendez-vous, assistant,');
    expect(screen.queryByTestId('beta-rdv-open')).toBeNull();
    expect(screen.queryByTestId('beta-assistant-open')).toBeNull();
  });
  it('accounts and assistant: appointments still listed closed', () => {
    vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'accounts,assistant');
    show();
    expect(screen.getByTestId('beta-processing-notice')).toHaveTextContent('Ne sont pas ouverts : dossiers, messages, documents, rendez-vous, mesure');
    expect(screen.getByTestId('beta-assistant-open')).toBeInTheDocument();
  });
});
