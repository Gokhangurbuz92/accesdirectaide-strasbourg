/**
 * R43-MAIL — Mailjet delivery events: basic auth (constant time, fail-closed), parsing (single / grouped), the address-free summary mapped onto the existing
 * AppointmentNotice CHECK values (no migration), conditional ledger updates, suppression rows without the address, the handler behind its flag (404 when
 * off), the beta allowlist, sendMail() honouring a suppression, and the notice id travelling as the CustomID. No network, no database (fakes).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { MAX_EVENTS_PER_CALL, mailjetEventSummary, noticeIdFromCustomId, parseMailjetEvents, verifyMailjetBasicAuth } from '../../api/lib/mailjet-events.js';
import { applyMailjetEvents, recordSuppression, suppressionHash, suppressionReason } from '../../api/_services/mail-events.js';
import { isAllowedInPublicBeta, isMailEventsRequest } from '../../api/_utils/public-beta.js';

const NOTICE = '0b8e9c1e-2f7a-4f43-9a3c-1d2e3f4a5b6c';
const VARS = { ADA_ENCRYPTION_KEY: 'ab'.repeat(32) };
const PASSWORD = 'x'.repeat(16) + 'Y'.repeat(16);
const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.doUnmock('../../api/_services/mail-events.js'); });

/** a minimal drizzle-shaped fake: notices (id → { channel, status }) and AuditLog rows */
function fakeDb(notices = {}) {
  const audit = []; const updates = [];
  const db = {
    audit, updates, notices,
    // the per-address WHERE is SQL (checked against PostgreSQL in the R43 integration run); the fake returns every suppression row
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => audit.map((r) => ({ details: r.details })) }) }) }) }),
    insert: (table) => ({ values: async (v) => { if (getTableName(table) === 'AuditLog') audit.push(v); } }),
    update: () => ({ set: (patch) => ({ where: () => ({ returning: async () => {
      // the fake reads the pending event from the call order (one update per event)
      const id = db.nextNotice; const row = notices[id]; updates.push({ id, patch });
      const allowed = patch.status === 'DELIVERED' ? ['PROVIDER_ACCEPTED'] : ['PROVIDER_ACCEPTED', 'DELIVERED'];
      if (!row || row.channel !== 'email' || !allowed.includes(row.status)) return [];
      row.status = patch.status; return [{ id }];
    } }) }) }),
  };
  return db;
}

/**
 * R44: applyMailjetEvents() goes through a store (api/_services/mail-events.js mailEventStore). This fake keeps the R43 fake database for the ledger
 * updates and the suppression rows, and adds the R44 provenance: the notices of `notices` were written an hour ago for `recipient`, and `accepted`
 * lists the Mailjet message ids recorded when Mailjet accepted them (id → recipient address).
 */
function fakeStore(db, { recipient = 'person@example.test', accepted = {} } = {}) {
  return {
    findNotice: async (id) => (db.notices[id] ? { id, appointmentId: 'appt-1', recipient: 'citizen', createdAt: new Date(Date.now() - 3_600_000), ...db.notices[id] } : null),
    findAcceptedMessage: async (mid) => (accepted[mid] ? { customId: null, recipientHash: suppressionHash(accepted[mid], VARS), at: new Date(Date.now() - 3_600_000) } : null),
    noticeRecipientHash: async () => suppressionHash(recipient, VARS),
    transitionNotice: async (id, _from, to) => {
      db.nextNotice = id;
      const r = await db.update().set({ status: to }).where().returning();
      return r.length > 0;
    },
    latestLiftAt: async () => null,
    recordStatus: async () => true,
    recordSuppression: (email, reason) => recordSuppression(email, reason, 'mailjet', { db, vars: VARS }),
    recordBatch: async () => {},
  };
}
const NOW_S = () => Math.floor(Date.now() / 1000);

describe('R43 Mailjet webhook authentication', () => {
  it('accepts only the configured pair; fail-closed without it or with a short password', () => {
    const exp = { user: 'mj-events', password: PASSWORD };
    expect(verifyMailjetBasicAuth(basic('mj-events', PASSWORD), exp)).toBe('OK');
    expect(verifyMailjetBasicAuth(basic('mj-events', PASSWORD + 'z'), exp)).toBe('BAD');
    expect(verifyMailjetBasicAuth(basic('other', PASSWORD), exp)).toBe('BAD');
    expect(verifyMailjetBasicAuth('Bearer abc', exp)).toBe('MISSING');
    expect(verifyMailjetBasicAuth(undefined, exp)).toBe('MISSING');
    expect(verifyMailjetBasicAuth(`Basic ${Buffer.from('nocolon').toString('base64')}`, exp)).toBe('BAD');
    expect(verifyMailjetBasicAuth(basic('mj-events', 'short'), { user: 'mj-events', password: 'short' })).toBe('NOT_CONFIGURED');
    expect(verifyMailjetBasicAuth(basic('', ''), { user: '', password: '' })).toBe('NOT_CONFIGURED');
  });
});

