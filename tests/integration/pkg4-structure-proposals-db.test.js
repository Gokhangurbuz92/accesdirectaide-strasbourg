/**
 * PKG-4 / E02 E05 E08 R19 on REAL PostgreSQL (migration 0023), through the real handlers, with two synthetic organizations A and B:
 *   - a structure administrator PROPOSES profile changes; nothing reaches the Structure row until an ADA reviewer with an MFA admin session accepts (D-5)
 *   - a PRO member reads but cannot propose; another organization can neither read, withdraw nor see A's proposals (IDOR); values are validated
 *   - one pending proposal per field (a newer one withdraws the older; database partial unique index); rejection needs a reason visible to the structure
 *   - admin without MFA, legacy/pro tokens cannot decide; the organization export contains no citizen dossier content
 *   - impact report: no invented estimate, no platform-wide counts, small outcome cells suppressed
 * Synthetic data only. Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../api/lib/search-cache.js', () => ({ bumpContentEpoch: vi.fn().mockResolvedValue({ bumped: false }) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S = { A: `p4s-A-${TS}`, B: `p4s-B-${TS}` };
const P = { admin: { id: `p4s-adm-${TS}`, st: S.A, role: 'STRUCTURE_ADMIN' }, pro: { id: `p4s-pro-${TS}`, st: S.A, role: 'PRO' }, bAdmin: { id: `p4s-badm-${TS}`, st: S.B, role: 'STRUCTURE_ADMIN' } };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('PKG-4 Espace Structure profile proposals (real DB)', () => {
  let db, auth, H;
  const tok = (p) => auth.signProToken({ id: p.id, email: `${p.id}@example.test`, structureId: p.st, role: p.role });
  const call = async (h, token, { method = 'GET', query = {}, body } = {}) => { const r = mk(); await h({ method, url: '/api/x', query, body, headers: { host: 'localhost', authorization: `Bearer ${token}` } }, r); return r; };
  const struct = (p, opts) => call(H.structure, tok(p), opts);
  const propose = (p, field, value) => struct(p, { method: 'POST', body: { action: 'propose', field, value } });
  const adminTok = (mfa) => auth.signAdminSessionToken({ email: 'reviewer@example.test', role: 'admin', mfa_verified: mfa });
  const review = (token, body) => call(H.review, token, body ? { method: 'POST', body } : {});
  const row = async (id) => (await db.execute(sql`SELECT horaires, telephone, insee_codes, accessibilite_pmr, "updatedBy", territory_verified, verification_status, publication_hold, date_verification FROM "Structure" WHERE id = ${id}`)).rows[0];

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js');
    H = { structure: (await import('../../api/_handlers/pro/structure.js')).default, review: (await import('../../api/_handlers/admin/structure-proposals.js')).default,
      reports: (await import('../../api/_handlers/pro/reports.js')).default };
    for (const id of [S.A, S.B]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, horaires, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${id}, ${'Org ' + id.split('-')[1]}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', 'Lundi 9h-12h', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    }
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, false, NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" IN (${S.A}, ${S.B})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${S.A}, ${S.B})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${S.A}, ${S.B})`);   // cascades StructureProposal
  });

  let hoursId;
  it('an administrator proposes; nothing is published before review; a PRO member reads but cannot propose; values are validated', async () => {
    const out = await propose(P.admin, 'horaires', 'Lundi-vendredi 9h-17h');
    expect(out.statusCode, JSON.stringify(out.body)).toBe(201); hoursId = out.body.proposal.id;
    expect(out.body.proposal).toMatchObject({ status: 'PENDING', previousValue: 'Lundi 9h-12h' });
    expect((await row(S.A)).horaires, 'D-5: not published by the proposal').toBe('Lundi 9h-12h');
    const asPro = await struct(P.pro);
    expect(asPro.statusCode).toBe(200); expect(asPro.body.canPropose).toBe(false); expect(asPro.body.proposals.map((p) => p.id)).toContain(hoursId);
    expect((await propose(P.pro, 'telephone', '03 88 00 00 00')).statusCode).toBe(403);
    expect((await propose(P.admin, 'telephone', 'call me maybe')).body.error).toBe('invalid_value');
    expect((await propose(P.admin, 'site_web', 'http://insecure.example')).body.error).toBe('invalid_value');
    expect((await propose(P.admin, 'service_area', '67482, 999')).body.error).toBe('invalid_value');
    expect((await propose(P.admin, 'nom', 'Autre nom')).body.error, 'name / verification fields are not proposable').toBe('invalid_field');
    expect((await propose(P.admin, 'verification_status', 'VERIFIED')).body.error).toBe('invalid_field');
    expect((await propose(P.admin, 'horaires', 'Lundi 9h-12h')).body.error).toBe('unchanged');
  });

  it('another organization sees nothing of A and cannot withdraw its proposals (IDOR)', async () => {
    const b = await struct(P.bAdmin);
    expect(b.statusCode).toBe(200); expect(b.body.structure.nom).toBe('Org B'); expect(b.body.proposals.map((p) => p.id)).not.toContain(hoursId);
    expect((await struct(P.bAdmin, { method: 'POST', body: { action: 'withdraw', id: hoursId } })).statusCode).toBe(404);
    expect((await struct(P.pro, { method: 'POST', body: { action: 'withdraw', id: hoursId } })).statusCode, 'PRO cannot withdraw').toBe(403);
  });

  it('one pending proposal per field: a newer proposal withdraws the older; the database refuses two pending', async () => {
    const newer = await propose(P.admin, 'horaires', 'Lundi-samedi 9h-18h');
    expect(newer.statusCode).toBe(201);
    const statuses = Object.fromEntries((await struct(P.admin)).body.proposals.map((p) => [p.id, p.status]));
    expect(statuses[hoursId]).toBe('WITHDRAWN'); expect(statuses[newer.body.proposal.id]).toBe('PENDING');
    hoursId = newer.body.proposal.id;
    await expect(db.execute(sql`INSERT INTO "StructureProposal" (id, "structureId", field, "proposedValue") VALUES (${'dup-' + TS}, ${S.A}, 'horaires', 'x')`)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO "StructureProposal" (id, "structureId", field, "proposedValue") VALUES (${'bad-' + TS}, ${S.A}, 'verification_status', 'x')`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE "StructureProposal" SET status = 'ACCEPTED' WHERE id = ${hoursId}`), 'accepted needs reviewer + time').rejects.toThrow();
  });

  it('review: only a named admin session with MFA decides; accept publishes; reject needs a reason; a decision is final', async () => {
    const proTry = await review(tok(P.admin), { id: hoursId, decision: 'ACCEPT' });
    expect(proTry.statusCode, 'a structure token is not an ADA reviewer').toBe(401);
    expect((await review(adminTok(false), { id: hoursId, decision: 'ACCEPT' })).statusCode, 'no MFA, no decision').toBe(403);
    const queue = await review(adminTok(false));
    expect(queue.statusCode).toBe(200); expect(queue.body.proposals.find((p) => p.id === hoursId)).toMatchObject({ structureNom: 'Org A', field: 'horaires' });
    expect((await review(adminTok(true), { id: hoursId, decision: 'ACCEPT' })).body.error, 'D-5: no acceptance without an official source').toBe('source_required');
    expect((await review(adminTok(true), { id: hoursId, decision: 'ACCEPT', sourceUrl: 'https://example.com/horaires' })).body.error, 'not an allowed official domain').toBe('source_required');
    const ok = await review(adminTok(true), { id: hoursId, decision: 'ACCEPT', sourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F1' });
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200);
    expect(await row(S.A)).toMatchObject({ horaires: 'Lundi-samedi 9h-18h', updatedBy: 'reviewer@example.test' });
    expect((await review(adminTok(true), { id: hoursId, decision: 'REJECT', note: 'x' })).statusCode, 'already decided').toBe(404);

    const area = await propose(P.admin, 'service_area', '67482 67218,67482');
    expect(area.body.proposal.proposedValue).toBe('67218,67482');
    const pmr = await propose(P.admin, 'accessibilite_pmr', 'true');
    expect((await review(adminTok(true), { id: pmr.body.proposal.id, decision: 'REJECT' })).body.error).toBe('note_required');
    expect((await review(adminTok(true), { id: pmr.body.proposal.id, decision: 'REJECT', note: 'Entrée avec marche, non conforme.' })).statusCode).toBe(200);
    await db.execute(sql`UPDATE "Structure" SET territory_verified = true WHERE id = ${S.A}`);
    const before = await row(S.A);
    expect((await review(adminTok(true), { id: area.body.proposal.id, decision: 'ACCEPT', sourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F1' })).statusCode).toBe(200);
    const r = await row(S.A); expect(r.accessibilite_pmr).toBe(false); expect([...r.insee_codes].sort()).toEqual(['67218', '67482']);
    expect(r.territory_verified, 'D-5: a geography change without territory confirmation withdraws the territorial verification').toBe(false);
    expect([r.verification_status, r.publication_hold, String(r.date_verification)], 'a review never renews verification nor lifts a hold').toEqual([before.verification_status, before.publication_hold, String(before.date_verification)]);
    const seen = (await struct(P.admin)).body.proposals.find((p) => p.id === pmr.body.proposal.id);
    expect(seen).toMatchObject({ status: 'REJECTED', reviewNote: 'Entrée avec marche, non conforme.' });
    expect(JSON.stringify(seen)).not.toContain('reviewer@example.test');   // the reviewer's identity stays internal to ADA
  });

  it('organization export (administrators only): own records, no secrets, no citizen dossier content', async () => {
    expect((await struct(P.pro, { query: { export: '1' } })).statusCode).toBe(403);
    const ex = await struct(P.admin, { query: { export: '1' } });
    expect(ex.statusCode).toBe(200); expect(ex.headers['Content-Disposition']).toMatch(/attachment/);
    const txt = JSON.stringify(ex.body);
    expect(ex.body.export.team.map((m) => m.email).sort()).toEqual([`${P.admin.id}@example.test`, `${P.pro.id}@example.test`]);
    expect(txt).not.toMatch(/password|mfa_secret|Org B|situation|ownerCitizenId/);
  });

  it('impact report (D7): no invented estimate, no platform-wide count, scoped closed-loop figures', async () => {
    const rep = await call(H.reports, tok(P.admin), { query: { period: 'month' } });
    expect(rep.statusCode, JSON.stringify(rep.body)).toBe(200);
    expect(rep.body.kpis).not.toHaveProperty('avoidedNoShows'); expect(rep.body.kpis).not.toHaveProperty('compassSessions');
    expect(rep.body.kpis).toMatchObject({ referralsSent: 0, referralsReceived: 0, casesClosed: 0 });
    expect(rep.body.kAnonymityMin).toBe(5); expect(rep.body.caseOutcomes).toEqual([]);
  });
});
