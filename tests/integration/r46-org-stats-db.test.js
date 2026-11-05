/**
 * R46 (E07) — organization statistics and the CSV export on a REAL PostgreSQL through the real handlers: « today » is the Paris calendar day (the DB runs
 * in UTC: 00:15 in Paris used to count as yesterday), figures are the caller's own organization only, another organization's appointments never count,
 * the export is CSV with measured values and no personal data. Synthetic structures and professionals only.
 */
import { vi } from 'vitest';
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const S = (k) => ({ id: `r46s-${k}-${TS}`, svc: `r46s-${k}-svc-${TS}`, pro: { id: `r46s-p${k}-${TS}`, email: `r46s-p${k}-${TS}@example.test`, sid: `r46s-${k}-${TS}`, role: 'STRUCTURE_ADMIN' } });
const A = S('a'); const B = S('b');
const NAME = `Personne Fictive ${TS}`;

describe.skipIf(!hasDatabase)('R46 E07 organization statistics (real DB)', () => {
  let db, auth, teamStats, reports;
  const call = async (h, who, url) => { const r = mk(); await h({ method: 'GET', url, query: Object.fromEntries(new URL(url, 'http://x').searchParams), headers: { host: 'x', authorization: `Bearer ${auth.signProToken({ id: who.id, email: who.email, structureId: who.sid, role: who.role })}` } }, r); return r; };
  const parisMidnight = sql`(date_trunc('day', NOW() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris')`;
  const appt = (s, id, start, status = 'confirmed') => db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "createdByProUserId", "updatedAt")
    VALUES (${id}, ${s.id}, ${s.svc}, ${start}, ${start} + interval '30 minutes', ${status}, ${NAME}, ${s.pro.id}, NOW())`);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js');
    teamStats = (await import('../../api/_handlers/pro/team-stats.js')).default;
    reports = (await import('../../api/_handlers/pro/reports.js')).default;
    for (const s of [A, B]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${s.id}, ${'Structure fictive ' + s.id}, ${s.id + '-slug'}, 'association', '1 rue Fictive', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
      await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES (${s.svc}, ${s.id}, 'Accueil social', 30, 0, 0, true, NOW())`);
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, mfa_enabled, "updatedAt", "createdAt") VALUES (${s.pro.id}, ${s.pro.email}, 'x', ${s.id}, 'STRUCTURE_ADMIN', 'active', true, NOW(), NOW())`);
    }
    await appt(A, `r46s-a1-${TS}`, sql`${parisMidnight} + interval '15 minutes'`);          // 00:15 today in Paris
    await appt(A, `r46s-a2-${TS}`, sql`${parisMidnight} - interval '15 minutes'`);          // 23:45 yesterday in Paris
    await appt(A, `r46s-a3-${TS}`, sql`${parisMidnight} + interval '23 hours 40 minutes'`); // 23:40 today in Paris
    await appt(A, `r46s-a4-${TS}`, sql`${parisMidnight} - interval '3 days'`, 'no_show');
    for (let i = 0; i < 4; i += 1) await appt(B, `r46s-b${i}-${TS}`, sql`${parisMidnight} + interval '10 hours'`);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    for (const s of [A, B]) {
      await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${s.id}`);
      await db.execute(sql`DELETE FROM "AuditLog" WHERE actor_id = ${s.pro.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${s.pro.id}`);
      await db.execute(sql`DELETE FROM "Structure" WHERE id = ${s.id}`);
    }
  });

  it('team stats: « today » is the Paris day (00:15 and 23:40 count, 23:45 yesterday does not); only the caller\'s organization', async () => {
    const a = await call(teamStats, A.pro, '/api/pro/team/stats');
    expect(a.statusCode, JSON.stringify(a.body)).toBe(200);
    expect(a.body.global.appointmentsToday).toBe(2);
    const b = await call(teamStats, B.pro, '/api/pro/team/stats');
    expect(b.body.global.appointmentsToday).toBe(4);
    expect(JSON.stringify(a.body)).not.toContain(B.pro.email);
    expect(a.body.members.map((m) => m.id)).toEqual([A.pro.id]);
  });

  it('CSV export: own organization only, measured values, no personal data; a professional of another structure never gets it', async () => {
    const r = await call(reports, A.pro, '/api/pro/reports?format=csv&period=month');
    expect(r.statusCode).toBe(200);
    expect(r.headers['Content-Type']).toContain('text/csv');
    const csv = String(r.body);
    expect(csv).toMatch(/rdv_total,4\r\n/); expect(csv).toMatch(/rdv_absences,1\r\n/);
    expect(csv).not.toContain(NAME); expect(csv).not.toContain(A.pro.email);
    const rb = await call(reports, B.pro, '/api/pro/reports?format=csv&period=month');
    expect(String(rb.body)).toMatch(/rdv_total,4\r\n/);   // B's four, never A's
    const forged = await call(reports, { ...B.pro, sid: A.id }, '/api/pro/reports?format=csv&period=month');   // a token naming another structure
    expect(forged.statusCode).not.toBe(200);
  });
});
