// @vitest-environment jsdom
/**
 * R12 (R01) — the 8 h professional session ends with a warning: ten minutes before, the time is shown with « Prolonger la session » (POST /api/pro/auth/refresh,
 * only on request); a refused extension says so; at the end the person is sent to the sign-in page (no silent loss of the page).
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const F = vi.hoisted(() => ({ calls: [], reply: null }));
vi.mock('@/lib/csrf', () => ({ csrfFetch: async (url, init) => { F.calls.push([url, init]); return F.reply; } }));

import ProSessionExpiry from '../../src/components/pro/ProSessionExpiry.jsx';
import { proTokenExpiry } from '../../src/lib/proToken.js';

const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const tokenExpiring = (ms) => `h.${b64({ exp: Math.floor(ms / 1000) })}.s`;
beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }); F.calls = []; F.reply = null; });
afterEach(() => { cleanup(); vi.useRealTimers(); globalThis.localStorage.clear(); });

describe('professional session expiry notice', () => {
  it('reads the expiry from the token payload; garbage is no expiry', () => {
    expect(proTokenExpiry(tokenExpiring(1_800_000_000_000))).toBe(1_800_000_000_000);
    expect(proTokenExpiry('nope')).toBeNull();
  });
  it('silent until ten minutes before; then the notice; « Prolonger » stores the new token and hides it', async () => {
    const now = Date.now(); globalThis.localStorage.setItem('pro_token', tokenExpiring(now + 15 * 60_000));
    render(createElement(ProSessionExpiry, { onExpired: () => {} }));
    expect(screen.queryByTestId('pro-session-expiry')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(6 * 60_000); });
    expect(screen.getByTestId('pro-session-expiry')).toHaveTextContent(/Votre session se termine à/);
    const fresh = tokenExpiring(Date.now() + 8 * 3600_000);
    F.reply = { ok: true, json: async () => ({ token: fresh }) };
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Prolonger la session' })); });
    expect(F.calls[0][0]).toBe('/api/pro/auth/refresh');
    expect(globalThis.localStorage.getItem('pro_token')).toBe(fresh);
    expect(screen.queryByTestId('pro-session-expiry')).toBeNull();
  });
  it('a refused extension says so; at the end onExpired is called', async () => {
    const now = Date.now(); globalThis.localStorage.setItem('pro_token', tokenExpiring(now + 5 * 60_000));
    const onExpired = vi.fn();
    render(createElement(ProSessionExpiry, { onExpired }));
    F.reply = { ok: false, json: async () => ({}) };
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Prolonger la session' })); });
    expect(screen.getByRole('alert')).toHaveTextContent(/n’a pas pu être prolongée/);
    await act(async () => { vi.advanceTimersByTime(6 * 60_000); });
    expect(onExpired).toHaveBeenCalled();
  });
});
