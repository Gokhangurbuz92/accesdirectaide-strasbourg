/**
 * The OpenFisca client used to forward the RAW upstream error (err.detail = first 200 chars of the upstream response body) to Sentry.
 * It now forwards a synthetic code-only event.  Real client module, fetch stubbed, Sentry + logger recorded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const R = vi.hoisted(() => ({ sentry: [], logs: [] }));
vi.mock('@sentry/node', () => ({ captureException: (...a) => R.sentry.push(a), captureMessage: (...a) => R.sentry.push(a) }));
vi.mock('../../api/lib/logger.js', () => { const m = (l) => (...a) => R.logs.push({ l, a }); return { logger: { info: m('info'), warn: m('warn'), error: m('error'), debug: m('debug') } }; });

const ECHO = 'SENTINEL_ECHO_status_c7d1';
const ser = (v) => JSON.stringify(v, (_k, x) => (x instanceof Error ? { name: x.name, message: x.message, code: x.code, detail: x.detail, cause: x.cause && String(x.cause.message), stack: x.stack } : x));

beforeEach(() => { R.sentry.length = 0; R.logs.length = 0; vi.resetModules(); vi.stubEnv('OPENFISCA_URL', 'http://127.0.0.1:5000'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('openfiscaClient telemetry is code-only', () => {
  it('upstream 400 whose body echoes the input: the caller gets the friendly fallback error; Sentry gets a synthetic ENGINE_* event without the body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, text: async () => `{"individus":{"ind":{"salaire":{"2026-09":"${ECHO}"}}}}`, json: async () => ({}) })));
    const { calculate } = await import('../../api/lib/openfiscaClient.js');
    const err = await calculate({ individus: { a: {} } }).catch((e) => e);
    expect(err.fallback).toBe(true);
    expect(err.detail).toBeUndefined();
    expect(R.sentry.length).toBeGreaterThan(0);
    for (const [e, ctx] of R.sentry) {
      expect(e.name).toBe('DiagnosticError');
      expect(e.message).toMatch(/^ENGINE_[A-Z_]+$|^INTERNAL_ERROR$/);
      expect(ctx.tags.service).toBe('diagnostic');
    }
    expect(ser(R.sentry)).not.toContain(ECHO);
    expect(ser(R.logs)).not.toContain(ECHO);
  });
  it('network failure and timeout are classified, not forwarded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { const e = new Error(`connect ECONNREFUSED ${ECHO}`); e.cause = new Error(ECHO); throw e; }));
    const { calculate } = await import('../../api/lib/openfiscaClient.js');
    await calculate({ individus: {} }).catch(() => {});
    expect(ser(R.sentry)).not.toContain(ECHO);
    expect(ser(R.logs)).not.toContain(ECHO);
  });
  it('static guard: the client no longer passes a caught error object to Sentry', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../api/lib/openfiscaClient.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/Sentry\.captureException\(\s*err/);
  });
});
