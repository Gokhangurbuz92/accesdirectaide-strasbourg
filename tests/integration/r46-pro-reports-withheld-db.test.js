/**
 * R46 / R45 residual F-9 — the impact report, the team statistics and the CSV of an organization do not return the aggregate counts of a CLOSED capability
 * (pro.case_management, pro.referrals, citizen.shared_dossier): keys kept, value null (never 0), closed capabilities named; in the LAB (enforcement off)
 * the same calls return the measured values. Real PostgreSQL, real pro JWTs, synthetic data.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S = `r46w-s-${TS}`; const U = { id: `r46w-u-${TS}`, email: `r46w-${TS}@example.test` }; const D = `r46w-d-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('F-9: closed-capability counters withheld (real DB)', () => {
  let db, schema, auth, reports, stats;
  const token = () => auth.signProToken({ id: U.id, email: U.email, structureId: S, role: 'STRUCTURE_ADMIN' });
  const get = async (h, url) => { const r = mk(); await h({ method: 'GET', url, query: Object.fromEntries(new URL(url, 'http://x').searchParams), headers: { host: 'localhost', authorization: `Bearer ${token()}` } }, r); return r; };
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.js'); auth = await import('../../api/_utils/auth.js');
    ({ default: reports } = await import('../../api/_handlers/pro/reports.js')); stats = await import('../../api/_services/org-stats.js');
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt") VALUES (${S}, 'R46 F9', ${'r46w-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', NOW(), NOW())`);
    await db.insert(schema.ProUser).values({ id: U.id, email: U.email, password_hash: 'x', structureId: S, role: 'STRUCTURE_ADMIN', status: 'active' });
    await db.insert(schema.SharedDiagnostic).values({ id: D, expiresAt: new Date(Date.now() + 86400000), situation: {}, results: {}, viewCount: 0 });
    await db.insert(schema.SharedDossierGrant).values({ sharedDiagnosticId: D, structureId: S, grantedByProUserId: U.id });
    await db.insert(schema.ProCase).values({ sharedDiagnosticId: D, structureId: S });
  });
  afterEach(() => { delete process.env.ADA_CAPABILITY_ENFORCEMENT; delete process.env.ADA_CAPABILITIES_OPEN; });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ProCaseEvent" WHERE "structureId" = ${S}`); await db.execute(sql`DELETE FROM "ProCase" WHERE "structureId" = ${S}`);
    await db.execute(sql`DELETE FROM "SharedDossierGrant" WHERE "structureId" = ${S}`); await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${D}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${U.id}`); await db.execute(sql`DELETE FROM "Structure" WHERE id = ${S}`);
  });

  it('LAB (enforcement off): measured values, nothing withheld', async () => {
    const r = await get(reports, '/api/pro/reports?period=month');
    expect(r.statusCode).toBe(200);
    expect(r.body.kpis).toMatchObject({ diagnosticsShared: 1, referralsSent: 0, referralsReceived: 0, casesClosed: 0 }); expect(r.body.withheldCapabilities).toEqual([]);
    const t = await stats.teamStats({ userId: U.id, structureId: S, role: 'STRUCTURE_ADMIN' });
    expect(t.global.casesUnassigned).toBe(1); expect(t.members[0].openCases).toBe(0); expect(t.withheldCapabilities).toEqual([]);
    const c = await stats.reportCsv({ userId: U.id, structureId: S, role: 'STRUCTURE_ADMIN' }, 'month');
    expect(c.csv).toMatch(/\r\ndossiers_ouverts,1\r\n/); expect(c.csv).not.toMatch(/fonctions_non_ouvertes/);
  });

  it('production behaviour (capabilities closed): same keys, null values, closed capabilities named; the report still answers', async () => {
    process.env.ADA_CAPABILITY_ENFORCEMENT = '1';
    const r = await get(reports, '/api/pro/reports?period=month');
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(r.body.kpis).toMatchObject({ diagnosticsShared: null, referralsSent: null, referralsReceived: null, casesClosed: null, casesClosedPartial: false });
    expect(Object.keys(r.body.kpis)).toEqual(expect.arrayContaining(['totalAppointments', 'teamSize', 'diagnosticsShared', 'referralsSent', 'casesClosed']));
    expect(r.body.caseOutcomes).toEqual([]);
    expect(r.body.withheldCapabilities).toEqual(['pro.case_management', 'pro.referrals', 'citizen.shared_dossier']);
    expect(r.body.kpis.teamSize).toBe(1);   // in-AIPD figures unchanged
    const t = await stats.teamStats({ userId: U.id, structureId: S, role: 'STRUCTURE_ADMIN' });
    expect(t.global.casesUnassigned).toBeNull(); expect(t.members[0].openCases).toBeNull(); expect(t.members[0]).toHaveProperty('appointmentsCount', 0);
    const c = await stats.reportCsv({ userId: U.id, structureId: S, role: 'STRUCTURE_ADMIN' }, 'month');
    expect(c.csv).toMatch(/\r\ndossiers_ouverts,\r\n/); expect(c.csv).toMatch(/\r\norientations_envoyees,\r\n/); expect(c.csv).toMatch(/\r\nfonctions_non_ouvertes,pro\.case_management pro\.referrals citizen\.shared_dossier\r\n/);
    const csvRes = await get(reports, '/api/pro/reports?period=month&format=csv');
    expect(csvRes.statusCode).toBe(200); expect(String(csvRes.body)).toMatch(/fonctions_non_ouvertes/);
  });

  it('one capability opened (non-HDS needs only the list; HDS ones stay closed without a token): only its counters come back', async () => {
    process.env.ADA_CAPABILITY_ENFORCEMENT = '1'; process.env.ADA_CAPABILITIES_OPEN = 'pro.case_management';
    const r = await get(reports, '/api/pro/reports?period=month');
    expect(r.body.withheldCapabilities, 'pro.case_management requires HDS: a listed name alone does not open it').toEqual(['pro.case_management', 'pro.referrals', 'citizen.shared_dossier']);
    process.env.ADA_HDS_CERTIFIED_HOSTING = `HDS1:example-host:CERT-2026-0001:2099-12-31:${'b'.repeat(64)}`;
    try {
      const o = await get(reports, '/api/pro/reports?period=month');
      expect(o.body.withheldCapabilities).toEqual(['pro.referrals', 'citizen.shared_dossier']); expect(o.body.kpis.casesClosed).toBe(0); expect(o.body.kpis.referralsSent).toBeNull();
    } finally { delete process.env.ADA_HDS_CERTIFIED_HOSTING; }
  });
});
