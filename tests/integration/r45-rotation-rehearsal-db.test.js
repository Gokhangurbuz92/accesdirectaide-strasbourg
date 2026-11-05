/**
 * R45 (sec, AIPD A9) — LAB rehearsal of the secret rotation, on a disposable local PostgreSQL with SYNTHETIC keys and SYNTHETIC sealed data.
 * Encryption key (ADA_ENCRYPTION_KEY), the order of the execution plan (CONTROL/r45/R45_SECRET_ROTATION_EXECUTION_PLAN_FR.md § 4):
 *   0. seed N values of three formats under the OLD key: v2 envelope (SharedDossierMessage.body), v1 (RdvConversationMessage.body), v2 blobs (CitizenDocument)
 *   1. NEW key promoted, OLD kept decrypt-only (dual-key window): every value still reads; the dry run counts all of them; status NOT « safe to retire »
 *   2. failure halfway — (a) a database error on some writes, (b) the connection lost in the middle of the run: nothing is lost or unreadable, the status
 *      stays « not safe », and a plain re-run finishes the work
 *   3. apply with concurrent reads: a reader decrypts random rows during the whole run, every read succeeds
 *   4. OLD key retired: every value reads with the NEW key alone; status « safe »; a value from a pre-rotation backup fails closed without the OLD key
 * Session secrets: a session signed before JWT_SECRET / AUTH_SECRET changes is refused afterwards (everyone signs in again); appointment-link signatures,
 * public professional handles and the guest-address blind index change with them (documented dependencies).
 * Timings and counters are printed as one JSON line « R45_REHEARSAL » (no value, no key). Volume: R45_REHEARSAL_ROWS (default 200 per text kind).
 * Skipped without DATABASE_URL.
 */
import crypto from 'node:crypto';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const STORE = vi.hoisted(() => ({ n: 0, blobs: new Map() }));
vi.mock('../../api/lib/storage.js', () => ({ storage: {
  upload: async (buf) => { STORE.n += 1; const k = `r45r-${STORE.n}`; STORE.blobs.set(k, Buffer.from(buf)); return k; },
  download: async (k) => { if (!STORE.blobs.has(k)) throw new Error('missing'); return Buffer.from(STORE.blobs.get(k)); },
  delete: async (k) => { STORE.blobs.delete(k); },
} }));

const hasDatabase = !!process.env.DATABASE_URL;
const N = Math.max(10, Math.min(20000, Number(process.env.R45_REHEARSAL_ROWS) || 200));
const NB = Math.max(2, Math.floor(N / 20));
const TS = Date.now().toString(36);
const ID = (n) => `r45r-${n}-${TS}`;
const OLD = crypto.randomBytes(32).toString('hex');
const NEW = crypto.randomBytes(32).toString('hex');
const kid = (hex) => crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex').slice(0, 8);
const ms = (t0) => Math.round(performance.now() - t0);
const report = { rows: { v2Text: N, v1Text: N, blobs: NB } };

