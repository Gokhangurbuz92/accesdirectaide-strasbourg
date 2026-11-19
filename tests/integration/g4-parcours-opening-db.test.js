/**
 * G4 (founder directive 19/11/2026) — Mon Parcours opened ALONE for account holders, on REAL PostgreSQL, THROUGH THE REAL API ENTRY (api/index.js: CSRF,
 * the restricted-beta surface gate and the R45 capability gate all run). Profile « accounts narrow + parcours, everything else closed »:
 *   ADA_PUBLIC_BETA_RESTRICTED=1, ADA_BETA_OPEN_SURFACES=admin,accounts, ADA_BETA_ACCOUNTS_EXTRA=parcours, ADA_CAPABILITIES_OPEN=citizen.parcours,
 *   no ADA_BETA_ACCOUNTS_SCOPE, no HDS attestation, no job opened.
 * Proven: create / organise / status / deadline / note / history / delete of steps; the in-app deadline notice and the Mon Espace summary; the plan import
 * from a shared dossier refused (HDS-bound) before anything is read; household, guardians, push, shares, favourites, history, delegations, referrals, vault
 * and dossiers still 503; cross-account isolation; the data export (art. 15/20) contains the steps, their history and their reminders; the reviewed
 * erasure (C21) and the 6c purge of never-confirmed accounts remove them. Synthetic data only. Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { approvedTestPolicy, approvalEnv } from '../helpers/gdpr-purge-approval.js';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0,
  lpush: async () => 1, ltrim: async () => 'OK', lrange: async () => [] } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `${Date.now()}${crypto.randomBytes(2).toString('hex')}`;
const A = { id: `g4p-a-${TS}`, email: `g4p-a-${TS}@example.test` };
const B = { id: `g4p-b-${TS}`, email: `g4p-b-${TS}@example.test` };
const U = { id: `g4p-u-${TS}`, email: `g4p-u-${TS}@example.test` };   // never confirmed (6c)
const S = `g4p-s-${TS}@example.test`; const X = `g4p-x-${TS}@example.test`;
const CSRF = `g4pcsrf${TS}`;
const OFFICIAL = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006';
const ENV_KEYS = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_BETA_ACCOUNTS_SCOPE', 'ADA_BETA_ACCOUNTS_EXTRA', 'ADA_CAPABILITIES_OPEN', 'ADA_HDS_CERTIFIED_HOSTING',
  'ADA_BETA_OPEN_JOBS', 'ADA_JOBS_APPROVED', 'MAILER_PROVIDER', 'MAILER_FROM'];
const G4 = { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts', ADA_BETA_ACCOUNTS_SCOPE: undefined, ADA_BETA_ACCOUNTS_EXTRA: 'parcours',
  ADA_CAPABILITIES_OPEN: 'citizen.parcours', ADA_HDS_CERTIFIED_HOSTING: undefined, ADA_BETA_OPEN_JOBS: undefined, ADA_JOBS_APPROVED: undefined, MAILER_PROVIDER: 'test', MAILER_FROM: 'qa@example.test' };
const setEnv = (vars) => { for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('G4 — Mon Parcours alone on the narrow accounts scope (real API entry, real PostgreSQL)', () => {
  let db, api, userAuth, review;
  const saved = {};
  const J = {};
  const call = async (method, url, { as, body } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const h = { host: 'localhost:3000', 'x-forwarded-proto': 'http' };
    if (as) Object.assign(h, { cookie: `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: as.id, email: as.email })).split(';')[0]}; __csrf=${CSRF}`, 'x-csrf-token': CSRF });
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, socket: {}, headers: h };
    const res = mkRes(); await api(req, res);
    await (await import('../../api/_utils/after-response.js')).settleAfterResponse();
    return res;
  };
  const ok = (r) => { expect(r.statusCode, JSON.stringify(r.body)).toBeLessThan(300); return r.body; };
  const rows = async (q) => (await db.execute(q)).rows;
  const counts = async (userId) => (await rows(sql`SELECT
      (SELECT count(*)::int FROM "ParcoursItem" WHERE "userId" = ${userId}) AS items,
      (SELECT count(*)::int FROM "ParcoursEvent" WHERE "userId" = ${userId}) AS events,
      (SELECT count(*)::int FROM "ParcoursReminder" r WHERE r."itemId" IN (SELECT id FROM "ParcoursItem" WHERE "userId" = ${userId})) AS reminders`))[0];
  const eventsOf = async (itemId) => (await rows(sql`SELECT count(*)::int AS n FROM "ParcoursEvent" WHERE "itemId" = ${itemId}`))[0].n;
  const remindersOf = async (itemId) => (await rows(sql`SELECT count(*)::int AS n FROM "ParcoursReminder" WHERE "itemId" = ${itemId}`))[0].n;

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv(G4);
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; userAuth = await import('../../api/_utils/user-auth.js');
    review = await import('../../api/_services/dsr-erasure-review.js');
    for (const c of [A, B]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "createdAt", "updatedAt", "emailVerifiedAt") VALUES (${U.id}, ${U.email}, 'x', NOW() - interval '8 days', NOW(), NULL)`);
    for (const e of [S, X]) await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "updatedAt", "failedLoginAttempts", "mfaEnabled") VALUES (${'id-' + e}, ${e}, 'x', 'admin', NOW(), 0, true)`);
  }, 90000);

  afterAll(async () => {
    try {
      if (!db) return;
      for (const c of [A, B, U]) {
        await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${c.id}`).catch(() => {});
        await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${c.id}`).catch(() => {});
        await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
      }
      for (const e of [S, X]) await db.execute(sql`DELETE FROM "AdminUser" WHERE email = ${e}`).catch(() => {});
    } finally { setEnv(saved); }
  });

  it('a person creates, organises, dates, annotates, follows and deletes steps; the history follows every change', async () => {
    expect((await call('GET', '/api/citizen/parcours')).statusCode, 'no session').toBe(401);
    const first = ok(await call('POST', '/api/citizen/parcours', { as: A, body: { action: 'add', title: 'Demander l’aide au logement', planStep: { actor: { kind: 'citizen' } } } }));
    J.a1 = first.item.id; expect(first.planSaved).toBe(true);
    J.a2 = ok(await call('POST', '/api/citizen/parcours', { as: A, body: { action: 'add', title: 'Rassembler les justificatifs' } })).item.id;
    ok(await call('POST', '/api/citizen/parcours', { as: A, body: { action: 'plan', id: J.a2, planStep: { dependsOnItemId: J.a1, nextActionKey: 'gather_documents' } } }));
    ok(await call('POST', '/api/citizen/parcours', { as: A, body: { action: 'status', id: J.a1, status: 'IN_PROGRESS' } }));
    ok(await call('POST', '/api/citizen/parcours', { as: A, body: { action: 'status', id: J.a2, status: 'OUTCOME_UNKNOWN' } }));
    expect((await call('POST', '/api/citizen/parcours', { as: A, body: { action: 'deadline', id: J.a1, dueDate: new Date(Date.now() + 3 * 864e5).toISOString(), dueSourceUrl: 'https://example.com/x' } })).statusCode,
      'a deadline needs its official source').toBe(400);
    ok(await call('POST', '/api/citizen/parcours', { as: A, body: { action: 'deadline', id: J.a1, dueDate: new Date(Date.now() + 3 * 864e5).toISOString(), dueSourceUrl: OFFICIAL } }));
    const long = 'x'.repeat(700);
    expect(ok(await call('POST', '/api/citizen/parcours', { as: A, body: { action: 'note', id: J.a1, note: long } })).item.note, 'kept to 500 characters').toHaveLength(500);
    ok(await call('POST', '/api/citizen/parcours', { as: A, body: { action: 'note', id: J.a1, note: 'Appeler la CAF lundi' } }));

    const list = ok(await call('GET', '/api/citizen/parcours', { as: A }));
    expect(list.planImport, 'the plan import is not offered').toBe(false);
    expect(list.emailReminders, 'no e-mail reminder job is open').toBe(false);
    const a1 = list.items.find((i) => i.id === J.a1); const a2 = list.items.find((i) => i.id === J.a2);
    expect(a1).toMatchObject({ status: 'IN_PROGRESS', note: 'Appeler la CAF lundi', dueSourceUrl: OFFICIAL, step: { actor: { kind: 'citizen' } } });
    expect(a2).toMatchObject({ status: 'CLOSED', closure: 'OUTCOME_UNKNOWN', dependsOn: { id: J.a1 } });
    const hist = ok(await call('GET', `/api/citizen/parcours?history=${J.a1}`, { as: A })).events.map((e) => e.kind);
    expect(hist).toEqual(['CREATED', 'STATUS', 'DEADLINE', 'NOTE', 'NOTE']);

    // the deadline reminder exists in-app (citizen/notifications, narrow scope) and Mon Espace summarises the steps
    const inbox = ok(await call('GET', '/api/citizen/notifications', { as: A }));
    expect(inbox.notifications.filter((n) => n.kind === 'PARCOURS_DEADLINE_SOON').map((n) => n.link)).toEqual(['/compte/parcours']);
    expect(JSON.stringify(inbox)).not.toContain('CAF');
    const espace = ok(await call('GET', '/api/citizen/espace', { as: A })).summary;
    expect(espace.parcours).toMatchObject({ total: 2, open: 1, nextDue: { id: J.a1 } });
    for (const k of ['documents', 'favorites', 'dossiers']) expect(espace, k).not.toHaveProperty(k);

    // delete: the step and its history go
    const tmp = ok(await call('POST', '/api/citizen/parcours', { as: A, body: { action: 'add', title: 'Étape à supprimer' } })).item.id;
    expect(await eventsOf(tmp)).toBe(1);
    ok(await call('DELETE', '/api/citizen/parcours', { as: A, body: { id: tmp } }));
    expect(await eventsOf(tmp)).toBe(0);
    expect((await call('DELETE', '/api/citizen/parcours', { as: A, body: { id: tmp } })).statusCode).toBe(404);
  });

  it('the plan import from a shared dossier is refused before anything is read (citizen.shared_dossier is HDS-bound and closed)', async () => {
    const r = await call('POST', '/api/citizen/parcours', { as: A, body: { action: 'import', shareId: `any-${TS}` } });
    expect([r.statusCode, r.body.error]).toEqual([503, 'CAPABILITY_NOT_OPEN']);
    expect((await counts(A.id)).items).toBe(2);
  });

  it('every other module of the full citizen scope, the documents and the HDS-bound functions still answer 503', async () => {
    for (const [m, url] of [['GET', '/api/citizen/household'], ['POST', '/api/citizen/household'], ['GET', '/api/citizen/guardians'], ['GET', '/api/citizen/push'],
      ['GET', '/api/citizen/shares'], ['GET', '/api/citizen/favorites'], ['POST', '/api/citizen/favorites'], ['GET', '/api/citizen/history'], ['GET', '/api/citizen/delegations'],
      ['POST', '/api/citizen/delegations'], ['GET', '/api/citizen/referrals'], ['GET', '/api/citizen/coffre'], ['GET', '/api/citizen/dossier'], ['POST', '/api/share/create'],
      ['GET', '/api/public/dossier-grants'], ['POST', '/api/diagnostic'], ['GET', '/api/cron/parcours-reminder']]) {
      const r = await call(m, url, { as: A, body: {} });
      expect(r.statusCode, `${m} ${url} ${JSON.stringify(r.body)}`).toBe(503);
    }
  });

  it('cross-account isolation: B sees, changes and deletes nothing of A', async () => {
    expect(ok(await call('GET', '/api/citizen/parcours', { as: B })).items).toEqual([]);
    for (const body of [{ action: 'status', id: J.a1, status: 'CLOSED' }, { action: 'note', id: J.a1, note: 'intrus' }, { action: 'deadline', id: J.a1, dueDate: null },
      { action: 'plan', id: J.a1, planStep: { nextActionKey: 'submit_request' } }]) {
      expect((await call('POST', '/api/citizen/parcours', { as: B, body })).statusCode, body.action).toBe(404);
    }
    expect((await call('GET', `/api/citizen/parcours?history=${J.a1}`, { as: B })).statusCode).toBe(404);
    expect((await call('DELETE', '/api/citizen/parcours', { as: B, body: { id: J.a1 } })).statusCode).toBe(404);
    const b1 = ok(await call('POST', '/api/citizen/parcours', { as: B, body: { action: 'add', title: 'Étape de B' } })).item.id;
    expect((await call('POST', '/api/citizen/parcours', { as: A, body: { action: 'plan', id: J.a1, planStep: { dependsOnItemId: b1 } } })).statusCode, 'no dependency on another person’s step').toBe(400);
    const mine = ok(await call('GET', '/api/citizen/parcours', { as: A })).items;
    expect(mine.find((i) => i.id === J.a1)).toMatchObject({ status: 'IN_PROGRESS', note: 'Appeler la CAF lundi' });
    expect(mine.map((i) => i.id)).not.toContain(b1);
  });

  it('the data export (art. 15/20) contains the steps, their history and their reminders — and only the person’s own', async () => {
    await db.execute(sql`INSERT INTO "ParcoursReminder" ("itemId", threshold, channel, status) VALUES (${J.a1}, 'J7', 'email', 'NO_CONSENT')`);
    const exp = ok(await call('GET', '/api/auth/export-data', { as: A }));
    expect(exp.parcours.map((i) => i.id).sort()).toEqual([J.a1, J.a2].sort());
    expect(exp.parcours.find((i) => i.id === J.a1)).toMatchObject({ note: 'Appeler la CAF lundi', dueSourceUrl: OFFICIAL });
    expect(exp.parcours.find((i) => i.id === J.a2).planStep).toMatchObject({ closure: 'OUTCOME_UNKNOWN', dependsOnItemId: J.a1 });
    expect(exp.parcoursHistory.length).toBe((await counts(A.id)).events);
    expect(exp.parcoursHistory.every((e) => e.userId === A.id)).toBe(true);
    expect(exp.parcoursReminders).toEqual([expect.objectContaining({ itemId: J.a1, threshold: 'J7', channel: 'email', status: 'NO_CONSENT' })]);
    expect(JSON.stringify(exp)).not.toContain('Étape de B');
  });

  it('the reviewed erasure (C21) removes every Mon Parcours row of the person, and nothing of another person', async () => {
    const before = await counts(A.id);
    expect(before).toMatchObject({ items: 2, reminders: 1 }); expect(before.events).toBeGreaterThan(0);
    const req = await call('DELETE', '/api/auth/delete-account', { as: A });
    expect(req.statusCode, JSON.stringify(req.body)).toBe(202);
    const id = req.body.requestId;
    expect((await review.proposeErasure(id, { decision: 'APPROVE' }, S, db)).ok).toBe(true);
    const [{ o }] = await rows(sql`SELECT "reviewOutcome" AS o FROM "DSRRequest" WHERE id = ${id}`);
    expect((await review.readErasure(id, X, db)).ok).toBe(true);
    const done = await review.confirmErasure(id, { action: 'confirm', note: 'Deuxième relecture, identité vérifiée', proposedAt: o.proposal.proposedAt }, X, db);
    expect(done.request?.status, JSON.stringify(done)).toBe('COMPLETED');
    expect(await counts(A.id)).toEqual({ items: 0, events: 0, reminders: 0 });
    expect(await remindersOf(J.a1)).toBe(0);
    expect((await counts(B.id)).items, 'B keeps their step').toBe(1);
  });

  it('6c: a never-confirmed account purged after 7 days takes its Mon Parcours rows with it', async () => {
    const [it6] = await rows(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "updatedAt") VALUES (gen_random_uuid()::text, ${U.id}, 'MANUAL', 'custom', 'Étape de U', NOW()) RETURNING id`);
    await db.execute(sql`INSERT INTO "ParcoursEvent" (id, "itemId", "userId", kind, "toStatus") VALUES (gen_random_uuid()::text, ${it6.id}, ${U.id}, 'CREATED', 'NOT_STARTED')`);
    await db.execute(sql`INSERT INTO "ParcoursReminder" ("itemId", threshold, channel, status) VALUES (${it6.id}, 'J1', 'email', 'NO_CONSENT')`);
    const purge = await import('../../api/_handlers/cron/gdpr-purge.js');
    const STEPS = ['unverifiedAccountsDeleted'];
    const r = await purge.runGdprPurge({ policy: approvedTestPolicy({ steps: STEPS }), env: approvalEnv(STEPS) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await rows(sql`SELECT count(*)::int AS n FROM "CitizenUser" WHERE id = ${U.id}`))[0].n).toBe(0);
    expect(await counts(U.id)).toEqual({ items: 0, events: 0, reminders: 0 });
    expect((await counts(B.id)).items, 'a confirmed account is untouched').toBe(1);
  });
});
