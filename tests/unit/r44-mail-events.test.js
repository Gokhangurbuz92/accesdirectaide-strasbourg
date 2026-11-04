/**
 * R44-MAIL — the Mailjet event webhook after the R43 security review, and the notice status model. No network, no database (fakes and HTTP mocks only):
 *   - bounded body: 413 (size, event count), 400 (not JSON, not an event); retry semantics (200 for ignored / duplicate, 500 only on an error);
 *   - replay window, in-call duplicates, provenance (a message we sent, created before the event), recipient match before any suppression;
 *   - suppression lift (reason required, newest lift wins, an event older than the lift never re-applies it) and its administrator gate (MFA + elevation);
 *   - address normalisation; the status model (queued, sandbox_simulated, provider_accepted, delivered, bounced, suppressed, failed), monotonic;
 *   - the J-1 regression: a caller that replaces the idempotency key (cron/rdv-reminder) no longer replaces the notice id in the Mailjet CustomID;
 *   - the provenance record of an accepted Mailjet message, only while the events are on; logs never carry an address.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES, MAX_EVENTS_PER_CALL, MAX_EVENT_AGE_SECONDS, eventIdentity, eventTimeVerdict, inspectMailjetBody, noticeIdFromCustomId, normalizeAddress } from '../../api/lib/mailjet-events.js';
import { MAIL_STATUSES, canTransition, currentMailStatus, mailStatusFromEvent, mailStatusFromSend } from '../../api/lib/mail-status.js';
import logger from '../../api/_utils/logger.js';
import { LIFT_ACTION, SUPPRESSION_ACTION, applyMailjetEvents, liftSuppression, suppressionHash, suppressionReason } from '../../api/_services/mail-events.js';

const VARS = { ADA_ENCRYPTION_KEY: 'ab'.repeat(32) };
const NOTICE = '7c1d7d3e-0a1b-4c2d-8e3f-a0b1c2d3e4f5';
const CID = `appointment-notice/${NOTICE}`;
const PERSON = 'person@example.test';
const NOW_S = () => Math.floor(Date.now() / 1000);
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../../api/_services/mail-events.js'); vi.doUnmock('../../api/_utils/auth.js'); vi.doUnmock('../../api/_utils/rateLimit.js'); });

/** an in-memory store (api/_services/mail-events.js MailEventStore) with one citizen e-mail notice and the accepted Mailjet messages */
function memoryStore({ notice = { status: 'PROVIDER_ACCEPTED' }, accepted = {}, recipient = PERSON, liftAt = null } = {}) {
  const st = {
    notices: notice ? { [NOTICE]: { id: NOTICE, appointmentId: 'appt-1', recipient: 'citizen', channel: 'email', createdAt: new Date(Date.now() - 3_600_000), ...notice } } : {},
    trail: [], suppressions: [], batches: [], liftAt,
  };
  const store = {
    findNotice: async (id) => st.notices[id] || null,
    findAcceptedMessage: async (mid) => (accepted[mid] ? { customId: null, at: new Date(Date.now() - 3_600_000), ...accepted[mid], recipientHash: suppressionHash(accepted[mid].to, VARS) } : null),
    noticeRecipientHash: async () => suppressionHash(recipient, VARS),
    transitionNotice: async (id, from, to) => { const n = st.notices[id]; if (!n || n.channel !== 'email' || !from.includes(n.status)) return false; n.status = to; return true; },
    latestLiftAt: async () => st.liftAt,
    recordStatus: async (noticeId, status, info) => { st.trail.push({ noticeId, status, ...info }); return true; },
    recordSuppression: async (email, reason) => { if (st.suppressions.some((x) => x.email === email && x.reason === reason)) return false; st.suppressions.push({ email, reason }); return true; },
    recordBatch: async (counts) => { st.batches.push(counts); },
  };
  return { st, store };
}
const ev = (event, extra = {}) => ({ event, CustomID: CID, email: PERSON, MessageID: 1001, time: NOW_S(), ...extra });

