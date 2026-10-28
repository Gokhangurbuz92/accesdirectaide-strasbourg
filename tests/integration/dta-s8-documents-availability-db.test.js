/**
 * DTA S8 — REAL PostgreSQL, real handlers, real pro JWTs, real envelope encryption, a Map-backed object store (no network).
 *   1. SECURE DOCUMENTS: upload -> list (decrypted name, no storage key) -> download -> identical bytes; refusals (type, size, empty); hostile file names.
 *   2. ORGANIZATION ISOLATION: each organization sees and downloads only its own documents; no grant => uniform 404 on every surface; a token for one dossier never opens another.
 *   3. REVOCATION: removing one organization stops its list, its upload and its OLD download capability at once; the other organization is unaffected.
 *   4. ERASURE: the citizen's erasure and the retention purge delete the encrypted blobs, not only the row.
 *   5. OPENING HOURS: invalid payloads are refused with nothing changed; concurrent saves never mix two weeks.
 * Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise. Synthetic data only.
 */
import { vi } from 'vitest';
vi.stubEnv('AUTH_SECRET', 'test-auth-secret-dta-s8-docs');
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));
const STORE = vi.hoisted(() => ({ blobs: new Map(), n: 0 }));
vi.mock('../../api/lib/storage.js', () => ({
  storage: {
    upload: async (buf) => { STORE.n += 1; const k = `s8-key-${STORE.n}`; STORE.blobs.set(k, Buffer.from(buf)); return k; },
    download: async (k) => { if (!STORE.blobs.has(k)) throw new Error('missing'); return STORE.blobs.get(k); },
    delete: async (k) => { STORE.blobs.delete(k); },
  },
}));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const SA = `s8d-sa-${TS}`, SB = `s8d-sb-${TS}`, SC = `s8d-sc-${TS}`, SV = `s8d-sv-${TS}`;
const U = (n, sid) => ({ id: `s8d-${n}-${TS}`, email: `${n}-${TS}@example.test`, sid, role: 'STRUCTURE_ADMIN' });
const PA = U('pa', SA), PB = U('pb', SB), PC = U('pc', SC), PV = U('pv', SV);
const created = [];
const PDF = Buffer.from('%PDF-1.4 synthetic S8 justificatif');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('synthetic png')]);

