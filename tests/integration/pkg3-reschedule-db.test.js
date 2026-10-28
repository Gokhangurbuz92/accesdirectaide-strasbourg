/**
 * PKG-3 / D-2 — reschedule on a REAL PostgreSQL (migration 0019), through the real citizen handler, in-process and across INDEPENDENT OS processes:
 *   1. a move is an atomic swap: the appointment row moves, its old slot becomes bookable, the J-1 reminder is re-armed, the count is recorded
 *   2. refusals: another account (403), the same slot (400), a slot taken by someone else (409, nothing changes), less than 24 hours before (409), a cancelled appointment (409),
 *      a third move (409) — and the database itself refuses a count above 2
 *   3. a reschedule racing seven bookings of the SAME slot in eight processes: exactly one winner; the moving citizen always holds exactly ONE appointment (never zero, never two)
 *   4. four concurrent reschedules of ONE appointment in four processes: exactly two succeed (the limit), the count ends at 2, no slot is double-booked
 * Requires DATABASE_URL (isolated local PostgreSQL) and `tsx`; skipped otherwise. Synthetic data only; the mailer uses its built-in test outbox.
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'test');
vi.stubEnv('MAILER_FROM', 'noreply@example.test');
vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-rdv-db-test');
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getRateLimitStatus: vi.fn().mockReturnValue(429),
}));

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(HERE, 'helpers', 'rdv-reschedule-child.mjs');
const ROOT = path.resolve(HERE, '..', '..');
const N = 8;
const IDS = { structure: `p3rs-str-${TS}`, svc: `p3rs-s30-${TS}` };
const SLUG = `p3rs-slug-${TS}`;
const userId = (i) => `p3rs-u${i}-${TS}`;
const userEmail = (i) => `p3rs${i}-${TS}@example.test`;

function makeRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; },
    end(d) { if (d !== undefined) this.body = d; return this; },
  };
}
function race(specs, { leadMs = 9000 } = {}) {
  const startMs = Date.now() + leadMs;
  return Promise.all(specs.map((spec) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CHILD, JSON.stringify({ ...spec, startMs })], { cwd: ROOT, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`contender ${spec.label} timed out; stderr: ${err.slice(-400)}`)); }, 90000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', () => {
      clearTimeout(timer);
      const line = out.split('\n').find((l) => l.startsWith('RESULT '));
      if (!line) return reject(new Error(`contender ${spec.label} printed no result; stderr: ${err.slice(-600)}`));
      resolve(JSON.parse(line.slice(7)));
    });
  })));
}

describe.skipIf(!hasDatabase)('PKG-3 D-2 reschedule (real PostgreSQL, in-process and independent processes)', () => {
  let db, schema, handler, userAuth, days;
  const cookieFor = (i) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: userId(i), email: userEmail(i) })).split(';')[0];
  const call = async ({ method = 'GET', path: p, query = {}, body, as }) => {
    const res = makeRes();
    await handler({ method, url: `/api/rdv/${p}`, query, body, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(as !== undefined ? { cookie: cookieFor(as) } : {}) } }, res);
    return res;
  };
  const book = async (i, startAt, key) => call({ method: 'POST', path: 'appointments', as: i, body: { structureSlug: SLUG, serviceId: IDS.svc, startAt, idempotencyKey: key } });
  const move = async (i, id, startAt) => call({ method: 'POST', path: `appointments/${id}/reschedule`, as: i, body: { startAt } });
  const row = async (id) => (await db.execute(sql`SELECT status, "startAt", "rescheduleCount" c, reminder_sent_at r FROM "ProAppointment" WHERE id = ${id}`)).rows[0];
  const activeAt = async (startAt) => (await db.execute(sql`SELECT count(*)::int AS n FROM "ProAppointment" WHERE "structureId" = ${IDS.structure} AND "startAt" = ${new Date(startAt)} AND status <> 'cancelled'`)).rows[0].n;
  const activeOf = async (i) => (await db.execute(sql`SELECT count(*)::int AS n FROM "ProAppointment" WHERE "citizenUserId" = ${userId(i)} AND status <> 'cancelled'`)).rows[0].n;

  beforeAll(async () => {
    ({ default: handler } = await import('../../api/_handlers/rdv.js'));
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    userAuth = await import('../../api/_utils/user-auth.js');
    // E01 fixture overlay v1 (PKG-5, 2026-10-20): the synthetic organization is identity-VERIFIED so new bookings are allowed (owner decision E01). Only this fixture changed; no assertion.
    await db.execute(sql`
      INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${IDS.structure}, 'PKG-3 reschedule Test Structure', ${SLUG}, 'association', '1 rue test', 'Strasbourg', '67000', false, ARRAY['consultation'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.insert(schema.StructureRdvSettings).values({ structureId: IDS.structure, isPublished: true, bookingMode: 'IN_PERSON' });
    await db.insert(schema.ProRdvService).values({ id: IDS.svc, structureId: IDS.structure, name: 'Entretien (30 min)', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true });
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await db.insert(schema.ProAvailabilityRule).values({ structureId: IDS.structure, weekday, startTime: '09:00', endTime: '12:00', timezone: 'Europe/Paris', isActive: true });
    }
    await db.insert(schema.CitizenUser).values(Array.from({ length: N + 1 }, (_, i) => ({ id: userId(i), email: userEmail(i), passwordHash: 'x', emailVerifiedAt: new Date() })));
    const from = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
    const r = await call({ path: `structures/${SLUG}/slots`, query: { serviceId: IDS.svc, from, to }, as: 0 });
    expect(r.statusCode).toBe(200);
    days = (r.body.days || []).map((d) => d.slots || []).filter((s) => s.length >= 6);
    expect(days.length).toBeGreaterThanOrEqual(4);
  }, 60000);

  afterAll(async () => {
    if (!hasDatabase || !db) return;
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${IDS.structure}`);
    await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${IDS.structure}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${IDS.structure}`);
    await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${IDS.structure}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${IDS.structure}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id LIKE ${'p3rs-u%-' + TS}`);
  });

  it('1. a move is an atomic swap: the row moves, the old slot is bookable again, the J-1 reminder is re-armed, the count is recorded; my list says what is still allowed', async () => {
    const [s0, s1] = days[0];
    const a = await book(0, s0.startAt, `p3-1-${TS}`); expect(a.statusCode).toBe(201);
    await db.execute(sql`UPDATE "ProAppointment" SET reminder_sent_at = NOW() WHERE id = ${a.body.id}`);
    const m = await move(0, a.body.id, s1.startAt);
    expect(m.statusCode, JSON.stringify(m.body)).toBe(200); expect(m.body.startsAt).toBe(s1.startAt); expect(m.body.reschedule).toMatchObject({ count: 1, max: 2 });
    const r = await row(a.body.id); expect(new Date(r.startAt).toISOString()).toBe(s1.startAt); expect(r.c).toBe(1); expect(r.r).toBeNull();
    expect(await activeAt(s0.startAt)).toBe(0); expect(await activeAt(s1.startAt)).toBe(1); expect(await activeOf(0)).toBe(1);
    expect((await book(1, s0.startAt, `p3-1b-${TS}`)).statusCode, 'the released slot is bookable').toBe(201);
    const list = await call({ path: 'appointments', as: 0 });
    expect(list.body.appointments.find((x) => x.id === a.body.id)).toMatchObject({ canReschedule: true, canCancel: true, reschedule: { count: 1, max: 2 } });
  });

  it('2. refusals leave everything unchanged; the database refuses more than two moves', async () => {
    const [s0, s1, s2, s3, s4] = days[1];
    const a = await book(2, s0.startAt, `p3-2-${TS}`); expect(a.statusCode).toBe(201);
    expect((await book(3, s1.startAt, `p3-2b-${TS}`)).statusCode).toBe(201);
    expect((await move(3, a.body.id, s2.startAt)).statusCode, 'another account (R12: same answer as unknown)').toBe(404);
    expect((await move(2, a.body.id, s0.startAt)).body.code).toBe('SAME_SLOT');
    const taken = await move(2, a.body.id, s1.startAt); expect(taken.statusCode).toBe(409);
    expect(new Date((await row(a.body.id)).startAt).toISOString(), 'unchanged after a refusal').toBe(s0.startAt);
    expect((await move(2, a.body.id, s2.startAt)).statusCode).toBe(200);
    expect((await move(2, a.body.id, s3.startAt)).statusCode).toBe(200);
    const third = await move(2, a.body.id, s4.startAt); expect(third.statusCode).toBe(409); expect(third.body.code).toBe('RESCHEDULE_LIMIT');
    expect((await call({ path: 'appointments', as: 2 })).body.appointments.find((x) => x.id === a.body.id).canReschedule).toBe(false);
    let code = null; try { await db.execute(sql`UPDATE "ProAppointment" SET "rescheduleCount" = 3 WHERE id = ${a.body.id}`); } catch (e) { code = e.cause?.code || e.code; }
    expect(code, 'DB CHECK').toBe('23514');
    const late = await book(4, days[1][5].startAt, `p3-2c-${TS}`); expect(late.statusCode).toBe(201);
    await db.execute(sql`UPDATE "ProAppointment" SET "startAt" = NOW() + interval '3 hours', "endAt" = NOW() + interval '210 minutes' WHERE id = ${late.body.id}`);
    const tooLate = await move(4, late.body.id, days[2][0].startAt); expect(tooLate.statusCode).toBe(409); expect(tooLate.body.code).toBe('RESCHEDULE_TOO_LATE');
    expect(tooLate.body.message).toContain('24 heures');
    await call({ method: 'POST', path: `appointments/${late.body.id}/cancel`, as: 4, body: {} });
    expect((await move(4, late.body.id, days[2][0].startAt)).body.code).toBe('APPOINTMENT_NOT_ACTIVE');
  });

  it('3. a reschedule races seven bookings of the same slot in eight processes: one winner, and the moving citizen always holds exactly one appointment', async () => {
    const [own, target] = [days[2][1], days[2][2]];
    const a = await book(5, own.startAt, `p3-3-${TS}`); expect(a.statusCode).toBe(201);
    const specs = [{ label: 'mover', action: 'reschedule', appointmentId: a.body.id, startAt: target.startAt, userId: userId(5), email: userEmail(5) }]
      .concat([0, 1, 2, 3, 4, 6, 7].map((i) => ({ label: `b${i}`, slug: SLUG, serviceId: IDS.svc, startAt: target.startAt, idempotencyKey: `p3-3-${TS}-${i}`, userId: userId(i), email: userEmail(i) })));
    const results = await race(specs);
    expect(results.filter((r) => r.thrown)).toEqual([]);
    expect(new Set(results.map((r) => r.pid)).size).toBe(N);
    const wins = results.filter((r) => r.status === 200 || r.status === 201);
    expect(wins.length, JSON.stringify(results.map((r) => [r.label, r.status, r.body && r.body.error]))).toBe(1);
    expect(results.filter((r) => r.status === 409).length).toBe(N - 1);
    expect(await activeAt(target.startAt)).toBe(1);
    expect(await activeOf(5), 'never zero, never two').toBe(1);
    const moved = wins[0].label === 'mover';
    expect(new Date((await row(a.body.id)).startAt).toISOString()).toBe(moved ? target.startAt : own.startAt);
    expect(await activeAt(own.startAt)).toBe(moved ? 0 : 1);
  }, 120000);

  it('4. four concurrent reschedules of ONE appointment in four processes: exactly two succeed (the limit), no slot is double-booked', async () => {
    const d = days[3];
    // test 4 has its OWN citizen (index N): test 3's bookers include citizen 6, and a booker may legitimately win test 3's race (2026-10-20: under load that left
    // citizen 6 with a second, valid appointment and made this count 2 — a test-isolation defect, not a product one)
    const U = N;
    const a = await book(U, d[0].startAt, `p3-4-${TS}`); expect(a.statusCode).toBe(201);
    const targets = [d[1], d[2], d[3], d[4]];
    const results = await race(targets.map((t, k) => ({ label: `m${k}`, action: 'reschedule', appointmentId: a.body.id, startAt: t.startAt, userId: userId(U), email: userEmail(U) })));
    expect(results.filter((r) => r.thrown)).toEqual([]);
    const ok = results.filter((r) => r.status === 200);
    expect(ok.length, JSON.stringify(results.map((r) => [r.label, r.status, r.body && r.body.error]))).toBe(2);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error === 'RESCHEDULE_LIMIT')).toBe(true);
    const r = await row(a.body.id); expect(r.c).toBe(2);
    expect(await activeOf(U)).toBe(1);
    for (const s of d) expect(await activeAt(s.startAt)).toBeLessThanOrEqual(1);
  }, 120000);
});