describe.skipIf(!hasDatabase)('R45 rehearsal — data-key rotation (real DB, synthetic keys and data)', () => {
  let db, dk, c, rot; const ORIG = process.env.ADA_ENCRYPTION_KEY; const ORIG_PREV = process.env.ADA_ENCRYPTION_KEY_PREVIOUS;
  const ring = (primary, previous = []) => { process.env.ADA_ENCRYPTION_KEY = primary; process.env.ADA_ENCRYPTION_KEY_PREVIOUS = previous.filter(Boolean).join(','); };
  const dialect = new PgDialect();
  const plain = (i) => `message fictif ${i} ${TS}`;
  const PDF = (i) => Buffer.from(`%PDF-1.4 fictif ${i} ${TS}`);
  let backup;

  /** reads every rehearsal value through the product decryptors; returns the number of failures */
  async function readEverything() {
    let bad = 0;
    const v2 = (await db.execute(sql`SELECT id, body FROM "SharedDossierMessage" WHERE "threadId" = ${ID('thr')}`)).rows;
    for (const r of v2) { try { if (dk.openText(r.body, { purpose: 'dossier-message', context: `thread:${ID('thr')}` }) !== plain(r.id.split('-')[2])) bad += 1; } catch { bad += 1; } }
    const v1 = (await db.execute(sql`SELECT id, body FROM "RdvConversationMessage" WHERE "conversationId" = ${ID('conv')}`)).rows;
    for (const r of v1) { try { if (c.decrypt(r.body) !== plain(r.id.split('-')[2])) bad += 1; } catch { bad += 1; } }
    const docs = (await db.execute(sql`SELECT id, "storageKey" k FROM "CitizenDocument" WHERE "userId" = ${ID('cit')}`)).rows;
    for (const r of docs) {
      try { const b = dk.openBuffer(STORE.blobs.get(r.k), { purpose: 'coffre-file', context: `coffre:${ID('cit')}:${r.id}` }); if (!b.equals(PDF(r.id.split('-')[2]))) bad += 1; } catch { bad += 1; }
    }
    return { bad, total: v2.length + v1.length + docs.length };
  }
  const kids = async () => {
    const v2 = (await db.execute(sql`SELECT body FROM "SharedDossierMessage" WHERE "threadId" = ${ID('thr')}`)).rows.map((r) => dk.keyIdOf(r.body));
    const docs = (await db.execute(sql`SELECT "storageKey" k FROM "CitizenDocument" WHERE "userId" = ${ID('cit')}`)).rows.map((r) => dk.keyIdOf(STORE.blobs.get(r.k)));
    return new Set([...v2, ...docs]);
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); dk = await import('../../api/lib/data-keys.js'); c = await import('../../api/lib/crypto.js'); rot = await import('../../api/_services/key-rotation.js');
    const t0 = performance.now();
    ring(OLD, [ORIG]);
    const S = ID('st');
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${S}, 'Org répétition', ${S}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") VALUES (${ID('pro')}, ${ID('pro') + '@example.test'}, 'x', 'PRO', 'active', ${S}, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${ID('cit')}, ${'test.citizen+r45-' + TS + '@example.test'}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${ID('dos')}, NOW() + interval '30 days', '{}'::jsonb, '{}'::jsonb, 0, ${'h' + TS}, ${'t' + TS}, 'GUEST_SHARE', ${ID('cit')})`);
    await db.execute(sql`INSERT INTO "SharedDossierThread" (id, "sharedDiagnosticId", "structureId", "openedByProUserId") VALUES (${ID('thr')}, ${ID('dos')}, ${S}, ${ID('pro')})`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${ID('svc')}, ${S}, 'A', 30, NOW())`);
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", "beneficiaryName", "citizenUserId", "updatedAt") VALUES (${ID('ap')}, ${S}, ${ID('svc')}, NOW() + interval '2 days', NOW() + interval '2 days 30 minutes', 'Particulier', ${ID('cit')}, NOW())`);
    await db.execute(sql`INSERT INTO "RdvConversation" (id, "appointmentId", "structureId", "citizenUserId", "updatedAt") VALUES (${ID('conv')}, ${ID('ap')}, ${S}, ${ID('cit')}, NOW())`);
    const v2 = []; const v1 = [];
    for (let i = 0; i < N; i += 1) {
      v2.push(sql`(${ID(`m-${i}`)}, ${ID('thr')}, 'PRO', ${dk.sealText(plain(i), { purpose: 'dossier-message', context: `thread:${ID('thr')}` })})`);
      v1.push(sql`(${ID(`c-${i}`)}, ${ID('conv')}, 'PRO', ${c.encrypt(plain(i))})`);
    }
    for (let i = 0; i < N; i += 500) {
      await db.execute(sql`INSERT INTO "SharedDossierMessage" (id, "threadId", "senderType", body) VALUES ${sql.join(v2.slice(i, i + 500), sql`, `)}`);
      await db.execute(sql`INSERT INTO "RdvConversationMessage" (id, "conversationId", "senderType", body) VALUES ${sql.join(v1.slice(i, i + 500), sql`, `)}`);
    }
    const st = (await import('../../api/lib/storage.js')).storage;
    for (let i = 0; i < NB; i += 1) {
      const id = ID(`d-${i}`);
      const k = await st.upload(dk.sealBuffer(PDF(i), { purpose: 'coffre-file', context: `coffre:${ID('cit')}:${id}` }));
      await db.execute(sql`INSERT INTO "CitizenDocument" (id, "userId", category, "filenameEncrypted", "mimeType", "byteLength", "checksumSha256", "storageKey") VALUES (${id}, ${ID('cit')}, 'autre', ${dk.sealText(`fictif-${i}.pdf`, { purpose: 'coffre-filename', context: `coffre:${ID('cit')}:${id}` })}, 'application/pdf', 20, 'x', ${k})`);
    }
    backup = (await db.execute(sql`SELECT body FROM "SharedDossierMessage" WHERE id = ${ID('m-0')}`)).rows[0].body;   // a « pre-rotation backup » value
    report.seedMs = ms(t0);
  }, 300000);

  afterAll(async () => {
    console.log(`R45_REHEARSAL ${JSON.stringify(report)}`);
    if (!db) return;
    try { ring(ORIG, [NEW, OLD]); await rot.rewrapAll({ apply: true }); } finally {
      process.env.ADA_ENCRYPTION_KEY = ORIG; if (ORIG_PREV === undefined) delete process.env.ADA_ENCRYPTION_KEY_PREVIOUS; else process.env.ADA_ENCRYPTION_KEY_PREVIOUS = ORIG_PREV;
      for (const q of [sql`DELETE FROM "CitizenDocument" WHERE "userId" = ${ID('cit')}`, sql`DELETE FROM "RdvConversationMessage" WHERE "conversationId" = ${ID('conv')}`, sql`DELETE FROM "RdvConversation" WHERE id = ${ID('conv')}`,
        sql`DELETE FROM "ProAppointment" WHERE id = ${ID('ap')}`, sql`DELETE FROM "ProRdvService" WHERE id = ${ID('svc')}`, sql`DELETE FROM "SharedDossierMessage" WHERE "threadId" = ${ID('thr')}`,
        sql`DELETE FROM "SharedDiagnostic" WHERE id = ${ID('dos')}`, sql`DELETE FROM "CitizenUser" WHERE id = ${ID('cit')}`, sql`DELETE FROM "ProUser" WHERE id = ${ID('pro')}`, sql`DELETE FROM "Structure" WHERE id = ${ID('st')}`])
        await db.execute(q).catch(() => {});
    }
  }, 300000);

  it('1. dual-key window: NEW primary, OLD decrypt-only — every value reads, the dry run counts every one, status « not safe »', async () => {
    ring(NEW, [OLD, ORIG]);
    const r = await readEverything(); expect(r).toEqual({ bad: 0, total: 2 * N + NB });
    const t0 = performance.now(); const dry = await rot.rewrapAll({ apply: false }); report.dryRunMs = ms(t0);
    expect(dry.byKind['SharedDossierMessage.body'].needing).toBe(N);
    expect(dry.byKind['RdvConversationMessage.body'].needing).toBe(N);
    expect(dry.byKind['CitizenDocument.blob'].needing).toBe(NB);
    expect(dry.updated).toBe(0);
    expect((await rot.rotationStatus()).safeToRetireOldKeys).toBe(false);
  }, 300000);

  it('2. failure halfway — write errors and a lost connection lose nothing; status stays « not safe »; a re-run finishes', async () => {
    let updates = 0;
    const flaky = { execute: (q) => { const t = dialect.sqlToQuery(q).sql; if (/^UPDATE/i.test(t)) { updates += 1; if (updates % 7 === 0) return Promise.reject(new Error('simulated write error')); } return db.execute(q); } };
    const t0 = performance.now(); const a = await rot.rewrapAll({ apply: true, db: flaky }); report.firstPassWithErrorsMs = ms(t0);
    expect(a.failed).toBeGreaterThan(0); expect(a.updated).toBeGreaterThan(0);
    report.writeErrors = { failed: a.failed, updated: a.updated };
    let queries = 0;
    const cut = { execute: (q) => { queries += 1; return queries > 4 ? Promise.reject(new Error('simulated connection lost')) : db.execute(q); } };
    await expect(rot.rewrapAll({ apply: true, db: cut })).rejects.toThrow(/connection lost/);
    expect(await readEverything()).toEqual({ bad: 0, total: 2 * N + NB });   // mixed OLD / NEW values, all readable in the dual-key window
    const mid = await rot.rotationStatus(); expect(mid.safeToRetireOldKeys).toBe(false); expect(mid.stillOnOldKeys).toBeGreaterThan(0);
    report.afterFailures = { stillOnOldKeys: mid.stillOnOldKeys };
  }, 300000);

  it('3. apply with concurrent reads: every read during the run succeeds; status « safe »', async () => {
    let stop = false; let reads = 0; let readFailures = 0;
    const reader = (async () => {
      while (!stop) {
        const i = crypto.randomInt(0, N);
        const [m] = (await db.execute(sql`SELECT body FROM "SharedDossierMessage" WHERE id = ${ID(`m-${i}`)}`)).rows;
        const [v] = (await db.execute(sql`SELECT body FROM "RdvConversationMessage" WHERE id = ${ID(`c-${i}`)}`)).rows;
        try {
          if (dk.openText(m.body, { purpose: 'dossier-message', context: `thread:${ID('thr')}` }) !== plain(i) || c.decrypt(v.body) !== plain(i)) readFailures += 1;
        } catch { readFailures += 1; }
        reads += 1;
      }
    })();
    const t0 = performance.now(); const run = await rot.rewrapAll({ apply: true }); report.applyMs = ms(t0);
    stop = true; await reader;
    expect(run.failed).toBe(0); expect(readFailures).toBe(0); expect(reads).toBeGreaterThan(0);
    report.apply = { updated: run.updated, skippedConcurrent: run.skippedConcurrent, concurrentReads: reads, readFailures };
    const t1 = performance.now(); const st = await rot.rotationStatus(); report.statusMs = ms(t1);
    expect(st.stillOnOldKeys).toBe(0); expect(st.safeToRetireOldKeys).toBe(true);
    expect([...(await kids())]).toEqual([kid(NEW)]);
  }, 300000);

  it('4. OLD key retired: everything reads with NEW alone; a pre-rotation backup value fails closed without OLD', async () => {
    ring(NEW, [ORIG]);
    expect(await readEverything()).toEqual({ bad: 0, total: 2 * N + NB });
    expect(() => dk.openText(backup, { purpose: 'dossier-message', context: `thread:${ID('thr')}` })).toThrow(/unknown key id/);
    ring(NEW, [OLD, ORIG]);
    expect(dk.openText(backup, { purpose: 'dossier-message', context: `thread:${ID('thr')}` })).toBe(plain(0));   // restore needs OLD kept decrypt-only
  }, 300000);
});

