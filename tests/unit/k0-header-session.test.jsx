// @vitest-environment jsdom
/**
 * K0 — the signed-in header says WHO is signed in (GET /api/auth/me returns the e-mail in `user`, the header read `session.user` and always showed "Mon compte"),
 * and logout goes through the CSRF-protected helper (it used to be refused with 403 while the page pretended the person had left).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/rdv-messaging-client.js', () => ({ rdvMessagingClient: { authMe: async () => ({ session: { kind: 'user', authType: 'user_session' }, user: { id: 'u1', email: 'alex.qa@example.test' } }) } }));

import { AuthHeaderActions } from '../../src/components/auth/AuthHeaderActions.jsx';

afterEach(cleanup);

describe('signed-in header', () => {
  it('shows the e-mail of the session (from the user block of /api/auth/me)', async () => {
    render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null, createElement(AuthHeaderActions))));
    expect(await screen.findByRole('button', { name: /alex\.qa@example\.test/ })).toBeInTheDocument();
  });
  it('logout uses the CSRF-protected helper, never a bare fetch', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/auth/AuthHeaderActions.jsx'), 'utf8');
    expect(src).toMatch(/logoutOnServer\(\)/);
    expect(src).not.toMatch(/fetch\('\/api\/auth\/logout'/);
    expect(readFileSync(resolve(process.cwd(), 'src/lib/citizenSession.js'), 'utf8')).toMatch(/csrfFetch\('\/api\/auth\/logout'/);
  });
});
