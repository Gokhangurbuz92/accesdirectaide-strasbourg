/**
 * R41-E / G11 + Resend readiness — the mailer against a loopback stand-in for api.resend.com / api.mailjet.com (nothing leaves the machine, no real key):
 *   - G11: a provider error is logged with its HTTP status and its error code only — never the response body (it can repeat the recipient address);
 *   - every failure is classified retryable / permanent / not configured, as the Resend error reference (resend.com/docs/api-reference/errors) defines it;
 *   - a caller's stable idempotency key reaches the Idempotency-Key header (1-256 characters, no personal data), the same on every in-call retry;
 *   - a quota 429 (daily / monthly) and a 409 invalid_idempotent_request are never retried in the call; a rate-limit 429 and a 409 concurrent request are.
 * The log capture records the raw arguments given to the logger AND what reaches stdout / the console.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';

const ADDRESS = 'personne.reelle@example.test';
const MAIL = { to: ADDRESS, subject: 'Sujet', text: 'Corps', category: 'r41-sim' };
let server; let port; const seen = []; let answers = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, key: req.headers['idempotency-key'], body });
      const a = answers.length ? answers.shift() : { status: 200, body: { id: 'sim-id-1' } };
      if (a.drop) { req.socket.destroy(); return; }
      res.writeHead(a.status, { 'content-type': 'application/json', ...(a.headers || {}) }); res.end(JSON.stringify(a.body ?? {}));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
afterAll(() => new Promise((r) => server.close(r)));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); seen.length = 0; answers = []; });

async function mailer(env) {
  for (const [k, v] of Object.entries({ MAILER_FROM: 'noreply@example.test', ...env })) vi.stubEnv(k, v);
  vi.resetModules();
  vi.stubGlobal('fetch', (url, init) => {
    const u = new URL(String(url));
    if (!/^api\.(resend\.com|mailjet\.com)$/.test(u.hostname)) throw new Error('unexpected outbound host in test: ' + u.hostname);
    return realFetch(`http://127.0.0.1:${port}${u.pathname}`, init);
  });
  const m = await import('../../api/_utils/mailer.js');
  const logger = (await import('../../api/_utils/logger.js')).default;
  const raw = [];
  for (const level of ['error', 'warn', 'info', 'debug']) vi.spyOn(logger, level).mockImplementation((...a) => { raw.push(a); });
  const out = [];
  for (const level of ['log', 'error', 'warn', 'info']) vi.spyOn(console, level).mockImplementation((...a) => { out.push(a); });
  const write = process.stdout.write.bind(process.stdout);
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk, ...rest) => { out.push([String(chunk)]); return write(chunk, ...rest); });
  const logs = () => JSON.stringify(raw.map((a) => a.map((x) => (x instanceof Error ? { name: x.name, message: x.message } : x)))) + JSON.stringify(out);
  return { m, logs };
}
const resendErr = (status, name, headers) => ({ status, headers, body: { statusCode: status, name, message: `The to field is invalid: ${ADDRESS}` } });

describe('G11 — provider errors are logged without the response body', () => {
  it('resend: status and error code only; the address quoted by the provider never reaches a log', async () => {
    const { m, logs } = await mailer({ MAILER_PROVIDER: 'resend', MAILER_API_KEY: 're_sim_key' });
    answers = [resendErr(422, 'validation_error')];
    const r = await m.sendMail(MAIL);
    expect(r).toMatchObject({ accepted: true, delivered: false, outcome: 'NOT_DELIVERED', providerStatus: 422, errorCode: 'validation_error', failure: 'permanent' });
    expect(logs()).toContain('422'); expect(logs()).toContain('validation_error');
    expect(logs()).not.toContain(ADDRESS); expect(logs()).not.toContain('personne.reelle'); expect(logs()).not.toContain('re_sim_key');
  });
  it('mailjet: an error body (which quotes the recipient) is not logged either', async () => {
    const { m, logs } = await mailer({ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'pub_sim:sec_sim' });
    answers = [{ status: 400, body: { Messages: [{ Status: 'error', Errors: [{ ErrorCode: 'mj-0013', ErrorMessage: `"${ADDRESS}" is an invalid email address.` }] }] } }];
    const r = await m.sendMail(MAIL);
    expect(r).toMatchObject({ delivered: false, providerStatus: 400, errorCode: 'mj-0013', failure: 'permanent' });
    expect(logs()).not.toContain(ADDRESS); expect(logs()).not.toContain('sec_sim');
  });
  it('a dropped connection is logged by error name only, and is retryable', async () => {
    const { m, logs } = await mailer({ MAILER_PROVIDER: 'resend', MAILER_API_KEY: 're_sim_key' });
    answers = [{ drop: true }, { drop: true }, { drop: true }];
    const r = await m.sendMail(MAIL);
    expect(r).toMatchObject({ delivered: false, outcome: 'NOT_DELIVERED', failure: 'retryable', errorCode: 'network' });
    expect(logs()).not.toContain(ADDRESS); expect(logs()).not.toContain('127.0.0.1');
  });
});

describe('Resend error codes → retryable / permanent', () => {
  const cases = [
    [400, 'validation_error', 'permanent'], [401, 'missing_api_key', 'permanent'], [403, 'validation_error', 'permanent'], [422, 'missing_required_field', 'permanent'],
    [409, 'invalid_idempotent_request', 'permanent'], [500, 'application_error', 'retryable'], [503, 'service_unavailable', 'retryable'],
    [429, 'daily_quota_exceeded', 'retryable'], [429, 'monthly_quota_exceeded', 'retryable'], [429, 'rate_limit_exceeded', 'retryable'], [409, 'concurrent_idempotent_requests', 'retryable'],
  ];
  for (const [status, name, failure] of cases) {
    it(`${status} ${name} → ${failure}`, async () => {
      const { m } = await mailer({ MAILER_PROVIDER: 'resend', MAILER_API_KEY: 're_sim_key' });
      answers = [resendErr(status, name, { 'retry-after': '0' }), resendErr(status, name, { 'retry-after': '0' }), resendErr(status, name, { 'retry-after': '0' })];
      expect(await m.sendMail(MAIL)).toMatchObject({ delivered: false, providerStatus: status, errorCode: name, failure });
    });
  }
  it('a quota 429 or a reused key with another body is not retried in the call; a rate limit, a concurrent request and a 5xx are (same key every time)', async () => {
    const { m } = await mailer({ MAILER_PROVIDER: 'resend', MAILER_API_KEY: 're_sim_key' });
    for (const [first, attempts] of [[resendErr(429, 'daily_quota_exceeded', { 'retry-after': '0' }), 1], [resendErr(409, 'invalid_idempotent_request'), 1],
      [resendErr(429, 'rate_limit_exceeded', { 'retry-after': '0' }), 2], [resendErr(409, 'concurrent_idempotent_requests', { 'retry-after': '0' }), 2], [resendErr(503, 'service_unavailable', { 'retry-after': '0' }), 2]]) {
      seen.length = 0; answers = [first, { status: 200, body: { id: 'ok-id' } }];
      await m.sendMail(MAIL);
      expect(seen.length, first.body.name).toBe(attempts);
      expect(new Set(seen.map((s) => s.key)).size, 'one key for every attempt of one message').toBe(1);
    }
  });
});

describe('Idempotency-Key and provider id', () => {
  it('a caller key is sent as is; without one each message gets its own random key; the provider id is returned', async () => {
    const { m } = await mailer({ MAILER_PROVIDER: 'resend', MAILER_API_KEY: 're_sim_key' });
    const r = await m.sendMail({ ...MAIL, idempotencyKey: 'parcours-reminder/item-1/J1/1793750400000/email' });
    expect(r).toMatchObject({ delivered: true, outcome: 'PROVIDER_ACCEPTED', providerMessageId: 'sim-id-1' });
    expect(seen[0].key).toBe('parcours-reminder/item-1/J1/1793750400000/email');
    await m.sendMail(MAIL); await m.sendMail(MAIL);
    expect(seen[1].key).toMatch(/^[0-9a-f-]{36}$/); expect(seen[2].key).not.toBe(seen[1].key);
    expect(JSON.parse(seen[0].body)).not.toHaveProperty('idempotencyKey');
  });
  it('a key that is too long or carries anything but plain identifier characters is replaced by its SHA-256 (never an address on the wire header)', async () => {
    const { m } = await mailer({ MAILER_PROVIDER: 'resend', MAILER_API_KEY: 're_sim_key' });
    await m.sendMail({ ...MAIL, idempotencyKey: 'x'.repeat(300) });
    await m.sendMail({ ...MAIL, idempotencyKey: `welcome/${ADDRESS}` });
    expect(seen[0].key).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(seen[1].key).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(m.normalizeIdempotencyKey('a/b_c-1.2:3')).toBe('a/b_c-1.2:3');
    expect(m.normalizeIdempotencyKey('')).toBeNull();
  });
});

describe('no provider / incomplete provider', () => {
  it('noop: NOT_SENT, failure not_configured, nothing on the wire, no address in the log', async () => {
    const { m, logs } = await mailer({ MAILER_PROVIDER: 'noop' });
    expect(await m.sendMail(MAIL)).toMatchObject({ outcome: 'NOT_SENT', delivered: false, failure: 'not_configured' });
    expect(seen).toEqual([]); expect(logs()).not.toContain(ADDRESS);
  });
  it('MAILER_PROVIDER absent behaves as noop', async () => {
    const { m } = await mailer({ MAILER_PROVIDER: '' });
    expect(await m.sendMail(MAIL)).toMatchObject({ outcome: 'NOT_SENT', failure: 'not_configured' });
  });
  it('resend without a key: NOT_DELIVERED, not_configured, nothing on the wire', async () => {
    const { m } = await mailer({ MAILER_PROVIDER: 'resend', MAILER_API_KEY: '' });
    expect(await m.sendMail(MAIL)).toMatchObject({ outcome: 'NOT_DELIVERED', failure: 'not_configured', errorCode: 'not_configured' });
    expect(seen).toEqual([]);
  });
  it('mailFailure() gives the class of any result (older results without `failure` included)', async () => {
    const { m } = await mailer({ MAILER_PROVIDER: 'test' });
    expect(m.mailFailure({ outcome: 'PROVIDER_ACCEPTED' })).toBe('none');
    expect(m.mailFailure({ outcome: 'TEST_RECORDED' })).toBe('none');
    expect(m.mailFailure({ outcome: 'NOT_SENT' })).toBe('not_configured');
    expect(m.mailFailure({ outcome: 'NOT_DELIVERED', failure: 'retryable' })).toBe('retryable');
    expect(m.mailFailure({ outcome: 'NOT_DELIVERED' })).toBe('permanent');
    expect(m.mailFailure({ outcome: 'INVALID' })).toBe('permanent');
    expect(m.mailFailure(null)).toBe('retryable');
  });
});
