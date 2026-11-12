// @vitest-environment jsdom
/**
 * Registre des doublons — the bulk review page (src/pages/admin/k5/Duplicates.jsx) on copies of real pairs: two decision controls per row (« Non examiné »
 * only as the unselected state), keyboard moves and decisions, preselection of the well-documented suggestions only, a confirmation summary, one request per
 * chunk with per-row results (a partial failure stays visible on its row), the register reloaded without a page reload, no « mark everything » control.
 * No JSX in the body.
 */
/* global document */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/duplicate-pairs-lab.json';
import { assessPair } from '../../api/_services/duplicate-evidence.js';

const api = vi.hoisted(() => ({ apiClient: { admin: { getDuplicateRegister: vi.fn(), getDuplicates: vi.fn(), decideDuplicates: vi.fn() } } }));
vi.mock('@/api/client', () => api);
import AdminDuplicates from '../../src/pages/admin/k5/Duplicates.jsx';

afterEach(() => { cleanup(); for (const f of Object.values(api.apiClient.admin)) f.mockReset(); });

const V = (c) => c.repeat(64);
const view = (r, v) => ({ ...r, version: V(v), sources: [...(r.auto_check?.sources || [])] });
const PAIRS = Object.values(fixture.pairs).map((p, i) => {
  const [A, B] = [p.A, p.B].sort((x, y) => (x.id < y.id ? -1 : 1));
  return { key: `${A.id}|${B.id}`, a: A.id, b: B.id, detection: { sameAddress: true, nameSimilarity: 0.3 }, A: view(A, String(i % 10)), B: view(B, 'f'), assessment: assessPair(A, B, { env: {} }), expectedDecisionId: null };
});
const rows = () => screen.getAllByTestId('admin-duplicate-candidate');
const rowOf = (name) => rows().find((r) => r.textContent.includes(name));

