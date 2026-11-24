// @vitest-environment jsdom
/**
 * R3H — live audit 24/11/2026 of /diagnostic (Production build): the badge said « Simulation locale » and the meta description « Pré-orientez-vous
 * localement » while the privacy notice on the same page says the answers are sent to the server (POST /api/diagnostic, OpenFisca estimate); and the notice
 * described sharing the diagnostic with a structure although the build does not offer it (surface « documents » closed, no « Partager » button).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules(); });
const notice = async (surfaces) => {
  vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
  vi.stubEnv('VITE_PUBLIC_BETA', 'true'); vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', surfaces);
  const { default: PrivacyNotice, PRIVACY_TEXT } = await import('../../src/components/diagnostic/PrivacyNotice.jsx');
  render(createElement(MemoryRouter, null, createElement(PrivacyNotice)));
  return PRIVACY_TEXT;
};

describe('R3H /diagnostic says what really happens', () => {
  it('no « locale » claim on the page; the badge is the indicative estimate', () => {
    const page = readFileSync('src/pages/DiagnosticPage.jsx', 'utf8');
    expect(page).not.toMatch(/'Simulation locale|Pré-orientez-vous localement/);
    expect(page).toContain("t('diagnostic:page.badge_v2', 'Estimation indicative — non opposable, ce n’est pas une décision')");
    for (const l of ['en', 'de', 'tr', 'ar', 'uk']) {
      const d = JSON.parse(readFileSync(`src/i18n/locales/${l}/diagnostic.json`, 'utf8'));
      expect(d['page.badge'], l).toBeUndefined();
      expect(d['page.badge_v2'], l).toBeTruthy();
      expect(`${d['page.badge_v2']} ${d['page.meta_description_v2']}`, l).not.toMatch(/local|lokal|yerel|محلي|місцев|локальн/i);
    }
  });
  it('Production build (documents closed): no sentence about sharing with a structure', async () => {
    const T = await notice('admin,accounts,pro,appointments,video,assistant,social_referrals,diagnostic');
    expect(screen.queryByTestId('privacy-sharing-sentence')).toBeNull();
    const box = screen.getByTestId('privacy-notice');
    expect(box).not.toHaveTextContent(/partager votre diagnostic|Le partage avec une structure|Si vous partagez/);
    expect(box).toHaveTextContent(T.p1);
    expect(box).toHaveTextContent(T.p3);
  });
  it('sharing opened: the sentences come back', async () => {
    const T = await notice('accounts,documents');
    expect(screen.getByTestId('privacy-sharing-sentence')).toHaveTextContent(T.p2);
    expect(screen.getByTestId('privacy-notice')).toHaveTextContent(T.falc[3]);
  });
});
