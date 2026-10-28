// @vitest-environment jsdom
/**
 * DTA S1D — F3 of the browser QA: DiagnosticPage sent a BLANK income / rent field as `0` (`Number('') || 0`), a *known* value, so the assessment contract could never report the income as MISSING
 * and a citizen who simply did not answer was told the same thing as one who earns nothing.  Contract: blank => the fact is ABSENT in the request (=> MISSING_INFORMATION "revenus"),
 * an explicit 0 => a known zero.  Rent is only asked for tenants; for other housing statuses it is not applicable and is sent as the known value 0 (so APL/RSA are not reported missing for a reason that does not apply).
 * Charges are optional and are not part of any required fact.  jsdom: request shaping + the real handler with the assessment contract.
 */
/* global document, window */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DiagnosticPage from '../../src/pages/DiagnosticPage.jsx';

vi.mock('../../src/db/index.js', () => ({ db: { insert: () => ({ values: () => ({ returning: async () => [{ id: 'r' }] }) }), update: () => ({ set: () => ({ where: async () => [] }) }) } }));
vi.mock('../../api/_utils/logger.js', () => { const m = () => {}; return { default: { info: m, warn: m, error: m, debug: m } }; });
vi.mock('@sentry/node', () => ({ captureException: () => {}, captureMessage: () => {}, addBreadcrumb: () => {}, withScope: (f) => f({ setExtra() {}, setTag() {} }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/auth.js', () => ({ resolveAuthContext: async () => null }));

const mkRes = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
let sent, handler;
beforeEach(async () => {
  sent = []; window.localStorage.clear(); document.cookie = '__csrf=t; path=/';
  ({ default: handler } = await import('../../api/_handlers/diagnostic.js'));
  // the page talks to the REAL handler through a fetch bridge
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body); sent.push(body);
    const r = mkRes(); await handler({ method: 'POST', url, headers: { host: 'x' }, socket: {}, body }, r);
    return { ok: r.statusCode < 400, status: r.statusCode, json: async () => r.body, clone() { return this; } };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.cookie = '__csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'; });

const open = () => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(DiagnosticPage))));
const fill = (v) => {
  fireEvent.change(document.getElementById('diag-birthdate'), { target: { value: '1992-03-10' } });
  fireEvent.click(screen.getByRole('radio', { name: v.housing || 'Locataire' }));
  for (const [id, val] of Object.entries({ 'diag-salary': v.salary, 'diag-unemployment': v.unemployment, 'diag-rent': v.rent, 'diag-charges': v.charges, 'diag-zip': v.zip ?? '67000' })) if (val !== undefined) fireEvent.change(document.getElementById(id), { target: { value: val } });
};
const run = async (v) => { open(); fill(v); fireEvent.click(document.getElementById('diag-calculate-btn')); await waitFor(() => expect(sent).toHaveLength(1)); await screen.findByTestId('diagnostic-results'); return sent[0].answers; };
const state = (code) => screen.getByTestId(`assessment-state-${code}`).textContent;

describe('blank is not zero', () => {
  it('a tenant who answered neither income field nor rent: income and rent are ABSENT in the request, RSA and APL are "informations manquantes" and name the missing facts', async () => {
    const a = await run({ housing: 'Locataire' });
    expect(a.income).toEqual({}); expect(a.housing.rent).toBeUndefined();
    expect(state('rsa')).toMatch(/manquantes/i); expect(state('apl')).toMatch(/manquantes/i);
    expect(screen.getByTestId('assessment-item-rsa').textContent).toMatch(/À préciser : .*revenus/i);
    expect(screen.getByTestId('assessment-item-apl').textContent).toMatch(/À préciser : .*loyer/i);
  });
  it('an explicit 0 is a KNOWN zero: sent as 0, RSA is no longer missing', async () => {
    const a = await run({ salary: '0', unemployment: '0', rent: '0', housing: 'Locataire' });
    expect(a.income).toEqual({ salary: 0, unemployment: 0 }); expect(a.housing.rent).toBe(0);
    expect(state('rsa')).toMatch(/faire vérifier/i); expect(state('apl')).toMatch(/faire vérifier/i);
  });
  it('one income field answered is enough: the other stays absent (not zero)', async () => {
    const a = await run({ unemployment: '700', rent: '480' });
    expect(a.income).toEqual({ unemployment: 700 }); expect(a.housing.rent).toBe(480);
    expect(state('rsa')).toMatch(/faire vérifier/i);
  });
  it('a non-tenant is not asked for a rent: it is sent as the known value 0 so APL is not "missing" for a reason that does not apply', async () => {
    const a = await run({ housing: 'Propriétaire', salary: '0' });
    expect(a.housing.rent).toBe(0); expect(a.housing.status).toBe('owner');
    expect(state('apl')).toMatch(/faire vérifier/i);
  });
  it('charges stay optional (blank => 0 is harmless: no required fact reads it)', async () => {
    const a = await run({ salary: '0', rent: '300' });
    expect(a.housing.charges === 0 || a.housing.charges === undefined).toBe(true);
  });
  it('no money, eligibility or refusal wording appears for the "missing" outcome either', async () => {
    await run({ housing: 'Locataire' });
    expect(screen.getByTestId('diagnostic-results').textContent).not.toMatch(/€|éligible|vous avez droit|non applicable/i);
  });
});
