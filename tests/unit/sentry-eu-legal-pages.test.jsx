// @vitest-environment jsdom
/**
 * R5-S1 — the privacy, cookies and legal-notice pages and the beta notice say « Sentry active » exactly when this build sends errors
 * (errorTrackingActive(): EU DSN + production build + Vercel Production), and « not activated » otherwise. French is the reference text.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const LOAD = {
  'pages/Confidentialite.jsx': () => import('../../src/pages/Confidentialite.jsx'),
  'pages/Cookies.jsx': () => import('../../src/pages/Cookies.jsx'),
  'pages/MentionsLegales.jsx': () => import('../../src/pages/MentionsLegales.jsx'),
  'components/beta/BetaProcessingNotice.jsx': () => import('../../src/components/beta/BetaProcessingNotice.jsx'),
};
const EU_DSN = 'https://abc123@o4510000000000000.ingest.de.sentry.io/4510000000000001';

async function show(file, { active, beta = true, open = '' }) {
  vi.resetModules();
  vi.stubEnv('KV_REST_API_URL', 'http://localhost');
  vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
  vi.stubEnv('VITE_PUBLIC_BETA', beta ? 'true' : '');
  vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', open);
  vi.stubEnv('VITE_SENTRY_DSN', active ? EU_DSN : '');
  vi.stubEnv('VITE_DEPLOY_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', active ? 'production' : 'preview');
  const mod = await LOAD[file]();
  return render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(mod.default))));
}

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('privacy page', () => {
  it('active: Sentry named as active, EU storage, transfers, what is sent / removed, no replay, 30 days, rights; the beta paragraph no longer says « not activated »', async () => {
    const { container } = await show('pages/Confidentialite.jsx', { active: true });
    const p = screen.getByTestId('sentry-active');
    for (const s of ['Sentry, actif', 'Functional Software, Inc.', "stockées dans l'Union européenne (Francfort, Allemagne", 'clauses contractuelles types',
      'Data Privacy Framework', 'la description de l\'erreur', 'chemin de la page sans ses paramètres', 'votre adresse IP', 'formulaires',
      'Session Replay) est désactivé par défaut et n\'est pas utilisé', '30 jours', 'vous opposer', 'CNIL']) expect(p).toHaveTextContent(s);
    expect(screen.queryByTestId('sentry-off')).toBeNull();
    expect(screen.getByTestId('beta-processors')).toHaveTextContent("le suivi des erreurs (Sentry, données stockées dans l'Union européenne) est actif");
    expect(container.textContent).not.toContain("la mesure d'audience et Sentry ne sont pas activés");
    expect(container.textContent).not.toContain('10 % des visites');
  });
  it('not active: « not activated », and the former beta sentence', async () => {
    const { container } = await show('pages/Confidentialite.jsx', { active: false });
    expect(screen.getByTestId('sentry-off')).toHaveTextContent("il n'est pas activé");
    expect(screen.queryByTestId('sentry-active')).toBeNull();
    expect(container.textContent).toContain("la mesure d'audience et Sentry ne sont pas activés");
    expect(container.textContent).not.toContain('10 % des visites');
  });
  it('accounts open + active: the accounts variant follows too', async () => {
    await show('pages/Confidentialite.jsx', { active: true, open: 'accounts' });
    expect(screen.getByTestId('beta-processors-accounts')).toHaveTextContent('Les autres prestataires sont');
    expect(screen.getByTestId('beta-processors-accounts')).not.toHaveTextContent('Sentry ne sont pas activés');
  });
});

describe('cookies page', () => {
  it('active: the error tracking is said active, no cookie, link to the privacy policy', async () => {
    await show('pages/Cookies.jsx', { active: true });
    const p = screen.getByTestId('sentry-active');
    expect(p).toHaveTextContent('Le suivi des erreurs est actif');
    expect(p).toHaveTextContent('ne dépose aucun cookie');
    expect(p.querySelector('a')).toHaveAttribute('href', '/politique-confidentialite');
  });
  it('not active', async () => {
    await show('pages/Cookies.jsx', { active: false });
    expect(screen.getByTestId('sentry-off')).toHaveTextContent("Le suivi des erreurs (Sentry) n'est pas activé");
  });
});

describe('legal notice', () => {
  it('beta, active: the contracting entity, address and EU storage', async () => {
    await show('pages/MentionsLegales.jsx', { active: true });
    expect(screen.getByTestId('host-errors-active')).toHaveTextContent('Functional Software, Inc. (Sentry), San Francisco, États-Unis');
    expect(screen.getByTestId('host-errors-active')).toHaveTextContent("stockées dans l'Union européenne (Francfort, Allemagne)");
  });
  it('beta, not active: the former sentence', async () => {
    await show('pages/MentionsLegales.jsx', { active: false });
    expect(screen.getByTestId('host-errors-off')).toHaveTextContent("Sentry n'est pas activé pendant la bêta publique.");
  });
});

describe('beta notice', () => {
  it('active: error tracking listed as open, no longer in the « not open » sentence', async () => {
    await show('components/beta/BetaProcessingNotice.jsx', { active: true, open: 'admin,accounts,pro,appointments,video,assistant,social_referrals,diagnostic' });
    const box = screen.getByTestId('beta-processing-notice');
    expect(screen.getByTestId('beta-errors-on')).toHaveTextContent('Le suivi des erreurs techniques (Sentry, données stockées dans l’Union européenne) est actif');
    expect(box).toHaveTextContent('Ne sont pas ouverts : dossiers, messages, documents et mesure d’audience.');
    expect(box).not.toHaveTextContent('suivi des erreurs (Sentry). Les passages');
  });
  it('not active: unchanged', async () => {
    await show('components/beta/BetaProcessingNotice.jsx', { active: false });
    expect(screen.queryByTestId('beta-errors-on')).toBeNull();
    expect(screen.getByTestId('beta-processing-notice')).toHaveTextContent('mesure d’audience et suivi des erreurs (Sentry).');
  });
});
