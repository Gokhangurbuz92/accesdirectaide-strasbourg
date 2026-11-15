// @vitest-environment jsdom
/**
 * A-17 — the person's thread panel (Mon Espace dossier page and passport page): the organisations' messages are shown and answered; a closed thread has no
 * composer; a failed read is said (never « no message »); a server refusal is shown as a translated sentence, never the raw server text.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ dossierThreads: vi.fn(), dossierThreadMessages: vi.fn(), sendDossierThreadMessage: vi.fn() }));
vi.mock('@/lib/citizenApi', () => ({ citizenApi: api }));
vi.mock('@/lib/crypto-messaging.js', () => ({ cryptoE2EE: { encrypt: async (text, id) => `enc(${id}):${text}`, decrypt: async (blob, id) => { if (!blob.startsWith(`enc(${id}):`)) throw new Error('bad'); return blob.slice(`enc(${id}):`.length); } } }));
const { default: DossierThreads } = await import('../../src/components/sharing/DossierThreads.jsx');
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const AT = '2026-11-10T10:00:00.000Z';

describe('A-17 dossier threads panel', () => {
  it('shows the organisation message, sends the answer through the owner API and reloads', async () => {
    api.dossierThreads.mockResolvedValue({ threads: [{ id: 't1', structureName: 'CCAS Exemple', lastMessageAt: AT, closed: false }] });
    api.dossierThreadMessages.mockResolvedValue({ items: [{ id: 'm1', sender: 'PRO', encryptedContent: 'enc(share-1):Bonjour, il manque un justificatif.', createdAt: AT }] });
    api.sendDossierThreadMessage.mockResolvedValue({ ok: true });
    render(createElement(DossierThreads, { shareId: 'share-1' }));
    expect((await screen.findByTestId('thread-message-pro')).textContent).toContain('Bonjour, il manque un justificatif.');
    expect(api.dossierThreads).toHaveBeenCalledWith('share-1', '');                       // account page: no secret in the browser
    fireEvent.change(screen.getByLabelText('Votre réponse à CCAS Exemple'), { target: { value: '  Je l’envoie demain.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    await waitFor(() => expect(api.sendDossierThreadMessage).toHaveBeenCalledWith('share-1', 't1', 'enc(share-1):Je l’envoie demain.', ''));
    expect(await screen.findByTestId('thread-sent')).toBeTruthy();
    expect(api.dossierThreads).toHaveBeenCalledTimes(2);
  });

  it('passport page: the owner secret is passed on every call', async () => {
    api.dossierThreads.mockResolvedValue({ threads: [{ id: 't1', structureName: 'CCAS Exemple', lastMessageAt: AT, closed: false }] });
    api.dossierThreadMessages.mockResolvedValue({ items: [] });
    render(createElement(DossierThreads, { shareId: 'share-1', ownerSecret: 'owner-secret' }));
    await screen.findByTestId('dossier-thread');
    expect(api.dossierThreads).toHaveBeenCalledWith('share-1', 'owner-secret');
    expect(api.dossierThreadMessages).toHaveBeenCalledWith('share-1', 't1', 'owner-secret');
  });

  it('a closed thread stays readable and has no composer', async () => {
    api.dossierThreads.mockResolvedValue({ threads: [{ id: 't1', structureName: 'CCAS Exemple', lastMessageAt: AT, closed: true }] });
    api.dossierThreadMessages.mockResolvedValue({ items: [{ id: 'm1', sender: 'SHARER', encryptedContent: 'enc(share-1):Merci.', createdAt: AT }] });
    render(createElement(DossierThreads, { shareId: 'share-1' }));
    expect((await screen.findByTestId('thread-message-mine')).textContent).toContain('Merci.');
    expect(screen.getByTestId('thread-closed')).toBeTruthy();
    expect(screen.queryByTestId('thread-reply')).toBeNull();
  });

  it('no thread: says so; a failed read is an alert, not « no message »', async () => {
    api.dossierThreads.mockResolvedValueOnce({ threads: [] });
    render(createElement(DossierThreads, { shareId: 'share-1' }));
    expect(await screen.findByTestId('threads-empty')).toBeTruthy();
    cleanup();
    api.dossierThreads.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    render(createElement(DossierThreads, { shareId: 'share-1' }));
    expect((await screen.findByTestId('threads-failed')).getAttribute('role')).toBe('alert');
    expect(screen.queryByTestId('threads-empty')).toBeNull();
  });

  it('a refusal is shown as the interface sentence for its status, never the raw server message', async () => {
    api.dossierThreads.mockResolvedValue({ threads: [{ id: 't1', structureName: 'CCAS Exemple', lastMessageAt: AT, closed: false }] });
    api.dossierThreadMessages.mockResolvedValue({ items: [] });
    api.sendDossierThreadMessage.mockRejectedValue(Object.assign(new Error('RAW SERVER TEXT'), { status: 413 }));
    render(createElement(DossierThreads, { shareId: 'share-1' }));
    fireEvent.change(await screen.findByTestId('thread-reply'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('thread-send'));
    const alert = await screen.findByTestId('thread-problem');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toBe('Ce message est trop long. Raccourcissez-le, puis réessayez.');
    expect(document.body.textContent).not.toContain('RAW SERVER TEXT');
  });
});
