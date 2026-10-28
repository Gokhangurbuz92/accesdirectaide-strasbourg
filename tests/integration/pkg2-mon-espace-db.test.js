/**
 * PKG-2 / K2 Mon Espace on REAL PostgreSQL with the migrated schema (0016), through the real handlers and signed session cookies:
 * Mon Parcours (plan import from an ACCOUNT-owned dossier only, idempotent, status history append-only, deadline only with an official source), favourites (published
 * records only), opt-in history (off by default, switching off erases), Mon Coffre (content-checked types, quotas, encryption at rest, isolation, blob purge),
 * the dashboard summary, account isolation everywhere, and the DSR export / erasure coverage of the new tables (Coffre blobs purged).
 * Object storage is an in-memory map (as in dta-s8-documents-availability-db); everything else is real. Synthetic data only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
const BLOBS = vi.hoisted(() => new Map());
vi.mock('../../api/lib/storage.js', () => ({
  storage: {
    upload: async (buf) => { const k = `pkg2-key-${BLOBS.size}-${Math.random().toString(36).slice(2)}`; BLOBS.set(k, Buffer.from(buf)); return k; },
    download: async (k) => { if (!BLOBS.has(k)) throw new Error('missing blob'); return BLOBS.get(k); },
    delete: async (k) => { BLOBS.delete(k); },
  },
}));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const A = { id: `pkg2-a-${TS}`, email: `pkg2-a-${TS}@example.test` };
const B = { id: `pkg2-b-${TS}`, email: `pkg2-b-${TS}@example.test` };
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('synthetic pkg2 document '.repeat(20))]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('PKG-2 Mon Espace (real DB)', () => {
  let db, userAuth, H, buildAssessment, UNSUPPORTED_RIGHTS, privacy;
  const cookie = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const call = async (h, { method = 'GET', body, query = {}, as } = {}) => { const r = mk(); await h({ method, url: '/api/x', query, body, headers: { host: 'localhost', ...(as ? { cookie: cookie(as) } : {}) } }, r); return r; };
  const ids = { shares: [], aides: [] };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    userAuth = await import('../../api/_utils/user-auth.js');
    ({ buildAssessment } = await import('../../api/lib/assessmentContract.js'));
    ({ UNSUPPORTED_RIGHTS } = await import('../../api/lib/diagnosticAssessment.js'));
    privacy = await import('../../api/_services/privacy.js');
    H = {}; for (const n of ['parcours', 'favorites', 'history', 'coffre', 'espace']) H[n] = (await import(`../../api/_handlers/citizen/${n}.js`)).default;
    for (const u of [A, B]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    if (ids.shares.length) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${sql.join(ids.shares.map((i) => sql`${i}`), sql`, `)})`);
    if (ids.aides.length) await db.execute(sql`DELETE FROM "Aide" WHERE id IN (${sql.join(ids.aides.map((i) => sql`${i}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${A.id}, ${B.id})`);
    await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" IN (${A.id}, ${B.id})`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${A.id}, ${B.id})`);
  });

  const dossier = async (owner) => {
    const id = `pkg2-share-${owner ? owner.id : 'none'}-${ids.shares.length}-${TS}`; ids.shares.push(id);
    const results = { assessment: buildAssessment({ answers: { birthDate: '1992-03-10', householdSize: 1, territory: '67000', income: { unemployment: 700 }, housing: { status: 'tenant', rent: 480 } }, unsupportedRights: UNSUPPORTED_RIGHTS }) };
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${id}, NOW() + interval '7 days', '{}'::jsonb, ${JSON.stringify(results)}::jsonb, 0, ${'h-' + id}, ${'t-' + id}, 'GUEST_SHARE', ${owner ? owner.id : null})`);
    return id;
  };

  it('every Mon Espace endpoint refuses an anonymous caller (401)', async () => {
    for (const h of Object.values(H)) expect((await call(h)).statusCode).toBe(401);
  });

  describe('Mon Parcours', () => {
    it('imports the plan of a dossier the ACCOUNT owns; another account or an unattached dossier is a uniform 404; re-import adds nothing twice', async () => {
      const mine = await dossier(A); const theirs = await dossier(B); const loose = await dossier(null);
      for (const s of [theirs, loose, 'does-not-exist']) expect((await call(H.parcours, { method: 'POST', as: A, body: { action: 'import', shareId: s } })).statusCode).toBe(404);
      const r = await call(H.parcours, { method: 'POST', as: A, body: { action: 'import', shareId: mine } });
      expect(r.statusCode, JSON.stringify(r.body)).toBe(200); expect(r.body.added).toBeGreaterThan(0);
      const again = await call(H.parcours, { method: 'POST', as: A, body: { action: 'import', shareId: mine } });
      expect(again.body.added).toBe(0); expect(again.body.items.length).toBe(r.body.items.length);
      expect(r.body.items.every((i) => i.origin === 'PLAN' && i.status === 'NOT_STARTED' && i.sourceShareId === mine)).toBe(true);
      expect((await call(H.parcours, { as: B })).body.items).toEqual([]);   // B sees nothing of A
    });
    it('status changes are kept in an append-only history; another account cannot read or change the item', async () => {
      const [item] = (await call(H.parcours, { as: A })).body.items;
      expect((await call(H.parcours, { method: 'POST', as: A, body: { action: 'status', id: item.id, status: 'SUBMITTED' } })).body.item.status).toBe('SUBMITTED');
      await call(H.parcours, { method: 'POST', as: A, body: { action: 'status', id: item.id, status: 'WAITING_ORGANIZATION' } });
      expect((await call(H.parcours, { method: 'POST', as: A, body: { action: 'status', id: item.id, status: 'APPROVED_BY_ADA' } })).statusCode).toBe(400);
      expect((await call(H.parcours, { method: 'POST', as: B, body: { action: 'status', id: item.id, status: 'CLOSED' } })).statusCode).toBe(404);
      expect((await call(H.parcours, { as: B, query: { history: item.id } })).statusCode).toBe(404);
      const h = (await call(H.parcours, { as: A, query: { history: item.id } })).body.events.map((e) => [e.kind, e.toStatus]);
      expect(h).toEqual([['CREATED', 'NOT_STARTED'], ['STATUS', 'SUBMITTED'], ['STATUS', 'WAITING_ORGANIZATION']]);
      let err = null; try { await db.execute(sql`UPDATE "ParcoursEvent" SET "toStatus" = 'CLOSED' WHERE "itemId" = ${item.id}`); } catch (e) { err = e?.cause?.code || e?.code; }
      expect(String(err), 'the database refuses to rewrite the history').toMatch(/^23/);
    });
    it('a deadline needs its official source (https, recognised public site); the database refuses a deadline without one', async () => {
      const [item] = (await call(H.parcours, { as: A })).body.items;
      expect((await call(H.parcours, { method: 'POST', as: A, body: { action: 'deadline', id: item.id, dueDate: '2099-01-31', dueSourceUrl: 'https://evil.example/x' } })).body.error).toBe('DEADLINE_SOURCE_REQUIRED');
      expect((await call(H.parcours, { method: 'POST', as: A, body: { action: 'deadline', id: item.id, dueDate: '2099-01-31' } })).body.error).toBe('DEADLINE_SOURCE_REQUIRED');
      const ok = await call(H.parcours, { method: 'POST', as: A, body: { action: 'deadline', id: item.id, dueDate: '2099-01-31', dueSourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F1' } });
      expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200); expect(ok.body.item.dueSourceUrl).toMatch(/^https:\/\/www\.service-public\.fr/);
      let err = null; try { await db.execute(sql`UPDATE "ParcoursItem" SET "dueSourceUrl" = NULL WHERE id = ${item.id}`); } catch (e) { err = e?.cause?.code || e?.code; }
      expect(String(err)).toBe('23514');
      expect((await call(H.parcours, { method: 'POST', as: A, body: { action: 'deadline', id: item.id, dueDate: null } })).body.item.dueDate).toBeNull();
    });
    it('a manual step, a private note, deletion', async () => {
      const m = await call(H.parcours, { method: 'POST', as: A, body: { action: 'add', title: 'Appeler la CAF pour mon dossier' } }); expect(m.statusCode).toBe(201);
      expect((await call(H.parcours, { method: 'POST', as: A, body: { action: 'note', id: m.body.item.id, note: 'Numéro de dossier noté' } })).body.item.note).toBe('Numéro de dossier noté');
      expect((await call(H.parcours, { method: 'DELETE', as: B, body: { id: m.body.item.id } })).statusCode).toBe(404);
      expect((await call(H.parcours, { method: 'DELETE', as: A, body: { id: m.body.item.id } })).statusCode).toBe(200);
    });
  });

  describe('favourites and history', () => {
    it('only a PUBLISHED record can be a favourite; a record that stops being public stays listed without its content', async () => {
      const aid = `pkg2-aide-${TS}`; ids.aides.push(aid);
      await db.execute(sql`INSERT INTO "Aide" (id, slug, titre, statut, launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url, "updatedAt") VALUES (${aid}, ${aid}, 'Aide PKG2', 'publie', true, 'VERIFIED', 'rev@example.test', true, 'official', NOW() - interval '3 days', 'https://www.service-public.fr/x', NOW())`);
      const hidden = `pkg2-aide-h-${TS}`; ids.aides.push(hidden);
      await db.execute(sql`INSERT INTO "Aide" (id, slug, titre, statut, data_origin, source_url, "updatedAt") VALUES (${hidden}, ${hidden}, 'Aide cachée', 'publie', 'official', 'https://www.service-public.fr/y', NOW())`);
      expect((await call(H.favorites, { method: 'POST', as: A, body: { entityType: 'aide', entityId: hidden } })).statusCode).toBe(404);
      expect((await call(H.favorites, { method: 'POST', as: A, body: { entityType: 'aide', entityId: aid } })).statusCode).toBe(200);
      expect((await call(H.favorites, { method: 'POST', as: A, body: { entityType: 'aide', entityId: aid } })).statusCode).toBe(200);   // idempotent
      let fav = (await call(H.favorites, { as: A })).body.favorites; expect(fav).toEqual([expect.objectContaining({ entityId: aid, available: true, title: 'Aide PKG2' })]);
      await db.execute(sql`UPDATE "Aide" SET publication_hold = 'PRIVACY_REVIEW' WHERE id = ${aid}`);
      fav = (await call(H.favorites, { as: A })).body.favorites; expect(fav).toEqual([expect.objectContaining({ entityId: aid, available: false, title: null })]);
      expect((await call(H.favorites, { as: B })).body.favorites).toEqual([]);
    });
    it('history is OFF by default (nothing is kept); on, entries are kept and capped; off again erases them all', async () => {
      expect((await call(H.history, { method: 'POST', as: A, body: { kind: 'search', label: 'rsa' } })).body.recorded).toBe(false);
      expect((await db.execute(sql`SELECT count(*)::int n FROM "CitizenHistoryEntry" WHERE "userId" = ${A.id}`)).rows[0].n).toBe(0);
      expect((await call(H.history, { method: 'PUT', as: A, body: { enabled: true } })).body.enabled).toBe(true);
      for (const label of ['rsa', 'apl', 'aah']) expect((await call(H.history, { method: 'POST', as: A, body: { kind: 'search', label } })).body.recorded).toBe(true);
      expect((await call(H.history, { method: 'POST', as: A, body: { kind: 'tracking-pixel', label: 'x' } })).statusCode).toBe(400);
      expect((await call(H.history, { as: A })).body.entries.map((e) => e.label).sort()).toEqual(['aah', 'apl', 'rsa']);   // newest first; entries written in the same millisecond have no defined order
      expect((await call(H.history, { as: B })).body.entries).toEqual([]);
      const off = await call(H.history, { method: 'PUT', as: A, body: { enabled: false } }); expect(off.body.erased).toBe(3);
      expect((await db.execute(sql`SELECT count(*)::int n FROM "CitizenHistoryEntry" WHERE "userId" = ${A.id}`)).rows[0].n).toBe(0);
    });
  });

  describe('Mon Coffre', () => {
    it('upload -> list (decrypted name, no storage key) -> download identical bytes; the stored blob is not the plaintext; B sees nothing', async () => {
      const up = await call(H.coffre, { method: 'POST', as: A, body: { category: 'identite', originalName: 'Carte d’identité.pdf', mimeType: 'application/pdf', fileBase64: PDF.toString('base64') } });
      expect(up.statusCode, JSON.stringify(up.body)).toBe(201); expect(up.body.document).toMatchObject({ name: 'Carte d’identité.pdf', mimeType: 'application/pdf', scanStatus: 'NOT_SCANNED' });
      const list = await call(H.coffre, { as: A }); expect(list.body.documents.length).toBe(1);
      expect(JSON.stringify(list.body)).not.toMatch(/pkg2-key-|storageKey|filenameEncrypted|checksumSha256/);
      const [row] = (await db.execute(sql`SELECT "storageKey" k FROM "CitizenDocument" WHERE id = ${up.body.document.id}`)).rows;
      expect(BLOBS.get(row.k).includes(Buffer.from('synthetic pkg2 document'))).toBe(false);
      const dl = await call(H.coffre, { as: A, query: { download: up.body.document.id } });
      expect(dl.statusCode).toBe(200); expect(Buffer.compare(Buffer.from(dl.body), PDF)).toBe(0); expect(dl.headers['Content-Disposition']).toMatch(/^attachment;/); expect(dl.headers['X-Content-Type-Options']).toBe('nosniff');
      expect((await call(H.coffre, { as: B })).body.documents).toEqual([]);
      expect((await call(H.coffre, { as: B, query: { download: up.body.document.id } })).statusCode).toBe(404);
      expect((await call(H.coffre, { method: 'DELETE', as: B, body: { id: up.body.document.id } })).statusCode).toBe(404);
    });
    it('the type comes from the content: a renamed executable, a PNG declared as PDF and an unknown type are refused; size and quota limits hold', async () => {
      const exe = Buffer.from('MZ\x90\x00 fake executable');
      expect((await call(H.coffre, { method: 'POST', as: A, body: { category: 'autre', originalName: 'facture.pdf', mimeType: 'application/pdf', fileBase64: exe.toString('base64') } })).statusCode).toBe(415);
      expect((await call(H.coffre, { method: 'POST', as: A, body: { category: 'autre', originalName: 'x.pdf', mimeType: 'application/pdf', fileBase64: PNG.toString('base64') } })).body.error).toBe('TYPE_MISMATCH');
      expect((await call(H.coffre, { method: 'POST', as: A, body: { category: 'secret', originalName: 'x.png', fileBase64: PNG.toString('base64') } })).body.error).toBe('INVALID_CATEGORY');
      // R15 (HDS fail-closed): no qualified health-data hosting, so the « Santé » category is refused before anything is stored
      const health = await call(H.coffre, { method: 'POST', as: A, body: { category: 'sante', originalName: 'certificat.pdf', fileBase64: PDF.toString('base64') } });
      expect(health.statusCode).toBe(422); expect(health.body.error).toBe('HEALTH_DOCUMENTS_NOT_ACCEPTED');
      const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024)]);
      expect((await call(H.coffre, { method: 'POST', as: A, body: { category: 'autre', originalName: 'big.pdf', fileBase64: big.toString('base64') } })).statusCode).not.toBe(201);
      let err = null; try { await db.execute(sql`INSERT INTO "CitizenDocument" (id, "userId", category, "filenameEncrypted", "mimeType", "byteLength", "checksumSha256", "storageKey") VALUES (${'raw-' + TS}, ${A.id}, 'autre', 'x', 'application/pdf', 0, 'x', 'k')`); } catch (e) { err = e?.cause?.code || e?.code; }
      expect(String(err), 'the database refuses an empty or oversized document row').toBe('23514');
    });
    it('deleting a document purges its encrypted blob', async () => {
      const up = await call(H.coffre, { method: 'POST', as: A, body: { category: 'revenus', originalName: 'avis.png', fileBase64: PNG.toString('base64') } });
      const [row] = (await db.execute(sql`SELECT "storageKey" k FROM "CitizenDocument" WHERE id = ${up.body.document.id}`)).rows; expect(BLOBS.has(row.k)).toBe(true);
      expect((await call(H.coffre, { method: 'DELETE', as: A, body: { id: up.body.document.id } })).statusCode).toBe(200);
      expect(BLOBS.has(row.k)).toBe(false);
    });
  });

  it('the Mon Espace summary counts only the session account', async () => {
    const s = (await call(H.espace, { as: A })).body.summary;
    expect(s.parcours.total).toBeGreaterThan(0); expect(s.documents).toBe(1); expect(s.favorites).toBe(1); expect(s.dossiers).toBeGreaterThan(0);
    expect((await call(H.espace, { as: B })).body.summary).toMatchObject({ documents: 0, favorites: 0, parcours: { total: 0 } });
  });

  it('DSR: the export contains Parcours, favourites, history and Coffre metadata (no storage key); account erasure removes every row and purges the Coffre blobs', async () => {
    const svc = privacy.createPrivacyRightsService({ db, cryptoLib: await import('node:crypto') });
    const out = await svc.getExportData(A.id);
    expect(out.parcours.length).toBeGreaterThan(0); expect(out.parcoursHistory.length).toBeGreaterThan(0); expect(out.favorites.length).toBe(1); expect(out.coffreDocuments.length).toBe(1);
    expect(JSON.stringify(out.coffreDocuments)).not.toMatch(/storageKey|filenameEncrypted/);
    const keys = (await db.execute(sql`SELECT "storageKey" k FROM "CitizenDocument" WHERE "userId" = ${A.id}`)).rows.map((r) => r.k);
    expect(keys.length).toBe(1);
    const req = await svc.requestDeletion(A.id);
    await svc.updateDsrRequestStatus(req.id, 'APPROVED');   // the human review step of DSR_EXECUTION_POLICY.DELETE
    await svc.executeApprovedDeletion(req.id);
    for (const t of ['ParcoursItem', 'ParcoursEvent', 'CitizenFavorite', 'CitizenHistoryEntry', 'CitizenDocument']) {
      expect((await db.execute(sql`SELECT count(*)::int n FROM ${sql.identifier(t)} WHERE "userId" = ${A.id}`)).rows[0].n, t).toBe(0);
    }
    expect(keys.every((k) => !BLOBS.has(k)), 'Coffre blobs purged after the erasure commit').toBe(true);
  });
});
