// @vitest-environment jsdom
/**
 * PKG-10 / P24 — public status: real dependencies (database, mail configuration, LOCAL model on loopback, WS2 manifest) in plain French, no internals
 * (no host, port, version, count, threshold or error text); an external model endpoint is never contacted; cached 30 s; the page shows each state with words
 * and an icon (not colour only) and an honest error when the check itself fails. No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ dbOk: true, mail: { provider: 'resend', deliverable: true, reason: 'ok' }, calls: 0 }));
vi.mock('../../src/db/index.js', () => ({ db: { execute: async () => { h.calls++; if (!h.dbOk) throw new Error('ECONNREFUSED 10.0.0.5:5432 secret-detail'); return { rows: [{ '?column?': 1 }] }; } } }));
vi.mock('../../api/_utils/mailer.js', () => ({ getMailerStatus: () => h.mail }));
const { default: handler, computeStatus, _resetStatusCache } = await import('../../api/_handlers/public-status.js');
const Status = (await import('../../src/pages/Status.jsx')).default;

const res = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } });
const state = (b, id) => b.components.find((c) => c.id === id);
let fetchSpy;
beforeEach(() => { h.dbOk = true; h.mail = { provider: 'resend', deliverable: true, reason: 'ok' }; h.calls = 0; _resetStatusCache(); delete process.env.OLLAMA_BASE_URL;
  fetchSpy = vi.fn(async () => ({ ok: true })); vi.stubGlobal('fetch', fetchSpy); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('PKG-10 / P24 GET /api/status', () => {
  it('all good: five components, plain French, aid information honestly « en cours de vérification » (WS2 launchReady false)', async () => {
    const b = await computeStatus();
    expect(b.components.map((c) => [c.id, c.state])).toEqual([['site', 'operational'], ['comptes', 'operational'], ['emails', 'operational'], ['assistant', 'operational'], ['donnees', 'info']]);
    expect(state(b, 'donnees').text).toMatch(/en cours de vérification automatique/);
    expect(state(b, 'donnees').text).not.toMatch(/par une personne/);   // launch-readiness item 46 (D-5 v2)
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://127.0.0.1:11434/api/tags');
  });
  it('failures are said plainly and leak nothing (no host, port, error text, provider name, number)', async () => {
    h.dbOk = false; h.mail = { provider: 'noop', deliverable: false, reason: 'MAILER_API_KEY or MAILER_FROM missing' }; fetchSpy.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
    const b = await computeStatus();
    expect(state(b, 'comptes').state).toBe('unavailable'); expect(state(b, 'emails').state).toBe('unavailable'); expect(state(b, 'assistant').state).toBe('unavailable');
    const t = JSON.stringify(b.components);
    expect(t).not.toMatch(/ECONN|10\.0\.0\.5|5432|11434|127\.0\.0\.1|secret|MAILER|noop|resend|mailjet|ollama|qwen|\d/i);
  });
  it('a test mailer is announced as a test (no real e-mail), never as working', async () => {
    h.mail = { provider: 'test', deliverable: true, reason: 'in-memory test outbox' };
    expect(state(await computeStatus(), 'emails')).toMatchObject({ state: 'degraded', text: expect.stringMatching(/aucun e-mail réel/) });
  });
  it('an EXTERNAL model endpoint is never contacted and counts as unavailable', async () => {
    process.env.OLLAMA_BASE_URL = 'https://models.example.invalid';
    expect(state(await computeStatus(), 'assistant').state).toBe('unavailable'); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('the handler: GET only, no-store, cached 30 s (the database is asked once for repeated calls)', async () => {
    const r1 = res(); await handler({ method: 'GET' }, r1); const r2 = res(); await handler({ method: 'GET' }, r2);
    expect(r1.statusCode).toBe(200); expect(r1.headers['Cache-Control']).toBe('no-store'); expect(r2.body).toBe(r1.body); expect(h.calls).toBe(1);
    const r3 = res(); await handler({ method: 'POST' }, r3); expect(r3.statusCode).toBe(405);
  });
});

describe('PKG-10 / P24 status page', () => {
  const page = () => render(createElement(HelmetProvider, null, createElement(Status)));
  it('shows each section with a worded state (not colour only) and the last check time; axe clean', async () => {
    fetchSpy.mockImplementation(async () => ({ ok: true, json: async () => ({ checkedAt: '2026-10-21T18:00:00Z', components: [
      { id: 'site', state: 'operational', text: 'Le site répond.' }, { id: 'comptes', state: 'operational', text: 'Les comptes fonctionnent.' }, { id: 'emails', state: 'degraded', text: 'Environnement de test : aucun e-mail réel n\'est envoyé.' },
      { id: 'assistant', state: 'unavailable', text: 'L\'assistant est indisponible.' }, { id: 'donnees', state: 'info', text: 'En cours de vérification.' }] }) }));
    const { container } = page();
    await waitFor(() => expect(screen.getByTestId('status-assistant-state')).toHaveTextContent('Indisponible'));
    expect(screen.getByTestId('status-emails-state')).toHaveTextContent('Fonctionne en partie');
    expect(screen.getByTestId('status-comptes-state')).toHaveTextContent('Fonctionne');
    expect(screen.getByTestId('status-donnees-state')).toHaveTextContent('À savoir');
    expect(screen.getByTestId('status-last-checked')).toHaveTextContent(/Dernière vérification : 21 octobre 2026/);
    expect(container.textContent).not.toMatch(/Data Quality|Open P0|Threshold|Refresh/);
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  });
  it('when the check itself fails the page says so, and invents no state', async () => {
    fetchSpy.mockRejectedValue(new Error('offline'));
    page();
    await waitFor(() => expect(screen.getByTestId('status-error-banner')).toHaveTextContent('Impossible de vérifier'));
    expect(screen.queryByTestId('status-comptes-state')).toBeNull();
  });
});
