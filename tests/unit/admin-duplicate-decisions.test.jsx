// @vitest-environment jsdom
/**
 * RA-05 — the recorded decisions of the duplicate register (src/pages/admin/k5/DuplicateDecisions.jsx, shown on /admin/doublons): the decided pairs in a
 * table (both records side by side, author, evidence, note), server-side filters and pages, « Revoir » which shows the pair in full with what a replacement
 * does and does not do, and a replacement sent through the existing decision path with expectedDecisionId = the decision read. Synthetic data. No JSX.
 */
/* global document, window */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiClient: { admin: { getDuplicateRegister: vi.fn(), getDecidedDuplicates: vi.fn(), getDuplicates: vi.fn(), decideDuplicates: vi.fn() } } }));
vi.mock('@/api/client', () => api);
import DuplicateDecisions from '../../src/pages/admin/k5/DuplicateDecisions.jsx';
import AdminDuplicates from '../../src/pages/admin/k5/Duplicates.jsx';

const V = (c) => c.repeat(64);
const AUTO = 'ada-veille-automatique';
const rec = (id, nom, patch = {}) => ({ id, nom, type_structure: 'Association', adresse: `${id} rue du Test`, code_postal: '67000', ville: 'Strasbourg', siret: '90000000000011', numero_finess: null, rna_id: null,
  verification_status: 'VERIFIED', publication_hold: null, version: V(id.slice(-1)), sources: [{ kind: 'SIRENE', url: `https://annuaire-entreprises.data.gouv.fr/etablissement/${id}` }], ...patch });
const DECISIONS = [
  { id: 'dec-1', key: 's1|s2', a: 's1', b: 's2', decision: 'SAME_ENTITY', primaryId: 's1', evidenceUrl: 'https://annuaire-entreprises.data.gouv.fr/entreprise/900000000', note: 'Même SIRET, aucun autre registre ne les distingue.',
    reviewerId: AUTO, automatic: true, decidedAt: '2026-11-10T03:00:00.000Z', supersededAt: null, changedSince: false, A: rec('s1', 'Centre social Alpha'), B: rec('s2', 'Centre social Alpha (antenne)', { publication_hold: 'Doublon (registre des doublons) : même organisation que « Centre social Alpha »' }) },
  { id: 'dec-0', key: 's3|s4', a: 's3', b: 's4', decision: 'DISTINCT', primaryId: null, evidenceUrl: 'https://finess.esante.gouv.fr/fininter/jsp/actionDetailEtablissement.do?noFiness=1', note: 'Deux numéros FINESS distincts.',
    reviewerId: 'personne@example.test', automatic: false, decidedAt: '2026-11-01T09:00:00.000Z', supersededAt: '2026-11-05T09:00:00.000Z', changedSince: true, A: rec('s3', 'Foyer Bêta'), B: rec('s4', 'Foyer Gamma') },
];
const DETAIL = {
  a: { id: 's1', nom: 'Centre social Alpha', statut: 'actif', verification: 'VERIFIED', hold: null, version: V('1'), content: [{ field: 'adresse', value: '1 rue du Test' }, { field: 'siret', value: '90000000000011' }] },
  b: { id: 's2', nom: 'Centre social Alpha (antenne)', statut: 'actif', verification: 'VERIFIED', hold: 'Doublon (registre des doublons)', version: V('2'), content: [{ field: 'adresse', value: '2 rue du Test' }] },
  decisions: [{ id: 'dec-1', decision: 'SAME_ENTITY', primaryId: 's1', evidenceUrl: DECISIONS[0].evidenceUrl, note: DECISIONS[0].note, reviewerId: AUTO, decidedAt: '2026-11-10T03:00:00.000Z', supersededAt: null }],
};
const served = (patch = {}) => ({ total: 2, page: 1, pageSize: 25, pages: 1, decisions: DECISIONS, ...patch });

beforeEach(() => { window.history.replaceState({}, '', '/admin/doublons'); });
afterEach(() => { cleanup(); for (const f of Object.values(api.apiClient.admin)) f.mockReset(); });

