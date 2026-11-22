/**
 * G14 (22/11/2026) — the LIMITED Mon Parcours on REAL PostgreSQL, THROUGH THE REAL API ENTRY (api/index.js), in the exact opening profile the owner would
 * set (narrow accounts scope + ADA_BETA_ACCOUNTS_EXTRA=parcours + ADA_CAPABILITIES_OPEN=citizen.parcours) and with every G14 switch at its default
 * (notes, delegate read, external reminders OFF; the former contract NOT allowed). Proven:
 *   - the closed list: a step is a code of data/reference/parcours-step-types.v1.json; its title is the list's label; a free title, records, plan data,
 *     consent, import or any other field is refused (400) and NOTHING is stored;
 *   - the organisation: only a PUBLISHED structure of a kind the type allows (same refusal for unknown / hidden / other-kind / sensitive-name: no oracle);
 *     the structure search lists only those;
 *   - a deadline cites one of the type's official fiches (default the first); a free address is refused;
 *   - notes OFF: refused, clearing allowed; GET says notes:false, sensitiveSteps:'excluded', planImport:false, emailReminders:false;
 *   - authorisation: only the account owner — another citizen reads / changes / deletes / dates nothing of A (uniform 404), no session or an admin token
 *     gets 401; the delegate read is closed (PARCOURS_READ not offered);
 *   - the reminder job reads and sends nothing (EXTERNAL_REMINDERS_OFF);
 *   - export (art. 15/20) contains the step type and the structure reference; the reviewed erasure removes every row;
 *   - retention: the closed-step purge is counted in a dry run, refused while « à approuver » even with a step record, and — on a copy of the policy with
 *     the mark removed — deletes only closed steps past the duration (history and ledger cascade), never an open step, a held one or another person's.
 * Synthetic data only. Skipped without DATABASE_URL.
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
const A = { id: `g14-a-${TS}`, email: `g14-a-${TS}@example.test` };
const B = { id: `g14-b-${TS}`, email: `g14-b-${TS}@example.test` };
const S = `g14-s-${TS}@example.test`; const X = `g14-x-${TS}@example.test`;
const CSRF = `g14csrf${TS}`;
const CAF = { id: `g14-caf-${TS}`, nom: `Caf test G14 ${TS}`, type: 'Caf (Caisse d\'allocations familiales)' };
const MAIRIE = { id: `g14-mairie-${TS}`, nom: `Mairie test G14 ${TS}`, type: 'Mairie' };
const CSAPA = { id: `g14-csapa-${TS}`, nom: `Centre test G14 ${TS}`, type: 'Centre de soins, d’accompagnement et de prévention en addictologie (CSAPA)' };
const HIDDEN = { id: `g14-hidden-${TS}`, nom: `Caf brouillon G14 ${TS}`, type: 'Caf (Caisse d\'allocations familiales)', statut: 'brouillon' };
const NAMED = { id: `g14-named-${TS}`, nom: `Caf G14 ${TS} — permanence CADA`, type: 'Caf (Caisse d\'allocations familiales)' };
const RSA_FICHE = 'https://www.service-public.gouv.fr/particuliers/vosdroits/N19775';
const RSA_FICHE_2 = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F19778';
const ENV_KEYS = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_BETA_ACCOUNTS_SCOPE', 'ADA_BETA_ACCOUNTS_EXTRA', 'ADA_CAPABILITIES_OPEN', 'ADA_HDS_CERTIFIED_HOSTING',
  'ADA_BETA_OPEN_JOBS', 'ADA_JOBS_APPROVED', 'MAILER_PROVIDER', 'MAILER_FROM', 'ADA_PARCOURS_NOTES', 'ADA_PARCOURS_DELEGATE_READ', 'ADA_PARCOURS_EXTERNAL_REMINDERS',
  'ADA_PARCOURS_LEGACY_CONTRACT', 'ADA_PARCOURS_SENSITIVE_STEPS'];
/** the opening profile (CONTROL/master/completion/G14_MON_PARCOURS_OUVERTURE_FR.md), every G14 switch unset */
const OPENING = { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts', ADA_BETA_ACCOUNTS_SCOPE: undefined, ADA_BETA_ACCOUNTS_EXTRA: 'parcours',
  ADA_CAPABILITIES_OPEN: 'citizen.parcours', ADA_HDS_CERTIFIED_HOSTING: undefined, ADA_BETA_OPEN_JOBS: undefined, ADA_JOBS_APPROVED: undefined, MAILER_PROVIDER: 'test',
  MAILER_FROM: 'qa@example.test', ADA_PARCOURS_NOTES: undefined, ADA_PARCOURS_DELEGATE_READ: undefined, ADA_PARCOURS_EXTERNAL_REMINDERS: undefined,
  ADA_PARCOURS_LEGACY_CONTRACT: undefined, ADA_PARCOURS_SENSITIVE_STEPS: undefined };
