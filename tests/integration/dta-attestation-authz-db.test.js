/**
 * DTA S1D — GET /api/pro/attestation-data authorization on REAL PostgreSQL with real pro JWTs (the defect of native run 20261017T234555Z-9b18da).
 * Contract: unknown dossier / no grant / revoked grant / wrong organization / inactive member / suspended organization => uniform 404 (identical body);
 * granted organization on an EXPIRED dossier => 410 (RC5); anonymous => 401; valid active grant => 200 with ONLY its own follow-up (never another organization's notes,
 * `_files`, `_consent`, legacy amounts); successful attestations are audited (identifiers only); no read mutates the stored row.
 * Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise.  Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ids = (n) => `att-${n}-${TS}`;
const ORG = { A: ids('sA'), B: ids('sB'), C: ids('sC'), D: ids('sD'), E: ids('sE'), F: ids('sF'), G: ids('sG') };   // A granted, B no grant, C revoked, D inactive member, E suspended org, F granted too, G unrelated
const USER = Object.fromEntries(Object.keys(ORG).map((k) => [k, { id: ids('u' + k), email: `u${k}-${TS}@example.test` }]));
const SHARE = ids('share'), OLD = ids('old'), EXP = ids('exp');
const NOTE_A = `note-of-A-${TS}`, NOTE_F = `note-of-F-${TS}`, AMOUNT = '98765.4321';
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('attestation-data authorization (real DB)', () => {
  let db, schema, auth, handler;
  const tok = (k) => auth.signProToken({ id: USER[k].id, email: USER[k].email, structureId: ORG[k], role: 'STRUCTURE_ADMIN' });
  const call = async (shareId, k) => { const r = mk(); await handler({ method: 'GET', url: `/api/pro/attestation-data?shareId=${shareId}`, query: {}, headers: { host: 'localhost:3000', ...(k ? { authorization: `Bearer ${tok(k)}` } : {}) } }, r); return r; };
  const rowHash = async (id) => (await db.execute(sql`SELECT md5(t::text) AS h FROM "SharedDiagnostic" t WHERE id = ${id}`)).rows[0]?.h;
  const auditFor = async (id) => (await db.execute(sql`SELECT action, actor_id, details::text AS d FROM "AuditLog" WHERE details->>'shareId' = ${id} AND action = 'ATTESTATION_VIEWED'`)).rows;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    auth = await import('../../api/_utils/auth.js');
    ({ default: handler } = await import('../../api/_handlers/pro/attestation-data.js'));
    for (const [k, sid] of Object.entries(ORG)) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt")
        VALUES (${sid}, ${'Att ' + k}, ${'att-slug-' + k + '-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], ${k === 'E' ? 'suspendu' : 'actif'}, NOW(), NOW())`);
      await db.insert(schema.ProUser).values({ id: USER[k].id, email: USER[k].email, password_hash: 'x', structureId: sid, role: 'STRUCTURE_ADMIN', status: k === 'D' ? 'inactive' : 'active' });
    }
    const results = { assessment: { items: [{ code: 'rsa', state: 'CHECK_REQUIRED' }] }, period: '2026-09', _followUps: { [ORG.A]: { internalNote: NOTE_A, status: 'a' }, [ORG.F]: { internalNote: NOTE_F, status: 'f' } }, _files: [{ id: 'f1', structureId: ORG.F }], _consent: { sig: 'sig-secret' } };
    await db.insert(schema.SharedDiagnostic).values({ id: SHARE, expiresAt: new Date(Date.now() + 86400000), situation: {}, results, viewCount: 0 });
    await db.insert(schema.SharedDiagnostic).values({ id: OLD, expiresAt: new Date(Date.now() + 86400000), situation: {}, results: { rights: [{ code: 'rsa', eligible: true, amount: Number(AMOUNT) }], totalMonthly: Number(AMOUNT), period: '2026-09' }, viewCount: 0 });
    await db.insert(schema.SharedDiagnostic).values({ id: EXP, expiresAt: new Date(Date.now() - 3600000), situation: {}, results, viewCount: 0 });
    const grant = (sd, k, extra = {}) => ({ sharedDiagnosticId: sd, structureId: ORG[k], grantedByProUserId: USER[k].id, ...extra });
    await db.insert(schema.SharedDossierGrant).values([
      grant(SHARE, 'A'), grant(SHARE, 'F'), grant(SHARE, 'C', { revokedAt: new Date() }), grant(SHARE, 'D'), grant(SHARE, 'E'),   // D inactive member, E suspended organization: grants exist, access must still be refused
      grant(OLD, 'A'), grant(EXP, 'A'),
    ]);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'shareId' IN (${SHARE}, ${OLD}, ${EXP})`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${SHARE}, ${OLD}, ${EXP})`);
    for (const u of Object.values(USER)) await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${u.id}`);
    for (const s of Object.values(ORG)) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${s}`);
  });

  it('anonymous => 401; a granted active organization => 200 with its OWN follow-up only (no other organization\'s note, no files, no consent, no `_followUps` key)', async () => {
    expect((await call(SHARE, null)).statusCode).toBe(401);
    const before = await rowHash(SHARE);
    const a = await call(SHARE, 'A'); const f = await call(SHARE, 'F');
    expect(a.statusCode).toBe(200); expect(f.statusCode).toBe(200);
    expect(a.body.attestation.results.assessment.items[0].code).toBe('rsa');
    expect(a.body.attestation.results._followUp.internalNote).toBe(NOTE_A);
    expect(f.body.attestation.results._followUp.internalNote).toBe(NOTE_F);
    for (const [r, other] of [[a, NOTE_F], [f, NOTE_A]]) {
      const text = JSON.stringify(r.body);
      expect(text).not.toContain(other); expect(text).not.toContain('sig-secret'); expect(text).not.toContain('_followUps'); expect(text).not.toContain('_consent');
      expect(r.body.attestation.results._files ?? []).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'f1', structureId: ORG.A })]));
      expect(r.body.attestation.certHash).toMatch(/^[0-9A-F]{12}$/); expect(r.body.attestation.professional.structure).toBeDefined();
    }
    expect(await rowHash(SHARE)).toBe(before);
  });

  it('no grant, revoked grant, inactive member, suspended organization and an unknown dossier are ONE indistinguishable 404 with no data', async () => {
    const unknown = await call(`nope-${TS}`, 'A');
    expect(unknown.statusCode).toBe(404);
    for (const k of ['B', 'C', 'D', 'E', 'G']) {
      const r = await call(SHARE, k);
      expect(r.statusCode, `organization ${k}`).toBe(404);
      expect(r.body, `organization ${k} body identical to an unknown dossier`).toEqual(unknown.body);
      expect(JSON.stringify(r.body)).not.toMatch(/results|attestation|certHash|usagerToken|note-of|assessment/);
    }
  });

  it('a revocation takes effect immediately: the same organization is 200 before and 404 after', async () => {
    expect((await call(SHARE, 'F')).statusCode).toBe(200);
    await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NOW() WHERE "sharedDiagnosticId" = ${SHARE} AND "structureId" = ${ORG.F}`);
    expect((await call(SHARE, 'F')).statusCode).toBe(404);
    await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NULL WHERE "sharedDiagnosticId" = ${SHARE} AND "structureId" = ${ORG.F}`);
  });

  it('an EXPIRED dossier: granted organization => 410 (RC5 contract), ungranted => 404, no data either way', async () => {
    const granted = await call(EXP, 'A'); const ungranted = await call(EXP, 'B');
    expect(granted.statusCode).toBe(410); expect(ungranted.statusCode).toBe(404);
    expect(JSON.stringify([granted.body, ungranted.body])).not.toMatch(/note-of|results|attestation/);
  });

  it('a legacy-shaped row is served to its granted organization without eligibility, amount or total, and an ungranted organization gets 404; the row is never rewritten', async () => {
    const before = await rowHash(OLD);
    const a = await call(OLD, 'A'); const b = await call(OLD, 'B');
    expect(a.statusCode).toBe(200); expect(b.statusCode).toBe(404);
    const text = JSON.stringify(a.body);
    expect(text).not.toContain('98765'); expect(text).not.toMatch(/"eligible"|"totalMonthly"|"rights"/);
    expect(a.body.attestation.results.legacyRightsOmitted).toBe(true);
    expect(await rowHash(OLD)).toBe(before);
  });

  it('successful attestations are audited with identifiers only; denied ones leave no attestation audit record', async () => {
    const rows = await auditFor(SHARE);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) { expect([USER.A.id, USER.F.id]).toContain(r.actor_id); expect(r.d).not.toMatch(/note-of|sig-secret|98765|assessment/); expect(JSON.parse(r.d).shareId).toBe(SHARE); }
    expect((await auditFor(OLD)).length).toBeGreaterThanOrEqual(1);
    // NB drizzle renders `ANY(${array})` as ANY(($1, $2, ...)) (a row constructor: invalid in PostgreSQL; native run ffcb44) — an explicit IN list is used
    const denied = sql.join([USER.B.id, USER.C.id, USER.D.id, USER.E.id, USER.G.id].map((i) => sql`${i}`), sql`, `);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'ATTESTATION_VIEWED' AND actor_id IN (${denied})`)).rows[0].n).toBe(0);
  });
});
