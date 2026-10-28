// @vitest-environment jsdom
/**
 * Regression (native run 20261017T115125Z-39fabe, B2 step "L"): the citizen keeps "Mon partage" open while the organization redeems the invitation.
 * The panel loaded its state once, so the invitation never became an active access and "Retirer l'accès de cette structure" never appeared.
 * The panel must pick the change up by itself (interval / focus), and must NOT poll while an action is running.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CitizenSharingPanel from '../../src/components/sharing/CitizenSharingPanel.jsx';

const PENDING = { expiresAt: null, grants: [], invites: [{ id: 'inv1', status: 'pending', structureName: 'CCAS Test', expiresAt: '2030-01-01T00:00:00Z' }] };
const GRANTED = { expiresAt: null, grants: [{ structureId: 's1', structureName: 'CCAS Test', grantedAt: '2030-01-01T00:00:00Z', purposes: ['PURP-06'], revoked: false }], invites: [] };

const panel = () => createElement(CitizenSharingPanel, { shareId: 'd1', ownerSecret: 'owner-secret-x' });   // no JSX: the repo ESLint config does not parse JSX in tests/
let current; let calls;
beforeEach(() => {
  vi.useFakeTimers();
  calls = []; current = PENDING;
  globalThis.document.cookie = '__csrf=qa-csrf-token; path=/';   // R12B: the panel's first call bootstraps the CSRF cookie (csrfFetch); here it is already present
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, action: body.action, owner: init.headers['X-Share-Owner-Secret'] });
    return { ok: true, status: 200, json: async () => current };
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('CitizenSharingPanel keeps itself current', () => {
  it('shows the withdraw control once the organization has redeemed (no manual reload)', async () => {
    render(panel());
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(screen.queryByRole('button', { name: /Retirer l.accès de cette structure/i })).toBeNull();
    expect(screen.getByText(/Invitation en attente/i)).toBeInTheDocument();
    current = GRANTED;                                                              // the organization redeems the invitation
    await act(async () => { await vi.advanceTimersByTimeAsync(8100); });
    expect(screen.getByRole('button', { name: /Retirer l.accès de cette structure/i })).toBeInTheDocument();
    expect(calls.every((c) => c.action === 'list' && c.owner === 'owner-secret-x')).toBe(true);     // read-only polling, owner header, nothing else
  });

  it('refreshes when the tab regains focus', async () => {
    render(panel());
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    current = GRANTED;
    await act(async () => { globalThis.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(50); });
    expect(screen.getByRole('button', { name: /Retirer l.accès de cette structure/i })).toBeInTheDocument();
  });

  it('stops polling after unmount', async () => {
    const { unmount } = render(panel());
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    unmount(); const n = calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(calls.length).toBe(n);
  });
});
