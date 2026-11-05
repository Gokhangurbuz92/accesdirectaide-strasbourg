/**
 * R46 (N02) — the STOP webhook is routed: POST /api/monitor/sms-inbound/twilio (CSRF-exempt /monitor/ prefix, like the Mailjet events webhook), off
 * unless configured, signature-checked, and let through the restricted beta only once configured. Synthetic values only.
 */
import { describe, expect, it } from 'vitest';
import { routes } from '../../api/routes.js';
import { isAllowedInPublicBeta, isSmsInboundRequest } from '../../api/_utils/public-beta.js';
import { handleInboundStop } from '../../api/_services/sms-stop.js';
import { twilioSignature } from '../../api/lib/sms-policy.js';

const URL_ = 'https://example.test/api/monitor/sms-inbound/twilio';
const ENV = { SMS_INBOUND_URL: URL_, TWILIO_AUTH_TOKEN: 'synthetic-token' };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } });

describe('R46 N02 STOP webhook routing', () => {
  it('is routed under the CSRF-exempt /monitor/ prefix to the STOP service', () => {
    const r = routes.find((x) => x.path === 'monitor/sms-inbound/twilio');
    expect(r?.match).toBe('exact');
    expect(String(r.handler)).toContain('sms-inbound-twilio.js');
  });
  it('the beta lets it through only when configured, POST only', () => {
    expect(isSmsInboundRequest('POST', 'monitor/sms-inbound/twilio', {})).toBe(false);
    expect(isSmsInboundRequest('POST', 'monitor/sms-inbound/twilio', { ...ENV, SMS_INBOUND_URL: 'http://x' })).toBe(false);
    expect(isSmsInboundRequest('GET', 'monitor/sms-inbound/twilio', ENV)).toBe(false);
    expect(isAllowedInPublicBeta('POST', 'monitor/sms-inbound/twilio', ENV)).toBe(true);
    expect(isAllowedInPublicBeta('POST', 'monitor/sms-inbound/twilio', {})).toBe(false);
  });
  it('unconfigured → 404; bad signature → 403 and nothing changes; valid non-STOP → empty TwiML, nothing changes', async () => {
    let touched = 0; const db = { execute: async () => { touched += 1; return { rows: [] }; }, transaction: async (f) => { touched += 1; return f({}); } };
    let r = mk(); await handleInboundStop({ method: 'POST', headers: {}, body: {} }, r, { env: {}, db }); expect(r.statusCode).toBe(404);
    const params = { From: '+33612345678', Body: 'bonjour' };
    r = mk(); await handleInboundStop({ method: 'POST', headers: { 'x-twilio-signature': 'forged' }, body: params }, r, { env: ENV, db }); expect(r.statusCode).toBe(403);
    r = mk(); await handleInboundStop({ method: 'POST', headers: { 'x-twilio-signature': twilioSignature(ENV.TWILIO_AUTH_TOKEN, URL_, params) }, body: params }, r, { env: ENV, db });
    expect(r.statusCode).toBe(200); expect(String(r.body)).toContain('<Response></Response>');
    expect(touched).toBe(0);
  });
  it('a signed STOP from a French number withdraws the SMS reminders (form-encoded body accepted)', async () => {
    const calls = []; const db = { execute: async () => { calls.push('select'); return { rows: [] }; }, transaction: async (f) => { calls.push('tx'); return f({ update: () => ({ set: () => ({ where: async () => {} }) }) }); } };
    const params = { From: '+33612345678', Body: 'STOP' };
    const body = new URLSearchParams(params).toString();
    const r = mk(); await handleInboundStop({ method: 'POST', headers: { 'x-twilio-signature': twilioSignature(ENV.TWILIO_AUTH_TOKEN, URL_, params) }, body }, r, { env: ENV, db });
    expect(r.statusCode).toBe(200); expect(calls).toEqual(['select', 'tx']);
  });
});
