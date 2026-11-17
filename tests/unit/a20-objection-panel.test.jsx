// @vitest-environment jsdom
/**
 * A-20 — the objection panel of the account settings FILES the request (POST citizen/restriction { action: 'object' }) instead of sending the person to an
 * e-mail; it says « recorded, examined by a person », never « accepted »; an open request hides the form; a refusal is an inline alert in the interface language.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/csrf', () => ({ csrfFetch: (...a) => globalThis.fetch(...a), getCsrfHeaders: () => ({}), CsrfBootstrapError: class extends Error {} }));
const { ObjectionPanel } = await import('../../src/pages/CompteParametres.jsx');

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
let calls;
const serve = (get, post) => { calls = []; globalThis.fetch = vi.fn(async (url, init = {}) => { calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }); return (init.method === 'POST' ? post : get)(); }); };
beforeEach(() => { vi.spyOn(globalThis.window, 'alert').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('A-20 objection panel', () => {
  it('files the objection with the optional explanation and then shows it as recorded and under examination', async () => {
    serve(() => json(200, { restriction: null, objection: null }), () => json(201, { objection: { id: 'o1', status: 'OPEN', since: '2026-11-15T10:00:00.000Z' } }));
    render(createElement(ObjectionPanel));
    fireEvent.change(await screen.findByLabelText('Ce que vous souhaitez nous dire (facultatif)'), { target: { value: 'Je ne souhaite plus ce traitement.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer ma demande d’opposition' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toEqual({ url: '/api/citizen/restriction', method: 'POST', body: { action: 'object', reason: 'Je ne souhaite plus ce traitement.' } }));
    expect((await screen.findByTestId('compte-objection-open')).textContent).toMatch(/en cours d’examen/);
    expect(screen.getByTestId('compte-objection-status').textContent).toMatch(/enregistrée.*vous répond dans un délai d’un mois/);
    expect(globalThis.document.body.textContent).not.toMatch(/accept/i);
    expect(screen.queryByTestId('compte-objection-send')).toBeNull();
  });

  it('an open request hides the form; an answered one says so and allows a new request', async () => {
    serve(() => json(200, { objection: { id: 'o1', status: 'OPEN', since: '2026-11-01T10:00:00.000Z' } }), () => json(500, {}));
    render(createElement(ObjectionPanel));
    await screen.findByTestId('compte-objection-open');
    expect(screen.queryByTestId('compte-objection-reason')).toBeNull();
    cleanup();
    serve(() => json(200, { objection: { id: 'o1', status: 'ANSWERED', since: '2026-10-01T10:00:00.000Z' } }), () => json(500, {}));
    render(createElement(ObjectionPanel));
    expect(await screen.findByTestId('compte-objection-answered')).toBeTruthy();
    expect(screen.getByTestId('compte-objection-send')).toBeTruthy();
  });

  it('a refusal or an unreadable state is an inline alert (no globalThis.window.alert, no raw server sentence)', async () => {
    serve(() => json(200, { objection: null }), () => json(400, { error: 'reason_too_long', message: 'RAW SERVER SENTENCE' }));
    render(createElement(ObjectionPanel));
    fireEvent.click(await screen.findByTestId('compte-objection-send'));
    const alert = await screen.findByTestId('compte-objection-problem');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toBe('Votre explication est trop longue (1000 caractères au plus).');
    expect(globalThis.document.body.textContent).not.toContain('RAW SERVER SENTENCE');
    expect(globalThis.window.alert).not.toHaveBeenCalled();
    cleanup();
    serve(() => json(503, {}), () => json(500, {}));
    render(createElement(ObjectionPanel));
    expect((await screen.findByTestId('compte-objection-load-error')).getAttribute('role')).toBe('alert');
    expect(screen.queryByTestId('compte-objection-send')).toBeNull();
  });
});
