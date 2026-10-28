/**
 * R24 (owner decision R18.5, 2026-10-28) — REAL PostgreSQL, real handlers, real pro JWTs: who changes a structure's schedule.
 *   - every member creates, updates and cancels their OWN absence (the B92 journey), and sees the team's absences;
 *   - the general opening hours, a closure of the whole structure and another member's absence: the administrator, or a member they explicitly delegated
 *     (withdrawing the delegation, or disabling the member, takes effect at once);
 *   - a closure removes bookable slots; one member's absence does not close the structure (it only blocks that member's own bookings);
 *   - organization isolation (another structure's absence, member or delegation answers like an unknown one) and an audit row for every change.
 * Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise. Synthetic data only.
 */
import { vi } from 'vitest';
vi.stubEnv('AUTH_SECRET', 'test-auth-secret-r24-schedule');
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const SA = `r24-sa-${TS}`, SB = `r24-sb-${TS}`, SVC = `r24-svc-${TS}`;
const U = (n, sid, role) => ({ id: `r24-${n}-${TS}`, email: `r24-${n}-${TS}@example.test`, sid, role });
const ADMIN = U('admin', SA, 'STRUCTURE_ADMIN'), ANNA = U('anna', SA, 'PRO'), BRUNO = U('bruno', SA, 'PRO'), OTHER = U('other', SB, 'STRUCTURE_ADMIN');
const at = (d, h = 0) => { const x = new Date(Date.now() + d * 86400000); x.setUTCHours(h, 0, 0, 0); return x.toISOString(); };

