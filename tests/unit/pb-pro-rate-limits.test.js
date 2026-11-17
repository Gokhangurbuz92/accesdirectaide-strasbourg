/**
 * A23 / A24 (RECON_PRO_STRUCTURE_TERRITORY 2026-11-15) — rate limits of the professional routes that only had requireProAuth / requireProRole, and the
 * report file name.
 *   - sweep: every professional handler behind requireProAuth / requireProRole carries a limiter (withProRdvHandler, withProRateLimit, or its own checkRateLimit);
 *   - 429: the tenant read quota and the tighter budgets (exports, model calls, uploads) refuse BEFORE the handler runs; another member keeps their own budget;
 *   - A24: an unknown or hostile `period` never reaches Content-Disposition.
 * No database: authentication is replaced by a pass-through that sets req.user (the limiter is keyed on the authenticated member); in-memory counters.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const counters = new Map();
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async (k) => { const n = (counters.get(k) || 0) + 1; counters.set(k, n); return n; }, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));
vi.mock('../../api/_services/org-stats.js', async (orig) => ({ ...(await orig()), reportCsv: async () => ({ ok: true, csv: 'indicateur,valeur' }) }));
vi.mock('../../api/_utils/auth.js', async (orig) => {
  const real = await orig();
  const pass = (handler) => async (req, res) => { req.user = req.testUser; return handler(req, res); };
  return { ...real, requireProAuth: pass, requireProRole: (handler) => pass(handler), logProAudit: async () => {} };
});

const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return this.headers[String(k).toLowerCase()]; }, end() { return this; } });
const user = (id) => ({ userId: id, structureId: 'st-1', role: 'structure_admin' });
const call = async (h, u, { method = 'GET', url = '/api/pro/x', query = {}, body } = {}) => { const r = mk(); await h({ method, url, query, body, headers: { host: 'localhost' }, testUser: u }, r); return r; };

/** the wrapper as the routes mount it: after authentication */
const authed = (h) => async (req, res) => { req.user = req.testUser; return h(req, res); };
const PRO_DIR = 'api/_handlers/pro';
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.js$/.test(e.name) && !/\.test\./.test(e.name) ? [path.join(d, e.name)] : []));

