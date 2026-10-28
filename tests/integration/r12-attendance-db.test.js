/**
 * R12 (B09) — appointment attendance on real PostgreSQL (PATCH /api/pro/appointments): recorded only once the appointment has started and only on an active
 * one; another organization gets 404; the write is a compare-and-set, so two simultaneous decisions give one result and a change made in between is never
 * overwritten. R12 (B11): an absence over booked appointments lists them (nothing is cancelled silently).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const TS = Date.now();
const S1 = `r12-att-s1-${TS}`; const S2 = `r12-att-s2-${TS}`; const SVC = `r12-att-svc-${TS}`;
const P1 = { id: `r12-att-p1-${TS}`, email: `r12-att-p1-${TS}@example.test` }; const P2 = { id: `r12-att-p2-${TS}`, email: `r12-att-p2-${TS}@example.test` };
const APT = { past: `r12-att-a1-${TS}`, race: `r12-att-a2-${TS}`, future: `r12-att-a3-${TS}`, gone: `r12-att-a4-${TS}` };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('R12 appointment attendance (real DB)', () => {
  let db; let schema; let auth; let H;
  const tok = (u, sid) => `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: sid, role: 'STRUCTURE_ADMIN' })}`;
  const patch = async (u, sid, id, status) => { const r = mk(); await H({ method: 'PATCH', url: `/api/pro/appointments?id=${id}`, query: { id }, body: { id, status }, headers: { host: 'localhost', authorization: tok(u, sid) } }, r); return r; };
  const statusOf = async (id) => (await db.execute(sql`SELECT status FROM "ProAppointment" WHERE id = ${id}`)).rows[0].status;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.js'); auth = await import('../../api/_utils/auth.js');
    H = (await import('../../api/_handlers/pro/appointments/index.js')).default;
    for (const [sid, n] of [[S1, 1], [S2, 2]]) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt") VALUES (${sid}, ${'ATT ' + n}, ${'att-slug-' + n + '-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', NOW(), NOW())`);
    await db.insert(schema.ProUser).values([{ id: P1.id, email: P1.email, password_hash: 'x', structureId: S1, role: 'STRUCTURE_ADMIN', status: 'active' }, { id: P2.id, email: P2.email, password_hash: 'x', structureId: S2, role: 'STRUCTURE_ADMIN', status: 'active' }]);
    await db.insert(schema.ProRdvService).values({ id: SVC, structureId: S1, name: 'Accompagnement', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true });
    const t = (h) => new Date(Date.now() + h * 3600e3);
    await db.insert(schema.ProAppointment).values([
      { id: APT.past, structureId: S1, serviceId: SVC, startAt: t(-2), endAt: t(-1.5), status: 'confirmed', beneficiaryName: 'P' },
      { id: APT.race, structureId: S1, serviceId: SVC, startAt: t(-3), endAt: t(-2.5), status: 'confirmed', beneficiaryName: 'P' },
      { id: APT.future, structureId: S1, serviceId: SVC, startAt: t(24), endAt: t(24.5), status: 'confirmed', beneficiaryName: 'P' },
      { id: APT.gone, structureId: S1, serviceId: SVC, startAt: t(-5), endAt: t(-4.5), status: 'cancelled', beneficiaryName: 'P' },
    ]);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ProTimeOff" WHERE "structureId" IN (${S1}, ${S2})`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" IN (${S1}, ${S2})`); await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" IN (${S1}, ${S2})`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id IN (${P1.id}, ${P2.id})`); await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${S1}, ${S2})`);
  });

  it('too early, not active, another organization: refused and unchanged', async () => {
    expect((await patch(P1, S1, APT.future, 'done')).body.error).toBe('ATTENDANCE_TOO_EARLY');
    expect((await patch(P1, S1, APT.gone, 'no_show')).body.error).toBe('APPOINTMENT_NOT_ACTIVE');
    expect((await patch(P2, S2, APT.past, 'done')).statusCode).toBe(404);
    expect([await statusOf(APT.future), await statusOf(APT.gone), await statusOf(APT.past)]).toEqual(['confirmed', 'cancelled', 'confirmed']);
  });
  it('a started appointment is marked attended', async () => {
    const r = await patch(P1, S1, APT.past, 'done');
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200); expect(await statusOf(APT.past)).toBe('done');
  });
  it('a decision based on a stale read is refused (compare-and-set): the appointment changed in between → 409, the change made in between stays', async () => {
    // deterministic race: the handler reads the row as « confirmed » while the database already holds « cancelled » (a cancellation that landed in between)
    await db.execute(sql`UPDATE "ProAppointment" SET status = 'cancelled' WHERE id = ${APT.race}`);
    const stale = { ...(await db.query.ProAppointment.findFirst({ where: (pa, { eq }) => eq(pa.id, APT.race) })), status: 'confirmed' };
    const real = db.query.ProAppointment.findFirst;
    db.query.ProAppointment.findFirst = async (...a) => { db.query.ProAppointment.findFirst = real; return { ...stale, service: { id: SVC, name: 'Accompagnement' } }; };
    try {
      const r = await patch(P1, S1, APT.race, 'done');
      expect(r.statusCode, JSON.stringify(r.body)).toBe(409); expect(r.body.error).toBe('APPOINTMENT_CHANGED');
    } finally { db.query.ProAppointment.findFirst = real; }
    expect(await statusOf(APT.race), 'the cancellation is not overwritten').toBe('cancelled');
  });
  it('R12 (B11): an absence created over a booked appointment lists it and leaves it booked', async () => {
    const T = (await import('../../api/_handlers/pro/timeoff.js')).default;
    const t = (h) => new Date(Date.now() + h * 3600e3).toISOString();
    const r = mk(); await T({ method: 'POST', url: '/api/pro/timeoff', query: {}, body: { startAt: t(23), endAt: t(26), reason: 'Synthetic QA absence' }, headers: { host: 'localhost', authorization: tok(P1, S1) } }, r);
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201);
    expect(r.body.overlappingAppointments.map((a) => a.id)).toEqual([APT.future]);
    expect(await statusOf(APT.future)).toBe('confirmed');
  });
  it('R12 (E04): a service created, changed and deleted is journaled with the service id', async () => {
    const V = (await import('../../api/_handlers/pro/services.js')).default;
    const call = async (method, body, id) => { const r = mk(); await V({ method, url: `/api/pro/services${id ? `?id=${id}` : ''}`, query: id ? { id } : {}, body, headers: { host: 'localhost', authorization: tok(P1, S1) } }, r); return r; };
    const c = await call('POST', { name: 'Atelier numérique (synthétique)' }); expect(c.statusCode, JSON.stringify(c.body)).toBe(201);
    const sid = c.body.item.id;
    expect((await call('PATCH', { name: 'Atelier numérique (renommé)' }, sid)).statusCode).toBe(200);
    expect((await call('DELETE', undefined, sid)).statusCode).toBe(200);
    const rows = (await db.execute(sql`SELECT action FROM "AuditLog" WHERE details->>'serviceId' = ${sid} ORDER BY "timestamp"`)).rows.map((r) => r.action);
    expect(rows).toEqual(['RDV_SERVICE_CREATED', 'RDV_SERVICE_UPDATED', 'RDV_SERVICE_DELETED']);
  });
});
