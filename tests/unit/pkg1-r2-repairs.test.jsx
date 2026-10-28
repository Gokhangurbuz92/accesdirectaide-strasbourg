// @vitest-environment jsdom
/**
 * PKG-1 repair of F6 (native run 20261018T192252Z-2ede5b, DTA-B20). Root cause read from the run's own PostgreSQL log:
 *   1. the preference checkbox was fully controlled by the SERVER value, so a click changed nothing on screen until the round-trip and reload ended
 *      (no feedback, a screen reader still announced "Désactivé"; Playwright's check() failed with "Clicking the checkbox did not change its state");
 *   2. the test's own cleanup then deleted the account while the PUT was still in flight, and the insert hit NotificationPreference_user_fkey (23503) -> 500.
 * Repairs: the box follows the click at once (pending, aria-busy, "Enregistrement…", one request per option) and the server answer decides;
 * a write that hits the account foreign key after the account was erased answers 401, not 500; database errors are logged without parameter values.
 * Also in R2: the public search-pro 500 no longer returns the driver message, and the site footer no longer claims that ALL information is verified (D-5).
 */
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeDbError } from '../../api/_utils/errors.js';

const api = vi.hoisted(() => ({ getProfile: vi.fn(), saveProfile: vi.fn(), addMember: vi.fn(), removeMember: vi.fn(), setPreference: vi.fn(), listShares: vi.fn(), claimShare: vi.fn() }));
const auth = vi.hoisted(() => ({ requireCitizen: vi.fn(), resolveCitizen: vi.fn() }));
const log = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error { constructor(m, s, c) { super(m); this.status = s; this.code = c; } } }));
vi.mock('../../api/_utils/citizen-auth.js', () => auth);
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1', getRateLimitStatus: () => 429 }));
vi.mock('../../api/_utils/logger.js', () => ({ default: log }));
vi.mock('../../src/db/index.js', () => ({ db: { execute: async () => { throw Object.assign(new Error('Failed query: SELECT id FROM "NeedCategory"\nparams: mon-terme-de-recherche'), { cause: { code: '42P01', message: 'relation does not exist' } }); } } }));

import CompteProfil from '../../src/pages/CompteProfil.jsx';

const PREFS = { 'email.service': true, 'email.reminder': true, 'email.marketing': false, 'inapp.service': true, 'inapp.reminder': true, 'inapp.marketing': false, 'sms.service': false, 'sms.reminder': false, 'sms.marketing': false, 'push.service': false, 'push.reminder': false, 'push.marketing': false };
const account = (prefs = {}) => ({ profile: { displayName: null, preferredLanguage: 'fr', ageBand: null, departement: null, accessibilityPrefs: {}, prefillConsent: false }, household: [], preferences: { ...PREFS, ...prefs }, agePolicy: { accountFeatures: 'ALLOWED', allowed: true, status: 'REQUIRES_LEGAL_VALIDATION', publicInformation: 'ALL_AGES' } });
const mount = () => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(CompteProfil))));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

// a drizzle-wrapped driver error exactly as the native run produced it (values are synthetic)
const fkError = () => Object.assign(new Error('Failed query: insert into "NotificationPreference" ("userId", "channel", "category", "enabled", "updatedAt") values ($1, $2, $3, $4, $5)\nparams: qa-k0-secretid,sms,service,true,2026-10-18T19:30:29.957Z'), {
  cause: Object.assign(new Error('insert or update on table "NotificationPreference" violates foreign key constraint "NotificationPreference_user_fkey"'), { code: '23503', constraint: 'NotificationPreference_user_fkey', detail: 'Key (userId)=(qa-k0-secretid) is not present in table "CitizenUser".' }),
});

