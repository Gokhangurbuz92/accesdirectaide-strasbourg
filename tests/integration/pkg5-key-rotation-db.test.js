/**
 * PKG-5 — data-key rotation on REAL PostgreSQL with SYNTHETIC keys and data (isolated test database; object storage = in-memory map).
 * Covers every encrypted field: dossier-thread message, case note, referral message + response, Mon Coffre name + blob, message attachment name + blob, dossier
 * documents inside SharedDiagnostic.results._files (name + blob), released DSR extract.
 *   1. dry run counts what is still wrapped by the old key; nothing is written
 *   2. an interrupted run leaves every value readable; re-running resumes and finishes; status = safe to retire
 *   3. the old key retired: everything still readable (payloads never re-encrypted, plaintexts identical)
 *   4. restore of a pre-rotation backup: readable only while the old key is kept decrypt-only -> keep it until backups age out; without it the read FAILS (closed)
 *   5. rollback: the old key promoted back and the run repeated -> readable, status safe
 * The suite ends by re-wrapping everything back to the test environment's own key (it also proves a third rotation), so other test files are unaffected.
 */
import crypto from 'node:crypto';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const STORE = vi.hoisted(() => ({ n: 0, blobs: new Map() }));
vi.mock('../../api/lib/storage.js', () => ({ storage: {
  upload: async (buf) => { STORE.n += 1; const k = `p5k-${STORE.n}`; STORE.blobs.set(k, Buffer.from(buf)); return k; },
  download: async (k) => { if (!STORE.blobs.has(k)) throw new Error('missing'); return Buffer.from(STORE.blobs.get(k)); },
  delete: async (k) => { STORE.blobs.delete(k); },
} }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const K1 = crypto.randomBytes(32).toString('hex'); const K2 = crypto.randomBytes(32).toString('hex');
const ID = (n) => `p5k-${n}-${TS}`;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(300)]);