describe.skipIf(!hasDatabase)('DTA S8 secure documents, erasure and opening hours (real DB)', () => {
  let db, auth, H;
  const tok = (u) => `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: u.sid, role: u.role })}`;
  const pro = (u) => ({ authorization: tok(u) });
  const invoke = async (handler, { method = 'GET', url, body, headers = {} }) => { const r = mk(); await handler({ method, url, query: {}, body, headers: { host: 'x', ...headers } }, r); return r; };

  async function newShare() {
    const r = await invoke(H.create, { method: 'POST', url: '/api/share/create', body: { situation: { zipCode: '67000' }, results: { rights: [] } } });
    expect(r.statusCode).toBe(200);
    created.push(r.body.shareId);
    return { id: r.body.shareId, owner: r.body.ownerSecret };
  }
  const own = (s, action, extra = {}) => invoke(H.grants, { method: 'POST', url: '/api/public/dossier-grants', body: { shareId: s.id, action, ...extra }, headers: { 'x-share-owner-secret': s.owner } });
  async function grantTo(s, u) {
    const inv = await own(s, 'invite', { structureId: u.sid });
    expect(inv.statusCode).toBe(201);
    expect((await invoke(H.redeem, { method: 'POST', url: '/api/pro/dossier/redeem', body: { shareId: s.id, inviteToken: inv.body.inviteToken }, headers: pro(u) })).statusCode).toBe(200);
  }
  const upload = (u, s, over = {}) => invoke(H.upload, { method: 'POST', url: '/api/pro/dossier/upload-secure', body: { shareId: s.id, originalName: 'justificatif.pdf', mimeType: 'application/pdf', fileBase64: PDF.toString('base64'), ...over }, headers: pro(u) });
  const dossier = (u, s) => invoke(H.dossier, { url: `/api/pro/dossier?shareId=${s.id}`, headers: pro(u) });
  const download = (token) => invoke(H.download, { method: 'POST', url: '/api/download', body: { token } });
  const rules = async (sid) => (await db.execute(sql`SELECT weekday, "startTime", "endTime" FROM "ProAvailabilityRule" WHERE "structureId" = ${sid} ORDER BY weekday, "startTime"`)).rows.map((r) => `${r.weekday}|${r.startTime}-${r.endTime}`);
  const putHours = (u, slots) => invoke(H.availability, { method: 'PUT', url: '/api/pro/availability', body: { slots_json: slots, timezone: 'Europe/Paris' }, headers: pro(u) });

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); auth = await import('../../api/_utils/auth.js');
    H = {
      create: (await import('../../api/_handlers/share/create.js')).default, redeem: (await import('../../api/_handlers/pro/dossier/redeem.js')).default,
      dossier: (await import('../../api/_handlers/pro/dossier.js')).default, upload: (await import('../../api/_handlers/pro/dossier/upload-secure.js')).default,
      download: (await import('../../api/_handlers/download.js')).default, grants: (await import('../../api/_handlers/public/dossier-grants.js')).default,
      revoke: (await import('../../api/_handlers/public/dossier-revoke.js')).default, availability: (await import('../../api/_handlers/pro/availability.js')).default,
      purge: (await import('../../api/_handlers/cron/gdpr-purge.js')).default,
    };
    for (const [sid, n] of [[SA, 'A'], [SB, 'B'], [SC, 'C'], [SV, 'V']]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt") VALUES (${sid}, ${'CCAS S8 ' + n}, ${'s8d-slug-' + sid}, 'association', '1 rue test', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);   // PKG-4 / E01: receiving organizations are verified
    }
    for (const u of [PA, PB, PC, PV]) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${u.id}, ${u.email}, 'x', ${u.sid}, ${u.role}, 'active', NOW(), NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    if (created.length) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${sql.join(created.map((i) => sql`${i}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" IN (${SA}, ${SB}, ${SC}, ${SV})`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'structureId' IN (${SA}, ${SB}, ${SC}, ${SV})`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${SA}, ${SB}, ${SC}, ${SV})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${SA}, ${SB}, ${SC}, ${SV})`);
  });

  it('upload -> list -> download returns the identical bytes; the list never exposes the storage key, the encrypted name or the checksum; the stored blob is not the plaintext', async () => {
    const s = await newShare(); await grantTo(s, PA);
    const up = await upload(PA, s, { originalName: 'attestation CAF (synthétique).pdf' });
    expect(up.statusCode).toBe(200);
    const d = await dossier(PA, s);
    expect(d.statusCode).toBe(200);
    expect(d.headers['Cache-Control']).toBe('no-store');
    expect(d.body.dossier.results._files).toBeUndefined();
    expect(d.body.documents).toHaveLength(1);
    const doc = d.body.documents[0];
    expect(doc).toMatchObject({ name: 'attestation CAF (synthétique).pdf', mimeType: 'application/pdf', byteLength: PDF.length });
    expect(JSON.stringify(d.body)).not.toMatch(/s8-key-|filenameEncrypted|checksumSha256|storageKey/);
    const dl = await download(doc.downloadToken);
    expect(dl.statusCode).toBe(200);
    expect(Buffer.compare(dl.body, PDF)).toBe(0);
    expect(dl.headers['Content-Disposition']).toMatch(/^attachment; filename="/);
    expect(dl.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(dl.headers['Cache-Control']).toBe('no-store');
    const stored = [...STORE.blobs.values()].find((b) => b.length > PDF.length);
    expect(stored).toBeTruthy();
    expect(stored.includes(PDF)).toBe(false);
    expect(JSON.stringify((await db.execute(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${s.id}`)).rows[0].results)).not.toContain('attestation CAF');   // the file name is encrypted at rest
  });

  it('refusals: type outside pdf/jpeg/png (415), empty (400/413), >10 MB (413), unknown dossier (404), anonymous (401) - and nothing is stored for any of them', async () => {
    const s = await newShare(); await grantTo(s, PA);
    const before = STORE.blobs.size;
    expect((await upload(PA, s, { mimeType: 'image/webp' })).statusCode).toBe(415);
    expect((await upload(PA, s, { mimeType: 'text/html' })).statusCode).toBe(415);
    // R12 (R13): the bytes decide — HTML declared as PDF, a PDF declared as PNG and octet-stream with non-PDF/PNG/JPEG bytes are refused
    expect((await upload(PA, s, { fileBase64: Buffer.from('<html><script>x</script>').toString('base64') })).statusCode).toBe(415);
    expect((await upload(PA, s, { mimeType: 'image/png' })).statusCode).toBe(415);
    expect((await upload(PA, s, { mimeType: 'application/octet-stream', fileBase64: Buffer.from('MZ\x90\x00binary').toString('base64') })).statusCode).toBe(415);
    expect([400, 413]).toContain((await upload(PA, s, { fileBase64: '' })).statusCode);
    expect((await upload(PA, s, { fileBase64: Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString('base64') })).statusCode).toBe(413);
    expect((await upload(PA, { id: 'does-not-exist' })).statusCode).toBe(404);
    expect((await invoke(H.upload, { method: 'POST', url: '/api/pro/dossier/upload-secure', body: { shareId: s.id, originalName: 'x.pdf', mimeType: 'application/pdf', fileBase64: PDF.toString('base64') } })).statusCode).toBe(401);
    expect(STORE.blobs.size).toBe(before);
    expect((await dossier(PA, s)).body.documents).toEqual([]);
  });

  it('hostile file names cannot break the download header (CR/LF/quotes) and PNG is accepted', async () => {
    const s = await newShare(); await grantTo(s, PA);
    expect((await upload(PA, s, { originalName: 'a"b\r\nSet-Cookie: x=1.png', mimeType: 'image/png', fileBase64: PNG.toString('base64') })).statusCode).toBe(200);
    const doc = (await dossier(PA, s)).body.documents[0];
    expect(doc.name).not.toMatch(/[\r\n"]/);
    const dl = await download(doc.downloadToken);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['Content-Disposition']).not.toMatch(/[\r\n]/);
    expect(dl.headers['Content-Type']).toBe('image/png');
  });

  it('ORGANIZATION ISOLATION: A and B on one dossier each see only their own documents; C (no grant) gets a uniform 404 on the dossier, upload and the other organizations\' capabilities still work only for their file', async () => {
    const s = await newShare(); await grantTo(s, PA); await grantTo(s, PB);
    expect((await upload(PA, s, { originalName: 'doc-A.pdf' })).statusCode).toBe(200);
    expect((await upload(PB, s, { originalName: 'doc-B.pdf', mimeType: 'image/png', fileBase64: PNG.toString('base64') })).statusCode).toBe(200);
    const a = (await dossier(PA, s)).body.documents; const b = (await dossier(PB, s)).body.documents;
    expect(a.map((x) => x.name)).toEqual(['doc-A.pdf']);
    expect(b.map((x) => x.name)).toEqual(['doc-B.pdf']);
    expect(Buffer.compare((await download(a[0].downloadToken)).body, PDF)).toBe(0);
    expect(Buffer.compare((await download(b[0].downloadToken)).body, PNG)).toBe(0);
    const c = await dossier(PC, s);
    expect(c.statusCode).toBe(404);
    expect(JSON.stringify(c.body)).not.toMatch(/doc-A|doc-B|documents/);
    expect((await upload(PC, s)).statusCode).toBe(404);
    const other = await newShare(); await grantTo(other, PA);
    expect((await dossier(PA, other)).body.documents).toEqual([]);
    expect((await download(a[0].downloadToken.slice(0, -3) + 'xyz')).statusCode).toBe(404);
    expect((await download('')).statusCode).toBe(404);
  });

  it('REVOCATION: removing organization A stops its list, its upload and its previously issued download capability at once; B keeps working', async () => {
    const s = await newShare(); await grantTo(s, PA); await grantTo(s, PB);
    await upload(PA, s, { originalName: 'doc-A.pdf' }); await upload(PB, s, { originalName: 'doc-B.pdf' });
    const aDoc = (await dossier(PA, s)).body.documents[0]; const bDoc = (await dossier(PB, s)).body.documents[0];
    expect((await download(aDoc.downloadToken)).statusCode).toBe(200);
    expect((await own(s, 'revoke', { structureId: SA })).statusCode).toBe(200);
    const denied = [await dossier(PA, s), await upload(PA, s), await download(aDoc.downloadToken)];
    expect(denied.map((r) => r.statusCode)).toEqual([404, 404, 404]);
    expect(denied[2].body).toEqual({ error: 'Document not found' });
    expect((await dossier(PB, s)).statusCode).toBe(200);
    expect((await download(bDoc.downloadToken)).statusCode).toBe(200);
  });

  it('ERASURE: the citizen\'s erasure deletes the row AND the encrypted blobs; the old capability is dead; a second erasure is a 404', async () => {
    const s = await newShare(); await grantTo(s, PA);
    await upload(PA, s); await upload(PA, s, { mimeType: 'image/png', fileBase64: PNG.toString('base64'), originalName: 'p.png' });
    const docs = (await dossier(PA, s)).body.documents;
    expect(docs).toHaveLength(2);
    const keys = (await db.execute(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${s.id}`)).rows[0].results._files.map((f) => f.storageKey);
    expect(keys).toHaveLength(2);
    for (const k of keys) expect(STORE.blobs.has(k)).toBe(true);
    const r = await invoke(H.revoke, { method: 'POST', url: '/api/public/dossier-revoke', body: { shareId: s.id }, headers: { 'x-share-owner-secret': s.owner } });
    expect(r.statusCode).toBe(200);
    for (const k of keys) expect(STORE.blobs.has(k), 'blob ' + k).toBe(false);
    expect((await download(docs[0].downloadToken)).statusCode).toBe(404);
    expect((await invoke(H.revoke, { method: 'POST', url: '/api/public/dossier-revoke', body: { shareId: s.id }, headers: { 'x-share-owner-secret': s.owner } })).statusCode).toBe(404);
  });

  it('a REFUSED erasure (wrong secret) leaves the blobs untouched', async () => {
    const s = await newShare(); await grantTo(s, PA); await upload(PA, s);
    const keys = (await db.execute(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${s.id}`)).rows[0].results._files.map((f) => f.storageKey);
    const r = await invoke(H.revoke, { method: 'POST', url: '/api/public/dossier-revoke', body: { shareId: s.id }, headers: { 'x-share-owner-secret': 'not-the-owner-secret' } });
    expect(r.statusCode).toBe(404);
    for (const k of keys) expect(STORE.blobs.has(k)).toBe(true);
  });

  it('RETENTION: the purge of an expired dossier deletes its blobs; a live dossier\'s blobs stay', async () => {
    const dead = await newShare(); await grantTo(dead, PA); await upload(PA, dead);
    const live = await newShare(); await grantTo(live, PA); await upload(PA, live);
    const keysOf = async (s) => (await db.execute(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${s.id}`)).rows[0].results._files.map((f) => f.storageKey);
    const deadKeys = await keysOf(dead); const liveKeys = await keysOf(live);
    await db.execute(sql`UPDATE "SharedDiagnostic" SET "expiresAt" = now() - interval '1 day' WHERE id = ${dead.id}`);
    const secret = process.env.CRON_SECRET;
    expect(secret, 'CRON_SECRET must be provided by the integration environment (same as gdpr-purge-db.test.js)').toBeTruthy();
    const r = await invoke(H.purge, { method: 'GET', url: '/api/cron/gdpr-purge', headers: { 'x-cron-secret': secret } });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDiagnostic" WHERE id = ${dead.id}`)).rows[0].n).toBe(0);
    for (const k of deadKeys) expect(STORE.blobs.has(k), 'expired blob ' + k).toBe(false);
    for (const k of liveKeys) expect(STORE.blobs.has(k), 'live blob ' + k).toBe(true);
  });

  it('OPENING HOURS: invalid payloads are refused and the stored week is unchanged; a valid week is replaced atomically', async () => {
    expect((await putHours(PV, { mon: ['09:00-12:00', '13:00-17:00'], sat: ['10:00-11:30'] })).statusCode).toBe(200);
    const week = await rules(SV);
    expect(week).toEqual(['1|09:00-12:00', '1|13:00-17:00', '6|10:00-11:30']);
    for (const bad of [{ mon: ['9h-12h'] }, { mon: ['12:00-09:00'] }, { mon: ['09:00-12:00', '11:00-13:00'] }, { xyz: ['09:00-12:00'] }]) {
      const r = await putHours(PV, bad);
      expect(r.statusCode, JSON.stringify(bad)).toBe(400);
      expect(typeof r.body.error).toBe('string');
      expect(await rules(SV)).toEqual(week);
    }
    expect((await putHours(PV, { tue: ['08:00-10:00'] })).statusCode).toBe(200);
    expect(await rules(SV)).toEqual(['2|08:00-10:00']);
    expect((await putHours(PV, { mon: [] })).statusCode).toBe(200);
    expect(await rules(SV)).toEqual([]);
  });

  it('OPENING HOURS: ten concurrent saves of two different weeks leave exactly ONE of the two weeks (never a mix or duplicates)', async () => {
    const weekA = { mon: ['09:00-12:00'], tue: ['09:00-12:00'], wed: ['09:00-12:00'] };
    const weekB = { thu: ['14:00-18:00'], fri: ['14:00-18:00'] };
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => putHours(PC, i % 2 ? weekB : weekA)));
    expect(rs.map((r) => r.statusCode)).toEqual(Array(10).fill(200));
    const final = await rules(SC);
    const A = ['1|09:00-12:00', '2|09:00-12:00', '3|09:00-12:00']; const B = ['4|14:00-18:00', '5|14:00-18:00'];
    expect([JSON.stringify(A), JSON.stringify(B)]).toContain(JSON.stringify(final));
  });

  it('OPENING HOURS are scoped to the caller\'s structure: saving for one organization never touches another', async () => {
    await putHours(PA, { mon: ['09:00-12:00'] });
    await putHours(PB, { tue: ['10:00-11:00'] });
    expect(await rules(SA)).toEqual(['1|09:00-12:00']);
    expect(await rules(SB)).toEqual(['2|10:00-11:00']);
    const anon = await invoke(H.availability, { method: 'PUT', url: '/api/pro/availability', body: { slots_json: { mon: [] } } });
    expect(anon.statusCode).toBe(401);
    expect(await rules(SA)).toEqual(['1|09:00-12:00']);
  });
});
