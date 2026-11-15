/**
 * Pro / Structure privacy and operations fixes (RECON_PRO_STRUCTURE_TERRITORY 2026-11-15), on REAL PostgreSQL through the real handlers.
 * Synthetic organizations A (admin, pro1, pro2) and B (pro). Synthetic data only; the mailer is the in-memory 'test' provider. Skipped without DATABASE_URL.
 *   A04  one follow-up status (the case status); no note in clear in the dossier JSON; a legacy note moves to the protected case notes
 *   A13  a SIAO hand-over sheet prepared by a professional appears in the person's access log
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));   // KV-backed quota = infrastructure, not under test here (tests/unit/pb-pro-rate-limits.test.js)
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S = { A: `pb-A-${TS}`, B: `pb-B-${TS}` };
const P = { admin: { id: `pb-adm-${TS}`, st: S.A, role: 'STRUCTURE_ADMIN' }, pro1: { id: `pb-p1-${TS}`, st: S.A, role: 'PRO' }, pro2: { id: `pb-p2-${TS}`, st: S.A, role: 'PRO' }, b: { id: `pb-b-${TS}`, st: S.B, role: 'PRO' } };
const CIT = { id: `pb-cit-${TS}`, email: `pb-cit-${TS}@example.test` };
const DOS = `pb-dos-${TS}`; const DOS2 = `pb-dos2-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, getHeader(k) { return this.headers[String(k).toLowerCase()]; }, end() { return this; } });

describe.skipIf(!hasDatabase)('Pro / Structure privacy and operations fixes (real DB)', () => {
  let db, auth, userAuth; const H = {};
  const tok = (p) => auth.signProToken({ id: p.id, email: `${p.id}@example.test`, structureId: p.st, role: p.role });
  const pro = async (h, p, { method = 'GET', query = {}, body, url = '/api/pro/x' } = {}) => { const r = mk(); await h({ method, url, query, body, headers: { host: 'localhost', authorization: `Bearer ${tok(p)}` } }, r); return r; };
  const cit = async (h, { method = 'GET', query = {}, body } = {}) => { const r = mk(); const c = userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0];
    await h({ method, url: '/api/x', query, body, headers: { host: 'localhost', cookie: c } }, r); return r; };
  const one = async (q) => (await db.execute(q)).rows[0];
  const dossier = (p, id = DOS, extra = {}) => pro(H.dossier, p, { url: `/api/pro/dossier?shareId=${id}`, query: { shareId: id }, ...extra });

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    H.dossier = (await import('../../api/_handlers/pro/dossier.js')).default; H.cases = (await import('../../api/_handlers/pro/cases.js')).default;
    H.siao = (await import('../../api/_handlers/pro/interop-siao.js')).default; H.citDossier = (await import('../../api/_handlers/citizen/dossier.js')).default;
    for (const id of Object.values(S)) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, is_pro_enabled, "updatedAt", "createdAt")
      VALUES (${id}, ${'Org ' + id}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', true, NOW(), NOW())`);
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, false, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    for (const [d, k] of [[DOS, 1], [DOS2, 2]]) await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId")
      VALUES (${d}, NOW() + interval '30 days', '{"zipCode":"67000"}'::jsonb, '{}'::jsonb, 0, ${'h' + k + TS}, ${'t' + k + TS}, 'GUEST_SHARE', ${CIT.id})`);
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia", purposes) VALUES (${'pbgA-' + TS}, ${DOS}, ${S.A}, ${P.pro1.id}, 'invite', 'PURP-06,PURP-07'),
      (${'pbgB-' + TS}, ${DOS}, ${S.B}, ${P.b.id}, 'invite', 'PURP-06'), (${'pbgA2-' + TS}, ${DOS2}, ${S.A}, ${P.pro1.id}, 'invite', 'PURP-06')`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    const L = sql.join(Object.values(S).map((i) => sql`${i}`), sql`, `);
    for (const q of [sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${DOS}, ${DOS2})`, sql`DELETE FROM "ProTimeOff" WHERE "structureId" IN (${L})`, sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" IN (${L})`,
      sql`DELETE FROM "ProAppointment" WHERE "structureId" IN (${L})`, sql`DELETE FROM "ProRdvService" WHERE "structureId" IN (${L})`, sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" IN (${L})`,
      sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${L})`, sql`DELETE FROM "ProUser" WHERE "structureId" IN (${L})`, sql`DELETE FROM "Structure" WHERE id IN (${L})`,
      sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`]) await db.execute(q).catch(() => {});
  });

  describe('A04 — one follow-up status, no note in clear in the dossier', () => {
    const patch = (p, body, id = DOS) => dossier(p, id, { method: 'PATCH', body });
    it('the dossier page sets the CASE status (history kept, the person reads the same value); a free label is refused', async () => {
      const before = await dossier(P.pro1);
      expect(before.body.followUp).toEqual({ available: true, caseId: null, status: null });
      for (const label of ['Dossier validé', 'À traiter', 'CLOSED', '']) expect((await patch(P.pro1, { status: label })).statusCode, label).toBe(400);
      const out = await patch(P.pro1, { status: 'WAITING_CITIZEN' });
      expect([out.statusCode, out.body.status]).toEqual([200, 'WAITING_CITIZEN']);
      const c = await one(sql`SELECT id, status FROM "ProCase" WHERE "sharedDiagnosticId" = ${DOS} AND "structureId" = ${S.A}`);
      expect(c).toEqual({ id: out.body.caseId, status: 'WAITING_CITIZEN' });
      expect((await db.execute(sql`SELECT kind, "fromValue", "toValue" FROM "ProCaseEvent" WHERE "caseId" = ${c.id} AND kind = 'STATUS'`)).rows).toEqual([{ kind: 'STATUS', fromValue: 'NEW', toValue: 'WAITING_CITIZEN' }]);
      expect((await dossier(P.pro1)).body.followUp).toEqual({ available: true, caseId: c.id, status: 'WAITING_CITIZEN' });
      // the same value on the case page, and nothing written into the person's dossier JSON
      expect((await pro(H.cases, P.pro1, { query: { id: c.id } })).body.case.status).toBe('WAITING_CITIZEN');
      expect((await one(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${DOS}`)).results).toEqual({});
      // another organization holding its own grant keeps its own case: nothing of A's
      expect((await dossier(P.b)).body.followUp).toEqual({ available: true, caseId: null, status: null });
    });
    it('an internal note is refused on this route and never stored; an organization without a grant gets 404', async () => {
      const refused = await patch(P.pro1, { status: 'IN_PROGRESS', internalNote: 'NOTE-EN-CLAIR-QA' });
      expect([refused.statusCode, refused.body.error]).toEqual([400, 'INTERNAL_NOTE_NOT_ACCEPTED']);
      expect(JSON.stringify((await one(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${DOS}`)).results)).not.toContain('NOTE-EN-CLAIR-QA');
      expect((await one(sql`SELECT status FROM "ProCase" WHERE "sharedDiagnosticId" = ${DOS} AND "structureId" = ${S.A}`)).status).toBe('WAITING_CITIZEN');   // refused as a whole
      expect((await patch(P.b, { status: 'IN_PROGRESS' }, DOS2)).statusCode).toBe(404);
    });
    it('a legacy entry (free label + note in clear) is retired at the next status change: the note becomes a protected internal case note, the other organization’s entry is untouched', async () => {
      await db.execute(sql`UPDATE "SharedDiagnostic" SET results = ${JSON.stringify({ _followUps: { [S.A]: { status: 'Dossier validé', internalNote: 'LEGACY-NOTE-A' }, [S.B]: { status: 'x', internalNote: 'LEGACY-NOTE-B' } } })}::jsonb WHERE id = ${DOS2}`);
      const out = await patch(P.pro1, { status: 'IN_PROGRESS' }, DOS2);
      expect(out.statusCode, JSON.stringify(out.body)).toBe(200);
      const results = (await one(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${DOS2}`)).results;
      expect(results._followUps).toEqual({ [S.B]: { status: 'x', internalNote: 'LEGACY-NOTE-B' } });
      const note = await one(sql`SELECT visibility, "bodyEncrypted" AS b FROM "ProCaseNote" WHERE "caseId" = ${out.body.caseId}`);
      expect(note.visibility).toBe('INTERNAL'); expect(note.b).not.toContain('LEGACY-NOTE-A');   // sealed at rest
      const page = await pro(H.cases, P.pro1, { query: { id: out.body.caseId } });
      expect(page.body.notes.map((n) => [n.visibility, n.body])).toEqual([['INTERNAL', '[Note reprise de l’ancien suivi du dossier]\nLEGACY-NOTE-A']]);
    });
    it('a closed follow-up is not changed from the dossier page (409)', async () => {
      const c = await one(sql`SELECT id FROM "ProCase" WHERE "sharedDiagnosticId" = ${DOS} AND "structureId" = ${S.A}`);
      expect((await pro(H.cases, P.pro1, { method: 'POST', body: { action: 'close', id: c.id, outcome: 'INFORMATION_PROVIDED', citizenSummary: 'Information donnée.' } })).statusCode).toBe(200);
      const out = await patch(P.pro1, { status: 'IN_PROGRESS' });
      expect([out.statusCode, out.body.error]).toEqual([409, 'CASE_CLOSED']);
      expect((await dossier(P.pro1)).body.followUp.status).toBe('CLOSED');
      expect((await pro(H.cases, P.pro1, { method: 'POST', body: { action: 'reopen', id: c.id } })).statusCode).toBe(200);
    });
  });

  describe('A13 — the SIAO hand-over is visible to the person', () => {
    const log = async (id = DOS) => (await cit(H.citDossier, { query: { view: 'access', shareId: id } })).body.events.filter((e) => e.action === 'SIAO_HANDOVER_PREPARED');
    it('a sheet prepared with the person’s SIAO consent is listed in her access log, by organisation; a hand-over logged before the fix (no shareId) too', async () => {
      expect(await log()).toEqual([]);
      const out = await pro(H.siao, P.pro1, { method: 'POST', body: { shareId: DOS }, url: '/api/pro/interop-siao' });
      expect(out.statusCode, JSON.stringify(out.body)).toBe(200);
      const events = await log();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: 'SIAO_HANDOVER_PREPARED', organization: `Org ${S.A}`, label: 'a préparé une fiche de transmission au SIAO (rien n’est envoyé par AccèsDirectAide)' });
      expect(JSON.stringify(events[0])).not.toContain(P.pro1.id);   // by organisation: no staff identifier
      // organisation B has no SIAO purpose: refused, nothing logged
      expect((await pro(H.siao, P.b, { method: 'POST', body: { shareId: DOS }, url: '/api/pro/interop-siao' })).statusCode).toBe(403);
      expect(await log()).toHaveLength(1);
      // a row written before the fix (dossier id only in entity_id) is shown as well; another dossier's log stays empty
      await db.execute(sql`INSERT INTO "AuditLog" (id, action, entity, entity_id, actor_id, details, ip_hash) VALUES (${'pb-siao-old-' + TS}, 'SIAO_HANDOVER_PREPARED', 'DIAGNOSTIC', ${DOS}, ${P.pro1.id}, ${JSON.stringify({ structureId: S.A, purpose: 'PURP-07' })}::jsonb, 'SYSTEM_GATEWAY')`);
      expect(await log()).toHaveLength(2);
      expect(await log(DOS2)).toEqual([]);
    });
  });
});
