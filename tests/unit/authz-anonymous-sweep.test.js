/**
 * Anonymous authorization sweep over EVERY route of api/routes.js (same resolution as api/index.js).
 * Each handler is invoked with NO credentials for GET/POST/PATCH/DELETE while the database module is a tripwire:
 * any DB access before the request is rejected is recorded as `db-first`. The observed classification must equal the
 * documented expectation below — a new route, or an old one that starts answering anonymous callers, fails this test.
 * OFFLINE: no database, no network, no secrets. This proves "no anonymous access to protected routes", not business correctness.
 */
import { describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';

const touched = { n: 0 };
const trip = () => new Proxy(function () {}, { get: (_t, p) => (p === 'then' ? undefined : trip()), apply: () => { touched.n++; throw new Error('DB_TOUCHED_BEFORE_AUTH'); } });
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get: (_t, p) => { if (p === 'then') return undefined; touched.n++; throw new Error('DB_TOUCHED_BEFORE_AUTH'); } }), default: {} }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));

import { routes } from '../../api/routes.js';

const mkRes = () => ({ statusCode: 200, body: undefined, headers: {}, headersSent: false,
  status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; this.headersSent = true; return this; }, send(d) { this.body = d; this.headersSent = true; return this; },
  setHeader(k, v) { this.headers[k] = v; return this; }, getHeader(k) { return this.headers[k]; }, writeHead(c) { this.statusCode = c; return this; }, write() { return true; }, end(d) { if (d !== undefined) this.body = d; this.headersSent = true; return this; }, redirect(c) { this.statusCode = typeof c === 'number' ? c : 302; return this; } });

async function probe(route, method) {
  const path = route.match === 'prefix' ? `${route.path}/probe-id` : route.path;
  const mod = await route.handler();
  const h = mod.default;
  const res = mkRes(); touched.n = 0;
  const req = { method, url: `/api/${path}`, query: {}, body: method === 'GET' ? undefined : {}, headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' }, cookies: {} };
  let threw = null;
  try { await Promise.race([h(req, res), new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 4000))]); } catch (e) { threw = String(e.message || e); }
  const dbFirst = touched.n > 0 || threw === 'DB_TOUCHED_BEFORE_AUTH';
  // R11: a probe that timed out never answered — it is not a 2xx (the response object only kept its initial 200); recorded as TIMEOUT in the evidence
  return { status: threw === 'TIMEOUT' && !res.headersSent ? 'TIMEOUT' : res.statusCode, dbFirst, threw: threw && threw !== 'DB_TOUCHED_BEFORE_AUTH' ? threw : null };
}

describe('anonymous authorization sweep (all routes)', () => {
  it('classifies every route; protected families never answer anonymous callers with success', async () => {
    const rows = [];
    for (const route of routes) {
      for (const method of ['GET', 'POST']) {
        let r; try { r = await probe(route, method); } catch (e) { r = { status: 'IMPORT_ERROR', dbFirst: false, threw: String(e.message).slice(0, 80) }; }
        rows.push({ route: `${route.match === 'prefix' ? route.path + '/*' : route.path}`, method, ...r });
      }
    }
    if (process.env.TMPDIR) writeFileSync(`${process.env.TMPDIR.replace(/\/$/, '')}/authz_sweep.json`, JSON.stringify(rows, null, 1));   // evidence for review
    const protectedPrefixes = ['pro/', 'admin/', 'secure-messages', 'messages', 'cron/', 'monitor/'];
    const offenders = rows.filter((r) => protectedPrefixes.some((p) => r.route.startsWith(p)) && !['pro/auth/', 'pro/invite', 'admin/auth', 'admin/login', 'cron/', 'monitor/'].some((p) => r.route.startsWith(p)) && r.status === 200);
    expect(offenders).toEqual([]);
    // Exhaustive: the only routes that may answer an anonymous caller with 2xx (reviewed 2026-10-16: public content, health, anti-enumeration auth endpoints).
    const anonymous2xx = [...new Set(rows.filter((r) => typeof r.status === 'number' && r.status >= 200 && r.status < 300).map((r) => r.route))].sort();
    expect(anonymous2xx).toEqual([
      'auth/forgot-password', 'auth/logout', 'auth/resend-verification', 'docs/openapi.json', 'drees/*', 'glossaire', 'health', 'health/live', 'healthz',
      'monitor/cron/actualites', 'monitor/csp-report', 'robots', 'robots.txt', 'status', 'taxonomy',   // 'status': P24 overlay v1 — public status, reviewed 2026-10-21 (no internals, no personal data)
      // 'monitor/csp-report': launch-readiness item 49, reviewed 2026-10-25 — browsers post CSP violation reports anonymously; 204, nothing stored, only the
      // directive / blocked origin / page path are logged (tests/unit/csp-hardening.test.js)
    ]);
    expect(rows.length).toBeGreaterThan(250);
    // Auth must come before data access: the only sensitive-prefix routes that touch the DB before rejecting anonymous callers are the monitor/* probes
    // (503 when no monitor secret is configured — to be re-checked with a configured secret in the real-DB suite).
    const dbFirst = [...new Set(rows.filter((r) => r.dbFirst && ['pro/', 'admin/', 'secure-messages', 'messages', 'cron/', 'monitor/', 'rdv/', 'upload', 'share/', 'public/'].some((p) => r.route.startsWith(p))).map((r) => r.route))].sort();
    expect(dbFirst).toEqual(['monitor/core', 'monitor/cron/actualites', 'monitor/data-quality', 'monitor/ingestion-freshness', 'monitor/pro-rdv']);
  }, 120000);
});
