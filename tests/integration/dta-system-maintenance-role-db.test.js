/**
 * DTA S2A — POST /api/pro/system-maintenance (BACKUP) on REAL PostgreSQL with real pro JWTs: platform-wide totals are SUPERADMIN-only (S1D fix, previously unit-only).
 * A STRUCTURE_ADMIN / PRO of any organization gets no totals and writes no audit row; a SUPERADMIN gets real counts and an audit row.  Skipped without DATABASE_URL; synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ORG = `sm-s-${TS}`; const U = { admin: `sm-ua-${TS}`, pro: `sm-up-${TS}`, sup: `sm-us-${TS}` };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('system-maintenance is SUPERADMIN only (real DB)', () => {
  let db, schema, auth, handler, backupId = null;
  const call = async (role) => {
    const r = mk(); const headers = { host: 'localhost' };
    if (role) headers.authorization = 'Bearer ' + auth.signProToken({ id: U[role === 'STRUCTURE_ADMIN' ? 'admin' : role === 'PRO' ? 'pro' : 'sup'], email: `${role}-${TS}@example.test`, structureId: ORG, role });
    await handler({ method: 'POST', url: '/api/pro/system-maintenance', query: {}, headers, body: { action: 'BACKUP' } }, r); return r;
  };
  const audits = async () => (await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'SYSTEM_BACKUP_GENERATED'`)).rows[0].n;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.js'); auth = await import('../../api/_utils/auth.js'); ({ default: handler } = await import('../../api/_handlers/pro/system-maintenance.js'));
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt") VALUES (${ORG}, 'SM', ${'sm-slug-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', NOW(), NOW())`);
    for (const [k, role] of [['admin', 'STRUCTURE_ADMIN'], ['pro', 'PRO'], ['sup', 'SUPERADMIN']]) await db.insert(schema.ProUser).values({ id: U[k], email: `${role}-${TS}@example.test`, password_hash: 'x', structureId: ORG, role, status: 'active' });
  });
  afterAll(async () => {
    if (!db) return;
    if (backupId) await db.execute(sql`DELETE FROM "AuditLog" WHERE entity_id = ${backupId}`);
    for (const id of Object.values(U)) await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${id}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${ORG}`);
  });

  it('anonymous 401; STRUCTURE_ADMIN and PRO refused with no totals and no audit row; SUPERADMIN gets the real counts and an audit row', async () => {
    expect((await call(null)).statusCode).toBe(401);
    const before = await audits();
    for (const role of ['STRUCTURE_ADMIN', 'PRO']) {
      const r = await call(role); expect([401, 403], role).toContain(r.statusCode);
      expect(JSON.stringify(r.body)).not.toMatch(/counts|diagnostics|proUsers|backupId|auditEntries/);
    }
    expect(await audits()).toBe(before);
    const sup = await call('SUPERADMIN'); expect(sup.statusCode).toBe(200); backupId = sup.body.backupId;
    expect(sup.body.counts.proUsers).toBeGreaterThanOrEqual(3); expect(typeof sup.body.counts.diagnostics).toBe('number'); expect(sup.body.backupId).toMatch(/^ADA-BKUP-[0-9A-F]{8}$/);
    expect(await audits()).toBe(before + 1);
  });
});
