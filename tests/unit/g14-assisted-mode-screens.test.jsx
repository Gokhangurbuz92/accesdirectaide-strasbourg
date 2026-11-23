// @vitest-environment jsdom
/* global window */
/** G14-AID — the « mode accompagnant » screens (start / current session / history, the trusted person's requests on both sides) with citizenApi mocked. */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ assistOverview: vi.fn(), startAssist: vi.fn(), endAssist: vi.fn(), endAssistSession: vi.fn(), listDelegations: vi.fn(), delegationLog: vi.fn(),
  delegateView: vi.fn(), resolveDelegateRequest: vi.fn(), setActForMe: vi.fn(), requestDelegateAction: vi.fn(), delegateRequests: vi.fn(), endDelegation: vi.fn(), inviteDelegate: vi.fn(), respondDelegation: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api }));
import CompteAccompagnement from '../../src/pages/CompteAccompagnement.jsx';
import CompteDelegations from '../../src/pages/CompteDelegations.jsx';
import CompteDelegationVue from '../../src/pages/CompteDelegationVue.jsx';

const page = (path) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null,
  createElement(Route, { path: '/compte/accompagnement', element: createElement(CompteAccompagnement) }),
  createElement(Route, { path: '/compte/delegations', element: createElement(CompteDelegations) }),
  createElement(Route, { path: '/compte/delegations/:id', element: createElement(CompteDelegationVue) })))));
const assign = vi.fn();
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  assign.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
});
afterEach(cleanup);

describe('Mode accompagnant — the person', () => {
  it('explains, lists what the helper can never do, needs consent + password; a professional never gets Mon Coffre', async () => {
    api.assistOverview.mockResolvedValue({ current: null, sessions: [] });
    api.startAssist.mockResolvedValue({ session: {} });
    page('/compte/accompagnement');
    const form = await screen.findByTestId('assist-form');
    expect(screen.getByTestId('assist-never')).toHaveTextContent('supprimer votre compte');
    expect(screen.getByTestId('assist-start')).toBeDisabled();   // no consent yet
    expect(within(form).getByTestId('assist-area-COFFRE')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('assist-is-pro'));
    expect(within(form).queryByTestId('assist-area-COFFRE')).toBeNull();
    fireEvent.click(screen.getByTestId('assist-is-pro'));
    fireEvent.change(screen.getByLabelText('Nom de la personne qui vous aide'), { target: { value: 'Marie' } });
    fireEvent.click(screen.getByTestId('assist-area-PARCOURS'));
    fireEvent.click(screen.getByTestId('assist-minutes-120'));
    fireEvent.click(screen.getByTestId('assist-consent'));
    fireEvent.change(screen.getByTestId('assist-password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('assist-start'));
    await waitFor(() => expect(api.startAssist).toHaveBeenCalledWith(expect.objectContaining({ helperName: 'Marie', helperRole: 'PROCHE', areas: ['RDV', 'PARCOURS'], minutes: 120, consent: true, password: 'pw' })));
    expect(api.startAssist.mock.calls[0][0]).not.toHaveProperty('proCode');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/compte'));
  });

  it('during the session: who helps and until when, stop at once, continue alone with the password; the history says « fait avec l’aide de »', async () => {
    api.assistOverview.mockResolvedValue({ current: { sid: 's1', areas: ['RDV'], until: '2026-11-23T12:00:00Z', helper: { name: 'Marie', role: 'PROCHE' } },
      sessions: [{ sid: 's1', live: true, helper: { name: 'Marie', role: 'PROCHE' }, areas: ['RDV'], startedAt: '2026-11-23T10:00:00Z', events: [{ at: '2026-11-23T10:05:00Z', kind: 'ACTION', label: 'RDV_BOOKED' }] }] });
    api.endAssist.mockResolvedValue({ ended: true });
    page('/compte/accompagnement');
    expect(await screen.findByTestId('assist-current')).toHaveTextContent('Marie vous aide');
    expect(screen.getByTestId('assist-event')).toHaveTextContent('Rendez-vous pris — fait avec l’aide de Marie');
    expect(screen.queryByTestId('assist-form')).toBeNull();
    fireEvent.change(screen.getByTestId('assist-continue-password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('assist-continue'));
    await waitFor(() => expect(api.endAssist).toHaveBeenCalledWith({ continueAlone: true, password: 'pw' }));
    fireEvent.click(screen.getByTestId('assist-end-now'));
    await waitFor(() => expect(api.endAssist).toHaveBeenLastCalledWith());
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  });
});

describe('Mode accompagnant à distance — requests', () => {
  const GRANTED = { id: 'g1', role: 'AIDANT', scopes: ['RDV_READ', 'PARCOURS_READ'], status: 'ACTIVE', proofStatus: 'NOT_REQUIRED', expiresAt: '2027-01-01T00:00:00Z', inviteEmail: 'aidant@example.test' };
  it('the person confirms or refuses each request, and switches « agir pour moi » on only with the password', async () => {
    api.listDelegations.mockResolvedValue({ granted: [GRANTED], received: [], actions: { open: true, actScopes: ['RDV_READ', 'PARCOURS_READ'], actForMe: { g1: { RDV_READ: false, PARCOURS_READ: false } } },
      requests: [{ id: 'q1', delegationId: 'g1', type: 'RDV_CANCEL', target: { startAt: '2026-12-01T09:00:00Z', structure: 'CCAS' }, delegateEmail: 'aidant@example.test', expiresAt: '2026-11-25T09:00:00Z' }] });
    api.resolveDelegateRequest.mockResolvedValue({ done: true });
    api.setActForMe.mockResolvedValue({ on: true });
    page('/compte/delegations');
    expect(await screen.findByTestId('delegation-request')).toHaveTextContent('aidant@example.test vous demande de annuler le rendez-vous');
    fireEvent.click(screen.getByTestId('delegation-request-accept'));
    await waitFor(() => expect(api.resolveDelegateRequest).toHaveBeenCalledWith('q1', true));
    fireEvent.click((await screen.findAllByTestId('delegation-act-ask'))[0]);
    fireEvent.change(await screen.findByTestId('delegation-act-password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('delegation-act-on'));
    await waitFor(() => expect(api.setActForMe).toHaveBeenCalledWith({ id: 'g1', scope: 'RDV_READ', on: true, password: 'pw' }));
  });

  it('the trusted person can only ASK (cancel an appointment); the answer says nothing is done before the person accepts', async () => {
    api.listDelegations.mockResolvedValue({ granted: [], received: [{ id: 'r1', role: 'AIDANT', scopes: ['RDV_READ'], status: 'ACTIVE', expiresAt: '2027-01-01T00:00:00Z', principalEmail: 'p@example.test' }], actions: { open: true } });
    api.delegateView.mockResolvedValue({ appointments: [{ id: 'a1', startAt: '2026-12-01T09:00:00Z', structure: 'CCAS' }] });
    api.delegateRequests.mockResolvedValue({ requests: [] });
    api.requestDelegateAction.mockResolvedValue({ executed: false, request: { id: 'q2' } });
    page('/compte/delegations/r1');
    fireEvent.click(await screen.findByTestId('delegate-ask-cancel'));
    await waitFor(() => expect(api.requestDelegateAction).toHaveBeenCalledWith({ id: 'r1', type: 'RDV_CANCEL', appointmentId: 'a1' }));
    expect(await screen.findByTestId('delegation-ask-note')).toHaveTextContent('rien n’est fait tant que la personne ne l’a pas acceptée');
  });
});
