// @vitest-environment jsdom
/* global document, window, Blob */
/**
 * Pro / Structure privacy and operations fixes (RECON_PRO_STRUCTURE_TERRITORY 2026-11-15) — screens.
 *   A04  the dossier page shows and sets the CASE status; no label that reads as a decision
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import fs from 'node:fs';
import SharedDossier from '../../src/pages/pro/SharedDossier.jsx';

const h = React.createElement;
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, blob: async () => new Blob([JSON.stringify(body)]), headers: { get: () => null } });
const Ctx = () => h(Outlet, { context: { user: { id: 'u1' } } });
const page = () => render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: ['/pro/dossier/s1'] }, h(Routes, null, h(Route, { path: '/pro', element: h(Ctx) }, h(Route, { path: 'dossier/:shareId', element: h(SharedDossier) }))))));
const dossierAnswer = (followUp) => ({ dossier: { id: 's1', situation: {}, results: { _followUp: { status: 'Dossier validé' } } }, documents: [], access: { purposes: [] }, ...(followUp ? { followUp } : {}) });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe('A04 — the dossier page follow-up is the case status', () => {
  it('shows the case status, saves a case status code, links to the case, and never shows a legacy label that reads as a decision', async () => {
    window.localStorage.setItem('pro_token', 't');
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, o) => {
      if (o?.method === 'PATCH') { calls.push(JSON.parse(o.body)); return json(200, { ok: true, status: 'WAITING_CITIZEN', caseId: 'case-1' }); }
      return json(200, dossierAnswer({ available: true, caseId: 'case-1', status: 'WAITING_CITIZEN' }));
    }));
    page();
    const button = await screen.findByRole('button', { name: 'Mettre à jour' });
    expect(screen.getByRole('combobox', { name: 'État actuel' })).toHaveTextContent('En attente de la personne');
    expect(document.body.textContent).not.toMatch(/Dossier validé|En cours d'instruction/);
    expect(screen.getByTestId('dossier-status-hint')).toHaveTextContent('Il ne vaut pas décision sur un droit');
    expect(screen.getByTestId('dossier-open-case')).toHaveAttribute('href', '/pro/dossiers/case-1');
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(screen.getByTestId('dossier-status-saved')).toHaveTextContent('Statut mis à jour'));
    expect(calls).toEqual([{ status: 'WAITING_CITIZEN' }]);   // a case status code, no internalNote
  });
  it('a closed follow-up is shown as closed with the way to reopen it; a closed capability hides the control', async () => {
    window.localStorage.setItem('pro_token', 't');
    vi.stubGlobal('fetch', vi.fn(async () => json(200, dossierAnswer({ available: true, caseId: 'case-1', status: 'CLOSED' }))));
    page();
    expect(await screen.findByTestId('dossier-status-closed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mettre à jour' })).toBeNull();
    cleanup();
    vi.stubGlobal('fetch', vi.fn(async () => json(200, dossierAnswer({ available: false, caseId: null, status: null }))));
    page();
    await screen.findByText('Audit RGPD');
    expect(screen.queryByText('Suivi administratif')).toBeNull();
  });
  it('the source offers no free follow-up label any more', () => {
    const src = fs.readFileSync('src/pages/pro/SharedDossier.jsx', 'utf8');
    expect(src).not.toMatch(/status_validated|Dossier validé|internalNote/);
    for (const l of ['en', 'tr', 'ar', 'de', 'uk']) expect(Object.keys(JSON.parse(fs.readFileSync(`src/i18n/locales/${l}/pro.json`, 'utf8'))).filter((k) => /shared_dossier\.status_(validated|in_review|to_handle|needs_documents)/.test(k))).toEqual([]);
  });
});
