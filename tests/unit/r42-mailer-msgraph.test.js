/**
 * R42-MAIL — the Microsoft Graph sendMail adapter (MAILER_PROVIDER=msgraph) against a MOCKED fetch only: any request to another host than the two
 * Microsoft names throws, and nothing leaves the machine (no tenant, no real credential; the certificate is generated in memory for each run).
 *   - readiness: tenant + application + sender + one credential (certificate preferred); MAILER_API_KEY is not needed;
 *   - token: client credentials with a PS256 client assertion carrying x5t#S256 (learn.microsoft.com certificate-credentials), cached;
 *   - send: 202 → PROVIDER_ACCEPTED (never « delivered »), saveToSentItems false, attachments as fileAttachment;
 *   - errors: 429 retried after Retry-After; 5xx / timeout not retried in the call (no idempotency at Graph) and classed retryable; 400/403/404 permanent;
 *     token refusal not_configured; only status + code are logged (never the address or the provider's message).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const ADDRESS = 'personne.reelle@example.test';
const TENANT = '11111111-2222-4333-8444-555555555555';
const CLIENT = '66666666-7777-4888-9999-000000000000';
const SENDER = 'notifications@example.test';

// ── a self-signed X.509 certificate built with node:crypto only (DER by hand) ──
const der = (tag, ...parts) => {
  const body = Buffer.concat(parts); const n = body.length;
  const len = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
};
const seq = (...p) => der(0x30, ...p);
const oid = (s) => { const a = s.split('.').map(Number); const out = [40 * a[0] + a[1]]; for (const v of a.slice(2)) { const b = []; let x = v; do { b.unshift(x & 0x7f); x >>= 7; } while (x); for (let i = 0; i < b.length - 1; i++) b[i] |= 0x80; out.push(...b); } return der(0x06, Buffer.from(out)); };
const name = (cn) => seq(der(0x31, seq(oid('2.5.4.3'), der(0x0c, Buffer.from(cn, 'utf8')))));
const utc = (d) => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
function makeCert(keys) {
  const alg = seq(oid('1.2.840.113549.1.1.11'), der(0x05));
  const spki = keys.publicKey.export({ type: 'spki', format: 'der' });
  const tbs = seq(der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, Buffer.from([1])), alg, name('r42-test'), seq(utc(new Date(Date.now() - 86400000)), utc(new Date(Date.now() + 86400000))), name('r42-test'), spki);
  const sig = crypto.sign('sha256', tbs, keys.privateKey);
  const certDer = seq(tbs, alg, der(0x03, Buffer.from([0]), sig));
  return `-----BEGIN CERTIFICATE-----\n${certDer.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
}
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const CERT_PEM = makeCert(keys);
const KEY_PEM = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const OTHER_KEY_PEM = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const CERT_ENV = { MAILER_MSGRAPH_TENANT_ID: TENANT, MAILER_MSGRAPH_CLIENT_ID: CLIENT, MAILER_MSGRAPH_SENDER: SENDER, MAILER_MSGRAPH_CERT_PRIVATE_KEY: KEY_PEM, MAILER_MSGRAPH_CERT_PEM: CERT_PEM };
const MAIL = { to: ADDRESS, subject: 'Votre lien', text: 'Corps', category: 'r42-sim' };

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const tokenOk = () => ({ status: 200, body: { token_type: 'Bearer', expires_in: 3599, access_token: 'sim-access-token' } });
const accepted = () => ({ status: 202, headers: { 'request-id': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } });
const graphErr = (status, code, headers) => ({ status, headers, body: { error: { code, message: `Recipient ${ADDRESS} refused` } } });

/** @param {Record<string, string>} env @param {{ token?: any[], graph?: any[] }} script */
async function setup(env, script = {}) {
  for (const [k, v] of Object.entries({ MAILER_PROVIDER: 'msgraph', MAILER_FROM: `AccesDirectAide <${SENDER}>`, ...env })) vi.stubEnv(k, v);
  vi.resetModules();
  const calls = [];
  const token = [...(script.token || [])]; const graph = [...(script.graph || [])];
  vi.stubGlobal('fetch', async (url, init) => {
    const u = new URL(String(url));
    calls.push({ host: u.hostname, path: u.pathname, init });
    let a;
    if (u.hostname === 'login.microsoftonline.com') a = token.length ? token.shift() : tokenOk();
    else if (u.hostname === 'graph.microsoft.com') a = graph.length ? graph.shift() : accepted();
    else throw new Error('unexpected outbound host in test: ' + u.hostname);
    if (a.throw) throw Object.assign(new Error(`connect to ${ADDRESS}`), { name: a.throw });
    return new Response(a.status === 202 ? null : JSON.stringify(a.body ?? {}), { status: a.status, headers: { 'content-type': 'application/json', ...(a.headers || {}) } });
  });
  const m = await import('../../api/_utils/mailer.js');
  const g = await import('../../api/_utils/mailer-msgraph.js');
  g.__resetGraphState();
  const logger = (await import('../../api/_utils/logger.js')).default;
  const raw = [];
  for (const level of ['error', 'warn', 'info', 'debug']) vi.spyOn(logger, level).mockImplementation((...x) => { raw.push(x); });
  return { m, g, calls, logs: () => JSON.stringify(raw) };
}
const graphCalls = (calls) => calls.filter((c) => c.host === 'graph.microsoft.com');
const tokenCalls = (calls) => calls.filter((c) => c.host === 'login.microsoftonline.com');

