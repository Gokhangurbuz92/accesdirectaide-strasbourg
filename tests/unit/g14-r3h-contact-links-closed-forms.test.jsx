// @vitest-environment jsdom
/**
 * R3H — live audit 24/11/2026 (Production build, surface « communications » closed): /cgu, /glossaire, /mentions-legales, /securite-et-rgpd, /pro/login,
 * /notre-methode, /sourcesmethode, the sign-in help (« Je n'ai plus accès à mon adresse e-mail ») and the error page linked to /contact or /demande-aide,
 * which answer « Cette fonction n'est pas encore ouverte ». While the forms are closed those links write to the published address; no text promises a form.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PRODUCTION_SURFACES = 'admin,accounts,pro,appointments,video,assistant,social_referrals,diagnostic';
const stub = (surfaces) => {
  vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
  vi.stubEnv('VITE_PUBLIC_BETA', 'true'); vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', surfaces);
  vi.stubEnv('VITE_LEGAL_DATA_PROTECTION_CONTACT', 'contact@accesdirectaide.fr');
};
beforeEach(() => stub(PRODUCTION_SURFACES));
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules(); });

const page = async (file, path = '/') => {
  const mod = await import(/* @vite-ignore */ `../../src/pages/${file}`);
  return render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] }, createElement(mod.default))));
};
const hrefs = (c) => [...c.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
const toClosedForm = (h) => /^\/(contact|demande-aide)(\?|$)/.test(h);

describe('R3H ContactLink', () => {
  it('closed form: mailto to the published address, same label (or the closed label); open form: the form', async () => {
    const { default: ContactLink } = await import('../../src/components/ContactLink.jsx');
    const r = render(createElement(MemoryRouter, null, createElement(ContactLink, { to: '/demande-aide?cat=ACCOUNT' }, 'Je n’ai plus accès')));
    expect(r.container.querySelector('a')).toHaveAttribute('href', 'mailto:contact@accesdirectaide.fr');
    expect(r.container).toHaveTextContent('Je n’ai plus accès');
    cleanup(); vi.resetModules(); stub(`${PRODUCTION_SURFACES},communications`);
    const { default: Open } = await import('../../src/components/ContactLink.jsx');
    const o = render(createElement(MemoryRouter, null, createElement(Open, { to: '/contact?sujet=x' }, 'Écrire')));
    expect(o.container.querySelector('a')).toHaveAttribute('href', '/contact?sujet=x');
  });
});

describe('R3H pages with the Production build: no link to a closed form', () => {
  it.each([['Security.jsx', '/securite-et-rgpd'], ['Method.jsx', '/notre-methode'], ['MentionsLegales.jsx', '/mentions-legales'], ['CGU.jsx', '/cgu'],
    ['SourcesMethode.jsx', '/sourcesmethode'], ['ServiceError.jsx', '/inconnu']])('%s', async (file, path) => {
    const { container } = await page(file, path);
    expect(hrefs(container).filter(toClosedForm)).toEqual([]);
    expect(container).not.toHaveTextContent(/utilisez le formulaire de contact|signalez-la avec le formulaire de contact|via le bouton de Signalement/);
  });
  it('the method and security pages give the address instead', async () => {
    const m = await page('Method.jsx', '/notre-methode');
    expect(m.getByTestId('method-report-error')).toHaveAttribute('href', 'mailto:contact@accesdirectaide.fr');
    cleanup();
    const s = await page('Security.jsx', '/securite-et-rgpd');
    expect(s.container).toHaveTextContent('Pour cela, écrivez à contact@accesdirectaide.fr.');
  });
  it('the sign-in help, the pro sign-in, the glossary and the account settings use ContactLink, never a raw form link', () => {
    const raw = /<(?:Link|a)\s[^>]*(?:to|href)="\/(?:contact|demande-aide)[?"]/;
    for (const f of ['AuthForgotPassword.jsx', 'AuthRdvAccess.jsx', 'pro/Login.jsx', 'Glossaire.jsx', 'ServiceError.jsx']) {
      expect(readFileSync(`src/pages/${f}`, 'utf8'), f).not.toMatch(raw);
    }
    // the account settings keep the form link only in the branch taken when the form is open
    const settings = readFileSync('src/pages/CompteParametres.jsx', 'utf8');
    expect(settings).toMatch(/\{contactFormOpen\(\)\s*\n?\s*\? <>\{t\('compte:settings\.gdpr_before'[^\n]*<Link to="\/contact"/);
    expect(settings).toMatch(/: <>\{t\('compte:settings\.gdpr_before_email'[^\n]*<ContactLink /);
  });
});
