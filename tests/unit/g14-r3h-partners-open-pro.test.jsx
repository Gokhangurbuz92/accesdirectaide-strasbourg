// @vitest-environment jsdom
/**
 * R3H — live audit 24/11/2026: /partenaires said « L’espace professionnel, les comptes de structure et la prise de rendez-vous ne sont pas encore ouverts »
 * while the Production build opens ADA Pro, the structure sign-up (/pro/register answers with its form) and appointments.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules(); });
const show = async (surfaces, selfRegistration) => {
  vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
  vi.stubEnv('VITE_PUBLIC_BETA', 'true'); vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', surfaces);
  vi.stubEnv('VITE_PUBLIC_BETA_PRO_SELF_REGISTRATION', selfRegistration);
  vi.stubEnv('VITE_LEGAL_DATA_PROTECTION_CONTACT', 'contact@accesdirectaide.fr');
  const { default: Partners } = await import('../../src/pages/Partners.jsx');
  render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(Partners))));
};

describe('R3H /partenaires follows the build', () => {
  it('Production 24/11 (pro + sign-up + appointments open): no « pas encore ouverts », a link to the sign-up', async () => {
    await show('admin,accounts,pro,appointments,video,assistant,social_referrals,diagnostic', 'open');
    const box = screen.getByTestId('partners-beta-now');
    expect(box).not.toHaveTextContent('ne sont pas encore ouverts');
    expect(box).toHaveTextContent('Votre structure peut demander l’ouverture de son Espace Pro');
    expect(box).toHaveTextContent('peut proposer des rendez-vous en ligne');
    expect(screen.getByTestId('partners-pro-register')).toHaveAttribute('href', '/pro/register');
    expect(globalThis.document.body).not.toHaveTextContent('Ce que l’espace partenaires permettra');
  });
  it('nothing open: the former text, no sign-up link', async () => {
    await show('', '');
    expect(screen.getByTestId('partners-beta-now')).toHaveTextContent('ne sont pas encore ouverts');
    expect(screen.queryByTestId('partners-pro-register')).toBeNull();
  });
});
