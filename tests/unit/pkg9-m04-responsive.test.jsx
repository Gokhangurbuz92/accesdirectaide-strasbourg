// @vitest-environment jsdom
/**
 * PKG-9 / M04 — defects found by the 390 px sweep of the seven surfaces (dev probe, 2026-10-22): the pro space had NO navigation below md; pro / admin header
 * icon buttons had no accessible name and 32 px targets; the shared table scroll box was not keyboard-reachable; screen-reader texts escaped a scroll box and
 * widened /compte/profil by 21 px; the toast area sat 16 px off-screen. jsdom has no layout: widths are proven in real Chrome (DTA-B49). No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import fs from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProLayout from '../../src/pages/pro/ProLayout.jsx';
import { Table, TableBody, TableRow, TableCell } from '../../src/components/ui/table.jsx';

vi.mock('@/components/NotificationCenter', () => ({ default: () => null }));
vi.mock('@/components/OnboardingTour', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  globalThis.localStorage.setItem('pro_token', 't'); globalThis.localStorage.setItem('ada_onboarding_done', '1');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ user: { id: 'u', email: 'a@example.test', role: 'STRUCTURE_ADMIN' } }) })));
});
const pro = (path) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] },
  createElement(Routes, null, createElement(Route, { path: '/pro', element: createElement(ProLayout) },
    createElement(Route, { path: 'dashboard', element: createElement('p', null, 'Tableau') }), createElement(Route, { path: 'dossiers', element: createElement('p', null, 'Dossiers page') }))))));

describe('PKG-9 / M04 pro space on a phone', () => {
  it('a labelled menu button opens the same navigation as the sidebar, marks the current page and closes after navigating; axe clean', async () => {
    const { container } = pro('/pro/dashboard');
    const btn = await screen.findByTestId('pro-mobile-menu');
    expect(btn).toHaveAccessibleName('Ouvrir le menu'); expect(btn).toHaveAttribute('aria-expanded', 'false'); expect(btn).toHaveAttribute('aria-controls', 'pro-mobile-nav');
    expect(screen.queryByTestId('pro-mobile-nav')).toBeNull();
    fireEvent.click(btn);
    const nav = screen.getByTestId('pro-mobile-nav');
    expect(btn).toHaveAttribute('aria-expanded', 'true'); expect(btn).toHaveAccessibleName('Fermer le menu');
    for (const l of ['Tableau de bord', 'Dossiers suivis', 'Agenda RDV', 'Messages', 'Mon équipe', 'Ma structure', 'Paramètres']) expect(nav).toHaveTextContent(l);
    expect(nav.querySelector('a[aria-current="page"]')).toHaveTextContent('Tableau de bord');
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
    fireEvent.click(nav.querySelector('a[href="/pro/dossiers"]'));
    await waitFor(() => expect(screen.getByText('Dossiers page')).toBeInTheDocument());
    expect(screen.queryByTestId('pro-mobile-nav')).toBeNull();
  });
  it('the logout icon button has a name', async () => {
    pro('/pro/dashboard'); await screen.findByTestId('pro-mobile-menu');
    expect(screen.getAllByRole('button', { name: 'Se déconnecter' }).length).toBeGreaterThan(0);
  });
});

describe('PKG-9 / M04 shared pieces', () => {
  it('a table scroll box is a named region reachable with the keyboard', () => {
    render(createElement(Table, null, createElement(TableBody, null, createElement(TableRow, null, createElement(TableCell, null, 'x')))));
    const region = screen.getByRole('region', { name: 'Tableau défilant' }); expect(region).toHaveAttribute('tabindex', '0');
  });
  it('admin header buttons are named 44 px targets; toasts are anchored on phones; profile scroll box contains its hidden texts', () => {
    const admin = fs.readFileSync('src/pages/admin/AdminLayout.jsx', 'utf8');
    expect(admin).toMatch(/aria-label="Ouvrir le menu d'administration"/); expect(admin).toMatch(/aria-label="Se déconnecter"/); expect(admin).not.toMatch(/className="p-1 rounded hover:bg-slate-100/);
    // the EMPTY toast area covered the phone header and swallowed taps on the menu button (DTA-B49 dev run): it ignores the pointer, the toasts keep it
    expect(fs.readFileSync('src/components/ui/toast.jsx', 'utf8')).toMatch(/pointer-events-none fixed left-0 top-0 .* sm:left-auto/);
    expect(fs.readFileSync('src/components/ui/toast.jsx', 'utf8')).toMatch(/"group pointer-events-auto relative/);
    expect(fs.readFileSync('src/pages/CompteProfil.jsx', 'utf8')).toMatch(/<div className="relative overflow-x-auto">\s*<table className="w-full text-sm" data-testid="prefs-table">/);
  });
  it('SecureChat no longer offers the fake « IA Gemini » analysis of the citizen\'s messages, nor calls the unrouted pro/ai/assist', () => {
    const src = fs.readFileSync('src/components/Messaging/SecureChat.jsx', 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(src).not.toMatch(/api\/pro\/ai\/assist|Gemini|Résumé psychologique|aiConsent|Autoriser l'analyse/);
  });
  it('the audit filter select and the notification checkboxes are named / 24 px targets', () => {
    expect(fs.readFileSync('src/pages/pro/AuditLog.jsx', 'utf8')).toMatch(/aria-label="Filtrer le journal par action"/);
    expect((fs.readFileSync('src/pages/CompteProfil.jsx', 'utf8').match(/type="checkbox" className="h-6 w-6 shrink-0"/g) || []).length).toBe(2);
  });
});
