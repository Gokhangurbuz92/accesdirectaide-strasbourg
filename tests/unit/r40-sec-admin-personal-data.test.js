/**
 * R40 security — administrator reads of personal data need an MFA session: the exchanges journal (and its CSV export), the application logs, the
 * administrator sessions; the dashboard keeps its counts but withholds the recent log entries. A CSV export is audited before it is sent (fail-closed) and
 * its cells cannot be read as spreadsheet formulas. An orchestrator run is audited and its error text is not returned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saved = { ...process.env };
const state = { audits: [], failInsert: false, logs: [], reportQueries: [] };
const chain = (rows) => { const c = { from: () => c, where: () => c, limit: async () => rows, groupBy: async () => rows, orderBy: () => c, then: (ok) => ok(rows) }; return c; };
const mk = () => ({ statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, end() { return this; }, on() {} });

beforeEach(() => {
  vi.resetModules();
  Object.assign(process.env, { JWT_SECRET: 'j'.repeat(40), AUTH_SECRET: 'a'.repeat(40), NODE_ENV: 'development', ENABLE_AI_AGENT: 'true' });
  Object.assign(state, { reportQueries: [], audits: [], failInsert: false, logs: [{ createdAt: '2026-11-01T00:00:00Z', message: '=HYPERLINK("http://x.test")', intent: '+cmd', searchMode: 'rag', sourceCount: 1, rating: 1, userComment: '@SUM(A1)' }] });
  vi.doMock('../../src/db/index.js', () => ({ db: {
    select: (fields) => chain(state.reportQueries.length && fields && Object.keys(fields).join() === 'count' ? [{ count: 1 }] : []),
    insert: () => ({ values: (v) => { if (state.failInsert) return Promise.reject(new Error('down')); state.audits.push(v); return Promise.resolve(); } }),
    query: {
      ConversationLog: { findMany: async () => state.logs },
      PartnershipRequest: { findMany: async () => [{ id: 'p1', email: 'submitter@example.test', message: 'hello' }] },
      ContentReport: { findMany: async (q) => { state.reportQueries.push(q); return [{ id: 'r1', reporterEmail: 'reporter@example.test', message: 'x' }]; } },
    },
    execute: async (q) => ({ rows: JSON.stringify(q?.queryChunks || '').includes('InstitutionAccount') ? [{ id: 'i1', email: 'staff@example.test' }] : [] }),
  } }));
  vi.doMock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '203.0.113.9', getRateLimitStatus: () => 429 }));
  vi.doMock('../../api/lib/log-store.js', () => ({ getLogs: async () => [{ level: 'error', msg: 'synthetic error for a@example.test' }], logStoreConfigured: () => true }));
  vi.doMock('../../api/lib/agent-orchestrator.js', () => ({ runOrchestrator: async () => { throw new Error('internal detail /srv/secret/path'); } }));
});
afterEach(() => { process.env = { ...saved }; vi.resetModules(); for (const m of ['../../src/db/index.js', '../../api/_utils/rateLimit.js', '../../api/lib/log-store.js', '../../api/lib/agent-orchestrator.js']) vi.doUnmock(m); });

const call = async (mod, { method = 'GET', url, mfa }) => {
  const auth = await import('../../api/_utils/auth.js');
  const token = auth.signAdminSessionToken({ email: 'admin@example.test', role: 'admin', mfa_verified: mfa });
  const h = (await import(mod)).default; const r = mk();
  await h({ method, url, query: Object.fromEntries(new URL(url, 'http://x').searchParams), body: {}, headers: { host: 'localhost', authorization: `Bearer ${token}` } }, r);
  return r;
};

describe('administrator personal-data reads', () => {
  it('the exchanges journal needs MFA; with MFA it is served', async () => {
    expect((await call('../../api/_handlers/admin/conversations.js', { url: '/api/admin/conversations', mfa: false })).statusCode).toBe(403);
    expect((await call('../../api/_handlers/admin/conversations.js', { url: '/api/admin/conversations', mfa: true })).statusCode).toBe(200);
  });
  it('the CSV export is audited first, refused when the audit cannot be written, and neutralises formulas', async () => {
    const r = await call('../../api/_handlers/admin/conversations.js', { url: '/api/admin/conversations?format=csv', mfa: true });
    expect(r.statusCode).toBe(200);
    expect(state.audits).toEqual([expect.objectContaining({ action: 'ADMIN_PERSONAL_DATA_EXPORT', actor: 'admin@example.test', entity_id: 'conversations' })]);
    expect(JSON.stringify(state.audits[0].details)).not.toContain('HYPERLINK');
    const line = r.body.split('\n')[1];
    expect(line).toContain(`"'=HYPERLINK(""http://x.test"")"`);
    expect(line).toContain(`"'+cmd"`);
    expect(line).toContain(`"'@SUM(A1)"`);
    expect(line).not.toMatch(/(^|,)"?[=+@]/);
    state.failInsert = true;
    expect((await call('../../api/_handlers/admin/conversations.js', { url: '/api/admin/conversations?format=csv', mfa: true })).statusCode).toBe(503);
    expect((await call('../../api/_handlers/admin/conversations.js', { url: '/api/admin/conversations?format=csv', mfa: false })).statusCode).toBe(403);
  });
  it('application logs and administrator sessions need MFA', async () => {
    expect((await call('../../api/_handlers/admin/logs.js', { url: '/api/admin/logs', mfa: false })).statusCode).toBe(403);
    expect((await call('../../api/_handlers/admin/logs.js', { url: '/api/admin/logs', mfa: true })).statusCode).toBe(200);
    expect((await call('../../api/_handlers/admin/sessions.js', { url: '/api/admin/sessions', mfa: false })).statusCode).toBe(403);
  });
  it('the dashboard withholds the recent log entries from a password-only session', async () => {
    const plain = await call('../../api/_handlers/admin/dashboard.js', { url: '/api/admin/dashboard', mfa: false });
    expect(plain.body.recentErrors).toEqual([]);
    expect(plain.body.recentErrorsWithheld).toBe('ADMIN_MFA_REQUIRED');
    const strong = await call('../../api/_handlers/admin/dashboard.js', { url: '/api/admin/dashboard', mfa: true });
    expect(strong.body.recentErrors).toHaveLength(1);
  });
  it('an orchestrator run is audited and its error text is not returned', async () => {
    const r = await call('../../api/_handlers/admin/orchestrator.js', { method: 'POST', url: '/api/admin/orchestrator', mfa: true });
    expect(r.statusCode).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('/srv/secret');
    expect(state.audits).toEqual([expect.objectContaining({ action: 'ADMIN_ORCHESTRATOR_RUN', actor: 'admin@example.test', details: { dryRun: false, outcome: 'failed' } })]);
  });
});

describe('R41-K F2: three more administrator reads of personal data need MFA', () => {
  const routes = [
    ['../../api/_handlers/admin/partnerships.js', '/api/admin/partnerships', 'submitter@example.test'],
    ['../../api/_handlers/reports.js', '/api/reports?status=NEW', 'reporter@example.test'],
    ['../../api/_handlers/admin/institutions.js', '/api/admin/institutions', 'staff@example.test'],
  ];
  it.each(routes)('%s: a password-only session gets 403 and no rows; an MFA session gets 200', async (mod, url, email) => {
    const plain = await call(mod, { url, mfa: false });
    expect(plain.statusCode).toBe(403);
    expect(JSON.stringify(plain.body)).not.toContain(email);
    expect(JSON.stringify(plain.body)).toMatch(/ADMIN_MFA_REQUIRED|HUMAN_MFA_SESSION_REQUIRED/);
    const strong = await call(mod, { url, mfa: true });
    expect(strong.statusCode).toBe(200);
    expect(JSON.stringify(strong.body)).toContain(email);
  });
  it('the reports list caps its page size at 100 (and at least 1)', async () => {
    const big = await call('../../api/_handlers/reports.js', { url: '/api/reports?limit=100000', mfa: true });
    expect(big.body.pagination.limit).toBe(100);
    expect(state.reportQueries.at(-1).limit).toBe(100);
    const odd = await call('../../api/_handlers/reports.js', { url: '/api/reports?limit=-5&page=-2', mfa: true });
    expect(state.reportQueries.at(-1)).toMatchObject({ limit: 1, offset: 0 });
    expect(odd.body.pagination.page).toBe(1);
    await call('../../api/_handlers/reports.js', { url: '/api/reports?limit=abc', mfa: true });
    expect(state.reportQueries.at(-1).limit).toBe(50);
  });
});

describe('csvCell', () => {
  it('quotes every value and prefixes formula starters', async () => {
    const { csvCell } = await import('../../api/_utils/admin-personal-data.js');
    expect(csvCell('=1+1')).toBe(`"'=1+1"`);
    expect(csvCell('-2')).toBe(`"'-2"`);
    expect(csvCell('\tx')).toBe(`"'\tx"`);
    expect(csvCell('a "b"')).toBe('"a ""b"""');
    expect(csvCell(null)).toBe('""');
  });
});
