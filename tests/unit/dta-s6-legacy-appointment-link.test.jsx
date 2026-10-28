// @vitest-environment jsdom
/**
 * DTA S6 — the three pre-RDV-module appointment links have no routed backend (/api/appointments*, /api/public/availability): the old pages could only fail.
 * They now land on an honest notice: nothing is fetched, no token is kept (the URL path and fragment are replaced by a neutral URL), no appointment is claimed, the way forward is the structure directory.
 * Static guard: every endpoint those legacy pages call is declared in api/routes.js or the page is not routed.
 */
/* global window, document */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LegacyAppointmentLink from '../../src/pages/LegacyAppointmentLink.jsx';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = (kind) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(LegacyAppointmentLink, { kind }))));

describe('legacy appointment links', () => {
  it.each(['request', 'cancel', 'reschedule'])('%s: honest notice, nothing fetched, no appointment claimed, link to the directory', (kind) => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    mount(kind);
    expect(screen.getByTestId('legacy-appointment-link')).toBeInTheDocument();
    expect(screen.getByText(/Aucun rendez-vous n.a été créé, modifié ou annulé/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trouver une structure' })).toHaveAttribute('href', '/structures');
    expect(f).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/confirmé|annulé avec succès|reporté avec succès/i);
  });
  it('messages: honest notice, nothing fetched, nothing read or sent, link to the citizen\'s own messages', () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    mount('messages');
    expect(screen.getByRole('heading', { name: 'Messagerie', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Aucun message n.a été lu ou envoyé/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ouvrir mes messages' })).toHaveAttribute('href', '/compte/messages');
    expect(f).not.toHaveBeenCalled();
  });
  it.each([
    ['cancel', '/appointments/cancel/SECRETPATH?z=1#token=SECRETHASH', '/appointments/cancel'],
    ['cancel', '/appointments/cancel?token=SECRETQUERY', '/appointments/cancel'],
    ['reschedule', '/appointments/reschedule/SECRETPATH#token=SECRETHASH', '/appointments/reschedule'],
    ['request', '/appointments/request?structure_id=x#token=SECRETHASH', '/appointments/request'],
    ['messages', '/r/SECRETPATH/messages?token=SECRETQUERY', '/r/messages'],
  ])('%s %s: a capability in the URL path, query or fragment is replaced (not pushed) by a neutral URL at once', (kind, entry, path) => {
    let seen = null; const trail = [];
    const Probe = () => { seen = useLocation(); trail.push(`${seen.pathname}${seen.search}${seen.hash}`); return null; };
    render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [entry] }, createElement(LegacyAppointmentLink, { kind }), createElement(Probe))));
    expect(seen.pathname).toBe(path); expect(seen.hash).toBe(''); expect(seen.search).toBe('');
    expect(JSON.stringify(seen)).not.toMatch(/SECRET/);
    expect(screen.getByTestId('legacy-appointment-link')).toBeInTheDocument();
  });
  it('the router mounts the notice (never the unrouted-backend pages) for these paths, and every API route those pages call is genuinely absent from routes.js (so the notice is the truthful behaviour)', () => {
    const index = readFileSync('src/pages/index.jsx', 'utf8');
    for (const p of ['/appointments/request', '/appointments/cancel', '/appointments/cancel/:token', '/appointments/reschedule', '/appointments/reschedule/:token', '/r/messages', '/r/:token/messages']) {
      const line = index.split('\n').find((l) => l.includes(`path="${p}"`));
      expect(line, p).toMatch(/LegacyAppointmentLink/);
    }
    expect(index).not.toMatch(/<(AppointmentRequest|AppointmentCancel|AppointmentReschedule|BeneficiaryMessages)\b/);
    const routes = readFileSync('api/routes.js', 'utf8');
    for (const p of ["'appointments'", "'appointments/cancel'", "'appointments/reschedule'", "'public/availability'", "'public/messages'"]) expect(routes.includes(`path: ${p}`), p).toBe(false);
  });
});