describe('R43 Mailjet event parsing and meaning', () => {
  it('reads one event, a grouped array, a JSON string or Buffer; caps the batch; ignores junk', () => {
    expect(parseMailjetEvents({ event: 'sent' })).toHaveLength(1);
    expect(parseMailjetEvents([{ event: 'sent' }, { event: 'bounce' }, 3, null])).toHaveLength(2);
    expect(parseMailjetEvents(JSON.stringify([{ event: 'spam' }]))).toHaveLength(1);
    expect(parseMailjetEvents(Buffer.from('{"event":"blocked"}'))).toHaveLength(1);
    expect(parseMailjetEvents('not json')).toEqual([]);
    expect(parseMailjetEvents(Array.from({ length: MAX_EVENTS_PER_CALL + 10 }, () => ({ event: 'sent' })))).toHaveLength(MAX_EVENTS_PER_CALL);
  });
  it('maps sent / bounce / blocked / spam onto the existing ledger values; nothing personal in the summary', () => {
    const base = { email: 'person@example.test', MessageID: 19421777835146490, CustomID: `appointment-notice/${NOTICE}`, smtp_reply: '250 OK person@example.test', ip: '192.0.2.1' };
    const sent = mailjetEventSummary({ ...base, event: 'sent' });
    expect(sent).toMatchObject({ kind: 'delivered', noticeStatus: 'DELIVERED', noticeId: NOTICE, suppress: null, messageId: String(19421777835146490) });   // above 2^53 JSON already rounded it: rows are matched by CustomID, never by MessageID
    expect(mailjetEventSummary({ ...base, event: 'bounce', hard_bounce: true, error_related_to: 'recipient', error: 'user unknown' })).toMatchObject({ kind: 'bounce_hard', noticeStatus: 'NOT_DELIVERED', suppress: 'hard_bounce', error: 'user unknown' });
    expect(mailjetEventSummary({ ...base, event: 'bounce', hard_bounce: false, error_related_to: 'recipient', error: 'mailbox full' })).toMatchObject({ kind: 'bounce_soft', noticeStatus: 'NOT_DELIVERED', suppress: null });
    expect(mailjetEventSummary({ ...base, event: 'blocked', error_related_to: 'recipient', error: 'preblocked' })).toMatchObject({ noticeStatus: 'NOT_DELIVERED', suppress: 'blocked' });
    expect(mailjetEventSummary({ ...base, event: 'blocked', error_related_to: 'content', error: 'spam content' })).toMatchObject({ noticeStatus: 'NOT_DELIVERED', suppress: null });
    expect(mailjetEventSummary({ ...base, event: 'spam', source: 'JMRPP' })).toMatchObject({ kind: 'spam', noticeStatus: null, suppress: 'spam' });
    for (const e of ['open', 'click', 'unsub']) expect(mailjetEventSummary({ ...base, event: e })).toMatchObject({ noticeStatus: null, suppress: null });
    const allowed = ['DELIVERED', 'PROVIDER_ACCEPTED', 'TEST_RECORDED', 'NOT_DELIVERED', 'NO_CONSENT', 'NO_RECIPIENT', 'FAILED'];
    for (const e of ['sent', 'bounce', 'blocked']) expect(allowed).toContain(mailjetEventSummary({ ...base, event: e }).noticeStatus);
    for (const e of ['sent', 'bounce', 'blocked', 'spam']) {
      const text = JSON.stringify(mailjetEventSummary({ ...base, event: e, error_related_to: 'recipient', error: 'user unknown', comment: 'person@example.test said no' }));
      expect(text).not.toContain('example.test'); expect(text).not.toContain('192.0.2.1');
    }
  });
  it('a CustomID names a notice only in the exact « appointment-notice/<uuid> » form', () => {
    expect(noticeIdFromCustomId(`appointment-notice/${NOTICE}`)).toBe(NOTICE);
    for (const v of ['appointment-booked_by_structure', `appointment-notice/${NOTICE}/x`, 'appointment-notice/1', null, 42]) expect(noticeIdFromCustomId(v)).toBeNull();
  });
});

