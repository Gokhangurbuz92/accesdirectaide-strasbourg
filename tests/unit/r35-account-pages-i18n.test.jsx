// @vitest-environment jsdom
/* global document */
/**
 * R35 (owner decision update §7): the account entry pages and the sources page follow the interface language; Arabic reads right to left.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { setLanguage } from '../../src/i18n/index.js';
import Login from '../../src/pages/Login.jsx';
import AuthForgotPassword from '../../src/pages/AuthForgotPassword.jsx';
import AuthResetPassword from '../../src/pages/AuthResetPassword.jsx';
import AuthVerifyEmail from '../../src/pages/AuthVerifyEmail.jsx';
import Sources from '../../src/pages/Sources.jsx';

const show = (C) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(C))));
afterEach(async () => { cleanup(); await setLanguage('fr'); });

describe('R35 account entry pages in six languages', () => {
  it('French stays the source text', async () => {
    await setLanguage('fr');
    show(Login);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Connexion');
  });
  it('German: no French heading or button left', async () => {
    await setLanguage('de');
    show(Login); expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Anmelden'); expect(screen.getByText('Konto erstellen')).toBeTruthy(); cleanup();
    show(AuthForgotPassword); expect(screen.getByText('Passwort vergessen')).toBeTruthy(); expect(screen.getByRole('button').textContent).toBe('Link senden'); cleanup();
    show(AuthResetPassword); expect(screen.getByLabelText('Neues Passwort')).toBeTruthy(); cleanup();
    show(AuthVerifyEmail); expect(screen.getByText('Bestätigung Ihrer E-Mail-Adresse')).toBeTruthy(); cleanup();
    show(Sources); expect(screen.getAllByText('Unsere Quellen').length).toBeGreaterThan(0);
  });
  it('Arabic: translated and the document reads right to left', async () => {
    await setLanguage('ar');
    show(Login);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('تسجيل الدخول');
    expect(document.documentElement.dir).toBe('rtl');
  });
});