describe('R44 body bounds (before anything is applied)', () => {
  it('413 for a body over 1 MiB (declared or actual) and for more than 500 events; 400 for non-JSON or a non-event body; an empty body is nothing', () => {
    expect(inspectMailjetBody([], String(MAX_BODY_BYTES + 1))).toMatchObject({ ok: false, status: 413, code: 'BODY_TOO_LARGE' });
    expect(inspectMailjetBody('x'.repeat(MAX_BODY_BYTES + 1), undefined)).toMatchObject({ status: 413, code: 'BODY_TOO_LARGE' });
    expect(inspectMailjetBody(Buffer.alloc(MAX_BODY_BYTES + 1), undefined)).toMatchObject({ status: 413 });
    expect(inspectMailjetBody(Array.from({ length: MAX_EVENTS_PER_CALL + 1 }, () => ({ event: 'sent' })), '100')).toMatchObject({ status: 413, code: 'TOO_MANY_EVENTS' });
    expect(inspectMailjetBody('{not json', '9')).toMatchObject({ status: 400, code: 'INVALID_JSON' });
    expect(inspectMailjetBody('42', '2')).toMatchObject({ status: 400, code: 'INVALID_BODY' });
    expect(inspectMailjetBody(undefined, undefined)).toEqual({ ok: true, events: [] });
    expect(inspectMailjetBody('', '0')).toEqual({ ok: true, events: [] });
    const ok = inspectMailjetBody(JSON.stringify([{ event: 'sent' }, 3, [1], { event: 'bounce' }]), '60');
    expect(ok).toMatchObject({ ok: true }); expect(ok.ok && ok.events).toHaveLength(2);
    expect(inspectMailjetBody(Array.from({ length: MAX_EVENTS_PER_CALL }, () => ({ event: 'sent' })), undefined)).toMatchObject({ ok: true });
  });
});

describe('R44 address normalisation (one rule for every suppression key)', () => {
  it('NFC, trimmed, lower-cased; plus-tags and dots kept; junk refused', () => {
    expect(normalizeAddress('  Person@Example.TEST ')).toBe(PERSON);
    expect(normalizeAddress('a+tag@example.test')).toBe('a+tag@example.test');
    expect(normalizeAddress('a.b@example.test')).toBe('a.b@example.test');
    expect(normalizeAddress('é@example.test')).toBe('é@example.test');
    for (const bad of ['', 'no-at', 'a@b', 'a@@example.test', 'a@b@example.test', '@example.test', 'a b@example.test', 'a\n@example.test', 'a\u0000@example.test', 'a<x>@example.test', `${'x'.repeat(250)}@example.test`, 42, null]) {
      expect(normalizeAddress(bad)).toBeNull();
    }
    expect(suppressionHash('Person@Example.test', VARS)).toBe(suppressionHash(PERSON, VARS));
    expect(suppressionHash('a+tag@example.test', VARS)).not.toBe(suppressionHash('a@example.test', VARS));
  });
});