describe('F6 — a preference follows the click while the server decides', () => {
  beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); api.listShares.mockResolvedValue({ shares: [] }); });
  afterEach(cleanup);

  it('with consent, the box is checked at once, marked busy and "Enregistrement…"; a second click sends nothing; the saved server value then applies', async () => {
    api.getProfile.mockResolvedValue(account());
    const put = deferred(); api.setPreference.mockReturnValue(put.promise);
    mount();
    fireEvent.click(await screen.findByTestId('consent-sms-service'));
    const box = screen.getByTestId('pref-sms-service');
    fireEvent.click(box);
    expect(box).toBeChecked();                                          // what Playwright's check() asserts right after its click
    expect(box).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('pref-state-sms-service')).toHaveTextContent('Enregistrement…');
    expect(screen.getByTestId('profil-status')).not.toHaveTextContent('Préférence enregistrée');   // nothing claims a save before the server answered
    fireEvent.click(box);                                               // impatient second click while pending
    expect(api.setPreference).toHaveBeenCalledTimes(1);
    expect(api.setPreference).toHaveBeenCalledWith({ channel: 'sms', category: 'service', enabled: true, consentGiven: true });
    api.getProfile.mockResolvedValue(account({ 'sms.service': true }));
    await act(async () => { put.resolve({ preferences: { ...PREFS, 'sms.service': true } }); });
    await waitFor(() => expect(screen.getByTestId('profil-status')).toHaveTextContent('Préférence enregistrée'));
    expect(screen.getByTestId('pref-sms-service')).toBeChecked();
    expect(screen.getByTestId('pref-sms-service')).not.toHaveAttribute('aria-busy');
    expect(screen.getByTestId('pref-state-sms-service')).toHaveTextContent('Activé');
  });

  it('a server refusal puts the saved value back and shows the server message', async () => {
    api.getProfile.mockResolvedValue(account());
    api.setPreference.mockRejectedValue(Object.assign(new Error('Cette fonction nécessite le consentement d’un représentant légal vérifié.'), { status: 409 }));
    mount();
    fireEvent.click(await screen.findByTestId('consent-sms-service'));
    fireEvent.click(screen.getByTestId('pref-sms-service'));
    expect(await screen.findByTestId('profil-error')).toHaveTextContent('représentant légal');
    await waitFor(() => expect(screen.getByTestId('pref-sms-service')).not.toBeChecked());
    expect(screen.getByTestId('pref-sms-service')).not.toHaveAttribute('aria-busy');
  });

  it('switching an option off also shows the pending state and never asks for consent', async () => {
    api.getProfile.mockResolvedValue(account());
    const put = deferred(); api.setPreference.mockReturnValue(put.promise);
    mount();
    const box = await screen.findByTestId('pref-email-reminder');
    fireEvent.click(box);
    expect(box).not.toBeChecked(); expect(box).toHaveAttribute('aria-busy', 'true');
    expect(api.setPreference).toHaveBeenCalledWith({ channel: 'email', category: 'reminder', enabled: false, consentGiven: undefined });
    api.getProfile.mockResolvedValue(account({ 'email.reminder': false }));
    await act(async () => { put.resolve({}); });                       // an answer without the preferences block: stay pending until the reload has the server value
    await waitFor(() => expect(screen.getByTestId('pref-email-reminder')).not.toHaveAttribute('aria-busy'));
    expect(screen.getByTestId('pref-email-reminder')).not.toBeChecked();
  });

  it('the option is usable again as soon as the server answered, even while the screen reload is still running', async () => {
    api.getProfile.mockResolvedValue(account());
    api.setPreference.mockResolvedValueOnce({ preferences: { ...PREFS, 'sms.service': true } }).mockResolvedValueOnce({ preferences: { ...PREFS } });
    mount();
    fireEvent.click(await screen.findByTestId('consent-sms-service'));
    const reload = deferred(); api.getProfile.mockReturnValue(reload.promise);   // the reload after the save never finishes in this test
    await act(async () => { fireEvent.click(screen.getByTestId('pref-sms-service')); });
    await waitFor(() => expect(screen.getByTestId('pref-sms-service')).not.toHaveAttribute('aria-busy'));
    expect(screen.getByTestId('pref-sms-service')).toBeChecked();      // the server's own answer, shown before the reload
    await act(async () => { fireEvent.click(screen.getByTestId('pref-sms-service')); });   // switching it off again right away is NOT swallowed
    await waitFor(() => expect(api.setPreference).toHaveBeenCalledTimes(2));
    expect(api.setPreference).toHaveBeenLastCalledWith({ channel: 'sms', category: 'service', enabled: false, consentGiven: undefined });
    await waitFor(() => expect(screen.getByTestId('pref-sms-service')).not.toBeChecked());
  });
});

