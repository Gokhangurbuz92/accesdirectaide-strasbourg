// @vitest-environment jsdom
/** C05 (R30) — the « Représentant légal » card: a minor can name a guardian; a guardian sees the request and can accept or refuse; adults without a request see nothing. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ listGuardians: vi.fn(), guardianAction: vi.fn() }));
vi.mock('@/lib/citizenApi', () => ({ citizenApi: api }));
const { default: GuardianLinks } = await import('../../src/components/account/GuardianLinks.jsx');
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('C05 guardian card', () => {
  it('a minor names a guardian; the neutral answer is shown; the policy notice says the link has no effect yet', async () => {
    api.listGuardians.mockResolvedValue({ guardianships: [], policy: { strongVerification: 'POLICY_PENDING' } });
    api.guardianAction.mockResolvedValue({ message: 'Si cette adresse correspond au compte d’un adulte, cette personne verra votre demande dans son espace.' });
    render(createElement(GuardianLinks, { ageBand: 'moins-de-18' }));
    expect((await screen.findByTestId('guardian-links')).textContent).toMatch(/le lien n’a donc pas encore d’effet/);
    fireEvent.change(screen.getByLabelText(/Adresse e-mail de votre représentant légal/), { target: { value: 'parent.one@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer la demande' }));
    await waitFor(() => expect(api.guardianAction).toHaveBeenCalledWith({ action: 'declare', guardianEmail: 'parent.one@example.test' }));
    expect(await screen.findByText(/cette personne verra votre demande/)).toBeTruthy();
  });
  it('a guardian sees the request and accepts it; no verification button while the policy is pending', async () => {
    api.listGuardians.mockResolvedValue({ guardianships: [{ id: 'g1', role: 'guardian', status: 'DECLARED', other: 'Camille', scopes: [] }], policy: { strongVerification: 'POLICY_PENDING' } });
    api.guardianAction.mockResolvedValue({ guardianship: { id: 'g1', status: 'EMAIL_VERIFIED' } });
    render(createElement(GuardianLinks, { ageBand: '25-59' }));
    fireEvent.click(await screen.findByRole('button', { name: 'J’accepte d’être son représentant légal' }));
    await waitFor(() => expect(api.guardianAction).toHaveBeenCalledWith({ action: 'confirm', id: 'g1' }));
    expect(screen.queryByRole('button', { name: 'Demander la vérification' })).toBeNull();
  });
  it('an adult without any request sees nothing', async () => {
    api.listGuardians.mockResolvedValue({ guardianships: [], policy: { strongVerification: 'POLICY_PENDING' } });
    const { container } = render(createElement(GuardianLinks, { ageBand: '25-59' }));
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
