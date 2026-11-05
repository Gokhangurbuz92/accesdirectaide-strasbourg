// @vitest-environment jsdom
/**
 * R46 / C05 — the verifier's page « Représentants légaux : vérification renforcée » (/admin/representants-legaux). The API client is stubbed: the server rules
 * (MFA session, reason 10–500, AuditLog, POLICY_PENDING fail-closed) are tested on PostgreSQL in tests/integration/r46-citizen-db.test.js and in the browser
 * against the real API in e2e-r46/finish. No JSX in the test body (the repo ESLint config does not parse JSX in tests/).
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const k5 = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ apiClient: { admin: { k5 } } }));
const { default: AdminGuardianships } = await import('../../src/pages/admin/k5/Guardianships.jsx');
const { validate } = await import('../../src/pages/admin/k5/guardians-validate.js');
afterEach(() => { cleanup(); k5.mockReset(); });

const T = (_k, d, o = {}) => String(d).replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n]));
const PENDING = [{ id: 'g-synth-1', createdAt: '2026-10-01T10:00:00.000Z' }, { id: 'g-synth-2', createdAt: '2026-10-02T10:00:00.000Z' }];
const refusal = (status, error, message) => Object.assign(new Error(message || error), { status, payload: { error, message } });

describe('R46 C05 guardian verification — pure validation', () => {
  it('needs a link, a method and a 10–500 character plain-text reason', () => {
    expect(Object.keys(validate({ id: '', method: '', reason: 'court' }, T)).sort()).toEqual(['id', 'method', 'reason']);
    expect(validate({ id: 'g', method: 'M', reason: 'x'.repeat(501) }, T).reason).toMatch(/de 10 à 500 caractères \(actuellement 501\)/);
    expect(validate({ id: 'g', method: 'M', reason: 'Attestation <b>vue</b> en LAB' }, T).reason).toMatch(/< ou >/);
    expect(validate({ id: 'g', method: 'M', reason: '  Attestation synthétique vue  ' }, T)).toEqual({});
  });
});

describe('R46 C05 guardian verification — page', () => {
  it('policy pending: says so honestly, lists the waiting links (identifier and date only), offers no record form', async () => {
    k5.mockResolvedValue({ pending: PENDING, policy: { strongVerification: 'POLICY_PENDING', methods: [] } });
    render(createElement(AdminGuardianships));
    const policy = await screen.findByTestId('admin-guardians-policy');
    expect(policy).toHaveAttribute('data-state', 'POLICY_PENDING');
    expect(policy).toHaveTextContent('Aucun lien ne peut être vérifié');
    expect(k5).toHaveBeenCalledWith('guardianships', { action: 'list' });
    expect(screen.getByTestId('admin-guardians-count')).toHaveTextContent('2 lien(s) en attente.');
    expect(screen.getByTestId('admin-guardians-list')).toHaveTextContent('Lien g-synth-1');
    expect(screen.queryByTestId('admin-guardians-form')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Représentants légaux : vérification renforcée');
  });

  it('nothing waiting: an empty state, no form', async () => {
    k5.mockResolvedValue({ pending: [], policy: { strongVerification: 'CONFIGURED', methods: ['PROFESSIONAL_ATTESTATION'] } });
    render(createElement(AdminGuardianships));
    expect(await screen.findByTestId('admin-guardians-none')).toHaveTextContent('Aucun lien n’attend de vérification renforcée.');
    expect(screen.queryByTestId('admin-guardians-form')).toBeNull();
  });

  it('an empty submission shows a focused error summary and errors linked to each field; nothing is sent', async () => {
    k5.mockResolvedValue({ pending: PENDING, policy: { strongVerification: 'CONFIGURED', methods: ['PROFESSIONAL_ATTESTATION', 'IDENTITY_DOCUMENT_CHECK'] } });
    render(createElement(AdminGuardianships));
    await screen.findByTestId('admin-guardians-form');
    expect(within(screen.getByTestId('admin-guardians-methods')).getAllByRole('listitem')).toHaveLength(2);
    await act(async () => { fireEvent.click(screen.getByTestId('admin-guardians-submit')); });
    const summary = screen.getByTestId('admin-guardians-summary');
    expect(summary).toHaveAttribute('role', 'alert');
    expect(within(summary).getAllByRole('link')).toHaveLength(3);
    const method = screen.getByLabelText(/Méthode utilisée/);
    expect(method).toHaveAttribute('aria-invalid', 'true');
    expect(method.ownerDocument.getElementById(method.getAttribute('aria-describedby'))).toHaveTextContent('Choisissez la méthode utilisée.');
    const reason = screen.getByLabelText(/Motif : comment la vérification a été faite/);
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(reason.getAttribute('aria-describedby').split(' ').map((id) => reason.ownerDocument.getElementById(id)?.textContent).join(' ')).toMatch(/actuellement 0/);
    expect(k5).toHaveBeenCalledTimes(1);   // the list only
  });

  it('a valid record sends the link, the method and the trimmed reason, then says what happened and reloads', async () => {
    k5.mockImplementation(async (_p, body) => (body.action === 'record' ? { guardianship: { id: body.id, status: 'VERIFIED_STRONG' } }
      : { pending: PENDING, policy: { strongVerification: 'CONFIGURED', methods: ['PROFESSIONAL_ATTESTATION'] } }));
    render(createElement(AdminGuardianships));
    fireEvent.click(await screen.findByLabelText(/Lien g-synth-2/));
    fireEvent.change(screen.getByLabelText(/Méthode utilisée/), { target: { value: 'PROFESSIONAL_ATTESTATION' } });
    fireEvent.change(screen.getByLabelText(/Motif : comment/), { target: { value: '  Attestation synthétique vérifiée en LAB  ' } });
    await act(async () => { fireEvent.click(screen.getByTestId('admin-guardians-submit')); });
    await waitFor(() => expect(screen.getByTestId('admin-guardians-done')).toHaveTextContent('Vérification renforcée enregistrée'));
    expect(k5).toHaveBeenCalledWith('guardianships', { action: 'record', id: 'g-synth-2', method: 'PROFESSIONAL_ATTESTATION', reason: 'Attestation synthétique vérifiée en LAB' });
    expect(k5.mock.calls.filter((c) => c[1].action === 'list')).toHaveLength(2);
  });

  it('a server refusal is explained in the page language (POLICY_PENDING, INVALID_STATE)', async () => {
    let answer = refusal(409, 'POLICY_PENDING');
    k5.mockImplementation(async (_p, body) => { if (body.action === 'record') throw answer; return { pending: PENDING, policy: { strongVerification: 'CONFIGURED', methods: ['PROFESSIONAL_ATTESTATION'] } }; });
    render(createElement(AdminGuardianships));
    const fill = async () => {
      fireEvent.click(await screen.findByLabelText(/Lien g-synth-1/));
      fireEvent.change(screen.getByLabelText(/Méthode utilisée/), { target: { value: 'PROFESSIONAL_ATTESTATION' } });
      fireEvent.change(screen.getByLabelText(/Motif : comment/), { target: { value: 'Attestation synthétique vérifiée' } });
      await act(async () => { fireEvent.click(screen.getByTestId('admin-guardians-submit')); });
    };
    await fill();
    expect(await screen.findByTestId('admin-guardians-problem')).toHaveTextContent('pas encore fixée');
    answer = refusal(409, 'INVALID_STATE');
    await fill();
    expect(await screen.findByTestId('admin-guardians-problem')).toHaveTextContent('n’attend plus de vérification renforcée');
  });

  it('without an MFA session the list is refused with an explanation and a retry', async () => {
    k5.mockRejectedValue(refusal(403, 'HUMAN_MFA_SESSION_REQUIRED', 'Cette action demande une session administrateur nominative avec MFA.'));
    render(createElement(AdminGuardianships));
    const err = await screen.findByTestId('admin-guardians-error');
    expect(err).toHaveTextContent('session administrateur nominative avec MFA');
    expect(within(err).getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });
});
