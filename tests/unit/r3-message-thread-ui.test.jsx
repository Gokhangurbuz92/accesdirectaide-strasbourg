// @vitest-environment jsdom
/**
 * R3 — the professional thread follows what the server serves: no file picker when attachments are closed (messaging.attachments, HDS), a plain
 * sentence instead; no form at all for a conversation this service does not serve (503 CAPABILITY_NOT_OPEN); the minimisation hint is the textarea's
 * description (RGAA: aria-describedby).
 */
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ getConversation: vi.fn(), sendMessage: vi.fn(), downloadAttachment: vi.fn() }));
vi.mock('@/api/rdv-messaging-client', () => ({ rdvMessagingClient: { pro: client }, messagingErrorText: (_e, fallback) => fallback }));

import ProMessageThread from '../../src/pages/pro/MessageThread.jsx';

afterEach(() => { cleanup(); client.getConversation.mockReset(); });
const page = () => render(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
  createElement(MemoryRouter, { initialEntries: ['/pro/messages/c1'] }, createElement(Routes, null, createElement(Route, { path: '/pro/messages/:conversationId', element: createElement(ProMessageThread) })))));
const item = (extra) => ({ item: { id: 'c1', structure: { name: 'Structure fictive' }, appointment: { startsAt: '2026-11-20T09:00:00.000Z' }, messages: [], ...extra } });

describe('R3 professional thread', () => {
  it('attachments closed: a sentence instead of the picker; the hint describes the textarea', async () => {
    client.getConversation.mockResolvedValue(item({ attachmentsAllowed: false }));
    page();
    expect(await screen.findByTestId('pro-attach-closed')).toBeTruthy();
    expect(globalThis.document.getElementById('pro-attach')).toBeNull();
    expect(globalThis.document.getElementById('pro-message-body').getAttribute('aria-describedby')).toBe('pro-message-privacy-hint');
    expect(globalThis.document.getElementById('pro-message-privacy-hint').textContent).toMatch(/santé/);
  });
  it('attachments open (HDS): the picker is offered', async () => {
    client.getConversation.mockResolvedValue(item({ attachmentsAllowed: true }));
    page();
    await screen.findByTestId('pro-message-thread-page');
    await vi.waitFor(() => expect(client.getConversation).toHaveBeenCalled());
    await vi.waitFor(() => expect(globalThis.document.querySelector('[data-testid="pro-attach-closed"]')).toBeNull());
    await vi.waitFor(() => expect(globalThis.document.querySelector('#pro-attach, input[type="file"]')).not.toBeNull());
  });
  it('a conversation the service does not serve: no form', async () => {
    client.getConversation.mockRejectedValue(Object.assign(new Error('CAPABILITY_NOT_OPEN'), { status: 503, payload: { error: 'CAPABILITY_NOT_OPEN', code: 'CAPABILITY_NOT_OPEN' } }));
    page();
    expect(globalThis.document.getElementById('pro-message-body')).not.toBeNull();   // while loading, the form is there
    expect(await screen.findByText('Conversation introuvable.')).toBeTruthy();   // the refusal is said (the client turns the code into a sentence)
    expect(globalThis.document.getElementById('pro-message-body')).toBeNull();
  });
});
