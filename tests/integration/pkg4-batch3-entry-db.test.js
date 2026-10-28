/**
 * PKG-4 batch 3 on REAL PostgreSQL THROUGH THE REAL API ENTRY (api/index.js: routing, CORS/CSRF, entry validation registry), synthetic organizations A, B, C, D:
 *   - E07 / team + regional statistics: own organization only; cross-organization aggregates k-anonymous; CSV for administrators, no personal data, formula-safe
 *   - R20 notifications: catalogue, server-side preferences, honest delivery record (TEST_RECORDED / OFF_BY_PREFERENCE, never "delivered" for the test outbox),
 *     no personal data in metadata, current organization only
 *   - R14 attachments: one encrypted file per message, both parties read it, nobody else (uniform 404), content-type from the bytes, size limit, erasure purges the blob
 *   - DSR: internal notes make the access request PARTIAL with a human ACCESS_REVIEW (never "completed" before); MFA review reads (audited) and releases an extract
 *   - E01: only VERIFIED organizations can be chosen to receive a dossier;  C24: counter hand-over by invitation keeps the dossier the person's
 * Synthetic data only; mailer = in-memory test provider; object storage = in-memory map. Skipped without DATABASE_URL.
 */
import crypto from 'node:crypto';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));
const STORE = vi.hoisted(() => ({ n: 0, blobs: new Map() }));
vi.mock('../../api/lib/storage.js', () => ({ storage: {
  upload: async (buf) => { STORE.n += 1; const k = `p4b3-key-${STORE.n}`; STORE.blobs.set(k, Buffer.from(buf)); return k; },
  download: async (k) => { if (!STORE.blobs.has(k)) throw new Error('missing'); return STORE.blobs.get(k); },
  delete: async (k) => { STORE.blobs.delete(k); },
} }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S = { A: `p4b3-A-${TS}`, B: `p4b3-B-${TS}`, C: `p4b3-C-${TS}`, D: `p4b3-D-${TS}` };   // C = active but NOT verified, D = for k-anonymity
const P = { admin: { id: `p4b3-adm-${TS}`, st: S.A, role: 'STRUCTURE_ADMIN' }, pro1: { id: `p4b3-p1-${TS}`, st: S.A, role: 'PRO' }, pro2: { id: `p4b3-p2-${TS}`, st: S.A, role: 'PRO' },
  b: { id: `p4b3-b-${TS}`, st: S.B, role: 'STRUCTURE_ADMIN' }, c: { id: `p4b3-c-${TS}`, st: S.C, role: 'STRUCTURE_ADMIN' } };
const CIT = { id: `p4b3-cit-${TS}`, email: `p4b3-cit-${TS}@example.test` }; const OTHER = { id: `p4b3-oth-${TS}`, email: `p4b3-oth-${TS}@example.test` };
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(600), Buffer.from('\n%%EOF')]);
const CSRF = 'p4b3csrf' + TS;

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers,
    on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c, h = {}) { this.statusCode = c; for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v); return this; },
    json(p) { this.body = p; this.headersSent = true; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; this.headersSent = true; fin.forEach((l) => l()); return this; },
    end(p) { if (p !== undefined) this.body = p; this.headersSent = true; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('PKG-4 batch 3 through the real API entry (real DB)', () => {
  let db, api, auth, userAuth, mailer;
  const proTok = (p) => `Bearer ${auth.signProToken({ id: p.id, email: `${p.id}@example.test`, structureId: p.st, role: p.role })}`;
  const citCookie = (u) => `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0]}; __csrf=${CSRF}`;
  const call = async (method, url, { pro, cit, admin, body, headers = {} } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {},
      headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(pro ? { authorization: proTok(pro) } : {}), ...(admin ? { authorization: `Bearer ${admin}` } : {}),
        ...(cit ? { cookie: citCookie(cit), 'x-csrf-token': CSRF } : {}), ...headers } };
    const res = mkRes(); await api(req, res); return res;
  };
  const adminTok = (mfa, email = 'p4b3-reviewer@example.test') => auth.signAdminSessionToken({ email, role: 'admin', mfa_verified: mfa });
  let caseId; let convId; let apptId;

  beforeAll(async () => {
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js'); mailer = await import('../../api/_utils/mailer.js');
    for (const [id, verified, ville] of [[S.A, true, 'Strasbourg'], [S.B, true, 'Strasbourg'], [S.C, false, 'Strasbourg'], [S.D, true, 'Strasbourg']]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${id}, ${'Org ' + id.split('-')[1]}, ${id}, 'association', '1 rue', ${ville}, '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', ${verified ? 'VERIFIED' : 'UNVERIFIED'}, NOW(), NOW())`);
    }
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, true, NOW())`);
    await db.execute(sql`UPDATE "ProUser" SET "notificationPrefs" = '{"cases": false}'::jsonb WHERE id = ${P.pro2.id}`);
    for (const u of [CIT, OTHER]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${'p4b3-dos-' + TS}, NOW() + interval '30 days', '{}'::jsonb, '{}'::jsonb, 0, ${'h' + TS}, ${'t' + TS}, 'GUEST_SHARE', ${CIT.id})`);
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia") VALUES (${'p4b3-g-' + TS}, ${'p4b3-dos-' + TS}, ${S.A}, ${P.pro1.id}, 'invite')`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${'p4b3-svc-' + TS}, ${S.A}, 'Accueil', 30, NOW())`);
    apptId = `p4b3-ap-${TS}`; convId = `p4b3-conv-${TS}`;
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", "beneficiaryName", "citizenUserId", "createdByProUserId", "updatedAt") VALUES (${apptId}, ${S.A}, ${'p4b3-svc-' + TS}, NOW() + interval '2 days', NOW() + interval '2 days 30 minutes', 'Personne', ${CIT.id}, ${P.pro1.id}, NOW())`);
    await db.execute(sql`INSERT INTO "RdvConversation" (id, "appointmentId", "structureId", "citizenUserId", "updatedAt") VALUES (${convId}, ${apptId}, ${S.A}, ${CIT.id}, NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" IN (${CIT.id}, ${OTHER.id})`).catch(() => {});
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE "ownerCitizenId" = ${CIT.id} OR id LIKE ${'p4b3-%'}`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" IN (${S.A}, ${S.B}, ${S.C}, ${S.D})`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${S.A}`);
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${S.A}, ${S.B}, ${S.C}, ${S.D})`);
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" IN (${S.A}, ${S.B}, ${S.C}, ${S.D})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${S.A}, ${S.B}, ${S.C}, ${S.D})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${S.A}, ${S.B}, ${S.C}, ${S.D})`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${CIT.id}, ${OTHER.id})`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${CIT.id}, ${OTHER.id})`);
  });

  it('routes exist in the real entry: stats, regional stats, notification preferences, DSR review (no 404 from routing)', async () => {
    for (const [m, u, o] of [['GET', '/api/pro/team/stats', { pro: P.pro1 }], ['GET', '/api/pro/regional-stats', { pro: P.pro1 }], ['GET', '/api/pro/notifications?view=preferences', { pro: P.pro1 }], ['GET', '/api/admin/dsr-review', { admin: adminTok(false) }]]) {
      const r = await call(m, u, o); expect(r.statusCode, `${u} ${JSON.stringify(r.body)}`).toBe(200);
    }
  });

  it('E07: team stats are the caller organization\'s only; regional aggregates hide communes with < 3 organizations and counts < 5; CSV for administrators only', async () => {
    const t = await call('GET', '/api/pro/team/stats', { pro: P.pro1 });
    expect(t.body.members.map((m) => m.id).sort()).toEqual([P.admin.id, P.pro1.id, P.pro2.id].sort());
    expect(t.body.global.appointmentsUpcoming).toBe(1);
    expect(t.body.members.find((m) => m.id === P.pro1.id).appointmentsCount).toBe(1);
    const tb = await call('GET', '/api/pro/team/stats', { pro: P.b }); expect(tb.body.members.map((m) => m.id)).toEqual([P.b.id]); expect(tb.body.global.appointmentsUpcoming).toBe(0);
    const reg = await call('GET', '/api/pro/regional-stats', { pro: P.b });
    expect(reg.body.kAnonymityMin).toBe(5); expect(JSON.stringify(reg.body)).not.toMatch(/Org A|Org B|p4b3-/);
    for (const c of reg.body.stats.cities) { if (c.agents !== null) expect(c.agents).toBeGreaterThanOrEqual(5); if (c.rdv !== null) expect(c.rdv).toBeGreaterThanOrEqual(5); }
    expect((await call('GET', '/api/pro/reports?period=month&format=csv', { pro: P.pro1 })).statusCode, 'reports are for administrators').toBe(403);
    const csv = await call('GET', '/api/pro/reports?period=month&format=csv', { pro: P.admin });
    expect(csv.statusCode).toBe(200); expect(csv.headers['content-type']).toMatch(/text\/csv/); expect(csv.headers['content-disposition']).toMatch(/attachment/);
    const text = String(csv.body); expect(text).toMatch(/rdv_total,1/); expect(text).not.toMatch(/@example\.test|Personne|p4b3-/);
  });

  it('R20: catalogue event to members per preference — TEST_RECORDED (test outbox) vs OFF_BY_PREFERENCE, never "DELIVERED"; preferences via the entry; own organization only', async () => {
    const q = await call('GET', '/api/pro/cases?scope=unassigned', { pro: P.pro1 }); caseId = q.body.cases.find((c) => c.dossierId === `p4b3-dos-${TS}`).id;
    mailer.__clearTestOutbox();
    const a1 = await call('POST', '/api/pro/cases', { pro: P.admin, body: { action: 'assign', id: caseId, userId: P.pro1.id } }); expect(a1.statusCode, JSON.stringify(a1.body)).toBe(200);
    const a2 = await call('POST', '/api/pro/cases', { pro: P.admin, body: { action: 'assign', id: caseId, userId: P.pro2.id } }); expect(a2.statusCode).toBe(200);
    const n = (await db.execute(sql`SELECT "userId", type, metadata FROM "ProNotification" WHERE "structureId" = ${S.A} AND type = 'case_assigned' ORDER BY "createdAt"`)).rows;
    expect(n.map((x) => [x.userId, x.metadata.delivery.email])).toEqual([[P.pro1.id, 'TEST_RECORDED'], [P.pro2.id, 'OFF_BY_PREFERENCE']]);
    expect(Object.keys(n[0].metadata).sort()).toEqual(['caseId', 'delivery']);
    const mails = mailer.__getTestOutbox().filter((m) => m.category === 'pro-case_assigned'); expect(mails.map((m) => m.to)).toEqual([`${P.pro1.id}@example.test`]);
    expect(mails[0].text).not.toMatch(/p4b3-dos|Personne|CIT/);
    const notices = (await db.execute(sql`SELECT status FROM "AppointmentNotice" WHERE status = 'DELIVERED' AND "appointmentId" = ${apptId}`)).rows; expect(notices).toEqual([]);
    const prefs = await call('PATCH', '/api/pro/notifications', { pro: P.pro1, body: { preferences: { categories: { cases: false, referrals: true } } } });
    expect(prefs.statusCode, JSON.stringify(prefs.body)).toBe(200); expect(prefs.body.preferences.categories.cases).toBe(false);
    expect((await call('PATCH', '/api/pro/notifications', { pro: P.pro1, body: { preferences: { categories: { marketing: true } } } })).statusCode).toBe(400);
    const list = await call('GET', '/api/pro/notifications', { pro: P.pro1 }); expect(list.body.notifications.every((x) => x.structureId === S.A)).toBe(true);
    await db.execute(sql`UPDATE "ProUser" SET "structureId" = ${S.B} WHERE id = ${P.pro2.id}`);
    const moved = await call('GET', '/api/pro/notifications', { pro: { ...P.pro2, st: S.B } });
    expect(moved.body.notifications, 'a member moved to another organization no longer sees the old organization\'s notices').toEqual([]);
    await db.execute(sql`UPDATE "ProUser" SET "structureId" = ${S.A} WHERE id = ${P.pro2.id}`);
  });

  it('R14: an encrypted attachment readable by the two parties of the conversation only; type from the bytes; size limit; uniform 404 for everyone else', async () => {
    const send = await call('POST', `/api/pro/messages/conversations/${convId}`, { pro: P.pro1, body: { body: 'Voici le document', attachment: { filename: 'attestation.pdf', mimeType: 'application/pdf', contentBase64: PDF.toString('base64') } } });
    expect(send.statusCode, JSON.stringify(send.body)).toBe(201);
    const att = send.body.item.attachments[0]; expect(att).toMatchObject({ name: 'attestation.pdf', mimeType: 'application/pdf', byteLength: PDF.length });
    const [row] = (await db.execute(sql`SELECT "storageKey", "filenameEncrypted" FROM "RdvMessageAttachment" WHERE id = ${att.id}`)).rows;
    expect(STORE.blobs.get(row.storageKey).includes(Buffer.from('%PDF-1.4'))).toBe(false); expect(row.filenameEncrypted).not.toContain('attestation');
    const c = await call('GET', `/api/messages/conversations/${convId}`, { cit: CIT });
    expect(c.statusCode).toBe(200); expect(c.body.item.messages.flatMap((m) => m.attachments).map((x) => x.id)).toEqual([att.id]);
    const dl = await call('GET', `/api/messages/conversations/${convId}/attachments/${att.id}`, { cit: CIT });
    expect(dl.statusCode).toBe(200); expect(Buffer.compare(Buffer.from(dl.body), PDF)).toBe(0); expect(dl.headers['content-disposition']).toMatch(/attachment/); expect(dl.headers['x-content-type-options']).toBe('nosniff');
    const reply = await call('POST', `/api/messages/conversations/${convId}`, { cit: CIT, body: { attachment: { filename: 'photo.png', contentBase64: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]).toString('base64') } } });
    expect(reply.statusCode, JSON.stringify(reply.body)).toBe(201);
    expect((await call('GET', `/api/pro/messages/conversations/${convId}/attachments/${reply.body.item.attachments[0].id}`, { pro: P.pro2 })).statusCode, 'any active member of the organization').toBe(200);
    // nobody else — and the same answer as an unknown id
    for (const r of [await call('GET', `/api/pro/messages/conversations/${convId}/attachments/${att.id}`, { pro: P.b }), await call('GET', `/api/messages/conversations/${convId}/attachments/${att.id}`, { cit: OTHER }),
      await call('GET', `/api/pro/messages/conversations/${convId}`, { pro: P.b }), await call('GET', `/api/messages/conversations/${convId}`, { cit: OTHER }), await call('GET', `/api/messages/conversations/nope-${TS}`, { cit: OTHER })]) expect(r.statusCode).toBe(404);
    expect((await call('GET', `/api/pro/messages/conversations/${convId}/attachments/${att.id}`)).statusCode).toBe(401);
    const txt = await call('POST', `/api/pro/messages/conversations/${convId}`, { pro: P.pro1, body: { body: 'x', attachment: { filename: 'a.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('#!/bin/sh\necho hi').toString('base64') } } });
    expect([txt.statusCode, txt.body.error]).toEqual([415, 'UNSUPPORTED_TYPE']);
    const mismatch = await call('POST', `/api/pro/messages/conversations/${convId}`, { pro: P.pro1, body: { body: 'x', attachment: { filename: 'a.png', mimeType: 'image/png', contentBase64: PDF.toString('base64') } } });
    expect([mismatch.statusCode, mismatch.body.error]).toEqual([415, 'TYPE_MISMATCH']);
    const big = await call('POST', `/api/pro/messages/conversations/${convId}`, { pro: P.pro1, body: { body: 'x', attachment: { filename: 'big.pdf', contentBase64: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64') } } });
    expect(big.statusCode).toBe(413);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "RdvMessageAttachment" WHERE "conversationId" = ${convId}`)).rows[0].n, 'refused files leave no row').toBe(2);
  });

  it('DSR: internal notes => PARTIALLY_COMPLETED + one human ACCESS_REVIEW; an MFA reviewer reads (audited) and proposes, a SECOND MFA reviewer confirms; only then the person receives the extract', async () => {
    expect((await call('POST', '/api/pro/cases', { pro: P.pro2, body: { action: 'note', id: caseId, visibility: 'INTERNAL', body: `note interne ${TS} sur la situation` } })).statusCode).toBe(201);
    const e1 = await call('GET', '/api/auth/export-data', { cit: CIT });
    expect(e1.statusCode).toBe(200); expect(e1.body.exportInfo.completeness).toBe('PARTIALLY_COMPLETED');
    expect(e1.body.organizationHeldRecords).toMatchObject({ status: 'PENDING_HUMAN_REVIEW', internalCaseNotes: [{ organization: 'Org A', count: 1 }] });
    expect(JSON.stringify(e1.body)).not.toContain(`note interne ${TS}`);
    const reviewId = e1.body.organizationHeldRecords.reviewRequestId; expect(reviewId).toBeTruthy();
    const e2 = await call('GET', '/api/auth/export-data', { cit: CIT }); expect(e2.body.organizationHeldRecords.reviewRequestId, 'one open review per person').toBe(reviewId);
    const statuses = (await db.execute(sql`SELECT "requestType", status FROM "DSRRequest" WHERE "subjectId" = ${CIT.id} ORDER BY "createdAt"`)).rows;
    expect(statuses.filter((s) => s.requestType === 'EXPORT').every((s) => s.status === 'PARTIALLY_COMPLETED')).toBe(true);
    expect(statuses.filter((s) => s.requestType === 'ACCESS_REVIEW')).toEqual([{ requestType: 'ACCESS_REVIEW', status: 'IN_REVIEW' }]);
    expect((await call('GET', `/api/admin/dsr-review?id=${reviewId}`, { admin: adminTok(false) })).statusCode, 'reading needs MFA').toBe(403);
    const read = await call('GET', `/api/admin/dsr-review?id=${reviewId}`, { admin: adminTok(true) });
    expect(read.statusCode).toBe(200); expect(read.body.notes.map((x) => x.body)).toEqual([`note interne ${TS} sur la situation`]);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'DSR_ACCESS_REVIEW_READ' AND entity_id = ${reviewId}`)).rows[0].n).toBe(1);
    expect((await call('POST', '/api/admin/dsr-review', { admin: adminTok(true), body: { id: reviewId, decision: 'RELEASE', extract: 'x' } })).body.error).toBe('basis_required');
    const prop = await call('POST', '/api/admin/dsr-review', { admin: adminTok(true), body: { id: reviewId, decision: 'RELEASE', basis: 'Aucune donnée de tiers ; aucune restriction applicable relevée.', extract: 'Note de la structure : situation suivie.' } });
    expect(prop.statusCode, JSON.stringify(prop.body)).toBe(200); expect(prop.body.request.status, 'a proposal is not a decision').toBe('IN_REVIEW');
    expect((await call('GET', '/api/auth/export-data', { cit: CIT })).body.organizationHeldRecords.reviews.find((r) => r.id === reviewId).releasedExtract, 'nothing released before confirmation').toBeNull();
    expect((await call('POST', '/api/admin/dsr-review', { admin: adminTok(true), body: { id: reviewId, action: 'confirm', note: 'je confirme moi-même' } })).statusCode, 'the proposer cannot confirm (two people)').toBe(403);
    expect((await call('POST', '/api/admin/dsr-review', { admin: adminTok(false, 'p4b3-dpo@example.test'), body: { id: reviewId, action: 'confirm', note: 'DPO : confirmé' } })).statusCode, 'second reviewer also needs MFA').toBe(403);
    const listed = (await call('GET', '/api/admin/dsr-review', { admin: adminTok(true, 'p4b3-dpo@example.test') })).body.requests.find((x) => x.id === reviewId);   // PKG-6 / D22: what the second reviewer sees
    expect(listed).toMatchObject({ stage: 'AWAITING_SECOND_REVIEWER', proposed: 'RELEASED' }); expect(listed.basis, 'the list carries no content').toBeUndefined();
    // owner LAB audit: the second reviewer confirms only after their own (journalised) reading of the notes and the proposed extract
    expect((await call('POST', '/api/admin/dsr-review', { admin: adminTok(true, 'p4b3-dpo@example.test'), body: { id: reviewId, action: 'confirm', proposedAt: listed.proposedAt, note: 'Délégué : lu' } })).body.error, 'not read yet').toBe('read_required');
    const seen = (await call('GET', `/api/admin/dsr-review?id=${reviewId}`, { admin: adminTok(true, 'p4b3-dpo@example.test') })).body;   // audited MFA reading
    expect(seen.proposalExtract).toBe('Note de la structure : situation suivie.'); expect(seen.proposal).toMatchObject({ basis: 'Aucune donnée de tiers ; aucune restriction applicable relevée.', proposedAt: listed.proposedAt });
    expect((await call('POST', '/api/admin/dsr-review', { admin: adminTok(true, 'p4b3-dpo@example.test'), body: { id: reviewId, action: 'confirm', note: 'confirmation sans version lue' } })).body.error, 'bound to the version read').toBe('version_changed');
    const ok = await call('POST', '/api/admin/dsr-review', { admin: adminTok(true, 'p4b3-dpo@example.test'), body: { id: reviewId, action: 'confirm', proposedAt: listed.proposedAt, note: 'Délégué à la protection des données (QA) : confirmé' } });
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200);
    expect((await call('POST', '/api/admin/dsr-review', { admin: adminTok(true), body: { id: reviewId, decision: 'WITHHOLD', basis: 'second decision attempt' } })).statusCode, 'one decision').toBe(404);
    const e3 = await call('GET', '/api/auth/export-data', { cit: CIT });
    const rv = e3.body.organizationHeldRecords.reviews.find((r) => r.id === reviewId);
    expect(rv).toMatchObject({ status: 'COMPLETED', decision: 'RELEASED', releasedExtract: 'Note de la structure : situation suivie.' });
    expect(JSON.stringify(e3.body)).not.toContain('p4b3-reviewer@example.test'); expect(JSON.stringify(e3.body)).not.toContain('p4b3-dpo@example.test');
  });

  it('C24 (+ current E01 rule): only ACTIVE organizations with someone to receive can be chosen (verified-only = owner decision, frozen suite); the counter hand-over never transfers ownership', async () => {
    const create = await call('POST', '/api/share/create', { cit: CIT, body: { situation: { zipCode: '67000' }, results: { rights: [] } } });
    expect(create.statusCode, JSON.stringify(create.body)).toBe(200);
    const share = { id: create.body.shareId, owner: create.body.ownerSecret };
    const own = (action, extra = {}) => call('POST', '/api/public/dossier-grants', { cit: CIT, body: { shareId: share.id, action, ...extra }, headers: { 'x-share-owner-secret': share.owner } });
    await db.execute(sql`UPDATE "Structure" SET statut = 'brouillon' WHERE id = ${S.C}`);   // a suspended / not yet activated organization
    const found = await own('find_organizations', { q: 'Org' }); const ids = found.body.organizations.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining([S.A, S.B])); expect(ids).not.toContain(S.C);
    expect((await own('invite', { structureId: S.C })).statusCode, 'inactive organization: same not-found as unknown').toBe(404);
    await db.execute(sql`UPDATE "Structure" SET statut = 'actif' WHERE id = ${S.C}`);
    const inv = await own('invite', { structureId: S.B }); expect(inv.statusCode).toBe(201);
    const before = (await db.execute(sql`SELECT "ownerCitizenId", "rightsSecretHash" FROM "SharedDiagnostic" WHERE id = ${share.id}`)).rows[0];
    const redeem = await call('POST', '/api/pro/dossier/redeem', { pro: P.b, body: { shareId: share.id, inviteToken: inv.body.inviteToken } });
    expect(redeem.statusCode, JSON.stringify(redeem.body)).toBe(200);
    expect((await db.execute(sql`SELECT "ownerCitizenId", "rightsSecretHash" FROM "SharedDiagnostic" WHERE id = ${share.id}`)).rows[0], 'ownership never moves to the professional').toEqual(before);
    expect((await call('POST', '/api/pro/dossier/redeem', { pro: P.admin, body: { shareId: share.id, inviteToken: inv.body.inviteToken } })).statusCode, 'the invitation works for ITS organization only, once').toBe(404);
    expect((await db.execute(sql`SELECT "structureId" FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${share.id} AND "revokedAt" IS NULL`)).rows.map((g) => g.structureId)).toEqual([S.B]);
    const q = await call('GET', '/api/pro/cases?scope=unassigned', { pro: P.b }); expect(q.body.cases.map((c) => c.dossierId)).toContain(share.id);
    const revokeByPro = await call('POST', '/api/public/dossier-revoke', { pro: P.b, body: { shareId: share.id } });
    expect([401, 403, 404]).toContain(revokeByPro.statusCode);
    expect((await own('revoke', { structureId: S.B })).statusCode, 'the person keeps control').toBe(200);
  });

  it('erasure of the person purges the attachment blobs with the conversations', async () => {
    const keys = (await db.execute(sql`SELECT "storageKey" k FROM "RdvMessageAttachment" WHERE "conversationId" = ${convId}`)).rows.map((r) => r.k);
    expect(keys.length).toBe(2); expect(keys.every((k) => STORE.blobs.has(k))).toBe(true);
    const { createPrivacyRightsService } = await import('../../api/_services/privacy.js');
    const svc = createPrivacyRightsService({ db, cryptoLib: crypto });
    await svc.deleteDataDomains(CIT.id, ['CitizenMessaging']);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "RdvMessageAttachment" WHERE "conversationId" = ${convId}`)).rows[0].n).toBe(0);
    expect(keys.some((k) => STORE.blobs.has(k)), 'blobs purged after commit').toBe(false);
  });
});
