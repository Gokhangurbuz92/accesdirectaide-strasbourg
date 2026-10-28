/**
 * PKG-11 / E08 — closure of an organization's space and erasure of its own data, on REAL PostgreSQL THROUGH THE REAL API ENTRY (synthetic organizations A, B, C).
 *  - only the organization's administrator asks (reason required, one open request); ADA can open one itself; the request is never a person's erasure;
 *  - two people decide (the proposer cannot confirm; the confirmation is bound to the proposal read); a legal hold on the organization blocks the execution;
 *  - execution: dossier accesses / invitations revoked (the person keeps the dossier), AI drafts forgotten, internal notes / notifications / pending member invitations
 *    erased, members anonymized and every session refused, open cases closed, referrals handled (a referral B accepted stays with B), future appointments cancelled with
 *    a notice to the person, booking unpublished, services off, proposals withdrawn; kept: citizen-visible notes, the audit trails, the other organization's records,
 *    the public directory record;
 *  - a rejection is told to the organization with its reason.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S = { A: `e08-A-${TS}`, B: `e08-B-${TS}`, C: `e08-C-${TS}` };
const P = { admin: { id: `e08-adm-${TS}`, st: S.A, role: 'STRUCTURE_ADMIN' }, pro: { id: `e08-pro-${TS}`, st: S.A, role: 'PRO' }, b: { id: `e08-b-${TS}`, st: S.B, role: 'PRO' }, c: { id: `e08-c-${TS}`, st: S.C, role: 'STRUCTURE_ADMIN' } };
const ADM = [`e08-r1-${TS}@example.test`, `e08-r2-${TS}@example.test`];
const CIT = { id: `e08-cit-${TS}`, email: `e08-cit-${TS}@example.test` };
const DOS = `e08-dos-${TS}`; const DOS2 = `e08-dos2-${TS}`; const DOS3 = `e08-dos3-${TS}`; const CASE = `e08-case-${TS}`; const SVC = `e08-svc-${TS}`;
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('PKG-11 / E08 organization closure through the real API entry (real DB)', () => {
  let db, api, auth; let reqId; let proposedAt; const proTok = {};
  const call = async (method, url, { bearer, body } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } };
    const res = mkRes(); await api(req, res); return res;
  };
  const admin = (i, mfa = true) => auth.signAdminSessionToken({ email: ADM[i], role: 'admin', mfa_verified: mfa });
  const pro = (p) => auth.signProToken({ id: p.id, email: `${p.id}@example.test`, structureId: p.st, role: p.role });
  const one = async (q) => Number((await db.execute(q)).rows[0]?.n || 0);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js');
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    for (const id of Object.values(S)) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, is_pro_enabled, "updatedAt", "createdAt")
      VALUES (${id}, ${'Org ' + id}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', true, NOW(), NOW())`);
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", mfa_enabled, mfa_secret, "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, true, true, 'secret-x', NOW())`);
    for (const p of Object.values(P)) proTok[p.id] = pro(p);
    await db.execute(sql`INSERT INTO "ProProfile" (id, "proUserId", "displayName", "jobTitle", "isPubliclyVisible", "updatedAt") VALUES (${'pp-' + TS}, ${P.pro.id}, 'Camille QA', 'Conseillère', true, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    for (const [d, k] of [[DOS, 1], [DOS2, 2], [DOS3, 3]]) await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId")
      VALUES (${d}, NOW() + interval '30 days', '{}'::jsonb, '{}'::jsonb, 0, ${'h' + k + TS}, ${'t' + k + TS}, 'GUEST_SHARE', ${CIT.id})`);
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia") VALUES (${'gA-' + TS}, ${DOS}, ${S.A}, ${P.pro.id}, 'invite'),
      (${'gB1-' + TS}, ${DOS}, ${S.B}, ${P.pro.id}, 'referral'), (${'gB2-' + TS}, ${DOS2}, ${S.B}, ${P.pro.id}, 'referral')`);
    await db.execute(sql`INSERT INTO "SharedDossierInvite" (id, "sharedDiagnosticId", "structureId", "tokenHash", "expiresAt") VALUES (${'iA-' + TS}, ${DOS}, ${S.A}, ${'th' + TS}, NOW() + interval '2 days')`).catch(() => {});
    await db.execute(sql`INSERT INTO "ProCase" (id, "sharedDiagnosticId", "structureId", status, "assigneeProUserId", "openedAt", "updatedAt") VALUES (${CASE}, ${DOS}, ${S.A}, 'IN_PROGRESS', ${P.pro.id}, NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProCaseNote" (id, "caseId", "structureId", "authorProUserId", visibility, "bodyEncrypted") VALUES (${'nI-' + TS}, ${CASE}, ${S.A}, ${P.pro.id}, 'INTERNAL', 'sealed-internal'), (${'nC-' + TS}, ${CASE}, ${S.A}, ${P.pro.id}, 'CITIZEN', 'sealed-citizen')`);
    const ref = (id, dos, from, to, status, grant, by = P.pro.id) => db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", "createdByProUserId", status, "reasonCode", "grantId", "citizenDecisionAt", "sentAt", "updatedAt")
      VALUES (${id}, ${dos}, ${from}, ${to}, ${by}, ${status}, 'HOUSING', ${grant}, ${status === 'DRAFT' ? null : new Date()}, ${status === 'DRAFT' ? null : new Date()}, NOW())`);
    await ref(`rAcc-${TS}`, DOS, S.A, S.B, 'ACCEPTED', `gB1-${TS}`); await ref(`rSent-${TS}`, DOS2, S.A, S.B, 'SENT', `gB2-${TS}`); await ref(`rDraft-${TS}`, DOS3, S.A, S.B, 'DRAFT', null);   // one live referral per (dossier, receiver)
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia") VALUES (${'gA2-' + TS}, ${DOS3}, ${S.A}, ${P.b.id}, 'referral')`);
    await ref(`rIn-${TS}`, DOS3, S.B, S.A, 'SENT', `gA2-${TS}`, P.b.id);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "isActive", "updatedAt") VALUES (${SVC}, ${S.A}, 'Accueil', 30, true, NOW())`);
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "contactEmail", "updatedAt") VALUES (${'rs-' + TS}, ${S.A}, true, 'accueil@example.test', NOW())`);
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "updatedAt") VALUES
      (${'apF-' + TS}, ${S.A}, ${SVC}, NOW() + interval '3 days', NOW() + interval '3 days 30 minutes', 'booked', 'Personne QA', ${CIT.id}, NOW()),
      (${'apP-' + TS}, ${S.A}, ${SVC}, NOW() - interval '3 days', NOW() - interval '3 days' + interval '30 minutes', 'booked', 'Personne QA', ${CIT.id}, NOW())`);
    await db.execute(sql`INSERT INTO "ProNotification" (id, "userId", "structureId", type, title, message) VALUES (${'pn-' + TS}, ${P.pro.id}, ${S.A}, 'case_mention', 't', 'm')`);
    await db.execute(sql`INSERT INTO "Invitation" (id, "structureId", email, role, token, expires_at) VALUES (${'inv-' + TS}, ${S.A}, ${'new-' + TS + '@example.test'}, 'PRO', ${'tok-' + TS}, NOW() + interval '2 days')`);
    await db.execute(sql`INSERT INTO "StructureProposal" (id, "structureId", field, "proposedValue", "proposedByProUserId", status) VALUES (${'sp-' + TS}, ${S.A}, 'horaires', 'Lundi 9h-12h', ${P.admin.id}, 'PENDING')`);
    await db.execute(sql`INSERT INTO "AiOutputReview" (id, kind, "entityType", "entityId", field, origin, "sourceTextHash", "outputText", status, "createdBy", "sharedDiagnosticId", "scopeStructureId")
      VALUES (${'ai-' + TS}, 'DOSSIER_SYNTHESIS', 'shared_diagnostic', ${DOS}, 'synthesis', 'AI_LOCAL', 'h', '["brouillon"]', 'PENDING', ${P.pro.id}, ${DOS}, ${S.A})`);
    await db.execute(sql`INSERT INTO "ProAuditLog" (id, "proUserId", "structureId", action, metadata) VALUES (${'pa-' + TS}, ${P.pro.id}, ${S.A}, 'QA_E08_TRACE', '{}'::jsonb)`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    const ids = Object.values(S);
    const L = sql.join(ids.map((i) => sql`${i}`), sql`, `);
    for (const q of [sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (${'apF-' + TS}, ${'apP-' + TS})`, sql`DELETE FROM "ProAppointment" WHERE "structureId" IN (${L})`,
      sql`DELETE FROM "ProRdvService" WHERE "structureId" IN (${L})`, sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" IN (${L})`, sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${DOS}, ${DOS2}, ${DOS3})`,
      sql`DELETE FROM "StructureProposal" WHERE "structureId" IN (${L})`, sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${L})`, sql`DELETE FROM "Invitation" WHERE "structureId" IN (${L})`,
      sql`DELETE FROM "ProAuditLog" WHERE "structureId" IN (${L})`, sql`DELETE FROM "ProProfile" WHERE "proUserId" IN (SELECT id FROM "ProUser" WHERE "structureId" IN (${L}))`,
      sql`DELETE FROM "ProUser" WHERE "structureId" IN (${L})`, sql`DELETE FROM "LegalHold" WHERE "recordId" IN (${L})`, sql`DELETE FROM "DSRRequest" WHERE "subjectId" IN (${L})`,
      sql`DELETE FROM "EntityVersion" WHERE entity_id IN (${L})`, sql`DELETE FROM "Structure" WHERE id IN (${L})`, sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`]) await db.execute(q).catch(() => {});
  });

  it('only the organization administrator asks, with a reason; one open request; the state is shown to the organization', async () => {
    expect((await call('POST', '/api/pro/structure', { bearer: proTok[P.pro.id], body: { action: 'request_closure', reason: 'Fin de notre activité ici.' } })).statusCode).toBe(403);
    expect((await call('POST', '/api/pro/structure', { bearer: proTok[P.admin.id], body: { action: 'request_closure', reason: 'court' } })).body.error).toBe('reason_required');
    const r = await call('POST', '/api/pro/structure', { bearer: proTok[P.admin.id], body: { action: 'request_closure', reason: 'Fin de notre activité sur AccèsDirectAide.' } });
    expect([r.statusCode, r.body.request.status]).toEqual([201, 'IN_REVIEW']); reqId = r.body.request.id;
    const again = await call('POST', '/api/pro/structure', { bearer: proTok[P.admin.id], body: { action: 'request_closure', reason: 'Fin de notre activité sur AccèsDirectAide.' } });
    expect([again.statusCode, again.body.request.id]).toEqual([200, reqId]);
    const st = await call('GET', '/api/pro/structure', { bearer: proTok[P.admin.id] });
    expect(st.body.closure).toMatchObject({ id: reqId, status: 'IN_REVIEW' });
    expect((await call('GET', '/api/pro/structure', { bearer: proTok[P.pro.id] })).body.closure).toBeUndefined();
    const row = (await db.execute(sql`SELECT "subjectType", "requestType" FROM "DSRRequest" WHERE id = ${reqId}`)).rows[0];
    expect(row).toEqual({ subjectType: 'ORGANIZATION', requestType: 'ORGANIZATION_CLOSURE' });
    expect((await call('GET', '/api/admin/dsr-erasure', { bearer: admin(0) })).body.requests.map((x) => x.id)).not.toContain(reqId);   // never a person's erasure
  });

  it('the review list needs an administrator; what it would touch needs MFA (counts only, audited)', async () => {
    expect((await call('GET', '/api/admin/org-closure')).statusCode).toBe(401);
    const l = await call('GET', '/api/admin/org-closure', { bearer: admin(0, false) });
    expect(l.body.requests.find((x) => x.id === reqId)).toMatchObject({ structureId: S.A, origin: 'ORGANIZATION', stage: 'AWAITING_PROPOSAL' });
    expect((await call('GET', `/api/admin/org-closure?id=${reqId}`, { bearer: admin(0, false) })).statusCode).toBe(403);
    const read = await call('GET', `/api/admin/org-closure?id=${reqId}`, { bearer: admin(0) });
    expect(read.body.summary).toEqual({ members: 2, activeDossierAccesses: 2, openCases: 1, internalNotes: 1, liveReferrals: 3, futureAppointments: 1, activeLegalHolds: 0 });
    expect(await one(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'ORGANIZATION_CLOSURE_REVIEW_READ' AND entity_id = ${reqId}`)).toBe(1);
  });

  it('two people decide: the proposer cannot confirm, a stale confirmation is refused, a legal hold blocks, the retry after release executes', async () => {
    const p = await call('POST', '/api/admin/org-closure', { bearer: admin(0), body: { id: reqId, decision: 'APPROVE' } });
    expect(p.statusCode).toBe(200);
    proposedAt = (await call('GET', '/api/admin/org-closure', { bearer: admin(1) })).body.requests.find((x) => x.id === reqId).proposedAt;
    expect((await call('POST', '/api/admin/org-closure', { bearer: admin(0), body: { id: reqId, action: 'confirm', proposedAt, note: 'Je confirme moi-même.' } })).body.error).toBe('second_reviewer_required');
    expect((await call('POST', '/api/admin/org-closure', { bearer: admin(1), body: { id: reqId, action: 'confirm', proposedAt: '2000-01-01T00:00:00.000Z', note: 'Relu, conforme.' } })).statusCode).toBe(409);
    expect((await call('POST', '/api/admin/org-closure', { bearer: admin(1, false), body: { id: reqId, action: 'confirm', proposedAt, note: 'Relu, conforme.' } })).statusCode).toBe(403);
    expect(await one(sql`SELECT count(*)::int AS n FROM "SharedDossierGrant" WHERE "structureId" = ${S.A} AND "revokedAt" IS NULL`)).toBe(2);   // nothing happened yet
    await db.execute(sql`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status) VALUES (${'lh-' + TS}, 'Structure', ${S.A}, 'QA_LITIGATION', 'qa', 'ACTIVE')`);
    // owner LAB audit: the second reviewer confirms only after their own (journalised) reading
    expect((await call('POST', '/api/admin/org-closure', { bearer: admin(1), body: { id: reqId, action: 'confirm', proposedAt, note: 'Relu, conforme à la demande.' } })).body.error, 'not read yet').toBe('read_required');
    expect((await call('GET', `/api/admin/org-closure?id=${reqId}`, { bearer: admin(1) })).statusCode).toBe(200);
    const blocked = await call('POST', '/api/admin/org-closure', { bearer: admin(1), body: { id: reqId, action: 'confirm', proposedAt, note: 'Relu, conforme à la demande.' } });
    expect([blocked.statusCode, blocked.body.request.status, blocked.body.blockedBy]).toEqual([200, 'BLOCKED', 'LEGAL_HOLD_ACTIVE']);
    expect(await one(sql`SELECT count(*)::int AS n FROM "ProCaseNote" WHERE "structureId" = ${S.A}`)).toBe(2);
    await db.execute(sql`UPDATE "LegalHold" SET status = 'RELEASED', "releasedAt" = NOW() WHERE id = ${'lh-' + TS}`);
    const done = await call('POST', '/api/admin/org-closure', { bearer: admin(0), body: { id: reqId, action: 'retry' } });
    expect([done.statusCode, done.body.request.status]).toEqual([200, 'COMPLETED']);
    expect(done.body.summary).toMatchObject({ dossierAccessesRevoked: 2, invitesRevoked: 1, aiDraftsForgotten: 1, internalNotesErased: 1, casesClosed: 1, referralsEnded: 3, appointmentsCancelled: 1,
      servicesDeactivated: 1, proposalsWithdrawn: 1, memberInvitationsErased: 1, notificationsErased: 1, membersAnonymized: 2 });
    expect((await db.execute(sql`SELECT status FROM "DSRRequest" WHERE id = ${reqId}`)).rows[0].status).toBe('COMPLETED');
  });

  it('after the closure: the person keeps the dossier, the organization data is erased, nobody of the organization gets in, the other organization keeps its work', async () => {
    expect(await one(sql`SELECT count(*)::int AS n FROM "SharedDiagnostic" WHERE id IN (${DOS}, ${DOS2}, ${DOS3})`)).toBe(3);
    expect(await one(sql`SELECT count(*)::int AS n FROM "SharedDossierGrant" WHERE "structureId" = ${S.A} AND "revokedAt" IS NULL`)).toBe(0);
    expect((await db.execute(sql`SELECT visibility FROM "ProCaseNote" WHERE "structureId" = ${S.A}`)).rows).toEqual([{ visibility: 'CITIZEN' }]);
    expect((await db.execute(sql`SELECT status FROM "ProCase" WHERE id = ${CASE}`)).rows[0].status).toBe('CLOSED');
    expect(await one(sql`SELECT count(*)::int AS n FROM "ProCaseEvent" WHERE "caseId" = ${CASE} AND kind = 'CLOSED' AND "fromValue" = 'ORGANIZATION_CLOSED'`)).toBe(1);
    const refs = Object.fromEntries((await db.execute(sql`SELECT id, status FROM "Referral" WHERE "sharedDiagnosticId" IN (${DOS}, ${DOS2}, ${DOS3})`)).rows.map((r) => [r.id.split('-')[0], r.status]));
    expect(refs).toEqual({ rAcc: 'ACCEPTED', rSent: 'CANCELLED', rDraft: 'CANCELLED', rIn: 'CLOSED' });
    expect((await db.execute(sql`SELECT id, "revokedAt" IS NULL AS live FROM "SharedDossierGrant" WHERE "structureId" = ${S.B} ORDER BY id`)).rows).toEqual([{ id: `gB1-${TS}`, live: true }, { id: `gB2-${TS}`, live: false }]);
    expect(await one(sql`SELECT count(*)::int AS n FROM "ReferralEvent" WHERE "actorType" = 'SYSTEM' AND "actorId" = 'ORGANIZATION_CLOSED' AND "referralId" LIKE ${'%-' + TS}`)).toBe(3);
    const ap = Object.fromEntries((await db.execute(sql`SELECT id, status FROM "ProAppointment" WHERE "structureId" = ${S.A}`)).rows.map((r) => [r.id.split('-')[0], r.status]));
    expect(ap).toEqual({ apF: 'cancelled', apP: 'booked' });
    expect((await db.execute(sql`SELECT kind, recipient FROM "AppointmentNotice" WHERE "appointmentId" = ${'apF-' + TS}`)).rows).toEqual([{ kind: 'CANCELLED_BY_STRUCTURE', recipient: 'citizen' }]);
    expect((await db.execute(sql`SELECT "isActive" FROM "ProRdvService" WHERE id = ${SVC}`)).rows[0].isActive).toBe(false);
    expect((await db.execute(sql`SELECT "isPublished", "contactEmail" FROM "StructureRdvSettings" WHERE "structureId" = ${S.A}`)).rows[0]).toEqual({ isPublished: false, contactEmail: null });
    expect((await db.execute(sql`SELECT status FROM "StructureProposal" WHERE id = ${'sp-' + TS}`)).rows[0].status).toBe('WITHDRAWN');
    for (const t of ['ProNotification', 'Invitation']) expect(await one(sql`SELECT count(*)::int AS n FROM ${sql.raw(`"${t}"`)} WHERE "structureId" = ${S.A}`)).toBe(0);
    expect(await one(sql`SELECT count(*)::int AS n FROM "AiOutputReview" WHERE "scopeStructureId" = ${S.A}`)).toBe(0);
    const members = (await db.execute(sql`SELECT id, email, status, mfa_secret, "sessionsValidAfter" IS NOT NULL AS revoked FROM "ProUser" WHERE "structureId" = ${S.A} ORDER BY id`)).rows;
    for (const m of members) expect(m).toEqual({ id: m.id, email: `closed-${m.id}@closed.invalid`, status: 'disabled', mfa_secret: null, revoked: true });
    expect((await db.execute(sql`SELECT "displayName", "isPubliclyVisible" FROM "ProProfile" WHERE "proUserId" = ${P.pro.id}`)).rows[0]).toEqual({ displayName: null, isPubliclyVisible: false });
    for (const p of [P.admin, P.pro]) expect([401, 403]).toContain((await call('GET', '/api/pro/structure', { bearer: proTok[p.id] })).statusCode);
    expect(await one(sql`SELECT count(*)::int AS n FROM "ProAuditLog" WHERE "proUserId" = ${P.pro.id} AND action = 'QA_E08_TRACE'`)).toBe(1);   // the audit trail stays
    const s = (await db.execute(sql`SELECT nom, is_pro_enabled FROM "Structure" WHERE id = ${S.A}`)).rows[0];
    expect(s).toEqual({ nom: `Org ${S.A}`, is_pro_enabled: false });   // the public directory record stays; online booking is off
    expect((await call('GET', '/api/pro/structure', { bearer: proTok[P.b.id] })).statusCode).toBe(200);   // the other organization is untouched
    expect(await one(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'ORGANIZATION_CLOSED' AND entity_id = ${S.A}`)).toBe(1);
    expect(await one(sql`SELECT count(*)::int AS n FROM "EntityVersion" WHERE entity_type = 'Structure' AND entity_id = ${S.A}`)).toBe(1);
  });

  it('ADA can open a closure; a rejection needs its reason and is told to the organization', async () => {
    const o = await call('POST', '/api/admin/org-closure', { bearer: admin(0), body: { action: 'open', structureId: S.C, reason: 'Fin de la convention de partenariat.' } });
    expect(o.statusCode).toBe(201); const id = o.body.request.id;
    expect((await call('POST', '/api/admin/org-closure', { bearer: admin(0), body: { id, decision: 'REJECT' } })).body.error).toBe('reason_required');
    expect((await call('POST', '/api/admin/org-closure', { bearer: admin(0), body: { id, decision: 'REJECT', reason: 'La convention est prolongée jusqu’en juin.' } })).statusCode).toBe(200);
    const pa = (await call('GET', '/api/admin/org-closure', { bearer: admin(1) })).body.requests.find((x) => x.id === id).proposedAt;
    await call('GET', `/api/admin/org-closure?id=${id}`, { bearer: admin(1) });   // the second reviewer's reading
    expect((await call('POST', '/api/admin/org-closure', { bearer: admin(1), body: { id, action: 'confirm', proposedAt: pa, note: 'Vérifié avec la convention.' } })).body.request.status).toBe('REJECTED');
    const st = await call('GET', '/api/pro/structure', { bearer: proTok[P.c.id] });
    expect(st.body.closure).toMatchObject({ id, status: 'REJECTED', reason: 'La convention est prolongée jusqu’en juin.' });
    expect((await db.execute(sql`SELECT status FROM "ProUser" WHERE id = ${P.c.id}`)).rows[0].status).toBe('active');
  });
});