describe.skipIf(!hasDatabase)('R24 schedule permissions (real DB)', () => {
  let db, auth, H;
  const pro = (u) => ({ authorization: `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: u.sid, role: u.role })}` });
  const invoke = async (handler, { method = 'GET', url, body, headers = {}, query = {} }) => { const r = mk(); await handler({ method, url, query, body, headers: { host: 'x', ...headers } }, r); return r; };
  const off = (u, method, body, id) => invoke(H.timeoff, { method, url: `/api/pro/timeoff${id ? `?id=${id}` : ''}`, query: id ? { id } : {}, body, headers: pro(u) });
  const hours = (u) => invoke(H.availability, { method: 'PUT', url: '/api/pro/availability', body: { slots_json: { mon: ['09:00-12:00'], tue: ['09:00-12:00'], wed: ['09:00-12:00'], thu: ['09:00-12:00'], fri: ['09:00-12:00'], sat: ['09:00-12:00'], sun: ['09:00-12:00'] }, timezone: 'Europe/Paris' }, headers: pro(u) });
  const delegate = (by, to, grant) => invoke(H.team, { method: 'PATCH', url: '/api/pro/team', body: { targetUserId: to.id, canManageSchedule: grant }, headers: pro(by) });
  const audit = async (action) => (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = ${action} AND details->>'structureId' = ${SA} ORDER BY "timestamp"`)).rows.map((r) => r.details);
  const slotDays = async (u) => {
    const r = await invoke(H.slots, { url: `/api/pro/slots?serviceId=${SVC}&from=${at(2).slice(0, 10)}&to=${at(4).slice(0, 10)}`, query: { serviceId: SVC, from: at(2).slice(0, 10), to: at(4).slice(0, 10) }, headers: pro(u) });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    return new Set((r.body.slots || []).map((s) => new Date(s.startAt).toISOString().slice(0, 10)));
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); auth = await import('../../api/_utils/auth.js');
    H = {
      team: (await import('../../api/_handlers/pro/team.js')).default, availability: (await import('../../api/_handlers/pro/availability.js')).default,
      timeoff: (await import('../../api/_handlers/pro/timeoff.js')).default, slots: (await import('../../api/_handlers/pro/slots.js')).default,
    };
    for (const sid of [SA, SB]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt") VALUES (${sid}, ${'R24 ' + sid}, ${sid}, 'ASSOCIATION', '1 rue QA', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    }
    for (const u of [ADMIN, ANNA, BRUNO, OTHER]) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${u.id}, ${u.email}, 'x', ${u.sid}, ${u.role}, 'active', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt", "createdAt") VALUES (${SVC}, ${SA}, 'R24 30', 30, 0, 0, true, NOW(), NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ProTimeOff" WHERE "structureId" IN (${SA}, ${SB})`);
    await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" IN (${SA}, ${SB})`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`);
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${SA}, ${SB})`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'structureId' IN (${SA}, ${SB})`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${SA}, ${SB})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${SA}, ${SB})`);
  });

  it('a member creates, updates and cancels their own absence; the team sees it; nothing else is theirs to change', async () => {
    expect((await hours(ANNA)).statusCode, 'general hours: not an ordinary member').toBe(403);
    expect((await hours(ADMIN)).statusCode).toBe(200);
    const made = await off(ANNA, 'POST', { startAt: at(3, 8), endAt: at(3, 12), reason: 'Formation' });
    expect(made.statusCode, JSON.stringify(made.body)).toBe(201);
    expect(made.body.item).toMatchObject({ scope: 'member', proUserId: ANNA.id, mine: true, canEdit: true });
    const id = made.body.item.id;
    expect((await off(ANNA, 'PATCH', { id, reason: 'Formation (déplacée)' })).statusCode).toBe(200);
    const seen = (await off(BRUNO, 'GET')).body;
    expect(seen.canManageOthers).toBe(false); expect(seen.members, 'only schedule managers get the member list').toEqual([]);
    expect(seen.items).toEqual([expect.objectContaining({ id, scope: 'member', memberEmail: ANNA.email, mine: false, canEdit: false, reason: 'Formation (déplacée)' })]);
    expect((await off(BRUNO, 'PATCH', { id, reason: 'x' })).statusCode, 'a colleague cannot edit it').toBe(403);
    expect((await off(BRUNO, 'DELETE', undefined, id)).statusCode, 'nor cancel it').toBe(403);
    expect((await off(BRUNO, 'POST', { startAt: at(3, 8), endAt: at(3, 9), scope: 'structure' })).statusCode, 'nor close the structure').toBe(403);
    expect((await off(BRUNO, 'POST', { startAt: at(3, 8), endAt: at(3, 9), proUserId: ANNA.id })).statusCode, 'nor record a colleague\'s absence').toBe(403);
    expect((await off(ANNA, 'DELETE', undefined, id)).statusCode, 'she cancels her own').toBe(200);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "ProTimeOff" WHERE "structureId" = ${SA}`)).rows[0].n).toBe(0);
    const created = await audit('RDV_TIMEOFF_CREATED');
    expect(created.at(-1)).toMatchObject({ timeOffId: id, scope: 'member', memberId: ANNA.id });
    expect((await audit('RDV_TIMEOFF_UPDATED')).at(-1)).toMatchObject({ timeOffId: id, memberId: ANNA.id });
    expect((await audit('RDV_TIMEOFF_DELETED')).at(-1)).toMatchObject({ timeOffId: id, memberId: ANNA.id });
  });

  it('a closure removes bookable slots; one member\'s absence leaves the structure open (it blocks only that member\'s own bookings)', async () => {
    const day = at(3).slice(0, 10);
    expect((await slotDays(BRUNO)).has(day)).toBe(true);
    const mine = await off(ANNA, 'POST', { startAt: `${day}T00:00:00.000Z`, endAt: `${day}T23:59:00.000Z` });
    expect(mine.statusCode).toBe(201);
    expect((await slotDays(BRUNO)).has(day), 'a colleague\'s absence does not close the structure').toBe(true);
    expect((await slotDays(ANNA)).has(day), 'her own bookings are blocked').toBe(false);
    const closure = await off(ADMIN, 'POST', { startAt: `${day}T00:00:00.000Z`, endAt: `${day}T23:59:00.000Z`, scope: 'structure', reason: 'Fermeture' });
    expect(closure.statusCode).toBe(201); expect(closure.body.item).toMatchObject({ scope: 'structure', proUserId: null });
    expect((await slotDays(BRUNO)).has(day), 'a closure removes the day for everyone').toBe(false);
    const legacy = await off(ADMIN, 'POST', { startAt: at(5, 8), endAt: at(5, 9) });
    expect(legacy.body.item.scope, 'an administrator saying nothing records a closure, as before R24').toBe('structure');
    for (const x of [mine, closure, legacy]) expect((await off(ADMIN, 'DELETE', undefined, x.body.item.id)).statusCode, 'the administrator manages every absence').toBe(200);
  });

  it('an explicit delegation lets a member change the hours and the team\'s absences; withdrawing it (or disabling the member) ends it at once', async () => {
    expect((await delegate(ANNA, BRUNO, true)).statusCode, 'only the administrator delegates').toBe(403);
    const granted = await delegate(ADMIN, BRUNO, true);
    expect(granted.statusCode, JSON.stringify(granted.body)).toBe(200);
    expect((await invoke(H.team, { url: '/api/pro/team', headers: pro(ADMIN) })).body.users.find((u) => u.id === BRUNO.id).canManageSchedule).toBe(true);
    expect((await invoke(H.availability, { url: '/api/pro/availability', headers: pro(BRUNO) })).body.canEdit).toBe(true);
    expect((await hours(BRUNO)).statusCode).toBe(200);
    const list = (await off(BRUNO, 'GET')).body;
    expect(list.canManageOthers).toBe(true); expect(list.members.map((m) => m.id).sort()).toEqual([ADMIN.id, ANNA.id].sort());
    const forAnna = await off(BRUNO, 'POST', { startAt: at(4, 8), endAt: at(4, 12), proUserId: ANNA.id, scope: 'member' });
    expect(forAnna.statusCode).toBe(201); expect(forAnna.body.item.proUserId).toBe(ANNA.id);
    expect((await off(ANNA, 'GET')).body.items.find((i) => i.id === forAnna.body.item.id)).toMatchObject({ mine: true, canEdit: true });
    expect((await delegate(ADMIN, BRUNO, false)).statusCode).toBe(200);
    expect((await hours(BRUNO)).statusCode, 'withdrawn at once').toBe(403);
    expect((await off(BRUNO, 'DELETE', undefined, forAnna.body.item.id)).statusCode).toBe(403);
    expect((await off(ANNA, 'DELETE', undefined, forAnna.body.item.id)).statusCode, 'the absence is hers').toBe(200);
    await delegate(ADMIN, BRUNO, true);
    await db.execute(sql`UPDATE "ProUser" SET status = 'disabled' WHERE id = ${BRUNO.id}`);
    expect((await hours(BRUNO)).statusCode, 'a disabled member has no right').toBe(403);
    await db.execute(sql`UPDATE "ProUser" SET status = 'active', "canManageSchedule" = false WHERE id = ${BRUNO.id}`);
    expect((await delegate(ADMIN, ADMIN, true)).statusCode, 'administrators have it by their role, never as a flag').toBe(404);
    expect((await audit('SCHEDULE_DELEGATION_GRANTED')).map((d) => d.targetUserId)).toEqual([BRUNO.id, BRUNO.id]);
    expect((await audit('SCHEDULE_DELEGATION_WITHDRAWN')).map((d) => d.targetUserId)).toEqual([BRUNO.id]);
    expect((await audit('RDV_AVAILABILITY_UPDATED')).length).toBeGreaterThanOrEqual(2);
  });

  it('organization isolation: another structure\'s administrator neither sees, changes nor delegates anything here', async () => {
    const a = await off(ANNA, 'POST', { startAt: at(6, 8), endAt: at(6, 9) });
    expect((await off(OTHER, 'GET')).body.items).toEqual([]);
    expect((await off(OTHER, 'PATCH', { id: a.body.item.id, reason: 'x' })).statusCode).toBe(404);
    expect((await off(OTHER, 'DELETE', undefined, a.body.item.id)).statusCode).toBe(404);
    expect((await off(OTHER, 'POST', { startAt: at(6, 8), endAt: at(6, 9), proUserId: ANNA.id })).statusCode, 'a member of another structure is unknown').toBe(404);
    expect((await delegate(OTHER, ANNA, true)).statusCode).toBe(404);
    expect((await db.execute(sql`SELECT "canManageSchedule" c FROM "ProUser" WHERE id = ${ANNA.id}`)).rows[0].c).toBe(false);
    expect((await off(ADMIN, 'DELETE', undefined, a.body.item.id)).statusCode).toBe(200);
  });
});
