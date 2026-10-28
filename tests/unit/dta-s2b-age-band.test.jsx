// @vitest-environment jsdom
/**
 * DTA S2B — data minimisation (gap D3d): the citizen may give an AGE BAND instead of an exact date of birth.
 * Contract: birthDate OR ageBand is enough (neither => 400 as before); the band is a closed vocabulary; with a band the assessment is still honest MISSING/CHECK_REQUIRED (no new certainty);
 * only the band — never an invented date — reaches the engine/heuristic (leads stay off); when an exact date is given, ONLY the date is sent (the page never sends both).
 */
/* global document, window */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGE_BANDS, AGE_BAND_KEYS, ageFromBand } from '../../api/lib/ageBands.js';
import { buildAssessment } from '../../api/lib/assessmentContract.js';
import { runLocalSimulation } from '../../api/lib/LocalRulesEngine.js';
import DiagnosticPage from '../../src/pages/DiagnosticPage.jsx';

vi.mock('../../src/db/index.js', () => ({ db: { insert: () => ({ values: () => ({ returning: async () => [{ id: 'r' }] }) }), update: () => ({ set: () => ({ where: async () => [] }) }) } }));
vi.mock('../../api/_utils/logger.js', () => { const m = () => {}; return { default: { info: m, warn: m, error: m, debug: m } }; });
vi.mock('@sentry/node', () => ({ captureException: () => {}, captureMessage: () => {}, addBreadcrumb: () => {}, withScope: (f) => f({ setExtra() {}, setTag() {} }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/auth.js', () => ({ resolveAuthContext: async () => null }));

const mkRes = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
let handler, sent;
const base = { householdSize: 1, territory: '67000', income: { unemployment: 700 }, housing: { status: 'tenant', rent: 480, charges: 0 } };
const call = async (answers) => { const r = mkRes(); await handler({ method: 'POST', url: '/api/diagnostic', headers: { host: 'x' }, socket: {}, body: { mode: 'SIMULATION_MODE', answers } }, r); return r; };

beforeEach(async () => { sent = []; ({ default: handler } = await import('../../api/_handlers/diagnostic.js')); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.cookie = '__csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'; });

describe('the closed age-band vocabulary', () => {
  it('four bands, each with a declared lower bound used ONLY by the non-authoritative local heuristic', () => {
    expect(AGE_BAND_KEYS).toEqual(['moins-de-18', '18-24', '25-59', '60-et-plus']);
    expect(ageFromBand('moins-de-18')).toBe(16); expect(ageFromBand('18-24')).toBe(18); expect(ageFromBand('25-59')).toBe(25); expect(ageFromBand('60-et-plus')).toBe(60);
    for (const bad of ['', undefined, null, '18-25', 'adulte', 18, {}]) expect(ageFromBand(bad)).toBeNull();
    expect(Object.isFrozen(AGE_BANDS)).toBe(true);
  });
});

describe('API: birthDate OR ageBand', () => {
  it('an age band alone is accepted (200): no date is invented, the assessment is still non-authoritative, no amount, leads off', async () => {
    const r = await call({ ...base, ageBand: '25-59' });
    expect(r.statusCode).toBe(200); expect(r.body.assessment.authoritative).toBe(false); expect(r.body.assessment.leadsEnabled).toBe(false);
    const rsa = r.body.assessment.items.find((i) => i.code === 'rsa'); expect(rsa.state).toBe('CHECK_REQUIRED'); expect(rsa.amount).toBeNull();
    expect(JSON.stringify(r.body)).not.toMatch(/€|\beuros?\b|éligible|vous avez droit|"rights"/i);
  });
  it('neither date nor band => 400 (as before); an unknown band or a malformed date => 400; both given => accepted', async () => {
    expect((await call({ ...base })).statusCode).toBe(400);
    expect((await call({ ...base, ageBand: 'adulte' })).statusCode).toBe(400);
    expect((await call({ ...base, birthDate: '1992-13-45x' })).statusCode).toBe(400);
    expect((await call({ ...base, birthDate: '1992-03-10', ageBand: '25-59' })).statusCode).toBe(200);
  });
  it('the assessment reports the age as missing only when BOTH are absent', () => {
    const miss = buildAssessment({ answers: { ...base } }).items.find((i) => i.code === 'rsa'); expect(miss.state).toBe('MISSING_INFORMATION'); expect(miss.missingFacts).toContain('birthDate');
    expect(buildAssessment({ answers: { ...base, ageBand: '18-24' } }).items.find((i) => i.code === 'rsa').state).toBe('CHECK_REQUIRED');
    expect(buildAssessment({ answers: { ...base, ageBand: 'nope' } }).items.find((i) => i.code === 'rsa').state).toBe('MISSING_INFORMATION');
  });
  it('the local engine takes the band lower bound (heuristic only) and still rejects an unusable input', () => {
    expect(() => runLocalSimulation({ ...base, ageBand: '18-24' })).not.toThrow();
    expect(() => runLocalSimulation({ ...base })).toThrow(); expect(() => runLocalSimulation({ ...base, ageBand: 'x' })).toThrow();
  });
  it('the vocabulary label says "date de naissance ou tranche d\'âge"', async () => {
    const { missingFactLabel } = await import('../../src/lib/assessmentLabels.js'); expect(missingFactLabel('birthDate')).toBe('date de naissance ou tranche d\'âge');
  });
});

describe('display of the age declaration (shared page, PDF)', () => {
  it('the client labels equal the server vocabulary; birthDisplay prefers the exact date, then the band, else "Non précisée"', async () => {
    const { AGE_BAND_LABELS, birthDisplay } = await import('../../src/lib/assessmentLabels.js');
    expect(Object.keys(AGE_BAND_LABELS)).toEqual(AGE_BAND_KEYS);
    for (const k of AGE_BAND_KEYS) expect(AGE_BAND_LABELS[k]).toBe(AGE_BANDS[k].label);
    expect(birthDisplay({ birthDate: '1992-03-10', ageBand: '25-59' })).toBe('1992-03-10');
    expect(birthDisplay({ ageBand: '25-59' })).toBe("Tranche d'âge : 25 à 59 ans");
    expect(birthDisplay({ ageBand: 'x' })).toBe('Non précisée'); expect(birthDisplay({})).toBe('Non précisée'); expect(birthDisplay(null)).toBe('Non précisée');
  });
});

describe('the page', () => {
  const bridge = () => vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body); sent.push(body); const r = mkRes(); await handler({ method: 'POST', url, headers: { host: 'x' }, socket: {}, body }, r);
    return { ok: r.statusCode < 400, status: r.statusCode, json: async () => r.body, clone() { return this; } };
  }));
  const open = () => { window.localStorage.clear(); document.cookie = '__csrf=t; path=/'; bridge(); return render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(DiagnosticPage)))); };

  it('offers a labelled optional age-band select; the button is enabled with a band + housing status and no date; only the band is sent', async () => {
    open();
    const select = document.getElementById('diag-ageband'); expect(select).not.toBeNull();
    expect(document.querySelector('label[for="diag-ageband"]').textContent).toMatch(/tranche d.âge/i);
    const btn = document.getElementById('diag-calculate-btn'); expect(btn).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Locataire' })); expect(btn).toBeDisabled();
    fireEvent.change(select, { target: { value: '25-59' } }); expect(btn).not.toBeDisabled();
    fireEvent.click(btn); await waitFor(() => expect(sent).toHaveLength(1)); await screen.findByTestId('diagnostic-results');
    expect(sent[0].answers.ageBand).toBe('25-59'); expect(sent[0].answers.birthDate).toBeUndefined();
  });
  it('when an exact date is typed, ONLY the date is sent (the band is never sent alongside)', async () => {
    open();
    fireEvent.change(document.getElementById('diag-ageband'), { target: { value: '25-59' } });
    fireEvent.change(document.getElementById('diag-birthdate'), { target: { value: '1992-03-10' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Locataire' }));
    fireEvent.click(document.getElementById('diag-calculate-btn')); await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].answers.birthDate).toBe('1992-03-10'); expect(sent[0].answers.ageBand).toBeUndefined();
  });
  it('the exact date is no longer marked required: the field says that a band is an alternative', () => {
    open(); expect(document.getElementById('diag-birthdate')).not.toBeRequired();
    expect(document.querySelector('label[for="diag-birthdate"]').textContent).toMatch(/date de naissance/i);
    expect(screen.getByText(/si vous ne souhaitez pas donner votre date de naissance/i)).toBeInTheDocument();
  });
});
