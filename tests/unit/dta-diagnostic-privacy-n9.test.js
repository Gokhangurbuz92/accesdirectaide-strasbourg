/**
 * N9 — what does /api/diagnostic actually persist, log or emit as telemetry?  (PRODUCT_FLOW_CONTRACT v0.3, Q-N5 provisional design)
 * Method: run the REAL handler with every sink replaced by a recorder (database writes, logger, Sentry, rate limiter) and search every recorded
 * byte for unique sentinel values that only appear in the citizen's answers.  This is a MOCKED-SINK test: it proves the handler's own code paths,
 * not the real database (see tests/integration/dta-diagnostic-persistence-db.test.js for the real-PostgreSQL scan, which needs the native harness).
 * Nothing here establishes a retention policy, a lawful basis or a privacy notice (human/legal validation required).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const S = vi.hoisted(() => ({ db: [], logs: [], sentry: [], resp: [], mode: { engineUp: false, calc: null, traceErr: null }, admin: false }));
const rec = (kind, table, payload) => S.db.push({ kind, table, payload });
vi.mock('../../src/db/index.js', () => {
  const chain = (kind, table) => ({
    values(v) { rec(kind, table, v); return { returning: async () => [{ id: 'sync-run-1' }], then: (r) => r() }; },
    set(v) { rec(kind, table, v); return { where: async () => [] }; },
    where() { rec(kind, table, 'WHERE'); return Promise.resolve([]); },
  });
  const other = (kind) => (...a) => { rec(kind, 'UNKNOWN', a); return Promise.resolve({ rows: [] }); };
  return { db: { insert: (t) => chain('insert', t), update: (t) => chain('update', t), delete: (t) => chain('delete', t), execute: other('execute'), select: other('select'), transaction: other('transaction') } };
});
vi.mock('../../api/_utils/logger.js', () => {
  const m = (lvl) => (...a) => { S.logs.push({ lvl, a }); };
  return { default: { info: m('info'), warn: m('warn'), error: m('error'), debug: m('debug'), child: () => ({ info: m('info'), warn: m('warn'), error: m('error'), debug: m('debug') }) } };
});
vi.mock('@sentry/node', () => ({ captureException: (...a) => S.sentry.push({ kind: 'exception', a }), captureMessage: (...a) => S.sentry.push({ kind: 'message', a }), addBreadcrumb: (...a) => S.sentry.push({ kind: 'breadcrumb', a }), setContext: (...a) => S.sentry.push({ kind: 'context', a }), setUser: (...a) => S.sentry.push({ kind: 'user', a }), withScope: (f) => f({ setExtra() {}, setTag() {} }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/auth.js', () => ({ resolveAuthContext: async () => (S.admin ? { authType: 'admin_token' } : null) }));
vi.mock('../../api/lib/openfiscaClient.js', () => ({ isAvailable: async () => S.mode.engineUp, calculate: async () => { if (S.mode.calc) throw S.mode.calc; return {}; }, trace: async () => { if (S.mode.traceErr) throw S.mode.traceErr; return {}; } }));

import handler from '../../api/_handlers/diagnostic.js';
import { SyncRun } from '../../src/db/schema.js';
import { ERROR_CODES } from '../../api/lib/diagnosticErrors.js';
const ERROR_CODE_VALUES = Object.values(ERROR_CODES);

// unique values that exist ONLY in the citizen's answers
const SENT = { salary: 1234567.891, unemployment: 7654321.123, rent: 8765.432, zip: 'SENTINEL-ZIP-9f3a', status: 'SENTINEL_STATUS_c7d1', extra: 'SENTINEL_FREETEXT_b2e5' };
const answers = () => ({ birthDate: '1987-04-09', householdSize: 3, income: { salary: SENT.salary, unemployment: SENT.unemployment }, housing: { status: SENT.status, rent: SENT.rent, charges: 12 }, zipCode: SENT.zip, territory: SENT.zip, note: SENT.extra });
const NEEDLES = [String(SENT.salary), String(SENT.unemployment), String(SENT.rent), SENT.zip, SENT.status, SENT.extra, '1987-04-09'];

const call = async (body, { method = 'POST', url = '/api/diagnostic' } = {}) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader() {}, end() { return this; } };
  await handler({ method, url, headers: { host: 'x', 'x-forwarded-for': '203.0.113.9' }, socket: {}, body }, res);
  S.resp.push({ status: res.statusCode, body: res.body });
  return res;
};
const ser = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'function' ? '[fn]' : x instanceof Error ? { name: x.name, message: x.message, code: x.code, detail: x.detail } : x));
const sinks = () => ({ db: ser(S.db.map((d) => ({ ...d, table: d.table === SyncRun ? 'SyncRun' : String(d.table?.name || d.table) }))), logs: ser(S.logs), sentry: ser(S.sentry), resp: ser(S.resp) });
const leaks = (needles = NEEDLES, only = null) => { const s = sinks(); return needles.flatMap((n) => Object.entries(s).filter(([k, text]) => (!only || only.includes(k)) && text.includes(n)).map(([sink]) => `${sink}:${n}`)); };
// V8 quotes a ~10-character window around the failing token in JSON.parse errors, so a partial value is the realistic leak: `Unexpected token 'S', ..."{"status":SENTINEL_S"... is not valid JSON`
const BROKEN_BODY = `{"answers":{"housing":{"status":${SENT.status},"rent":${SENT.rent}},"note":"x"}}`;   // unquoted value => token error that quotes the value
const PARTIAL = ['SENTINEL_S'];

beforeEach(() => { S.db.length = 0; S.logs.length = 0; S.sentry.length = 0; S.resp.length = 0; S.mode.engineUp = false; S.mode.calc = null; S.mode.traceErr = null; S.admin = false; });

describe('N9 — SIMULATION_MODE happy path', () => {
  it('answers are processed in memory: 200, only SyncRun metadata is written, no sentinel in any DB write / log / Sentry call', async () => {
    const r = await call({ mode: 'SIMULATION_MODE', answers: answers() });
    expect(r.statusCode).toBe(200);
    expect(S.db.length).toBeGreaterThan(0);
    for (const d of S.db) expect(['insert', 'update']).toContain(d.kind);
    for (const d of S.db) expect(d.table).toBe(SyncRun);                                         // no other table is written
    expect(leaks()).toEqual([]);
  });
  it('SyncRun stats contain only whitelisted metadata keys (no answers, no birth date, no territory)', async () => {
    await call({ mode: 'SIMULATION_MODE', answers: answers() });
    const keys = new Set(S.db.flatMap((d) => (d.payload && typeof d.payload === 'object' ? Object.keys(d.payload.stats || d.payload) : [])));
    const allowed = new Set(['id', 'source_id', 'status', 'started_at', 'ended_at', 'stats', 'requestId', 'duration_ms', 'rightsCount', 'mode', 'eligibleCount', 'variables', 'error']);
    expect([...keys].filter((k) => !allowed.has(k))).toEqual([]);
  });
  it('the response is the only place derived values appear (it is returned to the same citizen)', async () => {
    const r = await call({ mode: 'SIMULATION_MODE', answers: answers() });
    expect(r.body.authoritative).toBe(false);
    expect(ser(r.body)).not.toContain(SENT.zip);                                               // free-text territory is not echoed
  });
});

describe('N9 — failure paths', () => {
  it('authoritative engine unavailable (503): nothing from the answers is stored or logged, and no local fallback result is returned', async () => {
    const r = await call({ answers: answers() });                                               // default AUTHORITATIVE_MODE, engine down
    expect(r.statusCode).toBe(503);
    expect(r.body.error).toBe('OPENFISCA_UNAVAILABLE');
    expect(r.body.rights).toBeUndefined();
    expect(leaks()).toEqual([]);
  });
  it('upstream engine error carrying echoed input in err.detail: nothing reaches the database, the logger, Sentry or the HTTP response', async () => {
    S.mode.engineUp = true;
    S.mode.calc = Object.assign(new Error('upstream rejected the request'), { status: 422, detail: { echo: answers() } });
    const r = await call({ answers: answers() });
    expect(r.statusCode).toBe(422);
    expect(r.body.detail).toBeUndefined();                                                   // contract change (documented): the upstream response text is no longer echoed
    expect(leaks()).toEqual([]);
  });
  it('Sentry receives only a synthetic DiagnosticError whose message is an allowlisted code (never the original exception, detail, cause or stack)', async () => {
    S.mode.engineUp = true;
    const bad = Object.assign(new Error(`engine said ${SENT.status}`), { status: 422, detail: { echo: answers() }, cause: new Error(SENT.extra) });
    S.mode.calc = bad;
    await call({ answers: answers() });
    const ex = S.sentry.filter((x) => x.kind === 'exception');
    expect(ex.length).toBeGreaterThan(0);
    for (const x of ex) {
      expect(x.a[0]).not.toBe(bad);
      expect(x.a[0].name).toBe('DiagnosticError');
      expect(x.a[0].cause).toBeUndefined();
      expect(x.a[0].detail).toBeUndefined();
      expect(ERROR_CODE_VALUES).toContain(x.a[0].message);
      expect(Object.keys(x.a[1].extra).sort()).toEqual(['duration_ms', 'phase', 'requestId']);
    }
    expect(leaks()).toEqual([]);
  });
  it('validation failure (400) stores and logs nothing from the answers', async () => {
    const bad = answers(); bad.income.salary = -SENT.salary;
    const r = await call({ mode: 'SIMULATION_MODE', answers: bad });
    expect(r.statusCode).toBe(400);
    expect(leaks()).toEqual([]);
  });
  // REGRESSION (was `it.fails` KNOWN DEFECT in stage 1): a string body that is not valid JSON made JSON.parse throw a SyntaxError whose message QUOTES a ~10-char
  // window of the body (Node 22: `Unexpected token 'x', "...snippet..." is not valid JSON`); the catch block copied it to logger.error, SyncRun.error and Sentry.
  it('REGRESSION: an unparsable string body leaks no fragment into DB writes, logs, Sentry or the HTTP response, and answers 400 invalid_json', async () => {
    const r = await call(BROKEN_BODY);
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('invalid_json');
    expect(leaks(PARTIAL)).toEqual([]);
    expect(leaks()).toEqual([]);
    const sync = S.db.filter((d) => d.kind === 'update').map((d) => d.payload);
    expect(sync.some((p) => p && p.status === 'failed' && p.error === 'INVALID_JSON')).toBe(true);   // observability kept: code only
    expect(S.sentry.filter((x) => x.kind === 'exception')).toEqual([]);                          // client fault, not an incident
  });
  it('MEASUREMENT (root cause, independent of the handler): V8 really does quote a fragment of the body in the JSON.parse error', () => {
    let msg = '';
    try { JSON.parse(BROKEN_BODY); } catch (e) { msg = e.message; }
    expect(msg).toContain(PARTIAL[0]);
  });
  it('same for the trace route (admin): unparsable body => 400, nothing leaks', async () => {
    S.admin = true;
    const r = await call(BROKEN_BODY, { url: '/api/diagnostic/trace' });
    expect(r.statusCode).toBe(400);
    expect(leaks(PARTIAL)).toEqual([]);
    expect(leaks()).toEqual([]);
  });
  it('trace route: an unexpected exception whose message/cause/detail carry the answers is reported by code only (503, fixed text)', async () => {
    S.admin = true;
    S.mode.traceErr = Object.assign(new Error(`boom ${SENT.status} ${SENT.rent}`), { cause: new Error(SENT.extra), detail: SENT.zip });
    const r = await call({ answers: answers() }, { url: '/api/diagnostic/trace' });
    expect(r.statusCode).toBe(503);
    expect(r.body.error).toBe('OPENFISCA_UNAVAILABLE');
    expect(leaks()).toEqual([]);
    expect(S.logs.some((l) => l.lvl === 'error' && ser(l.a).includes('INTERNAL_ERROR'))).toBe(true);
  });
  it('unexpected exception (message, cause, detail, stack all carry the answers): 503 DIAGNOSTIC_ERROR with fixed text, code-only observability', async () => {
    S.mode.engineUp = true;
    const boom = new Error(`boom ${SENT.status} ${SENT.rent} ${SENT.zip}`); boom.cause = new Error(SENT.extra); boom.detail = SENT.note; boom.stack = `Error: ${SENT.extra}\n at x`;
    S.mode.calc = boom;
    const r = await call({ answers: answers() });
    expect(r.statusCode).toBe(503);
    expect(r.body.error).toBe('DIAGNOSTIC_ERROR');
    expect(leaks()).toEqual([]);
    expect(S.logs.some((l) => l.lvl === 'error' && ser(l.a).includes('INTERNAL_ERROR'))).toBe(true);
  });
  it('engine error flagged fallback with a hostile message: the response uses the fixed text, not err.message', async () => {
    S.mode.engineUp = true;
    S.mode.calc = Object.assign(new Error(`hostile ${SENT.status}`), { fallback: true, status: 503, code: 'OPENFISCA_NETWORK_ERROR' });
    const r = await call({ answers: answers() });
    expect(r.statusCode).toBe(503);
    expect(r.body.fallback).toBe(true);
    expect(r.body.error).toBe('Le simulateur national des aides est momentanément indisponible. Veuillez réessayer plus tard.');
    expect(leaks()).toEqual([]);
  });
  it('health-check exception (message carries the answers): logged by code only and reported as a synthetic event', async () => {
    const mod = await import('../../api/lib/openfiscaClient.js');
    expect(mod).toBeDefined();
    // the mocked isAvailable cannot throw by itself; flip it for this call
    S.mode.engineUp = new Proxy({}, { get() { throw new Error(`healthcheck ${SENT.status}`); } });
    const r = await call({ answers: answers() });
    expect(r.statusCode).toBe(503);
    expect(leaks()).toEqual([]);
    expect(S.logs.some((l) => l.lvl === 'warn' && ser(l.a).includes('HEALTHCHECK_FAILED'))).toBe(true);   // the exception path really ran
  });
});

describe('N9 — separation and static guards', () => {
  const src = readFileSync(new URL('../../api/_handlers/diagnostic.js', import.meta.url), 'utf8');
  it('diagnostic processing is separate from sharing: the handler imports no sharing/dossier module and writes only SyncRun', () => {
    expect(src).not.toMatch(/SharedDiagnostic|SharedDossier|share-access|dossier-grants|rightsSecret/i);
    const tables = [...src.matchAll(/db\.(?:insert|update|delete)\((\w+)\)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(['SyncRun']));
  });
  it('the global request logger records method/path/query/user-agent only, never the body', () => {
    const idx = readFileSync(new URL('../../api/index.js', import.meta.url), 'utf8');
    const block = idx.slice(idx.indexOf('msg: "Incoming Request"'), idx.indexOf('msg: "Incoming Request"') + 400);
    expect(block).not.toMatch(/\bbody\b/);
  });
  it('the diagnostic route is not covered by the validation registry (so the handler-level JSON.parse path is the one under test)', () => {
    const reg = readFileSync(new URL('../../api/_utils/validation-registry.js', import.meta.url), 'utf8');
    expect(reg).not.toMatch(/['"]diagnostic['"]\s*:/);
  });
});
