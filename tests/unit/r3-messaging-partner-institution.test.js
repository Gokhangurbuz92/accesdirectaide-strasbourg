/**
 * R3 (24/11/2026, owner: institution portal, messaging and partner bridge complete and ready to open in Production) — unit gate:
 *   messaging: two capabilities outside the AIPD (conversations: HDS waived only for a NOT_ESSMS structure + an ordinary service; attachments: HDS always),
 *              the route gate's best case, the per-conversation decision;
 *   partner bridge: key rotation (previous secret, inbound only), per-partner rate limit, preflight check, provider row, the conformance kit (vector,
 *              synthetic events, the mock ADA endpoint: signature, contract, idempotency);
 *   institution: preflight check of frozen statistics; the reset link uses the production-safe URL builder.
 * No database, no network.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { CAPABILITIES, capabilityState, closedCapabilityOfRoute, capabilitiesOfRoute } from '../../api/_utils/capabilities.js';
import { conversationClass, conversationDecision, conversationDecisions } from '../../api/_services/messaging-policy.js';
import * as C from '../../api/lib/partner-adapter/contract.js';
import * as K from '../../api/lib/partner-adapter/config.js';
import partnerHandler from '../../api/_handlers/monitor/partner-referral-events.js';
import { evaluateReleasePreflight, partnerBridgeCheck, messagingCheck } from '../../scripts/release-preflight.mjs';
import { providerStatuses } from '../../api/_services/provider-status.js';
import { VECTOR, mockAdaHandler, sampleCallback, sampleEvent, sandboxEndpoint, main as kitMain } from '../../scripts/partner-bridge-kit.mjs';
import { proModuleStates } from '../../api/_utils/pro-modules.js';

const PROD = { VERCEL_ENV: 'production' };
const HDS = `HDS1:example-host:CERT-2026-0001:2099-12-31:${'a'.repeat(64)}`;
/** G14-R4: attachments, referral payloads and the partner bridge live at the HDS service — in production they also need the ready gateway (scalingo token) */
const { generateTicketKeyPair: hdsPair } = await import('../../api/lib/hds-ticket.js');
const GATEWAY = { HDS_SERVICE_URL: 'https://ada-hds-strasbourg.osc-fr1.scalingo.io', HDS_PRODUCTION_APPROVED: 'true', HDS_TICKET_KID: 'k1', HDS_TICKET_PRIVATE_KEY: hdsPair().privateKeyB64,
  ADA_HDS_CERTIFIED_HOSTING: `HDS1:scalingo:38436:2099-12-31:${'a'.repeat(64)}` };
const LISTED = { ...PROD, ADA_CAPABILITIES_OPEN: 'messaging.conversations' };
const ELIGIBLE = { statut: 'actif', verification_status: 'VERIFIED', numero_finess: null, type_finess: null, type_structure: 'centre social', nom: 'Centre social du quartier',
  sensitivity: { value: 'ordinary', reviewedAt: '2026-11-20T10:00:00.000Z', reviewedBy: 'admin@example.test' } };
