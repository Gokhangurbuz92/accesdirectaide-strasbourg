/**
 * Offline evidence about what the REAL @sentry/node SDK would transmit (DTA S1 stage 2a).  The SDK is initialised with a synthetic DSN and a CUSTOM TRANSPORT
 * that captures the envelopes in memory — nothing leaves the process, no real personal data, no external telemetry.
 * beforeSend is the application's own scrubber (api/_utils/sentryServer.js sanitizeSentryEvent), so the findings reflect the real app configuration, with these limits:
 *  - the application's Sentry.init lives in sentryServer.js and only runs when a DSN exists (env); this test mirrors its options (beforeSend, beforeBreadcrumb)
 *    but cannot see the production DSN/integrations/release configuration  => production transmission stays UNVERIFIED;
 *  - results are for the installed SDK version printed below.
 */
import * as Sentry from '@sentry/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sanitizeSentryBreadcrumb, sanitizeSentryEvent } from '../../api/_utils/sentryServer.js';
import { captureSafe } from '../../api/lib/diagnosticErrors.js';

const envelopes = [];
const SENT = { frag: 'SENTINEL_STATUS_c7d1', detail: 'SENTINEL_DETAIL_a9b2', extra: 'SENTINEL_EXTRA_55e0', cause: 'SENTINEL_CAUSE_01ff' };
const text = () => JSON.stringify(envelopes);
const events = () => envelopes.filter((e) => (e[1] || []).some((i) => i[0] && i[0].type === 'event'));   // ignore session/other envelopes
const flush = async () => { await Sentry.flush(2000); };

beforeAll(() => {
  Sentry.init({
    dsn: 'https://public@sentry-offline.invalid/1', release: 'offline-test', environment: 'test', tracesSampleRate: 0, sendDefaultPii: false,
    beforeSend: sanitizeSentryEvent, beforeBreadcrumb: sanitizeSentryBreadcrumb,
    transport: () => ({ send: async (env) => { envelopes.push(env); return {}; }, flush: async () => true }),
  });
});
afterAll(async () => { await Sentry.close(2000); });
beforeEach(() => { envelopes.length = 0; });

describe('real Sentry SDK, offline transport, application scrubber as beforeSend', () => {
  it('SDK version under test is recorded', () => {
    const v = JSON.parse(JSON.stringify(Sentry.SDK_VERSION ?? 'unknown'));
    console.log('Sentry SDK version (offline evidence):', v);
    expect(typeof v).toBe('string');
  });

  // PKG-6 / D21 overlay (owner decision 2026-10-21, D21_SENTRY_OVERLAY_V1.md): the two CONTROLS below recorded a LEAK (raw exception messages reached Sentry). The
  // server scrubber now removes exception / log messages (only a technical CODE survives), so these expectations are inverted; the measurement setup is unchanged.
  it('D21: a raw SyntaxError from JSON.parse NO LONGER transmits the quoted body fragment — the app scrubber covers exception.values[].value (only the error type and a code survive)', async () => {
    let err; try { JSON.parse(`{"answers":{"housing":{"status":${SENT.frag},"rent":1}}}`); } catch (e) { err = e; }
    Sentry.captureException(err, { extra: { requestId: 'r1', phase: 'diagnostic' } });
    await flush();
    expect(events().length).toBe(1);
    expect(text()).not.toContain('SENTINEL_S');
    expect(text()).toContain('SyntaxError');   // still useful: the error type and the frames' code locations
  });

  it('CONTROL: a custom own property (err.detail) on a raw Error is NOT serialized by the default SDK integrations (measured, SDK-version dependent)', async () => {
    const e = Object.assign(new Error('OpenFisca /calculate returned 400'), { status: 400, detail: SENT.detail });
    Sentry.captureException(e, { tags: { service: 'openfisca' } });
    await flush();
    expect(events().length).toBe(1);
    expect(text()).not.toContain(SENT.detail);
  });

  it('D21: err.cause message is NO LONGER transmitted (linked errors are scrubbed too)', async () => {
    const e = new Error('outer', { cause: new Error(SENT.cause) });
    Sentry.captureException(e);
    await flush();
    expect(text()).not.toContain(SENT.cause);
  });

  it('FIXED PATH: captureSafe transmits only the allowlisted code, tags and opaque ids — no sentinel of any kind', async () => {
    expect(captureSafe(Sentry, 'INTERNAL_ERROR', { requestId: 'diag_x_y', phase: 'diagnostic', durationMs: 12 })).toBe(true);
    await flush();
    expect(events().length).toBe(1);
    const t = text();
    for (const s of Object.values(SENT)) expect(t).not.toContain(s);
    expect(t).toContain('INTERNAL_ERROR');
    expect(t).toContain('DiagnosticError');
  });

  it('client faults (invalid JSON / validation) send nothing to Sentry', async () => {
    expect(captureSafe(Sentry, 'INVALID_JSON', { requestId: 'r' })).toBe(false);
    expect(captureSafe(Sentry, 'VALIDATION_ERROR', { requestId: 'r' })).toBe(false);
    await flush();
    expect(events().length).toBe(0);
  });

  it('values outside the closed vocabulary are refused (no free-text code can smuggle data)', async () => {
    expect(captureSafe(Sentry, `boom ${SENT.frag}`, { requestId: 'r' })).toBe(false);
    await flush();
    expect(events().length).toBe(0);
  });
});