describe('readiness (no network)', () => {
  it('certificate or client secret, with tenant, application and sender; MAILER_API_KEY is not used', async () => {
    const { m, calls } = await setup(CERT_ENV);
    expect(m.getMailerStatus()).toMatchObject({ provider: 'msgraph', deliverable: true });
    const cfg = (o) => m.evaluateMailerConfig({ provider: 'msgraph', from: SENDER, msgraph: { tenantId: TENANT, clientId: CLIENT, ...o } });
    expect(cfg({ clientSecret: 'sim-secret' })).toMatchObject({ deliverable: true });
    expect(cfg({})).toMatchObject({ deliverable: false, reason: expect.stringContaining('credential') });
    expect(cfg({ certPrivateKey: KEY_PEM })).toMatchObject({ deliverable: false });
    expect(m.evaluateMailerConfig({ provider: 'msgraph', from: SENDER, msgraph: { tenantId: '', clientId: CLIENT, clientSecret: 's' } })).toMatchObject({ deliverable: false });
    expect(m.evaluateMailerConfig({ provider: 'msgraph', from: '', msgraph: { tenantId: TENANT, clientId: CLIENT, clientSecret: 's' } })).toMatchObject({ deliverable: false });
    expect(calls).toHaveLength(0);
  });

  it('the sender defaults to the address of MAILER_FROM', async () => {
    const { g } = await setup({});
    expect(g.graphConfig({ from: `AccesDirectAide <${SENDER}>` }).sender).toBe(SENDER);
    expect(g.graphConfig({ from: SENDER, sender: 'autre@example.test' }).sender).toBe('autre@example.test');
  });
});

