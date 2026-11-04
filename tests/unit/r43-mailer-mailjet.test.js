/**
 * R43-MAIL — Mailjet adapter: SandboxMode (validated, never delivered), Reply-To, CustomID = idempotency key, tracking off, sender split, bounded retries
 * (429 only: Mailjet has no idempotency key) and error classes (401/403 sender → not_configured, other 4xx → permanent, 429/5xx → retryable);
 * mailerReadiness() reports names and states only. fetch is mocked: any host but api.mailjet.com throws. No real key, address or provider is used.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const MAIL = { to: 'person@example.test', subject: 'Votre rendez-vous est confirmé - Accès Direct Aide', text: 'Corps', category: 'appointment-booked_by_structure' };
const OK = { Messages: [{ Status: 'success', To: [{ Email: 'person@example.test', MessageUUID: 'u-1', MessageID: 576460752303423500 }] }] };

/** @param {Array<{ status: number, body: unknown, headers?: Record<string, string> }>} answers */
function mockFetch(answers) {
  const calls = [];
  const queue = [...answers];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const u = new URL(String(url));
    if (u.hostname !== 'api.mailjet.com') throw new Error(`unexpected host ${u.hostname}`);
    calls.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    const a = queue.length > 1 ? queue.shift() : queue[0];
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json', ...(a.headers || {}) } });
  }));
  return calls;
}
async function mailer(env) {
  for (const [k, v] of Object.entries({ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'pub_test:sec_test', MAILER_FROM: 'AccesDirectAide <notifications@example.test>', ...env })) vi.stubEnv(k, v);
  vi.resetModules();
  return import('../../api/_utils/mailer.js');
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.doUnmock('../../api/_utils/logger.js'); });