describe('R44 replay window, duplicates and provenance', () => {
  it('an event outside the time window (too old, in the future, without time) changes nothing and is counted', async () => {
    const { st, store } = memoryStore();
    expect(eventTimeVerdict(NOW_S() - MAX_EVENT_AGE_SECONDS - 5)).toBe('too_old');
    expect(eventTimeVerdict(NOW_S() + 3600)).toBe('future');
    expect(eventTimeVerdict(null)).toBe('missing');
    const r = await applyMailjetEvents([ev('sent', { time: NOW_S() - MAX_EVENT_AGE_SECONDS - 60 }), ev('bounce', { hard_bounce: true, time: NOW_S() + 3600 }), ev('sent', { time: undefined })], { store, vars: VARS });
    expect(r).toMatchObject({ outOfWindow: 3, delivered: 0, notDelivered: 0, suppressed: 0 });
    expect(st.notices[NOTICE].status).toBe('PROVIDER_ACCEPTED'); expect(st.suppressions).toHaveLength(0);
  });
  it('a repeat inside one call is dropped; a repeat in a later call is a no-op; one trail row per real transition', async () => {
    const { st, store } = memoryStore();
    const sent = ev('sent');
    expect(eventIdentity(sent)).toBe(eventIdentity({ ...sent }));
    expect(eventIdentity(sent)).not.toBe(eventIdentity({ ...sent, time: sent.time + 1 }));
    expect(await applyMailjetEvents([sent, { ...sent }], { store, vars: VARS })).toMatchObject({ delivered: 1, duplicates: 1 });
    expect(await applyMailjetEvents([sent], { store, vars: VARS })).toMatchObject({ delivered: 0, ignored: 1 });
    expect(st.trail.map((t) => t.status)).toEqual(['delivered']);
    expect(st.trail[0]).toMatchObject({ cause: 'delivered', source: 'mailjet_event', eventKey: eventIdentity(sent) });
    expect(st.batches).toHaveLength(2);
  });
  it('a forged hard bounce (unknown notice, unknown message id) suppresses nothing: « unknownOrigin »', async () => {
    const { st, store } = memoryStore({ notice: null });
    const r = await applyMailjetEvents([ev('bounce', { hard_bounce: true, email: 'victim@example.test', CustomID: 'appointment-notice/00000000-0000-4000-8000-000000000000', MessageID: 9 }),
      ev('spam', { email: 'victim@example.test', CustomID: 'password_reset', MessageID: 10 })], { store, vars: VARS });
    expect(r).toMatchObject({ unknownOrigin: 2, suppressed: 0 }); expect(st.suppressions).toHaveLength(0);
  });
  it('a real message id with ANOTHER address suppresses nothing: « recipientMismatch »; with the real recipient it does', async () => {
    const { st, store } = memoryStore({ notice: null, accepted: { 2002: { to: PERSON } } });
    const forged = ev('bounce', { hard_bounce: true, email: 'victim@example.test', CustomID: 'password_reset', MessageID: 2002 });
    expect(await applyMailjetEvents([forged], { store, vars: VARS })).toMatchObject({ recipientMismatch: 1, suppressed: 0, unmatched: 0 });
    expect(await applyMailjetEvents([{ ...forged, email: 'Person@Example.test' }], { store, vars: VARS })).toMatchObject({ suppressed: 1, unmatched: 1 });
    expect(st.suppressions).toEqual([{ email: PERSON, reason: 'hard_bounce' }]);
  });
  it('a forged event naming a REAL notice but another address does not move the ledger either', async () => {
    const { st, store } = memoryStore();
    expect(await applyMailjetEvents([ev('bounce', { hard_bounce: true, email: 'victim@example.test' }), ev('sent', { email: undefined })], { store, vars: VARS })).toMatchObject({ recipientMismatch: 2, notDelivered: 0, delivered: 0 });
    expect(st.notices[NOTICE].status).toBe('PROVIDER_ACCEPTED'); expect(st.suppressions).toHaveLength(0); expect(st.trail).toHaveLength(0);
  });
  it('a notice is not trusted as the origin when it was created after the event, is older than 30 days, is not a citizen e-mail, or the CustomID of the recorded message differs', async () => {
    for (const notice of [{ createdAt: new Date(Date.now() + 3_600_000) }, { createdAt: new Date(Date.now() - 31 * 86_400_000) }, { recipient: 'structure' }, { channel: 'sms' }]) {
      const { st, store } = memoryStore({ notice: { status: 'PROVIDER_ACCEPTED', ...notice } });
      expect(await applyMailjetEvents([ev('sent')], { store, vars: VARS })).toMatchObject({ unknownOrigin: 1, delivered: 0 });
      expect(st.notices[NOTICE].status).toBe('PROVIDER_ACCEPTED');
    }
    const { store } = memoryStore({ notice: null, accepted: { 3003: { to: PERSON, customId: 'appointment-notice/11111111-1111-4111-8111-111111111111' } } });
    expect(await applyMailjetEvents([ev('spam', { MessageID: 3003 })], { store, vars: VARS })).toMatchObject({ unknownOrigin: 1, suppressed: 0 });
  });
  it('statuses are monotonic: a late « sent » after a bounce, or any event on a TEST_RECORDED (sandbox) row, changes nothing', async () => {
    const { st, store } = memoryStore();
    expect(await applyMailjetEvents([ev('bounce', { hard_bounce: false, time: NOW_S() - 10 }), ev('sent', { time: NOW_S() - 20 })], { store, vars: VARS })).toMatchObject({ notDelivered: 1, ignored: 1 });
    expect(st.notices[NOTICE].status).toBe('NOT_DELIVERED');
    expect(st.trail.map((t) => t.status)).toEqual(['bounced']);
    const sb = memoryStore({ notice: { status: 'TEST_RECORDED' } });
    expect(await applyMailjetEvents([ev('sent'), ev('bounce', { hard_bounce: true })], { store: sb.store, vars: VARS })).toMatchObject({ delivered: 0, notDelivered: 0, ignored: 2 });
    expect(sb.st.notices[NOTICE].status).toBe('TEST_RECORDED'); expect(sb.st.trail).toHaveLength(0);
  });
  it('open / click / unsub change nothing and need no lookup', async () => {
    const { store } = memoryStore();
    const spy = vi.spyOn(store, 'findNotice');
    expect(await applyMailjetEvents([ev('open'), ev('click'), ev('unsub')], { store, vars: VARS })).toMatchObject({ ignored: 3 });
    expect(spy).not.toHaveBeenCalled();
  });
  it('an event older than an administrator lift never re-applies the suppression; a newer one does', async () => {
    const { st, store } = memoryStore({ liftAt: new Date(Date.now() - 60_000) });
    expect(await applyMailjetEvents([ev('bounce', { hard_bounce: true, time: NOW_S() - 600 })], { store, vars: VARS })).toMatchObject({ liftedBefore: 1, suppressed: 0, notDelivered: 1 });
    expect(await applyMailjetEvents([ev('spam', { time: NOW_S() })], { store, vars: VARS })).toMatchObject({ suppressed: 1 });
    expect(st.suppressions).toEqual([{ email: PERSON, reason: 'spam' }]);
  });
  it('a burst in one call is logged with counts only; no log line carries an address', async () => {
    const lines = []; for (const k of ['info', 'warn', 'error']) vi.spyOn(logger, k).mockImplementation((...a) => { lines.push(JSON.stringify(a)); });
    const accepted = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [5000 + i, { to: `p${i}@example.test` }]));
    const { store } = memoryStore({ notice: null, accepted });
    const events = Object.keys(accepted).map((mid, i) => ev('bounce', { hard_bounce: true, CustomID: 'appointment-reminder_j1', MessageID: Number(mid), email: `p${i}@example.test` }));
    expect(await applyMailjetEvents(events, { store, vars: VARS })).toMatchObject({ suppressed: 25 });
    expect(lines.some((l) => l.includes('mail_events.burst'))).toBe(true);
    expect(lines.join('\n')).not.toMatch(/example\.test/);
  });
});

