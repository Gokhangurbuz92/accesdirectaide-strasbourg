/**
 * GDPR purge cron — real PostgreSQL. Verifies retention semantics (old/expired rows deleted, recent kept,
 * old appointments anonymised) and that the summary REPORTS what happened. Requires DATABASE_URL; skipped otherwise.
 */
import { vi } from 'vitest';
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY);
const makeRes = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const ID = { str: `gp-str-${TS}`, svc: `gp-svc-${TS}`, user: `gp-user-${TS}`, aptOld: `gp-apt-old-${TS}`, aptNew: `gp-apt-new-${TS}` };

describe.skipIf(!hasDatabase)('gdpr-purge (real DB)', () => {
  let db, schema, handler;
  const run = async (secret = process.env.CRON_SECRET) => { const res = makeRes(); await handler({ method: 'GET', url: '/api/cron/gdpr-purge', query: {}, headers: secret ? { 'x-cron-secret': secret } : {} }, res); return res; };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.js');
    ({ default: handler } = await import('../../api/_handlers/cron/gdpr-purge.js'));
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt") VALUES (${ID.str}, 'GP', ${'gp-slug-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.insert(schema.ProRdvService).values({ id: ID.svc, structureId: ID.str, name: 'S', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true });
    await db.insert(schema.CitizenUser).values({ id: ID.user, email: `gp-${TS}@example.test`, passwordHash: 'x' });
    const apt = (id, created) => ({ id, structureId: ID.str, serviceId: ID.svc, startAt: ago(5), endAt: ago(5), status: 'confirmed', beneficiaryName: 'Jean Dupont', beneficiaryPhone: '0600000000', notes: 'note', citizenEmailSnapshot: `gp-${TS}@example.test`, createdAt: created });
    await db.insert(schema.ProAppointment).values([apt(ID.aptOld, ago(800)), apt(ID.aptNew, ago(10))]);
    await db.insert(schema.AuditLog).values([{ action: `GP_OLD_${TS}`, timestamp: ago(400) }, { action: `GP_NEW_${TS}`, timestamp: ago(2) }]);
    await db.insert(schema.SharedDiagnostic).values([{ id: `gp-sd-exp-${TS}`, expiresAt: ago(1), situation: {}, results: {}, viewCount: 0 }, { id: `gp-sd-ok-${TS}`, expiresAt: new Date(Date.now() + DAY), situation: {}, results: {}, viewCount: 0 }]);
    await db.insert(schema.AuthToken).values([{ userId: ID.user, type: 'EMAIL_VERIFY', tokenHash: `gp-exp-${TS}`, expiresAt: ago(1) }, { userId: ID.user, type: 'EMAIL_VERIFY', tokenHash: `gp-ok-${TS}`, expiresAt: new Date(Date.now() + DAY) }]);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${ID.str}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${ID.svc}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${ID.str}`);
    await db.execute(sql`DELETE FROM "AuthToken" WHERE "userId" = ${ID.user}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${ID.user}`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE action IN (${'GP_OLD_' + TS}, ${'GP_NEW_' + TS})`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id LIKE ${'gp-sd-%-' + TS}`);
  });

  it('rejects missing / wrong secret and performs no purge', async () => {
    expect((await run('')).statusCode).toBe(401);
    expect((await run('wrong-secret')).statusCode).toBe(401);
    const n = (await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = ${'GP_OLD_' + TS}`)).rows[0].n;
    expect(n).toBe(1);
  });

  it('R33: an authorized run deletes nothing while GDPR_PURGE_ENABLED is not true (fail-closed)', async () => {
    delete process.env.GDPR_PURGE_ENABLED;
    const res = await run();
    expect([res.statusCode, res.body.skipped, res.body.reason]).toEqual([200, true, 'GDPR_PURGE_DISABLED']);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = ${'GP_OLD_' + TS}`)).rows[0].n).toBe(1);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDiagnostic" WHERE id = ${'gp-sd-exp-' + TS}`)).rows[0].n).toBe(1);
  });

  it('applies retention: expired/old rows removed, current rows kept, old appointments anonymised, and the summary reports real counts', async () => {
    process.env.GDPR_PURGE_ENABLED = 'true';   // R33: the purge runs only when explicitly enabled (fail-closed); this test checks what it does when it runs
    const res = await run().finally(() => { delete process.env.GDPR_PURGE_ENABLED; });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    const q = async (t, where) => (await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${t}" WHERE ${where}`))).rows[0].n;
    expect(await q('AuditLog', `action = 'GP_OLD_${TS}'`)).toBe(0);
    expect(await q('AuditLog', `action = 'GP_NEW_${TS}'`)).toBe(1);
    expect(await q('SharedDiagnostic', `id = 'gp-sd-exp-${TS}'`)).toBe(0);
    expect(await q('SharedDiagnostic', `id = 'gp-sd-ok-${TS}'`)).toBe(1);
    expect(await q('AuthToken', `"tokenHash" = 'gp-exp-${TS}'`)).toBe(0);
    expect(await q('AuthToken', `"tokenHash" = 'gp-ok-${TS}'`)).toBe(1);
    const old = (await db.execute(sql`SELECT "beneficiaryName","beneficiaryPhone","citizenEmailSnapshot",notes FROM "ProAppointment" WHERE id = ${ID.aptOld}`)).rows[0];
    expect(old).toMatchObject({ beneficiaryName: '[anonymisé]', beneficiaryPhone: null, citizenEmailSnapshot: null, notes: null });
    const fresh = (await db.execute(sql`SELECT "beneficiaryName","beneficiaryPhone" FROM "ProAppointment" WHERE id = ${ID.aptNew}`)).rows[0];
    expect(fresh).toMatchObject({ beneficiaryName: 'Jean Dupont', beneficiaryPhone: '0600000000' });
    // the compliance receipt must contain NUMBERS (previously `undefined` with the node-postgres driver)
    for (const k of ['audit_logs_deleted', 'diagnostics_deleted', 'tokens_deleted', 'appointments_anonymised']) expect(res.body[k], k).toBeGreaterThanOrEqual(1);
    for (const k of Object.keys(res.body).filter((x) => x.endsWith('_deleted') || x.endsWith('_anonymised'))) expect(Number.isInteger(res.body[k]), k).toBe(true);
  });
});