describe('A23 — every authenticated professional route has a rate limit', () => {
  it('sweep of api/_handlers/pro: requireProAuth / requireProRole never stands alone', () => {
    const bare = walk(PRO_DIR).filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      if (!/requirePro(Auth|Role)\(/.test(src)) return false;   // pre-authentication routes (auth/*) and re-exports have their own rules
      return !/withProRdvHandler\(|withProRateLimit\(|checkRateLimit\(/.test(src);
    });
    expect(bare).toEqual([]);
  });
  it('the costly routes carry the tighter budget', () => {
    const tight = { 'dossier/export.js': 'PRO_EXPORT', 'interop-siao.js': 'PRO_EXPORT', 'reports.js': 'PRO_EXPORT', 'structure.js': 'PRO_EXPORT', 'ai/assist.js': 'PRO_AI', 'dossier-synthesis.js': 'PRO_AI',
      'agent-discovery.js': 'PRO_AI', 'agent-scheduler.js': 'PRO_AI', 'dossier/upload-secure.js': 'PRO_UPLOAD' };
    for (const [f, action] of Object.entries(tight)) expect(fs.readFileSync(path.join(PRO_DIR, f), 'utf8'), f).toContain(`'${action}'`);
  });
});

describe('A23 — 429 before the handler', () => {
  let withProRateLimit;
  beforeEach(async () => { counters.clear(); ({ withProRateLimit } = await import('../../api/_utils/pro-rate-limit.js')); });

  it('tenant read quota: the request over the per-minute budget is refused and the handler is not entered; another member is not affected', async () => {
    const { env } = await import('../../api/_utils/env.js');
    const limit = env.proRdv.readPerMinute;
    const inner = vi.fn(async (req, res) => res.status(200).json({ ok: true }));
    const h = authed(withProRateLimit('pro.test.read', inner));
    for (let i = 0; i < limit; i += 1) expect((await call(h, user('rl-a'))).statusCode).toBe(200);
    const over = await call(h, user('rl-a'));
    expect([over.statusCode, over.body.code]).toEqual([429, 'PRO_RATE_LIMITED']);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    expect(inner).toHaveBeenCalledTimes(limit);
    expect((await call(h, user('rl-b'))).statusCode).toBe(200);
  });

  it('a real route: the dossier export answers 429 after 20 exports in the window (PRO_EXPORT), whatever the dossier', async () => {
    const exp = (await import('../../api/_handlers/pro/dossier/export.js')).default;
    const u = user(`rl-exp-${Date.now()}`);
    const seen = [];
    for (let i = 0; i < 21; i += 1) seen.push((await call(exp, u, { url: `/api/pro/dossier/export?shareId=unknown-${i}&format=json` })).statusCode);
    expect(seen.slice(0, 20).every((s) => s !== 429)).toBe(true);
    expect(seen[20]).toBe(429);
    const last = await call(exp, u, { url: '/api/pro/dossier/export?shareId=x&format=json' });
    expect(last.body).toMatchObject({ code: 'PRO_RATE_LIMITED', scope: 'PRO_EXPORT' });
  });

  it('model calls: the 11th AI call of a member within a minute is refused (PRO_AI) and no model is called for it; a GET of a GET+POST route does not spend the tight budget', async () => {
    const inner = vi.fn(async (req, res) => res.status(200).json({ ok: true }));
    const h = authed(withProRateLimit('pro.test.ai', inner, { action: 'PRO_AI', methods: ['POST'] }));
    const u = user(`rl-ai-${Date.now()}`);
    for (let i = 0; i < 5; i += 1) expect((await call(h, u, { method: 'GET' })).statusCode).toBe(200);
    for (let i = 0; i < 10; i += 1) expect((await call(h, u, { method: 'POST' })).statusCode).toBe(200);
    const over = await call(h, u, { method: 'POST' });
    expect([over.statusCode, over.body.scope]).toEqual([429, 'PRO_AI']);
    expect(inner).toHaveBeenCalledTimes(15);
    expect((await call(h, u, { method: 'GET' })).statusCode).toBe(200);
  });

  it('an unknown tight budget is a programming error, not a silent default', () => {
    expect(() => withProRateLimit('x', async () => {}, { action: 'NOT_A_BUDGET' })).toThrow(/unknown action/);
    expect(() => withProRateLimit('x', async () => {}, { budget: 'NOT_A_BUDGET' })).toThrow(/unknown budget/);
  });

  // R47-QA (native QA v40, DTA-B49): a member going through a dozen pages in a minute had the session check refused (429) and the layout said the space was down
  it('the reads every page makes by itself (budget « session ») have their own bucket: a member who spent the page budget is not refused the session check; that bucket is bounded too', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-17T10:00:05Z'), toFake: ['Date'] });
    try {
      const { env } = await import('../../api/_utils/env.js');
      const { PRO_SESSION_READ_FACTOR } = await import('../../api/_utils/pro-rate-limit.js');
      const limit = env.proRdv.readPerMinute; const sessionLimit = limit * PRO_SESSION_READ_FACTOR;
      expect(PRO_SESSION_READ_FACTOR).toBe(3);
      const inner = vi.fn(async (req, res) => res.status(200).json({ ok: true }));
      const page = authed(withProRateLimit('pro.test.page', inner));
      const session = authed(withProRateLimit('pro.test.session', inner, { budget: 'session' }));
      const u = user('rl-s1');
      for (let i = 0; i < limit; i += 1) expect((await call(page, u)).statusCode).toBe(200);
      expect((await call(page, u)).statusCode).toBe(429);
      for (let i = 0; i < sessionLimit; i += 1) expect((await call(session, u)).statusCode, `session read ${i + 1}`).toBe(200);
      const over = await call(session, u);
      expect([over.statusCode, over.body.code]).toEqual([429, 'PRO_RATE_LIMITED']);
      // and the other way round: the session reads never spend the page budget
      const v = user('rl-s2');
      for (let i = 0; i < sessionLimit; i += 1) await call(session, v);
      expect((await call(page, v)).statusCode).toBe(200);
      // a write of a session route keeps the shared write budget
      const w = user('rl-s3');
      for (let i = 0; i < env.proRdv.writePerMinute; i += 1) expect((await call(session, w, { method: 'PATCH' })).statusCode).toBe(200);
      expect((await call(page, w, { method: 'POST' })).statusCode).toBe(429);
    } finally { vi.useRealTimers(); }
  });

  it('the session check, the notification centre and the unread count use the session bucket; no other professional route does', () => {
    const session = walk(PRO_DIR).filter((f) => /budget: 'session'/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(PRO_DIR, f)).sort();
    expect(session).toEqual(['me.js', 'notifications.js', path.join('notifications', 'unread-count.js')].sort());
  });
});

describe('A24 — the report file name', () => {
  it('an unknown, quoted or CR/LF period never reaches Content-Disposition (it means « month »)', async () => {
    const src = fs.readFileSync('api/_handlers/pro/reports.js', 'utf8');
    expect(src).toMatch(/REPORT_PERIODS\.includes\(asked\) \? asked : 'month'/);
    expect(src).not.toMatch(/searchParams\.get\('period'\) \|\| 'month';\s*\n\s*const format/);
    const reports = (await import('../../api/_handlers/pro/reports.js')).default;
    for (const hostile of ['x"; filename="evil.exe', 'year\r\nSet-Cookie: a=b', '../../etc', 'YEAR']) {
      const r = await call(reports, user(`rl-rep-${Date.now()}`), { url: `/api/pro/reports?format=csv&period=${encodeURIComponent(hostile)}`, query: { format: 'csv', period: hostile } });
      expect(r.statusCode, hostile).toBe(200);
      expect(r.headers['content-disposition'], hostile).toBe('attachment; filename="indicateurs-month.csv"');
      expect(JSON.stringify(r.headers)).not.toMatch(/evil|Set-Cookie|etc/);
    }
    const ok = await call(reports, user(`rl-rep2-${Date.now()}`), { url: '/api/pro/reports?format=csv&period=quarter', query: { format: 'csv', period: 'quarter' } });
    expect(ok.headers['content-disposition']).toBe('attachment; filename="indicateurs-quarter.csv"');
  });
});
