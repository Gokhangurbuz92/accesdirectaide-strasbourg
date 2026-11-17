// @vitest-environment jsdom
/**
 * RECON Pro 2026-11-15 — A11 (interface), A12, A25.
 *  A11  a notice opens the record it is about; its title follows the interface language (stored French text only as a fallback, marked as French)
 *  A12  the time of a notice is 12 px slate-600 (AA), a read notice is not dimmed; unread is said in words
 *  A25  a case note shows its author
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationCenter from '../../src/components/NotificationCenter.jsx';
import { notificationPath, notificationView } from '../../src/lib/pro-notification-view.js';
import { notificationPath as serverPath } from '../../api/_services/pro-notifications.js';
import { noteAuthor } from '../../src/lib/pro-case-notes.js';

const t = (key, fallback) => (typeof fallback === 'string' ? `[${key}]` : key);
const tFr = (key, fallback, vars) => (typeof fallback === 'string' ? fallback.replace('{{author}}', vars?.author ?? '') : key);

describe('A11 notificationView', () => {
  it('the path comes from the stored identifiers, the same on the server (e-mail) and in the interface', () => {
    for (const [type, metadata] of [['referral_received', { referralId: 'r1' }], ['case_mention', { caseId: 'c1' }], ['rdv_rescheduled', { appointmentId: 'a1' }], ['message_received', { appointmentId: 'a1', conversationId: 'conv1' }],
      ['structure_proposal_decided', { proposalId: 'p1' }], ['team_role_change', {}], ['case_handover', {}], ['NEW_AIDE', { aideId: 'x' }], ['case_assigned', { caseId: '//evil.example' }]]) {
      expect(notificationPath({ type, metadata })).toBe(serverPath(type, metadata));
    }
    expect(notificationPath({ type: 'referral_received', metadata: { referralId: 'r1' } })).toBe('/pro/orientations/r1');
  });
  it('another language than French: the title comes from the type; a fixed message is translated; a free message stays French and is marked', () => {
    const v = notificationView(t, 'en', { type: 'message_received', title: 'Nouveau message d’une personne', message: 'Une personne vous a écrit au sujet d’un rendez-vous.', metadata: { appointmentId: 'a1', conversationId: 'conv1' } });
    expect(v).toMatchObject({ title: '[pro:notifications.types.message_received]', message: '[pro:notifications.bodies.message_received]', path: '/pro/messages/conv1' });
    expect(v.titleLang).toBeUndefined(); expect(v.messageLang).toBeUndefined();
    const free = notificationView(t, 'de', { type: 'rdv_rescheduled', title: 'Rendez-vous déplacé par la personne', message: 'Un rendez-vous a été déplacé.', metadata: {} });
    expect(free.title).toBe('[pro:notifications.types.rdv_rescheduled]');
    expect(free).toMatchObject({ message: 'Un rendez-vous a été déplacé.', messageLang: 'fr' });
    expect(notificationView(t, 'tr', { type: 'structure_proposal_decided', title: 'x', message: 'y', metadata: { kind: 'REJECTED' } }).message).toBe('[pro:notifications.bodies.proposal_rejected]');
    const unknown = notificationView(t, 'uk', { type: 'legacy_type', title: 'Ancien titre', message: '' });
    expect(unknown).toMatchObject({ title: 'Ancien titre', titleLang: 'fr' });
  });
  it('French keeps the stored text (it can carry the time or who acted)', () => {
    const v = notificationView(t, 'fr', { type: 'rdv_new', title: 'RDV demain à 14:00', message: 'Vous avez un rendez-vous prévu demain.' });
    expect(v).toMatchObject({ title: 'RDV demain à 14:00', message: 'Vous avez un rendez-vous prévu demain.' });
    expect(v.titleLang).toBeUndefined();
  });
});

describe('A11 / A12 NotificationCenter', () => {
  beforeEach(() => { globalThis.localStorage.setItem('pro_token', 't'); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); globalThis.localStorage.removeItem('pro_token'); });
  const Where = () => createElement('p', { 'data-testid': 'where' }, useLocation().pathname);
  const open = async (notifications) => {
    const fetchMock = vi.fn(async (url, init) => ({ ok: true, json: async () => (init?.method === 'PATCH' ? { ok: true } : String(url).includes('unread-count') ? { messages: 7 } : { notifications, unreadCount: notifications.filter((n) => !n.readAt).length }) }));
    vi.stubGlobal('fetch', fetchMock);
    render(createElement(MemoryRouter, { initialEntries: ['/pro/dashboard'] }, createElement(NotificationCenter), createElement(Routes, null, createElement(Route, { path: '*', element: createElement(Where) }))));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await screen.findAllByTestId('pro-notification-item');
    return fetchMock;
  };
  const NOTICES = [
    { id: 'n1', type: 'referral_received', title: 'Nouvelle orientation reçue', message: 'Une orientation attend votre réponse.', readAt: null, createdAt: new Date().toISOString(), metadata: { referralId: 'ref-1' } },
    { id: 'n2', type: 'case_assigned', title: 'Un dossier vous a été attribué', message: 'Un dossier vous a été attribué dans votre file.', readAt: new Date().toISOString(), createdAt: new Date().toISOString(), metadata: { caseId: 'case-9' } },
  ];

  it('A12: the time is text-xs slate-600 (no 9 px slate-400), a read notice is not dimmed, unread is spoken', async () => {
    await open(NOTICES);
    for (const el of screen.getAllByTestId('pro-notification-time')) {
      expect(el.className).toMatch(/\btext-xs\b/); expect(el.className).toMatch(/\btext-slate-600\b/);
      expect(el.className).not.toMatch(/text-\[9px\]|text-slate-400/);
    }
    const [unread, read] = screen.getAllByTestId('pro-notification-item');
    expect(read.className).not.toMatch(/opacity-/);
    expect(unread.textContent).toContain('Non lue');
    expect(read.textContent).not.toContain('Non lue');
    expect(globalThis.document.body.innerHTML).not.toMatch(/text-\[(9|10|11)px\] text-slate-(400|500)/);
  });

  it('A11: a click opens the record (and marks an unread notice read); the bell counts notices only', async () => {
    const fetchMock = await open(NOTICES);
    expect(screen.getByRole('button', { name: /Notifications, 1 non lue/ })).toBeTruthy();   // not 1 + 7 conversation messages
    fireEvent.click(screen.getAllByTestId('pro-notification-item')[0]);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/pro/orientations/ref-1'));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH' && JSON.parse(init.body).ids[0] === 'n1')).toBe(true);
    expect(screen.queryByTestId('pro-notification-item')).toBeNull();
  });

  it('A11: a read notice still opens its record', async () => {
    await open(NOTICES);
    fireEvent.click(screen.getAllByTestId('pro-notification-item')[1]);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/pro/dossiers/case-9'));
  });
});

describe('A25 note author', () => {
  const members = [{ id: 'u1', email: 'alice@example.test' }, { id: 'u2', email: 'bob@example.test' }];
  it('resolves the author against the active members; a member who left is « compte inactif », never an id', () => {
    expect(noteAuthor('u2', members, tFr)).toBe('bob@example.test');
    expect(noteAuthor('u-gone', members, tFr)).toBe('compte inactif');
    expect(noteAuthor(null, members, tFr)).toBe('compte inactif');
  });
  it('the case page prints it next to each note', async () => {
    const src = (await import('node:fs')).readFileSync('src/pages/pro/Cases.jsx', 'utf8');
    expect(src).toMatch(/data-testid="pro-case-note-author">\{t\('pro:cases\.note_author', 'par \{\{author\}\}', \{ author: noteAuthor\(n\.authorId, data\.members, t\) \}\)\}/);
  });
});