const setEnv = (vars) => { for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('G14 — the limited Mon Parcours (real API entry, real PostgreSQL)', () => {
  let db, api, userAuth, review;
  const saved = {}; const J = {};
  const call = async (method, url, { as, body, headers = {} } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const h = { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...headers };
    if (as) Object.assign(h, { cookie: `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: as.id, email: as.email })).split(';')[0]}; __csrf=${CSRF}`, 'x-csrf-token': CSRF });
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, socket: {}, headers: h };
    const res = mkRes(); await api(req, res);
    await (await import('../../api/_utils/after-response.js')).settleAfterResponse();
    return res;
  };
  const P = (as, body) => call('POST', '/api/citizen/parcours', { as, body });
  const ok = (r) => { expect(r.statusCode, JSON.stringify(r.body)).toBeLessThan(300); return r.body; };
  const rows = async (q) => (await db.execute(q)).rows;
  const counts = async (userId) => (await rows(sql`SELECT
      (SELECT count(*)::int FROM "ParcoursItem" WHERE "userId" = ${userId}) AS items,
      (SELECT count(*)::int FROM "ParcoursEvent" WHERE "userId" = ${userId}) AS events,
      (SELECT count(*)::int FROM "ParcoursReminder" r WHERE r."itemId" IN (SELECT id FROM "ParcoursItem" WHERE "userId" = ${userId})) AS reminders`))[0];
  const refused = async (r, status, code, userId = A.id) => {
    expect([r.statusCode, r.body?.error], JSON.stringify(r.body)).toEqual([status, code]);
    expect(await counts(userId)).toEqual(J.base);
  };
  const structure = (s) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, data_origin, "updatedAt", "createdAt")
    VALUES (${s.id}, ${s.nom}, ${'slug-' + s.id}, ${s.type}, '1 rue test', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], ${s.statut || 'actif'}, 'synthetic_fixture', NOW(), NOW())`);

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv(OPENING);
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; userAuth = await import('../../api/_utils/user-auth.js');
    review = await import('../../api/_services/dsr-erasure-review.js');
    for (const c of [A, B]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    for (const e of [S, X]) await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "updatedAt", "failedLoginAttempts", "mfaEnabled") VALUES (${'id-' + e}, ${e}, 'x', 'admin', NOW(), 0, true)`);
    for (const s of [CAF, MAIRIE, CSAPA, HIDDEN, NAMED]) await structure(s);
  }, 90000);

  afterAll(async () => {
    try {
      if (!db) return;
      for (const c of [A, B]) await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
      for (const e of [S, X]) await db.execute(sql`DELETE FROM "AdminUser" WHERE email = ${e}`).catch(() => {});
      for (const s of [CAF, MAIRIE, CSAPA, HIDDEN, NAMED]) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${s.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "LegalHold" WHERE id = ${'g14-hold-' + TS}`).catch(() => {});
    } finally { setEnv(saved); }
  });

  it('GET says the contract: the closed list, notes off, sensitive steps excluded, no import, no e-mail reminder', async () => {
    const list = ok(await call('GET', '/api/citizen/parcours', { as: A }));
    expect(list).toMatchObject({ contract: 'limited', items: [], notes: false, sensitiveSteps: 'excluded', planImport: false, emailReminders: false });
    expect(list.stepTypes.types).toHaveLength(28);
    expect(list.stepTypes.types.find((t) => t.code === 'RSA_DEMANDE')).toMatchObject({ label: 'Demander le RSA', structureKinds: expect.arrayContaining(['caf']) });
  });

  it('a step is a code of the list; every other field or action is refused and nothing is stored', async () => {
    J.base = await counts(A.id);
    for (const body of [
      { action: 'add', title: 'Demander le RSA' },
      { action: 'add', stepType: 'RSA_DEMANDE', title: 'Dossier MDPH' },
      { action: 'add', stepType: 'RSA_DEMANDE', records: [{ type: 'structure', id: CAF.id }] },
      { action: 'add', stepType: 'RSA_DEMANDE', planStep: { actor: { kind: 'organisation', name: 'CSAPA' } } },
      { action: 'add', stepType: 'RSA_DEMANDE', sensitiveConsent: true },
      { action: 'add', stepType: 'RSA_DEMANDE', organisation: 'Hôpital civil' },
      { action: 'add', records: [{ type: 'aide', id: 'x' }] },
    ]) await refused(await P(A, body), 400, 'FIELD_NOT_ALLOWED');
    await refused(await P(A, { action: 'add', stepType: 'DEMANDER_AAH' }), 400, 'INVALID_STEP_TYPE');
    await refused(await P(A, { action: 'import', shareId: 'x' }), 400, 'ACTION_NOT_ALLOWED');
    await refused(await P(A, { action: 'plan', id: 'x', planStep: { need: 'asile' } }), 400, 'ACTION_NOT_ALLOWED');
  });

  it('the organisation: only a published structure of an allowed kind; the search lists only those', async () => {
    for (const s of [CSAPA, HIDDEN, NAMED, MAIRIE, { id: `g14-nope-${TS}` }]) await refused(await P(A, { action: 'add', stepType: 'RSA_DEMANDE', structureId: s.id }), 422, 'STRUCTURE_NOT_ALLOWED');
    const found = ok(await call('GET', `/api/citizen/parcours?structuresFor=RSA_DEMANDE&q=${encodeURIComponent('G14 ' + TS)}`, { as: A })).structures;
    expect(found).toEqual([{ id: CAF.id, name: CAF.nom, town: 'Strasbourg' }]);
    expect(ok(await call('GET', `/api/citizen/parcours?structuresFor=CARTE_IDENTITE_DEMANDE&q=${encodeURIComponent('G14 ' + TS)}`, { as: A })).structures.map((s) => s.id)).toEqual([MAIRIE.id]);
    // the search words are matched literally (a % or _ is not a wildcard)
    expect(ok(await call('GET', '/api/citizen/parcours?structuresFor=RSA_DEMANDE&q=%25%25', { as: A })).structures).toEqual([]);
  });

  it('adds steps: the list label as title, the type and the structure in itemCodes, idempotent, one history line', async () => {
    const r = ok(await P(A, { action: 'add', stepType: 'RSA_DEMANDE', structureId: CAF.id }));
    expect(r).toMatchObject({ added: true, item: { stepType: 'RSA_DEMANDE', title: 'Demander le RSA', itemCodes: ['steptype:RSA_DEMANDE', `structure:${CAF.id}`], note: null } });
    J.a1 = r.item.id;
    expect(ok(await P(A, { action: 'add', stepType: 'RSA_DEMANDE', structureId: CAF.id }))).toMatchObject({ added: false, item: { id: J.a1 } });
    J.a2 = ok(await P(A, { action: 'add', stepType: 'CARTE_IDENTITE_DEMANDE' })).item.id;
    const list = ok(await call('GET', '/api/citizen/parcours', { as: A }));
    expect(list.items.map((i) => [i.stepType, i.title])).toEqual([['RSA_DEMANDE', 'Demander le RSA'], ['CARTE_IDENTITE_DEMANDE', 'Demander une carte d\'identité']]);
    expect(list.items[0].records).toEqual([expect.objectContaining({ type: 'structure', available: true, title: CAF.nom })]);
    expect((await counts(A.id))).toMatchObject({ items: 2, events: 2 });
    J.b1 = ok(await P(B, { action: 'add', stepType: 'PASSEPORT_DEMANDE' })).item.id;
  });

  it('status, a deadline citing one of the type’s fiches, notes off (clearing allowed)', async () => {
    expect(ok(await P(A, { action: 'status', id: J.a1, status: 'SUBMITTED' })).item.status).toBe('SUBMITTED');
    const due = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
    expect(ok(await P(A, { action: 'deadline', id: J.a1, dueDate: due })).item.dueSourceUrl).toBe(RSA_FICHE);
    expect(ok(await P(A, { action: 'deadline', id: J.a1, dueDate: due, dueSourceUrl: RSA_FICHE_2 })).item.dueSourceUrl).toBe(RSA_FICHE_2);
    J.base = await counts(A.id);
    const r = await P(A, { action: 'deadline', id: J.a1, dueDate: due, dueSourceUrl: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12242' });
    expect([r.statusCode, r.body.error]).toEqual([422, 'DEADLINE_SOURCE_NOT_ALLOWED']);
    const n = await P(A, { action: 'note', id: J.a1, note: 'Appeler mardi' });
    expect([n.statusCode, n.body.error]).toEqual([409, 'NOTES_CLOSED']);
    expect((await rows(sql`SELECT note, "dueSourceUrl" FROM "ParcoursItem" WHERE id = ${J.a1}`))[0]).toEqual({ note: null, dueSourceUrl: RSA_FICHE_2 });
    expect(ok(await P(A, { action: 'note', id: J.a1, note: null })).item.note).toBeNull();
  });

  it('authorisation: only the account owner — another citizen gets the uniform 404, no session or an admin token 401', async () => {
    const before = await counts(A.id);
    for (const body of [{ action: 'status', id: J.a1, status: 'CLOSED' }, { action: 'deadline', id: J.a1, dueDate: null }, { action: 'note', id: J.a1, note: null }]) {
      const r = await P(B, body); expect([r.statusCode, r.body.error], JSON.stringify(body)).toEqual([404, 'NOT_FOUND']);
    }
    expect((await call('DELETE', '/api/citizen/parcours', { as: B, body: { id: J.a1 } })).statusCode).toBe(404);
    expect((await call('GET', `/api/citizen/parcours?history=${J.a1}`, { as: B })).statusCode).toBe(404);
    expect(ok(await call('GET', '/api/citizen/parcours', { as: B })).items.map((i) => i.id)).toEqual([J.b1]);
    expect(await counts(A.id)).toEqual(before);
    expect((await call('GET', '/api/citizen/parcours')).statusCode).toBe(401);
    expect((await call('GET', '/api/citizen/parcours', { headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` } })).statusCode).toBe(401);
    // the delegate read is closed: PARCOURS_READ is not among the offered scopes, whatever the capabilities
    const { openScopes } = await import('../../api/_services/delegation.js');
    expect(openScopes(() => true)).not.toContain('PARCOURS_READ');
    const { delegateView } = await import('../../api/_services/delegation.js');
    expect(await delegateView(B.id, 'any', 'parcours', db, { isOpen: () => true })).toMatchObject({ ok: false, status: 404, code: 'CAPABILITY_NOT_OPEN' });
  });

  it('the reminder job reads and sends nothing while external reminders are off', async () => {
    const handler = (await import('../../api/_handlers/cron/parcours-reminder.js')).default;
    const res = mkRes();
    await handler({ method: 'GET', url: '/api/cron/parcours-reminder', query: {}, headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }, res);
    expect(res.body).toEqual({ ok: true, skipped: true, reason: 'EXTERNAL_REMINDERS_OFF' });
    expect((await counts(A.id)).reminders).toBe(0);
  });

  it('retention: counted in a dry run; refused while « à approuver »; once approved, deletes only closed steps past 730 days', async () => {
    const purge = await import('../../api/_handlers/cron/gdpr-purge.js');
    // an old closed step of A, an old closed step of B under legal hold, an old OPEN step of A
    const old = (u, title, status) => rows(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", "itemCodes", title, status, "updatedAt") VALUES (gen_random_uuid()::text, ${u}, 'MANUAL', 'custom', '{steptype:PASSEPORT_DEMANDE}', ${title}, ${status}, NOW() - interval '800 days') RETURNING id`);
    const [oldA] = await old(A.id, 'Demander un passeport', 'CLOSED');
    await db.execute(sql`INSERT INTO "ParcoursEvent" (id, "itemId", "userId", kind, "fromStatus", "toStatus", "createdAt") VALUES (gen_random_uuid()::text, ${oldA.id}, ${A.id}, 'STATUS', 'SUBMITTED', 'CLOSED', NOW() - interval '800 days')`);
    const [oldOpen] = await old(A.id, 'Demander un acte de naissance', 'IN_PROGRESS');
    const [oldB] = await old(B.id, 'Demander un passeport', 'DECISION_POSITIVE');
    await db.execute(sql`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status) VALUES (${'g14-hold-' + TS}, 'ParcoursItem', ${oldB.id}, 'LITIGATION', 'test', 'ACTIVE')`);
    // a step closed recently (its history says so) is kept even if the row is old
    const [recent] = await old(A.id, 'Demander un passeport', 'CLOSED');
    await db.execute(sql`INSERT INTO "ParcoursEvent" (id, "itemId", "userId", kind, "fromStatus", "toStatus", "createdAt") VALUES (gen_random_uuid()::text, ${recent.id}, ${A.id}, 'STATUS', 'SUBMITTED', 'CLOSED', NOW() - interval '10 days')`);

    // the in-app notice 30 days before: never while the duration is only proposed; with an approved duration, for the closed step only (kind and link only)
    const { listInbox } = await import('../../api/_services/citizen-inbox.js');
    const kinds = async (policy) => (await listInbox(A.id, db, { isOpen: (c) => c === 'citizen.parcours', ...(policy ? { policy } : {}) })).notifications.filter((i) => i.kind === 'PARCOURS_CLOSED_STEP_EXPIRING');
    expect(await kinds()).toEqual([]);
    const noMark = { durations: { PARCOURS_CLOSED_STEP_DAYS: { days: 730 } } };
    expect((await kinds(noMark)).map((i) => Object.keys(i).sort())).toEqual([['at', 'id', 'kind', 'link', 'unread']]);

    const dry = await purge.runGdprPurge({ env: {} });
    const line = dry.body.steps.find((l) => l.id === 'parcoursClosedStepsDeleted');
    expect(line).toMatchObject({ decision: 'dry-run', days: 730, table: 'ParcoursItem' });
    expect(line.count).toBeGreaterThanOrEqual(1);

    const STEPS = ['parcoursClosedStepsDeleted'];
    const pending = await purge.runGdprPurge({ policy: approvedTestPolicy({ steps: STEPS }), env: approvalEnv(STEPS) });
    expect(pending.body.steps.find((l) => l.id === 'parcoursClosedStepsDeleted')).toMatchObject({ decision: 'not_approved_in_policy', approvalProblem: 'DURATION_PENDING_APPROVAL' });
    expect((await rows(sql`SELECT count(*)::int AS n FROM "ParcoursItem" WHERE id = ${oldA.id}`))[0].n).toBe(1);

    const p = approvedTestPolicy({ steps: STEPS });
    const approved = { ...p, durations: { ...p.durations, PARCOURS_CLOSED_STEP_DAYS: { ...p.durations.PARCOURS_CLOSED_STEP_DAYS, pendingApproval: undefined } } };
    const run = await purge.runGdprPurge({ policy: approved, env: approvalEnv(STEPS) });
    expect(run.body.steps.find((l) => l.id === 'parcoursClosedStepsDeleted'), JSON.stringify(run.body)).toMatchObject({ decision: 'executed' });
    const left = (await rows(sql`SELECT id FROM "ParcoursItem" WHERE id IN (${oldA.id}, ${oldOpen.id}, ${oldB.id}, ${recent.id}, ${J.a1})`)).map((r) => r.id).sort();
    expect(left).toEqual([oldOpen.id, oldB.id, recent.id, J.a1].sort());
    expect((await rows(sql`SELECT count(*)::int AS n FROM "ParcoursEvent" WHERE "itemId" = ${oldA.id}`))[0].n).toBe(0);
    for (const id of [oldOpen.id, oldB.id, recent.id]) await db.execute(sql`DELETE FROM "ParcoursItem" WHERE id = ${id}`);
  });

  it('export (art. 15/20) holds the steps with their type and structure reference, their history; erasure removes every row', async () => {
    const exp = ok(await call('GET', '/api/auth/export-data', { as: A }));
    expect(exp.parcours.map((i) => i.id).sort()).toEqual([J.a1, J.a2].sort());
    expect(exp.parcours.find((i) => i.id === J.a1)).toMatchObject({ title: 'Demander le RSA', itemCodes: ['steptype:RSA_DEMANDE', `structure:${CAF.id}`], dueSourceUrl: RSA_FICHE_2 });
    expect(exp.parcoursHistory.length).toBe((await counts(A.id)).events);
    expect(JSON.stringify(exp)).not.toContain(J.b1);
    const req = await call('DELETE', '/api/auth/delete-account', { as: A });
    expect(req.statusCode, JSON.stringify(req.body)).toBe(202);
    const id = req.body.requestId;
    expect((await review.proposeErasure(id, { decision: 'APPROVE' }, S, db)).ok).toBe(true);
    const [{ o }] = await rows(sql`SELECT "reviewOutcome" AS o FROM "DSRRequest" WHERE id = ${id}`);
    expect((await review.readErasure(id, X, db)).ok).toBe(true);
    const done = await review.confirmErasure(id, { action: 'confirm', note: 'Deuxième relecture, identité vérifiée', proposedAt: o.proposal.proposedAt }, X, db);
    expect(done.request?.status, JSON.stringify(done)).toBe('COMPLETED');
    expect(await counts(A.id)).toEqual({ items: 0, events: 0, reminders: 0 });
    expect((await counts(B.id)).items, 'B keeps their step').toBe(1);
  });
});
