// @vitest-environment jsdom
/**
 * UX ecosystem (2026-11-12) — the Pro appointment pages check /api/monitor/pro-rdv, a monitor route the public beta keeps closed even with appointments
 * opened: every page showed « n’a pas pu être vérifié. Réessayez » and a « Vérifier l’état » button that could never succeed. A beta refusal of the check
 * now shows neither; a real failure still warns, and missing tables still say so.
 * No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const R = vi.hoisted(() => ({ answer: null }));
vi.mock('@/api/pro-rdv-client', async (orig) => ({ ...(await orig()), fetchProRdvReadiness: async () => R.answer }));

import RdvLayout from '../../src/pages/pro/RdvLayout.jsx';

afterEach(() => cleanup());
const show = () => render(h(MemoryRouter, { initialEntries: ['/pro/rdv/agenda'] }, h(Routes, null, h(Route, { path: '/pro/rdv/*', element: h(RdvLayout) }))));

describe('UX ecosystem: the Pro appointment readiness check', () => {
  it('closed by the beta: no warning and no « Vérifier l’état » button', async () => {
    R.answer = { status: 503, payload: { error: 'PUBLIC_BETA_RESTRICTED' } }; show();
    await waitFor(() => expect(screen.getByTestId('pro-rdv-layout')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('pro-rdv-readiness-banner')).toBeNull();
    expect(screen.queryByRole('button', { name: /Vérifier l’état/ })).toBeNull();
  });
  it('a real failure still warns, with the button', async () => {
    R.answer = { status: 500, payload: null }; show();
    expect(await screen.findByTestId('pro-rdv-readiness-banner')).toHaveTextContent('n’a pas pu être vérifié');
    expect(screen.getByRole('button', { name: /Vérifier l’état/ })).toBeInTheDocument();
  });
  it('missing tables still say the installation is not finished', async () => {
    R.answer = { status: 200, payload: { ok: false, missingTables: ['ProRdvService'] } }; show();
    expect(await screen.findByTestId('pro-rdv-readiness-banner')).toHaveTextContent('installation n’est pas terminée');
  });
});
