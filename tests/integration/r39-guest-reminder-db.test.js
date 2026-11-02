/**
 * R39 — the optional J-1 reminder of an account-free booking and the « one active booking per structure and address » rule, on a REAL PostgreSQL (all
 * migrations applied, 0043 and 0044 included), through the real handlers (api/_handlers/rdv.js -> rdv-guest.js, cron/rdv-reminder, cron/gdpr-purge,
 * pro/appointments). Only the rate limiter and the KV store are replaced (they need Upstash; the KV double keeps SET NX semantics so the pipeline lock is
 * real, and can be bypassed to prove that the per-appointment claim alone prevents a double send); the mailer is the built-in `test` outbox (no network).
 * Run: bash $S/r39/int-worktree.sh tests/integration/r39-guest-reminder-db.test.js
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'test');
vi.stubEnv('MAILER_FROM', 'noreply@example.test');
vi.stubEnv('ADA_GUEST_BOOKING_ENABLED', 'true');
const kvState = vi.hoisted(() => ({ store: new Map(), bypass: false }));
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getRateLimitStatus: vi.fn().mockReturnValue(429),
}));
vi.mock('../../api/_utils/kv.js', () => ({ kv: {
  incr: async () => 1, expire: async () => 1,
  get: async (k) => kvState.store.get(k) ?? null,
  set: async (k, v, o) => { if (kvState.bypass) return 'OK'; if (o?.nx && kvState.store.has(k)) return null; kvState.store.set(k, v); return 'OK'; },
  del: async (k) => (kvState.store.delete(k) ? 1 : 0),
} }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S1 = `r39-s1-${TS}`; const SVC = `r39-svc-${TS}`;
const ADMIN = { id: `r39-pa-${TS}`, email: `r39-pa-${TS}@example.test`, sid: S1, role: 'STRUCTURE_ADMIN' };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end(d) { if (d !== undefined) this.body = d; return this; } });
let n = 0;
const guest = (extra = {}) => { n += 1; return { name: 'C. D.', email: `r39g${n}-${TS}@example.test`, consent: true, idempotencyKey: `r39k-${TS}-${n}`, ...extra }; };

describe.skipIf(!hasDatabase)('R39 account-free J-1 reminder and one active booking (real DB)', () => {
  let rdv, db, schema, mailer, auth, cron, purge, proList, core, notices, encrypt;
  let slots = [];
  const call = async (method, path, { body, query = {} } = {}) => {
    const res = mk();
    await rdv({ method, url: `/api/rdv/${path}`, query, body, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http' } }, res);
    return res;
  };
  const invoke = async (handler, { method = 'GET', url, body, headers = {}, query = {} }) => { const r = mk(); await handler({ method, url, query, body, headers: { host: 'x', ...headers } }, r); return r; };
  const runCron = () => invoke(cron, { url: '/api/cron/rdv-reminder', headers: { 'x-cron-secret': process.env.CRON_SECRET } });
  const outbox = (to, re) => mailer.__getTestOutbox().filter((m) => m.to === to && re.test(m.subject));
  const reminders = (to) => outbox(to, /^Rappel : rendez-vous demain/);
  const codeFor = (email) => { const m = outbox(email, /code de confirmation/).pop(); return m ? /(\d{6})/.exec(m.text)[1] : null; };
  const hold = (slot, g = guest()) => call('POST', 'guest/hold', { body: { structureSlug: S1, serviceId: SVC, startAt: slot.startAt, ...g } });
  const row = async (id) => (await db.execute(sql`SELECT * FROM "ProAppointment" WHERE id = ${id}`)).rows[0];
  const ledger = async (id) => (await db.execute(sql`SELECT status FROM "AppointmentNotice" WHERE "appointmentId" = ${id} AND kind = 'REMINDER_J1' AND recipient = 'citizen' AND channel = 'email' ORDER BY "createdAt", id`)).rows.map((x) => x.status);
  const rowsOf = async (email) => Number((await db.execute(sql`SELECT count(*)::int n FROM "ProAppointment" WHERE "structureId" = ${S1} AND "guestEmailHash" = ${core.guestEmailHash(email)}`)).rows[0].n);
  const day = (offset, hour = 12) => new Date(notices.parisDayWindow(new Date(), offset).start.getTime() + hour * 3_600_000);
  /** a confirmed account-free booking (as rdv/guest/confirm leaves it), with a known manage token */
  const seed = async ({ reminder = true, startAt = day(1) } = {}) => {
    n += 1; const id = `r39-seed-${TS}-${n}`; const email = `r39seed${n}-${TS}@example.test`; const manage = core.newManageToken();
    const endAt = new Date(startAt.getTime() + 1_800_000);
    await db.insert(schema.ProAppointment).values({ id, structureId: S1, serviceId: SVC, startAt, endAt, status: 'confirmed', mode: 'IN_PERSON', beneficiaryName: encrypt('R. G.'),
      idempotencyKey: `seed-${id}`, guestEmail: encrypt(email), guestEmailHash: core.guestEmailHash(email), guestMailConsentAt: new Date(), guestConfirmedAt: new Date(),
      guestManageTokenHash: manage.hash, guestManageExpiresAt: endAt, guestReminderConsentAt: reminder ? new Date() : null });
    return { id, email, token: manage.token };
  };
  const holdAndConfirm = async (slot, g) => {
    const h = await hold(slot, g); expect(h.statusCode, JSON.stringify(h.body)).toBe(202);
    const c = await call('POST', 'guest/confirm', { body: { holdId: h.body.hold.id, code: codeFor(g.email) } });
    expect(c.statusCode, JSON.stringify(c.body)).toBe(200);
    return { id: h.body.hold.id, token: c.body.manage.token, hold: h, confirm: c };
  };

  beforeAll(async () => {
    ({ default: rdv } = await import('../../api/_handlers/rdv.js'));
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    mailer = await import('../../api/_utils/mailer.js');
    auth = await import('../../api/_utils/auth.js');
    cron = (await import('../../api/_handlers/cron/rdv-reminder.js')).default;
    purge = (await import('../../api/_handlers/cron/gdpr-purge.js')).default;
    proList = (await import('../../api/_handlers/pro/appointments/index.js')).default;
    core = await import('../../api/_utils/rdv-guest-core.js');
    notices = await import('../../api/_services/appointment-notices.js');
    ({ encrypt } = await import('../../api/lib/crypto.js'));
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${S1}, ${'R39 ' + S1}, ${S1}, 'association', '1 rue QA', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "allowGuestBooking", "updatedAt") VALUES (${'set-' + S1}, ${S1}, true, 'IN_PERSON', true, NOW())`);
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "isActive", "updatedAt") VALUES (${`r-${S1}-${weekday}`}, ${S1}, ${weekday}, '09:00', '12:00', 'Europe/Paris', true, NOW())`);
    }
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "guestBookable", "updatedAt") VALUES (${SVC}, ${S1}, 'Accueil R39', 30, 0, 0, true, true, NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${ADMIN.id}, ${ADMIN.email}, 'x', ${S1}, ${ADMIN.role}, 'active', NOW(), NOW())`);
    const from = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10); const to = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
    const r = await call('GET', `guest/structures/${S1}/slots`, { query: { serviceId: SVC, from, to } });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    slots = r.body.slots;
    expect(slots.length).toBeGreaterThan(20);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'ProAppointment' AND entity_id IN (SELECT id FROM "ProAppointment" WHERE "structureId" = ${S1})`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${S1}`);
    await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${S1}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${S1}`);
    await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${S1}`);
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${S1}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" = ${S1}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${S1}`);
  });

  it('migration 0044 applies on top of 0043 (additive nullable column); its rollback forgets it and a later migrate re-applies only it', async () => {
    const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
    const e43 = journal.find((e) => e.idx === 43); const e44 = journal.find((e) => e.idx === 44);
    expect([e43.tag, e44.tag]).toEqual(['0043_r38_guest_booking', '0044_r39_guest_reminder_consent']);
    expect(e44.when).toBeGreaterThan(e43.when);
    const statements = fs.readFileSync('drizzle/0044_r39_guest_reminder_consent.sql', 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'));
    expect(statements).toEqual(['ALTER TABLE "ProAppointment" ADD COLUMN "guestReminderConsentAt" timestamp (3);']);
    const column = async () => (await db.execute(sql`SELECT data_type, datetime_precision, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'ProAppointment' AND column_name = 'guestReminderConsentAt'`)).rows[0];
    const applied = async () => (await db.execute(sql`SELECT created_at::text c FROM drizzle.__drizzle_migrations ORDER BY created_at`)).rows.map((x) => Number(x.c));
    expect(await column()).toEqual({ data_type: 'timestamp without time zone', datetime_precision: 3, is_nullable: 'YES', column_default: null });
    expect((await applied()).slice(-2)).toEqual([e43.when, e44.when]);
    expect((await applied()).length).toBe(journal.length);
    // rollback 0044 (only): the column and its journal row go, 0043 stays
    await db.execute(sql.raw(fs.readFileSync('drizzle/rollback/0044_down.sql', 'utf8')));
    expect(await column()).toBeUndefined();
    expect((await applied()).at(-1)).toBe(e43.when);
    expect(Number((await db.execute(sql`SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'ProAppointment' AND column_name = 'guestEmailHash'`)).rows[0].n)).toBe(1);
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(db, { migrationsFolder: 'drizzle' });
    expect(await column()).toEqual({ data_type: 'timestamp without time zone', datetime_precision: 3, is_nullable: 'YES', column_default: null });
    expect((await applied()).slice(-2)).toEqual([e43.when, e44.when]);
    expect((await applied()).length).toBe(journal.length);
  });

  it('the reminder consent is stored only when the separate box is ticked (an explicit true); the Pro side sees yes / no, never the address', async () => {
    const yes = guest({ reminderConsent: true }); const no = guest({ reminderConsent: false }); const str = guest({ reminderConsent: 'true' }); const absent = guest();
    const before = Date.now();
    const hy = await hold(slots[0], yes); const hn = await hold(slots[1], no); const hs = await hold(slots[2], str); const ha = await hold(slots[3], absent);
    for (const h of [hy, hn, hs, ha]) expect(h.statusCode, JSON.stringify(h.body)).toBe(202);
    const consentAt = (await row(hy.body.hold.id)).guestReminderConsentAt;
    expect(new Date(consentAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    for (const h of [hn, hs, ha]) expect((await row(h.body.hold.id)).guestReminderConsentAt).toBeNull();
    // independent of the booking-mails consent, which every one of them gave
    for (const h of [hy, hn, hs, ha]) expect((await row(h.body.hold.id)).guestMailConsentAt).not.toBeNull();
    expect([hy.body.hold.reminderConsent, hn.body.hold.reminderConsent]).toEqual([true, false]);
    // without the booking-mails consent there is no hold at all, ticked reminder or not
    expect((await hold(slots[4], guest({ consent: false, reminderConsent: true }))).body.code).toBe('CONSENT_REQUIRED');

    const cy = await call('POST', 'guest/confirm', { body: { holdId: hy.body.hold.id, code: codeFor(yes.email) } });
    const cn = await call('POST', 'guest/confirm', { body: { holdId: hn.body.hold.id, code: codeFor(no.email) } });
    expect([cy.statusCode, cn.statusCode]).toEqual([200, 200]);
    expect(new Date((await row(hy.body.hold.id)).guestReminderConsentAt).getTime()).toBe(new Date(consentAt).getTime());   // kept through confirmation
    const m = await call('POST', 'guest/manage', { body: { appointmentId: hy.body.hold.id, token: cy.body.manage.token } });
    expect(m.body.appointment).toMatchObject({ reminderConsent: true, reminderChangeable: true });
    expect(JSON.stringify(m.body)).not.toContain(yes.email);

    const list = await invoke(proList, { url: '/api/pro/appointments?pageSize=50', query: { pageSize: '50' }, headers: { authorization: `Bearer ${auth.signProToken({ id: ADMIN.id, email: ADMIN.email, structureId: S1, role: ADMIN.role })}` } });
    expect(list.statusCode, JSON.stringify(list.body)).toBe(200);
    const iy = list.body.items.find((x) => x.id === hy.body.hold.id); const inn = list.body.items.find((x) => x.id === hn.body.hold.id);
    expect([iy.guest.reminderConsent, inn.guest.reminderConsent]).toEqual([true, false]);
    expect(iy.guest.emailMasked).toMatch(/\*\*\*@example\.test$/);
    expect(JSON.stringify(list.body)).not.toContain(yes.email);
    expect(JSON.stringify(list.body)).not.toMatch(/guestReminderConsentAt|guestEmailHash|guestManageTokenHash/);
    for (const h of [hs, ha]) await db.execute(sql`UPDATE "ProAppointment" SET status = 'cancelled' WHERE id = ${h.body.hold.id}`);
  });

  it('J-1: the e-mail goes only with the reminder consent (TEST_RECORDED), NO_CONSENT otherwise, once; never outside tomorrow (Paris)', async () => {
    const A = await seed({ reminder: true }); const B = await seed({ reminder: false });
    const today = await seed({ reminder: true, startAt: new Date(Date.now() + 60_000) });
    const after = await seed({ reminder: true, startAt: day(2) });
    // an appointment « today » must really be today in Paris for this check (between 23:59 and 00:00 it would not be: skip that one assertion)
    const todayIsToday = new Date((await row(today.id)).startAt).getTime() < notices.parisDayWindow(new Date(), 1).start.getTime();
    mailer.__clearTestOutbox();
    const r = await runCron();
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(reminders(A.email).length).toBe(1);
    expect(reminders(B.email)).toEqual([]);
    if (todayIsToday) expect(reminders(today.email)).toEqual([]);
    expect(reminders(after.email)).toEqual([]);
    expect(await ledger(A.id)).toEqual(['TEST_RECORDED']);
    expect(await ledger(B.id)).toEqual(['NO_CONSENT']);
    if (todayIsToday) expect(await ledger(today.id)).toEqual([]);
    expect(await ledger(after.id)).toEqual([]);
    expect((await row(A.id)).reminder_sent_at).not.toBeNull();
    expect((await row(B.id)).reminder_sent_at).not.toBeNull();   // nothing to send: closed, not retried
    expect((await row(after.id)).reminder_sent_at).toBeNull();
    // the guest text: the personal link (no account page), no name, no token
    const text = reminders(A.email)[0].text;
    expect(text).toMatch(/lien personnel reçu dans l’e-mail de confirmation/);
    expect(text).not.toContain('/compte/rendez-vous');
    expect(text).not.toMatch(/R\. G\.|token|manage=/);
    expect(text).toContain('1 rue QA');
    await runCron();
    expect(reminders(A.email).length, 'once').toBe(1);
    expect(await ledger(A.id)).toEqual(['TEST_RECORDED']);
  });

  it('withdrawal from the personal link stops tomorrow\'s reminder; turning it on works; same token check as cancel; audit without personal data', async () => {
    const W = await seed({ reminder: true }); const O = await seed({ reminder: false });
    const before = await call('POST', 'guest/manage', { body: { appointmentId: W.id, token: W.token } });
    expect(before.body.appointment.reminderConsent).toBe(true);
    // refusals: another appointment's token, a malformed consent, an expired link
    expect((await call('POST', 'guest/manage/reminder', { body: { appointmentId: W.id, token: O.token, consent: false } })).statusCode).toBe(404);
    expect((await call('POST', 'guest/manage/reminder', { body: { appointmentId: W.id, token: W.token, consent: 'false' } })).body.code).toBe('INVALID_REQUEST');
    expect((await row(W.id)).guestReminderConsentAt).not.toBeNull();
    const off = await call('POST', 'guest/manage/reminder', { body: { appointmentId: W.id, token: W.token, consent: false } });
    expect(off.statusCode, JSON.stringify(off.body)).toBe(200);
    expect(off.headers['Cache-Control']).toBe('no-store');
    expect(off.body.appointment).toMatchObject({ id: W.id, reminderConsent: false });
    expect(JSON.stringify(off.body)).not.toContain(W.email);
    expect((await row(W.id)).guestReminderConsentAt).toBeNull();
    expect((await call('POST', 'guest/manage/reminder', { body: { appointmentId: W.id, token: W.token, consent: false } })).statusCode).toBe(200);   // idempotent

    const on = await call('POST', 'guest/manage/reminder', { body: { appointmentId: O.id, token: O.token, consent: true } });
    expect([on.statusCode, on.body.appointment.reminderConsent]).toEqual([200, true]);
    const firstAt = (await row(O.id)).guestReminderConsentAt;
    await call('POST', 'guest/manage/reminder', { body: { appointmentId: O.id, token: O.token, consent: true } });
    expect(new Date((await row(O.id)).guestReminderConsentAt).getTime()).toBe(new Date(firstAt).getTime());   // the first consent's time is kept

    const audit = (await db.execute(sql`SELECT action, actor, entity, entity_id, details, ip, ip_hash FROM "AuditLog" WHERE entity_id IN (${W.id}, ${O.id}) ORDER BY timestamp`)).rows;
    expect(audit.map((a) => [a.action, a.entity_id])).toEqual([['RDV_GUEST_REMINDER_CONSENT_WITHDRAWN', W.id], ['RDV_GUEST_REMINDER_CONSENT_GIVEN', O.id]]);   // changes only
    for (const a of audit) { expect(a).toMatchObject({ actor: 'guest', entity: 'ProAppointment', details: { via: 'manage_link' }, ip: null, ip_hash: null }); expect(JSON.stringify(a)).not.toMatch(/@example\.test/); }

    mailer.__clearTestOutbox();
    expect((await runCron()).statusCode).toBe(200);
    expect(reminders(W.email)).toEqual([]);
    expect(await ledger(W.id)).toEqual(['NO_CONSENT']);
    expect(reminders(O.email).length).toBe(1);
    // an expired link cannot turn it back on
    await db.execute(sql`UPDATE "ProAppointment" SET "guestManageExpiresAt" = (NOW() AT TIME ZONE 'UTC') - INTERVAL '1 second' WHERE id = ${W.id}`);
    expect((await call('POST', 'guest/manage/reminder', { body: { appointmentId: W.id, token: W.token, consent: true } })).statusCode).toBe(404);
    // a cancelled appointment cannot be given a reminder (withdrawing stays possible)
    const C = await seed({ reminder: false, startAt: day(5) });
    await db.execute(sql`UPDATE "ProAppointment" SET status = 'cancelled', "cancelledAt" = NOW() WHERE id = ${C.id}`);
    expect((await call('POST', 'guest/manage/reminder', { body: { appointmentId: C.id, token: C.token, consent: true } })).body.code).toBe('APPOINTMENT_NOT_ACTIVE');
    expect((await call('POST', 'guest/manage/reminder', { body: { appointmentId: C.id, token: C.token, consent: false } })).statusCode).toBe(200);
  });

  it('a reminder not accepted by the provider (noop: NOT_DELIVERED) stays retryable that J-1 day; a later run sends it once; retries are bounded', async () => {
    const F = await seed({ reminder: true });
    mailer.__clearTestOutbox();
    vi.stubEnv('MAILER_PROVIDER', 'noop');
    try { expect((await runCron()).statusCode).toBe(200); } finally { vi.stubEnv('MAILER_PROVIDER', 'test'); }
    expect(reminders(F.email)).toEqual([]);
    expect(await ledger(F.id)).toEqual(['NOT_DELIVERED']);
    let x = await row(F.id);
    expect([x.reminder_sent_at, x.reminder_locked_at]).toEqual([null, null]);   // released, not marked sent
    expect((await runCron()).statusCode).toBe(200);
    expect(reminders(F.email).length).toBe(1);
    expect(await ledger(F.id)).toEqual(['NOT_DELIVERED', 'TEST_RECORDED']);
    x = await row(F.id); expect(x.reminder_sent_at).not.toBeNull();
    await runCron();
    expect(reminders(F.email).length, 'sent once').toBe(1);

    // bounded: REMINDER_MAX_ATTEMPTS_PER_DAY failed e-mails, then the claim is closed (no further attempt, even once mail works again)
    const G = await seed({ reminder: true });
    vi.stubEnv('MAILER_PROVIDER', 'noop');
    try { for (let i = 0; i < core.REMINDER_MAX_ATTEMPTS_PER_DAY + 1; i += 1) await runCron(); } finally { vi.stubEnv('MAILER_PROVIDER', 'test'); }
    expect(await ledger(G.id)).toEqual(Array(core.REMINDER_MAX_ATTEMPTS_PER_DAY).fill('NOT_DELIVERED'));
    expect((await row(G.id)).reminder_sent_at).not.toBeNull();
    await runCron();
    expect(reminders(G.email)).toEqual([]);
  });

  it('two concurrent cron runs never send twice: with the pipeline lock, and with the lock bypassed (the per-appointment claim alone)', async () => {
    const H = await seed({ reminder: true });
    mailer.__clearTestOutbox();
    const both = await Promise.all([runCron(), runCron()]);
    expect(both.map((r) => r.statusCode).sort()).toEqual(expect.arrayContaining([200]));
    for (const r of both) expect([200, 409]).toContain(r.statusCode);
    expect(reminders(H.email).length).toBe(1);
    expect(await ledger(H.id)).toEqual(['TEST_RECORDED']);

    const H2 = await seed({ reminder: true });
    kvState.bypass = true;
    let runs;
    try { runs = await Promise.all([runCron(), runCron(), runCron()]); } finally { kvState.bypass = false; }
    expect(runs.map((r) => r.statusCode)).toEqual([200, 200, 200]);   // no pipeline lock this time: three runs really in parallel
    expect(reminders(H2.email).length).toBe(1);
    expect(await ledger(H2.id)).toEqual(['TEST_RECORDED']);
    expect(reminders(H.email).length).toBe(1);
  });

  it('one active booking per structure and address: the second request looks exactly like a created hold, inserts nothing, and the address is told by e-mail', async () => {
    const X = guest();
    const first = await holdAndConfirm(slots[5], X);
    const otherDay = slots.find((s) => s.startAt.slice(0, 10) !== slots[5].startAt.slice(0, 10));
    mailer.__clearTestOutbox();
    const second = await hold(otherDay, { ...X, idempotencyKey: `${X.idempotencyKey}-again`, reminderConsent: true });
    const fresh = await hold(slots[7], guest({ reminderConsent: true }));   // a real first hold of another address, for comparison
    // indistinguishable: status, headers, the keys at every level, the fixed values
    expect([second.statusCode, fresh.statusCode]).toEqual([202, 202]);
    expect(second.headers).toEqual(fresh.headers);
    const shape = (v) => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v);
    expect(shape(second.body)).toEqual(shape(fresh.body));
    expect(Object.keys(second.body.hold)).toEqual(Object.keys(fresh.body.hold));
    const fixed = (h) => ({ status: h.status, awaitingCode: h.awaitingCode, mode: h.mode, location: h.location, structure: h.structure, service: h.service, cancelledAt: h.cancelledAt,
      canCancel: h.canCancel, canReschedule: h.canReschedule, rescheduleBlocked: h.rescheduleBlocked, reminderConsent: h.reminderConsent, reminderChangeable: h.reminderChangeable });
    expect(fixed(second.body.hold)).toEqual(fixed(fresh.body.hold));
    expect(second.body.hold.startsAt).toBe(otherDay.startAt);
    expect(second.body.hold.id).toMatch(/^[0-9a-f-]{36}$/); expect(second.body.hold.id).not.toBe(first.id);
    expect(second.body.emailMasked).toMatch(/\*\*\*@example\.test$/);
    // nothing inserted: one row for this address, none with the answered id; the requested slot stays free
    expect(await rowsOf(X.email)).toBe(1);
    expect(await row(second.body.hold.id)).toBeUndefined();
    const listed = await call('GET', `guest/structures/${S1}/slots`, { query: { serviceId: SVC, from: otherDay.startAt.slice(0, 10), to: otherDay.startAt.slice(0, 10) } });
    expect(listed.body.slots.map((s) => s.startAt)).toContain(otherDay.startAt);
    // one e-mail to the address: a booking exists, the personal link manages it — no code, no date, no link
    const told = outbox(X.email, /déjà en cours/);
    expect(told.length).toBe(1);
    expect(told[0].text).toMatch(/lien personnel reçu dans l'e-mail de confirmation/);
    expect(told[0].text).not.toMatch(/(?<!\d)\d{6}(?!\d)|manage=|http/);   // no 6-digit code (the structure's test name carries a 13-digit stamp), no link
    expect(outbox(X.email, /code de confirmation/)).toEqual([]);
    // a later confirm with that id: the « unknown hold » answer
    const fake = await call('POST', 'guest/confirm', { body: { holdId: second.body.hold.id, code: '123456' } });
    const unknown = await call('POST', 'guest/confirm', { body: { holdId: crypto.randomUUID(), code: '123456' } });
    expect([fake.statusCode, fake.body]).toEqual([unknown.statusCode, unknown.body]);
    expect(fake.statusCode).toBe(404);
    // the SAME request retried (same key) keeps its R38 behaviour: the same booking, no e-mail
    const replay = await hold(slots[5], X);
    expect([replay.statusCode, replay.body.hold.id]).toEqual([200, first.id]);
    expect(outbox(X.email, /déjà en cours|code de confirmation/).length).toBe(1);
    // once cancelled, the address may book again
    expect((await call('POST', 'guest/manage/cancel', { body: { appointmentId: first.id, token: first.token } })).statusCode).toBe(200);
    const again = await hold(otherDay, { ...X, idempotencyKey: `${X.idempotencyKey}-after-cancel` });
    expect(again.statusCode).toBe(202);
    expect(await row(again.body.hold.id)).toBeTruthy();
    expect(await rowsOf(X.email)).toBe(2);
  });

  it('an unexpired hold also counts as active; two concurrent requests of one address for two different days: one hold, one « already » e-mail', async () => {
    const Y = guest();
    const h1 = await hold(slots[8], Y); expect(h1.statusCode).toBe(202);
    const h2 = await hold(slots[slots.length - 1], { ...Y, idempotencyKey: `${Y.idempotencyKey}-2` });
    expect(h2.statusCode).toBe(202);
    expect(await rowsOf(Y.email)).toBe(1);
    expect(outbox(Y.email, /déjà en cours/).length).toBe(1);
    // the hold expires: no longer active, a new request is a real hold
    await db.execute(sql`UPDATE "ProAppointment" SET "guestHoldExpiresAt" = (NOW() AT TIME ZONE 'UTC') - INTERVAL '1 minute' WHERE id = ${h1.body.hold.id}`);
    const h3 = await hold(slots[slots.length - 1], { ...Y, idempotencyKey: `${Y.idempotencyKey}-3` });
    expect(h3.statusCode).toBe(202); expect(await row(h3.body.hold.id)).toBeTruthy();

    const Z = guest();
    const dayA = slots[9]; const dayB = slots[13];   // two free slots of two different days (the earlier tests took others)
    expect(dayB.startAt.slice(0, 10)).not.toBe(dayA.startAt.slice(0, 10));
    mailer.__clearTestOutbox();
    const both = await Promise.all([hold(dayA, Z), hold(dayB, { ...Z, idempotencyKey: `${Z.idempotencyKey}-b` })]);
    expect(both.map((r) => r.statusCode)).toEqual([202, 202]);
    expect(shape2(both[0].body)).toEqual(shape2(both[1].body));
    expect(await rowsOf(Z.email)).toBe(1);
    expect(outbox(Z.email, /code de confirmation/).length).toBe(1);
    expect(outbox(Z.email, /déjà en cours/).length).toBe(1);
  });

  it('gdpr-purge step 13 clears the reminder consent with the other guest data', async () => {
    const P = await seed({ reminder: true, startAt: day(6) });
    await db.execute(sql`UPDATE "ProAppointment" SET "createdAt" = NOW() - INTERVAL '800 days' WHERE id = ${P.id}`);
    vi.stubEnv('GDPR_PURGE_ENABLED', 'true');
    try {
      const r = await invoke(purge, { url: '/api/cron/gdpr-purge', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
      expect(r.body.failed_steps || []).not.toContain('anonymisedAppointmentsCount');
    } finally { vi.unstubAllEnvs(); vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test'); vi.stubEnv('ADA_GUEST_BOOKING_ENABLED', 'true'); }
    const x = await row(P.id);
    expect([x.guestReminderConsentAt, x.guestEmail, x.guestEmailHash, x.guestManageTokenHash, x.beneficiaryName]).toEqual([null, null, null, null, '[anonymisé]']);
  });
});

/** the type skeleton of a JSON body (keys at every level, value types) */
function shape2(v) { return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape2(x)])) : typeof v; }
