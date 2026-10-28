// @vitest-environment jsdom
/**
 * R18 (product completion audit, 2026-10-28) — the citizen and public journeys that were dead ends or silent:
 * one password rule stated before sending and refused in French by sign-up AND reset; the home situations open their own search; an empty catalogue of
 * dispositifs says why and where to go; an outage of Mon Coffre offers to try again instead of « Se connecter »; « Mes rendez-vous » opens the conversation
 * with the organization. The server-side professional rules are in tests/integration/r18-pro-journeys-db.test.js (real PostgreSQL).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listCoffre: vi.fn(), myAppointments: vi.fn(), cancelAppointment: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api }));
const messaging = vi.hoisted(() => ({ getOrCreateFromAppointment: vi.fn() }));
vi.mock('../../src/api/rdv-messaging-client.js', () => ({ rdvMessagingClient: { user: messaging } }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));

import { PASSWORD_RULE, passwordMessage, passwordProblems } from '../../src/lib/passwordPolicy.js';
import CategoriesSection from '../../src/components/home/CategoriesSection.jsx';
import Dispositifs from '../../src/pages/Dispositifs.jsx';
import CompteCoffre from '../../src/pages/CompteCoffre.jsx';
import CompteRendezVous from '../../src/pages/CompteRendezVous.jsx';

const wrap = (C) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(C))));
const mkRes = () => ({ statusCode: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Object.values(api).forEach((f) => f.mockReset()); messaging.getOrCreateFromAppointment.mockReset(); navigate.mockReset(); });

describe('R18 password rule (one definition, French refusals)', () => {
  it('the rule lists what is missing with the server wording', () => {
    expect(passwordProblems('Motdepasse')).toEqual(['1 chiffre requis']);
    expect(passwordProblems('Qa-Passw0rd-1')).toEqual([]);
    expect(passwordMessage(passwordProblems('abc'))).toBe('Mot de passe trop faible : 8 caractères minimum, 1 majuscule requise, 1 chiffre requis.');
    expect(PASSWORD_RULE).toMatch(/majuscule.*minuscule.*chiffre/);
  });
  it('sign-up and reset refuse a weak password with a French message (the reset used to accept any 8 characters)', async () => {
    const { default: signup } = await import('../../api/_handlers/auth/signup.js');
    const r1 = mkRes(); await signup({ method: 'POST', body: { email: 'r18@example.test', password: 'motdepasse' }, headers: {} }, r1);
    expect(r1.statusCode).toBe(400); expect(r1.body.message).toBe('Mot de passe trop faible : 1 majuscule requise, 1 chiffre requis.');
    const r2 = mkRes(); await signup({ method: 'POST', body: { email: 'pas-une-adresse', password: 'Qa-Passw0rd-1' }, headers: {} }, r2);
    expect(r2.statusCode).toBe(400); expect(r2.body.message).toMatch(/^Adresse e-mail invalide/);
    const { default: reset } = await import('../../api/_handlers/auth/reset-password.js');
    const r3 = mkRes(); await reset({ method: 'POST', body: { token: 'abc', password: 'motdepasse1' }, headers: {} }, r3);
    expect(r3.statusCode).toBe(400); expect(r3.body.message).toBe('Mot de passe trop faible : 1 majuscule requise.');
    const r4 = mkRes(); await reset({ method: 'POST', body: { token: '', password: 'Qa-Passw0rd-1' }, headers: {} }, r4);
    expect(r4.body.message).toMatch(/^Lien invalide ou expiré/);
  });
});

describe('R18 public journeys', () => {
  it('each home situation opens the search on its own words', () => {
    wrap(CategoriesSection);
    const links = screen.getAllByRole('link').map((a) => [a.textContent.split('Voir')[0].trim(), a.getAttribute('href')]);
    expect(links).toHaveLength(8);
    expect(new Set(links.map(([, h]) => h)).size).toBe(8);
    expect(links).toContainEqual(['Handicap', '/recherche?q=handicap']);
    expect(links).toContainEqual(['Senior', '/recherche?q=personnes%20%C3%A2g%C3%A9es']);
  });
  it('no published dispositif: the page says why and offers the next steps, without filters that match nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    wrap(Dispositifs);
    const none = await screen.findByTestId('dispositifs-none-published');
    expect(none).toHaveTextContent('vérifié sur une source officielle');
    expect(screen.getByRole('link', { name: 'Voir les aides' })).toHaveAttribute('href', '/aides');
    expect(screen.getByRole('link', { name: 'Trouver un lieu d’aide' })).toHaveAttribute('href', '/structures');
    expect(screen.queryByLabelText('Département')).toBeNull();
  });
});

describe('R18 citizen journeys', () => {
  it('Mon Coffre: an outage offers « Réessayer », only a missing session offers « Se connecter »', async () => {
    api.listCoffre.mockRejectedValueOnce(Object.assign(new Error('Service indisponible.'), { status: 500 }));
    api.listCoffre.mockResolvedValueOnce({ documents: [], quota: { usedBytes: 0, maxBytes: 1 } });
    wrap(CompteCoffre);
    const retry = await screen.findByTestId('coffre-retry');
    expect(screen.queryByRole('link', { name: 'Se connecter' })).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(api.listCoffre).toHaveBeenCalledTimes(2));
    cleanup();
    api.listCoffre.mockRejectedValueOnce(Object.assign(new Error('Non connecté'), { status: 401 }));
    wrap(CompteCoffre);
    expect(await screen.findByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/auth/login?next=/compte/coffre');
  });
  it('Mes rendez-vous: « Écrire à la structure » opens the appointment\'s conversation; cancelling asks first', async () => {
    api.myAppointments.mockResolvedValue({ appointments: [{ id: 'a1', structure: { slug: 'alpha', name: 'Alpha' }, service: { id: 's1', name: 'Entretien' }, status: 'CONFIRMED', startsAt: '2099-01-10T09:00:00.000Z', canCancel: true, canReschedule: false, reschedule: { count: 0, max: 2 } }] });
    messaging.getOrCreateFromAppointment.mockResolvedValue({ conversationId: 'c-9' });
    wrap(CompteRendezVous);
    fireEvent.click(await screen.findByTestId('rdv-write'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/compte/messages/c-9'));
    expect(messaging.getOrCreateFromAppointment).toHaveBeenCalledWith('a1');
    fireEvent.click(screen.getByTestId('rdv-cancel'));
    expect(screen.getByTestId('rdv-cancel-confirm-panel')).toHaveTextContent('Cette action ne peut pas être annulée');
    fireEvent.click(screen.getByTestId('rdv-cancel-keep'));
    expect(api.cancelAppointment).not.toHaveBeenCalled();
  });
});