describe('F6 — database errors are logged without parameter values', () => {
  it('describeDbError keeps the SQL shape, SQLSTATE and constraint; drops params and the driver detail', () => {
    const d = describeDbError(fkError());
    expect(d.cause).toEqual({ code: '23503', constraint: 'NotificationPreference_user_fkey', message: expect.stringContaining('violates foreign key constraint') });
    expect(d.message).toMatch(/^Failed query: insert into "NotificationPreference"/);
    expect(JSON.stringify(d)).not.toMatch(/params:|qa-k0-secretid|Key \(userId\)/);
  });
  it('a non-database error is described without crashing', () => {
    expect(describeDbError(new TypeError('x'))).toEqual({ name: 'TypeError', message: 'x', cause: undefined });
    expect(describeDbError(undefined)).toEqual({ name: undefined, message: '', cause: undefined });
  });
});

describe('F6 — citizenHandler: an account erased mid-request is a 401, everything else stays a 500', () => {
  const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
  const call = async (thrown) => {
    const { citizenHandler } = await import('../../api/_utils/citizen-handler.js');
    const h = citizenHandler('preferences', ['PUT'], async () => { throw thrown; });
    const res = mk(); await h({ method: 'PUT', headers: {}, body: {} }, res); return res;
  };
  beforeEach(() => { Object.values(auth).forEach((f) => f.mockReset()); Object.values(log).forEach((f) => f.mockReset()); auth.requireCitizen.mockResolvedValue({ id: 'qa-k0-secretid', email: 'x@example.test' }); });

  it('FK violation and the session no longer resolves to an account -> 401, logged as a warning without values', async () => {
    auth.resolveCitizen.mockResolvedValue(null);
    const res = await call(fkError());
    expect(res.statusCode).toBe(401); expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(log.error).not.toHaveBeenCalled(); expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(/params:|qa-k0-secretid,|Key \(userId\)/);
    expect(JSON.stringify(log.warn.mock.calls)).toContain('23503');
  });
  it('FK violation while the account still exists is a real fault -> 500 (never hidden as an auth problem)', async () => {
    auth.resolveCitizen.mockResolvedValue({ id: 'qa-k0-secretid' });
    const res = await call(fkError());
    expect(res.statusCode).toBe(500); expect(res.body).toEqual({ error: 'internal_error' }); expect(log.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.error.mock.calls)).not.toMatch(/params:|Key \(userId\)/);
  });
  it('FK violation and the re-check itself fails -> 500', async () => {
    auth.resolveCitizen.mockRejectedValue(new Error('db down'));
    expect((await call(fkError())).statusCode).toBe(500);
  });
  it('any other error -> 500 without re-checking the account', async () => {
    const res = await call(Object.assign(new Error('Failed query: select 1\nparams: a'), { cause: { code: '40001', message: 'serialization failure' } }));
    expect(res.statusCode).toBe(500); expect(auth.resolveCitizen).not.toHaveBeenCalled();
  });
});

describe('search-pro: a public 500 never returns the driver message (SQL + the visitor\'s search terms)', () => {
  it('answers a generic 500 body and logs without the parameters', async () => {
    log.error.mockReset();
    const handler = (await import('../../api/_handlers/search-pro.js')).default;
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
    await handler({ method: 'POST', body: { q: 'mon-terme-de-recherche' } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('mon-terme-de-recherche');
  });
});

describe('D-5 honesty: the site never claims that every piece of information is verified', () => {
  it('the footer on every page says what is true in both content modes (records cite a source; "verified" only after a dated automatic check, D-5 v2)', () => {
    const layout = readFileSync(resolve(process.cwd(), 'src/pages/Layout.jsx'), 'utf8');   // jsdom environment: import.meta.url is not a file: URL here
    expect(layout).not.toMatch(/Toutes les informations sont vérifiées/);
    expect(layout).toMatch(/présentée comme vérifiée qu&apos;après un contrôle automatique daté auprès de sa source officielle/);
    expect(layout).not.toMatch(/relecture humaine/);   // launch-readiness item 46: an automatic decision is never presented as a person's review
  });
});
