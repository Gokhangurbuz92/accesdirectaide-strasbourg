// @vitest-environment jsdom
/** PKG-2 batch 3 — C23 screens (Personnes de confiance + the delegate's read-only view) with citizenApi mocked at the module boundary. */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listDelegations: vi.fn(), inviteDelegate: vi.fn(), respondDelegation: vi.fn(), endDelegation: vi.fn(), delegationLog: vi.fn(), delegateView: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api }));
import CompteDelegations from '../../src/pages/CompteDelegations.jsx';
import CompteDelegationVue from '../../src/pages/CompteDelegationVue.jsx';

const page = (path) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null,
  createElement(Route, { path: '/compte/delegations', element: createElement(CompteDelegations) }), createElement(Route, { path: '/compte/delegations/:id', element: createElement(CompteDelegationVue) })))));
const GRANTED = { id: 'g1', role: 'AIDANT', scopes: ['PARCOURS_READ'], status: 'ACTIVE', proofStatus: 'NOT_REQUIRED', expiresAt: '2027-01-01T00:00:00Z', inviteEmail: 'aidant@example.test' };
const RECEIVED = { id: 'r1', role: 'AIDANT', scopes: ['PARCOURS_READ', 'COFFRE_LIST'], status: 'ACTIVE', expiresAt: '2027-01-01T00:00:00Z', principalEmail: 'maman@example.test' };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listDelegations.mockResolvedValue({ granted: [GRANTED], received: [RECEIVED] });
});
afterEach(cleanup);

describe('Personnes de confiance', () => {
  it('invites with the chosen role, scopes and duration; without an e-mail provider the link is shown to transmit', async () => {
    api.inviteDelegate.mockResolvedValue({ inviteLink: 'http://localhost/compte/delegations?invitation=tok', delivery: 'NOT_DELIVERED', delegation: {} });
    page('/compte/delegations');
    fireEvent.change(await screen.findByTestId('delegation-email'), { target: { value: 'ami@example.test' } });
    fireEvent.click(screen.getByTestId('delegation-scope-COFFRE_LIST'));
    fireEvent.change(screen.getByTestId('delegation-days'), { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('delegation-invite'));
    await waitFor(() => expect(api.inviteDelegate).toHaveBeenCalledWith({ email: 'ami@example.test', role: 'AIDANT', scopes: ['PARCOURS_READ', 'COFFRE_LIST'], days: 30 }));
    expect(await screen.findByTestId('delegation-link')).toHaveTextContent('invitation=tok');
    expect(screen.getByTestId('delegation-status')).toHaveTextContent('Aucun e-mail n’a pu être envoyé');
  });
  it('a legal mandate says plainly that its proof cannot be verified yet', async () => {
    page('/compte/delegations');
    fireEvent.change(await screen.findByTestId('delegation-role'), { target: { value: 'TUTEUR' } });
    expect(screen.getByTestId('delegation-proof-notice')).toHaveTextContent('n’ouvrira aucun accès');
  });
  it('the principal revokes and sees what was viewed', async () => {
    api.endDelegation.mockResolvedValue({}); api.delegationLog.mockResolvedValue({ events: [{ action: 'PARCOURS_VIEWED', label: 'a consulté Mon Parcours', at: '2026-10-19T08:00:00Z' }] });
    page('/compte/delegations');
    fireEvent.click(await screen.findByTestId('delegation-show-log'));
    expect(await screen.findByTestId('delegation-log-event')).toHaveTextContent('a consulté Mon Parcours');
    fireEvent.click(screen.getByTestId('delegation-revoke'));
    await waitFor(() => expect(api.endDelegation).toHaveBeenCalledWith('g1'));
  });
  it('an invitation link offers accept / refuse; a pending legal mandate is reported as opening nothing', async () => {
    api.respondDelegation.mockResolvedValue({ delegation: { status: 'PROOF_REQUIRED' } });
    page('/compte/delegations?invitation=tok');
    fireEvent.click(await screen.findByTestId('delegation-accept'));
    await waitFor(() => expect(api.respondDelegation).toHaveBeenCalledWith('tok', true));
    expect(await screen.findByTestId('delegation-status')).toHaveTextContent('aucun accès n’est ouvert');
  });
  it('the delegate view is read-only and shows only the granted parts', async () => {
    api.delegateView.mockImplementation(async (_id, v) => (v === 'parcours' ? { items: [{ id: 'i1', title: 'Déposer le dossier', status: 'IN_PROGRESS' }] } : { documents: [{ name: 'bail.pdf', category: 'logement', byteLength: 2048 }] }));
    page('/compte/delegations/r1');
    expect(await screen.findByTestId('delegation-readonly-banner')).toHaveTextContent('Lecture seule');
    expect(screen.getByTestId('delegate-parcours-item')).toHaveTextContent('Déposer le dossier');
    expect(screen.getByTestId('delegate-coffre-item')).toHaveTextContent('bail.pdf');
    expect(api.delegateView.mock.calls.map((c) => c[1])).toEqual(['parcours', 'coffre']);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