describe('R43 applying events (fake database, schema of migration 0042)', () => {
  it('sent: PROVIDER_ACCEPTED → DELIVERED; bounce: → NOT_DELIVERED; a late « sent » never moves a bounced row back; a TEST_RECORDED row is never touched', async () => {
    const db = fakeDb({ [NOTICE]: { channel: 'email', status: 'PROVIDER_ACCEPTED' } });
    // R44: every event carries its `time` (Mailjet sends it in every event; an event without it is now ignored as outside the window)
    const ev = (e, extra = {}) => ({ event: e, CustomID: `appointment-notice/${NOTICE}`, email: 'person@example.test', time: NOW_S(), ...extra });
    db.nextNotice = NOTICE;
    const store = fakeStore(db);
    expect(await applyMailjetEvents([ev('sent')], { store, vars: VARS })).toMatchObject({ delivered: 1, notDelivered: 0 });
    expect(db.notices[NOTICE].status).toBe('DELIVERED');
    expect(await applyMailjetEvents([ev('bounce', { hard_bounce: false })], { store, vars: VARS })).toMatchObject({ notDelivered: 1, suppressed: 0 });
    expect(db.notices[NOTICE].status).toBe('NOT_DELIVERED');
    expect(await applyMailjetEvents([ev('sent')], { store, vars: VARS })).toMatchObject({ delivered: 0, ignored: 1 });
    expect(db.notices[NOTICE].status).toBe('NOT_DELIVERED');
    db.notices[NOTICE].status = 'TEST_RECORDED';
    expect(await applyMailjetEvents([ev('sent')], { store, vars: VARS })).toMatchObject({ delivered: 0, ignored: 1 });
    expect(db.notices[NOTICE].status).toBe('TEST_RECORDED');
  });
  it('a hard bounce writes ONE suppression row keyed by an HMAC — never the address — and a repeat writes nothing', async () => {
    const db = fakeDb({});
    // R44: the message must be one we sent (its Mailjet id recorded when Mailjet accepted it, for that recipient), with its event time
    const store = fakeStore(db, { accepted: { 4242: 'person@example.test' } });
    const hard = { event: 'bounce', hard_bounce: true, email: 'Person@Example.test', CustomID: 'appointment-reminder_j1', MessageID: 4242, time: NOW_S() };
    expect(await applyMailjetEvents([hard], { store, vars: VARS })).toMatchObject({ suppressed: 1, unmatched: 1 });
    expect(await applyMailjetEvents([hard], { store, vars: VARS })).toMatchObject({ suppressed: 0 });
    expect(db.audit).toHaveLength(1);
    expect(db.audit[0]).toMatchObject({ action: 'mail.suppressed', entity: 'MailSuppression', entity_id: suppressionHash('person@example.test', VARS), details: { reason: 'hard_bounce', provider: 'mailjet' } });
    expect(JSON.stringify(db.audit)).not.toMatch(/example\.test/i);
    expect(db.audit[0].entity_id).toMatch(/^[0-9a-f]{64}$/);
  });
  it('the strongest reason wins; a complaint after a hard bounce adds nothing; without ADA_ENCRYPTION_KEY nothing is recorded', async () => {
    const db = fakeDb({});
    expect(await recordSuppression('a@example.test', 'spam', 'mailjet', { db, vars: VARS })).toBe(true);
    expect(await suppressionReason('a@example.test', { db, vars: VARS })).toBe('spam');
    expect(await recordSuppression('a@example.test', 'hard_bounce', 'mailjet', { db, vars: VARS })).toBe(true);
    expect(await suppressionReason('a@example.test', { db, vars: VARS })).toBe('hard_bounce');
    expect(await recordSuppression('a@example.test', 'spam', 'mailjet', { db, vars: VARS })).toBe(false);
    expect(await recordSuppression('b@example.test', 'hard_bounce', 'mailjet', { db, vars: {} })).toBe(false);
    expect(suppressionHash('b@example.test', {})).toBeNull();
    expect(suppressionHash('b@example.test', VARS)).not.toBe(suppressionHash('b@example.test', { ADA_ENCRYPTION_KEY: 'cd'.repeat(32) }));
  });
  it('one failing event does not stop the batch, and the logs carry counts only', async () => {
    const db = fakeDb({});
    db.update = () => { throw new Error('db down for person@example.test'); };
    const logger = (await import('../../api/_utils/logger.js')).default;
    const lines = []; for (const k of ['info', 'warn', 'error']) vi.spyOn(logger, k).mockImplementation((...a) => { lines.push(JSON.stringify(a)); });
    const store = { ...fakeStore(db, { accepted: { 77: 'person@example.test' } }), findNotice: async () => { throw new Error('db down for person@example.test'); } };
    const r = await applyMailjetEvents([{ event: 'sent', CustomID: `appointment-notice/${NOTICE}`, email: 'person@example.test', time: NOW_S() },
      { event: 'spam', email: 'person@example.test', MessageID: 77, time: NOW_S() }], { store, vars: VARS });
    expect(r).toMatchObject({ received: 2, errors: 1, suppressed: 1 });
    expect(lines.join('\n')).not.toContain('example.test');
  });
});

