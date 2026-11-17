// @vitest-environment jsdom
/**
 * RECON Pro B02 (interface) — the conversations list says which threads the member has not read (in words), and says nothing when the database keeps no
 * read marker; the navigation hook shows a number only when the server gives one (null = unknown, never a made-up zero).
 */
import { createElement } from 'react';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ listConversations: vi.fn() }));
vi.mock('@/api/rdv-messaging-client', () => ({ rdvMessagingClient: { pro: client }, messagingErrorText: (_e, fallback) => fallback }));

import ProMessages from '../../src/pages/pro/Messages.jsx';
import { useProUnreadMessages } from '../../src/lib/use-pro-unread-messages.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); client.listConversations.mockReset(); globalThis.localStorage.removeItem('pro_token'); });
const page = () => render(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, createElement(MemoryRouter, null, createElement(ProMessages))));
const item = (id, extra) => ({ id, appointment: { serviceName: 'Accueil', startsAt: '2026-11-20T09:00:00.000Z' }, lastMessageAt: '2026-11-15T09:00:00.000Z', lastMessagePreview: 'Texte fictif', ...extra });

describe('B02 conversations list', () => {
  it('an unread thread carries « Non lu »; a read one does not', async () => {
    client.listConversations.mockResolvedValue({ items: [item('c1', { unread: true }), item('c2', { unread: false })], unreadAvailable: true });
    page();
    const rows = await screen.findAllByTestId('pro-conversation');
    expect(rows[0].getAttribute('data-unread')).toBe('true');
    expect(rows[0].textContent).toContain('Non lu');
    expect(rows[1].getAttribute('data-unread')).toBeNull();
    expect(rows[1].textContent).not.toContain('Non lu');
  });
  it('a database without the read marker: no flag at all (as before)', async () => {
    client.listConversations.mockResolvedValue({ items: [item('c1'), item('c2')], unreadAvailable: false });
    page();
    await screen.findAllByTestId('pro-conversation');
    expect(screen.queryByTestId('pro-conversation-unread')).toBeNull();
  });
});

describe('B02 navigation count', () => {
  const answer = (body) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
  it('the number of unread conversations when the server knows it', async () => {
    globalThis.localStorage.setItem('pro_token', 't'); answer({ messages: 3, notifications: 5 });
    const { result } = renderHook(() => useProUnreadMessages(true, '/pro/dashboard'));
    await waitFor(() => expect(result.current).toBe(3));
    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/pro/notifications/unread-count');
  });
  it('null when the server does not know (messages: null) or answers something else', async () => {
    globalThis.localStorage.setItem('pro_token', 't'); answer({ messages: null, notifications: 5 });
    const { result } = renderHook(() => useProUnreadMessages(true, '/pro/dashboard'));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
  it('nothing is asked while nobody is signed in', () => {
    answer({ messages: 3 });
    renderHook(() => useProUnreadMessages(false, '/pro/login'));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
