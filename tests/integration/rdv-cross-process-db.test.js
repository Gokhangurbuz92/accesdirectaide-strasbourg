/**
 * DTA S8 — appointment collisions across INDEPENDENT OS PROCESSES on a real PostgreSQL.
 * The older rdv-stress test fires promises from ONE process and inserts rows with distinct idempotency keys (it proves the unique key, not the booking rule); the in-process
 * withBookingCollisionLock cannot protect two processes (two serverless instances). What protects them is the per-structure/day pg_advisory_xact_lock taken inside the
 * booking transaction. This file proves that, with real child processes that import the real citizen handler and leave a barrier at the same wall-clock instant.
 *
 *   1. N citizens, N processes, ONE slot            => exactly one 201, all others 409, exactly one active row.
 *   2. overlapping slots of two services (60 vs 30)  => exactly one winner, the others 409, no overlap in the table.
 *   3. SAME citizen, SAME idempotency key, N processes => one row; one 201, the others 200 (replay) - never a 409 for a booking that succeeded.
 *   4. N citizens, N processes, N DIFFERENT slots    => all N succeed (the lock serializes, it does not drop or time out valid bookings).
 *   5. a cancelled slot is bookable again by a competing process.
 * Requires DATABASE_URL (isolated local PostgreSQL) and `tsx`; skipped otherwise. Synthetic data only; no network; the mailer uses its built-in test outbox.
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
const CHILD = path.join(HERE, 'helpers', 'rdv-book-child.mjs');
const ROOT = path.resolve(HERE, '..', '..');
const N = 8;
const IDS = { structure: `rdvxp-str-${TS}`, svc30: `rdvxp-s30-${TS}`, svc60: `rdvxp-s60-${TS}` };
const SLUG = `rdvxp-slug-${TS}`;
const userId = (i) => `rdvxp-u${i}-${TS}`;
const userEmail = (i) => `xp${i}-${TS}@example.test`;

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

/** Starts one real process per spec; every process waits for the same instant before it books. */
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