describe('bulk duplicate review page', () => {
  it('lists every pair with its evidence, two decision controls, keyboard decisions, and saves the selection with per-row results', async () => {
    let served = PAIRS;
    api.apiClient.admin.getDuplicateRegister.mockImplementation(async () => ({ total: served.length, pairs: served }));
    const { container } = render(createElement(AdminDuplicates));
    await waitFor(() => expect(rows()).toHaveLength(PAIRS.length));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Registre des doublons');
    expect(screen.queryByText(/tout marquer/i)).toBeNull();

    // a row: both records, the identifiers, the suggestion with its exact source, two decision controls, « Non examiné » as the unselected state
    const castel = rowOf('FAM PHV le Castel');
    expect(castel).toHaveTextContent('FINESS 670015072'); expect(castel).toHaveTextContent('Suggestion : établissements distincts — confiance haute');
    expect(within(castel).getAllByRole('link').map((a) => a.getAttribute('href'))).toContain(PAIRS.find((p) => p.A.nom.includes('Castel') || p.B.nom.includes('Castel')).assessment.evidenceUrl);
    expect(within(castel).getByTestId('dup-unreviewed')).toHaveTextContent('Non examiné');
    const g = within(castel).getByRole('group', { name: 'Décision pour cette paire' });
    expect(within(g).getAllByRole('button').map((b) => b.textContent.replace(/ \(.*\)$/, ''))).toEqual(['Même établissement — doublon confirmé', 'Établissements distincts — conserver les deux fiches']);
    expect(rowOf('Mission locale pour l')).toHaveTextContent('Pas de suggestion : à examiner — preuves insuffisantes');

    // keyboard: the first row focused, D chooses « distincts », ↓ moves, M on a pair without a matching suggestion leaves it « à compléter »
    rows()[0].focus();
    fireEvent.keyDown(rows()[0], { key: 'd' });
    expect(within(rows()[0]).getByTestId('dup-choose-DISTINCT')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(rows()[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows()[1]);
    fireEvent.keyDown(rows()[1], { key: 'm' });
    expect(within(rows()[1]).getByTestId('dup-incomplete')).toHaveTextContent(/indiquez la fiche à conserver.*page officielle.*ce que la source établit/);
    fireEvent.keyDown(rows()[1], { key: 'u' });
    expect(within(rows()[1]).getByTestId('dup-unreviewed')).toBeInTheDocument();

    // preselect: only the well-documented suggestions
    const wd = PAIRS.filter((p) => p.assessment.wellDocumented).length;
    fireEvent.click(screen.getByTestId('dup-preselect'));
    const save = screen.getByTestId('admin-duplicate-decide');
    await waitFor(() => expect(save).toHaveTextContent(`Enregistrer les décisions sélectionnées (${PAIRS.filter((p, i) => p.assessment.wellDocumented || i === 0).length})`));
    expect(wd).toBeGreaterThan(2);

    // confirmation summary, then one request; one row fails (a record changed), the others leave the queue without a page reload
    fireEvent.click(save);
    const dlg = await screen.findByTestId('dup-confirm');
    expect(dlg).toHaveTextContent(/Établissements distincts \(les deux fiches sont conservées\)/);
    const stale = PAIRS.find((p) => p.assessment.wellDocumented && p.A.nom.includes('Neewiller'));
    api.apiClient.admin.decideDuplicates.mockImplementation(async (items) => {
      served = PAIRS.filter((p) => p.key === stale.key || !items.some((i) => `${i.a}|${i.b}` === p.key));
      return { results: items.map((i) => (`${i.a}|${i.b}` === stale.key ? { key: stale.key, ok: false, status: 409, code: 'STALE_REVIEW' } : { key: `${i.a}|${i.b}`, ok: true })) };
    });
    fireEvent.click(within(dlg).getByTestId('dup-confirm-save'));
    await waitFor(() => expect(api.apiClient.admin.decideDuplicates).toHaveBeenCalledTimes(1));
    const sent = api.apiClient.admin.decideDuplicates.mock.calls[0][0];
    for (const i of sent) { expect(i.evidenceUrl).toMatch(/^https:\/\//); expect(i.note.length).toBeGreaterThan(10); expect(i.versionA).toMatch(/^[0-9a-f]{64}$/); expect(i.expectedDecisionId).toBeNull(); }
    expect(sent.some((i) => i.decision === 'SAME_ENTITY')).toBe(false);   // no well-documented « same » among these real pairs: nothing is held
    await waitFor(() => expect(screen.getByTestId('admin-duplicates-status')).toHaveTextContent(`${sent.length - 1} décision(s) enregistrée(s), 1 en échec.`));
    expect(api.apiClient.admin.getDuplicateRegister).toHaveBeenCalledTimes(2);   // reloaded in place
    await waitFor(() => expect(rows()).toHaveLength(1));   // the « en échec » filter shows the failed row with its reason
    expect(within(rows()[0]).getByTestId('dup-row-error')).toHaveTextContent('Une des fiches a changé depuis votre lecture');

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('the compare drawer opens beside the list, takes the focus, and Escape gives it back to the row', async () => {
    api.apiClient.admin.getDuplicateRegister.mockResolvedValue({ total: PAIRS.length, pairs: PAIRS });
    api.apiClient.admin.getDuplicates.mockImplementation(async (a, b) => ({ a: { id: a, nom: 'A', content: [{ field: 'nom', value: 'A' }], version: V('1') }, b: { id: b, nom: 'B', content: [], version: V('2') }, decisions: [] }));
    render(createElement(AdminDuplicates));
    await waitFor(() => expect(rows().length).toBeGreaterThan(1));
    rows()[0].focus();
    fireEvent.keyDown(rows()[0], { key: 'c' });
    const drawer = await screen.findByTestId('admin-duplicate-pair');
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Comparer les deux fiches'));
    expect(drawer).toHaveAttribute('role', 'dialog');
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('admin-duplicate-pair')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(rows()[0]));
  });

  it('the decision toolbar and the compare drawer stay above the cookie banner (WCAG 2.2 SC 2.4.11: --cookie-banner-offset)', async () => {
    api.apiClient.admin.getDuplicateRegister.mockResolvedValue({ total: PAIRS.length, pairs: PAIRS });
    render(createElement(AdminDuplicates));
    await waitFor(() => expect(rows().length).toBeGreaterThan(1));
    expect(screen.getByTestId('dup-toolbar').className).toContain('bottom-[var(--cookie-banner-offset,0px)]');
    expect(screen.getByTestId('dup-toolbar').className).not.toMatch(/(^|\s)bottom-0(\s|$)/);
    fireEvent.click(within(rows()[0]).getByTestId('dup-compare'));
    expect((await screen.findByTestId('admin-duplicate-pair')).className).toContain('bottom-[calc(4rem+var(--cookie-banner-offset,0px))]');
  });
});
