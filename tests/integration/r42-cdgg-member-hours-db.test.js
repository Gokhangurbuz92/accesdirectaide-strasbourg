/**
 * R42-CDGG — per-professional working hours and dated exceptions on a REAL PostgreSQL, at both database levels: 0042 (Production) and 0044 (LAB).
 * No migration, no new column: Structure.settings_json → rdvMemberHours (api/_services/rdv-member-hours.js). Synthetic data only, MAILER_PROVIDER=test.
 * Run: DBN=ada_r42_cdgg_0042_test bash $S/r42/cdgg/int.sh tests/integration/r42-cdgg-member-hours-db.test.js   (and DBN=ada_r42_cdgg_0044_test)
 *
 * Covers: weekly hours narrow one professional's slots (the other keeps the structure's hours); an extra availability adds hours but never outside the
 * structure's opening hours; an unavailability wins over everything; the booking re-checks the hours under the lock; no-preference routing goes to the
 * free colleague; existing appointments are kept and listed; permissions (own hours, schedule manager, cross-structure 404, plain member 403); validation;
 * audit with counts only; the other settings_json keys are preserved both ways; a structure without team choice is unchanged; Europe/Paris + DST.
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
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  setHeader(k, v) { this.headers[k] = v; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; }, end(d) { if (d !== undefined) this.body = d; return this; } });
const S = (k) => ({ id: `r42h-${k}-${TS}`, slug: `r42h-${k}-slug-${TS}`, svc: `r42h-${k}-svc-${TS}`, name: `Structure fictive R42 horaires ${k}` });
const T = S('t'); const O = S('o'); const N = S('n');
const pro = (k, sid, role = 'PRO', extra = {}) => ({ id: `r42h-p${k}-${TS}`, email: `r42h-p${k}-${TS}@example.test`, sid, role, mfa: true, ...extra });
const ADMIN = pro('a', T.id, 'STRUCTURE_ADMIN');
const COORD = pro('c', T.id, 'PRO', { canManageSchedule: true });
const P1 = pro('1', T.id, 'PRO', { name: 'Alix Horaires' });
const P2 = pro('2', T.id, 'PRO', { name: 'Brune Horaires' });
const ADMIN_O = pro('o', O.id, 'STRUCTURE_ADMIN');
const P_N = pro('n', N.id, 'PRO', { name: 'Sans équipe' });
const PROS = [ADMIN, COORD, P1, P2, ADMIN_O, P_N];
const C = [0, 1, 2].map((k) => ({ id: `r42h-c${k}-${TS}`, email: `r42h-c${k}-${TS}@example.test` }));

/** Paris wall time « HH:MM » and Paris date of an ISO instant */
const parisHM = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const parisDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso));
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const weekdayOf = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

