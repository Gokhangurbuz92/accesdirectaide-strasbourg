/**
 * G8 — functional acceptance of Mon Parcours as it would open after counsel's answer, LAB, REAL API ENTRY (api/index.js: CSRF, beta surface gate, R45
 * capability gate) and REAL PostgreSQL. Opening profile of G4 (narrow accounts scope + parcours, citizen.parcours named, nothing else open):
 *   create an account (signup → e-mail link → verify → login: no row written by hand) → open Mon Parcours → add, organise, date, annotate and complete
 *   steps → sensitive step: refused by default, then (ADA_PARCOURS_SENSITIVE_STEPS=consent) only with the person's explicit consent → export (art. 15/20)
 *   holds every step, its history, its reminder and the consent → the reviewed erasure removes everything of the account.
 * Synthetic data only (example.test addresses, test mail outbox). Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0,
  lpush: async () => 1, ltrim: async () => 'OK', lrange: async () => [] } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `${Date.now()}${crypto.randomBytes(2).toString('hex')}`;
const EMAIL = `g8acc-${TS}@example.test`;
const PASSWORD = 'G8-acceptance-pass!42';
const S = `g8acc-s-${TS}@example.test`; const X = `g8acc-x-${TS}@example.test`;   // the two administrators of the reviewed erasure
const CSRF = `g8acccsrf${TS}`;
const OFFICIAL = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006';
const ENV_KEYS = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_BETA_ACCOUNTS_SCOPE', 'ADA_BETA_ACCOUNTS_EXTRA', 'ADA_CAPABILITIES_OPEN', 'ADA_HDS_CERTIFIED_HOSTING',
  'ADA_BETA_OPEN_JOBS', 'ADA_JOBS_APPROVED', 'ADA_PARCOURS_SENSITIVE_STEPS', 'MAILER_PROVIDER', 'MAILER_FROM'];
const OPENING = { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts', ADA_BETA_ACCOUNTS_SCOPE: undefined, ADA_BETA_ACCOUNTS_EXTRA: 'parcours',
  ADA_CAPABILITIES_OPEN: 'citizen.parcours', ADA_HDS_CERTIFIED_HOSTING: undefined, ADA_BETA_OPEN_JOBS: undefined, ADA_JOBS_APPROVED: undefined, ADA_PARCOURS_SENSITIVE_STEPS: undefined,
  MAILER_PROVIDER: 'test', MAILER_FROM: 'qa@example.test' };
const setEnv = (vars) => { for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = v; }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c, h) { this.statusCode = c; for (const [k, v] of Object.entries(h || {})) headers[String(k).toLowerCase()] = v; return this; },
    json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('G8 acceptance — account → Mon Parcours → sensitive step → export → erasure (real API entry, real PostgreSQL)', () => {
  let db, api, mailer, review;
  const saved = {}; const J = {};
  let session = '';
  const call = async (method, url, { body, auth = true } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const cookie = [`__csrf=${CSRF}`, auth && session ? session : null].filter(Boolean).join('; ');
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, socket: {},
      headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', 'content-type': 'application/json', cookie, 'x-csrf-token': CSRF } };
    const res = mkRes(); await api(req, res);
    await (await import('../../api/_utils/after-response.js')).settleAfterResponse();
    return res;
  };
  const P = (body) => call('POST', '/api/citizen/parcours', { body });
  const ok = (r) => { expect(r.statusCode, JSON.stringify(r.body)).toBeLessThan(300); return r.body; };
  const rows = async (q) => (await db.execute(q)).rows;
  const counts = async () => (await rows(sql`SELECT
      (SELECT count(*)::int FROM "ParcoursItem" WHERE "userId" = ${J.userId}) AS items,
      (SELECT count(*)::int FROM "ParcoursEvent" WHERE "userId" = ${J.userId}) AS events,
      (SELECT count(*)::int FROM "ParcoursReminder" r WHERE r."itemId" IN (SELECT id FROM "ParcoursItem" WHERE "userId" = ${J.userId})) AS reminders,
      (SELECT count(*)::int FROM "CitizenUser" WHERE id = ${J.userId}) AS account`))[0];

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv(OPENING);
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default;
    mailer = await import('../../api/_utils/mailer.js');
    review = await import('../../api/_services/dsr-erasure-review.js');
    for (const e of [S, X]) await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "updatedAt", "failedLoginAttempts", "mfaEnabled") VALUES (${'id-' + e}, ${e}, 'x', 'admin', NOW(), 0, true)`);
  }, 90000);

  afterAll(async () => {
    try {
      if (!db) return;
      if (J.userId) {
        await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${J.userId}`).catch(() => {});
        await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${J.userId}`).catch(() => {});
      }
      await db.execute(sql`DELETE FROM "CitizenUser" WHERE email = ${EMAIL}`).catch(() => {});
      for (const e of [S, X]) await db.execute(sql`DELETE FROM "AdminUser" WHERE email = ${e}`).catch(() => {});
    } finally { setEnv(saved); }
  });

  it('1. an account is created through the real sign-up, e-mail confirmation and sign-in', async () => {
    mailer.__clearTestOutbox();
    const created = await call('POST', '/api/auth/signup', { auth: false, body: { email: EMAIL, password: PASSWORD, adultDeclaration: true, termsAccepted: true } });
    expect(created.statusCode, JSON.stringify(created.body)).toBe(200);
    const mail = mailer.__getTestOutbox().find((m) => m.to === EMAIL && m.category === 'email_verify');
    expect(mail, 'verification e-mail').toBeTruthy();
    const token = new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
    const verified = await call('GET', `/api/auth/verify-email?token=${encodeURIComponent(token)}`, { auth: false });
    expect(String(verified.headers.location || '')).toContain('status=success');
    const logged = await call('POST', '/api/auth/login', { auth: false, body: { email: EMAIL, password: PASSWORD } });
    expect(logged.statusCode, JSON.stringify(logged.body)).toBe(200);
    const set = [].concat(logged.headers['set-cookie'] || []).map(String);
    session = set.map((c) => c.split(';')[0]).filter((c) => !c.startsWith('__csrf=')).join('; ');
    expect(session.length).toBeGreaterThan(10);
    J.userId = (await rows(sql`SELECT id FROM "CitizenUser" WHERE email = ${EMAIL}`))[0].id;
    expect(ok(await call('GET', '/api/auth/me')).session.kind).toBe('user');
  });

  it('2. Mon Parcours is open for the account (and only Mon Parcours): steps are added, organised, dated, annotated and completed', async () => {
    const empty = ok(await call('GET', '/api/citizen/parcours'));
    expect(empty).toMatchObject({ items: [], planImport: false, sensitiveSteps: 'excluded' });
    expect((await call('GET', '/api/citizen/favorites')).statusCode, 'the rest of the full scope stays closed').toBe(503);
    J.s1 = ok(await P({ action: 'add', title: 'Demander l’aide au logement', planStep: { actor: { kind: 'citizen' }, need: 'aides-logement' } })).item.id;
    J.s2 = ok(await P({ action: 'add', title: 'Rassembler les justificatifs' })).item.id;
    ok(await P({ action: 'plan', id: J.s2, planStep: { dependsOnItemId: J.s1, nextActionKey: 'gather_documents' } }));
    ok(await P({ action: 'deadline', id: J.s1, dueDate: new Date(Date.now() + 20 * 864e5).toISOString(), dueSourceUrl: OFFICIAL }));
    ok(await P({ action: 'note', id: J.s1, note: 'Appeler la CAF lundi' }));
    for (const s of ['IN_PROGRESS', 'SUBMITTED', 'DECISION_POSITIVE']) ok(await P({ action: 'status', id: J.s1, status: s }));
    ok(await P({ action: 'status', id: J.s2, status: 'CLOSED' }));
    const list = ok(await call('GET', '/api/citizen/parcours'));
    expect(list.items.find((i) => i.id === J.s1)).toMatchObject({ status: 'DECISION_POSITIVE', note: 'Appeler la CAF lundi', dueSourceUrl: OFFICIAL, step: { need: { id: 'aides-logement' } } });
    expect(list.items.find((i) => i.id === J.s2)).toMatchObject({ status: 'CLOSED', dependsOn: { id: J.s1, done: true }, waiting: false });
    expect(ok(await call('GET', `/api/citizen/parcours?history=${J.s1}`)).events.map((e) => e.kind)).toEqual(['CREATED', 'DEADLINE', 'NOTE', 'STATUS', 'STATUS', 'STATUS']);
  });

  it('3. a sensitive step: refused by default (nothing stored); after the switch, only with the person’s explicit consent', async () => {
    const before = await counts();
    const refused = await P({ action: 'add', title: 'Déposer le dossier MDPH' });
    expect([refused.statusCode, refused.body.error]).toEqual([422, 'SENSITIVE_STEP_EXCLUDED']);
    expect((await P({ action: 'note', id: J.s2, note: 'Demander un certificat au médecin' })).statusCode).toBe(422);
    expect(await counts()).toEqual(before);

    setEnv({ ADA_PARCOURS_SENSITIVE_STEPS: 'consent' });   // the one change foreseen after counsel's answer « yes, with explicit consent »
    expect(ok(await call('GET', '/api/citizen/parcours')).sensitiveSteps).toBe('consent');
    const asked = await P({ action: 'add', title: 'Déposer le dossier MDPH' });
    expect([asked.statusCode, asked.body.error]).toEqual([409, 'SENSITIVE_STEP_CONSENT_REQUIRED']);
    expect(await counts()).toEqual(before);
    const kept = await P({ action: 'add', title: 'Déposer le dossier MDPH', sensitiveConsent: true });
    expect(kept.statusCode, JSON.stringify(kept.body)).toBe(201);
    J.s3 = kept.body.item.id;
    expect(ok(await call('GET', '/api/citizen/parcours')).items.find((i) => i.id === J.s3)).toMatchObject({ sensitive: true, status: 'NOT_STARTED' });
    ok(await P({ action: 'status', id: J.s3, status: 'IN_PROGRESS' }));
  });

  it('4. the export (art. 15/20) holds every step, its history, its reminder and the consent given for the sensitive step', async () => {
    await db.execute(sql`INSERT INTO "ParcoursReminder" ("itemId", threshold, channel, status) VALUES (${J.s1}, 'J7', 'email', 'NO_CONSENT')`);
    const exp = ok(await call('GET', '/api/auth/export-data'));
    expect(exp.parcours.map((i) => i.id).sort()).toEqual([J.s1, J.s2, J.s3].sort());
    expect(exp.parcours.find((i) => i.id === J.s1)).toMatchObject({ note: 'Appeler la CAF lundi', status: 'DECISION_POSITIVE' });
    expect(exp.parcours.find((i) => i.id === J.s3).planStep.sensitive.at).toEqual(expect.any(String));
    expect(exp.parcoursHistory.length).toBe((await counts()).events);
    expect(exp.parcoursReminders).toEqual([expect.objectContaining({ itemId: J.s1, threshold: 'J7' })]);
  });

  it('5. the reviewed erasure removes the account and every Mon Parcours row', async () => {
    expect(await counts()).toMatchObject({ items: 3, reminders: 1, account: 1 });
    const req = await call('DELETE', '/api/auth/delete-account');
    expect(req.statusCode, JSON.stringify(req.body)).toBe(202);
    const id = req.body.requestId;
    expect((await review.proposeErasure(id, { decision: 'APPROVE' }, S, db)).ok).toBe(true);
    const [{ o }] = await rows(sql`SELECT "reviewOutcome" AS o FROM "DSRRequest" WHERE id = ${id}`);
    expect((await review.readErasure(id, X, db)).ok).toBe(true);
    const done = await review.confirmErasure(id, { action: 'confirm', note: 'Deuxième relecture, identité vérifiée', proposedAt: o.proposal.proposedAt }, X, db);
    expect(done.request?.status, JSON.stringify(done)).toBe('COMPLETED');
    expect(await counts()).toEqual({ items: 0, events: 0, reminders: 0, account: 0 });
    for (const sid of [J.s1, J.s2, J.s3]) expect((await rows(sql`SELECT count(*)::int AS n FROM "ParcoursEvent" WHERE "itemId" = ${sid}`))[0].n).toBe(0);
  });
});
