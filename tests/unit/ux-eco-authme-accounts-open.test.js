// @vitest-environment jsdom
/**
 * UX ecosystem (2026-11-12) — rdvMessagingClient.authMe() answered « anonymous » for EVERY public-beta build (R29), also once the « accounts » surface is
 * opened: a signed-in person was sent to the sign-in page from /compte/messages and /compte/parametres. It now stays anonymous without a request only while
 * accounts are closed, and asks the server once they are open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const B = vi.hoisted(() => ({ open: false }));
vi.mock('@/config/env', async (orig) => { const m = await orig(); return { ...m, frontendEnv: { ...m.frontendEnv, flags: { ...m.frontendEnv.flags, publicBeta: true } } }; });
vi.mock('@/lib/publicBeta', async (orig) => ({ ...(await orig()), accountEntriesShown: () => B.open }));

import { rdvMessagingClient } from '../../src/api/rdv-messaging-client.js';

afterEach(() => { vi.unstubAllGlobals(); B.open = false; });

describe('UX ecosystem: authMe follows the accounts surface', () => {
  it('accounts closed in the beta: anonymous, no request', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(await rdvMessagingClient.authMe()).toEqual({ authenticated: false, session: null });
    expect(f).not.toHaveBeenCalled();
  });
  it('accounts opened: the server says who is signed in', async () => {
    B.open = true;
    const f = vi.fn(async () => new Response(JSON.stringify({ authenticated: true, session: { kind: 'user' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', f);
    const me = await rdvMessagingClient.authMe();
    expect(String(f.mock.calls[0][0])).toContain('/api/auth/me');
    expect(me.session.kind).toBe('user');
  });
});
