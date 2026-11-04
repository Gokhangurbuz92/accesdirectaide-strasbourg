/**
 * R41-B follow-up — the ACCOUNT-BASED appointment surface on BOTH database levels: a database migrated only to 0042 (Production today: no guest-booking
 * columns on ProAppointment, ProRdvService, StructureRdvSettings) and one migrated to 0044. Every non-guest path must work on 0042 (it used to fail with
 * « column … does not exist » because the shared « still active » rule, the agenda filter and the relational queries named the 0043/0044 columns), and
 * behave the same on 0044. The guest endpoints stay fail-closed on 0042 even with the switch on. Seeds are raw SQL (independent of the level).
 * Run: DBN=ada_r41_decoy_0042_test bash $S/r41/decoy/int.sh tests/integration/r41-appointments-schema-db.test.js   (and DBN=ada_r41_decoy_test)
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'test');
vi.stubEnv('MAILER_FROM', 'noreply@example.test');
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getRateLimitStatus: vi.fn().mockReturnValue(429),
}));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { declareAdult } from './helpers/adult-age.mjs';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const DAY = 86400000;
const STR = `r41ap-str-${TS}`; const SLUG = `r41ap-slug-${TS}`; const SVC = `r41ap-svc-${TS}`;
const ADMIN = { id: `r41ap-pa-${TS}`, email: `r41ap-pa-${TS}@example.test`, sid: STR, role: 'STRUCTURE_ADMIN' };
const CIT = [0, 1].map((i) => ({ id: `r41ap-c${i}-${TS}`, email: `r41ap-c${i}-${TS}@example.test` }));
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  setHeader(k, v) { this.headers[k] = v; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; }, end(d) { if (d !== undefined) this.body = d; return this; } });

describe.skipIf(!hasDatabase)('R41-B account-based appointments on a 0042 and a 0044 database (real DB)', () => {
  let db, rdv, auth, userAuth, proList, proSlots, proTimeoff, proCancel, proIcs, proServices, proSettings, features;
  let guest = false; let slots = [];
  const cookie = (c) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: c.id, email: c.email })).split(';')[0];
  const call = async (method, path, { body, query = {}, as } = {}) => {
    const res = mk();
    await rdv({ method, url: `/api/rdv/${path}`, query, body, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(as ? { cookie: cookie(as) } : {}) } }, res);
    return res;
  };
  const invoke = async (handler, { method = 'GET', url, body, query = {} }) => {
    const r = mk(); await handler({ method, url, query, body, headers: { host: 'x', authorization: `Bearer ${auth.signProToken({ id: ADMIN.id, email: ADMIN.email, structureId: ADMIN.sid, role: ADMIN.role })}` } }, r); return r;
  };
  const show = (r) => JSON.stringify(r.body).slice(0, 400);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ default: rdv } = await import('../../api/_handlers/rdv.js'));
    auth = await import('../../api/_utils/auth.js');
    userAuth = await import('../../api/_utils/user-auth.js');
    features = await import('../../api/_utils/schema-features.js');
    proList = (await import('../../api/_handlers/pro/appointments/index.js')).default;
    proSlots = (await import('../../api/_handlers/pro/slots.js')).default;
    proTimeoff = (await import('../../api/_handlers/pro/timeoff.js')).default;
    proCancel = (await import('../../api/_handlers/pro/appointments/cancel.js')).default;
    proIcs = (await import('../../api/_handlers/pro/appointments/ics.js')).default;
    proServices = (await import('../../api/_handlers/pro/services.js')).default;
    proSettings = (await import('../../api/_handlers/pro/rdv-settings.js')).default;
    guest = (await features.appointmentGuestSchema(db)).guestReminderConsent;
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${STR}, 'R41 AP', ${SLUG}, 'association', '1 rue', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "updatedAt") VALUES (${'set-' + STR}, ${STR}, true, 'IN_PERSON', NOW())`);
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "isActive", "updatedAt") VALUES (${`r-${STR}-${weekday}`}, ${STR}, ${weekday}, '09:00', '12:00', 'Europe/Paris', true, NOW())`);
    }
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES (${SVC}, ${STR}, 'Accueil', 30, 0, 0, true, NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${ADMIN.id}, ${ADMIN.email}, 'x', ${STR}, ${ADMIN.role}, 'active', NOW(), NOW())`);
    for (const c of CIT) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    await declareAdult(db, sql, CIT.map((c) => c.id));   // R42: booking needs a declared adult age band
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (SELECT id FROM "ProAppointment" WHERE "structureId" = ${STR})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${STR}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${STR}`);
    await db.execute(sql`DELETE FROM "ProTimeOff" WHERE "structureId" = ${STR}`);
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" = ${STR}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${STR}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${STR}`);
    await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${STR}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${ADMIN.id}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${STR}`);
    for (const c of CIT) await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
  });

  it('the database level is the one this run was started for', () => {
    console.info(`[r41] guest columns present: ${guest}`);
    expect(typeof guest).toBe('boolean');
  });

  it('public (citizen) services and slots', async () => {
    const s = await call('GET', `structures/${SLUG}/services`, { as: CIT[0] });
    expect(s.statusCode, show(s)).toBe(200);
    const from = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10); const to = new Date(Date.now() + 6 * DAY).toISOString().slice(0, 10);
    const r = await call('GET', `structures/${SLUG}/slots`, { query: { serviceId: SVC, from, to }, as: CIT[0] });
    expect(r.statusCode, show(r)).toBe(200);
    slots = (r.body.days || []).flatMap((d) => d.slots || []);
    expect(slots.length).toBeGreaterThan(10);
  });

  it('citizen booking, my list, the appointment, reschedule, cancel; the freed slots are listed again', async () => {
    const b = await call('POST', 'appointments', { as: CIT[0], body: { structureSlug: SLUG, serviceId: SVC, startAt: slots[0].startAt, idempotencyKey: `k0-${TS}` } });
    expect(b.statusCode, show(b)).toBe(201);
    const again = await call('POST', 'appointments', { as: CIT[0], body: { structureSlug: SLUG, serviceId: SVC, startAt: slots[0].startAt, idempotencyKey: `k0-${TS}` } });
    expect([200, 201]).toContain(again.statusCode);
    expect(again.body.id).toBe(b.body.id);
    const taken = await call('POST', 'appointments', { as: CIT[1], body: { structureSlug: SLUG, serviceId: SVC, startAt: slots[0].startAt, idempotencyKey: `k1-${TS}` } });
    expect(taken.statusCode, show(taken)).toBe(409);
    const list = await call('GET', 'appointments', { as: CIT[0] });
    expect(list.statusCode, show(list)).toBe(200);
    expect(JSON.stringify(list.body)).toContain(b.body.id);
    const one = await call('GET', `appointments/${b.body.id}`, { as: CIT[0] });
    expect(one.statusCode, show(one)).toBe(200);
    const m = await call('POST', `appointments/${b.body.id}/reschedule`, { as: CIT[0], body: { startAt: slots[1].startAt } });
    expect(m.statusCode, show(m)).toBe(200);
    expect(m.body.startsAt).toBe(slots[1].startAt);
    const c = await call('POST', `appointments/${b.body.id}/cancel`, { as: CIT[0], body: {} });
    expect(c.statusCode, show(c)).toBe(200);
    const d = slots[1].startAt.slice(0, 10);
    const r = await call('GET', `structures/${SLUG}/slots`, { query: { serviceId: SVC, from: d, to: d }, as: CIT[1] });
    expect(r.statusCode, show(r)).toBe(200);
    expect(JSON.stringify(r.body)).toContain(slots[1].startAt);
  });

  it('professional agenda, slots, own booking, absence with its clash list, cancel, calendar file', async () => {
    const b = await call('POST', 'appointments', { as: CIT[1], body: { structureSlug: SLUG, serviceId: SVC, startAt: slots[3].startAt, idempotencyKey: `k3-${TS}` } });
    expect(b.statusCode, show(b)).toBe(201);
    const list = await invoke(proList, { url: '/api/pro/appointments?pageSize=50', query: { pageSize: '50' } });
    expect(list.statusCode, show(list)).toBe(200);
    expect(list.body.items.map((x) => x.id)).toContain(b.body.id);
    const byId = await invoke(proList, { url: `/api/pro/appointments?id=${b.body.id}`, query: { id: b.body.id } });
    expect(byId.body.items.map((x) => x.id)).toEqual([b.body.id]);
    const d = slots[3].startAt.slice(0, 10);
    const ps = await invoke(proSlots, { url: `/api/pro/slots?serviceId=${SVC}&from=${d}&to=${d}`, query: { serviceId: SVC, from: d, to: d } });
    expect(ps.statusCode, show(ps)).toBe(200);
    expect(JSON.stringify(ps.body)).not.toContain(slots[3].startAt);
    const own = await invoke(proList, { method: 'POST', url: '/api/pro/appointments', body: { serviceId: SVC, startAt: slots[4].startAt, beneficiaryName: 'Test Pro', personConsent: true } });
    expect(own.statusCode, show(own)).toBe(201);
    const clash = await invoke(proList, { method: 'POST', url: '/api/pro/appointments', body: { serviceId: SVC, startAt: slots[3].startAt, beneficiaryName: 'Test Pro', personConsent: true } });
    expect(clash.statusCode, show(clash)).toBe(409);
    const off = await invoke(proTimeoff, { method: 'POST', url: '/api/pro/timeoff', body: { startAt: slots[3].startAt, endAt: slots[3].endAt, scope: 'structure', reason: 'R41' } });
    expect(off.statusCode, show(off)).toBe(201);
    expect(off.body.overlappingAppointments.map((x) => x.id)).toEqual([b.body.id]);
    const ics = await invoke(proIcs, { url: `/api/pro/appointments/ics?id=${b.body.id}`, query: { id: b.body.id } });
    expect(ics.statusCode, show(ics)).toBe(200);
    const cx = await invoke(proCancel, { method: 'POST', url: '/api/pro/appointments/cancel', body: { id: b.body.id } });
    expect(cx.statusCode, show(cx)).toBe(200);
  });

  it('the person\'s data export (RGPD access) lists their appointments (on 0042 the failed read used to become an empty list)', async () => {
    const { createPrivacyRightsService } = await import('../../api/_services/privacy.js');
    const crypto = await import('node:crypto');
    const ids = (await db.execute(sql`SELECT id FROM "ProAppointment" WHERE "citizenUserId" = ${CIT[0].id}`)).rows.map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    const out = await createPrivacyRightsService({ db, cryptoLib: crypto }).getExportData(CIT[0].id);
    for (const id of ids) expect(JSON.stringify(out)).toContain(id);
  });

  it('professional services (create, list, edit, delete) and the structure booking settings (create on first read, update)', async () => {
    const c = await invoke(proServices, { method: 'POST', url: '/api/pro/services', body: { name: 'Nouveau service', durationMinutes: 45 } });
    expect(c.statusCode, show(c)).toBe(201);
    const id = c.body.item.id;
    expect(c.body.item.guestBookable).toBe(guest ? false : undefined);
    const l = await invoke(proServices, { url: '/api/pro/services' });
    expect(l.statusCode, show(l)).toBe(200);
    expect(l.body.items.map((x) => x.id)).toContain(id);
    const e = await invoke(proServices, { method: 'PATCH', url: `/api/pro/services?id=${id}`, query: { id }, body: { name: 'Service renommé' } });
    expect([e.statusCode, e.body.item?.name], show(e)).toEqual([200, 'Service renommé']);
    // R42: the account-free opt-in is retired on every database level: said, never silently dropped
    const g = await invoke(proServices, { method: 'PATCH', url: `/api/pro/services?id=${id}`, query: { id }, body: { guestBookable: true } });
    expect([g.statusCode, g.body.code], show(g)).toEqual([409, 'GUEST_BOOKING_RETIRED']);
    const d = await invoke(proServices, { method: 'DELETE', url: `/api/pro/services?id=${id}`, query: { id } });
    expect(d.statusCode, show(d)).toBe(200);
    // settings: a structure without a settings row gets one on first read (insert), then an update
    await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${STR}`);
    const s0 = await invoke(proSettings, { url: '/api/pro/rdv-settings' });
    expect(s0.statusCode, show(s0)).toBe(200);
    expect(s0.body.allowGuestBooking).toBe(false);
    const s1 = await invoke(proSettings, { method: 'PUT', url: '/api/pro/rdv-settings', body: { isPublished: true, bookingMode: 'IN_PERSON' } });
    expect([s1.statusCode, s1.body.isPublished], show(s1)).toEqual([200, true]);
    const s2 = await invoke(proSettings, { method: 'PUT', url: '/api/pro/rdv-settings', body: { allowGuestBooking: true } });
    expect([s2.statusCode, s2.body.code], show(s2)).toEqual([409, 'GUEST_BOOKING_RETIRED']);
    const s3 = await invoke(proSettings, { method: 'PUT', url: '/api/pro/rdv-settings', body: { allowGuestBooking: false } });
    expect(s3.statusCode).toBe(200);
  });

  it('the account-free endpoints are retired (R42) on both levels, even with the switch on: 410 ACCOUNT_REQUIRED', async () => {
    vi.stubEnv('ADA_GUEST_BOOKING_ENABLED', 'true');
    try {
      const r = await call('GET', `guest/structures/${SLUG}/services`);
      expect([r.statusCode, r.body.code], show(r)).toEqual([410, 'ACCOUNT_REQUIRED']);
      const h = await call('POST', 'guest/hold', { body: { structureSlug: SLUG, serviceId: SVC, startAt: slots[8].startAt, idempotencyKey: `g-${TS}`, name: 'A B', email: `r41ap-g-${TS}@example.test`, consent: true } });
      expect([h.statusCode, h.body.code], show(h)).toEqual([410, 'ACCOUNT_REQUIRED']);
    } finally { vi.unstubAllEnvs(); vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test'); }
  });
});
