// @vitest-environment jsdom
/**
 * R3H — live audit 24/11/2026: with appointments open in the Production build, /politique-confidentialite still titled « 4. Les rendez-vous (pas encore
 * ouverts) » and /securite-et-rgpd said the structure sees the person's name and telephone — the notice in force (notice-confidentialite v13, section 9)
 * says the structure receives neither name, nor e-mail, nor telephone. Both pages now point to the notice while appointments are open.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules(); });
const page = async (file, surfaces) => {
  vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
  vi.stubEnv('VITE_PUBLIC_BETA', 'true'); vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', surfaces);
  vi.stubEnv('VITE_LEGAL_DATA_PROTECTION_CONTACT', 'contact@accesdirectaide.fr');
  const mod = await import(/* @vite-ignore */ `../../src/pages/${file}`);
  return render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(mod.default))));
};
const PROD = 'admin,accounts,pro,appointments,video,assistant,social_referrals,diagnostic';

describe('R3H legacy privacy pages and open appointments', () => {
  it('/politique-confidentialite: no « pas encore ouverts » section, a pointer to the notice', async () => {
    const { container } = await page('Confidentialite.jsx', PROD);
    expect(container).not.toHaveTextContent('4. Les rendez-vous (pas encore ouverts)');
    expect(container).not.toHaveTextContent('La prise de rendez-vous n\'est pas encore ouverte');
    expect(screen.getByTestId('privacy-appointments-open')).toHaveTextContent('qui fait foi');
    expect(screen.getByTestId('privacy-appointments-open').querySelector('a')).toHaveAttribute('href', '/confidentialite/notice');
  });
  it('/securite-et-rgpd: the structure is not said to see the name and telephone', async () => {
    const { container } = await page('Security.jsx', PROD);
    expect(container).not.toHaveTextContent('nom (chiffré) et téléphone (non chiffré)');
    expect(screen.getByTestId('security-bookings-open')).toHaveTextContent('ni votre nom, ni votre adresse électronique, ni votre téléphone');
  });
  it('appointments closed: the former texts', async () => {
    const { container } = await page('Confidentialite.jsx', 'accounts');
    expect(container).toHaveTextContent('4. Les rendez-vous (pas encore ouverts)');
  });
});