describe('token — client credentials with a certificate assertion', () => {
  it('PS256 assertion with x5t#S256, the v2.0 token audience and a 5-minute lifetime; the token is cached', async () => {
    const { m, calls } = await setup(CERT_ENV);
    expect((await m.sendMail(MAIL)).outcome).toBe('PROVIDER_ACCEPTED');
    expect((await m.sendMail(MAIL)).outcome).toBe('PROVIDER_ACCEPTED');
    const t = tokenCalls(calls);
    expect(t).toHaveLength(1);
    expect(t[0].path).toBe(`/${TENANT}/oauth2/v2.0/token`);
    const form = new URLSearchParams(String(t[0].init.body));
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('https://graph.microsoft.com/.default');
    expect(form.get('client_id')).toBe(CLIENT);
    expect(form.get('client_secret')).toBeNull();
    expect(form.get('client_assertion_type')).toBe('urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    const [h, p, s] = String(form.get('client_assertion')).split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString()); const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    const thumb = crypto.createHash('sha256').update(new crypto.X509Certificate(CERT_PEM).raw).digest('base64url');
    expect(header).toEqual({ alg: 'PS256', typ: 'JWT', 'x5t#S256': thumb });
    expect(claims).toMatchObject({ aud: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, iss: CLIENT, sub: CLIENT });
    expect(claims.exp - claims.nbf).toBe(300);
    expect(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: keys.publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('a client secret is sent as client_secret when no certificate is configured', async () => {
    const { m, calls } = await setup({ MAILER_MSGRAPH_TENANT_ID: TENANT, MAILER_MSGRAPH_CLIENT_ID: CLIENT, MAILER_MSGRAPH_CLIENT_SECRET: 'sim-secret' });
    await m.sendMail(MAIL);
    const form = new URLSearchParams(String(tokenCalls(calls)[0].init.body));
    expect(form.get('client_secret')).toBe('sim-secret');
    expect(form.get('client_assertion')).toBeNull();
  });

  it('a key that does not belong to the certificate is refused before any request', async () => {
    const { m, calls } = await setup({ ...CERT_ENV, MAILER_MSGRAPH_CERT_PRIVATE_KEY: OTHER_KEY_PEM });
    const r = await m.sendMail(MAIL);
    expect(r).toMatchObject({ outcome: 'NOT_DELIVERED', failure: 'not_configured', errorCode: 'certificate_key_mismatch' });
    expect(calls).toHaveLength(0);
  });

  it('a refused credential is not_configured with the error id and AADSTS number only', async () => {
    const { m, logs, calls } = await setup(CERT_ENV, { token: [{ status: 401, body: { error: 'invalid_client', error_description: `AADSTS7000215: Invalid client secret for ${ADDRESS}`, error_codes: [7000215] } }] });
    const r = await m.sendMail(MAIL);
    expect(r).toMatchObject({ outcome: 'NOT_DELIVERED', failure: 'not_configured', errorCode: 'invalid_client:7000215', providerStatus: 401 });
    expect(m.mailFailure(r)).toBe('not_configured');
    expect(graphCalls(calls)).toHaveLength(0);
    expect(logs()).not.toContain(ADDRESS); expect(logs()).not.toContain('Invalid client secret');
  });

  it('an unreachable token endpoint is retryable', async () => {
    const { m } = await setup(CERT_ENV, { token: [{ throw: 'TypeError' }] });
    expect(await m.sendMail(MAIL)).toMatchObject({ failure: 'retryable', errorCode: 'token_network' });
  });
});

describe('sendMail — 202 is PROVIDER_ACCEPTED, never a delivery', () => {
  it('posts to /users/{sender}/sendMail with saveToSentItems false, the bearer token and the calendar attachment', async () => {
    const { m, calls } = await setup(CERT_ENV);
    const r = await m.sendMail({ ...MAIL, html: '<p>Corps</p>', attachments: [{ filename: 'rdv.ics', contentType: 'text/calendar', content: 'BEGIN:VCALENDAR' }] });
    expect(r).toMatchObject({ outcome: 'PROVIDER_ACCEPTED', provider: 'msgraph', providerStatus: 202, providerRequestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
    expect(m.mailLedgerStatus(r)).toBe('PROVIDER_ACCEPTED');
    expect(JSON.stringify(r)).not.toContain('DELIVERED"');
    const [c] = graphCalls(calls);
    expect(c.path).toBe(`/v1.0/users/${encodeURIComponent(SENDER)}/sendMail`);
    expect(c.init.headers.Authorization).toBe('Bearer sim-access-token');
    const body = JSON.parse(c.init.body);
    expect(body.saveToSentItems).toBe(false);
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: ADDRESS } }]);
    expect(body.message.body).toEqual({ contentType: 'HTML', content: '<p>Corps</p>' });
    expect(body.message.attachments).toEqual([{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'rdv.ics', contentType: 'text/calendar', contentBytes: Buffer.from('BEGIN:VCALENDAR').toString('base64') }]);
    expect(body.message.from).toBeUndefined();
  });

  it('a plain-text message is sent as Text', async () => {
    const { m, calls } = await setup(CERT_ENV);
    await m.sendMail(MAIL);
    expect(JSON.parse(graphCalls(calls)[0].init.body).message.body).toEqual({ contentType: 'Text', content: 'Corps' });
  });

  it('a caller key accepted once by this instance is not sent again (Graph has no idempotency key)', async () => {
    const { m, calls } = await setup(CERT_ENV);
    const key = 'rdv-reminder-j1/abc/1700000000000/citizen';
    expect((await m.sendMail({ ...MAIL, idempotencyKey: key })).outcome).toBe('PROVIDER_ACCEPTED');
    const again = await m.sendMail({ ...MAIL, idempotencyKey: key });
    expect(again).toMatchObject({ outcome: 'PROVIDER_ACCEPTED', deduplicated: true });
    expect(graphCalls(calls)).toHaveLength(1);
    await m.sendMail({ ...MAIL, idempotencyKey: `${key}-other` });
    expect(graphCalls(calls)).toHaveLength(2);
  });

  it('a revoked cached token is replaced once', async () => {
    const { m, calls } = await setup(CERT_ENV, { graph: [accepted(), graphErr(401, 'InvalidAuthenticationToken'), accepted()] });
    await m.sendMail(MAIL);
    expect((await m.sendMail(MAIL)).outcome).toBe('PROVIDER_ACCEPTED');
    expect(tokenCalls(calls)).toHaveLength(2);
    expect(graphCalls(calls)).toHaveLength(3);
  });
});

describe('errors — classified, logged with status and code only', () => {
  it('429 is retried after Retry-After, at most twice, then retryable', async () => {
    const { m, calls } = await setup(CERT_ENV, { graph: [graphErr(429, 'ApplicationThrottled', { 'retry-after': '0' }), graphErr(429, 'ApplicationThrottled', { 'retry-after': '0' }), graphErr(429, 'ApplicationThrottled', { 'retry-after': '0' })] });
    const r = await m.sendMail(MAIL);
    expect(r).toMatchObject({ outcome: 'NOT_DELIVERED', failure: 'retryable', providerStatus: 429, errorCode: 'ApplicationThrottled' });
    expect(graphCalls(calls)).toHaveLength(3);
  });

  it('429 then 202: accepted on the retry', async () => {
    const { m, calls } = await setup(CERT_ENV, { graph: [graphErr(429, 'ApplicationThrottled', { 'retry-after': '0' }), accepted()] });
    expect((await m.sendMail(MAIL)).outcome).toBe('PROVIDER_ACCEPTED');
    expect(graphCalls(calls)).toHaveLength(2);
  });

  it('5xx and a timeout are NOT retried in the call (the message may exist) and are retryable for a later run', async () => {
    let s = await setup(CERT_ENV, { graph: [graphErr(503, 'ServiceUnavailable')] });
    expect(await s.m.sendMail(MAIL)).toMatchObject({ failure: 'retryable', providerStatus: 503 });
    expect(graphCalls(s.calls)).toHaveLength(1);
    s = await setup(CERT_ENV, { graph: [{ throw: 'TimeoutError' }] });
    const r = await s.m.sendMail(MAIL);
    expect(r).toMatchObject({ outcome: 'NOT_DELIVERED', failure: 'retryable', errorCode: 'timeout' });
    expect(s.m.mailFailure(r)).toBe('retryable');
    expect(graphCalls(s.calls)).toHaveLength(1);
  });

  it.each([[400, 'ErrorInvalidRecipients'], [403, 'ErrorAccessDenied'], [404, 'ErrorInvalidUser']])('%i %s is permanent; the address and the message never reach a log', async (status, code) => {
    const { m, logs, calls } = await setup(CERT_ENV, { graph: [graphErr(status, code)] });
    const r = await m.sendMail(MAIL);
    expect(r).toMatchObject({ outcome: 'NOT_DELIVERED', failure: 'permanent', providerStatus: status, errorCode: code });
    expect(graphCalls(calls)).toHaveLength(1);
    expect(logs()).toContain(String(status)); expect(logs()).toContain(code);
    expect(logs()).not.toContain(ADDRESS); expect(logs()).not.toContain('refused'); expect(logs()).not.toContain('Votre lien');
  });

  it('an oversized attachment is refused before any request', async () => {
    const { m, calls } = await setup(CERT_ENV);
    const r = await m.sendMail({ ...MAIL, attachments: [{ filename: 'x.bin', contentType: 'application/octet-stream', content: 'x'.repeat(2_400_000) }] });
    expect(r).toMatchObject({ failure: 'permanent', errorCode: 'attachment_too_large' });
    expect(calls).toHaveLength(0);
  });

  it('msgraph without its variables is not configured: NOT_DELIVERED, nothing sent', async () => {
    const { m, calls } = await setup({});
    const r = await m.sendMail(MAIL);
    expect(r).toMatchObject({ outcome: 'NOT_DELIVERED', failure: 'not_configured' });
    expect(m.getMailerStatus().deliverable).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
