/**
 * DTA S2A — POST /api/download (signed attachment token, 1 h) on REAL PostgreSQL: the token must stop working the moment the grant of the FILE-OWNING organization is revoked (S1D fix, previously unit-only).
 * Real SharedDiagnostic + SharedDossierGrant rows, real data-keys encryption/decryption (envelope v2 bound to dossier+file) and a real signed token; ONLY the object storage is replaced by an in-memory map
 * (the QA storage endpoint is a closed port).  Legacy entries without `structureId` keep the previous behaviour (recorded limit, asserted).  Skipped without DATABASE_URL; synthetic data only.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';

const STORE = vi.hoisted(() => new Map());
vi.mock('../../api/lib/storage.js', () => ({ storage: { download: async (k) => { if (!STORE.has(k)) throw new Error('missing'); return STORE.get(k); }, upload: async () => 'x' } }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const SH = `dl-share-${TS}`, SH_EXP = `dl-exp-${TS}`;
const ORG = { A: `dl-sA-${TS}`, B: `dl-sB-${TS}` };
const USER = { A: { id: `dl-uA-${TS}`, email: `dla-${TS}@example.test` }, B: { id: `dl-uB-${TS}`, email: `dlb-${TS}@example.test` } };
const BYTES = Buffer.from('%PDF-1.4 synthetic dossier file ' + TS);
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(d) { this.body = d; return this; }, end() { return this; } });

describe.skipIf(!hasDatabase)('download token vs grant revocation (real DB)', () => {
  let db, schema, handler, crypt, keys;
  const token = (shareId, fileId) => crypt.generateAttachmentToken(`${shareId}:${fileId}`, 3600);
  const call = async (t) => { const r = mk(); await handler({ method: 'POST', url: '/api/download', headers: { host: 'localhost' }, body: { token: t } }, r); return r; };
  const entry = (shareId, fileId, structureId) => {
    const ctx = `file:${shareId}:${fileId}`; const key = `dl-key-${fileId}`;
    STORE.set(key, keys.sealBuffer(BYTES, { purpose: 'dossier-file', context: ctx }));
    return { id: fileId, ...(structureId ? { structureId } : {}), storageKey: key, filenameEncrypted: keys.sealText('piece.pdf', { purpose: 'dossier-filename', context: ctx }), mimeType: 'application/pdf', byteLength: BYTES.length, checksumSha256: crypto.createHash('sha256').update(BYTES).digest('hex'), encrypted: true };
  };
  const F = { A: `fa-${TS}`, LEG: `fl-${TS}`, EXP: `fe-${TS}` };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.js');
    crypt = await import('../../api/lib/crypto.js'); keys = await import('../../api/lib/data-keys.js'); ({ default: handler } = await import('../../api/_handlers/download.js'));
    for (const [k, sid] of Object.entries(ORG)) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt") VALUES (${sid}, ${'DL ' + k}, ${'dl-slug-' + k + '-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', NOW(), NOW())`);
      await db.insert(schema.ProUser).values({ id: USER[k].id, email: USER[k].email, password_hash: 'x', structureId: sid, role: 'STRUCTURE_ADMIN', status: 'active' });
    }
    await db.insert(schema.SharedDiagnostic).values({ id: SH, expiresAt: new Date(Date.now() + 86400000), situation: {}, results: { _files: [entry(SH, F.A, ORG.A), entry(SH, F.LEG, null)] }, viewCount: 0 });
    await db.insert(schema.SharedDiagnostic).values({ id: SH_EXP, expiresAt: new Date(Date.now() - 3600000), situation: {}, results: { _files: [entry(SH_EXP, F.EXP, ORG.A)] }, viewCount: 0 });
    await db.insert(schema.SharedDossierGrant).values([{ sharedDiagnosticId: SH, structureId: ORG.A, grantedByProUserId: USER.A.id }, { sharedDiagnosticId: SH_EXP, structureId: ORG.A, grantedByProUserId: USER.A.id }]);
  });
  afterAll(async () => {
    if (!db) return;
    for (const id of [SH, SH_EXP]) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${id}`);
    for (const u of Object.values(USER)) await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${u.id}`);
    for (const s of Object.values(ORG)) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${s}`);
  });

  it('active grant: the file is served decrypted and intact; revocation takes effect immediately with the SAME 404 as an unknown token/file; re-granting restores it', async () => {
    const t = token(SH, F.A);
    const ok = await call(t); expect(ok.statusCode).toBe(200); expect(Buffer.compare(ok.body, BYTES)).toBe(0);
    const unknownFile = await call(token(SH, 'nope')); const badToken = await call('garbage');
    await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NOW() WHERE "sharedDiagnosticId" = ${SH} AND "structureId" = ${ORG.A}`);
    const revoked = await call(t);
    expect(revoked.statusCode).toBe(404); expect(revoked.body).toEqual({ error: 'Document not found' }); expect(unknownFile.body).toEqual(revoked.body); expect(badToken.body).toEqual(revoked.body);
    await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NULL WHERE "sharedDiagnosticId" = ${SH} AND "structureId" = ${ORG.A}`);
    expect((await call(t)).statusCode).toBe(200);
  });
  it('a file whose owning organization holds NO grant row is refused', async () => {
    await db.execute(sql`DELETE FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${SH} AND "structureId" = ${ORG.A}`);
    try { expect((await call(token(SH, F.A))).statusCode).toBe(404); }
    finally { await db.insert(schema.SharedDossierGrant).values({ sharedDiagnosticId: SH, structureId: ORG.A, grantedByProUserId: USER.A.id }); }
  });
  it('an expired dossier keeps answering 410', async () => { expect((await call(token(SH_EXP, F.EXP))).statusCode).toBe(410); });
  it('LIMIT (recorded): a legacy file entry without structureId has no owning organization to re-check and is still served', async () => {
    expect((await call(token(SH, F.LEG))).statusCode).toBe(200);
  });
  it('a token is bound to its dossier and file: another file id under the same dossier is refused', async () => {
    expect((await call(token(SH, F.EXP))).statusCode).toBe(404);
  });
});
