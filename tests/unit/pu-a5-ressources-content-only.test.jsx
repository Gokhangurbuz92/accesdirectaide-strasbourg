// @vitest-environment jsdom
/* global window */
/**
 * A-5 (P12) — ResourceAccessibility has no writer (no admin editor, importer or seed): the document list of /ressources could only show « Aucun document
 * n'est encore publié ici » with a promise of future publication. The list part now appears only when a published document exists; without one the page
 * shows the national emergency numbers (the content it really has). The site's navigation has no entry to the bare list. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Ressources from '../../src/pages/Ressources.jsx';

const answer = (items) => vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ items }) })));
const mount = (search = '') => { window.history.pushState({}, '', `/ressources${search}`); return render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [`/ressources${search}`] }, h(Ressources)))); };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.pushState({}, '', '/'); });

describe('A-5: /ressources shows a document list only when a document is published', () => {
  it('no published document: the emergency numbers are shown, with no empty catalogue, no filter and no promise of publication', async () => {
    answer([]);
    mount();
    await waitFor(() => expect(screen.getByTestId('emergency-resources')).toBeInTheDocument());
    for (const n of ['112', '15', '17', '18', '115']) expect(screen.getByTestId(`emergency-resource-${n}`)).toHaveAttribute('href', `tel:${n}`);
    expect(screen.queryByTestId('ressources-none-published')).toBeNull();
    expect(window.document.body.textContent).not.toMatch(/seront publiés|Aucun document n’est encore publié ici/);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByTestId('emergency-link')).toBeNull();
    expect(screen.queryByTestId('ressource-card')).toBeNull();
    expect(screen.getByTestId('page-header')).toHaveTextContent('Numéros d’urgence nationaux. Aucun document n’est publié sur cette page pour le moment.');
  });
  it('a published document: the list, its filter and the emergency button are shown, not the emergency box', async () => {
    answer([{ id: 'r', slug: 'guide-test', title: 'Guide test', type: 'guide', source_url: 'https://example.test/guide' }]);
    mount();
    await waitFor(() => expect(screen.getByTestId('ressource-card')).toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: 'Filtrer par type de ressource' })).toBeInTheDocument();
    expect(screen.getByTestId('emergency-link')).toHaveAttribute('href', '/ressources?emergency=1');
    expect(screen.queryByTestId('emergency-resources')).toBeNull();
    expect(screen.getByTestId('page-header')).toHaveTextContent('Numéros d’urgence et documents utiles pour vos démarches.');
  });
  it('a failed request is still an error with a retry, never an « empty » page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    mount();
    await waitFor(() => expect(screen.getByTestId('ressources-error')).toBeInTheDocument());
    expect(screen.queryByTestId('emergency-resources')).toBeNull();
  });
  it('the navigation offers no entry to the bare list (only the emergency page is linked)', () => {
    const layout = fs.readFileSync('src/pages/Layout.jsx', 'utf8');
    expect(layout).not.toMatch(/href: '\/ressources'|page: 'Ressources'/);
    const home = fs.readFileSync('src/pages/Home.jsx', 'utf8');
    expect(home).not.toMatch(/["'`]\/ressources["'`]/);
  });
});