describe('R43 Mailjet payload', () => {
  it('splits « Name <addr> », sets Reply-To from MAILER_REPLY_TO, CustomID = the idempotency key, EventPayload = category, tracking disabled, no SandboxMode', async () => {
    const calls = mockFetch([{ status: 200, body: OK }]);
    const m = await mailer({ MAILER_REPLY_TO: 'contact@example.test' });
    const out = await m.sendMail({ ...MAIL, idempotencyKey: 'appointment-notice/0b8e9c1e-2f7a-4f43-9a3c-1d2e3f4a5b6c' });
    expect(out).toMatchObject({ outcome: 'PROVIDER_ACCEPTED', delivered: true, providerMessageId: '576460752303423500' });
    expect(m.mailLedgerStatus(out)).toBe('PROVIDER_ACCEPTED');
    const body = calls[0].body;
    expect(body).not.toHaveProperty('SandboxMode');
    expect(body.Messages[0]).toMatchObject({
      From: { Email: 'notifications@example.test', Name: 'AccesDirectAide' }, To: [{ Email: MAIL.to }], ReplyTo: { Email: 'contact@example.test' },
      CustomID: 'appointment-notice/0b8e9c1e-2f7a-4f43-9a3c-1d2e3f4a5b6c', EventPayload: MAIL.category, TrackOpens: 'disabled', TrackClicks: 'disabled',
    });
  });
  it('a caller Reply-To wins; an invalid one is dropped; without a key CustomID stays the category', async () => {
    const calls = mockFetch([{ status: 200, body: OK }]);
    const m = await mailer({ MAILER_REPLY_TO: 'not an address' });
    await m.sendMail(MAIL);
    expect(calls[0].body.Messages[0]).not.toHaveProperty('ReplyTo');
    expect(calls[0].body.Messages[0].CustomID).toBe(MAIL.category);
    await m.sendMail({ ...MAIL, replyTo: 'team@example.test' });
    expect(calls[1].body.Messages[0].ReplyTo).toEqual({ Email: 'team@example.test' });
    // a key carrying an address is hashed before it leaves (normalizeIdempotencyKey)
    await m.sendMail({ ...MAIL, idempotencyKey: 'x person@example.test' });
    expect(calls[2].body.Messages[0].CustomID).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('R43 Mailjet SandboxMode', () => {
  it('MAILER_MAILJET_SANDBOX=1 sends SandboxMode: true; the result is SANDBOX_VALIDATED (ledger TEST_RECORDED), never PROVIDER_ACCEPTED or delivered', async () => {
    const calls = mockFetch([{ status: 200, body: { Messages: [{ Status: 'success', To: [{ Email: MAIL.to, MessageUUID: '', MessageID: 0 }] }] } }]);
    const m = await mailer({ MAILER_MAILJET_SANDBOX: '1' });
    const out = await m.sendMail(MAIL);
    expect(calls[0].body.SandboxMode).toBe(true);
    expect(out).toMatchObject({ outcome: 'SANDBOX_VALIDATED', delivered: false, sandbox: true });
    expect(out).not.toHaveProperty('failure');
    expect(out).not.toHaveProperty('providerMessageId');
    expect(m.mailLedgerStatus(out)).toBe('TEST_RECORDED');
    expect(m.mailFailure(out)).toBe('none');
  });
  it('a sandbox refusal is reported like a real one (validation errors are the point of the sandbox)', async () => {
    mockFetch([{ status: 400, body: { Messages: [{ Status: 'error', Errors: [{ ErrorCode: 'mj-0013', StatusCode: 400, ErrorMessage: '"x" is an invalid email address.' }] }] } }]);
    const m = await mailer({ MAILER_MAILJET_SANDBOX: 'true' });
    expect(await m.sendMail(MAIL)).toMatchObject({ outcome: 'NOT_DELIVERED', failure: 'permanent', errorCode: 'mj-0013', providerStatus: 400 });
  });
  it('the sandbox is never « deliverable » for readiness or the release gate', async () => {
    const m = await mailer({ MAILER_MAILJET_SANDBOX: '1' });
    expect(m.getMailerStatus()).toMatchObject({ provider: 'mailjet', deliverable: false });
    expect(m.evaluateMailerConfig({ provider: 'mailjet', apiKey: 'a:b', from: 'x@example.test', mailjetSandbox: '1' }).deliverable).toBe(false);
    expect(m.evaluateMailerConfig({ provider: 'mailjet', apiKey: 'a:b', from: 'x@example.test', mailjetSandbox: '0' }).deliverable).toBe(true);
  });
});

describe('R43 Mailjet error classes and retries', () => {
  it('429 is retried twice at most (Retry-After honoured), then retryable; 5xx is NOT retried in the call (no idempotency key) and is retryable', async () => {
    let calls = mockFetch([{ status: 429, body: {}, headers: { 'retry-after': '0' } }]);
    const m = await mailer({});
    expect(await m.sendMail(MAIL)).toMatchObject({ outcome: 'NOT_DELIVERED', failure: 'retryable', providerStatus: 429 });
    expect(calls).toHaveLength(3);
    calls = mockFetch([{ status: 503, body: {} }]);
    expect(await m.sendMail(MAIL)).toMatchObject({ failure: 'retryable', providerStatus: 503 });
    expect(calls).toHaveLength(1);
  });
  it('401 (bad / suspended key) and 403 send-0007 (sender not validated) are not_configured; 400 mj-0013 is permanent', async () => {
    const m = await mailer({});
    mockFetch([{ status: 401, body: { ErrorCode: 'mj-0015', StatusCode: 401 } }]);
    expect(await m.sendMail(MAIL)).toMatchObject({ failure: 'not_configured', errorCode: 'mj-0015' });
    mockFetch([{ status: 403, body: { Messages: [{ Status: 'error', Errors: [{ ErrorCode: 'send-0007', StatusCode: 403 }] }] } }]);
    expect(await m.sendMail(MAIL)).toMatchObject({ failure: 'not_configured', errorCode: 'send-0007' });
    mockFetch([{ status: 400, body: { Messages: [{ Status: 'error', Errors: [{ ErrorCode: 'mj-0013', StatusCode: 400 }] }] } }]);
    expect(await m.sendMail(MAIL)).toMatchObject({ failure: 'permanent', errorCode: 'mj-0013' });
    expect(m.classifyMailjetFailure(500, null)).toBe('retryable');
    expect(m.classifyMailjetFailure(429, null)).toBe('retryable');
    expect(m.classifyMailjetFailure(400, 'send-0008')).toBe('not_configured');
    expect(m.classifyMailjetFailure(404, null)).toBe('permanent');
  });
  it('an error Status inside a 200 is classified from its own StatusCode', async () => {
    mockFetch([{ status: 200, body: { Messages: [{ Status: 'error', Errors: [{ ErrorCode: 'send-0006', StatusCode: 403 }] }] } }]);
    const m = await mailer({});
    expect(await m.sendMail(MAIL)).toMatchObject({ outcome: 'NOT_DELIVERED', failure: 'not_configured', errorCode: 'send-0006' });
  });
  it('logs carry status and code only — never the address or the provider message', async () => {
    const lines = [];
    const log = (...a) => { lines.push(JSON.stringify(a)); };
    vi.doMock('../../api/_utils/logger.js', () => ({ default: { info: log, warn: log, error: log, debug: log } }));
    mockFetch([{ status: 400, body: { Messages: [{ Status: 'error', Errors: [{ ErrorCode: 'mj-0013', StatusCode: 400, ErrorMessage: 'person@example.test is invalid' }] }] } }]);
    const m = await mailer({ MAILER_REPLY_TO: 'contact@example.test' });
    await m.sendMail(MAIL);
    expect(lines.join('\n')).not.toContain('person@example.test');
    expect(lines.join('\n')).toContain('mj-0013');
  });
});

describe('R43 mailerReadiness', () => {
  it('reports provider, mode, missing variable NAMES and the event webhook state — never a value', async () => {
    const { mailerReadiness } = await mailer({});
    expect(mailerReadiness({})).toMatchObject({ provider: 'noop', mode: 'off', deliverable: false, missing: [], events: { enabled: false, ready: false } });
    const mj = mailerReadiness({ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'nocolon' });
    expect(mj).toMatchObject({ mode: 'live', deliverable: false, missing: ['MAILER_FROM', 'MAILER_API_KEY'] });
    const secretish = { MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'PUBKEY123:SECRETKEY456', MAILER_FROM: 'n@example.test', MAILER_MAILJET_SANDBOX: '1',
      MAILER_REPLY_TO: 'contact@example.test', MAILER_EVENTS_ENABLED: '1', MAILER_EVENTS_BASIC_USER: 'mj-user', MAILER_EVENTS_BASIC_PASSWORD: 'p'.repeat(30) };
    const r = mailerReadiness(secretish);
    expect(r).toMatchObject({ mode: 'sandbox', sandbox: true, deliverable: false, replyTo: 'set', events: { enabled: true, credentials: 'set', ready: true } });
    const text = JSON.stringify(r);
    for (const v of ['PUBKEY123', 'SECRETKEY456', 'n@example.test', 'contact@example.test', 'mj-user', 'ppppp']) expect(text).not.toContain(v);
    expect(mailerReadiness({ ...secretish, MAILER_MAILJET_SANDBOX: '' })).toMatchObject({ mode: 'live', deliverable: true });
    expect(mailerReadiness({ MAILER_PROVIDER: 'msgraph' }).missing).toEqual(['MAILER_MSGRAPH_TENANT_ID', 'MAILER_MSGRAPH_CLIENT_ID', 'MAILER_MSGRAPH_SENDER', 'MAILER_MSGRAPH_CERT_PRIVATE_KEY+MAILER_MSGRAPH_CERT_PEM|MAILER_MSGRAPH_CLIENT_SECRET']);
    expect(mailerReadiness({ MAILER_PROVIDER: 'smtp' }).mode).toBe('not_wired');
  });
  it('the release preflight passes the mail checks with mail off in the restricted beta, and fails a Mailjet sandbox when mail is needed', async () => {
    const { evaluateReleasePreflight } = await import('../../scripts/release-preflight.mjs');
    const by = (rs, id) => rs.find((r) => r.id === id)?.status;
    const beta = evaluateReleasePreflight({ ADA_PUBLIC_BETA_RESTRICTED: 'true', MAILER_PROVIDER: 'noop' }, { legalText: '' });
    expect(by(beta, 'mail.deliverable')).toBe('PASS');
    expect(by(beta, 'beta.mailer_noop')).toBe('PASS');
    const mj = { MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'a:b', MAILER_FROM: 'n@example.test' };
    expect(by(evaluateReleasePreflight(mj, { legalText: '' }), 'mail.deliverable')).toBe('PASS');
    const sandbox = evaluateReleasePreflight({ ...mj, MAILER_MAILJET_SANDBOX: '1' }, { legalText: '' });
    expect(by(sandbox, 'mail.deliverable')).toBe('FAIL');
    expect(JSON.stringify(sandbox)).not.toContain('n@example.test');
  });
});

describe('R43 scripts/mail-sandbox-check.mjs', () => {
  it('forces SandboxMode whatever the environment says, prints no key and no address, exits 0 only for SANDBOX_VALIDATED', async () => {
    const calls = mockFetch([{ status: 200, body: { Messages: [{ Status: 'success', To: [{ MessageID: 0 }] }] } }]);
    for (const [k, v] of Object.entries({ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'PUBK:SECK', MAILER_FROM: 'notifications@example.test', MAILER_MAILJET_SANDBOX: '0' })) vi.stubEnv(k, v);
    vi.resetModules();
    const { runSandboxCheck } = await import('../../scripts/mail-sandbox-check.mjs');
    const lines = [];
    expect(await runSandboxCheck(['tester@example.test'], { log: (l) => lines.push(l) })).toBe(0);
    expect(calls[0].body.SandboxMode).toBe(true);
    expect(lines.join('\n')).toContain('outcome=SANDBOX_VALIDATED');
    for (const v of ['PUBK', 'SECK', 'tester@example.test', 'notifications@example.test']) expect(lines.join('\n')).not.toContain(v);
    mockFetch([{ status: 403, body: { Messages: [{ Status: 'error', Errors: [{ ErrorCode: 'send-0007', StatusCode: 403 }] }] } }]);
    expect(await runSandboxCheck(['tester@example.test'], { log: (l) => lines.push(l) })).toBe(1);
    expect(lines.at(-1)).toContain('errorCode=send-0007');
    vi.stubEnv('MAILER_PROVIDER', 'resend');
    expect(await runSandboxCheck(['tester@example.test'], { log: (l) => lines.push(l) })).toBe(2);
  });
});