describe('R44 suppression lift', () => {
  /** a fake database whose AuditLog query answers newest first */
  function auditDb() {
    const rows = [];
    return {
      rows,
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [...rows].reverse().map((r) => ({ action: r.action, details: r.details })) }) }) }) }),
      insert: () => ({ values: async (v) => { rows.push(v); } }),
    };
  }
  it('reason required (10–500), valid address required; a lift is audited with the hash only, and the newest lift wins', async () => {
    const db = auditDb();
    const hash = suppressionHash(PERSON, VARS);
    db.rows.push({ action: SUPPRESSION_ACTION, entity_id: hash, details: { reason: 'hard_bounce', provider: 'mailjet' } });
    expect(await suppressionReason(PERSON, { db, vars: VARS })).toBe('hard_bounce');
    expect(await liftSuppression(PERSON, { reason: 'court', by: 'admin@example.test' }, { db, vars: VARS })).toEqual({ ok: false, code: 'reason_required' });
    expect(await liftSuppression('not-an-address', { reason: 'La personne a réparé sa boîte', by: 'a' }, { db, vars: VARS })).toEqual({ ok: false, code: 'invalid_address' });
    expect(await liftSuppression(PERSON, { reason: 'La personne a réparé sa boîte', by: 'a' }, { db, vars: {} })).toEqual({ ok: false, code: 'no_key' });
    expect(await liftSuppression(PERSON, { reason: 'La personne a réparé sa boîte', by: 'ops@example.test' }, { db, vars: VARS })).toEqual({ ok: true, lifted: true, previous: 'hard_bounce' });
    const lift = db.rows.at(-1);
    expect(lift).toMatchObject({ action: LIFT_ACTION, entity: 'MailSuppression', entity_id: hash, details: { previous: 'hard_bounce', reason: 'La personne a réparé sa boîte' }, ip_hash: 'ADMIN_MFA' });
    expect(JSON.stringify(lift)).not.toContain(PERSON);
    expect(await suppressionReason(PERSON, { db, vars: VARS })).toBeNull();
    expect(await liftSuppression(PERSON, { reason: 'Deuxième levée sans objet', by: 'a' }, { db, vars: VARS })).toEqual({ ok: true, lifted: false, previous: null });
    db.rows.push({ action: SUPPRESSION_ACTION, entity_id: hash, details: { reason: 'spam', provider: 'mailjet' } });
    expect(await suppressionReason(PERSON, { db, vars: VARS })).toBe('spam');
  });

  const res = () => { const r = { code: 0, body: null, headers: {} }; return Object.assign(r, { setHeader: (k, v) => { r.headers[k] = v; }, status: (c) => { r.code = c; return { json: (b) => { r.body = b; return r; } }; } }); };
  async function adminHandler(auth, lift = vi.fn(async () => ({ ok: true, lifted: true, previous: 'hard_bounce' }))) {
    vi.resetModules();
    vi.doMock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '192.0.2.9' }));
    vi.doMock('../../api/_utils/auth.js', async (orig) => ({ ...(await orig()), resolveAuthContext: async () => auth }));
    vi.doMock('../../api/_services/mail-events.js', () => ({ liftSuppression: lift, suppressionReason: async () => 'spam' }));
    return { h: (await import('../../api/_handlers/admin/mail-suppressions.js')).default, lift };
  }
  const human = { role: 'ADMIN', authType: 'admin_jwt', mfa_verified: true, email: 'ops@example.test' };
  it('the administrator route: 401 without an administrator, 403 without MFA, 403 without an elevation, 405 for GET; the lift goes through with the admin named', async () => {
    let { h } = await adminHandler(null);
    let r = res(); await h({ method: 'POST', url: '/api/admin/mail-suppressions', headers: {}, body: { action: 'lift', email: PERSON, reason: 'x'.repeat(12) } }, r); expect(r.code).toBe(401);
    ({ h } = await adminHandler({ ...human, mfa_verified: false }));
    r = res(); await h({ method: 'POST', url: '/api/admin/mail-suppressions', headers: {}, body: { action: 'lift' } }, r); expect([r.code, r.body.error]).toEqual([403, 'HUMAN_MFA_SESSION_REQUIRED']);
    ({ h } = await adminHandler(human));
    r = res(); await h({ method: 'POST', url: '/api/admin/mail-suppressions', headers: {}, body: { action: 'lift' } }, r); expect([r.code, r.body.error]).toEqual([403, 'ELEVATION_REQUIRED']);
    r = res(); await h({ method: 'GET', url: '/api/admin/mail-suppressions', headers: {} }, r); expect(r.code).toBe(405);
    const elevated = { ...human, elevatedUntil: Math.floor(Date.now() / 1000) + 600, elevationKind: 'jit' };
    let lift; ({ h, lift } = await adminHandler(elevated));
    r = res(); await h({ method: 'POST', url: '/api/admin/mail-suppressions', headers: {}, body: { action: 'lift', email: PERSON, reason: 'Boîte réparée, demande de la personne' } }, r);
    expect(r.code).toBe(200); expect(r.body).toEqual({ lifted: true, previous: 'hard_bounce' });
    expect(lift).toHaveBeenCalledWith(PERSON, { reason: 'Boîte réparée, demande de la personne', by: 'ops@example.test' });
    expect(JSON.stringify(r.body)).not.toContain(PERSON);
    r = res(); await h({ method: 'POST', url: '/api/admin/mail-suppressions', headers: {}, body: { action: 'status', email: PERSON } }, r); expect(r.body).toEqual({ suppressed: 'spam' });
    r = res(); await h({ method: 'POST', url: '/api/admin/mail-suppressions', headers: {}, body: { action: 'delete', email: PERSON } }, r); expect(r.code).toBe(400);
    ({ h } = await adminHandler(elevated, vi.fn(async () => ({ ok: false, code: 'reason_required' }))));
    r = res(); await h({ method: 'POST', url: '/api/admin/mail-suppressions', headers: {}, body: { action: 'lift', email: PERSON } }, r); expect([r.code, r.body.error]).toEqual([400, 'reason_required']);
    const { routes } = await import('../../api/routes.js');
    expect(routes.find((x) => x.path === 'admin/mail-suppressions')).toMatchObject({ match: 'exact' });
  });
});