describe('R43 webhook handler', () => {
  const res = () => { const r = { code: 0, body: null, headers: {} }; return Object.assign(r, { setHeader: (k, v) => { r.headers[k] = v; }, status: (c) => { r.code = c; return { json: (b) => { r.body = b; return r; }, end: () => r }; } }); };
  async function handler(env) {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.resetModules();
    return (await import('../../api/_handlers/monitor/mail-events-mailjet.js')).default;
  }
  const ON = { MAILER_EVENTS_ENABLED: '1', MAILER_EVENTS_BASIC_USER: 'mj-events', MAILER_EVENTS_BASIC_PASSWORD: PASSWORD };
  it('404 while the flag is off (default)', async () => {
    const h = await handler({ MAILER_EVENTS_ENABLED: '' });
    const r = res(); await h({ method: 'POST', headers: { authorization: basic('mj-events', PASSWORD) }, body: [] }, r);
    expect(r.code).toBe(404);
  });
  it('405 for another method, 503 without the pair, 401 with a wrong one, 200 with the events applied', async () => {
    const apply = vi.fn(async (events) => ({ received: events.length, delivered: 1, notDelivered: 0, suppressed: 0, unmatched: 0, ignored: 0, errors: 0 }));
    let h = await handler(ON);
    let r = res(); await h({ method: 'GET', headers: {} }, r, { apply }); expect(r.code).toBe(405); expect(r.headers.Allow).toBe('POST');
    r = res(); await h({ method: 'POST', headers: { authorization: basic('mj-events', 'nope') }, body: [] }, r, { apply }); expect(r.code).toBe(401);
    expect(r.headers['WWW-Authenticate']).toMatch(/^Basic/);
    r = res(); await h({ method: 'POST', headers: { authorization: basic('mj-events', PASSWORD) }, body: [{ event: 'sent', email: 'person@example.test' }] }, r, { apply });
    expect(r.code).toBe(200); expect(r.body).toEqual({ ok: true, received: 1 }); expect(apply).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r.body)).not.toContain('example.test');
    h = await handler({ ...ON, MAILER_EVENTS_BASIC_PASSWORD: '' });
    r = res(); await h({ method: 'POST', headers: { authorization: basic('mj-events', PASSWORD) }, body: [] }, r, { apply }); expect(r.code).toBe(503);
  });
  it('500 only when no event could be applied (Mailjet then retries)', async () => {
    const h = await handler(ON);
    const r = res();
    await h({ method: 'POST', headers: { authorization: basic('mj-events', PASSWORD) }, body: [{ event: 'sent' }] }, r, { apply: async () => ({ received: 1, errors: 1 }) });
    expect(r.code).toBe(500);
  });
  it('is registered under /monitor/ (CSRF-exempt prefix of the pinned middleware), and the beta lets only that POST through, only with the flag', async () => {
    const { routes } = await import('../../api/routes.js');
    expect(routes.find((x) => x.path === 'monitor/mail-events/mailjet')).toMatchObject({ match: 'exact' });
    const { csrfCheck } = await import('../../api/_utils/csrf.js');
    expect(csrfCheck({ method: 'POST', url: '/api/monitor/mail-events/mailjet', headers: {} }, { setHeader: () => {}, getHeader: () => undefined })).toEqual({ ok: true });
    expect(isMailEventsRequest('POST', 'monitor/mail-events/mailjet', {})).toBe(false);
    expect(isAllowedInPublicBeta('POST', 'monitor/mail-events/mailjet', { ADA_PUBLIC_BETA_RESTRICTED: '1' })).toBe(false);
    expect(isAllowedInPublicBeta('POST', 'monitor/mail-events/mailjet', { ADA_PUBLIC_BETA_RESTRICTED: '1', MAILER_EVENTS_ENABLED: '1' })).toBe(true);
    expect(isAllowedInPublicBeta('GET', 'monitor/mail-events/mailjet', { MAILER_EVENTS_ENABLED: '1' })).toBe(false);
    expect(isAllowedInPublicBeta('POST', 'monitor/core', { MAILER_EVENTS_ENABLED: '1' })).toBe(false);
  });
});

