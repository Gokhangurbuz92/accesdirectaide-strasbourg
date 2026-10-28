/**
 * Pro audit trail + dossier access log — real PostgreSQL, real pro JWTs.
 * Contract (RGPD accountability): audit rows written by logProAudit (actor_id, ip_hash, details.{structureId,shareId})
 * are readable by the SAME structure only, with actor e-mail resolved; other structures see nothing of it.
 * Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S1 = `padb-s1-${TS}`; const S2 = `padb-s2-${TS}`;
const P1 = { id: `padb-p1-${TS}`, email: `p1-${TS}@example.test` };
const P2 = { id: `padb-p2-${TS}`, email: `p2-${TS}@example.test` };
const SHARE = `padb-share-${TS}`;

function makeRes() {
  return { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, writeHead(c) { this.statusCode = c; return this; }, end(d) { if (d !== undefined) this.body = d; return this; } };
}

describe.skipIf(!hasDatabase)('pro audit + dossier views (real DB)', () => {
  let db, schema, auth, auditHandler, viewsHandler;
  const call = async (handler, { url, token }) => {
    const res = makeRes();
    await handler({ method: 'GET', url, query: {}, headers: { host: 'localhost:3000', ...(token ? { authorization: `Bearer ${token}` } : {}) } }, res);
    return res;
  };
  const tokenFor = (p, structureId) => auth.signProToken({ id: p.id, email: p.email, structureId, role: 'STRUCTURE_ADMIN' });

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    auth = await import('../../api/_utils/auth.js');
    ({ default: auditHandler } = await import('../../api/_handlers/pro/audit.js'));
    ({ default: viewsHandler } = await import('../../api/_handlers/pro/dossier/views.js'));
    for (const [sid, n] of [[S1, 1], [S2, 2]]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt")
        VALUES (${sid}, ${'Audit Test ' + n}, ${'padb-slug-' + n + '-' + TS}, 'association', '1 rue test', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', NOW(), NOW())`);
    }
    await db.insert(schema.ProUser).values([
      { id: P1.id, email: P1.email, password_hash: 'x', structureId: S1, role: 'STRUCTURE_ADMIN', status: 'active' },
      { id: P2.id, email: P2.email, password_hash: 'x', structureId: S2, role: 'STRUCTURE_ADMIN', status: 'active' },
    ]);
    await db.insert(schema.SharedDiagnostic).values({ id: SHARE, expiresAt: new Date(Date.now() + 86400000), situation: {}, results: {}, viewCount: 1 });
    // RC5: the access trail is readable only by structures holding an active grant on the dossier
    await db.insert(schema.SharedDossierGrant).values([{ sharedDiagnosticId: SHARE, structureId: S1, grantedByProUserId: P1.id }, { sharedDiagnosticId: SHARE, structureId: S2, grantedByProUserId: P2.id }]);
    await auth.logProAudit('DOSSIER_VIEWED', P1.id, S1, { shareId: SHARE, viewCount: 1 }, '203.0.113.7');
    await auth.logProAudit('DOSSIER_EXPORTED', P1.id, S1, { shareId: SHARE, format: 'csv' }, '203.0.113.7');
    await auth.logProAudit('DOSSIER_VIEWED', P2.id, S2, { shareId: SHARE, viewCount: 2 }, '198.51.100.9');
  });

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'shareId' = ${SHARE}`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${SHARE}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id IN (${P1.id}, ${P2.id})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${S1}, ${S2})`);
  });

  it('GET /api/pro/audit: 401 without token; own-structure entries only, actor e-mail resolved, ip hash present', async () => {
    expect((await call(auditHandler, { url: '/api/pro/audit' })).statusCode).toBe(401);
    const r1 = await call(auditHandler, { url: '/api/pro/audit?limit=50', token: tokenFor(P1, S1) });
    expect(r1.statusCode).toBe(200);
    const mine = r1.body.entries.filter((e) => e.details?.shareId === SHARE);
    expect(mine.map((e) => e.action).sort()).toEqual(['DOSSIER_EXPORTED', 'DOSSIER_VIEWED']);
    for (const e of mine) {
      expect(e.actorId).toBe(P1.id);
      expect(e.actorEmail).toBe(P1.email);
      expect(e.ipHash).toMatch(/^[0-9a-f]{16}$/);
      expect(e.details.structureId).toBe(S1);
    }
    const r2 = await call(auditHandler, { url: '/api/pro/audit?limit=50', token: tokenFor(P2, S2) });
    const theirs = r2.body.entries.filter((e) => e.details?.shareId === SHARE);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].actorEmail).toBe(P2.email);
  });

  it('GET /api/pro/dossier/views: validation, auth, per-structure isolation and populated fields', async () => {
    expect((await call(viewsHandler, { url: `/api/pro/dossier/views?shareId=${SHARE}` })).statusCode).toBe(401);
    expect((await call(viewsHandler, { url: '/api/pro/dossier/views', token: tokenFor(P1, S1) })).statusCode).toBe(400);
    expect((await call(viewsHandler, { url: '/api/pro/dossier/views?shareId=does-not-exist', token: tokenFor(P1, S1) })).statusCode).toBe(404);

    const r1 = await call(viewsHandler, { url: `/api/pro/dossier/views?shareId=${SHARE}`, token: tokenFor(P1, S1) });
    expect(r1.statusCode).toBe(200);
    expect(r1.body.views.map((v) => v.action).sort()).toEqual(['DOSSIER_EXPORTED', 'DOSSIER_VIEWED']);
    for (const v of r1.body.views) {
      expect(v.actorId).toBe(P1.id);
      expect(new Date(v.at).getTime()).toBeGreaterThan(Date.now() - 60000);
    }
    const r2 = await call(viewsHandler, { url: `/api/pro/dossier/views?shareId=${SHARE}`, token: tokenFor(P2, S2) });
    expect(r2.body.views).toHaveLength(1);
    expect(r2.body.views[0].actorId).toBe(P2.id);
    // RC5: a revoked grant closes the trail for that structure (same 404 as an unknown dossier)
    await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NOW() WHERE "sharedDiagnosticId" = ${SHARE} AND "structureId" = ${S2}`);
    expect((await call(viewsHandler, { url: `/api/pro/dossier/views?shareId=${SHARE}`, token: tokenFor(P2, S2) })).statusCode).toBe(404);
    expect((await call(viewsHandler, { url: `/api/pro/dossier/views?shareId=${SHARE}`, token: tokenFor(P1, S1) })).statusCode).toBe(200);
  });
});
