/**
 * PKG-6 / D21 — the RAW error-capture path (Sentry.captureException on any exception, as api/index.js, wrapper.js, aides.js and with-pro-rdv-handler.js do) with the
 * REAL @sentry/node SDK and the application's own server scrubber as beforeSend, captured by an in-memory transport (nothing leaves the process; synthetic values).
 */
import * as Sentry from '@sentry/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sanitizeSentryBreadcrumb, sanitizeSentryEvent } from '../../api/_utils/sentryServer.js';

const envelopes = [];
const events = () => envelopes.flatMap((e) => (e[1] || []).filter((i) => i[0] && i[0].type === 'event').map((i) => i[1]));
const flush = () => Sentry.flush(2000);
const PII = { mail: 'jeanne.qa@example.test', nir: '1 85 05 67 482 123 45', iban: 'FR76 3000 6000 0112 3456 7890 189', tel: '06 12 34 56 78', body: 'BODY_SENTINEL_7f2', query: 'QUERY_SENTINEL_b81', file: 'FILE_SENTINEL_33c', cookie: 'COOKIE_SENTINEL_0aa', token: 'TOKEN_SENTINEL_9d1' };

beforeAll(() => {
  Sentry.init({ dsn: 'https://public@sentry-offline.invalid/1', release: 'd21-test', environment: 'test', tracesSampleRate: 0, sendDefaultPii: false,
    beforeSend: sanitizeSentryEvent, beforeBreadcrumb: sanitizeSentryBreadcrumb, transport: () => ({ send: async (env) => { envelopes.push(env); return {}; }, flush: async () => true }) });
});
afterAll(async () => { await Sentry.close(2000); });
beforeEach(() => { envelopes.length = 0; });

describe('PKG-6 / D21 raw exception capture: nothing sensitive is sent, a technical code survives, an event that cannot be cleaned is dropped', () => {
  it('request body, credentials, cookies / headers, query text, file content and a sensitive error message never reach the transport', async () => {
    const err = new Error(`upload failed for ${PII.mail} (NIR ${PII.nir}) content=${PII.file}`, { cause: new Error(`IBAN ${PII.iban} tel ${PII.tel}`) });
    Sentry.withScope((scope) => {
      scope.setContext('request', {});
      scope.addEventProcessor((ev) => ({ ...ev, request: { url: `https://x.test/api/search?q=${PII.query}`, query_string: `q=${PII.query}`, data: `{"note":"${PII.body}","email":"${PII.mail}"}`,
        headers: { authorization: `Bearer ${PII.token}`, cookie: `sid=${PII.cookie}`, 'x-forwarded-for': '203.0.113.9', 'user-agent': 'qa' }, cookies: { sid: PII.cookie } } }));
      scope.setExtra('requestId', 'req_d21'); scope.setExtra('note', `see ${PII.mail}`); scope.setTag('route', 'pro/dossier');
      Sentry.captureException(err);
    });
    await flush();
    const [ev] = events(); expect(ev, 'the scrubbed event is still sent').toBeTruthy();
    const t = JSON.stringify(envelopes);
    for (const [k, v] of Object.entries(PII)) {
      expect(t.includes(v), `${k} reached the transport`).toBe(false);
      expect(t.includes(v.replace(/\s/g, '')), `${k} (compact) reached the transport`).toBe(false);
    }
    expect(ev.exception.values.map((x) => x.type)).toContain('Error');
    expect(ev.exception.values.every((x) => x.value === '[message removed: may contain request data]')).toBe(true);
    expect(ev.extra.requestId).toBe('req_d21'); expect(ev.tags.route).toBe('pro/dossier');   // safe diagnostics stay
    expect(ev.exception.values.flatMap((x) => x.stacktrace?.frames || []).some((f) => f.filename && f.lineno)).toBe(true);   // code location stays
  });

  it('a technical error code is kept as the message', async () => {
    Sentry.captureException(new Error('OPENFISCA_UNAVAILABLE'));
    await flush();
    expect(events()[0].exception.values[0].value).toBe('OPENFISCA_UNAVAILABLE');
  });

  it('captureMessage text is scrubbed the same way', async () => {
    Sentry.captureMessage(`cannot reach ${PII.mail}`);
    await flush();
    expect(JSON.stringify(envelopes)).not.toContain(PII.mail);
  });

  it('an event that still carries an identifier in a field the scrubber does not rewrite is dropped, not sent', async () => {
    Sentry.withScope((scope) => { scope.setTransactionName(`GET /api/x/${PII.mail}`); Sentry.captureException(new Error('INTERNAL_ERROR')); });
    await flush();
    expect(events()).toEqual([]);
    expect(JSON.stringify(envelopes)).not.toContain(PII.mail);
  });
});

describe('PKG-6 / D21 single scrubbed server client', () => {
  it('no server module initialises Sentry except api/_utils/sentryServer.js (which installs the scrubber)', async () => {
    const fs = await import('node:fs'); const path = await import('node:path');
    const walk = (d) => fs.readdirSync(d).flatMap((n) => { const p = path.join(d, n); return fs.statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : /\.(m?js|ts)$/.test(n) && !/\.test\./.test(n) ? [p] : []; });
    const code = (f) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // comments may name it
    const inits = walk('api').filter((f) => /Sentry\.init\s*\(|new\s+NodeClient\s*\(/.test(code(f)));
    expect(inits).toEqual(['api/_utils/sentryServer.js']);
    expect(fs.readFileSync('api/_utils/sentryServer.js', 'utf8')).toMatch(/beforeSend: sanitizeSentryEvent/);
  });
});
