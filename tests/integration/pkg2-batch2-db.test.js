/**
 * PKG-2 batch 2 on REAL PostgreSQL (migrations 0016 + 0017), through the real handlers / cron:
 *  R16  the citizen sees which ORGANISATION did what with an account-owned dossier (written by the real logProAudit; no staff id, no IP)
 *  C17  the documents organisations attached: listed with their organisation, downloaded (identical bytes), removed by the person (blob purged); other accounts get 404
 *  share-from-Coffre  only to an organisation with an ACTIVE grant; only that organisation's projection contains it; a revoked grant refuses
 *  C08  reminders of SOURCED deadlines at J-1/J-7: exactly once (claimed row), the message names no step, delivery recorded honestly, closed steps and other windows ignored
 * Object storage is an in-memory map; the mailer is the in-memory 'test' provider. Synthetic data only; skipped without DATABASE_URL.
 */
import crypto from 'node:crypto';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
const BLOBS = vi.hoisted(() => new Map());
vi.mock('../../api/lib/storage.js', () => ({
  storage: {
    upload: async (buf) => { const k = `b2-key-${BLOBS.size}-${Math.random().toString(36).slice(2)}`; BLOBS.set(k, Buffer.from(buf)); return k; },
    download: async (k) => { if (!BLOBS.has(k)) throw new Error('missing blob'); return BLOBS.get(k); },
    delete: async (k) => { BLOBS.delete(k); },
  },
}));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const A = { id: `b2-a-${TS}`, email: `b2-a-${TS}@example.test` };
const B = { id: `b2-b-${TS}`, email: `b2-b-${TS}@example.test` };
const S1 = `b2-s1-${TS}`; const S2 = `b2-s2-${TS}`; const PRO = `b2-pro-${TS}`; const SHARE = `b2-share-${TS}`;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('b2 synthetic '.repeat(40))]);
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('PKG-2 batch 2 (real DB)', () => {
  let db, userAuth, H, keys, auth, access, mailer, cron, svc;
  const cookie = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const call = async (h, { method = 'GET', body, query = {}, as } = {}) => { const r = mk(); await h({ method, url: '/api/x', query, body, headers: { host: 'localhost', ...(as ? { cookie: cookie(as) } : {}) } }, r); return r; };
  const results = async () => (await db.execute(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${SHARE}`)).rows[0].results;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    userAuth = await import('../../api/_utils/user-auth.js'); keys = await import('../../api/lib/data-keys.js'); auth = await import('../../api/_utils/auth.js');
    access = await import('../../api/_utils/share-access.js'); mailer = await import('../../api/_utils/mailer.js'); cron = await import('../../api/_handlers/cron/parcours-reminder.js');
    svc = await import('../../api/_services/citizen-account.js');
    H = { dossier: (await import('../../api/_handlers/citizen/dossier.js')).default, coffre: (await import('../../api/_handlers/citizen/coffre.js')).default, parcours: (await import('../../api/_handlers/citizen/parcours.js')).default };
    for (const u of [A, B]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
    for (const [id, nom] of [[S1, 'Structure Alpha'], [S2, 'Structure Beta']]) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt") VALUES (${id}, ${nom}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${PRO}, ${PRO + '@example.test'}, 'x', 'PRO', 'active', ${S1}, false, NOW())`);
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${SHARE}, NOW() + interval '7 days', '{}'::jsonb, '{}'::jsonb, 0, ${'h-' + TS}, ${'t-' + TS}, 'GUEST_SHARE', ${A.id})`);
    for (const s of [S1, S2]) await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId") VALUES (${'g-' + s}, ${SHARE}, ${s}, ${PRO})`);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'shareId' = ${SHARE}`);
    await db.execute(sql`DELETE FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${SHARE}`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${SHARE}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${PRO}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${S1}, ${S2})`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${A.id}, ${B.id})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${A.id}, ${B.id})`);
  });

  it('R16: the access log names the ORGANISATION and the action, no staff id or IP leaves the server; other accounts get 404', async () => {
    await auth.logProAudit('DOSSIER_ACCESS_GRANTED', PRO, S1, { shareId: SHARE, via: 'invite' }, '10.1.2.3');
    await auth.logProAudit('DOSSIER_VIEWED', PRO, S1, { shareId: SHARE }, '10.1.2.3');
    await auth.logProAudit('LOGIN', PRO, S1, { shareId: SHARE }, '10.1.2.3');   // not a dossier action: never listed
    const r = await call(H.dossier, { as: A, query: { shareId: SHARE, view: 'access' } });
    expect(r.statusCode).toBe(200);
    expect(r.body.events.map((e) => [e.organization, e.action]).sort()).toEqual([['Structure Alpha', 'DOSSIER_ACCESS_GRANTED'], ['Structure Alpha', 'DOSSIER_VIEWED']]);   // newest first; rows of the same millisecond have no defined order
    expect(JSON.stringify(r.body)).not.toMatch(new RegExp(`${PRO}|10\\.1\\.2\\.3|ip_hash`));
    expect((await call(H.dossier, { as: B, query: { shareId: SHARE, view: 'access' } })).statusCode).toBe(404);
    expect((await call(H.dossier, { query: { shareId: SHARE, view: 'access' } })).statusCode).toBe(401);
  });

  it('C17: an organisation document is listed with its organisation, downloaded identical, removed by the person (blob purged); B cannot touch it', async () => {
    const fileId = crypto.randomUUID(); const ctx = `file:${SHARE}:${fileId}`;
    const key = `b2-org-${TS}`; BLOBS.set(key, keys.sealBuffer(PDF, { purpose: 'dossier-file', context: ctx }));
    const entry = { id: fileId, structureId: S1, storageKey: key, filenameEncrypted: keys.sealText('compte-rendu.pdf', { purpose: 'dossier-filename', context: ctx }), mimeType: 'application/pdf', uploadedAt: new Date().toISOString(), byteLength: PDF.length, checksumSha256: crypto.createHash('sha256').update(PDF).digest('hex'), encrypted: true };
    await db.execute(sql`UPDATE "SharedDiagnostic" SET results = jsonb_set(results, '{_files}', ${JSON.stringify([entry])}::jsonb) WHERE id = ${SHARE}`);
    const list = await call(H.dossier, { as: A, query: { shareId: SHARE, view: 'documents' } });
    expect(list.body.documents).toEqual([expect.objectContaining({ id: fileId, name: 'compte-rendu.pdf', organization: 'Structure Alpha' })]);
    expect(JSON.stringify(list.body)).not.toMatch(/b2-org-|storageKey|filenameEncrypted/);
    const dl = await call(H.dossier, { as: A, query: { shareId: SHARE, download: fileId } });
    expect(dl.statusCode).toBe(200); expect(Buffer.compare(Buffer.from(dl.body), PDF)).toBe(0);
    expect((await call(H.dossier, { as: B, query: { shareId: SHARE, download: fileId } })).statusCode).toBe(404);
    expect((await call(H.dossier, { method: 'DELETE', as: B, body: { shareId: SHARE, fileId } })).statusCode).toBe(404);
    expect((await call(H.dossier, { method: 'DELETE', as: A, body: { shareId: SHARE, fileId } })).statusCode).toBe(200);
    expect((await results())._files).toEqual([]); expect(BLOBS.has(key)).toBe(false);
  });

  it('share-from-Coffre: only to an organisation with an ACTIVE grant; only that organisation sees it; a revoked grant refuses', async () => {
    const up = await call(H.coffre, { method: 'POST', as: A, body: { category: 'logement', originalName: 'bail.pdf', fileBase64: PDF.toString('base64') } }); expect(up.statusCode).toBe(201);
    const doc = up.body.document.id;
    expect((await call(H.coffre, { method: 'POST', as: A, body: { action: 'share', documentId: doc, shareId: SHARE, structureId: 'no-such-structure' } })).body.error).toBe('NO_ACTIVE_GRANT');
    expect((await call(H.coffre, { method: 'POST', as: B, body: { action: 'share', documentId: doc, shareId: SHARE, structureId: S1 } })).statusCode).toBe(404);
    const ok = await call(H.coffre, { method: 'POST', as: A, body: { action: 'share', documentId: doc, shareId: SHARE, structureId: S1 } }); expect(ok.statusCode, JSON.stringify(ok.body)).toBe(201);
    const r = await results();
    expect(access.projectResultsForStructure(r, S1)._files.map((f) => f.id)).toEqual([ok.body.fileId]);
    expect(access.projectResultsForStructure(r, S2)._files || []).toEqual([]);
    const f = r._files[0]; expect(keys.openText(f.filenameEncrypted, { purpose: 'dossier-filename', context: `file:${SHARE}:${f.id}` })).toBe('bail.pdf');
    expect(Buffer.compare(keys.openBuffer(BLOBS.get(f.storageKey), { purpose: 'dossier-file', context: `file:${SHARE}:${f.id}` }), PDF)).toBe(0);
    await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NOW() WHERE id = ${'g-' + S2}`);
    expect((await call(H.coffre, { method: 'POST', as: A, body: { action: 'share', documentId: doc, shareId: SHARE, structureId: S2 } })).body.error).toBe('NO_ACTIVE_GRANT');
  });

  it('R15 HDS: a document filed under « Santé » before R15 is never copied to an organisation; it stays listed, downloadable and erasable', async () => {
    const up = await call(H.coffre, { method: 'POST', as: A, body: { category: 'famille', originalName: 'certificat-ancien.pdf', fileBase64: PDF.toString('base64') } }); expect(up.statusCode).toBe(201);
    const doc = up.body.document.id;
    await db.execute(sql`UPDATE "CitizenDocument" SET category = 'sante' WHERE id = ${doc}`);   // the state of a document uploaded before R15
    const before = JSON.stringify((await results())._files || []);
    const refused = await call(H.coffre, { method: 'POST', as: A, body: { action: 'share', documentId: doc, shareId: SHARE, structureId: S1 } });
    expect(refused.statusCode).toBe(422); expect(refused.body.error).toBe('HEALTH_DOCUMENTS_NOT_ACCEPTED');
    expect(JSON.stringify((await results())._files || [])).toBe(before);   // nothing copied, no blob written for the dossier
    const list = await call(H.coffre, { as: A }); expect(list.body.documents.find((d) => d.id === doc)?.category).toBe('sante');
    const dl = await call(H.coffre, { as: A, query: { download: doc } }); expect(dl.statusCode).toBe(200); expect(Buffer.compare(dl.body, PDF)).toBe(0);
    expect((await call(H.coffre, { method: 'DELETE', as: A, body: { id: doc } })).statusCode).toBe(200);
  });

  it('C08: a sourced deadline due tomorrow is reminded exactly once per channel, the message names no step, delivery recorded honestly; closed steps and far deadlines are ignored', async () => {
    const add = async (title) => (await call(H.parcours, { method: 'POST', as: A, body: { action: 'add', title } })).body.item.id;
    const soon = await add('Déposer mon dossier RSA à la CAF'); const far = await add('Étape lointaine'); const closed = await add('Étape terminée');
    const src = 'https://www.service-public.fr/particuliers/vosdroits/F1';
    const tomorrow = new Date(Date.now() + 12 * 3600000).toISOString();
    for (const [id, due] of [[soon, tomorrow], [far, new Date(Date.now() + 30 * 86400000).toISOString()], [closed, tomorrow]]) await call(H.parcours, { method: 'POST', as: A, body: { action: 'deadline', id, dueDate: due, dueSourceUrl: src } });
    await call(H.parcours, { method: 'POST', as: A, body: { action: 'status', id: closed, status: 'CLOSED' } });
    const saved = { p: process.env.MAILER_PROVIDER, f: process.env.MAILER_FROM };
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test'; mailer.__clearTestOutbox();
    try {
      expect(await svc.canNotify(A.id, 'email', 'reminder'), 'e-mail reminders are on by default (service-type, no marketing)').toBe(true);
      const first = await cron.runParcoursReminders();
      const rows = (await db.execute(sql`SELECT "itemId", threshold, channel, status FROM "ParcoursReminder" WHERE "itemId" IN (${soon}, ${far}, ${closed}) ORDER BY channel`)).rows;
      expect(rows).toEqual([{ itemId: soon, threshold: 'J1', channel: 'email', status: 'TEST_RECORDED' }, { itemId: soon, threshold: 'J1', channel: 'push', status: 'NO_CONSENT' }, { itemId: soon, threshold: 'J1', channel: 'sms', status: 'NO_CONSENT' }]);   // R11 / N04: push is a channel too (no consent here)   // PKG-4: the in-memory test outbox is TEST_RECORDED, never DELIVERED (nothing reached a real mailbox)
      const mails = mailer.__getTestOutbox().filter((m) => m.to === A.email);
      expect(mails.length).toBe(1); expect(mails[0].text).not.toMatch(/RSA|CAF|Déposer/); expect(mails[0].text).toMatch(/Mon Parcours/);
      expect(first.testRecorded).toBeGreaterThanOrEqual(1); expect(first.providerAccepted).toBe(0);
      await cron.runParcoursReminders();
      expect(mailer.__getTestOutbox().filter((m) => m.to === A.email).length, 'a second run sends nothing again').toBe(1);
      // R12 (C08): a MOVED deadline is reminded again; the same date set again is not
      const sentCount = () => mailer.__getTestOutbox().filter((m) => m.to === A.email).length;
      await call(H.parcours, { method: 'POST', as: A, body: { action: 'deadline', id: soon, dueDate: new Date(Date.now() + 13 * 3600000).toISOString(), dueSourceUrl: src } });
      await cron.runParcoursReminders();
      expect(sentCount(), 'the new date is reminded').toBe(2);
      const status = async () => (await db.execute(sql`SELECT status FROM "ParcoursReminder" WHERE "itemId" = ${soon} AND channel = 'email'`)).rows[0]?.status;
      // R12 (C08): NO_CONSENT is not final — opting in before the threshold has passed brings the reminder
      expect((await svc.setPreference(A.id, { channel: 'email', category: 'reminder', enabled: false })).ok).toBe(true);
      await call(H.parcours, { method: 'POST', as: A, body: { action: 'deadline', id: soon, dueDate: new Date(Date.now() + 14 * 3600000).toISOString(), dueSourceUrl: src } });
      await cron.runParcoursReminders();
      expect(await status()).toBe('NO_CONSENT'); expect(sentCount()).toBe(2);
      expect((await svc.setPreference(A.id, { channel: 'email', category: 'reminder', enabled: true })).ok).toBe(true);
      await cron.runParcoursReminders();
      expect(await status()).toBe('TEST_RECORDED'); expect(sentCount(), 'reminded once consent is given').toBe(3);
      await cron.runParcoursReminders();
      expect(sentCount(), 'still exactly once').toBe(3);
      process.env.MAILER_PROVIDER = 'noop';
      await db.execute(sql`DELETE FROM "ParcoursReminder" WHERE "itemId" = ${soon}`);
      await cron.runParcoursReminders();
      expect((await db.execute(sql`SELECT status FROM "ParcoursReminder" WHERE "itemId" = ${soon} AND channel = 'email'`)).rows[0].status, 'no provider = honestly NOT_DELIVERED').toBe('NOT_DELIVERED');
    } finally {
      if (saved.p === undefined) delete process.env.MAILER_PROVIDER; else process.env.MAILER_PROVIDER = saved.p;
      if (saved.f === undefined) delete process.env.MAILER_FROM; else process.env.MAILER_FROM = saved.f;
    }
  });
});
