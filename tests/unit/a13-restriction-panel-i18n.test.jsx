// @vitest-environment jsdom
/**
 * A-13 remainder (C21) — the restriction (art. 18) and objection (art. 21) panels of the account settings go through the citizen API client: a refusal is
 * shown in the interface language (French page: the server's own sentence, unchanged), never the raw French server text on another page; no direct fetch left.
 */
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/csrf', () => ({ csrfFetch: (...a) => globalThis.fetch(...a), getCsrfHeaders: () => ({}), CsrfBootstrapError: class extends Error {} }));
const { setLanguage } = await import('../../src/i18n/index.js');
const { RestrictionPanel, ObjectionPanel } = await import('../../src/pages/CompteParametres.jsx');

const SERVER = 'Choisissez la raison de votre demande (une des quatre raisons prévues par l’article 18 du RGPD).';
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
let calls;
const serve = (get, post) => { calls = []; globalThis.fetch = vi.fn(async (url, init = {}) => { calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }); return (init.method === 'POST' ? post : get)(); }); };
const pickGroundAndSend = async (groundName, buttonName) => {
  fireEvent.click(await screen.findByRole('radio', { name: groundName }));
  fireEvent.click(screen.getByRole('button', { name: buttonName }));
  return screen.findByTestId('compte-restriction-problem');
};

beforeEach(async () => { await setLanguage('fr', { persist: false }); });
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await setLanguage('fr', { persist: false }); });

describe('A-13 remainder — restriction and objection panels through the citizen API client', () => {
  it('French page: a refusal shows the server sentence exactly as before (inline role=alert)', async () => {
    serve(() => json(200, { restriction: null, objection: null }), () => json(400, { error: 'ground_required', message: SERVER }));
    render(createElement(RestrictionPanel));
    const alert = await pickGroundAndSend(/Je conteste l’exactitude/, 'Demander la limitation');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toBe(SERVER);
    expect(calls.find((c) => c.method === 'POST')).toEqual({ url: '/api/citizen/restriction', method: 'POST', body: { action: 'request', ground: 'ACCURACY_CONTESTED' } });
  });

  it('English page: the refusal is in English (code sentence), never the French server text', async () => {
    await setLanguage('en', { persist: false });
    serve(() => json(200, { restriction: null, objection: null }), () => json(400, { error: 'ground_required', message: SERVER }));
    render(createElement(RestrictionPanel));
    const alert = await pickGroundAndSend(/accuracy/i, 'Ask for the restriction');
    expect(alert.textContent).toBe('Choose the reason for your request (one of the four reasons provided for by Article 18 of the GDPR).');
    expect(globalThis.document.body.textContent).not.toContain('Choisissez');
  });

  it('Turkish page: lifting a restriction that no longer exists shows the Turkish « not found » sentence, not the French server text', async () => {
    await setLanguage('tr', { persist: false });
    serve(() => json(200, { restriction: { since: '2026-11-01T10:00:00.000Z' } }), () => json(404, { error: 'not_found', message: 'Aucune limitation en cours.' }));
    render(createElement(RestrictionPanel));
    await screen.findByTestId('compte-restriction-active');
    fireEvent.click(screen.getAllByRole('button')[0]);
    const alert = await screen.findByTestId('compte-restriction-problem');
    expect(alert.textContent).toBe('Bulunamadı: bu öğe yok, artık yok veya hesabınıza bağlı değil.');
    expect(calls.find((c) => c.method === 'POST').body).toEqual({ action: 'lift' });
  });

  it('a refusal without a server sentence and an unreachable service keep the panel’s own sentences', async () => {
    serve(() => json(200, { restriction: null, objection: null }), () => json(500, {}));
    render(createElement(RestrictionPanel));
    expect((await pickGroundAndSend(/Je conteste l’exactitude/, 'Demander la limitation')).textContent).toBe('La demande n’a pas pu être enregistrée.');
    cleanup();
    serve(() => json(200, { restriction: null, objection: null }), () => { throw new TypeError('offline'); });
    render(createElement(RestrictionPanel));
    expect((await pickGroundAndSend(/Je conteste l’exactitude/, 'Demander la limitation')).textContent).toBe('La demande n’a pas pu être envoyée.');
  });

  it('objection: the too-long refusal in German comes from the German catalogue; the GET state goes through the client too', async () => {
    await setLanguage('de', { persist: false });
    serve(() => json(200, { objection: null }), () => json(400, { error: 'reason_too_long', message: 'Votre explication est trop longue (1000 caractères au plus).' }));
    render(createElement(ObjectionPanel));
    fireEvent.click(await screen.findByTestId('compte-objection-send'));
    const alert = await screen.findByTestId('compte-objection-problem');
    expect(alert.textContent).not.toContain('Votre explication');
    expect(alert.textContent).toMatch(/1000/);
    expect(calls[0]).toEqual({ url: '/api/citizen/restriction', method: 'GET', body: null });
  });

  it('source: no direct fetch of /api/citizen/restriction is left in the settings page', () => {
    const page = fs.readFileSync('src/pages/CompteParametres.jsx', 'utf8');
    expect(page).not.toMatch(/fetch\('\/api\/citizen\/restriction'/);
    expect(page).toMatch(/citizenApi\.restrictionState\(\)/);
    expect(page).toMatch(/citizenApi\.restriction\(/);
  });
});
