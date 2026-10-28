/**
 * Monitoring (Q07) — an ALERT DRILL on REAL PostgreSQL: the 5-minute health check (api/_handlers/cron/health-alert.js) run by its scheduler's credential, with the
 * alert channel (ALERT_WEBHOOK_URL) pointed at a local receiver. The drill threshold ALERT_VEILLE_STALE_HOURS=0 makes the automatic-veille freshness check
 * fire: the receiver gets ONE alert in French naming the veille, nothing secret; the same alert is not sent again within its cooldown; a request without the
 * scheduler's credential is refused and sends nothing. Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';

const hasDatabase = !!process.env.DATABASE_URL;
const res = () => { const r = { code: 0, body: null, headers: {} }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };

describe.skipIf(!hasDatabase)('alert drill: the health check delivers its alert through the alert channel', () => {
  let server; let received = []; let handler; const saved = {};
  beforeAll(async () => {
    server = http.createServer((req, r) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { received.push({ path: req.url, body: JSON.parse(b || '{}') }); r.writeHead(200).end('ok'); }); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    // the drill uses the local cooldown store (no KV service in the test environment: its placeholder address would make every call wait for its retries)
    const KV_VARS = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_KV_KV_REST_API_URL', 'UPSTASH_KV_KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_URL'];
    for (const k of ['ALERT_WEBHOOK_URL', 'ALERT_VEILLE_STALE_HOURS', ...KV_VARS]) saved[k] = process.env[k];
    for (const k of KV_VARS) delete process.env[k];
    process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${server.address().port}/hook`; process.env.ALERT_VEILLE_STALE_HOURS = '0';
    vi.resetModules();   // the environment module of an earlier suite in this worker read the KV placeholder: load the handler afresh with the local store
    ({ default: handler } = await import('../../api/_handlers/cron/health-alert.js'));
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await new Promise((r) => server.close(r));
  });

  it('refuses a call without the scheduler credential and sends nothing', async () => {
    const r = res(); await handler({ method: 'GET', headers: {} }, r);
    expect(r.code).toBe(401); expect(received).toEqual([]);
  });

  it('fires the veille alert once, in French, without secrets; the cooldown holds the second one', async () => {
    const auth = { authorization: `Bearer ${process.env.CRON_SECRET}` };
    const r1 = res(); await handler({ method: 'GET', headers: auth }, r1);
    expect(r1.body.checks.veille).toMatchObject({ ok: false, thresholdHours: 0 });
    expect(r1.body.checks.ingestionFreshness.ok, 'the former ingestion jobs are not a failure').toBe(true);
    const veille = received.filter((x) => x.body.name === 'veille.stale');
    expect(veille).toHaveLength(1);
    expect(veille[0].body.text).toMatch(/Veille automatique : aucune veille terminée/);
    expect(JSON.stringify(veille[0].body)).not.toContain(process.env.CRON_SECRET);
    expect(JSON.stringify(veille[0].body)).not.toMatch(/postgres(ql)?:\/\//);
    const r2 = res(); await handler({ method: 'GET', headers: auth }, r2);
    expect(r2.body.checks.veille.ok).toBe(false);
    expect(received.filter((x) => x.body.name === 'veille.stale'), 'cooldown: not sent again').toHaveLength(1);
  });
});