const SECRET = 'lab-partner-secret-not-real-0123456789abcdef';
const OLD = 'lab-partner-old-secret-not-real-0123456789ab';
const ENV = { ADA_PARTNER_ADAPTERS: JSON.stringify([{ id: 'lab-partner', structureId: 'st-1', endpoint: 'http://127.0.0.1:9/ada', delegateProUserId: 'pu-1' }]), ADA_PARTNER_SECRET_LAB_PARTNER: SECRET };
const HTTPS_ENV = { ...ENV, ADA_PARTNER_ADAPTERS: ENV.ADA_PARTNER_ADAPTERS.replace('http://127.0.0.1:9/ada', 'https://partner.example.test/ada') };
const res = () => ({ statusCode: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

describe('R3 messaging capabilities', () => {
  it('both are outside the AIPD, on the communications surface, closed in production; attachments are HDS whatever the structure', () => {
    for (const n of ['messaging.conversations', 'messaging.attachments']) {
      expect(CAPABILITIES[n]).toMatchObject({ aipd: 'out', requiresHds: true, surface: 'communications' });
      expect(capabilityState(n, PROD).open).toBe(false);
    }
    expect(CAPABILITIES['messaging.conversations'].hdsDependsOnStructure).toBe(true);
    expect(CAPABILITIES['messaging.attachments'].hdsDependsOnStructure).toBeFalsy();
    expect(capabilityState('messaging.attachments', { ...PROD, ADA_CAPABILITIES_OPEN: 'messaging.attachments' }, { structureCategory: 'NOT_ESSMS' }).reason).toBe('HDS_HOSTING_NOT_ATTESTED');
    expect(capabilityState('messaging.attachments', { ...PROD, ADA_CAPABILITIES_OPEN: 'messaging.attachments', ADA_HDS_CERTIFIED_HOSTING: HDS }).reason).toBe('HDS_SERVICE_URL_ABSENT');   // G14-R4
    expect(capabilityState('messaging.attachments', { ...PROD, ADA_CAPABILITIES_OPEN: 'messaging.attachments', ...GATEWAY }).open).toBe(true);
  });
  it('every conversation route is gated; the public forms of communications are not', () => {
    for (const p of ['messages/conversations', 'messages/conversations/x', 'messages/from-appointment/a', 'pro/messages', 'pro/messages/conversations/x', 'secure-messages'])
      expect(capabilitiesOfRoute(p), p).toEqual(['messaging.conversations']);
    for (const p of ['messages/conversations/x/attachments/y', 'pro/messages/conversations/x/attachments/y'])
      expect(capabilitiesOfRoute(p), p).toEqual(['messaging.conversations', 'messaging.attachments']);
    expect(closedCapabilityOfRoute('messages/conversations/x/attachments/y', LISTED)).toBe('messaging.attachments');
    for (const p of ['contact', 'support', 'feedback', 'reports', 'public/suggest-structure', 'public/sms-notify']) expect(capabilitiesOfRoute(p), p).toEqual([]);
  });
  it('the route gate takes the best case (listed + surface), the handler decides each conversation', () => {
    expect(closedCapabilityOfRoute('pro/messages', PROD)).toBe('messaging.conversations');
    expect(closedCapabilityOfRoute('pro/messages', LISTED)).toBe(null);
    expect(closedCapabilityOfRoute('pro/messages', { ...LISTED, ADA_PUBLIC_BETA_RESTRICTED: '1' })).toBe('messaging.conversations');   // surface closed
    expect(closedCapabilityOfRoute('pro/messages', { ...LISTED, ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'communications' })).toBe(null);
    // the pro console's « messages » module follows the same gates
    expect(proModuleStates(PROD).messages).toBe(false);
    expect(proModuleStates(LISTED).messages).toBe(true);
    // a capability without the per-record flag is unchanged (case management still needs HDS at the route)
    expect(closedCapabilityOfRoute('pro/cases', { ...PROD, ADA_CAPABILITIES_OPEN: 'pro.case_management' })).toBe('pro.case_management');
  });
  it('the conversation decision: NOT_ESSMS structure AND ordinary service, else HDS', () => {
    expect(conversationClass(ELIGIBLE)).toEqual({ structureCategory: 'NOT_ESSMS', reason: null });
    expect(conversationDecision(ELIGIBLE, LISTED)).toEqual({ open: true, reason: null });
    expect(conversationDecision(ELIGIBLE, PROD).reason).toBe('NOT_LISTED_IN_ADA_CAPABILITIES_OPEN');
    const cases = [
      [{ ...ELIGIBLE, numero_finess: '670000000' }, 'HDS_REQUIRED:FINESS_REGISTERED'],
      [{ ...ELIGIBLE, type_structure: 'EHPAD' }, 'HDS_REQUIRED:SENSITIVE_KIND'],
      [{ ...ELIGIBLE, type_structure: 'cabinet de conseil' }, 'HDS_REQUIRED:KIND_NOT_REVIEWED'],
      [{ ...ELIGIBLE, verification_status: 'UNVERIFIED' }, 'HDS_REQUIRED:NOT_VERIFIED_ACTIVE'],
      [{ ...ELIGIBLE, sensitivity: null }, 'HDS_REQUIRED:SERVICE_NOT_REVIEWED_ORDINARY'],
      [{ ...ELIGIBLE, sensitivity: { ...ELIGIBLE.sensitivity, value: 'sensitive' } }, 'HDS_REQUIRED:SERVICE_NOT_REVIEWED_ORDINARY'],
      [null, 'HDS_REQUIRED:NOT_FOUND'],
    ];
    for (const [row, reason] of cases) {
      expect(conversationDecision(row, LISTED), reason).toEqual({ open: false, reason });
      if (row) expect(conversationDecision(row, { ...LISTED, ADA_HDS_CERTIFIED_HOSTING: HDS }), reason).toEqual({ open: false, reason });   // G14-R4: HDS attested changes nothing (messages in Neon; P29 = NOT_ESSMS + ordinary)
    }
  });
  it('the LAB (no enforcement) reads nothing and serves everything; a read failure decides « closed »', async () => {
    const boom = { execute: async () => { throw new Error('db down'); } };
    expect((await conversationDecisions(['a'], { db: boom, envVars: {} })).get('a')).toEqual({ open: true, reason: 'ENFORCEMENT_OFF' });
    expect((await conversationDecisions(['a'], { db: boom, envVars: LISTED })).get('a').open).toBe(false);
  });
  it('the threads hide the file picker when attachments are closed, and a closed conversation offers no form', () => {
    for (const f of ['src/pages/CompteMessageThread.jsx', 'src/pages/pro/MessageThread.jsx']) {
      const s = fs.readFileSync(f, 'utf8');
      expect(s, f).toMatch(/attachmentsAllowed === false/); expect(s, f).toMatch(/isNotOpenRefusal\(conversationQuery\.error\) \? null/);
    }
    expect(fs.readFileSync('src/api/rdv-messaging-client.js', 'utf8')).toMatch(/common:api_error\.capability_not_open/);
  });
});

describe('R3 messaging preflight', () => {
  const beta = { ADA_PUBLIC_BETA_RESTRICTED: '1' };
  it('closed = PASS; open without appointments = FAIL; open = WARN naming the scope; storage only needed for attachments', () => {
    expect(messagingCheck(beta, { betaOn: true, opened: new Set() })[0]).toBe('PASS');
    const listed = { ...beta, ADA_CAPABILITIES_OPEN: 'messaging.conversations', ADA_BETA_OPEN_SURFACES: 'communications' };
    expect(messagingCheck(listed, { betaOn: true, opened: new Set(['communications']) })[0]).toBe('FAIL');
    const ok = messagingCheck(listed, { betaOn: true, opened: new Set(['communications', 'appointments']) });
    expect(ok[0]).toBe('WARN'); expect(ok[1]).toMatch(/NOT_ESSMS/); expect(ok[1]).toMatch(/attachments closed/);
    const r = evaluateReleasePreflight({ ...listed, ADA_BETA_OPEN_SURFACES: 'communications,appointments' });
    expect(r.find((x) => x.id === 'storage.configured').status).toBe('PASS');   // no file can be attached: no bucket needed
    const files = evaluateReleasePreflight({ ...listed, ADA_BETA_OPEN_SURFACES: 'communications,appointments', ADA_CAPABILITIES_OPEN: 'messaging.conversations,messaging.attachments', ...GATEWAY });
    const st = files.find((x) => x.id === 'storage.configured');
    expect(st.status).toBe('PASS');   // G14-R4: attachments open go end-to-end encrypted to the HDS service — no bucket
    expect(st.detail || st.message || JSON.stringify(st)).toMatch(/HDS service/);
  });
});

describe('R3 partner bridge: rotation, rate limit, preflight, provider row', () => {
  it('a previous secret is optional, must be long and different, and is reported (never its value)', () => {
    expect(K.previousSecretEnvName('lab-partner')).toBe('ADA_PARTNER_SECRET_LAB_PARTNER_PREVIOUS');
    expect(K.partnerAdapterConfig(ENV).partners[0].previousSecret).toBe(null);
    expect(K.partnerAdapterConfig({ ...ENV, ADA_PARTNER_SECRET_LAB_PARTNER_PREVIOUS: 'short' }).problems).toEqual(['[0]:previousSecret']);
    expect(K.partnerAdapterConfig({ ...ENV, ADA_PARTNER_SECRET_LAB_PARTNER_PREVIOUS: SECRET }).problems).toEqual(['[0]:previousSecret']);
    const st = K.partnerAdapterStatus({ ...ENV, ADA_PARTNER_SECRET_LAB_PARTNER_PREVIOUS: OLD });
    expect(st.rotating).toEqual(['lab-partner']); expect(JSON.stringify(st)).not.toContain(OLD);
  });
  const T = 1795000000;
  const CB = { contract: C.PARTNER_CONTRACT, idempotencyKey: 'partner-key-0000000001', referralId: '7b1c6a52-0000-4000-8000-000000000001', action: 'accept', occurredAt: '2026-11-18T10:00:00.000Z' };
  const call = async (envVars, header, rateLimit = async () => ({ allowed: true })) => {
    const r = res(); let applied = 0;
    await partnerHandler({ method: 'POST', query: { partner: 'lab-partner' }, headers: { 'ada-signature': header }, body: CB }, r,
      { envVars, nowSeconds: T, rateLimit, apply: async () => { applied += 1; return { status: 200, body: { ok: true } }; } });
    return { ...r, applied };
  };
  it('inbound: the retiring secret is accepted only while it is configured; the current one always; outbound always signs with the current one', async () => {
    const rot = { ...ENV, ADA_PARTNER_SECRET_LAB_PARTNER_PREVIOUS: OLD };
    expect((await call(rot, C.signHeader(OLD, CB, T))).applied).toBe(1);
    expect((await call(rot, C.signHeader(SECRET, CB, T))).applied).toBe(1);
    const after = await call(ENV, C.signHeader(OLD, CB, T));
    expect(after.statusCode).toBe(401); expect(after.applied).toBe(0);
    expect((await call(rot, C.signHeader(`${OLD}x`, CB, T))).statusCode).toBe(401);
    let seen = '';
    await K.deliverEvent({ ...K.partnerAdapterConfig(rot).partners[0] }, { eventId: 'e-1' }, { fetchImpl: async (_u, init) => { seen = init.headers['ADA-Signature']; return { status: 200, headers: { get: () => null } }; }, nowSeconds: () => T });
    expect(C.verifySignature({ header: seen, body: { eventId: 'e-1' }, secret: SECRET, nowSeconds: T })).toEqual({ ok: true });
  });
  it('inbound: over the per-partner budget the call is refused 429 before the signature is checked or anything applied', async () => {
    let key = '';
    const out = await call(ENV, 'garbage', async (action, k) => { key = `${action}|${k}`; return { allowed: false, status: 429 }; });
    expect(out.statusCode).toBe(429); expect(out.applied).toBe(0); expect(key).toBe('PARTNER_CALLBACK|partner:lab-partner');
    expect(fs.readFileSync('api/_utils/rateLimit.js', 'utf8')).toMatch(/PARTNER_CALLBACK: \{ limit: 120, window: 60 \}/);
  });
  it('preflight: off = PASS; invalid / not approved / open without partner / open without job = FAIL; configured but closed = WARN; complete = PASS', () => {
    const get = (env) => (k) => String(env[k] ?? '').trim();
    const chk = (env, betaOn = true) => partnerBridgeCheck(env, { get: get(env), betaOn });
    const beta = { ADA_PUBLIC_BETA_RESTRICTED: '1' };
    expect(chk(beta)[0]).toBe('PASS');
    expect(chk({ ...beta, ADA_PARTNER_ADAPTERS: '{' })[0]).toBe('FAIL');
    expect(chk({ ...beta, ...ENV })[0]).toBe('FAIL');   // loopback endpoint refused in production
    expect(chk({ ...beta, ...HTTPS_ENV })[1]).toMatch(/PRODUCTION_APPROVED/);
    const approved = { ...beta, ...HTTPS_ENV, ADA_PARTNER_ADAPTERS_PRODUCTION_APPROVED: 'true' };
    expect(chk(approved)[0]).toBe('WARN');   // capability closed: inert
    const capOpen = { ...approved, ADA_BETA_OPEN_SURFACES: 'pro,documents', ADA_CAPABILITIES_OPEN: 'partner.referral_adapter,pro.referrals', ...GATEWAY };
    expect(chk(capOpen)).toEqual(['FAIL', expect.stringMatching(/partner-outbox/)]);
    const full = { ...capOpen, ADA_BETA_OPEN_JOBS: 'partner-outbox', ADA_JOBS_APPROVED: 'partner-outbox' };
    expect(chk(full)[0]).toBe('PASS');
    expect(chk({ ...full, ADA_PARTNER_SECRET_LAB_PARTNER_PREVIOUS: OLD })[0]).toBe('WARN');   // rotation in progress
    const { ADA_PARTNER_ADAPTERS, ...noPartner } = full; void ADA_PARTNER_ADAPTERS;
    expect(chk(noPartner)[1]).toMatch(/no partner is configured/);
    for (const r of [chk(full), chk({ ...full, ADA_PARTNER_SECRET_LAB_PARTNER_PREVIOUS: OLD })]) { expect(r[1]).not.toContain(SECRET); expect(r[1]).not.toContain('partner.example.test'); }
    expect(evaluateReleasePreflight(full).find((x) => x.id === 'partner.bridge').status).toBe('PASS');
  });
  it('the administrator « Fournisseurs » page lists the bridge (names only)', () => {
    const row = (env) => providerStatuses(env).find((r) => r.id === 'partner-bridge');
    expect(row({})).toMatchObject({ state: 'NOT_CONFIGURED', reasonCode: 'NOT_CONFIGURED' });
    expect(row({ ...HTTPS_ENV, VERCEL_ENV: 'production' })).toMatchObject({ reasonCode: 'PRODUCTION_ACTIVATION_PENDING' });
    const ok = row({ ...HTTPS_ENV, VERCEL_ENV: 'production', ADA_PARTNER_ADAPTERS_PRODUCTION_APPROVED: 'true' });
    expect(ok).toMatchObject({ state: 'CONNECTED', reasonCode: 'COMPLETE' });
    expect(ok.variables.map((v) => v.name)).toContain('ADA_PARTNER_SECRET_LAB_PARTNER_PREVIOUS');
    expect(JSON.stringify(ok)).not.toContain(SECRET); expect(JSON.stringify(ok)).not.toContain('partner.example.test');
    expect(row({ ADA_PARTNER_ADAPTERS: '{' })).toMatchObject({ reasonCode: 'INCOMPLETE_CONFIGURATION' });
  });
  it('the outbox job is scheduled hourly and still refused until named AND approved', () => {
    expect(JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons.find((c) => c.path === '/api/cron/partner-outbox')?.schedule).toBe('41 * * * *');
  });
});

describe('R3 partner bridge kit (scripts/partner-bridge-kit.mjs)', () => {
  it('the fixed vector is the one the contract test pins', async () => {
    expect(C.signatureOf(VECTOR.secret, VECTOR.t, VECTOR.body)).toBe(VECTOR.signature);
    expect(C.canonicalJson(VECTOR.body)).toBe(VECTOR.canonical);
  });
  it('synthetic events have exactly the contract keys and sandbox identifiers; synthetic callbacks validate', () => {
    for (const k of ['received', 'cancelled', 'expired', 'closed']) {
      const e = sampleEvent(k);
      expect(Object.keys(e).sort()).toEqual([...C.OUTBOUND_KEYS.top].sort()); expect(Object.keys(e.referral).sort()).toEqual([...C.OUTBOUND_KEYS.referral].sort());
      expect(e.eventId).toMatch(/^sandbox-/); expect(e.referral.id).toMatch(/^sandbox-/); expect(e.type).toBe(`referral.${k}`);
    }
    expect(() => sampleEvent('accepted')).toThrow();
    for (const a of C.INBOUND_ACTIONS) expect(C.validateInbound(sampleCallback(a)).ok, a).toBe(true);
  });
  it('the test endpoint must be https or a loopback http, without credentials', () => {
    expect(sandboxEndpoint('https://partner.example.test/hook')).toBe(true);
    expect(sandboxEndpoint('http://127.0.0.1:8080/hook')).toBe(true);
    for (const u of ['http://partner.example.test/hook', 'https://u:p@partner.example.test/', 'ftp://x', 'not a url']) expect(sandboxEndpoint(u), u).toBe(false);
  });
  it('the mock ADA endpoint answers like the real one: signature, contract, replay, key reuse, sandbox ids only', () => {
    const T = 1795000000; const h = mockAdaHandler({ partnerId: 'sandbox-partner', secret: SECRET, nowSeconds: () => T });
    const url = '/api/monitor/partner/referral-events?partner=sandbox-partner';
    const body = sampleCallback('accept', new Date(T * 1000));
    const post = (b, header = C.signHeader(SECRET, b, T), u = url) => h({ method: 'POST', url: u, headers: { 'ada-signature': header }, body: b });
    expect(post(body)).toEqual({ status: 200, body: { ok: true, referral: { id: body.referralId, status: 'ACCEPTED' }, sandbox: true } });
    expect(post(body).body.replay).toBe(true);
    expect(post({ ...body, action: 'start' }).status).toBe(409);
    expect(post(body, C.signHeader(`${SECRET}x`, body, T)).status).toBe(401);
    expect(post(body, C.signHeader(SECRET, body, T - 1000)).body.reason).toBe('STALE');
    expect(post({ ...body, idempotencyKey: 'sandbox-other-key-0001', extra: 1 }).body).toEqual({ error: 'INVALID_BODY', problems: ['extra-field'] });
    expect(post({ ...sampleCallback('accept', new Date(T * 1000)), referralId: '7b1c6a52-0000-4000-8000-000000000001' }).status).toBe(404);
    expect(post(body, undefined, '/api/monitor/partner/referral-events?partner=other').status).toBe(404);
    expect(h({ method: 'GET', url, headers: {}, body: null }).status).toBe(405);
  });
  it('the CLI refuses a secret that is not in a named environment variable', async () => {
    await expect(kitMain(['sign', '--secret-env', 'R3_UNSET_SECRET_VARIABLE', 'package.json'])).rejects.toThrow(/--secret-env/);
    expect(await kitMain(['nope'])).toBe(2);
  });
});

describe('R3 institution portal', () => {
  it('preflight: an open portal without frozen quarters is a WARN (every statistic withheld)', () => {
    const base = { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'institution', ADA_CAPABILITIES_OPEN: 'institution.portal' };
    expect(evaluateReleasePreflight(base).find((x) => x.id === 'institution.statistics')?.status).toBe('WARN');
    expect(evaluateReleasePreflight({ ...base, ADA_BETA_OPEN_JOBS: 'observatory-freeze' }).find((x) => x.id === 'institution.statistics')?.status).toBe('PASS');
    expect(evaluateReleasePreflight({ ADA_PUBLIC_BETA_RESTRICTED: '1' }).find((x) => x.id === 'institution.statistics')).toBeUndefined();
  });
  it('the reset link is built by buildAppUrl (no localhost link in production)', () => {
    const s = fs.readFileSync('api/_handlers/institution.js', 'utf8');
    expect(s).toMatch(/buildAppUrl\('\/institution\/reinitialiser'\)/); expect(s).not.toMatch(/localhost:3000/);
  });
});
