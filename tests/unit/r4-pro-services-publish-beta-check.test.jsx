// @vitest-environment jsdom
/**
 * R4.2 (owner test 24/11/2026): « Services RDV » said « Publication impossible : les rendez-vous ne sont pas encore installés » and locked the
 * « Publier la prise de RDV en ligne » box for every structure in Production, because the readiness check (a monitor route) is closed by the public beta
 * (503 PUBLIC_BETA_RESTRICTED). That refusal of the CHECK is not a failure of appointments (RdvLayout already ignores it); the server still validates
 * the publication (api/_handlers/pro/rdv-settings.js). A real « missing tables » answer still locks it. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Services from '../../src/pages/pro/Services.jsx';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ settings: { isPublished: false, bookingMode: 'presentiel' }, items: [], services: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const show = (rdvReadiness) => render(h(MemoryRouter, { initialEntries: ['/pro/rdv/services'] },
  h(Routes, null, h(Route, { path: '/pro/rdv', element: h(Outlet, { context: { user: { role: 'STRUCTURE_ADMIN' }, rdvReadiness } }) },
    h(Route, { path: 'services', element: h(Services) })))));

const publishBox = async () => {
  const card = await screen.findByTestId('pro-rdv-settings-card');
  await waitFor(() => expect(card.querySelector('input[type="checkbox"]')).not.toBeNull());
  return card.querySelector('input[type="checkbox"]');
};

describe('R4.2: publishing online booking is not locked by the beta-closed readiness check', () => {
  it('check closed by the beta: no « not installed » warning, the box can be ticked', async () => {
    show({ status: 503, payload: { error: 'PUBLIC_BETA_RESTRICTED' } });
    expect(await publishBox()).not.toBeDisabled();
    expect(screen.queryByText(/pas encore installés/)).toBeNull();
  });
  it('real missing tables: the warning stays and the box is locked', async () => {
    show({ status: 200, payload: { ok: false, missingTables: ['ProRdvService'] } });
    expect(await publishBox()).toBeDisabled();
    expect(screen.getByText(/pas encore installés/)).toBeInTheDocument();
  });
});
