/**
 * FA-D7 — contract tests of the partner referral adapter `ada.partner-referral/1` (no database, no network: a mock fetch).
 * Proves: canonical JSON + HMAC signature (fixed vector a partner can reproduce), replay window, tampering; minimal outbound event (exact keys, no state
 * before consent); strict inbound validation; configuration fail-closed (production approval, https, secrets); bounded retries with ONE idempotency key;
 * the callback handler's refusals; the capability is closed in production and HDS-bound; the OpenAPI spec documents both directions.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import * as C from '../../api/lib/partner-adapter/contract.js';
import * as K from '../../api/lib/partner-adapter/config.js';
import { capabilityState, CAPABILITIES, capabilitiesOfRoute } from '../../api/_utils/capabilities.js';
import { isAllowedInPublicBeta, SCHEDULED_JOBS } from '../../api/_utils/public-beta.js';

const SECRET = 'lab-partner-secret-not-real-0123456789abcdef';
const T = 1795000000;
const CB = { contract: C.PARTNER_CONTRACT, idempotencyKey: 'partner-key-0000000001', referralId: '7b1c6a52-0000-4000-8000-000000000001', action: 'accept', occurredAt: '2026-11-18T10:00:00.000Z' };
const ENV = { ADA_PARTNER_ADAPTERS: JSON.stringify([{ id: 'lab-partner', structureId: 'st-1', endpoint: 'http://127.0.0.1:9/ada', delegateProUserId: 'pu-1' }]), ADA_PARTNER_SECRET_LAB_PARTNER: SECRET };
const res = () => ({ statusCode: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

describe('FA-D7 contract: signature', () => {
  it('canonical JSON sorts keys at every level; the signature is a fixed, reproducible vector', () => {
    expect(C.canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}');
    // a partner implementation must produce exactly this value for this body, secret and timestamp
    // HMAC-SHA256(key 'k' x 32, '1700000000.{"a":"x","b":2}')
    expect(C.signatureOf('k'.repeat(32), 1700000000, { b: 2, a: 'x' })).toBe('436e556ec7c122d742f5c848ab0f4c9e63d0e82206cf30c675a9382607b9d7a6');
  });
  it('accepts a valid signature whatever the key order of the parsed body; refuses tampering, staleness, a short secret and a malformed header', () => {
    const h = C.signHeader(SECRET, CB, T);
    expect(C.verifySignature({ header: h, body: { ...CB }, secret: SECRET, nowSeconds: T + 10 })).toEqual({ ok: true });
    const reordered = Object.fromEntries(Object.entries(CB).reverse());
    expect(C.verifySignature({ header: h, body: reordered, secret: SECRET, nowSeconds: T })).toEqual({ ok: true });
    expect(C.verifySignature({ header: h, body: { ...CB, action: 'decline' }, secret: SECRET, nowSeconds: T }).reason).toBe('BAD_SIGNATURE');
    expect(C.verifySignature({ header: h, body: CB, secret: `${SECRET}x`, nowSeconds: T }).reason).toBe('BAD_SIGNATURE');
    expect(C.verifySignature({ header: h, body: CB, secret: SECRET, nowSeconds: T + C.SIGNATURE_TOLERANCE_S + 1 }).reason).toBe('STALE');
    expect(C.verifySignature({ header: h, body: CB, secret: SECRET, nowSeconds: T - C.SIGNATURE_TOLERANCE_S - 1 }).reason).toBe('STALE');
    expect(C.verifySignature({ header: h, body: CB, secret: 'short', nowSeconds: T }).reason).toBe('NOT_CONFIGURED');
    for (const bad of ['', 'v1=abc', `t=${T}`, `t=x,v1=${'0'.repeat(64)}`, undefined]) expect(C.verifySignature({ header: bad, body: CB, secret: SECRET, nowSeconds: T }).reason).toBe('MISSING_SIGNATURE');
  });
});

describe('FA-D7 contract: outbound event is minimal', () => {
  it('only the states the receiver must know, with exactly the documented keys (no person, no text)', () => {
    const ev = C.buildOutboundEvent({ id: 'ev-1', toStatus: 'SENT', createdAt: '2026-11-18T09:00:00Z' }, { id: 'ref-1', reasonCode: 'HOUSING', dueAt: '2026-11-23T09:00:00Z' }, 'https://lab.example.test/pro/orientations/ref-1');
    expect(ev.type).toBe('referral.received');
    expect(Object.keys(ev).sort()).toEqual([...C.OUTBOUND_KEYS.top].sort());
    expect(Object.keys(ev.referral).sort()).toEqual([...C.OUTBOUND_KEYS.referral].sort());
    for (const s of ['DRAFT', 'PENDING_CITIZEN', 'ACKNOWLEDGED', 'ACCEPTED', 'DECLINED', 'NEEDS_INFO', 'IN_PROGRESS', 'COMPLETED']) {
      expect(C.buildOutboundEvent({ id: 'e', toStatus: s, createdAt: new Date() }, { id: 'r' }, 'u'), s).toBeNull();
    }
    expect(C.OUTBOUND_STATES).toEqual(['SENT', 'CANCELLED', 'EXPIRED', 'CLOSED']);
  });
});

describe('FA-D7 contract: inbound validation', () => {
  it('accepts the documented commands and normalizes the input', () => {
    expect(C.validateInbound(CB)).toEqual({ ok: true, cmd: { idempotencyKey: CB.idempotencyKey, referralId: CB.referralId, action: 'accept', input: {} } });
    expect(C.validateInbound({ ...CB, action: 'decline', responseCode: 'NO_CAPACITY', message: 'Complet ce mois-ci' }).ok).toBe(true);
    expect(C.validateInbound({ ...CB, action: 'needs_info', message: 'Merci de préciser la date.' }).ok).toBe(true);
    expect(C.validateInbound({ ...CB, action: 'complete', outcome: 'INFORMATION_PROVIDED', citizenSummary: 'Informations données.' }).ok).toBe(true);
  });
  it('refuses unknown fields, actions outside v1 (redirect, cancel, close), missing codes and misplaced fields — naming the field, never echoing a value', () => {
    const p = (b) => (C.validateInbound(b).ok ? [] : C.validateInbound(b).problems);
    expect(p(null)).toEqual(['body']); expect(p([])).toEqual(['body']);
    expect(p({ ...CB, name: 'Jean' })).toContain('extra-field');
    expect(p({ ...CB, contract: 'ada.partner-referral/2' })).toContain('contract');
    expect(p({ ...CB, idempotencyKey: 'short' })).toContain('idempotencyKey');
    for (const action of ['cancel', 'close', 'reply', 'propose', 'link_appointment']) expect(p({ ...CB, action })).toContain('action');
    expect(p({ ...CB, action: 'decline', responseCode: 'REDIRECT_SUGGESTED' })).toContain('responseCode');
    expect(p({ ...CB, action: 'decline' })).toContain('responseCode');
    expect(p({ ...CB, responseCode: 'NO_CAPACITY' })).toContain('responseCode');
    expect(p({ ...CB, action: 'needs_info', message: 'ok' })).toContain('message');
    expect(p({ ...CB, action: 'complete' })).toContain('outcome');
    expect(p({ ...CB, outcome: 'OTHER' })).toContain('outcome');
    expect(p({ ...CB, message: 'x'.repeat(1501) })).toContain('message');
    expect(p({ ...CB, occurredAt: 'yesterday' })).toContain('occurredAt');
    expect(JSON.stringify(p({ ...CB, name: 'Jean Dupont' }))).not.toContain('Jean');
  });
});

describe('FA-D7 configuration is fail-closed', () => {
  it('nothing configured = NOT_CONFIGURED (graceful no-integration); malformed = INVALID with field codes only', () => {
    expect(K.partnerAdapterConfig({}).state).toBe('NOT_CONFIGURED');
    expect(K.partnerAdapterConfig({ ADA_PARTNER_ADAPTERS: '{' }).state).toBe('INVALID');
    expect(K.partnerAdapterConfig({ ADA_PARTNER_ADAPTERS: '[]' }).state).toBe('INVALID');
    expect(K.partnerAdapterConfig({ ...ENV, ADA_PARTNER_SECRET_LAB_PARTNER: 'short' }).problems).toEqual(['[0]:secret']);
    const two = JSON.stringify([{ id: 'a-1', structureId: 's', endpoint: 'https://a.example.test', delegateProUserId: 'p' }, { id: 'a-1', structureId: 's', endpoint: 'ftp://x', delegateProUserId: '', extra: 1 }]);
    expect(K.partnerAdapterConfig({ ADA_PARTNER_ADAPTERS: two, ADA_PARTNER_SECRET_A_1: SECRET }).problems).toEqual(expect.arrayContaining(['[1]:id', '[1]:structureId', '[1]:endpoint', '[1]:delegateProUserId', '[1]:extra-field']));
    const st = K.partnerAdapterStatus(ENV);
    expect(st).toEqual({ provider: 'partner-referral-adapter', contract: C.PARTNER_CONTRACT, state: 'CONFIGURED', partners: ['lab-partner'], problems: [] });
    expect(JSON.stringify(st)).not.toContain(SECRET); expect(JSON.stringify(st)).not.toContain('127.0.0.1');
  });
  it('production / preview: loopback http refused, and an explicit approval switch is required', () => {
    expect(K.partnerAdapterConfig({ ...ENV, VERCEL_ENV: 'production' }).problems).toEqual(['[0]:endpoint']);
    const https = { ...ENV, ADA_PARTNER_ADAPTERS: ENV.ADA_PARTNER_ADAPTERS.replace('http://127.0.0.1:9/ada', 'https://partner.example.test/ada') };
    for (const VERCEL_ENV of ['production', 'preview']) expect(K.partnerAdapterConfig({ ...https, VERCEL_ENV }).state).toBe('PRODUCTION_NOT_APPROVED');
    expect(K.partnerAdapterConfig({ ...https, VERCEL_ENV: 'production', ADA_PARTNER_ADAPTERS_PRODUCTION_APPROVED: 'true' }).state).toBe('CONFIGURED');
    expect(K.partnerById('lab-partner', { ...https, VERCEL_ENV: 'production' })).toBeNull();
  });
});

describe('FA-D7 transport: bounded retries, one idempotency key', () => {
  const partner = { id: 'lab-partner', structureId: 'st', endpoint: 'http://127.0.0.1:9/ada', delegateProUserId: 'p', secret: SECRET };
  const event = C.buildOutboundEvent({ id: 'ev-42', toStatus: 'SENT', createdAt: '2026-11-18T09:00:00Z' }, { id: 'ref-42', reasonCode: 'HOUSING' }, 'https://lab.example.test/pro/orientations/ref-42');
  const reply = (status, headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
  it('retries 5xx / 429 / network errors with the same Idempotency-Key and a valid signature each time; stops at the bound', async () => {
    const calls = []; const sleeps = [];
    const fetchImpl = vi.fn(async (url, init) => { calls.push(init); if (calls.length === 1) throw new Error('ECONNRESET'); if (calls.length === 2) return reply(429, { 'retry-after': '120' }); return reply(204); });
    const out = await K.deliverEvent(partner, event, { fetchImpl, sleep: async (ms) => { sleeps.push(ms); }, nowSeconds: () => T });
    expect(out).toEqual({ outcome: 'DELIVERED', attempts: 3, httpStatus: 204 });
    expect(sleeps).toEqual([500, K.DELIVERY.maxRetryAfterMs]);   // Retry-After 120 s capped
    for (const init of calls) {
      expect(init.headers['Idempotency-Key']).toBe('ev-42'); expect(init.redirect).toBe('error'); expect(init.headers['ADA-Contract']).toBe(C.PARTNER_CONTRACT);
      expect(C.verifySignature({ header: init.headers['ADA-Signature'], body: JSON.parse(init.body), secret: SECRET, nowSeconds: T })).toEqual({ ok: true });
    }
    const down = await K.deliverEvent(partner, event, { fetchImpl: async () => reply(503), sleep: async () => {} });
    expect(down).toEqual({ outcome: 'FAILED', attempts: K.DELIVERY.attempts, httpStatus: 503 });
  });
  it('a 4xx refusal is final (no retry)', async () => {
    const fetchImpl = vi.fn(async () => reply(422));
    expect(await K.deliverEvent(partner, event, { fetchImpl, sleep: async () => {} })).toEqual({ outcome: 'REJECTED', attempts: 1, httpStatus: 422 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('FA-D7 callback handler (no database: the apply step is injected)', async () => {
  const handler = (await import('../../api/_handlers/monitor/partner-referral-events.js')).default;
  const call = async ({ method = 'POST', partner = 'lab-partner', body = CB, header, env = ENV, apply } = {}) => {
    const r = res(); const req = { method, query: { partner }, headers: { 'ada-signature': header ?? C.signHeader(SECRET, body, T) }, body };
    await handler(req, r, { envVars: env, nowSeconds: T, apply: apply || (async () => ({ status: 200, body: { ok: true } })) }); return r;
  };
  it('405 other methods; 404 when not configured or unknown partner (no-integration); 401 bad / stale signature; 413 large body; 200 only when signed', async () => {
    expect((await call({ method: 'GET' })).statusCode).toBe(405);
    expect((await call({ env: {} })).statusCode).toBe(404);
    expect((await call({ partner: 'other-partner' })).statusCode).toBe(404);
    expect((await call({ partner: '../x' })).statusCode).toBe(404);
    expect((await call({ header: C.signHeader(`${SECRET}x`, CB, T) })).body).toEqual({ error: 'UNAUTHORIZED', reason: 'BAD_SIGNATURE' });
    expect((await call({ header: C.signHeader(SECRET, CB, T - 3600) })).body.reason).toBe('STALE');
    const big = { ...CB, message: 'x'.repeat(20000) };
    expect((await call({ body: big })).statusCode).toBe(413);
    const apply = vi.fn(async () => ({ status: 200, body: { ok: true, referral: { id: CB.referralId, status: 'ACCEPTED' } } }));
    const ok = await call({ apply });
    expect(ok.statusCode).toBe(200); expect(apply).toHaveBeenCalledTimes(1); expect(apply.mock.calls[0][0].id).toBe('lab-partner');
    expect(ok.headers['Cache-Control']).toBe('no-store');
    const boom = await call({ apply: async () => { throw new Error('db down'); } });
    expect(boom.statusCode).toBe(500); expect(boom.body).toEqual({ error: 'NOT_APPLIED' });
  });
});

describe('FA-D7 gates: closed capability, HDS-bound, beta, job, OpenAPI', () => {
  it('the capability is outside the AIPD, HDS-bound, closed in production unless listed AND HDS-attested', () => {
    expect(CAPABILITIES['partner.referral_adapter']).toMatchObject({ aipd: 'out', requiresHds: true, surface: 'pro' });
    expect(capabilityState('partner.referral_adapter', { VERCEL_ENV: 'production' }).open).toBe(false);
    const listed = { VERCEL_ENV: 'production', ADA_CAPABILITIES_OPEN: 'partner.referral_adapter' };
    expect(capabilityState('partner.referral_adapter', listed).reason).toBe('HDS_HOSTING_NOT_ATTESTED');
    expect(capabilitiesOfRoute('monitor/partner/referral-events')).toEqual(['partner.referral_adapter', 'pro.referrals']);
  });
  it('restricted beta: the callback passes the beta gate only once adapters are configured; the outbox is a category C job', () => {
    const beta = { ADA_PUBLIC_BETA_RESTRICTED: '1' };
    expect(isAllowedInPublicBeta('POST', 'monitor/partner/referral-events', beta)).toBe(false);
    expect(isAllowedInPublicBeta('POST', 'monitor/partner/referral-events', { ...beta, ...ENV })).toBe(true);
    expect(isAllowedInPublicBeta('GET', 'monitor/partner/referral-events', { ...beta, ...ENV })).toBe(false);
    expect(SCHEDULED_JOBS['partner-outbox']).toBe('C');
    expect(isAllowedInPublicBeta('GET', 'cron/partner-outbox', { ...beta, ADA_BETA_OPEN_JOBS: 'partner-outbox' })).toBe(false);
    expect(JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons.map((c) => c.path)).not.toContain('/api/cron/partner-outbox');
  });
  it('OpenAPI documents both directions with the versioned contract and closed schemas', () => {
    const spec = JSON.parse(fs.readFileSync('docs/openapi.json', 'utf8'));
    expect(spec.paths['/monitor/partner/referral-events'].post.security).toEqual([{ PartnerSignature: [] }]);
    expect(spec.paths['/cron/partner-outbox']).toBeDefined();
    expect(spec['x-webhooks'].partnerReferralEvent.post.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/PartnerReferralEvent');
    const ev = spec.components.schemas.PartnerReferralEvent; const cb = spec.components.schemas.PartnerReferralCallback;
    expect(ev.additionalProperties).toBe(false); expect(cb.additionalProperties).toBe(false);
    expect(Object.keys(ev.properties).sort()).toEqual([...C.OUTBOUND_KEYS.top].sort());
    expect(Object.keys(ev.properties.referral.properties).sort()).toEqual([...C.OUTBOUND_KEYS.referral].sort());
    expect(cb.properties.action.enum).toEqual([...C.INBOUND_ACTIONS]);
    expect(cb.properties.responseCode.enum).toEqual([...C.INBOUND_DECLINE_CODES]);
    expect(ev.properties.contract.enum).toEqual([C.PARTNER_CONTRACT]);
  });
});
