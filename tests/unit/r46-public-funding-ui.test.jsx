// @vitest-environment jsdom
/**
 * R46 / P27 — the funding dossier page: the funder's own headings are added, written, marked required and sent with the save (the API client is stubbed:
 * the server rules are tested in r46-public-funding-rubriques*.test.js). No JSX in the test body (the repo ESLint config does not parse JSX in tests/).
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = [];
const DOSSIER = {
  id: 'dossier-synthetique-1', title: 'Dossier synthétique', status: 'EN_PREPARATION', statusLabel: 'En préparation', version: 2, funderName: 'Financeur fictif',
  content: { sections: {}, rubriques: [], budget: [], financement: [], jalons: [], pieces: [] }, warnings: [], totals: { charges: 0, produits: 0 },
};
vi.mock('@/api/client', () => ({
  apiClient: { admin: { k5: vi.fn(async (path, body) => {
    calls.push({ path, body });
    if (String(path).startsWith('funding?id=')) return { dossier: DOSSIER, versions: [] };
    if (body?.action === 'save') return { dossier: { ...DOSSIER, version: 3 } };
    return { dossiers: [], vocab: { sections: [], statuses: {}, budgetStatuses: {}, financingStatuses: {}, pieceStatuses: {} } };
  }) } },
}));

const { default: AdminFunding } = await import('../../src/pages/admin/k5/Funding.jsx');
afterEach(() => { cleanup(); calls.length = 0; });

describe('R46 P27 funder headings in the page', () => {
  it('adds a funder heading, writes it, keeps « attendue », and saves it in the content', async () => {
    render(createElement(MemoryRouter, { initialEntries: ['/admin/financement/dossier-synthetique-1'] },
      createElement(Routes, null, createElement(Route, { path: '/admin/financement/:id', element: createElement(AdminFunding) }))));
    const box = await screen.findByTestId('funding-rubriques');
    expect(box).toHaveTextContent('Rubriques demandées par le financeur');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une rubrique du financeur' }));
    fireEvent.change(screen.getByLabelText('Intitulé du financeur'), { target: { value: 'Impact social attendu' } });
    fireEvent.change(screen.getByLabelText('Texte'), { target: { value: 'Indicateurs synthétiques' } });
    expect(screen.getByLabelText('Rubrique attendue par le financeur')).toBeChecked();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
    await waitFor(() => expect(calls.some((c) => c.body?.action === 'save')).toBe(true));
    const save = calls.find((c) => c.body?.action === 'save');
    expect(save.body).toMatchObject({ id: 'dossier-synthetique-1', version: 2 });
    expect(save.body.content.rubriques).toEqual([expect.objectContaining({ titre: 'Impact social attendu', texte: 'Indicateurs synthétiques', attendue: true })]);
  });
});
