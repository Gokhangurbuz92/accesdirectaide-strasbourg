// @vitest-environment jsdom
/**
 * R3 — in-thread « Signaler » on appointment conversations: the button appears only on the OTHER party's messages (citizen and professional threads),
 * the form is an accessible disclosure (aria-expanded / aria-controls, fieldset + legend, focus moved in), only a category from the closed list is sent
 * (never the message text), and the service files it in the existing ContentReport flow with a fixed description and no message content.
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pro = vi.hoisted(() => ({ getConversation: vi.fn(), sendMessage: vi.fn(), downloadAttachment: vi.fn(), reportMessage: vi.fn() }));
vi.mock('@/api/rdv-messaging-client', () => ({ rdvMessagingClient: { pro }, messagingErrorText: (_e, fallback) => fallback }));

import ProMessageThread from '../../src/pages/pro/MessageThread.jsx';
import { MESSAGE_REPORT_CATEGORIES, fileMessageReport, messageReportText } from '../../api/_services/message-report.js';
import { REPORT_CATEGORIES } from '../../src/components/Messaging/MessageReportButton.jsx';

afterEach(() => { cleanup(); pro.getConversation.mockReset(); pro.reportMessage.mockReset(); });
const page = () => render(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
  createElement(MemoryRouter, { initialEntries: ['/pro/messages/c1'] }, createElement(Routes, null, createElement(Route, { path: '/pro/messages/:conversationId', element: createElement(ProMessageThread) })))));
const thread = { item: { id: 'c1', structure: { name: 'Structure fictive' }, appointment: { startsAt: '2026-11-20T09:00:00.000Z' }, attachmentsAllowed: false,
  messages: [
    { id: 'm-user', senderType: 'USER', body: 'Bonjour, texte de la personne', createdAt: '2026-11-19T09:00:00.000Z' },
    { id: 'm-pro', senderType: 'PRO', body: 'Réponse de la structure', createdAt: '2026-11-19T10:00:00.000Z' },
  ] } };

describe('R3 in-thread report — professional thread UI', () => {
  it('only on the other party\'s message; accessible disclosure; sends the category only', async () => {
    pro.getConversation.mockResolvedValue(thread);
    pro.reportMessage.mockResolvedValue({ ok: true, reportId: 'r1' });
    page();
    const box = await screen.findByTestId('pro-message-report');
    expect(box.getAttribute('data-message-id')).toBe('m-user');
    expect(globalThis.document.querySelectorAll('[data-testid="pro-message-report"]').length).toBe(1);   // not on the structure's own message
    const button = box.querySelector('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toMatch(/Signaler/);
    expect(button.querySelector('.sr-only').textContent).toMatch(/le message du/);
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const form = globalThis.document.getElementById(button.getAttribute('aria-controls'));
    expect(form).not.toBeNull();
    expect(form.querySelector('fieldset legend').textContent).toMatch(/Pourquoi/);
    expect(globalThis.document.activeElement).toBe(form.querySelector('legend'));
    const radios = form.querySelectorAll('input[type="radio"]');
    expect(radios.length).toBe(5);
    for (const r of radios) expect(form.querySelector(`label[for="${r.id}"]`)).not.toBeNull();
    const submit = form.querySelector('button[type="submit"]');
    expect(submit.disabled).toBe(true);
    fireEvent.click(radios[0]);
    fireEvent.submit(form);
    await vi.waitFor(() => expect(pro.reportMessage).toHaveBeenCalledWith('c1', 'm-user', 'ABUSIVE'));
    expect(await screen.findByText(/le message a été signalé/)).toBeTruthy();
    expect(box.querySelector('[role="status"]').getAttribute('aria-live')).toBe('polite');
  });
  it('the citizen thread uses the same component on the structure\'s messages only', () => {
    const src = readFileSync('src/pages/CompteMessageThread.jsx', 'utf8');
    expect(src).toMatch(/\{mine \? null : <MessageReportButton/);
    expect(src).toMatch(/rdvMessagingClient\.user\.reportMessage/);
  });
});

describe('R3 in-thread report — service (existing ContentReport flow)', () => {
  const fakeDb = (row) => {
    const inserted = [];
    return { inserted, select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
      insert: () => ({ values: async (v) => { inserted.push(v); } }) };
  };
  const conversation = { id: 'c1', structureId: 's1' };
  it('the UI and the service share the closed category list', () => {
    expect(REPORT_CATEGORIES).toEqual([...MESSAGE_REPORT_CATEGORIES]);
  });
  it('files a STRUCTURE / AUTRE report with a fixed description, no message text, no e-mail', async () => {
    const db = fakeDb({ id: 'm-user', senderType: 'USER' });
    const out = await fileMessageReport({ side: 'PRO', conversation, messageId: 'm-user', category: 'SPAM' }, { db });
    expect(out.ok).toBe(true);
    expect(db.inserted[0]).toMatchObject({ contentType: 'STRUCTURE', contentId: 's1', reason: 'AUTRE', reporterEmail: null, pageUrl: null, status: 'NEW' });
    expect(db.inserted[0].message).toBe(messageReportText({ side: 'PRO', conversationId: 'c1', messageId: 'm-user', category: 'SPAM' }));
    expect(db.inserted[0].message).not.toMatch(/Bonjour/);
  });
  it('refuses an unknown category, a message of another conversation and one\'s own message', async () => {
    expect(await fileMessageReport({ side: 'USER', conversation, messageId: 'm1', category: 'FREE TEXT' }, { db: fakeDb(null) })).toMatchObject({ ok: false, status: 400, error: 'INVALID_CATEGORY' });
    expect(await fileMessageReport({ side: 'USER', conversation, messageId: 'm1', category: 'OTHER' }, { db: fakeDb(null) })).toMatchObject({ ok: false, status: 404 });
    expect(await fileMessageReport({ side: 'USER', conversation, messageId: 'm1', category: 'OTHER' }, { db: fakeDb({ id: 'm1', senderType: 'USER' }) })).toMatchObject({ ok: false, error: 'OWN_MESSAGE' });
    expect(await fileMessageReport({ side: 'USER', conversation, messageId: '../x', category: 'OTHER' }, { db: fakeDb(null) })).toMatchObject({ ok: false, error: 'INVALID_MESSAGE' });
  });
  it('the handlers route POST …/report before the send path, behind the same ownership and service checks', () => {
    const citizen = readFileSync('api/_handlers/messages.js', 'utf8');
    const prof = readFileSync('api/_handlers/pro/messages-conversations.js', 'utf8');
    expect(citizen).toMatch(/segments\[2\] === 'report'/);
    expect(prof).toMatch(/segments\[1\] === 'report'/);
    for (const s of [citizen, prof]) expect(s).toMatch(/fileMessageReport\(\{ side: '(USER|PRO)'/);
  });
});
