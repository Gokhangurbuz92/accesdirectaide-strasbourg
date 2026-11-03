/**
 * R41-E — the Resend (Svix) webhook signature check and the address-free event summary (api/lib/resend-webhook.js, not routed). Fail-closed without a
 * secret. The first case is the public Svix test vector that Resend's verification page shows (message id, timestamp, payload, v1 signature); its
 * secret is Svix's published TEST secret, split here so no scanner mistakes it for a credential. Everything else is signed in the test with a random key.
 */
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mailEventSummary, verifyResendWebhook } from '../../api/lib/resend-webhook.js';

const PUBLIC_TEST_SECRET = ['whsec', 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'].join('_');
const key = crypto.randomBytes(24);
const SECRET = `whsec_${key.toString('base64')}`;
const sign = (id, ts, body, k = key) => `v1,${crypto.createHmac('sha256', k).update(`${id}.${ts}.${body}`).digest('base64')}`;
const NOW = 1_793_750_000;
const bounced = JSON.stringify({ type: 'email.bounced', created_at: '2026-11-03T10:00:00.000Z', data: { email_id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c', to: ['personne@example.test'], from: 'noreply@example.test', subject: 'Rappel', bounce: { type: 'Permanent', subType: 'Suppressed', message: 'personne@example.test does not exist' } } });
const headers = (body, { id = 'msg_test_1', ts = NOW, k = key } = {}) => ({ 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': sign(id, ts, body, k) });

describe('verifyResendWebhook', () => {
  it('accepts the published Svix test vector', () => {
    const r = verifyResendWebhook({ rawBody: '{"test": 2432232314}', secret: PUBLIC_TEST_SECRET, nowSeconds: 1614265330,
      headers: { 'svix-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek', 'svix-timestamp': '1614265330', 'svix-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=' } });
    expect(r).toEqual({ ok: true, event: { test: 2432232314 } });
  });
  it('fail-closed: no secret, or a secret that is not a whsec_ key, accepts nothing', () => {
    for (const secret of [undefined, null, '', '   ']) expect(verifyResendWebhook({ rawBody: bounced, headers: headers(bounced), secret, nowSeconds: NOW })).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
    expect(verifyResendWebhook({ rawBody: bounced, headers: headers(bounced), secret: key.toString('base64'), nowSeconds: NOW })).toEqual({ ok: false, reason: 'BAD_SECRET' });
    expect(verifyResendWebhook({ rawBody: bounced, headers: headers(bounced), secret: 'whsec_c2hvcnQ=', nowSeconds: NOW })).toEqual({ ok: false, reason: 'BAD_SECRET' });
  });
  it('accepts a correctly signed event (several signatures: any v1 match) and refuses a tampered body, another key, missing headers, a stale or future timestamp', () => {
    expect(verifyResendWebhook({ rawBody: bounced, headers: headers(bounced), secret: SECRET, nowSeconds: NOW }).ok).toBe(true);
    const h = headers(bounced); h['svix-signature'] = `v1,AAAA ${sign('x', NOW, 'y')} ${h['svix-signature']}`;
    expect(verifyResendWebhook({ rawBody: Buffer.from(bounced), headers: h, secret: SECRET, nowSeconds: NOW }).ok).toBe(true);
    expect(verifyResendWebhook({ rawBody: bounced.replace('Permanent', 'Temporary'), headers: headers(bounced), secret: SECRET, nowSeconds: NOW })).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(verifyResendWebhook({ rawBody: bounced, headers: headers(bounced, { k: crypto.randomBytes(24) }), secret: SECRET, nowSeconds: NOW })).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(verifyResendWebhook({ rawBody: bounced, headers: { ...headers(bounced), 'svix-signature': sign('msg_test_1', NOW, bounced).replace('v1,', 'v2,') }, secret: SECRET, nowSeconds: NOW })).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(verifyResendWebhook({ rawBody: bounced, headers: { 'svix-id': 'msg_test_1' }, secret: SECRET, nowSeconds: NOW })).toEqual({ ok: false, reason: 'MISSING_HEADERS' });
    expect(verifyResendWebhook({ rawBody: bounced, headers: headers(bounced, { ts: NOW - 301 }), secret: SECRET, nowSeconds: NOW })).toEqual({ ok: false, reason: 'STALE' });
    expect(verifyResendWebhook({ rawBody: bounced, headers: headers(bounced, { ts: NOW + 301 }), secret: SECRET, nowSeconds: NOW })).toEqual({ ok: false, reason: 'STALE' });
    expect(verifyResendWebhook({ rawBody: 'not json', headers: headers('not json'), secret: SECRET, nowSeconds: NOW })).toEqual({ ok: false, reason: 'BAD_PAYLOAD' });
  });
  it('reads Fetch API Headers too', () => {
    expect(verifyResendWebhook({ rawBody: bounced, headers: new Headers(headers(bounced)), secret: SECRET, nowSeconds: NOW }).ok).toBe(true);
  });
});

describe('mailEventSummary', () => {
  it('keeps the type, the e-mail id and the meaning — never the address, the subject or the bounce message', () => {
    const v = verifyResendWebhook({ rawBody: bounced, headers: headers(bounced), secret: SECRET, nowSeconds: NOW });
    const s = mailEventSummary(v.ok ? v.event : null);
    expect(s).toEqual({ type: 'email.bounced', emailId: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c', kind: 'bounce_permanent', suppress: true });
    expect(JSON.stringify(s)).not.toMatch(/@|Rappel|exist/);
  });
  it('classifies every documented email.* event', () => {
    const k = (type, bounce) => mailEventSummary({ type, data: { email_id: 'id-1', ...(bounce ? { bounce: { type: bounce } } : {}) } });
    expect(k('email.bounced', 'Temporary')).toMatchObject({ kind: 'bounce_temporary', suppress: false });
    expect(k('email.complained')).toMatchObject({ kind: 'complaint', suppress: true });
    expect(k('email.suppressed')).toMatchObject({ kind: 'suppressed', suppress: true });
    expect(k('email.delivered')).toMatchObject({ kind: 'delivered', suppress: false });
    expect(k('email.delivery_delayed')).toMatchObject({ kind: 'delayed', suppress: false });
    expect(k('email.failed')).toMatchObject({ kind: 'failed', suppress: false });
    expect(k('email.sent')).toMatchObject({ kind: 'sent', suppress: false });
    expect(k('email.opened')).toMatchObject({ kind: 'other', suppress: false });
    expect(mailEventSummary({ type: '<script>', data: { email_id: 'a@b' } })).toEqual({ type: 'unknown', emailId: null, kind: 'other', suppress: false });
  });
});