describe('R43 suppression honoured by sendMail', () => {
  async function mailerWith(reason, env = {}) {
    for (const [k, v] of Object.entries({ MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: 'a:b', MAILER_FROM: 'n@example.test', MAILER_EVENTS_ENABLED: '1', ...env })) vi.stubEnv(k, v);
    vi.resetModules();
    vi.doMock('../../api/_services/mail-events.js', () => ({ suppressionReason: async () => reason }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ Messages: [{ Status: 'success', To: [{ MessageID: 1 }] }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return { m: await import('../../api/_utils/mailer.js'), fetchMock };
  }
  afterEach(() => { vi.unstubAllGlobals(); });
  it('a hard-bounced address gets nothing (NOT_DELIVERED, permanent, « suppressed »), not even a reset', async () => {
    const { m, fetchMock } = await mailerWith('hard_bounce');
    expect(await m.sendMail({ to: 'x@example.test', subject: 's', text: 't', category: 'password_reset' })).toMatchObject({ outcome: 'NOT_DELIVERED', failure: 'permanent', errorCode: 'suppressed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('a complaint stops reminders but not the e-mails the person asks for', async () => {
    const { m, fetchMock } = await mailerWith('spam');
    expect(await m.sendMail({ to: 'x@example.test', subject: 's', text: 't', category: 'appointment-reminder_j1' })).toMatchObject({ errorCode: 'suppressed' });
    expect(await m.sendMail({ to: 'x@example.test', subject: 's', text: 't', category: 'password_reset' })).toMatchObject({ outcome: 'PROVIDER_ACCEPTED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('flag off: no lookup at all; lookup error: fail-open (sent)', async () => {
    let { m, fetchMock } = await mailerWith('hard_bounce', { MAILER_EVENTS_ENABLED: '' });
    expect(await m.sendMail({ to: 'x@example.test', subject: 's', text: 't' })).toMatchObject({ outcome: 'PROVIDER_ACCEPTED' });
    for (const [k, v] of Object.entries({ MAILER_EVENTS_ENABLED: '1' })) vi.stubEnv(k, v);
    vi.resetModules();
    vi.doMock('../../api/_services/mail-events.js', () => ({ suppressionReason: async () => { throw new Error('db down'); } }));
    m = await import('../../api/_utils/mailer.js');
    expect(await m.sendMail({ to: 'x@example.test', subject: 's', text: 't' })).toMatchObject({ outcome: 'PROVIDER_ACCEPTED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('R43 the notice id travels as the CustomID', () => {
  it('noticeCitizen sends « appointment-notice/<id> » and records the ledger row under that same id', async () => {
    const { noticeCitizen } = await import('../../api/_services/appointment-notices.js');
    const ledger = [];
    const db = {
      insert: () => ({ values: async (v) => { ledger.push(v); } }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ email: 'person@example.test', verified: new Date() }] }) }) }),
    };
    const sendMail = vi.fn(async () => ({ outcome: 'PROVIDER_ACCEPTED', delivered: true }));
    const status = await noticeCitizen({ id: 'appt-1', citizenUserId: 'u1' }, 'CANCELLED_BY_STRUCTURE', { subject: 'Votre rendez-vous a été annulé - Accès Direct Aide', text: 't' }, { db, sendMail, canNotify: async () => true });
    expect(status).toBe('PROVIDER_ACCEPTED');
    const key = sendMail.mock.calls[0][0].idempotencyKey;
    expect(key).toMatch(/^appointment-notice\/[0-9a-f-]{36}$/);
    // R44: the inserts also carry the status trail (AuditLog rows « mail.notice_status »): the ledger row is the one with a kind
    const rows = ledger.filter((v) => v.kind); ledger.length = 0; ledger.push(...rows);
    expect(noticeIdFromCustomId(key)).toBe(ledger[0].id);
    expect(ledger[0]).toMatchObject({ appointmentId: 'appt-1', kind: 'CANCELLED_BY_STRUCTURE', recipient: 'citizen', channel: 'email', status: 'PROVIDER_ACCEPTED' });
    // two notices of the same kind get two keys (Resend would refuse a reused key with another body)
    await noticeCitizen({ id: 'appt-1', citizenUserId: 'u1' }, 'CANCELLED_BY_STRUCTURE', { subject: 's', text: 't' }, { db, sendMail, canNotify: async () => true });
    expect(sendMail.mock.calls[1][0].idempotencyKey).not.toBe(key);
  });
});
