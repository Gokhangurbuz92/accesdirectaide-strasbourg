// @vitest-environment jsdom
/**
 * R12 (C11) — the opt-in history records searches and diagnostics too (before: only record views). Only for a signed-in person (no request for an anonymous
 * visitor); a diagnostic entry never carries the situation or the results.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const S = vi.hoisted(() => ({ session: null, added: [] }));
vi.mock('@/api/rdv-messaging-client', () => ({ rdvMessagingClient: { authMe: async () => ({ session: S.session }) } }));
vi.mock('@/lib/citizenApi', () => ({ citizenApi: { addHistory: async (e) => { S.added.push(e); return { ok: true }; } } }));
import useCitizenHistory, { __resetCitizenHistorySession } from '../../src/hooks/useCitizenHistory.js';

beforeEach(() => { S.added = []; __resetCitizenHistorySession(); });

describe('citizen history recording', () => {
  it('signed-in person: the entry is sent', async () => {
    S.session = { kind: 'user' };
    const { result } = renderHook(() => useCitizenHistory());
    await waitFor(() => { result.current({ kind: 'search', label: 'aide logement', ref: '/recherche?q=aide%20logement' }); expect(S.added).toHaveLength(1); });
    expect(S.added[0]).toEqual({ kind: 'search', label: 'aide logement', ref: '/recherche?q=aide%20logement' });
  });
  it('anonymous visitor: nothing is sent', async () => {
    S.session = null;
    const { result } = renderHook(() => useCitizenHistory());
    await new Promise((r) => setTimeout(r, 20));
    result.current({ kind: 'search', label: 'x' });
    expect(S.added).toHaveLength(0);
  });
  it('the search and diagnostic pages record; the diagnostic label is fixed (no situation, no results)', () => {
    expect(readFileSync('src/pages/Recherche.jsx', 'utf8')).toMatch(/recordHistory\(\{ kind: 'search'/);
    expect(readFileSync('src/pages/DiagnosticPage.jsx', 'utf8')).toMatch(/recordHistory\(\{ kind: 'diagnostic', label: 'Simulation de mes droits', ref: '\/diagnostic' \}\)/);
  });
});
