/**
 * PKG-11 / N02 — SMS rules (pure): the 08:00-20:00 Paris send window (winter and summer time), the opt-out line (« STOP » only when the inbound webhook is
 * configured), STOP keywords, French numbers, the provider signature, and the inbound webhook's fail-closed entry (no database touched before a valid signature).
 */
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isSmsSendWindow, isStopKeyword, normalizeFrenchPhone, optOutLine, parisHour, twilioSignature, verifyTwilioSignature, withOptOut } from '../../api/lib/sms-policy.js';
import { handleInboundStop as inbound } from '../../api/_services/sms-stop.js';

const GSM7 = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà]*$/;
const ON = { SMS_INBOUND_URL: 'https://example.test/api/public/sms-inbound', TWILIO_AUTH_TOKEN: 'qa-token' };
const resOf = () => ({ statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; } });
const untouchable = new Proxy({}, { get() { throw new Error('the database must not be touched'); } });

describe('PKG-11 / N02 SMS policy', () => {
  it('send window 08:00-20:00 Paris, winter (UTC+1) and summer (UTC+2)', () => {
    const at = (iso) => isSmsSendWindow(new Date(iso));
    expect([at('2026-01-15T06:59:00Z'), at('2026-01-15T07:00:00Z'), at('2026-01-15T18:59:00Z'), at('2026-01-15T19:00:00Z')]).toEqual([false, true, true, false]);
    expect([at('2026-07-15T05:59:00Z'), at('2026-07-15T06:00:00Z'), at('2026-07-15T17:59:00Z'), at('2026-07-15T18:00:00Z')]).toEqual([false, true, true, false]);
    expect(parisHour(new Date('2026-03-29T01:30:00Z'))).toBe(3);   // the night of the change to summer time
    expect(at('2026-10-23T00:59:51Z')).toBe(false);                 // the hour of a typical native QA run: no SMS
  });

  it('the opt-out line promises STOP only when the inbound webhook is routed and configured; GSM-7 only', () => {
    expect(optOutLine({})).toBe('Arreter ces SMS : Mon compte > Notifications.');
    expect(optOutLine(ON)).toBe('Arreter ces SMS : Mon compte > Notifications.');   // configured but not routed: no STOP promise
    expect(optOutLine({ ...ON, SMS_INBOUND_URL: 'http://example.test/x' }, true)).not.toMatch(/STOP/);
    expect(optOutLine(ON, true)).toMatch(/^STOP /);
    for (const env of [{}, ON]) expect(withOptOut('Rappel ADA : Votre RDV est prévu demain à 10:00.', env)).toMatch(GSM7);
  });

  it('STOP keywords and French numbers', () => {
    for (const t of ['stop', 'Stop.', ' ARRÊT', 'Arrêter svp', 'désabonner', 'STOPALL']) expect(isStopKeyword(t), t).toBe(true);
    for (const t of ['non', 'stopper', 'merci stop', '', null]) expect(isStopKeyword(t), String(t)).toBe(false);
    expect(['06 12 34 56 78', '+33 6 12 34 56 78', '0033612345678', '06.12.34.56.78'].map(normalizeFrenchPhone)).toEqual(Array(4).fill('+33612345678'));
    for (const t of ['+447700900123', '0012', '+33012345678', '']) expect(normalizeFrenchPhone(t), t).toBe(null);
  });

  it('provider signature: URL + sorted fields, HMAC-SHA1; any change refuses', () => {
    const params = { To: '+33600000000', From: '+33612345678', Body: 'STOP', AccountSid: 'ACqa' };
    const expected = crypto.createHmac('sha1', 'qa-token').update(`${ON.SMS_INBOUND_URL}AccountSidACqaBodySTOPFrom+33612345678To+33600000000`).digest('base64');
    expect(twilioSignature('qa-token', ON.SMS_INBOUND_URL, params)).toBe(expected);
    expect(verifyTwilioSignature({ authToken: 'qa-token', url: ON.SMS_INBOUND_URL, params, signature: expected })).toBe(true);
    expect(verifyTwilioSignature({ authToken: 'other', url: ON.SMS_INBOUND_URL, params, signature: expected })).toBe(false);
    expect(verifyTwilioSignature({ authToken: 'qa-token', url: ON.SMS_INBOUND_URL, params: { ...params, From: '+33600000001' }, signature: expected })).toBe(false);
    expect(verifyTwilioSignature({ authToken: 'qa-token', url: ON.SMS_INBOUND_URL, params, signature: 'short' })).toBe(false);
  });

  it('inbound webhook: off unless configured (404); a bad signature is 403 before any database access; a non-STOP is ignored', async () => {
    const body = { From: '+33612345678', Body: 'STOP', To: '+33600000000' };
    let r = resOf(); await inbound({ method: 'POST', headers: {}, body }, r, { env: {}, db: untouchable }); expect(r.statusCode).toBe(404);
    r = resOf(); await inbound({ method: 'POST', headers: { 'x-twilio-signature': 'forged' }, body }, r, { env: ON, db: untouchable }); expect(r.statusCode).toBe(403);
    const hello = { ...body, Body: 'Bonjour' };
    r = resOf(); await inbound({ method: 'POST', headers: { 'x-twilio-signature': twilioSignature('qa-token', ON.SMS_INBOUND_URL, hello) }, body: hello }, r, { env: ON, db: untouchable });
    expect([r.statusCode, r.body]).toEqual([200, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>']);
  });

  it('every sender applies the window and the opt-out line; the webhook is not routed while the CSRF router code stays pinned', () => {
    for (const f of ['api/_handlers/cron/rdv-reminder.js', 'api/_handlers/cron/parcours-reminder.js', 'api/_handlers/public/sms-notify.js']) {
      const s = readFileSync(f, 'utf8'); expect(s, f).toMatch(/isSmsSendWindow\(/); expect(s, f).toMatch(/withOptOut\(/);
    }
    expect(readFileSync('api/routes.js', 'utf8')).not.toMatch(/sms-inbound/);
  });
});
