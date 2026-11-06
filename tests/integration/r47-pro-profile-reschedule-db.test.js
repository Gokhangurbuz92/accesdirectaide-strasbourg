/**
 * R47 finish — on a REAL PostgreSQL at the Production levels 0042 and 0042 + 0045 (no migration needed: ProProfile exists since 0005):
 *   1. an invited professional (no ProProfile row) sets their public display name → the booking's team choice offers them BY NAME → a person books them;
 *      the administrator sets a member's name; a plain member or another structure's administrator cannot; markup / e-mail / too long are refused;
 *   2. the structure moves an appointment (POST /api/pro/appointments/reschedule): free slot of the same professional only, absences, conflicts, the
 *      60-day window, a pending request, the sensitive-service gate, permissions, cross-structure 404, two concurrent moves (one wins); recorded, journaled
 *      without personal data, the person notified (ledger + in-app), shown on both sides; the person's own move allowance is untouched;
 *   3. a cancellation by the structure is journaled (ids + reason code) and the team is notified.
 * Run: <scratchpad>/r47f/int.sh 0042 ada_r47_finish_0042_test tests/integration/r47-pro-profile-reschedule-db.test.js   (and 0045)
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
const S = (k) => ({ id: `r47f-${k}-${TS}`, slug: `r47f-${k}-slug-${TS}`, svc: `r47f-${k}-svc-${TS}`, svc2: `r47f-${k}-svc2-${TS}`, name: `Structure fictive R47 ${k}` });
const T = S('t'); const O = S('o');
const pro = (k, sid, role = 'PRO', extra = {}) => ({ id: `r47f-p${k}-${TS}`, email: `r47f-p${k}-${TS}@example.test`, sid, role, ...extra });
const ADMIN = pro('a', T.id, 'STRUCTURE_ADMIN');
const P1 = pro('1', T.id, 'PRO', { name: 'Alix Fictif' });
const NEW = pro('n', T.id, 'PRO');   // invited, no ProProfile row
const ADMIN_O = pro('o', O.id, 'STRUCTURE_ADMIN');
const PROS = [ADMIN, P1, NEW, ADMIN_O];
const C = [0, 1].map((k) => ({ id: `r47f-c${k}-${TS}`, email: `r47f-c${k}-${TS}@example.test` }));
const NAME = 'Camille Nouvelle-Fictive';
const parisHM = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

describe.skipIf(!hasDatabase)('R47 public name → team choice by name; move and cancel by the structure (real DB)', () => {
  let db, rdv, auth, userAuth, proSettings, proProfile, proMove, proCancel, proAppointments, features;
  let level = '';
  const A = {};
  const cookie = (c) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: c.id, email: c.email })).split(';')[0];
  const call = async (method, path, { body, query = {}, as } = {}) => {
    const res = mk();
    await rdv({ method, url: `/api/rdv/${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`, query, body, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(as ? { cookie: cookie(as) } : {}) } }, res);
    return res;
  };
  const invoke = async (handler, who, { method = 'GET', url = '/api/pro/x', body, query = {} } = {}) => {
    const r = mk(); await handler({ method, url, query, body, headers: { host: 'x', authorization: `Bearer ${auth.signProToken({ id: who.id, email: who.email, structureId: who.sid, role: who.role })}` } }, r); return r;
  };
  const show = (r) => JSON.stringify(r.body).slice(0, 400);
  const team = (as = C[0]) => call('GET', `structures/${T.slug}/team`, { query: { serviceId: T.svc }, as });
  const slots = async (professional, { from = day(2), to = day(9), svc = T.svc } = {}) => {
    const r = await call('GET', `structures/${T.slug}/slots`, { query: { serviceId: svc, from, to, ...(professional ? { professional } : {}) }, as: C[0] });
    expect(r.statusCode, show(r)).toBe(200);
    return r.body.slots.map((x) => x.startAt);
  };
  const book = (as, startAt, extra = {}, svc = T.svc) => call('POST', 'appointments', { as, body: { structureSlug: T.slug, serviceId: svc, startAt, idempotencyKey: `k-${Math.random()}`, ...extra } });
  const move = (who, body) => invoke(proMove, who, { method: 'POST', url: '/api/pro/appointments/reschedule', body });
  const options = (who, query) => invoke(proMove, who, { method: 'GET', url: '/api/pro/appointments/reschedule', query });
  const putProfile = (who, body) => invoke(proProfile, who, { method: 'PUT', url: '/api/pro/profile', body });
  const audit = (action, id) => db.execute(sql`SELECT actor_id, details FROM "AuditLog" WHERE action = ${action} AND details->>'appointmentId' = ${id}`).then((r) => r.rows);
  const noticesOf = (id) => db.execute(sql`SELECT kind, recipient, channel, status FROM "AppointmentNotice" WHERE "appointmentId" = ${id}`).then((r) => r.rows);
  const rowOf = (id) => db.execute(sql`SELECT status, "startAt", "rescheduleCount", "rescheduledAt", "createdByProUserId" FROM "ProAppointment" WHERE id = ${id}`).then((r) => r.rows[0]);

  async function seedStructure(s) {
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${s.id}, ${s.name}, ${s.slug}, 'association', 'adresse fictive', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "updatedAt") VALUES (${'set-' + s.id}, ${s.id}, true, 'IN_PERSON', NOW())`);
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      for (const [a, b] of [['09:00', '12:00'], ['14:00', '17:00']]) {
        await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "isActive", "updatedAt") VALUES (${`r-${s.id}-${weekday}-${a}`}, ${s.id}, ${weekday}, ${a}, ${b}, 'Europe/Paris', true, NOW())`);
      }
    }
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES (${s.svc}, ${s.id}, 'Service fictif direct', 60, 0, 0, true, NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES (${s.svc2}, ${s.id}, 'Service fictif sur demande', 60, 0, 0, true, NOW())`);
  }

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ default: rdv } = await import('../../api/_handlers/rdv.js'));
    auth = await import('../../api/_utils/auth.js');
    userAuth = await import('../../api/_utils/user-auth.js');
    features = await import('../../api/_utils/schema-features.js');
    proSettings = (await import('../../api/_handlers/pro/rdv-settings.js')).default;
    proProfile = (await import('../../api/_handlers/pro/profile.js')).default;
    proMove = (await import('../../api/_handlers/pro/appointments/reschedule.js')).default;
    proCancel = (await import('../../api/_handlers/pro/appointments/cancel.js')).default;
    proAppointments = (await import('../../api/_handlers/pro/appointments/index.js')).default;
    const kinds = await features.noticeLedgerKinds(db);
    level = kinds && kinds.has('REQUEST_ACCEPTED') ? '0045' : '0042';
    for (const s of [T, O]) await seedStructure(s);
    for (const p of PROS) {
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, mfa_enabled, "updatedAt", "createdAt") VALUES (${p.id}, ${p.email}, 'x', ${p.sid}, ${p.role}, 'active', true, NOW(), NOW())`);
      if (p.name) await db.execute(sql`INSERT INTO "ProProfile" (id, "proUserId", "displayName", "updatedAt") VALUES (${'pp-' + p.id}, ${p.id}, ${p.name}, NOW())`);
    }
    for (const c of C) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "notificationEmailEnabled", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), true, NOW())`);
    await declareAdult(db, sql, C.map((c) => c.id), { band: '25-59' });
    const r = await invoke(proSettings, ADMIN, { method: 'PATCH', url: '/api/pro/rdv-settings', body: { team: { enabled: true, members: {
      [P1.id]: { bookable: true, selectable: true }, [NEW.id]: { bookable: true, selectable: true } } }, serviceConfirmation: { [T.svc2]: 'APPROVAL' } } });
    expect(r.statusCode, show(r)).toBe(200);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    for (const s of [T, O]) {
      await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (SELECT id FROM "ProAppointment" WHERE "structureId" = ${s.id})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${s.id}`).catch(() => {});
      for (const tbl of ['ProAppointment', 'ProTimeOff', 'ProAvailabilityRule', 'ProRdvService', 'StructureRdvSettings']) await db.execute(sql.raw(`DELETE FROM "${tbl}" WHERE "structureId" = '${s.id}'`));
    }
    for (const p of PROS) {
      await db.execute(sql`DELETE FROM "ProProfile" WHERE "proUserId" = ${p.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "AuditLog" WHERE actor_id = ${p.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${p.id}`);
    }
    for (const s of [T, O]) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${s.id}`);
    for (const c of C) {
      await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${c.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "CitizenProfile" WHERE "userId" = ${c.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
    }
  });

  it('runs on a Production database level (0042, or 0042 + 0045); ProProfile is there', async () => {
    console.info(`[r47-finish] database level ${level}`);
    expect(['0042', '0045']).toContain(level);
    const cols = (await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'ProProfile'`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(['proUserId', 'displayName', 'jobTitle', 'isPubliclyVisible']));
  });

  it('an invited member without a name is never offered; after setting their own name they are offered BY NAME (never by e-mail) and can be booked', async () => {
    const before = await team();
    expect(before.statusCode, show(before)).toBe(200);
    expect(before.body.professionals.map((p) => p.displayName)).toEqual([P1.name]);
    expect(JSON.stringify(before.body)).not.toContain(NEW.email);
    const g = await invoke(proProfile, NEW, { url: '/api/pro/profile' });
    expect(g.statusCode).toBe(200); expect(g.body.profile).toEqual({ memberId: NEW.id, displayName: null, jobTitle: null }); expect(g.body.members).toBeUndefined();
    const put = await putProfile(NEW, { displayName: `  ${NAME} `, jobTitle: 'Conseillère emploi (fictive)' });
    expect(put.statusCode, show(put)).toBe(200);
    expect(put.body.profile).toEqual({ memberId: NEW.id, displayName: NAME, jobTitle: 'Conseillère emploi (fictive)' });
    const row = (await db.execute(sql`SELECT "displayName", "jobTitle", "isPubliclyVisible" FROM "ProProfile" WHERE "proUserId" = ${NEW.id}`)).rows[0];
    expect(row).toEqual({ displayName: NAME, jobTitle: 'Conseillère emploi (fictive)', isPubliclyVisible: false });   // never a directory listing
    const after = await team();
    const offered = after.body.professionals.find((p) => p.displayName === NAME);
    expect(offered).toBeTruthy(); expect(offered.role).toBe('Conseillère emploi (fictive)'); expect(offered.id).not.toContain(NEW.id);
    A.handle = offered.id;
    const free = await slots(A.handle);
    expect(free.length).toBeGreaterThan(4);
    const b = await book(C[0], free[0], { professional: A.handle });
    expect(b.statusCode, show(b)).toBe(201);
    A.booked = b.body.id; A.free = free;
    expect((await rowOf(A.booked)).createdByProUserId).toBe(NEW.id);
    // the journal: ids and booleans, never the name
    const aud = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'PRO_PROFILE_UPDATED' AND actor_id = ${NEW.id}`)).rows;
    expect(aud.length).toBe(1); expect(aud[0].details).toMatchObject({ memberId: NEW.id, self: true, displayNameSet: true, jobTitleSet: true, structureId: T.id });
    expect(JSON.stringify(aud)).not.toContain('Camille');
  });

  it('the administrator sets a member\'s name; a plain member cannot; another structure\'s administrator gets the same 404 as an unknown id; bad values are refused', async () => {
    const list = await invoke(proProfile, ADMIN, { url: '/api/pro/profile' });
    expect(list.statusCode).toBe(200); expect(list.body.canManageOthers).toBe(true);
    expect(list.body.members.map((m) => m.id).sort()).toEqual([ADMIN.id, P1.id, NEW.id].sort());
    const set = await putProfile(ADMIN, { memberId: P1.id, displayName: 'Alix C. Fictif', jobTitle: '' });
    expect(set.statusCode, show(set)).toBe(200); expect(set.body.profile).toEqual({ memberId: P1.id, displayName: 'Alix C. Fictif', jobTitle: null });
    expect((await putProfile(P1, { memberId: NEW.id, displayName: 'Autre' })).statusCode).toBe(403);
    const cross = await putProfile(ADMIN_O, { memberId: NEW.id, displayName: 'Intrus' });
    expect(cross.statusCode).toBe(404); expect(cross.body.code).toBe('MEMBER_NOT_FOUND');
    expect((await putProfile(ADMIN_O, { memberId: `nobody-${TS}`, displayName: 'Intrus' })).body).toEqual(cross.body);
    expect((await invoke(proProfile, ADMIN_O, { url: '/api/pro/profile', query: { memberId: NEW.id } })).statusCode).toBe(404);
    for (const [displayName, code] of [['<img src=x onerror=alert(1)>', 'DISPLAYNAME_INVALID'], [NEW.email, 'DISPLAYNAME_INVALID'], ['x'.repeat(61), 'DISPLAYNAME_TOO_LONG'], ['Z', 'DISPLAYNAME_TOO_SHORT']]) {
      const r = await putProfile(NEW, { displayName });
      expect(r.statusCode, displayName).toBe(400); expect(r.body).toMatchObject({ code, field: 'displayName' });
    }
    expect((await db.execute(sql`SELECT "displayName" FROM "ProProfile" WHERE "proUserId" = ${NEW.id}`)).rows[0].displayName).toBe(NAME);
    expect((await team()).body.professionals.map((p) => p.displayName).sort()).toEqual(['Alix C. Fictif', NAME].sort());
  });

  it('the structure moves the appointment to a free slot of the same professional: recorded, journaled without personal data, the person told, both sides show it; the person\'s own moves are untouched', async () => {
    const opts = await options(NEW, { id: A.booked });
    expect(opts.statusCode, show(opts)).toBe(200);
    expect(opts.body.consent).toBe('NONE');
    expect(opts.body.slots.length).toBeGreaterThan(0);
    const startBefore = new Date((await rowOf(A.booked)).startAt).toISOString();
    expect(opts.body.slots.some((s) => s.startAt === startBefore)).toBe(false);
    const target = opts.body.slots.find((s) => Date.parse(s.startAt) > Date.parse(A.free[0]) + 2 * DAY) || opts.body.slots.at(-1);
    const since = new Date();
    const r = await move(NEW, { id: A.booked, startAt: target.startAt, expectedStartAt: startBefore });
    expect(r.statusCode, show(r)).toBe(200);
    const row = await rowOf(A.booked);
    expect(new Date(row.startAt).toISOString()).toBe(target.startAt);
    expect(row.status).toBe('confirmed'); expect(row.rescheduleCount).toBe(0); expect(row.rescheduledAt).toBeNull(); expect(row.createdByProUserId).toBe(NEW.id);
    const aud = await audit('RDV_PRO_RESCHEDULED', A.booked);
    expect(aud).toHaveLength(1); expect(aud[0].actor_id).toBe(NEW.id); expect(aud[0].details).toEqual({ appointmentId: A.booked, structureId: T.id });
    const n = await noticesOf(A.booked);
    expect(n.some((x) => x.kind === 'RESCHEDULED' && x.recipient === 'citizen' && x.channel === 'email' && x.status === 'TEST_RECORDED')).toBe(true);
    expect(n.some((x) => x.kind === 'RESCHEDULED' && x.recipient === 'structure' && x.channel === 'in_app')).toBe(true);
    const pn = (await db.execute(sql`SELECT type, title, message FROM "ProNotification" WHERE metadata->>'appointmentId' = ${A.booked} AND type = 'rdv_rescheduled'`)).rows;
    expect(pn.length).toBeGreaterThan(0); expect(JSON.stringify(pn)).not.toContain(C[0].email);
    // the person's side: the new time, « modifié par la structure », still movable twice by themself, the in-app item
    const mine = await call('GET', 'appointments', { as: C[0] });
    const it = mine.body.appointments.find((a) => a.id === A.booked);
    expect(it.startsAt).toBe(target.startAt); expect(it.movedByStructure).toMatchObject({ count: 1 }); expect(it.reschedule.count).toBe(0); expect(it.canReschedule).toBe(true);
    const { listInbox } = await import('../../api/_services/citizen-inbox.js');
    const inbox = await listInbox(C[0].id, db, { isOpen: () => true });
    expect(inbox.notifications.some((x) => x.kind === 'APPOINTMENT_RESCHEDULED')).toBe(true);
    // the team's side: the agenda item carries the move
    const ag = await invoke(proAppointments, ADMIN, { url: '/api/pro/appointments', query: { id: A.booked } });
    expect(ag.body.items[0].teamMoves).toMatchObject({ count: 1 });
    // the old slot is free again for the same professional, the new one is not
    const free = await slots(A.handle, { from: day(1), to: day(14) });
    expect(free).toContain(startBefore); expect(free).not.toContain(target.startAt);
    // no e-mail address or name in the journal rows since the move
    const rows = (await db.execute(sql`SELECT details::text AS d FROM "AuditLog" WHERE "timestamp" >= ${since}`)).rows.map((x) => x.d).join('\n');
    expect(rows).not.toMatch(/@example\.test/); expect(rows).not.toContain(NAME);
    A.target = target.startAt;
  });

  it('refusals: taken slot, the professional\'s absence, out of the 60-day window, same slot, stale screen, a pending request, permissions, another structure', async () => {
    // a second appointment of the same professional; moving the first onto it is a conflict
    const free = await slots(A.handle, { from: day(3), to: day(12) });
    const other = await book(C[1], free.find((s) => s !== A.target), { professional: A.handle });
    expect(other.statusCode, show(other)).toBe(201);
    A.other = other.body.id;
    const taken = await move(NEW, { id: A.booked, startAt: other.body.startsAt });
    expect(taken.statusCode, show(taken)).toBe(409); expect(taken.body.code).toBe('SLOT_TAKEN');
    // the professional's own absence over a free slot
    const gap = (await slots(A.handle, { from: day(5), to: day(12) })).find((s) => s !== A.target && s !== other.body.startsAt);
    await db.execute(sql`INSERT INTO "ProTimeOff" (id, "structureId", "proUserId", "startAt", "endAt", reason, "updatedAt") VALUES (${`off-${TS}`}, ${T.id}, ${NEW.id}, ${new Date(gap)}, ${new Date(Date.parse(gap) + 3600_000)}, 'absence fictive', NOW())`);
    const absent = await move(NEW, { id: A.booked, startAt: gap });
    expect(absent.statusCode, show(absent)).toBe(409); expect(absent.body.code).toBe('SLOT_TAKEN');
    const far = await move(NEW, { id: A.booked, startAt: new Date(Date.now() + 61 * DAY).toISOString() });
    expect(far.statusCode).toBe(400); expect(far.body.code).toBe('OUT_OF_WINDOW');
    expect((await move(NEW, { id: A.booked, startAt: A.target })).body.code).toBe('SAME_SLOT');
    const g = (await slots(A.handle, { from: day(5), to: day(12) })).find((s) => ![A.target, other.body.startsAt, gap].includes(s));
    expect((await move(NEW, { id: A.booked, startAt: g, expectedStartAt: new Date(Date.now() + 9 * DAY).toISOString() })).body.code).toBe('APPOINTMENT_CHANGED');
    // permissions: a member it is not assigned to (and not managing the schedule) → 403; another structure's administrator → 404 like an unknown id
    expect((await move(P1, { id: A.booked, startAt: g })).statusCode).toBe(403);
    const cross = await move(ADMIN_O, { id: A.booked, startAt: g });
    expect(cross.statusCode).toBe(404); expect((await move(ADMIN_O, { id: `nope-${TS}`, startAt: g })).body).toEqual(cross.body);
    expect((await options(ADMIN_O, { id: A.booked })).statusCode).toBe(404);
    // a pending request of the approval-required service is answered first
    const reqSlot = (await slots(A.handle, { svc: T.svc2, from: day(6), to: day(13) }))[0];
    const req = await book(C[1], reqSlot, { professional: A.handle }, T.svc2);
    expect(req.statusCode, show(req)).toBe(201); expect(req.body.state).toBe('REQUESTED');
    const pend = await move(ADMIN, { id: req.body.id, startAt: g });
    expect(pend.statusCode).toBe(409); expect(pend.body.code).toBe('REQUEST_PENDING');
    // accepted, it can be moved by the administrator and stays confirmed (the structure approves its own move)
    const acc = await invoke(proAppointments, ADMIN, { method: 'PATCH', url: '/api/pro/appointments', query: { id: req.body.id }, body: { decision: 'ACCEPT' } });
    expect(acc.statusCode, show(acc)).toBe(200);
    const g2 = (await options(ADMIN, { id: req.body.id })).body.slots.find((s) => ![A.target, other.body.startsAt, gap, g].includes(s.startAt));
    const mv = await move(ADMIN, { id: req.body.id, startAt: g2.startAt });
    expect(mv.statusCode, show(mv)).toBe(200); expect((await rowOf(req.body.id)).status).toBe('confirmed');
    // nothing changed by the refusals
    expect(new Date((await rowOf(A.booked)).startAt).toISOString()).toBe(A.target);
    expect(await audit('RDV_PRO_RESCHEDULED', A.booked)).toHaveLength(1);
  });

  it('two concurrent moves of two appointments of the same professional onto the same free slot: exactly one wins (booking locks)', async () => {
    const opts = await options(NEW, { id: A.booked, from: day(8) });
    const both = opts.body.slots.find((s) => s.startAt !== A.target);
    const [r1, r2] = await Promise.all([move(NEW, { id: A.booked, startAt: both.startAt }), move(NEW, { id: A.other, startAt: both.startAt })]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    const at = (await db.execute(sql`SELECT count(*)::int n FROM "ProAppointment" WHERE "createdByProUserId" = ${NEW.id} AND "startAt" = ${new Date(both.startAt)} AND status IN ('booked', 'confirmed')`)).rows[0].n;
    expect(at).toBe(1);
  });

  it('a verified sensitive service cannot be moved while the art. 9 gate is closed (the appointment is kept)', async () => {
    const start = new Date(Date.now() + 10 * DAY); start.setUTCHours(8, 0, 0, 0);
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "createdByProUserId", "idempotencyKey", mode, "updatedAt", "createdAt")
      VALUES (${`sens-${TS}`}, ${T.id}, ${T.svc2}, ${start}, ${new Date(start.getTime() + 3600_000)}, 'booked', 'Personne fictive', ${NEW.id}, ${`sens-${TS}`}, 'IN_PERSON', NOW(), NOW())`);
    await db.execute(sql`UPDATE "Structure" SET settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{serviceSensitivity}', ${JSON.stringify({ v: 1, services: { [T.svc2]: { value: 'sensitive', reviewedAt: new Date().toISOString(), reviewedBy: 'admin-r47@example.test' } } })}::jsonb) WHERE id = ${T.id}`);
    const o = await options(NEW, { id: `sens-${TS}` });
    expect(o.statusCode).toBe(200); expect(o.body.consent).toBe('NOT_OPEN');
    const r = await move(NEW, { id: `sens-${TS}`, startAt: new Date(start.getTime() + DAY).toISOString() });
    expect(r.statusCode).toBe(409); expect(r.body.code).toBe('SENSITIVE_BOOKING_NOT_OPEN');
    expect(new Date((await rowOf(`sens-${TS}`)).startAt).getTime()).toBe(start.getTime());
  });

  it('a cancellation by the structure is journaled (ids + fixed reason code) and the team is notified; a second click sends nothing more', async () => {
    const r = await invoke(proCancel, NEW, { method: 'POST', url: '/api/pro/appointments/cancel', body: { id: A.booked, reasonCode: 'PROFESSIONAL_UNAVAILABLE' } });
    expect(r.statusCode, show(r)).toBe(200);
    const aud = await audit('RDV_PRO_CANCELLED', A.booked);
    expect(aud).toHaveLength(1); expect(aud[0].actor_id).toBe(NEW.id); expect(aud[0].details).toEqual({ appointmentId: A.booked, reasonCode: 'PROFESSIONAL_UNAVAILABLE', structureId: T.id });
    const n = await noticesOf(A.booked);
    expect(n.filter((x) => x.kind === 'CANCELLED_BY_STRUCTURE' && x.recipient === 'structure' && x.channel === 'in_app')).toHaveLength(1);
    expect(n.some((x) => x.kind === 'CANCELLED_BY_STRUCTURE' && x.recipient === 'citizen')).toBe(true);
    const again = await invoke(proCancel, NEW, { method: 'POST', url: '/api/pro/appointments/cancel', body: { id: A.booked, reasonCode: 'free text' } });
    expect(again.statusCode).toBe(200);
    expect(await audit('RDV_PRO_CANCELLED', A.booked)).toHaveLength(1);
    // without a reason: NOT_GIVEN; a cancelled appointment can no longer be moved
    const r2 = await invoke(proCancel, NEW, { method: 'POST', url: '/api/pro/appointments/cancel', body: { id: A.other } });
    expect(r2.statusCode).toBe(200); expect((await audit('RDV_PRO_CANCELLED', A.other))[0].details.reasonCode).toBe('NOT_GIVEN');
    expect((await move(NEW, { id: A.booked, startAt: new Date(Date.now() + 5 * DAY).toISOString() })).body.code).toBe('APPOINTMENT_NOT_ACTIVE');
    void parisHM;
  });
});