describe('R45 rehearsal — session-secret rotation effect (synthetic secrets)', () => {
  const saved = {};
  const set = (vars) => { for (const [k, v] of Object.entries(vars)) { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const S1 = crypto.randomBytes(32).toString('hex'); const S2 = crypto.randomBytes(32).toString('hex');

  it('a session signed before the change is refused after it (citizen and professional); a new one works; the derived values change', async () => {
    const ua = await import('../../api/_utils/user-auth.js'); const pa = await import('../../api/_utils/auth.js');
    const guest = await import('../../api/_utils/rdv-guest-core.js'); const team = await import('../../api/_services/rdv-team.js');
    set({ JWT_SECRET: S1, AUTH_SECRET: S1, AUTH_JWT_SECRET: undefined, RDV_CONFIRMATION_TOKEN_SECRET: undefined, SESSION_SECRET: undefined });
    const citizen = ua.signUserSessionToken({ userId: 'r45-citizen', email: 'test.citizen+r45@example.test' });
    const pro = pa.signProToken({ id: 'r45-pro', email: 'test.pro+r45@example.test', structureId: 'r45-structure', role: 'PRO' });
    const handleBefore = team.professionalHandle('r45-structure', 'r45-pro'); const blindBefore = guest.guestEmailHash('test.citizen+r45@example.test');
    expect(ua.verifyUserSessionToken(citizen)?.userId).toBe('r45-citizen');
    expect(pa.verifyProToken(pro)).toBeTruthy();
    set({ JWT_SECRET: S2, AUTH_SECRET: S2 });
    expect(ua.verifyUserSessionToken(citizen), 'citizen session signed with the old secret').toBeNull();
    expect(pa.verifyProToken(pro), 'professional session signed with the old secret').toBeNull();
    expect(ua.verifyUserSessionToken(ua.signUserSessionToken({ userId: 'r45-citizen', email: 'test.citizen+r45@example.test' }))?.userId).toBe('r45-citizen');
    expect(team.professionalHandle('r45-structure', 'r45-pro'), 'public professional handle changes').not.toBe(handleBefore);
    expect(guest.guestEmailHash('test.citizen+r45@example.test'), 'guest-address blind index changes').not.toBe(blindBefore);
    // only AUTH_SECRET changes: citizen sessions end, professional sessions (JWT_SECRET) survive — the two can be rotated separately
    set({ JWT_SECRET: S1, AUTH_SECRET: S1 });
    const citizen2 = ua.signUserSessionToken({ userId: 'r45-citizen', email: 'test.citizen+r45@example.test' });
    const pro2 = pa.signProToken({ id: 'r45-pro', email: 'test.pro+r45@example.test', structureId: 'r45-structure', role: 'PRO' });
    set({ AUTH_SECRET: S2 });
    expect(ua.verifyUserSessionToken(citizen2)).toBeNull();
    expect(pa.verifyProToken(pro2)).toBeTruthy();
  });
});
