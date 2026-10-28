/**
 * DTA S1D — GET /api/pro/reports `kpis.diagnosticsShared` must count only dossiers shared WITH the caller's organization (grant in the period), not every SharedDiagnostic row of the platform.
 * Real PostgreSQL, real pro JWTs, synthetic data; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const X = `rep-x-${TS}`, Y = `rep-y-${TS}`;
const UX = { id: `rep-ux-${TS}`, email: `ux-${TS}@example.test` }, UY = { id: `rep-uy-${TS}`, email: `uy-${TS}@example.test` };
const D = [1, 2, 3, 4].map((n) => `rep-d${n}-${TS}`);
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('reports: diagnosticsShared is scoped to the organization (real DB)', () => {
  let db, schema, auth, handler;
  const report = async (user, sid) => { const r = mk(); const token = auth.signProToken({ id: user.id, email: user.email, structureId: sid, role: 'STRUCTURE_ADMIN' }); await handler({ method: 'GET', url: '/api/pro/reports?period=month', query: {}, headers: { host: 'localhost:3000', authorization: `Bearer ${token}` } }, r); return r; };
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.js'); auth = await import('../../api/_utils/auth.js');
    ({ default: handler } = await import('../../api/_handlers/pro/reports.js'));
    for (const [sid, n] of [[X, 'x'], [Y, 'y']]) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt") VALUES (${sid}, ${'Rep ' + n}, ${'rep-slug-' + n + '-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', NOW(), NOW())`);
    await db.insert(schema.ProUser).values([{ id: UX.id, email: UX.email, password_hash: 'x', structureId: X, role: 'STRUCTURE_ADMIN', status: 'active' }, { id: UY.id, email: UY.email, password_hash: 'x', structureId: Y, role: 'STRUCTURE_ADMIN', status: 'active' }]);
    for (const id of D) await db.insert(schema.SharedDiagnostic).values({ id, expiresAt: new Date(Date.now() + 86400000), situation: {}, results: {}, viewCount: 0 });
    // X holds grants on D1 and D2; Y on D3; D4 is shared with nobody
    await db.insert(schema.SharedDossierGrant).values([{ sharedDiagnosticId: D[0], structureId: X, grantedByProUserId: UX.id }, { sharedDiagnosticId: D[1], structureId: X, grantedByProUserId: UX.id }, { sharedDiagnosticId: D[2], structureId: Y, grantedByProUserId: UY.id }]);
  });
  afterAll(async () => {
    if (!db) return;
    for (const id of D) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${id}`);
    for (const u of [UX, UY]) await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${u.id}`);
    for (const s of [X, Y]) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${s}`);
  });
  it('each organization counts only the dossiers shared with it (X: 2, Y: 1), never the platform total and never an unshared dossier', async () => {
    const total = (await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDiagnostic"`)).rows[0].n;
    expect(total).toBeGreaterThanOrEqual(4);
    const x = await report(UX, X), y = await report(UY, Y);
    expect(x.statusCode).toBe(200); expect(y.statusCode).toBe(200);
    expect(x.body.kpis.diagnosticsShared).toBe(2);
    expect(y.body.kpis.diagnosticsShared).toBe(1);
  });
});