describe('R44 webhook answers (retry semantics)', () => {
  const PASSWORD = 'p'.repeat(30);
  const basic = `Basic ${Buffer.from(`mj-events:${PASSWORD}`).toString('base64')}`;
  const res = () => { const r = { code: 0, body: null, headers: {} }; return Object.assign(r, { setHeader: (k, v) => { r.headers[k] = v; }, status: (c) => { r.code = c; return { json: (b) => { r.body = b; return r; }, end: () => r }; } }); };
  async function handler() {
    for (const [k, v] of Object.entries({ MAILER_EVENTS_ENABLED: '1', MAILER_EVENTS_BASIC_USER: 'mj-events', MAILER_EVENTS_BASIC_PASSWORD: PASSWORD })) vi.stubEnv(k, v);
    vi.resetModules();
    return (await import('../../api/_handlers/monitor/mail-events-mailjet.js')).default;
  }
  it('413 / 400 before applying anything; 200 when everything was ignored or a duplicate; 500 as soon as one event hit an error (the retry is idempotent)', async () => {
    const h = await handler();
    const apply = vi.fn(async (events) => ({ received: events.length, errors: 0, ignored: events.length }));
    let r = res(); await h({ method: 'POST', headers: { authorization: basic, 'content-length': String(MAX_BODY_BYTES + 1) }, body: [] }, r, { apply });
    expect([r.code, r.body]).toEqual([413, { error: 'BODY_TOO_LARGE' }]);
    r = res(); await h({ method: 'POST', headers: { authorization: basic }, body: Array.from({ length: MAX_EVENTS_PER_CALL + 1 }, () => ({ event: 'sent' })) }, r, { apply });
    expect([r.code, r.body]).toEqual([413, { error: 'TOO_MANY_EVENTS' }]);
    r = res(); await h({ method: 'POST', headers: { authorization: basic }, body: '{oops' }, r, { apply }); expect(r.code).toBe(400);
    expect(apply).not.toHaveBeenCalled();
    // the size check never runs before authentication
    r = res(); await h({ method: 'POST', headers: { 'content-length': String(MAX_BODY_BYTES + 1) }, body: [] }, r, { apply }); expect(r.code).toBe(401);
    r = res(); await h({ method: 'POST', headers: { authorization: basic }, body: [ev('open'), ev('open')] }, r, { apply }); expect([r.code, r.body]).toEqual([200, { ok: true, received: 2 }]);
    r = res(); await h({ method: 'POST', headers: { authorization: basic }, body: [ev('sent'), ev('bounce')] }, r, { apply: async () => ({ received: 2, errors: 1 }) }); expect(r.code).toBe(500);
  });
});

