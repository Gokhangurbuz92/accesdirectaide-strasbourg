// @vitest-environment jsdom
/** PKG-2 batch 2 — the dossier transparency section (R16 access log, C17 organisation documents, share-from-Coffre) with citizenApi mocked at the module boundary. */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ dossierAccess: vi.fn(), dossierDocuments: vi.fn(), dossierGrants: vi.fn(), listCoffre: vi.fn(), removeDossierDocument: vi.fn(), shareFromCoffre: vi.fn(),
  dossierDocumentUrl: (s, f) => `/api/citizen/dossier?shareId=${s}&download=${f}` }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api }));
import DossierTransparency from '../../src/components/sharing/DossierTransparency.jsx';

beforeEach(() => {
  Object.values(api).forEach((f) => typeof f?.mockReset === 'function' && f.mockReset());
  api.dossierAccess.mockResolvedValue({ events: [{ action: 'DOSSIER_VIEWED', label: 'a consulté le dossier', at: '2026-10-18T10:00:00Z', organization: 'Structure Alpha' }] });
  api.dossierDocuments.mockResolvedValue({ documents: [{ id: 'f1', name: 'cr.pdf', byteLength: 2048, uploadedAt: '2026-10-18T10:00:00Z', organization: 'Structure Alpha' }] });
  api.dossierGrants.mockResolvedValue({ grants: [{ structureId: 's1', structureName: 'Structure Alpha', revoked: false }, { structureId: 's2', structureName: 'Ancienne', revoked: true }] });
  api.listCoffre.mockResolvedValue({ documents: [{ id: 'c1', name: 'bail.pdf', category: 'logement' }] });
});
afterEach(cleanup);

describe('dossier transparency', () => {
  it('shows who accessed the dossier by organisation and the organisation documents with a download link', async () => {
    render(createElement(DossierTransparency, { shareId: 'sh1' }));
    expect(await screen.findByTestId('access-event')).toHaveTextContent('Structure Alpha a consulté le dossier');
    expect(screen.getByTestId('dossier-doc')).toHaveTextContent('déposé par Structure Alpha');
    expect(screen.getByTestId('dossier-doc-download')).toHaveAttribute('href', '/api/citizen/dossier?shareId=sh1&download=f1');
  });
  it('a revoked organisation is not offered for sharing; the Coffre document goes to the chosen active one', async () => {
    api.shareFromCoffre.mockResolvedValue({ fileId: 'n1' });
    render(createElement(DossierTransparency, { shareId: 'sh1' }));
    const org = await screen.findByTestId('share-coffre-org');
    expect([...org.options].map((o) => o.textContent)).toEqual(['Choisir…', 'Structure Alpha']);
    fireEvent.change(screen.getByTestId('share-coffre-doc'), { target: { value: 'c1' } }); fireEvent.change(org, { target: { value: 's1' } });
    fireEvent.click(screen.getByTestId('share-coffre-send'));
    await waitFor(() => expect(api.shareFromCoffre).toHaveBeenCalledWith('c1', 'sh1', 's1'));
    expect(await screen.findByTestId('transparency-status')).toHaveTextContent('elle seule le voit');
  });
  it('the person removes an organisation document', async () => {
    api.removeDossierDocument.mockResolvedValue({});
    render(createElement(DossierTransparency, { shareId: 'sh1' }));
    fireEvent.click(await screen.findByTestId('dossier-doc-remove'));
    await waitFor(() => expect(api.removeDossierDocument).toHaveBeenCalledWith('sh1', 'f1'));
  });
});
