/**
 * R44-MAIL on REAL PostgreSQL — run on a database with every migration AND on a database built with migrations up to 0042 only (Production level:
 * no 0043 / 0044 / 0045). Mailjet is simulated by a stubbed fetch (api.mailjet.com only, a simulated key, nothing leaves the machine); synthetic data only.
 *   1. J-1 regression: cron/rdv-reminder sends the person's reminder with the notice id as CustomID (its retry key stays the idempotency key); the webhook
 *      (real handler, basic auth) then moves that REMINDER_J1 row to DELIVERED; the status trail reads queued → provider_accepted → delivered.
 *   2. Forged / replayed / foreign events change nothing; a genuine hard bounce suppresses the real recipient only; an administrator lift reopens it and a
 *      replay of the old bounce does not re-apply it; a non-notice e-mail (provenance record) can be suppressed by its own recipient's complaint only.
 *   3. The burst alarm of cron/health-alert reads the address-free batch rows.
 * No row, answer or log line carries an address.
 */
import { vi } from 'vitest';
const PASSWORD = vi.hoisted(() => {
  for (const k of Object.keys(process.env)) if (/^(KV_|UPSTASH_)/.test(k)) delete process.env[k];
  return 'r44-simulated-events-password-0123456789';
});
vi.stubEnv('MAILER_PROVIDER', 'mailjet');
vi.stubEnv('MAILER_API_KEY', 'pub_simulated:sec_simulated');
vi.stubEnv('MAILER_FROM', 'AccesDirectAide <noreply@example.test>');
vi.stubEnv('MAILER_MAILJET_SANDBOX', '');
vi.stubEnv('MAILER_EVENTS_ENABLED', '1');
vi.stubEnv('MAILER_EVENTS_BASIC_USER', 'mj-events');
vi.stubEnv('MAILER_EVENTS_BASIC_PASSWORD', PASSWORD);
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn(), default: { captureException: vi.fn(), captureMessage: vi.fn() } }));
const kvState = vi.hoisted(() => ({ store: new Map() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: {
  incr: async () => 1, expire: async () => 1,
  get: async (k) => kvState.store.get(k) ?? null,
  set: async (k, v, o) => { if (o?.nx && kvState.store.has(k)) return null; kvState.store.set(k, v); return 'OK'; },
  del: async (k) => (kvState.store.delete(k) ? 1 : 0),
} }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const STR = `r44m-str-${TS}`; const SVC = `r44m-svc-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const basic = `Basic ${Buffer.from(`mj-events:${PASSWORD}`).toString('base64')}`;
const nowS = () => Math.floor(Date.now() / 1000);

describe.skipIf(!hasDatabase)('R44 Mailjet events, J-1 correlation, suppression lift and burst alarm (real DB)', () => {
  let db, cron, webhook, health, notices, events, mailer, guestSchema;
  const wire = [];   // every message the simulated Mailjet accepted: { to, customId, messageId, category }
  let nextId = 7_000_000_000_000 + (TS % 1_000_000_000);
  const logLines = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', async (url, init) => {
      const u = new URL(String(url));
      if (u.hostname !== 'api.mailjet.com') throw new Error('unexpected outbound host in test: ' + u.hostname);
      const body = JSON.parse(String(init.body)); const m = body.Messages[0];
      nextId += 1; wire.push({ to: m.To[0].Email, customId: m.CustomID, messageId: nextId, category: m.EventPayload });
      return new Response(JSON.stringify({ Messages: [{ Status: 'success', To: [{ Email: m.To[0].Email, MessageUUID: `uuid-${nextId}`, MessageID: nextId }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    ({ db } = await import('../../src/db/index.js'));
    ({ default: cron } = await import('../../api/_handlers/cron/rdv-reminder.js'));
    ({ default: webhook } = await import('../../api/_handlers/monitor/mail-events-mailjet.js'));
    ({ default: health } = await import('../../api/_handlers/cron/health-alert.js'));
    notices = await import('../../api/_services/appointment-notices.js');
    events = await import('../../api/_services/mail-events.js');
    mailer = await import('../../api/_utils/mailer.js');
    guestSchema = await (await import('../../api/_utils/schema-features.js')).appointmentGuestSchema(db);
    const logger = (await import('../../api/_utils/logger.js')).default;
    for (const k of ['info', 'warn', 'error']) vi.spyOn(logger, k).mockImplementation((...a) => { logLines.push(JSON.stringify(a)); });
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt")
      VALUES (${STR}, 'R44 S', ${'r44m-slug-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${SVC}, ${STR}, 'S', 30, NOW())`);
  }, 60000);
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (!db) return;
    await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" LIKE ${'r44m-apt-' + TS + '-%'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${STR}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${STR}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" = ${STR}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id LIKE ${'r44m-cit-' + TS + '-%'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${STR}`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE action LIKE 'mail.%' AND timestamp > to_timestamp(${TS / 1000} - 60)`).catch(() => {});
  });

  let n = 0;
  const seed = async ({ tomorrow = true } = {}) => {
    n += 1;
    const ids = { agent: `r44m-pro-${TS}-${n}`, citizen: `r44m-cit-${TS}-${n}`, apt: `r44m-apt-${TS}-${n}`, agentEmail: `r44m-pro${n}-${TS}@example.test`, citizenEmail: `r44m-cit${n}-${TS}@example.test` };
    const start = tomorrow ? new Date(notices.parisDayWindow(new Date(), 1).start.getTime() + 12 * 3_600_000) : new Date(Date.now() + 5 * 86_400_000);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${ids.agent}, ${ids.agentEmail}, 'x', 'AGENT', 'active', ${STR}, true, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${ids.citizen}, ${ids.citizenEmail}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "createdByProUserId", "citizenUserId", "createdAt", "updatedAt")
      VALUES (${ids.apt}, ${STR}, ${SVC}, ${start}, ${new Date(start.getTime() + 1_800_000)}, 'confirmed', 'Synthétique', ${ids.agent}, ${ids.citizen}, NOW(), NOW())`);
    return ids;
  };
  const post = async (body) => { const r = mk(); await webhook({ method: 'POST', headers: { authorization: basic, 'content-length': String(JSON.stringify(body).length) }, body }, r); return r; };
  const noticeRow = async (apt, kind) => (await db.execute(sql`SELECT id, status FROM "AppointmentNotice" WHERE "appointmentId" = ${apt} AND kind = ${kind} AND recipient = 'citizen' AND channel = 'email'`)).rows;
  const lastBatch = async () => (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'mail.events_batch' ORDER BY timestamp DESC, id DESC LIMIT 1`)).rows[0]?.details;
  const suppressionRows = async (email) => (await db.execute(sql`SELECT action, details FROM "AuditLog" WHERE entity = 'MailSuppression' AND entity_id = ${events.suppressionHash(email)} ORDER BY timestamp`)).rows;

  it('J-1 regression: the reminder row receives its Mailjet « sent » event (CustomID = notice id; the reminder key stays the idempotency key)', async () => {
    const ids = await seed();
    const r = mk(); await cron({ method: 'GET', url: '/api/cron/rdv-reminder', query: {}, headers: { host: 'x', 'x-cron-secret': process.env.CRON_SECRET } }, r);
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    const msg = wire.find((w) => w.to === ids.citizenEmail);
    expect(msg).toBeTruthy();
    const rows = await noticeRow(ids.apt, 'REMINDER_J1');
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe('PROVIDER_ACCEPTED');
    expect(msg.customId).toBe(`appointment-notice/${rows[0].id}`);
    // the provenance of the accepted message: Mailjet id, CustomID, HMAC of the recipient — no address
    const prov = (await db.execute(sql`SELECT entity, details FROM "AuditLog" WHERE action = 'mail.provider_accepted' AND entity_id = ${`mailjet:${msg.messageId}`}`)).rows;
    expect(prov).toHaveLength(1);
    expect(prov[0].details).toMatchObject({ customId: msg.customId, recipientHash: events.suppressionHash(ids.citizenEmail) });
    expect(JSON.stringify(prov)).not.toContain('example.test');

    const res = await post([{ event: 'sent', time: nowS(), MessageID: msg.messageId, Message_GUID: `uuid-${msg.messageId}`, email: ids.citizenEmail, CustomID: msg.customId, Payload: '' }]);
    expect([res.statusCode, res.body]).toEqual([200, { ok: true, received: 1 }]);
    expect((await noticeRow(ids.apt, 'REMINDER_J1'))[0].status).toBe('DELIVERED');
    const trail = await events.noticeStatusTrail(rows[0].id);
    expect(trail.map((t) => t.status)).toEqual(['queued', 'provider_accepted', 'delivered']);
    expect(await lastBatch()).toMatchObject({ received: 1, delivered: 1, unknownOrigin: 0 });
    // Mailjet retries the same call: 200, nothing changes, no second trail row
    expect((await post([{ event: 'sent', time: nowS(), MessageID: msg.messageId, email: ids.citizenEmail, CustomID: msg.customId }])).statusCode).toBe(200);
    expect((await events.noticeStatusTrail(rows[0].id)).map((t) => t.status)).toEqual(['queued', 'provider_accepted', 'delivered']);
  }, 60000);

  it('forged, replayed and foreign events change nothing; a genuine hard bounce suppresses the real recipient; a lift reopens it and the old bounce never re-applies', async () => {
    const ids = await seed({ tomorrow: false });
    const status = await notices.noticeCitizen({ id: ids.apt, citizenUserId: ids.citizen }, 'CANCELLED_BY_STRUCTURE', { subject: 's', text: 't' }, { db, canNotify: async () => true });
    expect(status).toBe('PROVIDER_ACCEPTED');
    const msg = wire.at(-1); expect(msg.to).toBe(ids.citizenEmail);
    const [row] = await noticeRow(ids.apt, 'CANCELLED_BY_STRUCTURE');
    const victim = `r44m-victim-${TS}@example.test`;
    const bounce = (extra) => ({ event: 'bounce', hard_bounce: true, error_related_to: 'recipient', error: 'user unknown', time: nowS(), MessageID: msg.messageId, CustomID: msg.customId, email: ids.citizenEmail, ...extra });

    let r = await post([bounce({ email: victim }), bounce({ MessageID: 1, CustomID: 'appointment-notice/00000000-0000-4000-8000-000000000000', email: victim }), bounce({ time: nowS() - 5 * 86_400 })]);
    expect(r.statusCode).toBe(200);
    expect(await lastBatch()).toMatchObject({ received: 3, recipientMismatch: 1, unknownOrigin: 1, outOfWindow: 1, suppressed: 0 });
    expect(await suppressionRows(victim)).toHaveLength(0);
    expect(await events.suppressionReason(victim)).toBeNull();
    // even with the real ids, a bounce for another address moved nothing; the genuine one now bounces the row and suppresses the recipient
    expect((await noticeRow(ids.apt, 'CANCELLED_BY_STRUCTURE'))[0].status).toBe('PROVIDER_ACCEPTED');
    const t1 = nowS() - 30;
    r = await post([bounce({ time: t1 })]);
    expect(await lastBatch()).toMatchObject({ suppressed: 1, notDelivered: 1 });
    expect((await noticeRow(ids.apt, 'CANCELLED_BY_STRUCTURE'))[0].status).toBe('NOT_DELIVERED');
    expect(await events.suppressionReason(ids.citizenEmail)).toBe('hard_bounce');
    expect((await events.noticeStatusTrail(row.id)).map((t) => t.status)).toEqual(['queued', 'provider_accepted', 'bounced']);
    // the next e-mail to that address is not sent at all
    const before = wire.length;
    expect(await mailer.sendMail({ to: ids.citizenEmail, subject: 's', text: 't', category: 'password_reset' })).toMatchObject({ outcome: 'NOT_DELIVERED', errorCode: 'suppressed' });
    expect(wire.length).toBe(before);
    // the lift: reason required, audited by hash; afterwards mail flows again; a replay of the old bounce (older than the lift) changes nothing
    expect(await events.liftSuppression(ids.citizenEmail, { reason: 'x', by: 'ops@example.test' })).toEqual({ ok: false, code: 'reason_required' });
    expect(await events.liftSuppression(ids.citizenEmail.toUpperCase(), { reason: 'La personne a confirmé que sa boîte fonctionne', by: 'ops@example.test' })).toEqual({ ok: true, lifted: true, previous: 'hard_bounce' });
    expect(await events.suppressionReason(ids.citizenEmail)).toBeNull();
    expect(await mailer.sendMail({ to: ids.citizenEmail, subject: 's', text: 't', category: 'password_reset' })).toMatchObject({ outcome: 'PROVIDER_ACCEPTED' });
    r = await post([bounce({ time: t1 })]);
    expect(r.statusCode).toBe(200);
    expect(await events.suppressionReason(ids.citizenEmail)).toBeNull();
    const audit = await suppressionRows(ids.citizenEmail);
    expect(audit.map((a) => a.action)).toEqual(['mail.suppressed', 'mail.suppression_lifted']);
    expect(audit[1].details).toMatchObject({ previous: 'hard_bounce', reason: 'La personne a confirmé que sa boîte fonctionne' });
    expect(JSON.stringify(audit)).not.toContain('example.test');
  }, 60000);

  it('a non-notice e-mail is trusted through its provenance record: its own recipient\'s complaint suppresses, another address never does', async () => {
    const to = `r44m-reset-${TS}@example.test`;
    expect(await mailer.sendMail({ to, subject: 's', text: 't', category: 'appointment-reminder_j1' })).toMatchObject({ outcome: 'PROVIDER_ACCEPTED' });
    const msg = wire.at(-1); expect(msg.customId).toBe('appointment-reminder_j1');
    await post([{ event: 'spam', source: 'JMRPP', time: nowS(), MessageID: msg.messageId, CustomID: msg.customId, email: `other-${to}` }]);
    expect(await events.suppressionReason(`other-${to}`)).toBeNull();
    await post([{ event: 'spam', source: 'JMRPP', time: nowS(), MessageID: msg.messageId, CustomID: msg.customId, email: to }]);
    expect(await events.suppressionReason(to)).toBe('spam');
    // a complaint stops what the person did not ask for, not what they ask for
    expect(await mailer.sendMail({ to, subject: 's', text: 't', category: 'appointment-reminder_j1' })).toMatchObject({ errorCode: 'suppressed' });
    expect(await mailer.sendMail({ to, subject: 's', text: 't', category: 'password_reset' })).toMatchObject({ outcome: 'PROVIDER_ACCEPTED' });
  }, 60000);

  it.skipIf(!hasDatabase)('the sealed address of an account-free booking is the expected recipient (only where migration 0043 exists)', async () => {
    if (!guestSchema.guestBooking) { expect(guestSchema.guestBooking).toBe(false); return; }
    const { encrypt } = await import('../../api/lib/crypto.js');
    const apt = `r44m-apt-${TS}-guest`; const to = `r44m-guest-${TS}@example.test`;
    const start = new Date(Date.now() + 6 * 86_400_000);
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "guestEmail", "createdAt", "updatedAt")
      VALUES (${apt}, ${STR}, ${SVC}, ${start}, ${new Date(start.getTime() + 1_800_000)}, 'confirmed', 'Synthétique', ${encrypt(to)}, NOW(), NOW())`);
    const store = events.mailEventStore(db);
    expect(await store.noticeRecipientHash({ id: 'x', appointmentId: apt, recipient: 'citizen', channel: 'email', status: 'PROVIDER_ACCEPTED', createdAt: new Date() })).toBe(events.suppressionHash(to));
    expect(await store.noticeRecipientHash({ id: 'x', appointmentId: apt, recipient: 'structure', channel: 'email', status: 'PROVIDER_ACCEPTED', createdAt: new Date() })).toBeNull();
  });

  it('the burst alarm of cron/health-alert fires on the address-free batch rows of the last hour', async () => {
    vi.stubEnv('ALERT_MAIL_BOUNCE_BURST', '1');
    kvState.store.clear();
    const r = mk(); await health({ method: 'GET', url: '/api/cron/health-alert', query: {}, headers: { host: 'x', 'x-cron-secret': process.env.CRON_SECRET } }, r);
    expect(r.body.checks.mailEvents).toMatchObject({ ok: false, thresholdPerHour: 1 });
    expect(r.body.checks.mailEvents.bounces).toBeGreaterThanOrEqual(2);
    expect(r.body.checks.mailEvents.refused).toBeGreaterThanOrEqual(2);
    expect(kvState.store.has('alert:cooldown:mail.bounce_burst')).toBe(true);
    expect(kvState.store.has('alert:cooldown:mail.events_refused')).toBe(true);
    expect(JSON.stringify(r.body.checks.mailEvents)).not.toContain('example.test');
    vi.stubEnv('MAILER_EVENTS_ENABLED', '');
    const off = mk(); await health({ method: 'GET', url: '/api/cron/health-alert', query: {}, headers: { host: 'x', 'x-cron-secret': process.env.CRON_SECRET } }, off);
    expect(off.body.checks.mailEvents).toEqual({ ok: true, skipped: 'MAIL_EVENTS_OFF' });
    vi.stubEnv('MAILER_EVENTS_ENABLED', '1'); vi.stubEnv('ALERT_MAIL_BOUNCE_BURST', '');
  }, 60000);

  it('no log line of this run carries an address or the webhook password', () => {
    const all = logLines.join('\n');
    expect(all).not.toMatch(/@example\.test/);
    expect(all).not.toContain(PASSWORD);
  });
});
