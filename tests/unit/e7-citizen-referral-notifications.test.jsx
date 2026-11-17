// @vitest-environment jsdom
/**
 * E7 — the citizen notification centre shows the referral items the server derives (api/_services/citizen-inbox.js): a consent request, an answer of the
 * receiving organisation, a cancellation / expiry. Each is a label and a link to « Mes orientations » — no name, no text — and every one of the six
 * languages has the three labels (French: the component's own text).
 */
import fs from 'node:fs';
import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/citizenApi', () => ({ citizenApi: { notifications: vi.fn(async () => ({ unread: 3, seenAt: null, notifications: [
  { id: 'n1', kind: 'REFERRAL_DECISION_NEEDED', at: '2026-11-17T09:00:00.000Z', link: '/compte/orientations', unread: true },
  { id: 'n2', kind: 'REFERRAL_ANSWER', at: '2026-11-16T09:00:00.000Z', link: '/compte/orientations', unread: true },
  { id: 'n3', kind: 'REFERRAL_ENDED', at: '2026-11-15T09:00:00.000Z', link: '/compte/orientations', unread: true },
] })), markNotificationsRead: vi.fn() } }));

const { default: NotificationCenter } = await import('../../src/components/account/NotificationCenter.jsx');
const { INBOX_KINDS } = await import('../../api/_services/citizen-inbox.js');

afterEach(cleanup);

describe('E7 referral items of the citizen notification centre', () => {
  it('renders the three referral kinds as links to the orientations page', async () => {
    render(createElement(MemoryRouter, null, createElement(NotificationCenter)));
    await waitFor(() => expect(screen.getAllByTestId('notification-item')).toHaveLength(3));
    const kinds = screen.getAllByTestId('notification-item').map((li) => li.getAttribute('data-kind'));
    expect(kinds).toEqual(['REFERRAL_DECISION_NEEDED', 'REFERRAL_ANSWER', 'REFERRAL_ENDED']);
    for (const a of screen.getAllByRole('link')) expect(a.getAttribute('href')).toBe('/compte/orientations');
  });
  it('the server lists the kinds, and every interface language has their labels', () => {
    for (const k of ['REFERRAL_DECISION_NEEDED', 'REFERRAL_ANSWER', 'REFERRAL_ENDED']) expect(INBOX_KINDS).toContain(k);
    for (const lang of ['en', 'tr', 'ar', 'de', 'uk']) {
      const json = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/compte.json`, 'utf8'));
      for (const key of ['referral_decision_needed', 'referral_answer', 'referral_ended']) expect(json[`notifications.kind.${key}`], `${lang} ${key}`).toMatch(/\S/);
    }
  });
});