describe.skipIf(!hasDatabase)('R42-CDGG per-professional hours (real DB)', () => {
  let db, rdv, auth, userAuth, proSettings, proHours, structures, features, team, hoursSvc;
  let level = '';
  let handleP1 = '';
  const cookie = (c) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: c.id, email: c.email })).split(';')[0];
  const call = async (method, path, { body, query = {}, as } = {}) => {
    const res = mk();
    await rdv({ method, url: `/api/rdv/${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`, query, body, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(as ? { cookie: cookie(as) } : {}) } }, res);
    return res;
  };
  const invoke = async (handler, who, { method = 'GET', url = '/api/pro/rdv/hours', body, query = {} } = {}) => {
    const r = mk(); await handler({ method, url, query, body, headers: { host: 'x', authorization: `Bearer ${auth.signProToken({ id: who.id, email: who.email, structureId: who.sid, role: who.role })}` } }, r); return r;
  };
  const show = (r) => JSON.stringify(r.body).slice(0, 400);
  const slotsOf = async (s, as, professional, { from = day(2), to = day(8) } = {}) => {
    const r = await call('GET', `structures/${s.slug}/slots`, { query: { serviceId: s.svc, from, to, ...(professional ? { professional } : {}) }, as });
    expect(r.statusCode, show(r)).toBe(200);
    return r.body.slots.map((x) => x.startAt);
  };
  const book = (s, as, startAt, extra = {}) => call('POST', 'appointments', { as, body: { structureSlug: s.slug, serviceId: s.svc, startAt, idempotencyKey: `k-${Math.random()}`, ...extra } });
  const setHours = (who, body) => invoke(proHours, who, { method: 'PUT', body });

  async function seedStructure(s) {
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${s.id}, ${s.name}, ${s.slug}, 'association', 'adresse fictive', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "updatedAt") VALUES (${'set-' + s.id}, ${s.id}, true, 'IN_PERSON', NOW())`);
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      for (const [a, b] of [['09:00', '12:00'], ['14:00', '17:00']]) {
        await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "isActive", "updatedAt") VALUES (${`r-${s.id}-${weekday}-${a}`}, ${s.id}, ${weekday}, ${a}, ${b}, 'Europe/Paris', true, NOW())`);
      }
    }
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES (${s.svc}, ${s.id}, 'Service fictif de test', 60, 0, 0, true, NOW())`);
  }

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ default: rdv } = await import('../../api/_handlers/rdv.js'));
    auth = await import('../../api/_utils/auth.js');
    userAuth = await import('../../api/_utils/user-auth.js');
    features = await import('../../api/_utils/schema-features.js');
    team = await import('../../api/_services/rdv-team.js');
    hoursSvc = await import('../../api/_services/rdv-member-hours.js');
    proSettings = (await import('../../api/_handlers/pro/rdv-settings.js')).default;
    proHours = (await import('../../api/_handlers/pro/rdv-hours.js')).default;
    structures = (await import('../../api/_handlers/structures.js')).default;
    level = (await features.appointmentGuestSchema(db)).guestReminderConsent ? '0044' : '0042';
    for (const s of [T, O, N]) await seedStructure(s);
    for (const p of PROS) {
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, mfa_enabled, "canManageSchedule", "updatedAt", "createdAt") VALUES (${p.id}, ${p.email}, 'x', ${p.sid}, ${p.role}, 'active', ${p.mfa}, ${p.canManageSchedule === true}, NOW(), NOW())`);
      if (p.name) await db.execute(sql`INSERT INTO "ProProfile" (id, "proUserId", "displayName", "updatedAt") VALUES (${'pp-' + p.id}, ${p.id}, ${p.name}, NOW())`);
    }
    for (const c of C) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    await declareAdult(db, sql, C.map((c) => c.id), { band: '25-59' });
    const r = await invoke(proSettings, ADMIN, { method: 'PATCH', url: '/api/pro/rdv-settings', body: { team: { enabled: true, members: { [P1.id]: { bookable: true, selectable: true }, [P2.id]: { bookable: true, selectable: true } } } } });
    expect(r.statusCode, show(r)).toBe(200);
    const t = await call('GET', `structures/${T.slug}/team`, { query: { serviceId: T.svc }, as: C[0] });
    handleP1 = t.body.professionals.find((p) => p.displayName === P1.name).id;
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    for (const s of [T, O, N]) {
      await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (SELECT id FROM "ProAppointment" WHERE "structureId" = ${s.id})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${s.id}`).catch(() => {});
      for (const tbl of ['ProAppointment', 'ProTimeOff', 'ProAvailabilityRule', 'ProRdvService', 'StructureRdvSettings']) await db.execute(sql.raw(`DELETE FROM "${tbl}" WHERE "structureId" = '${s.id}'`));
    }
    for (const p of PROS) {
      await db.execute(sql`DELETE FROM "ProProfile" WHERE "proUserId" = ${p.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "AuditLog" WHERE actor_id = ${p.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${p.id}`);
    }
    for (const s of [T, O, N]) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${s.id}`);
    for (const c of C) {
      await db.execute(sql`DELETE FROM "CitizenProfile" WHERE "userId" = ${c.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
    }
  });

  it('runs on the database level it was started for', () => {
    console.info(`[r42-cdgg-hours] database level ${level}`);
    expect(['0042', '0044']).toContain(level);
  });

  it('weekly hours narrow ONE professional: P1 only on one weekday morning, P2 keeps the structure hours, no preference = the union', async () => {
    const d3 = day(3);
    const r = await setHours(P1, { weekly: [{ weekday: weekdayOf(d3), startTime: '09:00', endTime: '12:00' }], exceptions: [] });
    expect(r.statusCode, show(r)).toBe(200);
    const p1 = await slotsOf(T, C[0], handleP1);
    expect(p1.length).toBeGreaterThan(0);
    for (const s of p1) {
      expect(weekdayOf(parisDay(s))).toBe(weekdayOf(d3));
      expect(parisHM(s) >= '09:00' && parisHM(s) < '12:00', parisHM(s)).toBe(true);
    }
    const any = await slotsOf(T, C[0], 'ANY');
    expect(any.length).toBeGreaterThan(p1.length);
    expect(any.some((s) => parisHM(s) >= '14:00')).toBe(true);   // P2 still has afternoons
  });

  it('an extra availability adds hours inside the structure\'s opening hours only; an unavailability wins', async () => {
    const d3 = day(3); const d4 = day(4); const d5 = day(5);
    const r = await setHours(P1, { weekly: [{ weekday: weekdayOf(d3), startTime: '09:00', endTime: '12:00' }], exceptions: [
      { kind: 'AVAILABLE', from: d4, to: d4, startTime: '14:00', endTime: '16:00' },
      { kind: 'AVAILABLE', from: d5, to: d5, startTime: '18:00', endTime: '21:00' },   // the structure is closed then: no slot (safe rule)
      { kind: 'UNAVAILABLE', from: d3, to: d3, startTime: '10:00', endTime: '11:00' },
    ] });
    expect(r.statusCode, show(r)).toBe(200);
    const p1 = await slotsOf(T, C[0], handleP1);
    const on = (ymd) => p1.filter((s) => parisDay(s) === ymd).map(parisHM);
    expect(on(d4)).toEqual(['14:00', '15:00']);
    expect(on(d5)).toEqual([]);
    expect(on(d3)).toEqual(['09:00', '11:00']);   // 10:00–11:00 removed
    // whole-day unavailability over AVAILABLE: nothing on d4
    const r2 = await setHours(P1, { weekly: [{ weekday: weekdayOf(d3), startTime: '09:00', endTime: '12:00' }], exceptions: [
      { kind: 'AVAILABLE', from: d4, to: d4, startTime: '14:00', endTime: '16:00' }, { kind: 'UNAVAILABLE', from: d4, to: d4 } ] });
    expect(r2.statusCode, show(r2)).toBe(200);
    expect((await slotsOf(T, C[0], handleP1)).filter((s) => parisDay(s) === d4)).toEqual([]);
  });

  it('the booking honours the hours: outside P1\'s hours → 409 for P1, no preference is routed to P2; a change after the slot list is re-checked under the lock', async () => {
    const d3 = day(3); const d6 = day(6);
    await setHours(P1, { weekly: [{ weekday: weekdayOf(d3), startTime: '09:00', endTime: '12:00' }], exceptions: [] });
    const any = await slotsOf(T, C[0], 'ANY');
    const afternoon = any.find((s) => parisDay(s) === d6 && parisHM(s) === '14:00');
    expect(afternoon).toBeTruthy();
    const refused = await book(T, C[0], afternoon, { professional: handleP1 });
    expect(refused.statusCode, show(refused)).toBe(409);
    const routed = await book(T, C[0], afternoon, { professional: 'ANY' });
    expect(routed.statusCode, show(routed)).toBe(201);
    const row = (await db.execute(sql`SELECT "createdByProUserId" AS pro FROM "ProAppointment" WHERE id = ${routed.body.id}`)).rows[0];
    expect(row.pro).toBe(P2.id);
    // P1 slot listed, then P1 becomes unavailable that day before the booking: the lock re-reads the hours
    const p1 = await slotsOf(T, C[1], handleP1);
    const target = p1.find((s) => parisDay(s) === d3);
    await setHours(P1, { weekly: [{ weekday: weekdayOf(d3), startTime: '09:00', endTime: '12:00' }], exceptions: [{ kind: 'UNAVAILABLE', from: d3, to: d3 }] });
    const { db: pool } = await import('../../src/db/index.js');
    const svc = { id: T.svc, durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    const cand = [{ id: P1.id, email: P1.email, displayName: P1.name, jobTitle: null, selectable: true }];
    const picked = await pool.transaction((tx) => team.pickFreeUnderLock(tx, { structureId: T.id, service: svc, startAt: new Date(target), endAt: new Date(new Date(target).getTime() + 3600_000), candidates: cand, leastBookedFirst: false }));
    expect(picked).toBeNull();
    const late = await book(T, C[1], target, { professional: handleP1 });
    expect(late.statusCode, show(late)).toBe(409);
  });

  it('existing appointments are kept when the hours change, and listed for the team', async () => {
    const d3 = day(3);
    await setHours(P1, { weekly: null, exceptions: [] });
    const p1 = await slotsOf(T, C[2], handleP1);
    const s = p1.find((x) => parisDay(x) === day(7));
    const b = await book(T, C[2], s, { professional: handleP1 });
    expect(b.statusCode, show(b)).toBe(201);
    const r = await setHours(P1, { weekly: [{ weekday: weekdayOf(d3), startTime: '09:00', endTime: '12:00' }], exceptions: [] });
    expect(r.statusCode, show(r)).toBe(200);
    expect(r.body.appointmentsOutsideHours.map((a) => a.id)).toContain(b.body.id);
    const row = (await db.execute(sql`SELECT status FROM "ProAppointment" WHERE id = ${b.body.id}`)).rows[0];
    expect(row.status).toBe('confirmed');
  });

  it('permissions: own hours; schedule manager and admin for the team; plain member 403 for a colleague; other structure 404; GET scope', async () => {
    const mine = await invoke(proHours, P1);
    expect(mine.statusCode, show(mine)).toBe(200);
    expect(mine.body.canManageOthers).toBe(false);
    expect(mine.body.members.map((m) => m.id)).toEqual([P1.id]);   // a plain member sees only themself
    expect(JSON.stringify(mine.body)).not.toContain(P2.email);
    const forColleague = await setHours(P1, { memberId: P2.id, weekly: [], exceptions: [] });
    expect([forColleague.statusCode, forColleague.body.code]).toEqual([403, 'SCHEDULE_MANAGERS_ONLY']);
    const unknownAsMember = await setHours(P1, { memberId: 'nobody-here', weekly: [], exceptions: [] });
    expect(unknownAsMember.statusCode).toBe(403);   // same answer as for a real colleague: no member oracle
    const coord = await setHours(COORD, { memberId: P2.id, weekly: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }], exceptions: [] });
    expect(coord.statusCode, show(coord)).toBe(200);
    const admin = await invoke(proHours, ADMIN);
    expect(admin.body.canManageOthers).toBe(true);
    expect(admin.body.members.map((m) => m.id).sort()).toEqual([ADMIN, COORD, P1, P2].map((p) => p.id).sort());
    expect(admin.body.members.find((m) => m.id === P2.id).hours.weekly).toEqual([{ weekday: 1, startTime: '09:00', endTime: '17:00' }]);
    const cross = await setHours(ADMIN_O, { memberId: P1.id, weekly: [], exceptions: [] });
    const unknown = await setHours(ADMIN_O, { memberId: 'nobody-here', weekly: [], exceptions: [] });
    expect([cross.statusCode, cross.body]).toEqual([unknown.statusCode, unknown.body]);
    expect(cross.statusCode).toBe(404);
    const clear = await invoke(proHours, ADMIN, { method: 'DELETE', query: { memberId: P2.id } });
    expect(clear.statusCode, show(clear)).toBe(200);
    const after = await invoke(proHours, ADMIN);
    expect(after.body.members.find((m) => m.id === P2.id).hours.weekly).toBeNull();
    const anon = mk(); await proHours({ method: 'GET', url: '/api/pro/rdv/hours', query: {}, headers: { host: 'x' } }, anon);
    expect(anon.statusCode).toBe(401);
  });

  it('validation: malformed hours are refused with a sentence, nothing is stored', async () => {
    const before = JSON.stringify((await invoke(proHours, P1)).body.members[0].hours);
    for (const bad of [
      { weekly: [{ weekday: 7, startTime: '09:00', endTime: '10:00' }] },
      { weekly: [{ weekday: 1, startTime: '9h', endTime: '10:00' }] },
      { weekly: [{ weekday: 1, startTime: '11:00', endTime: '10:00' }] },
      { weekly: [{ weekday: 1, startTime: '09:00', endTime: '11:00' }, { weekday: 1, startTime: '10:00', endTime: '12:00' }] },
      { weekly: null, exceptions: [{ kind: 'MAYBE', from: day(2), to: day(2) }] },
      { weekly: null, exceptions: [{ kind: 'UNAVAILABLE', from: '2026-02-30', to: '2026-03-01' }] },
      { weekly: null, exceptions: [{ kind: 'UNAVAILABLE', from: day(5), to: day(2) }] },
      { weekly: null, exceptions: [{ kind: 'AVAILABLE', from: day(2), to: day(2), startTime: '10:00' }] },
      { weekly: null, exceptions: Array.from({ length: 61 }, () => ({ kind: 'UNAVAILABLE', from: day(2), to: day(2) })) },
    ]) {
      const r = await setHours(P1, bad);
      expect([r.statusCode, r.body.code], JSON.stringify(bad).slice(0, 80)).toEqual([400, 'INVALID_MEMBER_HOURS']);
      expect(typeof r.body.error).toBe('string');
    }
    expect(JSON.stringify((await invoke(proHours, P1)).body.members[0].hours)).toBe(before);
  });

  it('audit rows carry counts only; the rdvBooking key and the hours never overwrite each other; nothing is public', async () => {
    const audit = (await db.execute(sql`SELECT action, details FROM "AuditLog" WHERE actor_id IN (${P1.id}, ${COORD.id}, ${ADMIN.id}) AND action LIKE 'RDV_MEMBER_HOURS_%'`)).rows;
    expect(audit.length).toBeGreaterThan(3);
    for (const a of audit) expect(JSON.stringify(a.details)).not.toMatch(/@example\.test|09:00|startTime/);
    // a booking-rules change keeps the hours; an hours change keeps the booking rules
    await setHours(P1, { weekly: [{ weekday: 2, startTime: '09:00', endTime: '10:00' }], exceptions: [] });
    const p = await invoke(proSettings, ADMIN, { method: 'PATCH', url: '/api/pro/rdv-settings', body: { confirmation: 'APPROVAL' } });
    expect(p.statusCode, show(p)).toBe(200);
    const row = (await db.execute(sql`SELECT settings_json AS s FROM "Structure" WHERE id = ${T.id}`)).rows[0].s;
    expect(row.rdvBooking.confirmation).toBe('APPROVAL');
    expect(row.rdvBooking.team.members[P1.id].selectable).toBe(true);
    expect(row.rdvMemberHours[P1.id].weekly).toEqual([{ weekday: 2, startTime: '09:00', endTime: '10:00' }]);
    await invoke(proSettings, ADMIN, { method: 'PATCH', url: '/api/pro/rdv-settings', body: { confirmation: 'DIRECT' } });
    const page = mk(); await structures({ method: 'GET', url: `/api/structures?slug=${T.slug}`, query: { slug: T.slug }, headers: { host: 'x' } }, page);
    expect(page.statusCode, show(page)).toBe(200);
    expect(JSON.stringify(page.body)).not.toMatch(/rdvMemberHours|settings_json/);
    const prof = await call('GET', `structures/${T.slug}/profile`);
    expect(JSON.stringify(prof.body)).not.toMatch(/rdvMemberHours|weekly|exceptions/);
  });

  it('a structure without team choice keeps its single agenda (member hours do not apply)', async () => {
    const before = await slotsOf(N, C[0]);
    const r = await setHours(P_N, { weekly: [], exceptions: [] });   // « works no day »
    expect(r.statusCode, show(r)).toBe(200);
    expect(await slotsOf(N, C[0])).toEqual(before);
  });

  it('Europe/Paris and DST: Monday 09:00 Paris is 08:00Z before the spring change and 07:00Z after; an exception day is a Paris day', async () => {
    const hours = { v: 1, weekly: [{ weekday: 1, startTime: '09:00', endTime: '10:00' }], exceptions: [{ id: 'x', kind: 'UNAVAILABLE', from: '2027-03-29', to: '2027-03-29', startTime: null, endTime: null }], updatedAt: null };
    const w = hoursSvc.memberWindows(hours, { from: new Date('2027-03-22T00:00:00Z'), to: new Date('2027-04-06T00:00:00Z') });
    const starts = w.allow.map((a) => a.start.toISOString());
    expect(starts).toContain('2027-03-22T08:00:00.000Z');
    expect(starts).toContain('2027-03-29T07:00:00.000Z');
    expect(starts).toContain('2027-04-05T07:00:00.000Z');
    // the whole Paris day 29/03 (23 hours long: 28/03 22:00Z → 29/03 22:00Z)
    expect(w.block.map((b) => [b.start.toISOString(), b.end.toISOString()])).toEqual([['2027-03-28T22:00:00.000Z', '2027-03-29T22:00:00.000Z']]);
    expect(hoursSvc.allowedBy(w, new Date('2027-03-29T07:00:00Z'), new Date('2027-03-29T08:00:00Z'))).toBe(false);
    expect(hoursSvc.allowedBy(w, new Date('2027-04-05T07:00:00Z'), new Date('2027-04-05T08:00:00Z'))).toBe(true);
    expect(hoursSvc.allowedBy(w, new Date('2027-04-05T08:00:00Z'), new Date('2027-04-05T09:00:00Z'))).toBe(false);   // 10:00 Paris: outside
    // the slot engine with the real rules of T across the change (no booking-window filter)
    await db.execute(sql`UPDATE "Structure" SET settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{rdvMemberHours}', ${JSON.stringify({ [P1.id]: { ...hours, exceptions: [] } })}::jsonb, true) WHERE id = ${T.id}`);
    const svc = { id: T.svc, durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    const out = await team.teamSlots({ structure: { id: T.id }, service: svc, mode: 'IN_PERSON', range: { from: new Date('2027-03-22T00:00:00Z'), to: new Date('2027-03-30T00:00:00Z') },
      candidates: [{ id: P1.id, email: P1.email, displayName: P1.name, jobTitle: null, selectable: true }] });
    expect(out.slots.map((s) => s.startAt)).toEqual(['2027-03-22T08:00:00.000Z', '2027-03-29T07:00:00.000Z']);
  });
});
