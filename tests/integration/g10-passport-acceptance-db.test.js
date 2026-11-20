/**
 * G10 — acceptance of the « Passeport Social » / SHARED DOSSIER journey (the person shares a dossier with ONE organization, revocable, with documents and
 * Mon Coffre), LAB_SYNTHETIC, on REAL PostgreSQL and THROUGH THE REAL API ENTRY (api/index.js: CSRF, restricted beta, surface gate, R45 capability gate):
 *
 *   gate: Production profile → every dossier / vault route refused; capabilities named without an HDS attestation → still refused (requiresHds)
 *   → the person saves a dossier and invites X (bound to X: W cannot redeem it; an expired invitation is refused)
 *   → X — and only X — reads it; X attaches a document; the person sends a Mon Coffre document to X; the person sees both, and who did what (access journal)
 *   → another professional: once X's administrator assigns the case to x1, x2 no longer reads it and an ALREADY ISSUED download link stops working
 *   → a platform administrator (no break-glass, and even with one) never reads the dossier, its grants nor a document
 *   → the person withdraws X's access: X loses the dossier, its upload and its old download links at once
 *   → expired consent: a dossier past its expiry is closed to the organization (410) and to the document link
 *   → the export (art. 15/20) holds the dossier, the accesses, the invitations, the PURP-06 consent rows and the Coffre metadata (no storage key)
 *   → the reviewed erasure removes the dossier, its grants and invitations, the Coffre rows, and purges every encrypted blob.
 * Object storage is an in-memory double (the lab driver of the protected store); blobs are checked to be sealed (never the clear bytes).
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

const STORE = vi.hoisted(() => ({ blobs: new Map(), n: 0 }));
vi.mock('../../api/lib/storage.js', () => ({
  storage: {
    upload: async (buf) => { STORE.n += 1; const k = `g10p-key-${STORE.n}`; STORE.blobs.set(k, Buffer.from(buf)); return k; },
    download: async (k) => { if (!STORE.blobs.has(k)) throw new Error('missing'); return STORE.blobs.get(k); },
    delete: async (k) => { STORE.blobs.delete(k); },
  },
}));
vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0, lpush: async () => 1, ltrim: async () => 'OK', lrange: async () => [] } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `${Date.now()}${crypto.randomBytes(2).toString('hex')}`;
const CASE = `g10pass-${TS}`;
const S = { X: `${CASE}-X`, W: `${CASE}-W` };
const NAME = { X: `G10P Accueil ${TS}`, W: `G10P Autre ${TS}` };
const P = { xa: { id: `${CASE}-xa`, st: S.X, role: 'STRUCTURE_ADMIN' }, x1: { id: `${CASE}-x1`, st: S.X, role: 'PRO' }, x2: { id: `${CASE}-x2`, st: S.X, role: 'PRO' },
  w1: { id: `${CASE}-w1`, st: S.W, role: 'STRUCTURE_ADMIN' } };
const CIT = { id: `${CASE}-cit`, email: `${CASE}-cit@example.test` };
const OTHER = { id: `${CASE}-oth`, email: `${CASE}-oth@example.test` };
const ADM = { A: `${CASE}-a@example.test`, B: `${CASE}-b@example.test` };
const PDF = Buffer.from(`%PDF-1.4\n% G10 synthetic ${CASE}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`G10 coffre ${CASE}`)]);
const CSRF = `g10pcsrf${TS}`;
const LAB_HDS = `HDS1:lab-synthetic:G10P-SYNTHETIC-NOT-A-CERT:2099-12-31:${'0'.repeat(64)}`;
const ENV_KEYS = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_BETA_ACCOUNTS_SCOPE', 'ADA_BETA_ACCOUNTS_EXTRA', 'ADA_CAPABILITIES_OPEN', 'ADA_HDS_CERTIFIED_HOSTING',
  'ADA_BETA_OPEN_JOBS', 'ADA_JOBS_APPROVED', 'ADA_PROTECTED_STORE', 'MAILER_PROVIDER', 'MAILER_FROM'];
const PRODUCTION = { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts', ADA_BETA_ACCOUNTS_SCOPE: undefined, ADA_BETA_ACCOUNTS_EXTRA: undefined,
  ADA_CAPABILITIES_OPEN: undefined, ADA_HDS_CERTIFIED_HOSTING: undefined, ADA_BETA_OPEN_JOBS: undefined, ADA_JOBS_APPROVED: undefined, ADA_PROTECTED_STORE: undefined,
  MAILER_PROVIDER: 'test', MAILER_FROM: 'qa@example.test' };
const CAPS = 'citizen.shared_dossier,citizen.saved_diagnostic,citizen.vault,pro.case_management';
const OPENED = { ...PRODUCTION, ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro,documents,diagnostic', ADA_BETA_ACCOUNTS_SCOPE: 'full', ADA_CAPABILITIES_OPEN: CAPS, ADA_HDS_CERTIFIED_HOSTING: LAB_HDS };
const setEnv = (vars) => { for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = v; }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('G10 acceptance — Passeport Social / shared dossier: consent → one organization → documents → withdrawal → export → erasure (real API entry, real PostgreSQL)', () => {
  let db, api, auth, userAuth, review;
  const saved = {}; const J = {};
  const call = async (method, url, { as = {}, body } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const h = { host: 'localhost:3000', 'x-forwarded-proto': 'http', 'x-csrf-token': CSRF, cookie: `__csrf=${CSRF}` };
    const citizen = (who) => `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: who.id, email: who.email })).split(';')[0]}; __csrf=${CSRF}`;
    if (as.cit) h.cookie = citizen(CIT);
    if (as.other) h.cookie = citizen(OTHER);
    if (as.pro) h.authorization = `Bearer ${auth.signProToken({ id: as.pro.id, email: `${as.pro.id}@example.test`, structureId: as.pro.st, role: as.pro.role })}`;
    if (as.admin) h.authorization = `Bearer ${auth.signAdminSessionToken({ email: ADM.A, role: 'admin', mfa_verified: true, ...(as.elevated ? { elev_kind: 'BREAK_GLASS', elev_until: Date.now() + 600000, elev_id: `${CASE}-bg` } : {}) })}`;
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, socket: {}, headers: h };
    const res = mkRes(); await api(req, res);
    await (await import('../../api/_utils/after-response.js')).settleAfterResponse().catch(() => {});
    return res;
  };
  const ok = (r, code) => { if (code) expect(r.statusCode, JSON.stringify(r.body)).toBe(code); else expect(r.statusCode, JSON.stringify(r.body)).toBeLessThan(300); return r.body; };
  const refused = (r, what = '') => expect([401, 403, 404, 409, 410], `${what} ${JSON.stringify(r.body)}`).toContain(r.statusCode);
  const rows = async (q) => (await db.execute(q)).rows;
  const owner = (action, extra = {}, as = { cit: true }) => call('POST', '/api/public/dossier-grants', { as, body: { shareId: J.shareId, action, ...extra } });
  const dossier = (p) => call('GET', `/api/pro/dossier?shareId=${encodeURIComponent(J.shareId)}`, { as: { pro: p } });
  const download = (token) => call('POST', '/api/download', { body: { token } });
  const upload = (p) => call('POST', '/api/pro/dossier/upload-secure', { as: { pro: p }, body: { shareId: J.shareId, originalName: 'justificatif-g10.pdf', mimeType: 'application/pdf', fileBase64: PDF.toString('base64') } });
  const grantActive = async (st) => (await rows(sql`SELECT count(*)::int n FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${J.shareId} AND "structureId" = ${st} AND "revokedAt" IS NULL`))[0].n;

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv(PRODUCTION);
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    review = await import('../../api/_services/dsr-erasure-review.js');
    for (const k of ['X', 'W']) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, departement, insee_codes, services, publics_accueillis, categories_aidees, statut, verification_status, data_origin, "updatedAt", "createdAt")
        VALUES (${S[k]}, ${NAME[k]}, ${S[k]}, 'association', '1 rue fictive', 'Strasbourg', '67000', '67', '{67482}'::text[], '{accompagnement}'::text[], '{tout_public}'::text[], '{social}'::text[], 'actif', 'VERIFIED', 'synthetic_fixture', NOW(), NOW())`);
    }
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, false, NOW())`);
    for (const c of [CIT, OTHER]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    for (const e of Object.values(ADM)) await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "updatedAt", "failedLoginAttempts", "mfaEnabled") VALUES (${'id-' + e}, ${e}, 'x', 'admin', NOW(), 0, true)`);
  }, 90000);

  afterAll(async () => {
    try {
      if (!db) return;
      const sts = sql.join(Object.values(S).map((s) => sql`${s}`), sql`, `);
      if (J.shareId) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${J.shareId}`).catch(() => {});
      await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'shareId' = ${J.sid || '-'}`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${sts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" IN (${sts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${sts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${sts})`).catch(() => {});
      for (const c of [CIT, OTHER]) {
        await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${c.id}`).catch(() => {});
        await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
      }
      for (const e of Object.values(ADM)) await db.execute(sql`DELETE FROM "AdminUser" WHERE email = ${e}`).catch(() => {});
    } finally { setEnv(saved); }
  });

  it('1 · HDS gate: Production profile refuses every dossier / vault route; naming the capabilities without an HDS attestation still refuses them', async () => {
    const probes = [['POST', '/api/share/create', { cit: true }, { situation: {}, results: {} }], ['POST', '/api/public/dossier-grants', { cit: true }, { shareId: 'x', action: 'list' }],
      ['GET', '/api/citizen/shares', { cit: true }], ['GET', '/api/citizen/dossier?shareId=x', { cit: true }], ['GET', '/api/citizen/coffre', { cit: true }],
      ['GET', '/api/pro/dossier?shareId=x', { pro: P.x1 }], ['POST', '/api/pro/dossier/redeem', { pro: P.x1 }, { shareId: 'x', inviteToken: 'x' }], ['POST', '/api/download', {}, { token: 'x' }]];
    for (const [m, u, as, body] of probes) expect([403, 404, 503], `${m} ${u} (Production)`).toContain((await call(m, u, { as, body: body || {} })).statusCode);
    setEnv({ ...OPENED, ADA_HDS_CERTIFIED_HOSTING: undefined });
    for (const [m, u, as, body] of probes) {
      const r = await call(m, u, { as, body: body || {} });
      expect([r.statusCode, r.body?.error], `${m} ${u} (named, no HDS)`).toEqual([503, 'CAPABILITY_NOT_OPEN']);
    }
    setEnv(OPENED);
    expect((await call('GET', '/api/citizen/coffre', { as: { cit: true } })).statusCode).toBe(200);
  });

  it('2 · the person saves a dossier and invites X: the invitation is bound to X (W cannot redeem it, nothing is readable before), an expired invitation is refused', async () => {
    const created = ok(await call('POST', '/api/share/create', { as: { cit: true }, body: { situation: { zipCode: '67000', needs: ['aides-logement'] }, results: { rights: [] } } }));
    J.shareId = created.shareId; J.sid = created.shareId;
    expect(ok(await call('GET', '/api/citizen/shares', { as: { cit: true } })).shares.map((s) => s.id)).toContain(J.shareId);
    expect((await dossier(P.x1)).statusCode).toBe(404);
    refused(await owner('invite', { structureId: S.X }, { other: true }), 'another person invites');
    // an invitation that expired is refused (410), and does not open anything
    const stale = ok(await owner('invite', { structureId: S.X }), 201);
    await db.execute(sql`UPDATE "SharedDossierInvite" SET "expiresAt" = NOW() - interval '1 minute' WHERE id = ${stale.inviteId}`);
    expect((await call('POST', '/api/pro/dossier/redeem', { as: { pro: P.x1 }, body: { shareId: J.shareId, inviteToken: stale.inviteToken } })).statusCode).toBe(410);
    expect(await grantActive(S.X)).toBe(0);
    const inv = ok(await owner('invite', { structureId: S.X }), 201);
    refused(await call('POST', '/api/pro/dossier/redeem', { as: { pro: P.w1 }, body: { shareId: J.shareId, inviteToken: inv.inviteToken } }), 'W redeems X’s invitation');
    ok(await call('POST', '/api/pro/dossier/redeem', { as: { pro: P.x1 }, body: { shareId: J.shareId, inviteToken: inv.inviteToken } }));
    expect([await grantActive(S.X), await grantActive(S.W)]).toEqual([1, 0]);
    const list = ok(await owner('list'));
    expect(list.grants).toEqual([expect.objectContaining({ structureId: S.X, structureName: NAME.X, revoked: false, purposes: ['PURP-06'] })]);
  });

  it('3 · X — and only X — reads it; X attaches a document; the person sends a Mon Coffre document to X; the person sees both and the access journal', async () => {
    ok(await dossier(P.x1));
    expect((await dossier(P.w1)).statusCode).toBe(404);
    const up = ok(await upload(P.x1));
    J.fileX = up.fileId;
    refused(await upload(P.w1), 'W uploads');
    // Mon Coffre: health documents are refused (no certified host); an ordinary one is kept sealed
    expect((await call('POST', '/api/citizen/coffre', { as: { cit: true }, body: { category: 'sante', originalName: 'ordonnance.png', mimeType: 'image/png', fileBase64: PNG.toString('base64') } })).statusCode).toBe(422);
    J.coffre = ok(await call('POST', '/api/citizen/coffre', { as: { cit: true }, body: { category: 'logement', originalName: 'quittance-g10.png', mimeType: 'image/png', fileBase64: PNG.toString('base64') } }), 201).document.id;
    refused(await call('POST', '/api/citizen/coffre', { as: { cit: true }, body: { action: 'share', documentId: J.coffre, shareId: J.shareId, structureId: S.W } }), 'Coffre → W (no grant)');
    J.fileC = ok(await call('POST', '/api/citizen/coffre', { as: { cit: true }, body: { action: 'share', documentId: J.coffre, shareId: J.shareId, structureId: S.X } }), 201).fileId;
    for (const blob of STORE.blobs.values()) { expect(blob.includes(PDF)).toBe(false); expect(blob.includes(PNG)).toBe(false); }   // sealed at rest
    const seen = ok(await dossier(P.x1));
    expect(seen.documents.map((d) => d.id).sort()).toEqual([J.fileX, J.fileC].sort());
    J.tokenX1 = seen.documents.find((d) => d.id === J.fileX).downloadToken;
    const got = await download(J.tokenX1);
    expect(got.statusCode).toBe(200);
    expect(Buffer.compare(Buffer.from(got.body), PDF)).toBe(0);
    const mineDocs = ok(await call('GET', `/api/citizen/dossier?shareId=${encodeURIComponent(J.shareId)}&view=documents`, { as: { cit: true } })).documents;
    expect(mineDocs.map((d) => [d.name, d.organization]).sort()).toEqual([['justificatif-g10.pdf', NAME.X], ['quittance-g10.png', NAME.X]]);
    expect((await call('GET', `/api/citizen/dossier?shareId=${encodeURIComponent(J.shareId)}&view=documents`, { as: { other: true } })).statusCode).toBe(404);
    const journal = ok(await call('GET', `/api/citizen/dossier?shareId=${encodeURIComponent(J.shareId)}&view=access`, { as: { cit: true } })).events;
    expect(new Set(journal.map((e) => e.action))).toEqual(new Set(['DOSSIER_ACCESS_GRANTED', 'DOSSIER_VIEWED', 'FILE_UPLOADED', 'DOSSIER_FILE_DOWNLOADED']));
    expect(journal.every((e) => e.organization === NAME.X)).toBe(true);
  });

  it('4 · another professional: once the case is assigned to x1, x2 no longer reads the dossier, and a download link already issued to x2 stops working at once', async () => {
    const x2docs = ok(await dossier(P.x2)).documents;
    const tokenX2 = x2docs.find((d) => d.id === J.fileX).downloadToken;
    expect((await download(tokenX2)).statusCode).toBe(200);
    J.caseX = ok(await call('GET', '/api/pro/cases?scope=unassigned', { as: { pro: P.xa } })).cases.find((c) => c.dossierId === J.shareId).id;
    ok(await call('POST', '/api/pro/cases', { as: { pro: P.xa }, body: { action: 'assign', id: J.caseX, userId: P.x1.id } }));
    expect((await dossier(P.x2)).statusCode).toBe(404);
    refused(await upload(P.x2), 'x2 uploads');
    expect((await download(tokenX2)).statusCode, 'x2’s old link').toBe(404);
    expect((await download(J.tokenX1)).statusCode, 'the assignee’s link').toBe(200);
  });

  it('5 · a platform administrator — without break-glass, and even with one — never reads the dossier, its grants nor a document', async () => {
    for (const elevated of [false, true]) {
      for (const url of [`/api/pro/dossier?shareId=${encodeURIComponent(J.shareId)}`, `/api/citizen/dossier?shareId=${encodeURIComponent(J.shareId)}&view=documents`, '/api/citizen/coffre']) {
        expect([401, 403, 404], `${url} elevated=${elevated}`).toContain((await call('GET', url, { as: { admin: true, elevated } })).statusCode);
      }
      refused(await call('POST', '/api/public/dossier-grants', { as: { admin: true, elevated }, body: { shareId: J.shareId, action: 'list' } }), 'admin lists the grants');
      refused(await call('POST', '/api/public/dossier-revoke', { as: { admin: true, elevated }, body: { shareId: J.shareId } }), 'admin erases the dossier');
    }
    expect((await rows(sql`SELECT count(*)::int n FROM "SharedDiagnostic" WHERE id = ${J.shareId}`))[0].n).toBe(1);
  });

  it('6 · expired consent: a dossier past its expiry is closed to the organization and to its document links', async () => {
    const [{ e }] = await rows(sql`SELECT "expiresAt" e FROM "SharedDiagnostic" WHERE id = ${J.shareId}`);
    await db.execute(sql`UPDATE "SharedDiagnostic" SET "expiresAt" = NOW() - interval '1 minute' WHERE id = ${J.shareId}`);
    try {
      refused(await dossier(P.x1), 'expired dossier');
      refused(await download(J.tokenX1), 'expired dossier link');
      refused(await upload(P.x1), 'upload to an expired dossier');
    } finally { await db.execute(sql`UPDATE "SharedDiagnostic" SET "expiresAt" = ${e} WHERE id = ${J.shareId}`); }
    ok(await dossier(P.x1));
  });

  it('7 · the person withdraws X’s access: X loses the dossier, its upload and its old download link at once; the person keeps the dossier', async () => {
    refused(await owner('revoke', { structureId: S.X }, { other: true }), 'another person revokes');
    ok(await owner('revoke', { structureId: S.X }));
    expect(await grantActive(S.X)).toBe(0);
    for (const p of [P.x1, P.xa]) expect((await dossier(p)).statusCode).toBe(404);
    refused(await upload(P.x1), 'X uploads after withdrawal');
    expect((await download(J.tokenX1)).statusCode).toBe(404);
    expect(ok(await owner('list')).grants).toEqual([expect.objectContaining({ structureId: S.X, revoked: true })]);
    expect(ok(await call('GET', `/api/citizen/dossier?shareId=${encodeURIComponent(J.shareId)}&view=documents`, { as: { cit: true } })).documents.length).toBe(2);
  });

  it('8 · the export (art. 15/20) holds the dossier, the accesses, the invitations, the PURP-06 consent rows and the Coffre metadata — no storage key, no secret hash', async () => {
    const exp = ok(await call('GET', '/api/auth/export-data', { as: { cit: true } }));
    const d = exp.diagnostics.find((x) => x.id === J.shareId);
    expect(d.results._files.map((f) => [f.id, f.name, f.mimeType]).sort()).toEqual([[J.fileX, 'justificatif-g10.pdf', 'application/pdf'], [J.fileC, 'quittance-g10.png', 'image/png']].sort());
    expect(exp.dossierAccesses).toEqual([expect.objectContaining({ dossierId: J.shareId, organization: NAME.X, grantedVia: 'invite' })]);
    expect(exp.dossierAccesses[0].revokedAt).toBeTruthy();
    expect(exp.dossierInvitations.filter((i) => i.dossierId === J.shareId).length).toBe(2);
    expect(exp.dossierPurposeConsents.filter((c) => c.dossierAndOrganization === `${J.shareId}:${S.X}` && c.purpose === 'PURP-06').map((c) => c.decision)).toEqual([true, false]);
    expect(exp.coffreDocuments).toEqual([expect.objectContaining({ id: J.coffre, category: 'logement' })]);
    const text = JSON.stringify(exp);
    expect(text).not.toMatch(/storageKey|tokenHash|rightsSecretHash|shareTokenHash|g10p-key-/);
  });

  it('9 · the reviewed erasure removes the dossier, its grants and invitations, the Coffre rows, and purges every encrypted blob', async () => {
    expect(STORE.blobs.size).toBe(3);   // X's document, the Coffre original, its copy in the dossier
    const req = ok(await call('DELETE', '/api/auth/delete-account', { as: { cit: true } }), 202);
    expect((await review.proposeErasure(req.requestId, { decision: 'APPROVE' }, ADM.A, db)).ok).toBe(true);
    const [{ o }] = await rows(sql`SELECT "reviewOutcome" AS o FROM "DSRRequest" WHERE id = ${req.requestId}`);
    expect((await review.readErasure(req.requestId, ADM.B, db)).ok).toBe(true);
    const done = await review.confirmErasure(req.requestId, { action: 'confirm', note: 'Deuxième relecture, identité vérifiée', proposedAt: o.proposal.proposedAt }, ADM.B, db);
    expect(done.request?.status, JSON.stringify(done)).toBe('COMPLETED');
    expect((await rows(sql`SELECT
        (SELECT count(*)::int FROM "SharedDiagnostic" WHERE id = ${J.shareId}) AS dossier,
        (SELECT count(*)::int FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${J.shareId}) AS grants,
        (SELECT count(*)::int FROM "SharedDossierInvite" WHERE "sharedDiagnosticId" = ${J.shareId}) AS invites,
        (SELECT count(*)::int FROM "ProCase" WHERE "sharedDiagnosticId" = ${J.shareId}) AS cases,
        (SELECT count(*)::int FROM "CitizenDocument" WHERE "userId" = ${CIT.id}) AS coffre,
        (SELECT count(*)::int FROM "CitizenUser" WHERE id = ${CIT.id}) AS account`))[0]).toEqual({ dossier: 0, grants: 0, invites: 0, cases: 0, coffre: 0, account: 0 });
    expect(STORE.blobs.size).toBe(0);
    J.shareId = null;
  });
});