describe('R44 status model', () => {
  it('seven distinct statuses; transitions only upwards; final statuses stay final; a repeat is not a transition', () => {
    expect(MAIL_STATUSES).toEqual(['queued', 'sandbox_simulated', 'provider_accepted', 'delivered', 'bounced', 'suppressed', 'failed']);
    expect(canTransition(null, 'queued')).toBe(true);
    expect(canTransition('queued', 'provider_accepted')).toBe(true);
    expect(canTransition('provider_accepted', 'delivered')).toBe(true);
    expect(canTransition('delivered', 'bounced')).toBe(true);
    expect(canTransition('provider_accepted', 'bounced')).toBe(true);
    expect(canTransition('bounced', 'delivered')).toBe(false);
    expect(canTransition('delivered', 'delivered')).toBe(false);
    expect(canTransition('delivered', 'provider_accepted')).toBe(false);
    for (const f of ['sandbox_simulated', 'suppressed', 'failed']) for (const t of ['delivered', 'bounced', 'provider_accepted']) expect(canTransition(f, t)).toBe(false);
    expect(canTransition('queued', 'nonsense')).toBe(false);
  });
  it('maps every sendMail() outcome; delivered / bounced only come from a provider event', () => {
    expect(mailStatusFromSend({ outcome: 'PROVIDER_ACCEPTED' })).toEqual({ status: 'provider_accepted', cause: null });
    expect(mailStatusFromSend({ outcome: 'SANDBOX_VALIDATED' })).toEqual({ status: 'sandbox_simulated', cause: 'provider_sandbox' });
    expect(mailStatusFromSend({ outcome: 'TEST_RECORDED' })).toEqual({ status: 'sandbox_simulated', cause: 'test_outbox' });
    expect(mailStatusFromSend({ outcome: 'NOT_DELIVERED', errorCode: 'suppressed', failure: 'permanent' })).toEqual({ status: 'suppressed', cause: 'suppressed' });
    expect(mailStatusFromSend({ outcome: 'NOT_SENT', failure: 'not_configured' })).toEqual({ status: 'failed', cause: 'not_configured' });
    expect(mailStatusFromSend({ outcome: 'NOT_DELIVERED', failure: 'retryable' })).toEqual({ status: 'failed', cause: 'retryable' });
    expect(mailStatusFromSend(null)).toEqual({ status: 'failed', cause: 'unknown' });
    for (const o of ['PROVIDER_ACCEPTED', 'SANDBOX_VALIDATED', 'TEST_RECORDED', 'NOT_SENT', 'NOT_DELIVERED', 'INVALID']) expect(['delivered', 'bounced']).not.toContain(mailStatusFromSend({ outcome: o }).status);
    expect(mailStatusFromEvent('DELIVERED')).toBe('delivered'); expect(mailStatusFromEvent('NOT_DELIVERED')).toBe('bounced'); expect(mailStatusFromEvent(null)).toBeNull();
  });
  it('the current status of a trail ignores out-of-order or forged rows', () => {
    const t = (status, s) => ({ status, at: new Date(Date.UTC(2026, 10, 4, 10, 0, s)) });
    expect(currentMailStatus([t('queued', 1), t('provider_accepted', 2), t('delivered', 3)])).toBe('delivered');
    expect(currentMailStatus([t('delivered', 3), t('queued', 1), t('provider_accepted', 2), t('bounced', 4), t('delivered', 5)])).toBe('bounced');
    expect(currentMailStatus([t('queued', 1), t('sandbox_simulated', 2), t('delivered', 3)])).toBe('sandbox_simulated');
    expect(currentMailStatus([t('nonsense', 1)])).toBeNull();
    expect(currentMailStatus([])).toBeNull();
  });
});