describe.skipIf(!hasDatabase)('PKG-5 data-key rotation (real DB, synthetic keys)', () => {
  let db, dk, rot; const ORIG = process.env.ADA_ENCRYPTION_KEY; const ORIG_PREV = process.env.ADA_ENCRYPTION_KEY_PREVIOUS;
  const ring = (primary, previous = []) => { process.env.ADA_ENCRYPTION_KEY = primary; process.env.ADA_ENCRYPTION_KEY_PREVIOUS = previous.filter(Boolean).join(','); };
  const P = {};
  /** every synthetic value read back through the same decryptors the product uses */
  async function readAll() {
    const one = async (q) => (await db.execute(q)).rows[0];
    const msg = await one(sql`SELECT body FROM "SharedDossierMessage" WHERE id = ${ID('msg')}`);
    const note = await one(sql`SELECT "bodyEncrypted" b FROM "ProCaseNote" WHERE id = ${ID('note')}`);
    const ref = await one(sql`SELECT "messageEncrypted" m, "responseMessageEncrypted" r FROM "Referral" WHERE id = ${ID('ref')}`);
    const doc = await one(sql`SELECT "filenameEncrypted" n, "storageKey" k FROM "CitizenDocument" WHERE id = ${ID('doc')}`);
    const att = await one(sql`SELECT "filenameEncrypted" n, "storageKey" k FROM "RdvMessageAttachment" WHERE id = ${ID('att')}`);
    const files = (await one(sql`SELECT results->'_files' f FROM "SharedDiagnostic" WHERE id = ${ID('dos')}`)).f;
    const dsr = await one(sql`SELECT "reviewOutcome" o FROM "DSRRequest" WHERE id = ${ID('dsr')}`);
    const o = (v, purpose, context) => dk.openText(v, { purpose, context });
    const b = async (k, purpose, context) => dk.openBuffer(await (await import('../../api/lib/storage.js')).storage.download(k), { purpose, context });
    return {
      msg: o(msg.body, 'dossier-message', `thread:${ID('thr')}`), note: o(note.b, 'case-note', `case:${ID('case')}`),
      ref: o(ref.m, 'referral-message', `referral:${ID('ref')}`), resp: o(ref.r, 'referral-message', `referral:${ID('ref')}`),
      docName: o(doc.n, 'coffre-filename', `coffre:${ID('cit')}:${ID('doc')}`), doc: (await b(doc.k, 'coffre-file', `coffre:${ID('cit')}:${ID('doc')}`)).toString('hex'),
      attName: o(att.n, 'message-attachment-name', `rdvatt:${ID('conv')}:${ID('att')}`), att: (await b(att.k, 'message-attachment', `rdvatt:${ID('conv')}:${ID('att')}`)).toString('hex'),
      fileName: o(files[0].filenameEncrypted, 'dossier-filename', `file:${ID('dos')}:${ID('f1')}`), file: (await b(files[0].storageKey, 'dossier-file', `file:${ID('dos')}:${ID('f1')}`)).toString('hex'),
      dsr: o(dsr.o.extractEncrypted, 'case-note', `dsr:${ID('dsr')}`),
    };
  }
  const kidsOfMine = async () => {
    const one = async (q) => (await db.execute(q)).rows[0];
    const st = (await import('../../api/lib/storage.js')).storage;
    const doc = await one(sql`SELECT "filenameEncrypted" n, "storageKey" k FROM "CitizenDocument" WHERE id = ${ID('doc')}`);
    const att = await one(sql`SELECT "storageKey" k FROM "RdvMessageAttachment" WHERE id = ${ID('att')}`);
    const note = await one(sql`SELECT "bodyEncrypted" b FROM "ProCaseNote" WHERE id = ${ID('note')}`);
    return new Set([dk.keyIdOf(doc.n), dk.keyIdOf(await st.download(doc.k)), dk.keyIdOf(await st.download(att.k)), dk.keyIdOf(note.b)]);
  };
  const kid = (hex) => crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex').slice(0, 8);
  let expected; let backup;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); dk = await import('../../api/lib/data-keys.js'); rot = await import('../../api/_services/key-rotation.js');
    const st = (await import('../../api/lib/storage.js')).storage;
    ring(K1, [ORIG]);
    const S = ID('st'); P.S = S;
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${S}, 'Org rotation', ${S}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW()), (${S + 'b'}, 'Org rotation B', ${S + 'b'}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") VALUES (${ID('pro')}, ${ID('pro') + '@example.test'}, 'x', 'PRO', 'active', ${S}, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${ID('cit')}, ${ID('cit') + '@example.test'}, 'x', NOW(), NOW())`);
    const fileBlob = await st.upload(dk.sealBuffer(PDF, { purpose: 'dossier-file', context: `file:${ID('dos')}:${ID('f1')}` }));
    const files = [{ id: ID('f1'), structureId: S, storageKey: fileBlob, encrypted: true, filenameEncrypted: dk.sealText('dossier-doc.pdf', { purpose: 'dossier-filename', context: `file:${ID('dos')}:${ID('f1')}` }), mimeType: 'application/pdf' }];
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${ID('dos')}, NOW() + interval '30 days', '{}'::jsonb, ${JSON.stringify({ _files: files })}::jsonb, 0, ${'h' + TS}, ${'t' + TS}, 'GUEST_SHARE', ${ID('cit')})`);
    await db.execute(sql`INSERT INTO "SharedDossierThread" (id, "sharedDiagnosticId", "structureId", "openedByProUserId") VALUES (${ID('thr')}, ${ID('dos')}, ${S}, ${ID('pro')})`);
    await db.execute(sql`INSERT INTO "SharedDossierMessage" (id, "threadId", "senderType", body) VALUES (${ID('msg')}, ${ID('thr')}, 'PRO', ${dk.sealText('message de dossier', { purpose: 'dossier-message', context: `thread:${ID('thr')}` })})`);
    await db.execute(sql`INSERT INTO "ProCase" (id, "sharedDiagnosticId", "structureId", "updatedAt") VALUES (${ID('case')}, ${ID('dos')}, ${S}, NOW())`);
    await db.execute(sql`INSERT INTO "ProCaseNote" (id, "caseId", "structureId", visibility, "bodyEncrypted") VALUES (${ID('note')}, ${ID('case')}, ${S}, 'INTERNAL', ${dk.sealText('note interne', { purpose: 'case-note', context: `case:${ID('case')}` })})`);
    await db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", "reasonCode", "messageEncrypted", "responseMessageEncrypted", "updatedAt") VALUES (${ID('ref')}, ${ID('dos')}, ${S}, ${S + 'b'}, 'HOUSING', ${dk.sealText('message orientation', { purpose: 'referral-message', context: `referral:${ID('ref')}` })}, ${dk.sealText('réponse', { purpose: 'referral-message', context: `referral:${ID('ref')}` })}, NOW())`);
    const docBlob = await st.upload(dk.sealBuffer(PDF, { purpose: 'coffre-file', context: `coffre:${ID('cit')}:${ID('doc')}` }));
    await db.execute(sql`INSERT INTO "CitizenDocument" (id, "userId", category, "filenameEncrypted", "mimeType", "byteLength", "checksumSha256", "storageKey") VALUES (${ID('doc')}, ${ID('cit')}, 'autre', ${dk.sealText('coffre.pdf', { purpose: 'coffre-filename', context: `coffre:${ID('cit')}:${ID('doc')}` })}, 'application/pdf', ${PDF.length}, 'x', ${docBlob})`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${ID('svc')}, ${S}, 'A', 30, NOW())`);
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", "beneficiaryName", "citizenUserId", "updatedAt") VALUES (${ID('ap')}, ${S}, ${ID('svc')}, NOW() + interval '2 days', NOW() + interval '2 days 30 minutes', 'P', ${ID('cit')}, NOW())`);
    await db.execute(sql`INSERT INTO "RdvConversation" (id, "appointmentId", "structureId", "citizenUserId", "updatedAt") VALUES (${ID('conv')}, ${ID('ap')}, ${S}, ${ID('cit')}, NOW())`);
    await db.execute(sql`INSERT INTO "RdvConversationMessage" (id, "conversationId", "senderType", body) VALUES (${ID('m')}, ${ID('conv')}, 'PRO', 'x')`);
    const attBlob = await st.upload(dk.sealBuffer(PDF, { purpose: 'message-attachment', context: `rdvatt:${ID('conv')}:${ID('att')}` }));
    await db.execute(sql`INSERT INTO "RdvMessageAttachment" (id, "conversationId", "messageId", "uploaderType", "storageKey", "filenameEncrypted", "mimeType", "byteLength", "checksumSha256") VALUES (${ID('att')}, ${ID('conv')}, ${ID('m')}, 'PRO', ${attBlob}, ${dk.sealText('piece.pdf', { purpose: 'message-attachment-name', context: `rdvatt:${ID('conv')}:${ID('att')}` })}, 'application/pdf', ${PDF.length}, 'x')`);
    await db.execute(sql`INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode", "reviewOutcome") VALUES (${ID('dsr')}, 'CITIZEN_USER', ${ID('cit')}, 'ACCESS_REVIEW', 'COMPLETED', 'HUMAN_REVIEW_REQUIRED', ${JSON.stringify({ decision: 'RELEASED', extractEncrypted: dk.sealText('extrait', { purpose: 'case-note', context: `dsr:${ID('dsr')}` }) })}::jsonb)`);
    expected = await readAll();
    // a "backup" of the encrypted state before any rotation (rows + blobs, still wrapped by K1)
    backup = { note: (await db.execute(sql`SELECT "bodyEncrypted" b FROM "ProCaseNote" WHERE id = ${ID('note')}`)).rows[0].b, blobs: new Map([...STORE.blobs].map(([k, v]) => [k, Buffer.from(v)])) };
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    ring(ORIG, [K2, K1]); await rot.rewrapAll({ apply: true });   // everything back on the test environment key
    process.env.ADA_ENCRYPTION_KEY = ORIG; process.env.ADA_ENCRYPTION_KEY_PREVIOUS = ORIG_PREV || '';
    await db.execute(sql`DELETE FROM "DSRRequest" WHERE id = ${ID('dsr')}`).catch(() => {});
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${ID('dos')}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE id = ${ID('ap')}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${ID('svc')}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${ID('cit')}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${ID('pro')}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${P.S}, ${P.S + 'b'})`).catch(() => {});
  });

  it('1. dry run: K2 promoted, K1 decrypt-only — every synthetic field is counted as still on the old key; nothing written', async () => {
    ring(K2, [K1, ORIG]);
    const before = await kidsOfMine();
    const dry = await rot.rewrapAll({ apply: false });
    for (const kind of ['SharedDossierMessage.body', 'ProCaseNote.bodyEncrypted', 'Referral.messageEncrypted', 'Referral.responseMessageEncrypted', 'CitizenDocument.filenameEncrypted', 'RdvMessageAttachment.filenameEncrypted', 'CitizenDocument.blob', 'RdvMessageAttachment.blob', 'SharedDiagnostic._files', 'DSRRequest.reviewOutcome'])
      expect(dry.byKind[kind]?.needing, kind).toBeGreaterThanOrEqual(1);
    expect(dry.updated).toBe(0); expect(dry.failed).toBe(0);
    expect(await kidsOfMine()).toEqual(before); expect([...before]).toEqual([kid(K1)]);
    expect((await rot.rotationStatus()).safeToRetireOldKeys).toBe(false);
  });

  it('2. an interrupted run leaves everything readable; the next run resumes and finishes; status says the old key can be retired', async () => {
    const part = await rot.rewrapAll({ apply: true, stopAfter: 3 });
    expect(part.interrupted).toBe(true); expect(part.failed).toBe(0);
    expect(await readAll()).toEqual(expected);
    expect((await rot.rotationStatus()).safeToRetireOldKeys).toBe(false);
    const rest = await rot.rewrapAll({ apply: true });
    expect(rest.failed).toBe(0); expect(rest.interrupted).toBe(false);
    const status = await rot.rotationStatus(); expect(status.stillOnOldKeys).toBe(0); expect(status.safeToRetireOldKeys).toBe(true);
    expect([...(await kidsOfMine())]).toEqual([kid(K2)]);
    expect(await readAll()).toEqual(expected);
  });

  it('3. the old key retired (no K1 anywhere): everything still reads identically; old blobs were removed only after the switch', async () => {
    ring(K2, [ORIG]);
    expect(await readAll()).toEqual(expected);
    for (const k of backup.blobs.keys()) expect(STORE.blobs.has(k), 'old object deleted after the pointer moved').toBe(false);
  });

  it('4. restoring a PRE-rotation backup works only while K1 is kept decrypt-only; without it the read fails closed', async () => {
    const ctx = { purpose: 'case-note', context: `case:${ID('case')}` };
    expect(() => dk.openText(backup.note, ctx), 'K1 retired: an old backup is unreadable').toThrow(/unknown key id/);
    ring(K2, [K1, ORIG]);
    expect(dk.openText(backup.note, ctx)).toBe('note interne');
    for (const [, v] of backup.blobs) expect(dk.keyIdOf(v)).toBe(kid(K1));
  });

  it('5. rollback: K1 promoted back, K2 decrypt-only, the same run returns every value to K1 — readable, status safe', async () => {
    ring(K1, [K2, ORIG]);
    const back = await rot.rewrapAll({ apply: true }); expect(back.failed).toBe(0);
    expect([...(await kidsOfMine())]).toEqual([kid(K1)]);
    expect(await readAll()).toEqual(expected);
    expect((await rot.rotationStatus()).safeToRetireOldKeys).toBe(true);
  });
});
