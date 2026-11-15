// @vitest-environment jsdom
/**
 * A-16 — a person locked out of the account's mailbox can reach assisted recovery: the sign-in page and the forgot-password page link to
 * /demande-aide?cat=ACCOUNT, and that form opens on « Mon compte » with how the recovery works. In the interface language (checked in Arabic).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../../src/i18n/index.js';
import AuthForgotPassword from '../../src/pages/AuthForgotPassword.jsx';
import AuthRdvAccess from '../../src/pages/AuthRdvAccess.jsx';
import DemandeAide from '../../src/pages/DemandeAide.jsx';

const show = (element, path) => render(createElement(HelmetProvider, null, createElement(QueryClientProvider, { client: new QueryClient() },
  createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: '*', element }))))));
beforeEach(async () => { globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })); await setLanguage('fr', { persist: false }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('A-16 link to assisted recovery', () => {
  it('forgot-password page: « I no longer have access to my e-mail » leads to the help form on the account category', () => {
    show(createElement(AuthForgotPassword), '/auth/forgot');
    const link = screen.getByRole('link', { name: 'Je n’ai plus accès à mon adresse e-mail' });
    expect(link).toHaveAttribute('href', '/demande-aide?cat=ACCOUNT');
  });

  it('sign-in page: the same link next to « forgot password »; not shown on the sign-up form', () => {
    show(createElement(AuthRdvAccess, { mode: 'login' }), '/auth/login');
    expect(screen.getByTestId('login-lost-email')).toHaveAttribute('href', '/demande-aide?cat=ACCOUNT');
    cleanup();
    show(createElement(AuthRdvAccess, { mode: 'signup' }), '/auth/signup');
    expect(screen.queryByTestId('login-lost-email')).toBeNull();
  });

  it('the help form opens on « Mon compte » and explains the recovery; without the parameter nothing is preselected', () => {
    show(createElement(DemandeAide), '/demande-aide?cat=ACCOUNT');
    expect(screen.getByLabelText('C’est à propos de')).toHaveValue('ACCOUNT');
    expect(screen.getByTestId('support-recovery-help').textContent).toMatch(/Une personne de l’équipe vérifiera avec vous.*jamais votre mot de passe/);
    cleanup();
    show(createElement(DemandeAide), '/demande-aide');
    expect(screen.getByLabelText('C’est à propos de')).toHaveValue('');
    expect(screen.queryByTestId('support-recovery-help')).toBeNull();
    cleanup();
    show(createElement(DemandeAide), '/demande-aide?cat=NOPE');
    expect(screen.getByLabelText('C’est à propos de')).toHaveValue('');
  });

  it('in Arabic the link and the explanation are translated (no French left in them)', async () => {
    await setLanguage('ar', { persist: false });
    show(createElement(AuthForgotPassword), '/auth/forgot');
    expect(screen.getByTestId('forgot-lost-email').textContent).toBe('لم أعد أستطيع الوصول إلى بريدي الإلكتروني');
    cleanup();
    show(createElement(DemandeAide), '/demande-aide?cat=ACCOUNT');
    expect(screen.getByTestId('support-recovery-help').textContent).not.toMatch(/Vous n’avez plus|mot de passe/);
  });
});