describe('R44 J-1 regression: the notice id stays the Mailjet CustomID when a caller replaces the idempotency key', () => {
  const OK = { Messages: [{ Status: 'success', To: [{ Email: PERSON, MessageUUID: 'u-1', MessageID: 288230376151711744 }] }] };
  async function mailjet(env = {}) {
    for (const [k, v] of Object.entries({ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'pub_test:sec_test', MAILER_FROM: 'AccesDirectAide <notifications@example.test>', ...env })) vi.stubEnv(k, v);
    vi.resetModules();
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (new URL(String(url)).hostname !== 'api.mailjet.com') throw new Error('unexpected host');
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(OK), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    return { m: await import('../../api/_utils/mailer.js'), calls };
  }
  const fakeNoticeDb = (ledger) => ({
    insert: () => ({ values: async (v) => { ledger.push(v); } }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ email: PERSON, verified: new Date() }] }) }) }),
  });
  it('cron/rdv-reminder wraps sendMail with its own retry key: the CustomID is still « appointment-notice/<ledger row id> », the key is the reminder key', async () => {
    const { m, calls } = await mailjet();
    const { noticeCitizen } = await import('../../api/_services/appointment-notices.js');
    const ledger = []; const trail = [];
    const recordStatus = async (id, status, info) => { trail.push({ id, status, ...info }); return true; };
    // exactly the wrapper of api/_handlers/cron/rdv-reminder.js
    const sendMail = async (payload) => m.sendMail({ ...payload, idempotencyKey: 'rdv-reminder-j1/appt-1/1793700000000/citizen' });
    const status = await noticeCitizen({ id: 'appt-1', citizenUserId: 'u1' }, 'REMINDER_J1', { subject: 'Rappel', text: 'Rappel : rendez-vous demain.' }, { db: fakeNoticeDb(ledger), sendMail, canNotify: async () => true, recordStatus, lang: 'fr' });
    expect(status).toBe('PROVIDER_ACCEPTED');
    const row = ledger.find((v) => v.kind === 'REMINDER_J1');
    expect(row).toMatchObject({ recipient: 'citizen', channel: 'email', status: 'PROVIDER_ACCEPTED' });
    expect(calls).toHaveLength(1);
    expect(calls[0].Messages[0].CustomID).toBe(`appointment-notice/${row.id}`);
    expect(noticeIdFromCustomId(calls[0].Messages[0].CustomID)).toBe(row.id);
    // the delivery event of that message now finds the row
    const { st, store } = memoryStore({ notice: null });
    st.notices[row.id] = { id: row.id, appointmentId: 'appt-1', recipient: 'citizen', channel: 'email', status: row.status, createdAt: new Date(Date.now() - 60_000) };
    expect(await applyMailjetEvents([{ event: 'sent', CustomID: calls[0].Messages[0].CustomID, email: PERSON, MessageID: 288230376151711744, time: NOW_S() }], { store, vars: VARS })).toMatchObject({ delivered: 1 });
    expect(st.notices[row.id].status).toBe('DELIVERED');
    // the status trail of the send: queued → provider_accepted, keyed by the same row id
    expect(trail.map((t) => [t.id, t.status])).toEqual([[row.id, 'queued'], [row.id, 'provider_accepted']]);
  });
  it('without a correlation id the CustomID keeps the R43 rule (idempotency key, else the category)', async () => {
    const { m, calls } = await mailjet();
    await m.sendMail({ to: PERSON, subject: 's', text: 't', category: 'password_reset', idempotencyKey: 'k/1' });
    await m.sendMail({ to: PERSON, subject: 's', text: 't', category: 'password_reset' });
    await m.sendMail({ to: PERSON, subject: 's', text: 't', category: 'password_reset', idempotencyKey: 'k/2', correlationId: 'appointment-notice/x' });
    expect(calls.map((c) => c.Messages[0].CustomID)).toEqual(['k/1', 'password_reset', 'appointment-notice/x']);
    expect(m.mailjetCustomId({ correlationId: 'a b c' }, 'cat')).toMatch(/^sha256:/);
  });
  it('each send attempt of a notice leaves its trail: sandbox_simulated for Mailjet SandboxMode, suppressed, failed (no provider)', async () => {
    const { noticeCitizen } = await import('../../api/_services/appointment-notices.js');
    for (const [out, expected, ledgerStatus] of [[{ outcome: 'SANDBOX_VALIDATED' }, 'sandbox_simulated', 'TEST_RECORDED'], [{ outcome: 'NOT_DELIVERED', errorCode: 'suppressed', failure: 'permanent' }, 'suppressed', 'NOT_DELIVERED'],
      [{ outcome: 'NOT_SENT', failure: 'not_configured' }, 'failed', 'NOT_DELIVERED']]) {
      const ledger = []; const trail = [];
      const status = await noticeCitizen({ id: 'appt-1', citizenUserId: 'u1' }, 'CANCELLED_BY_STRUCTURE', { subject: 's', text: 't' }, { db: fakeNoticeDb(ledger), sendMail: async () => out, canNotify: async () => true,
        recordStatus: async (id, s, info) => { trail.push({ id, s, ...info }); return true; }, lang: 'fr' });
      expect(status).toBe(ledgerStatus);
      const row = ledger.find((v) => v.kind);
      expect(trail.map((t) => t.s)).toEqual(['queued', expected]);
      expect(trail.every((t) => t.id === row.id && t.source === 'notice_send')).toBe(true);
    }
    // no e-mail attempted (no consent): no trail, and the row keeps a random id
    const ledger = []; const trail = [];
    expect(await noticeCitizen({ id: 'appt-1', citizenUserId: 'u1' }, 'CANCELLED_BY_STRUCTURE', { subject: 's', text: 't' }, { db: fakeNoticeDb(ledger), sendMail: async () => ({}), canNotify: async () => false,
      recordStatus: async (...a) => { trail.push(a); return true; } })).toBe('NO_CONSENT');
    expect(trail).toHaveLength(0);
  });
});

