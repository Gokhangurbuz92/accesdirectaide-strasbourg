/**
 * R38 — account-free (« sans compte ») booking on a REAL PostgreSQL (all migrations applied, 0043 included), through the real handlers (api/_handlers/rdv.js
 * -> rdv-guest.js, pro/appointments, pro/appointments/cancel, cron/gdpr-purge). Only the rate limiter / KV are replaced (they need Upstash); the mailer is the
 * built-in `test` outbox (no network). Run: bash $S/r34int-repo.sh tests/integration/r38-guest-booking-db.test.js
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'test');
vi.stubEnv('MAILER_FROM', 'noreply@example.test');
vi.stubEnv('ADA_GUEST_BOOKING_ENABLED', 'true');
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getRateLimitStatus: vi.fn().mockReturnValue(429),
}));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S1 = `r38-s1-${TS}`, S2 = `r38-s2-${TS}`, S3 = `r38-s3-${TS}`;   // S1 guests allowed; S2 published but no guests; S3 guests allowed but unpublished
const SVC = `r38-svc-${TS}`, SVC_NO = `r38-svc-no-${TS}`, SVC2 = `r38-svc2-${TS}`, SVC3 = `r38-svc3-${TS}`;
const ADMIN_A = { id: `r38-pa-${TS}`, email: `r38-pa-${TS}@example.test`, sid: S1, role: 'STRUCTURE_ADMIN' };
const ADMIN_B = { id: `r38-pb-${TS}`, email: `r38-pb-${TS}@example.test`, sid: S2, role: 'STRUCTURE_ADMIN' };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end(d) { if (d !== undefined) this.body = d; return this; } });
let n = 0;
const guest = (extra = {}) => { n += 1; return { name: 'C. D.', email: `guest${n}-${TS}@example.test`, phone: '06 12 34 56 78', consent: true, note: 'Merci', idempotencyKey: `k-${TS}-${n}`, ...extra }; };

describe.skipIf(!hasDatabase)('R38 account-free booking (real DB)', () => {
  let rdv, db, mailer, auth, proList, proCancel, purge;
  let slots = [];
  const call = async (method, path, { body, query = {} } = {}) => {
    const res = mk();
    await rdv({ method, url: `/api/rdv/${path}`, query, body, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http' } }, res);
    return res;
  };
  const pro = (u) => ({ authorization: `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: u.sid, role: u.role })}` });
  const invoke = async (handler, { method = 'GET', url, body, headers = {}, query = {} }) => { const r = mk(); await handler({ method, url, query, body, headers: { host: 'x', ...headers } }, r); return r; };
  const codeFor = (email) => { const m = mailer.__getTestOutbox().filter((x) => x.to === email && /code de confirmation/.test(x.subject)).pop(); return m ? /(\d{6})/.exec(m.text)[1] : null; };
  const hold = (slot, g = guest(), slug = S1, serviceId = SVC) => call('POST', 'guest/hold', { body: { structureSlug: slug, serviceId, startAt: slot.startAt, ...g } });
  const row = async (id) => (await db.execute(sql`SELECT * FROM "ProAppointment" WHERE id = ${id}`)).rows[0];
  const holdAndConfirm = async (slot, g = guest()) => {
    const h = await hold(slot, g); expect(h.statusCode, JSON.stringify(h.body)).toBe(202);
    const c = await call('POST', 'guest/confirm', { body: { holdId: h.body.hold.id, code: codeFor(g.email) } });
    expect(c.statusCode, JSON.stringify(c.body)).toBe(200);
    return { id: h.body.hold.id, token: c.body.manage.token, g };
  };

  beforeAll(async () => {
    ({ default: rdv } = await import('../../api/_handlers/rdv.js'));
    ({ db } = await import('../../src/db/index.js'));
    mailer = await import('../../api/_utils/mailer.js');
    auth = await import('../../api/_utils/auth.js');
    proList = (await import('../../api/_handlers/pro/appointments/index.js')).default;
    proCancel = (await import('../../api/_handlers/pro/appointments/cancel.js')).default;
    purge = (await import('../../api/_handlers/cron/gdpr-purge.js')).default;
    for (const [sid, published, allow] of [[S1, true, true], [S2, true, false], [S3, false, true]]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${sid}, ${'R38 ' + sid}, ${sid}, 'association', '1 rue QA', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
      await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "allowGuestBooking", "updatedAt") VALUES (${'set-' + sid}, ${sid}, ${published}, 'IN_PERSON', ${allow}, NOW())`);
      for (let weekday = 0; weekday <= 6; weekday += 1) {
        await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "isActive", "updatedAt") VALUES (${`r-${sid}-${weekday}`}, ${sid}, ${weekday}, '09:00', '12:00', 'Europe/Paris', true, NOW())`);
      }
    }
    for (const [id, sid, gb] of [[SVC, S1, true], [SVC_NO, S1, false], [SVC2, S2, true], [SVC3, S3, true]]) {
      await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "guestBookable", "updatedAt") VALUES (${id}, ${sid}, ${'Accueil ' + id}, 30, 0, 0, true, ${gb}, NOW())`);
    }
    for (const u of [ADMIN_A, ADMIN_B]) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${u.id}, ${u.email}, 'x', ${u.sid}, ${u.role}, 'active', NOW(), NOW())`);
    const from = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10); const to = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
    const r = await call('GET', `guest/structures/${S1}/slots`, { query: { serviceId: SVC, from, to } });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    slots = r.body.slots;
    expect(slots.length).toBeGreaterThan(20);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    for (const sid of [S1, S2, S3]) {
      await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${sid}`);
      await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${sid}`);
      await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${sid}`);
      await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${sid}`);
      await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${sid}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" = ${sid}`);
      await db.execute(sql`DELETE FROM "Structure" WHERE id = ${sid}`);
    }
  });

  it('the server switch is fail-closed: 503 GUEST_BOOKING_DISABLED unless ADA_GUEST_BOOKING_ENABLED=true', async () => {
    vi.stubEnv('ADA_GUEST_BOOKING_ENABLED', '1');
    try {
      const r = await call('GET', `guest/structures/${S1}/services`);
      expect([r.statusCode, r.body.code]).toEqual([503, 'GUEST_BOOKING_DISABLED']);
      const h = await hold(slots[0]);
      expect([h.statusCode, h.body.code]).toEqual([503, 'GUEST_BOOKING_DISABLED']);
    } finally { vi.stubEnv('ADA_GUEST_BOOKING_ENABLED', 'true'); }
  });

  it('services: only the guest-bookable services of an opted-in, published, verified structure; citizen routes still need an account', async () => {
    const ok = await call('GET', `guest/structures/${S1}/services`);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.items.map((s) => s.id)).toEqual([SVC]);
    expect((await call('GET', `guest/structures/${S2}/services`)).statusCode).toBe(404);
    expect((await call('GET', `guest/structures/${S3}/services`)).statusCode).toBe(404);
    expect((await call('GET', `structures/${S1}/services`)).statusCode).toBe(401);
  });

  it('refusals: structure without allowGuestBooking, service not guestBookable, unpublished structure — 404 and no row', async () => {
    const before = Number((await db.execute(sql`SELECT count(*)::int n FROM "ProAppointment" WHERE "structureId" IN (${S1}, ${S2}, ${S3})`)).rows[0].n);
    expect((await hold(slots[0], guest(), S2, SVC2)).statusCode).toBe(404);
    expect((await hold(slots[0], guest(), S1, SVC_NO)).statusCode).toBe(404);
    expect((await hold(slots[0], guest(), S3, SVC3)).statusCode).toBe(404);
    const after = Number((await db.execute(sql`SELECT count(*)::int n FROM "ProAppointment" WHERE "structureId" IN (${S1}, ${S2}, ${S3})`)).rows[0].n);
    expect(after).toBe(before);
  });

  it('mail not deliverable (MAILER_PROVIDER=noop): 503 GUEST_BOOKING_MAIL_UNAVAILABLE and nothing held', async () => {
    vi.stubEnv('MAILER_PROVIDER', 'noop');
    try {
      const g = guest();
      const r = await hold(slots[1], g);
      expect([r.statusCode, r.body.code]).toEqual([503, 'GUEST_BOOKING_MAIL_UNAVAILABLE']);
      const rows = (await db.execute(sql`SELECT id FROM "ProAppointment" WHERE "structureId" = ${S1} AND "idempotencyKey" = ${g.idempotencyKey}`)).rows;
      expect(rows).toEqual([]);
    } finally { vi.stubEnv('MAILER_PROVIDER', 'test'); }
  });

  it('validation: consent required, the note is bounded, the e-mail must be an address', async () => {
    expect((await hold(slots[2], guest({ consent: false }))).body.code).toBe('CONSENT_REQUIRED');
    expect((await hold(slots[2], guest({ note: 'x'.repeat(301) }))).body.code).toBe('NOTE_TOO_LONG');
    expect((await hold(slots[2], guest({ email: 'pas-une-adresse' }))).body.code).toBe('INVALID_EMAIL');
  });

  it('happy path: hold -> confirm -> manage -> reschedule -> cancel; the PII is sealed and never echoed', async () => {
    const g = guest();
    const h = await hold(slots[3], g);
    expect(h.statusCode, JSON.stringify(h.body)).toBe(202);
    expect(h.body.hold.status).toBe('REQUESTED');
    expect(h.body.emailMasked).toMatch(/\*\*\*@example\.test$/);
    expect(JSON.stringify(h.body)).not.toContain(g.email);
    expect(JSON.stringify(h.body)).not.toContain('0612345678');
    const stored = await row(h.body.hold.id);
    expect(stored.guestEmail).toMatch(/^v1:/); expect(stored.beneficiaryName).toMatch(/^v1:/); expect(stored.guestPhone).toMatch(/^v1:/); expect(stored.notes).toMatch(/^v1:/);
    expect(stored.guestCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(codeFor(g.email));
    // the held slot is not offered any more
    const day = slots[3].startAt.slice(0, 10);
    const listed = await call('GET', `guest/structures/${S1}/slots`, { query: { serviceId: SVC, from: day, to: day } });
    expect(listed.body.slots.map((s) => s.startAt)).not.toContain(slots[3].startAt);

    const c = await call('POST', 'guest/confirm', { body: { holdId: h.body.hold.id, code: codeFor(g.email) } });
    expect(c.statusCode, JSON.stringify(c.body)).toBe(200);
    expect(c.body.appointment.status).toBe('CONFIRMED');
    const token = c.body.manage.token;
    const confirmed = await row(h.body.hold.id);
    expect(confirmed.guestHoldExpiresAt).toBeNull(); expect(confirmed.guestCodeHash).toBeNull();
    expect(confirmed.guestManageTokenHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(confirmed.guestManageTokenHash).not.toContain(token);
    expect(new Date(confirmed.guestManageExpiresAt).getTime()).toBe(new Date(confirmed.endAt).getTime());
    const mail = mailer.__getTestOutbox().filter((x) => x.to === g.email && /Confirmation/.test(x.subject)).pop();
    expect(mail.text).toContain('/sans-compte/gerer?appointment=');
    expect(mail.text).toContain(`#manage=${token}`);
    expect(mail.attachments[0].content).toContain('BEGIN:VCALENDAR');
    const ledger = (await db.execute(sql`SELECT kind, recipient, status FROM "AppointmentNotice" WHERE "appointmentId" = ${h.body.hold.id} ORDER BY "createdAt"`)).rows;
    expect(ledger).toEqual(expect.arrayContaining([{ kind: 'GUEST_CODE', recipient: 'citizen', status: 'TEST_RECORDED' }, { kind: 'BOOKED_BY_GUEST', recipient: 'citizen', status: 'TEST_RECORDED' }]));
    expect(ledger.find((x) => x.kind === 'BOOKED_BY_GUEST' && x.recipient === 'structure')).toBeTruthy();

    const m = await call('POST', 'guest/manage', { body: { appointmentId: h.body.hold.id, token } });
    expect(m.statusCode).toBe(200);
    expect(Object.keys(m.body.appointment)).not.toContain('beneficiaryName');
    expect(JSON.stringify(m.body)).not.toContain(g.email);
    expect(JSON.stringify(m.body)).not.toContain('C. D.');
    expect(m.body.appointment.location).toBeTruthy();
    expect(m.body.appointment.canReschedule).toBe(true);

    const target = slots[slots.length - 1];
    const mv = await call('POST', 'guest/manage/reschedule', { body: { appointmentId: h.body.hold.id, token, startAt: target.startAt } });
    expect(mv.statusCode, JSON.stringify(mv.body)).toBe(200);
    expect(mv.body.appointment.startsAt).toBe(target.startAt);
    const movedRow = await row(h.body.hold.id);
    expect(Number(movedRow.rescheduleCount)).toBe(1);
    expect(new Date(movedRow.guestManageExpiresAt).getTime()).toBe(new Date(target.endAt).getTime());
    // the old slot is free again, the new one is not
    const again = await call('GET', `guest/structures/${S1}/slots`, { query: { serviceId: SVC, from: day, to: day } });
    expect(again.body.slots.map((s) => s.startAt)).toContain(slots[3].startAt);
    expect(mailer.__getTestOutbox().some((x) => x.to === g.email && /déplacé/.test(x.subject))).toBe(true);

    const cx = await call('POST', 'guest/manage/cancel', { body: { appointmentId: h.body.hold.id, token } });
    expect(cx.statusCode).toBe(200);
    expect(cx.body.appointment.status).toBe('CANCELLED');
    expect((await row(h.body.hold.id)).cancelledBy).toBe('GUEST');
    expect(mailer.__getTestOutbox().some((x) => x.to === g.email && /Annulation confirmée/.test(x.subject))).toBe(true);
    // idempotent
    expect((await call('POST', 'guest/manage/cancel', { body: { appointmentId: h.body.hold.id, token } })).statusCode).toBe(200);
  });

  it('a wrong code 5 times locks the hold and frees the slot; the right code is then refused', async () => {
    const g = guest();
    const h = await hold(slots[4], g); expect(h.statusCode).toBe(202);
    const right = codeFor(g.email); const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 4; i += 1) {
      const r = await call('POST', 'guest/confirm', { body: { holdId: h.body.hold.id, code: wrong } });
      expect([r.statusCode, r.body.code, r.body.attemptsLeft]).toEqual([400, 'CODE_INVALID', 5 - i]);
    }
    const fifth = await call('POST', 'guest/confirm', { body: { holdId: h.body.hold.id, code: wrong } });
    expect([fifth.statusCode, fifth.body.code]).toEqual([409, 'HOLD_LOCKED']);
    const locked = await row(h.body.hold.id);
    expect([locked.status, locked.cancelledBy, Number(locked.guestCodeAttempts)]).toEqual(['cancelled', 'GUEST_CODE_LOCKED', 5]);
    expect((await call('POST', 'guest/confirm', { body: { holdId: h.body.hold.id, code: right } })).statusCode).toBe(409);
    const day = slots[4].startAt.slice(0, 10);
    const listed = await call('GET', `guest/structures/${S1}/slots`, { query: { serviceId: SVC, from: day, to: day } });
    expect(listed.body.slots.map((s) => s.startAt)).toContain(slots[4].startAt);
  });

  it('an expired hold stops blocking: the slot is offered and bookable again, and the old code is refused', async () => {
    const g = guest();
    const h = await hold(slots[5], g); expect(h.statusCode).toBe(202);
    await db.execute(sql`UPDATE "ProAppointment" SET "guestHoldExpiresAt" = (NOW() AT TIME ZONE 'UTC') - INTERVAL '1 minute' WHERE id = ${h.body.hold.id}`);
    const day = slots[5].startAt.slice(0, 10);
    const listed = await call('GET', `guest/structures/${S1}/slots`, { query: { serviceId: SVC, from: day, to: day } });
    expect(listed.body.slots.map((s) => s.startAt)).toContain(slots[5].startAt);
    const other = await hold(slots[5]);
    expect(other.statusCode, JSON.stringify(other.body)).toBe(202);
    const late = await call('POST', 'guest/confirm', { body: { holdId: h.body.hold.id, code: codeFor(g.email) } });
    expect([late.statusCode, late.body.code]).toEqual([409, 'HOLD_EXPIRED']);
  });

  it('two concurrent holds on one slot: exactly one wins', async () => {
    const results = await Promise.all([hold(slots[6]), hold(slots[6]), hold(slots[6])]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([202, 409, 409]);
    const n6 = Number((await db.execute(sql`SELECT count(*)::int n FROM "ProAppointment" WHERE "structureId" = ${S1} AND "startAt" = ${slots[6].startAt}::timestamptz AT TIME ZONE 'UTC' AND status = 'requested'`)).rows[0].n);
    expect(n6).toBe(1);
  });

  it('idempotent retry: same address + same key -> the same hold, one row, one code mail', async () => {
    const g = guest();
    const [a, b] = await Promise.all([hold(slots[7], g), hold(slots[7], g)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 202]);
    expect(a.body.hold.id).toBe(b.body.hold.id);
    const c = await hold(slots[7], g);
    expect([c.statusCode, c.body.hold.id]).toEqual([200, a.body.hold.id]);
    expect(mailer.__getTestOutbox().filter((x) => x.to === g.email).length).toBe(1);
    const rows = (await db.execute(sql`SELECT id FROM "ProAppointment" WHERE "idempotencyKey" = ${g.idempotencyKey}`)).rows;
    expect(rows.length).toBe(1);
  });

  it('the manage token of appointment A cannot read, cancel or move B; an expired token is refused', async () => {
    const A = await holdAndConfirm(slots[8]); const B = await holdAndConfirm(slots[9]);
    expect((await call('POST', 'guest/manage', { body: { appointmentId: B.id, token: A.token } })).statusCode).toBe(404);
    expect((await call('POST', 'guest/manage/cancel', { body: { appointmentId: B.id, token: A.token } })).statusCode).toBe(404);
    expect((await call('POST', 'guest/manage/reschedule', { body: { appointmentId: B.id, token: A.token, startAt: slots[10].startAt } })).statusCode).toBe(404);
    expect((await row(B.id)).status).toBe('confirmed');
    expect((await call('POST', 'guest/manage', { body: { appointmentId: A.id, token: `${A.token.slice(0, -1)}${A.token.endsWith('A') ? 'B' : 'A'}` } })).statusCode).toBe(404);
    await db.execute(sql`UPDATE "ProAppointment" SET "guestManageExpiresAt" = (NOW() AT TIME ZONE 'UTC') - INTERVAL '1 second' WHERE id = ${A.id}`);
    expect((await call('POST', 'guest/manage', { body: { appointmentId: A.id, token: A.token } })).statusCode).toBe(404);
    expect((await call('POST', 'guest/manage/cancel', { body: { appointmentId: A.id, token: A.token } })).statusCode).toBe(404);
  });

  it('pro side: the structure sees the booking « sans compte » (e-mail masked, no hashes) and can cancel it; another structure cannot see or cancel it', async () => {
    const B = await holdAndConfirm(slots[11]);
    const pending = await hold(slots[12]);   // an unconfirmed hold is not listed
    const list = await invoke(proList, { url: '/api/pro/appointments?pageSize=50', query: { pageSize: '50' }, headers: pro(ADMIN_A) });
    expect(list.statusCode, JSON.stringify(list.body)).toBe(200);
    const item = list.body.items.find((x) => x.id === B.id);
    expect(item.origin).toBe('GUEST');
    expect(item.guest.withoutAccount).toBe(true);
    expect(item.guest.emailMasked).toMatch(/\*\*\*@example\.test$/);
    expect(item.beneficiaryName).toBe('C. D.');
    expect(JSON.stringify(item)).not.toContain(B.g.email);
    expect(JSON.stringify(list.body)).not.toMatch(/guestCodeHash|guestManageTokenHash|guestEmailHash/);
    expect(list.body.items.some((x) => x.id === pending.body.hold.id)).toBe(false);
    const other = await invoke(proList, { url: '/api/pro/appointments?pageSize=50', query: { pageSize: '50' }, headers: pro(ADMIN_B) });
    expect(other.statusCode).toBe(200);
    expect(other.body.items.some((x) => x.id === B.id)).toBe(false);
    expect((await invoke(proList, { url: `/api/pro/appointments?id=${B.id}`, query: { id: B.id }, headers: pro(ADMIN_B) })).body.items).toEqual([]);
    expect((await invoke(proCancel, { method: 'POST', url: '/api/pro/appointments/cancel', body: { id: B.id }, headers: pro(ADMIN_B) })).statusCode).toBe(404);
    const cx = await invoke(proCancel, { method: 'POST', url: '/api/pro/appointments/cancel', body: { id: B.id }, headers: pro(ADMIN_A) });
    expect(cx.statusCode, JSON.stringify(cx.body)).toBe(200);
    expect((await row(B.id)).cancelledBy).toBe('PRO');
    expect(mailer.__getTestOutbox().some((x) => x.to === B.g.email && /annulé/.test(x.subject))).toBe(true);
  });

  it('gdpr-purge step 13 clears the guest columns of an old booking (and 13b an expired unconfirmed hold)', async () => {
    const A = await holdAndConfirm(slots[13]);
    const pendingHold = await hold(slots[14]);
    await db.execute(sql`UPDATE "ProAppointment" SET "createdAt" = NOW() - INTERVAL '800 days' WHERE id = ${A.id}`);
    await db.execute(sql`UPDATE "ProAppointment" SET "guestHoldExpiresAt" = (NOW() AT TIME ZONE 'UTC') - INTERVAL '2 days' WHERE id = ${pendingHold.body.hold.id}`);
    vi.stubEnv('GDPR_PURGE_ENABLED', 'true');
    try {
      const r = await invoke(purge, { url: '/api/cron/gdpr-purge', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
      expect(r.body.failed_steps || []).not.toContain('anonymisedAppointmentsCount');
      expect(r.body.failed_steps || []).not.toContain('clearedGuestHoldsCount');
    } finally { vi.unstubAllEnvs(); vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test'); vi.stubEnv('ADA_GUEST_BOOKING_ENABLED', 'true'); }
    for (const id of [A.id, pendingHold.body.hold.id]) {
      const x = await row(id);
      expect([x.beneficiaryName, x.guestEmail, x.guestEmailHash, x.guestPhone, x.guestCodeHash, x.guestManageTokenHash, x.notes]).toEqual(['[anonymisé]', null, null, null, null, null, null]);
    }
    expect((await row(pendingHold.body.hold.id)).status).toBe('cancelled');
  });
});
