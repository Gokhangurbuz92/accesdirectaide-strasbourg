/**
 * PKG-11 / P20 — public contact form hardening (offline: test mail outbox, in-memory rate limit, no network).
 *  - every value is validated and HTML-escaped; the « page concernée » is a link only on accesdirectaide.fr;
 *  - the acknowledgement to the given address carries no text from the form; the subject carries no free text;
 *  - the answer is honest (503 when nothing was handed to a provider, no provider name); 5 messages per hour per IP; a filled honeypot is refused;
 *  - the handler no longer overrides the router's CORS allow-list with `*`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

async function load(provider) {
  vi.resetModules();
  vi.stubEnv('MAILER_PROVIDER', provider); vi.stubEnv('MAILER_FROM', 'noreply@example.test');
  const mailer = await import('../../api/_utils/mailer.js');
  const contact = await import('../../api/_handlers/contact.js');
  return { mailer, contact };
}
const reqOf = (body, ip = '203.0.113.7') => ({ method: 'POST', headers: { 'x-forwarded-for': ip }, body });
const resOf = () => ({ statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });
const FORM = { nom: 'Eve <b>x</b>', email: 'eve@example.test', sujet: 'signalement_erreur', message: 'Bonjour <script>alert(1)</script> & merci', page_concernee: 'javascript:alert(1)' };

describe('PKG-11 / P20 contact form', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('validation: honeypot, subject allow-list, lengths, header-safe values; links only on the site', async () => {
    const { contact } = await load('test');
    expect(contact.validateContact({ ...FORM, site_web: 'http://spam' })).toMatchObject({ ok: false, status: 400, body: { code: 'FORM_REJECTED' } });
    expect(contact.validateContact({ ...FORM, sujet: 'x\r\nBcc: a@b.c' }).ok).toBe(false);
    expect(contact.validateContact({ ...FORM, email: 'a@b.c\r\nBcc: z@y.x' }).ok).toBe(false);
    expect(contact.validateContact({ ...FORM, message: 'x'.repeat(5001) }).ok).toBe(false);
    expect(contact.validateContact({ ...FORM, nom: 'A\r\nB\u0000C' }).value.nom).toBe('A B C');
    expect(contact.safePageLink('/aides/apl')).toBe('https://accesdirectaide.fr/aides/apl');
    expect(contact.safePageLink('https://www.accesdirectaide.fr/aides/apl?x=1')).toBe('https://www.accesdirectaide.fr/aides/apl?x=1');
    for (const bad of ['javascript:alert(1)', '//evil.example/x', 'https://evil.example/', 'http://accesdirectaide.fr/', 'https://u:p@accesdirectaide.fr/', 'Fiche APL']) expect(contact.safePageLink(bad)).toBe(null);
  });

  it('the team mail is escaped, the acknowledgement carries no form text, the answer names no provider', async () => {
    const { mailer, contact } = await load('test');
    const res = resOf();
    await contact.default(reqOf(FORM, '203.0.113.8'), res);
    expect([res.statusCode, res.body]).toEqual([200, { ok: true, delivered: true }]);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
    const [team, ack] = mailer.__getTestOutbox();
    expect(team.to).toBe('contact@accesdirectaide.fr');
    expect(team.subject).toBe("[Contact] Signalement d'erreur");
    expect(team.html).not.toMatch(/<script>|<b>x<\/b>|href="javascript/);
    expect(team.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; merci');
    expect(team.html).toContain('javascript:alert(1)');   // shown as text, never as a link
    expect(ack.to).toBe('eve@example.test');
    expect(`${ack.subject}\n${ack.text}\n${ack.html || ''}`).not.toMatch(/Eve|script|merci|alert/);
  });

  it('nothing handed to a provider → 503 NOT_DELIVERED, no acknowledgement', async () => {
    const { mailer, contact } = await load('noop');
    const res = resOf();
    await contact.default(reqOf(FORM, '203.0.113.9'), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ ok: false, delivered: false, code: 'NOT_DELIVERED' });
    expect(JSON.stringify(res.body)).not.toMatch(/noop|mailjet|resend|MAILER/i);
    expect(mailer.__getTestOutbox()).toHaveLength(0);
  });

  it('five messages per hour per IP; the page reports failures honestly', async () => {
    const { contact } = await load('test');
    const codes = [];
    for (let i = 0; i < 6; i += 1) { const r = resOf(); await contact.default(reqOf(FORM, '203.0.113.10'), r); codes.push(r.statusCode); }
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    const other = resOf(); await contact.default(reqOf(FORM, '203.0.113.11'), other); expect(other.statusCode).toBe(200);
    const page = readFileSync('src/pages/Contact.jsx', 'utf8');
    expect(page).toMatch(/res\.ok && data\?\.delivered === true/);
    expect(page).not.toMatch(/\.catch\(\(\) => null\)|garantie|48h|chiffrés à l/);
  });
});