describe('R44 provenance record of an accepted Mailjet message', () => {
  async function mailerWith(env) {
    for (const [k, v] of Object.entries({ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'pub_test:sec_test', MAILER_FROM: 'n@example.test', ...env })) vi.stubEnv(k, v);
    vi.resetModules();
    const recordAcceptedMessage = vi.fn(async () => true);
    vi.doMock('../../api/_services/mail-events.js', () => ({ suppressionReason: async () => null, recordAcceptedMessage }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ Messages: [{ Status: 'success', To: [{ MessageID: 4711 }] }] }), { status: 200 })));
    return { m: await import('../../api/_utils/mailer.js'), recordAcceptedMessage };
  }
  it('written only while the events are on, only for a real acceptance (not the sandbox), with the CustomID; a write error never changes the result', async () => {
    let { m, recordAcceptedMessage } = await mailerWith({ MAILER_EVENTS_ENABLED: '1' });
    expect(await m.sendMail({ to: PERSON, subject: 's', text: 't', category: 'appointment-reminder_j1', correlationId: CID })).toMatchObject({ outcome: 'PROVIDER_ACCEPTED' });
    expect(recordAcceptedMessage).toHaveBeenCalledWith({ messageId: '4711', customId: CID, category: 'appointment-reminder_j1', to: PERSON });
    ({ m, recordAcceptedMessage } = await mailerWith({ MAILER_EVENTS_ENABLED: '' }));
    await m.sendMail({ to: PERSON, subject: 's', text: 't' }); expect(recordAcceptedMessage).not.toHaveBeenCalled();
    ({ m, recordAcceptedMessage } = await mailerWith({ MAILER_EVENTS_ENABLED: '1', MAILER_MAILJET_SANDBOX: '1' }));
    expect(await m.sendMail({ to: PERSON, subject: 's', text: 't' })).toMatchObject({ outcome: 'SANDBOX_VALIDATED' }); expect(recordAcceptedMessage).not.toHaveBeenCalled();
    ({ m, recordAcceptedMessage } = await mailerWith({ MAILER_EVENTS_ENABLED: '1', MAILER_MAILJET_SANDBOX: '' }));
    recordAcceptedMessage.mockRejectedValueOnce(new Error('db down'));
    expect(await m.sendMail({ to: PERSON, subject: 's', text: 't' })).toMatchObject({ outcome: 'PROVIDER_ACCEPTED' });
    expect(recordAcceptedMessage).toHaveBeenCalledTimes(1);
  });
});