describe('recorded duplicate decisions — review and replacement by a person', () => {
  it('lists the decided pairs in a table, both records side by side, with the automatic author, the evidence and the note; filters and pages are asked from the server', async () => {
    api.apiClient.admin.getDecidedDuplicates.mockImplementation(async (p) => served(p.pageSize === 25 ? { total: 53, pages: 3, page: p.page } : {}));
    const { container } = render(createElement(DuplicateDecisions, {}));
    const table = await screen.findByRole('table', { name: /Décisions enregistrées/ });
    await waitFor(() => expect(screen.getAllByTestId('dupdec-row')).toHaveLength(2));
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Décision', 'Fiche 1', 'Fiche 2', 'Auteur', 'Preuve et note', 'Action']);
    const [auto, old] = screen.getAllByTestId('dupdec-row');
    expect(auto).toHaveAttribute('data-automatic', 'true');
    expect(auto).toHaveTextContent('Même établissement'); expect(auto).toHaveTextContent('en vigueur'); expect(auto).toHaveTextContent('Conservée : Fiche 1');
    expect(auto).toHaveTextContent('Centre social Alpha'); expect(auto).toHaveTextContent('SIRET 90000000000011'); expect(auto).toHaveTextContent('Mise de côté (hors annuaire public)');
    expect(auto).toHaveTextContent(`Automatique (${AUTO})`); expect(auto).toHaveTextContent('Même SIRET, aucun autre registre ne les distingue.');
    expect(within(auto).getAllByRole('link').map((a) => a.getAttribute('href'))).toContain(DECISIONS[0].evidenceUrl);
    expect(within(auto).getByRole('button', { name: 'Revoir la décision : Centre social Alpha / Centre social Alpha (antenne)' })).toBeInTheDocument();
    // a superseded decision is history: shown, never replaceable
    expect(old).toHaveTextContent('remplacée le'); expect(old).toHaveTextContent('personne@example.test'); expect(old).toHaveTextContent('Une fiche a changé depuis cette décision.');
    expect(within(old).queryByRole('button')).toBeNull(); expect(old).toHaveTextContent('Historique (lecture seule)');

    expect(api.apiClient.admin.getDecidedDuplicates).toHaveBeenLastCalledWith({ decision: '', reviewer: '', status: 'active', from: '', to: '', q: '', page: 1, pageSize: 25 });
    expect(screen.getByTestId('dupdec-page')).toHaveTextContent('Page 1 sur 3');
    fireEvent.click(screen.getByTestId('dupdec-next'));
    await waitFor(() => expect(api.apiClient.admin.getDecidedDuplicates).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    fireEvent.change(screen.getByLabelText('Auteur'), { target: { value: 'auto' } });
    await waitFor(() => expect(api.apiClient.admin.getDecidedDuplicates).toHaveBeenLastCalledWith(expect.objectContaining({ reviewer: 'auto', page: 1 })));   // a filter goes back to the first page
    fireEvent.change(screen.getByLabelText('Décision'), { target: { value: 'SAME_ENTITY' } });
    fireEvent.change(screen.getByLabelText('État'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Décidée du (jour UTC)'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('au'), { target: { value: '2026-11-15' } });
    fireEvent.change(screen.getByLabelText(/^Rechercher/), { target: { value: ' Alpha ' } });
    fireEvent.click(screen.getByTestId('dupdec-apply'));
    await waitFor(() => expect(api.apiClient.admin.getDecidedDuplicates).toHaveBeenLastCalledWith({ decision: 'SAME_ENTITY', reviewer: 'auto', status: 'all', from: '2026-11-01', to: '2026-11-15', q: 'Alpha', page: 1, pageSize: 25 }));

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('« Revoir » shows the pair in full, says what a replacement does and does not do, and sends the replacement bound to the decision read', async () => {
    api.apiClient.admin.getDecidedDuplicates.mockResolvedValue(served());
    api.apiClient.admin.getDuplicates.mockResolvedValue(DETAIL);
    const { container } = render(createElement(DuplicateDecisions, { errorText: (r) => `refus ${r.code}` }));
    const open = (await screen.findAllByTestId('dupdec-review-open'))[0];
    fireEvent.click(open);
    const panel = await screen.findByTestId('dupdec-review');
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Revoir la décision de cette paire'));
    expect(api.apiClient.admin.getDuplicates).toHaveBeenCalledWith('s1', 's2');
    await within(panel).findByTestId('dupdec-form');
    expect(within(panel).getByTestId('dupdec-current')).toHaveTextContent(`Décision en vigueur : Même établissement — Automatique (${AUTO})`);
    expect(within(panel).getByTestId('dupdec-current')).toHaveTextContent('Fiche conservée : Centre social Alpha');
    expect(within(panel).getAllByTestId('dupdec-record')).toHaveLength(2);
    expect(within(panel).getAllByTestId('dupdec-record')[1]).toHaveTextContent('mise de côté : Doublon (registre des doublons)');
    expect(within(panel).getByTestId('dupdec-history')).toHaveTextContent('Même SIRET, aucun autre registre ne les distingue.');
    const effects = within(panel).getByTestId('dupdec-effects');
    expect(effects).toHaveTextContent('La décision en vigueur n’est pas effacée');
    expect(effects).toHaveTextContent('elle redevient visible dans l’annuaire public si elle était déjà vérifiée');
    expect(effects).toHaveTextContent('le remplacement n’accorde aucune vérification (une fiche non vérifiée n’est jamais publiée par ce biais), ne fusionne et ne supprime rien');
    expect(within(panel).getByTestId('dupdec-link')).toHaveAttribute('href', '/admin/doublons?a=s1&b=s2');

    // nothing leaves while the form is incomplete
    fireEvent.click(within(panel).getByTestId('dupdec-submit'));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(/choisissez une décision.*page officielle.*ce que la source établit/);
    expect(api.apiClient.admin.decideDuplicates).not.toHaveBeenCalled();

    fireEvent.click(within(panel).getByLabelText('Établissements distincts'));
    fireEvent.change(within(panel).getByLabelText(/^Preuve institutionnelle/), { target: { value: 'https://annuaire-entreprises.data.gouv.fr/etablissement/90000000000029' } });
    fireEvent.change(within(panel).getByLabelText(/^Ce que la source établit/), { target: { value: 'Deux établissements distincts au répertoire SIRENE.' } });
    const a11y = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(a11y.violations.map((v) => v.id)).toEqual([]);

    // refused by the server (another decision meanwhile): the reason stays on the form, with a reload
    api.apiClient.admin.decideDuplicates.mockResolvedValueOnce({ results: [{ key: 's1|s2', ok: false, status: 409, code: 'PAIR_ALREADY_DECIDED' }] });
    fireEvent.click(within(panel).getByTestId('dupdec-submit'));
    expect(await within(panel).findByTestId('dupdec-form-error')).toHaveTextContent('refus PAIR_ALREADY_DECIDED');
    expect(within(panel).getByTestId('dupdec-reload')).toBeInTheDocument();

    api.apiClient.admin.decideDuplicates.mockResolvedValueOnce({ results: [{ key: 's1|s2', ok: true, idempotent: false, decision: { id: 'dec-2', decision: 'DISTINCT', held: null, released: ['s2'], restored: [], superseded: 1 } }] });
    fireEvent.click(within(panel).getByTestId('dupdec-submit'));
    await waitFor(() => expect(screen.queryByTestId('dupdec-review')).toBeNull());
    expect(api.apiClient.admin.decideDuplicates).toHaveBeenLastCalledWith([{ a: 's1', b: 's2', decision: 'DISTINCT', evidenceUrl: 'https://annuaire-entreprises.data.gouv.fr/etablissement/90000000000029',
      note: 'Deux établissements distincts au répertoire SIRENE.', versionA: V('1'), versionB: V('2'), expectedDecisionId: 'dec-1' }]);
    expect(screen.getByTestId('dupdec-status')).toHaveTextContent('Décision remplacée et journalisée ; la décision précédente reste dans l’historique. Mise de côté « doublon » levée pour 1 fiche(s) : chacune retrouve son propre état de vérification.');
    await waitFor(() => expect(api.apiClient.admin.getDecidedDuplicates).toHaveBeenCalledTimes(2));   // the list is read again
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Décisions enregistrées'));
  });

  it('a « same establishment » replacement names the record kept; Escape closes the review without sending anything and gives the focus back', async () => {
    api.apiClient.admin.getDecidedDuplicates.mockResolvedValue(served());
    api.apiClient.admin.getDuplicates.mockResolvedValue(DETAIL);
    render(createElement(DuplicateDecisions, {}));
    const open = (await screen.findAllByTestId('dupdec-review-open'))[0];
    fireEvent.click(open);
    const panel = await screen.findByTestId('dupdec-review'); await within(panel).findByTestId('dupdec-form');
    fireEvent.click(within(panel).getByLabelText('Même établissement'));
    fireEvent.change(within(panel).getByLabelText(/^Preuve institutionnelle/), { target: { value: 'https://annuaire-entreprises.data.gouv.fr/entreprise/900000000' } });
    fireEvent.change(within(panel).getByLabelText(/^Ce que la source établit/), { target: { value: 'Même établissement, la fiche 2 est la plus complète.' } });
    fireEvent.click(within(panel).getByTestId('dupdec-submit'));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('indiquez la fiche à conserver');
    fireEvent.change(within(panel).getByLabelText(/^Fiche à conserver/), { target: { value: 's2' } });
    api.apiClient.admin.decideDuplicates.mockResolvedValueOnce({ results: [{ key: 's1|s2', ok: true, idempotent: false, decision: { held: 's1', released: ['s2'], restored: [], superseded: 1 } }] });
    fireEvent.click(within(panel).getByTestId('dupdec-submit'));
    await waitFor(() => expect(api.apiClient.admin.decideDuplicates).toHaveBeenCalledWith([expect.objectContaining({ decision: 'SAME_ENTITY', primaryId: 's2', expectedDecisionId: 'dec-1' })]));
    await waitFor(() => expect(screen.getByTestId('dupdec-status')).toHaveTextContent('Une fiche a été mise de côté (elle quitte l’annuaire public).'));

    const again = (await screen.findAllByTestId('dupdec-review-open'))[0];
    fireEvent.click(again);
    const second = await screen.findByTestId('dupdec-review');
    fireEvent.keyDown(within(second).getByTestId('dupdec-review-close'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('dupdec-review')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(again));
    expect(api.apiClient.admin.decideDuplicates).toHaveBeenCalledTimes(1);
  });

  it('the page shows the recorded decisions under the pairs to examine; a direct link ?a=&b= opens the review; the pair shortcuts never act from there', async () => {
    window.history.replaceState({}, '', '/admin/doublons?a=s1&b=s2');
    api.apiClient.admin.getDuplicateRegister.mockResolvedValue({ total: 0, pairs: [] });
    api.apiClient.admin.getDecidedDuplicates.mockResolvedValue(served());
    api.apiClient.admin.getDuplicates.mockResolvedValue(DETAIL);
    render(createElement(AdminDuplicates));
    const section = await screen.findByTestId('dup-decisions');
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('Décisions enregistrées');
    const panel = await within(section).findByTestId('dupdec-review');
    await within(panel).findByTestId('dupdec-form');
    expect(api.apiClient.admin.getDuplicates).toHaveBeenCalledWith('s1', 's2');
    fireEvent.keyDown(within(panel).getByTestId('dupdec-submit'), { key: 'm' });   // « M » is a pair shortcut of the list above
    expect(within(panel).getByLabelText('Même établissement')).not.toBeChecked();
    expect(api.apiClient.admin.decideDuplicates).not.toHaveBeenCalled();
  });

  it('a pair without a decision in force offers no replacement', async () => {
    api.apiClient.admin.getDecidedDuplicates.mockResolvedValue(served());
    api.apiClient.admin.getDuplicates.mockResolvedValue({ ...DETAIL, decisions: [] });
    render(createElement(DuplicateDecisions, {}));
    fireEvent.click((await screen.findAllByTestId('dupdec-review-open'))[0]);
    expect(await screen.findByTestId('dupdec-no-active')).toHaveTextContent('Cette paire n’a pas de décision en vigueur');
    expect(screen.queryByTestId('dupdec-form')).toBeNull();
  });
});
