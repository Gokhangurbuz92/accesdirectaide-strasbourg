// @vitest-environment node
/**
 * R46 / P20 — the contact form's provider-disconnected path: GET /api/contact says the channel state before anyone types (no provider name, no value),
 * a POST on a disconnected channel answers 503 NOT_DELIVERED with reason MAIL_NOT_CONNECTED, and the page shows a status line and never claims delivery.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(/** @type {Record<string, string>} */ vars) {
  vi.resetModules();
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  return import('../../api/_handlers/contact.js');
}
const resOf = () => /** @type {any} */ ({ statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });
const FORM = { email: 'rose@example.test', sujet: 'question', message: 'Bonjour' };

describe('R46 P20 contact channel', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each([
    [{ MAILER_PROVIDER: 'noop' }, 'NOT_CONNECTED'],
    [{ MAILER_PROVIDER: '' }, 'NOT_CONNECTED'],
    [{ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'pub:sec', MAILER_FROM: 'noreply@example.test', MAILER_MAILJET_SANDBOX: '1' }, 'NOT_CONNECTED'],
    [{ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: '', MAILER_FROM: 'noreply@example.test' }, 'NOT_CONNECTED'],
    [{ MAILER_PROVIDER: 'test', MAILER_FROM: 'noreply@example.test' }, 'TEST'],
    [{ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'pub:sec', MAILER_FROM: 'noreply@example.test' }, 'CONNECTED'],
  ])('GET with %o → %s, naming no provider and no value', async (vars, channel) => {
    const contact = await load(vars);
    const res = resOf();
    await contact.default(/** @type {any} */ ({ method: 'GET', headers: {} }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ channel, directAddress: 'contact@accesdirectaide.fr' });
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(JSON.stringify(res.body)).not.toMatch(/noop|mailjet|resend|msgraph|pub:sec|MAILER/i);
  });

  it('a POST on a disconnected channel: 503 NOT_DELIVERED with reason MAIL_NOT_CONNECTED, nothing kept', async () => {
    const contact = await load({ MAILER_PROVIDER: 'noop' });
    const res = resOf();
    await contact.default(/** @type {any} */ ({ method: 'POST', headers: { 'x-forwarded-for': '203.0.113.40' }, body: FORM }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ ok: false, delivered: false, code: 'NOT_DELIVERED', reason: 'MAIL_NOT_CONNECTED' });
  });

  it('other methods stay refused', async () => {
    const contact = await load({ MAILER_PROVIDER: 'noop' });
    const res = resOf();
    await contact.default(/** @type {any} */ ({ method: 'DELETE', headers: {} }), res);
    expect(res.statusCode).toBe(405);
  });

  it('the page reads the channel first, shows a status line, keeps the POST answer as the only proof, and says when the LAB outbox recorded it', () => {
    const page = readFileSync('src/pages/Contact.jsx', 'utf8');
    expect(page).toMatch(/fetch\('\/api\/contact', \{ headers: \{ Accept: 'application\/json' \} \}\)/);
    expect(page).toMatch(/data-testid="contact-channel-status"/);
    expect(page).toMatch(/PUBLIC_BETA_RESTRICTED/);
    expect(page).toMatch(/data\?\.reason === 'MAIL_NOT_CONNECTED'/);
    expect(page).toMatch(/data\?\.mailStatus === 'TEST_RECORDED'/);
    // the form is never disabled by the status read: the server answer stays the only proof (launcher DTA-B64 submits on a disconnected backend)
    expect(page).not.toMatch(/disabled=\{[^}]*channel/);
  });
});