describe.skipIf(!hasDatabase)('RDV cross-process collisions (real PostgreSQL, independent processes)', () => {
  let db, schema, handler, userAuth;
  let days; // [{ slots30: [...], slots60: [...] }] one entry per calendar day offered

  const call = async ({ method = 'GET', path: p, query = {}, body, cookie }) => {
    const res = makeRes();
    await handler({ method, url: `/api/rdv/${p}`, query, body, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(cookie ? { cookie } : {}) } }, res);
    return res;
  };
  const cookieFor = (i) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: userId(i), email: userEmail(i) })).split(';')[0];
  const active = async (startAt) => (await db.execute(sql`SELECT count(*)::int AS n FROM "ProAppointment" WHERE "structureId" = ${IDS.structure} AND "startAt" = ${new Date(startAt)} AND status <> 'cancelled'`)).rows[0].n;
  const spec = (i, serviceId, startAt, key, label) => ({ label: label || `c${i}`, slug: SLUG, serviceId, startAt, idempotencyKey: key, userId: userId(i), email: userEmail(i) });
  const spread = (results) => Math.max(...results.map((r) => r.startedAt)) - Math.min(...results.map((r) => r.startedAt));

  beforeAll(async () => {
    ({ default: handler } = await import('../../api/_handlers/rdv.js'));
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    userAuth = await import('../../api/_utils/user-auth.js');

    // E01 fixture overlay v1 (PKG-5, 2026-10-20): the synthetic organization is identity-VERIFIED so new bookings are allowed (owner decision E01). Only this fixture changed; no assertion.
    await db.execute(sql`
      INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${IDS.structure}, 'RDV cross-process Test Structure', ${SLUG}, 'association', '1 rue test', 'Strasbourg', '67000', false, ARRAY['consultation'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.insert(schema.StructureRdvSettings).values({ structureId: IDS.structure, isPublished: true, bookingMode: 'IN_PERSON' });
    await db.insert(schema.ProRdvService).values([
      { id: IDS.svc30, structureId: IDS.structure, name: 'Court (30 min)', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true },
      { id: IDS.svc60, structureId: IDS.structure, name: 'Long (60 min)', durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true },
    ]);
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await db.insert(schema.ProAvailabilityRule).values({ structureId: IDS.structure, weekday, startTime: '09:00', endTime: '12:00', timezone: 'Europe/Paris', isActive: true });
    }
    const verifiedAt = new Date();
    await db.insert(schema.CitizenUser).values(Array.from({ length: N }, (_, i) => ({ id: userId(i), email: userEmail(i), passwordHash: 'x', emailVerifiedAt: verifiedAt })));

    const from = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
    const slotsFor = async (serviceId) => {
      const r = await call({ path: `structures/${SLUG}/slots`, query: { serviceId, from, to }, cookie: cookieFor(0) });
      expect(r.statusCode).toBe(200);
      return (r.body.days || []).map((d) => d.slots || []).filter((s) => s.length > 0);
    };
    const d30 = await slotsFor(IDS.svc30);
    const d60 = await slotsFor(IDS.svc60);
    expect(d30.length).toBeGreaterThanOrEqual(4);
    expect(d60.length).toBeGreaterThanOrEqual(4);
    days = d30.map((s30, i) => ({ slots30: s30, slots60: d60[i] || [] }));
    expect(days[0].slots30.length, '09:00-12:00 in 30-minute slots = 6 per day').toBeGreaterThanOrEqual(6);
  }, 60000);

  afterAll(async () => {
    if (!hasDatabase || !db) return;
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${IDS.structure}`);
    await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${IDS.structure}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${IDS.structure}`);
    await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${IDS.structure}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${IDS.structure}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id LIKE ${'rdvxp-u%-' + TS}`);
  });

  it('1. eight citizens in eight processes take the SAME slot: exactly one 201, seven 409, one active row', async () => {
    const slot = days[0].slots30[0];
    const results = await race(Array.from({ length: N }, (_, i) => spec(i, IDS.svc30, slot.startAt, `xp1-${TS}-${i}`)));
    expect(new Set(results.map((r) => r.pid)).size).toBe(N);
    expect(results.every((r) => r.pid !== process.pid)).toBe(true);
    expect(spread(results)).toBeLessThan(2000);
    expect(results.filter((r) => r.thrown)).toEqual([]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses, JSON.stringify(results.map((r) => [r.label, r.status, r.body && r.body.error]))).toEqual([201, 409, 409, 409, 409, 409, 409, 409]);
    expect(await active(slot.startAt)).toBe(1);
  }, 120000);

  it('2. overlapping slots of two services (60 min at t, 30 min at t+30): exactly one winner, the rest 409, no overlapping rows', async () => {
    const day = days[1];
    const starts30 = new Set(day.slots30.map((s) => s.startAt));
    const t = day.slots60.find((s) => starts30.has(s.startAt) && starts30.has(new Date(new Date(s.startAt).getTime() + 30 * 60000).toISOString()));
    expect(t, 'a start offered for 60 min whose +30 min neighbour is offered for 30 min').toBeTruthy();
    const t30 = new Date(new Date(t.startAt).getTime() + 30 * 60000).toISOString();
    const specs = [0, 1, 2, 3].map((i) => spec(i, IDS.svc60, t.startAt, `xp2-${TS}-${i}`, `long${i}`))
      .concat([4, 5, 6, 7].map((i) => spec(i, IDS.svc30, t30, `xp2-${TS}-${i}`, `court${i}`)));
    const results = await race(specs);
    expect(results.filter((r) => r.thrown)).toEqual([]);
    expect(results.filter((r) => r.status === 201), JSON.stringify(results.map((r) => [r.label, r.status]))).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(N - 1);
    const rows = (await db.execute(sql`SELECT "startAt", "endAt" FROM "ProAppointment" WHERE "structureId" = ${IDS.structure} AND status <> 'cancelled' AND "startAt" >= ${new Date(t.startAt)} AND "startAt" < ${new Date(new Date(t.startAt).getTime() + 3600000)} ORDER BY "startAt"`)).rows;
    expect(rows).toHaveLength(1);
  }, 120000);

  it('3. one citizen, one idempotency key, four processes (double click / retry): one row, one 201, the others 200 with the SAME appointment - never a 409', async () => {
    const slot = days[2].slots30[0];
    const results = await race([0, 1, 2, 3].map((k) => spec(0, IDS.svc30, slot.startAt, `xp3-${TS}`, `same${k}`)));
    expect(results.filter((r) => r.thrown)).toEqual([]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses, JSON.stringify(results.map((r) => [r.label, r.status, r.body && r.body.error]))).toEqual([200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body && r.body.id)).size).toBe(1);
    expect(await active(slot.startAt)).toBe(1);
  }, 120000);

  it('4. eight citizens in eight processes take eight DIFFERENT slots of one day: all eight succeed (the lock serializes, it never drops valid bookings)', async () => {
    const day = days[3].slots30.slice(0, 6);
    expect(day.length).toBeGreaterThanOrEqual(2);
    const specs = Array.from({ length: day.length }, (_, i) => spec(i, IDS.svc30, day[i].startAt, `xp4-${TS}-${i}`));
    const results = await race(specs);
    expect(results.filter((r) => r.thrown)).toEqual([]);
    expect(results.map((r) => r.status), JSON.stringify(results.map((r) => [r.label, r.status, r.body && r.body.error]))).toEqual(results.map(() => 201));
    for (const s of day) expect(await active(s.startAt)).toBe(1);
  }, 120000);

  it('5. a cancelled slot is bookable again: the owner cancels, then competing processes race for it - exactly one wins', async () => {
    const slot = days[0].slots30[0];
    const row = (await db.execute(sql`SELECT id FROM "ProAppointment" WHERE "structureId" = ${IDS.structure} AND "startAt" = ${new Date(slot.startAt)} AND status <> 'cancelled'`)).rows[0];
    const owner = (await db.execute(sql`SELECT "citizenUserId" AS u FROM "ProAppointment" WHERE id = ${row.id}`)).rows[0].u;
    const ownerIndex = Number(String(owner).match(/rdvxp-u(\d+)-/)[1]);
    const cancelled = await call({ method: 'POST', path: `appointments/${row.id}/cancel`, cookie: cookieFor(ownerIndex) });
    expect(cancelled.statusCode).toBe(200);
    expect(await active(slot.startAt)).toBe(0);
    const results = await race([0, 1, 2, 3, 4, 5].map((i) => spec(i, IDS.svc30, slot.startAt, `xp5-${TS}-${i}`)));
    expect(results.filter((r) => r.thrown)).toEqual([]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await active(slot.startAt)).toBe(1);
  }, 120000);
});
