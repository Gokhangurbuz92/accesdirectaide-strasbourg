// @vitest-environment jsdom
/**
 * M2 — Mes orientations (/compte/orientations) and the contact-person card, rendered (jsdom, no layout; no JSX in the body): the chain, the suggested
 * organization (« nothing was transmitted »), the controlled motive of an answer, the next step, the follow-up flag; the « référent de parcours » card with
 * its « no access / no legal designation » notice, the person's agree / refuse / end actions, and nothing at all when there is no contact person.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ referrals: vi.fn(), decideReferral: vi.fn(), dossierReferent: vi.fn(), decideReferent: vi.fn(), endReferent: vi.fn() }));
vi.mock('@/lib/citizenApi', () => ({ citizenApi: api }));
vi.mock('@/components/SEO', () => ({ default: () => null }));

import CompteOrientations from '../../src/pages/CompteOrientations.jsx';
import ReferentCard from '../../src/components/sharing/ReferentCard.jsx';
import { setLanguage } from '../../src/i18n/index.js';

const A = { id: 'a', dossierId: 'd1', from: 'Org test X', to: 'Org test Y', status: 'DECLINED', reasonCode: 'HOUSING', message: '', responseCode: 'REDIRECT_SUGGESTED', respondedAt: '2026-11-01T10:00:00Z', closedAt: null,
  suggested: 'Org test Z', previousId: null, nextId: null, nextAction: { code: 'SENDER_PROPOSE_SUGGESTED', by: 'SENDER' }, needsFollowUp: true };
const B = { id: 'b', dossierId: 'd1', from: 'Org test X', to: 'Org test Z', status: 'PENDING_CITIZEN', reasonCode: 'HOUSING', message: '', responseCode: null, respondedAt: null, closedAt: null,
  suggested: null, previousId: 'a', nextId: null, nextAction: { code: 'CITIZEN_DECIDE', by: 'CITIZEN' }, needsFollowUp: false };
const C = { id: 'c', dossierId: 'd1', from: 'Org test X', to: 'Org test W', status: 'ACCEPTED', reasonCode: 'HEALTH', message: '', responseCode: null, respondedAt: '2026-11-10T10:00:00Z', closedAt: null,
  suggested: null, previousId: null, nextId: null, nextAction: { code: 'RECEIVER_FIRST_STEP', by: 'RECEIVER' }, needsFollowUp: false };
const page = () => render(h(MemoryRouter, null, h(CompteOrientations)));

beforeEach(() => { for (const f of Object.values(api)) f.mockReset(); api.dossierReferent.mockResolvedValue({ available: true, referent: null, proposal: null }); });
afterEach(async () => { cleanup(); await act(async () => { await setLanguage('fr', { persist: false }); }); });

describe('M2 — Mes orientations', () => {
  it('shows the chain, the suggestion, the motive, the next step and the follow-up flag', async () => {
    api.referrals.mockResolvedValue({ referrals: [B, A, C] });
    page();
    await waitFor(() => expect(screen.getByTestId('compte-orientations')).toBeInTheDocument());
    // the pending proposal says which referral it follows
    expect(screen.getByTestId('orientation-pending')).toHaveTextContent('Suite de l’orientation vers Org test Y');
    const items = screen.getAllByTestId('orientation-item');
    const declined = items.find((li) => li.textContent.includes('Org test Y'));
    expect(declined).toHaveTextContent('Réponse de Org test Y : elle suggère une autre structure');
    expect(declined).toHaveTextContent('Structure suggérée : Org test Z. Rien ne lui a été transmis.');
    expect(declined).toHaveTextContent('Prochaine étape : Org test X peut vous proposer Org test Z ; rien ne lui est transmis sans votre accord');
    expect(declined).toHaveTextContent('Vous pouvez contacter Org test X');
    const accepted = items.find((li) => li.textContent.includes('Org test W'));
    expect(accepted).toHaveTextContent('Prochaine étape : Org test W doit vous contacter ou vous proposer un premier rendez-vous');
    expect(accepted.querySelector('[data-testid="orientation-follow-up"]')).toBeNull();
    // no contact person and no proposal: the card is not shown at all
    await waitFor(() => expect(api.dossierReferent).toHaveBeenCalledWith('d1'));
    expect(screen.queryByTestId('referent-card')).toBeNull();
  });
  it('renders in another language without a missing key', async () => {
    api.referrals.mockResolvedValue({ referrals: [A] });
    await act(async () => { await setLanguage('en', { persist: false }); });
    page();
    await waitFor(() => expect(screen.getByTestId('orientation-item')).toBeInTheDocument());
    expect(screen.getByTestId('orientation-item')).toHaveTextContent('Next step: Org test X can propose Org test Z to you; nothing is passed on to it without your agreement');
    expect(screen.getByTestId('orientation-suggested')).toHaveTextContent('Nothing has been passed on to it.');
  });
});

describe('M2 — contact person card (« référent de parcours »)', () => {
  const card = () => render(h(ReferentCard, { shareId: 'd1' }));
  it('a proposal: the notice, then the person agrees or refuses', async () => {
    api.dossierReferent.mockResolvedValueOnce({ available: true, referent: null, proposal: { displayName: 'Camille (test)', organization: 'Org test X', since: '2026-11-14T10:00:00Z' } })
      .mockResolvedValue({ available: true, referent: { displayName: 'Camille (test)', organization: 'Org test X', since: '2026-11-15T10:00:00Z' }, proposal: null });
    api.decideReferent.mockResolvedValue({});
    card();
    await waitFor(() => expect(screen.getByTestId('referent-proposal')).toBeInTheDocument());
    const text = screen.getByTestId('referent-card').textContent;
    expect(text).toContain('Personne de contact pour votre parcours');
    expect(text).toContain('aucun accès supplémentaire à votre dossier');
    expect(text).toContain('ne remplace aucune désignation légale ou contractuelle');
    expect(text).toContain('Vous pouvez y mettre fin à tout moment');
    expect(text).not.toMatch(/responsable|mandataire/i);
    expect(screen.getByTestId('referent-refuse')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('referent-accept'));
    await waitFor(() => expect(screen.getByTestId('referent-current')).toBeInTheDocument());
    expect(api.decideReferent).toHaveBeenCalledWith('d1', true);
    expect(screen.getByTestId('referent-status')).toHaveTextContent('Votre accord est enregistré');
  });
  it('the person ends the role; a failure is said', async () => {
    api.dossierReferent.mockResolvedValue({ available: true, referent: { displayName: 'Camille (test)', organization: 'Org test X', since: '2026-11-15T10:00:00Z' }, proposal: null });
    api.endReferent.mockRejectedValueOnce(new Error('x')).mockResolvedValue({});
    card();
    await waitFor(() => expect(screen.getByTestId('referent-end')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('referent-end'));
    await waitFor(() => expect(screen.getByTestId('referent-problem')).toBeInTheDocument());
    api.dossierReferent.mockResolvedValue({ available: true, referent: null, proposal: null });
    fireEvent.click(screen.getByTestId('referent-end'));
    await waitFor(() => expect(screen.getByTestId('referent-status')).toHaveTextContent('Vous n’avez plus de personne de contact'));
    expect(api.endReferent).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('referent-current')).toBeNull();
  });
  it('nothing is rendered where the service does not offer it, or when the read fails', async () => {
    api.dossierReferent.mockResolvedValueOnce({ available: false, referent: null, proposal: null });
    const first = card();
    await waitFor(() => expect(api.dossierReferent).toHaveBeenCalledTimes(1));
    expect(first.container).toBeEmptyDOMElement();
    cleanup();
    api.dossierReferent.mockRejectedValueOnce(new Error('x'));
    const second = card();
    await waitFor(() => expect(api.dossierReferent).toHaveBeenCalledTimes(2));
    expect(second.container).toBeEmptyDOMElement();
  });
});
