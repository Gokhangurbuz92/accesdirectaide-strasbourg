/**
 * M1 — the code released BEFORE migration 0046 is applied (Production receives the migration later, separately authorised): on a database migrated up to
 * 0045 only, "ParcoursItem" has no "planStep" column. Drizzle names every schema column in select() / insert() / returning(), so without the
 * column-presence guard (api/_utils/schema-features.js parcoursPlanStepSchema / parcoursItemTable) every Mon Parcours request fails with « column
 * "planStep" does not exist » and the data export silently loses the person's steps. Here, through the real handler on such a database:
 *   - Mon Parcours behaves exactly as before M1 (list, add, records, import, status, deadline, note, history, delete);
 *   - plan data sent with « add » is not stored and the answer says so (planSaved: false); « plan » and the two closing reasons answer 409, change nothing;
 *   - the delegate's view and the person's data export still return the steps.
 * R47-QA: the file makes its own database at that level — a throwaway database on the suite's cluster, migrated by drizzle's migrator up to 0045
 * (tests/integration/helpers/throwaway-db.mjs), dropped at the end — so it runs wherever the suite runs (it used to skip itself on a migrated database
 * and needed a hand-made 0045 database). The app's database module is imported AFTER DATABASE_URL points at it (vitest isolates each file). Synthetic data only.
 */
import nodeCrypto from 'node:crypto';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createThrowawayDatabase, isLoopbackDatabaseUrl } from './helpers/throwaway-db.mjs';
// G14: these are proofs of the FORMER Mon Parcours contract (free titles, records, plan data, consent, import, delegate read): reachable only in the
// test suites (api/lib/parcours-limited.js legacyContractAllowed). The limited contract has its own proof: tests/integration/g14-parcours-limited-db.test.js
process.env.ADA_PARCOURS_LEGACY_CONTRACT = 'test-only';
process.env.ADA_PARCOURS_NOTES = 'on';   // G14: notes are off by default; this file proves the former note path

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const SUITE_URL = process.env.DATABASE_URL;
const hasDatabase = isLoopbackDatabaseUrl(SUITE_URL);   // a throwaway database is only made on a loopback cluster
const TS = Date.now();
const A = { id: `m1n-a-${TS}`, email: `m1n-a-${TS}@example.test` };
const B = { id: `m1n-b-${TS}`, email: `m1n-b-${TS}@example.test` };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const OFFICIAL = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F20055';

describe.skipIf(!hasDatabase)('M1 Mon Parcours on a database without migration 0046 (real DB)', () => {
  let db, userAuth, parcours, S, buildAssessment, UNSUPPORTED_RIGHTS, throwaway;
  const cookie = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const call = async ({ method = 'GET', body, query = {}, as } = {}) => { const r = mk(); await parcours({ method, url: '/api/citizen/parcours', query, body, headers: { host: 'localhost', ...(as ? { cookie: cookie(as) } : {}) } }, r); return r; };
  const post = (as, body) => call({ method: 'POST', as, body });
  const list = async (as) => (await call({ as })).body.items;
  const shares = []; const aides = [];

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase({ prefix: 'ada_m1_pre46', upTo: '0045_r43_appointment_notice_kinds' });
    process.env.DATABASE_URL = throwaway.url;   // before the first import of the database module in this file
    ({ db } = await import('../../src/db/index.js'));
    S = await import('../../src/db/schema.js');
    userAuth = await import('../../api/_utils/user-auth.js');
    ({ buildAssessment } = await import('../../api/lib/assessmentContract.js'));
    ({ UNSUPPORTED_RIGHTS } = await import('../../api/lib/diagnosticAssessment.js'));
    parcours = (await import('../../api/_handlers/citizen/parcours.js')).default;
    const absent = (await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ParcoursItem' AND column_name = 'planStep'`)).rows.length === 0;
    if (!absent || throwaway.applied.at(-1) !== '0045_r43_appointment_notice_kinds') throw new Error('the throwaway database is not at 0045 (it has "planStep")');
    for (const u of [A, B]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
  }, 240000);
  afterAll(async () => {
    // the whole database goes: no row-by-row cleanup needed
    await db?.$client?.end?.().catch(() => {});
    process.env.DATABASE_URL = SUITE_URL;
    await throwaway?.drop();
  }, 60000);
  const without = (name, fn) => it(name, fn);

  let itemId;
  without('the list answers, says that plan data is not stored here, and a step has the former fields with null plan data', async () => {
    const empty = await call({ as: A });
    expect(empty.statusCode, JSON.stringify(empty.body)).toBe(200); expect(empty.body).toMatchObject({ planSteps: false, items: [] });
    const added = await post(A, { action: 'add', title: 'Étape sur une base non migrée' });
    expect(added.statusCode, JSON.stringify(added.body)).toBe(201); expect(added.body.planSaved).toBeUndefined();
    itemId = added.body.item.id;
    expect((await list(A))[0]).toMatchObject({ id: itemId, title: 'Étape sur une base non migrée', status: 'NOT_STARTED', origin: 'MANUAL', records: [], available: true, plan: null, closure: null, step: null, dependsOn: null, waiting: false });
  });
  without('every former action works: the ten states, a sourced deadline, a note, the history, a record as a step', async () => {
    for (const status of ['IN_PROGRESS', 'DOCUMENTS_REQUIRED', 'READY', 'SUBMITTED', 'WAITING_ORGANIZATION', 'ADDITIONAL_INFORMATION', 'DECISION_POSITIVE', 'DECISION_NEGATIVE', 'CLOSED', 'NOT_STARTED']) {
      const r = await post(A, { action: 'status', id: itemId, status });
      expect([r.statusCode, r.body.item?.status], status).toEqual([200, status]);
    }
    expect((await post(A, { action: 'deadline', id: itemId, dueDate: '2031-05-01', dueSourceUrl: OFFICIAL })).statusCode).toBe(200);
    expect((await post(A, { action: 'note', id: itemId, note: 'note de test' })).statusCode).toBe(200);
    expect((await call({ as: A, query: { history: itemId } })).body.events.map((e) => e.kind)).toEqual(['CREATED', ...Array(10).fill('STATUS'), 'DEADLINE', 'NOTE']);
    const aid = `m1n-aide-${TS}`; aides.push(aid);
    await db.insert(S.Aide).values({ id: aid, slug: `${aid}-slug`, titre: 'Fiche aide de test', statut: 'publie', launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'rev@example.test', territory_verified: true, data_origin: 'official', date_verification: new Date(Date.now() - 3 * 86400000), source_url: 'https://www.service-public.fr/x' });
    const rec = await post(A, { action: 'add', records: [{ type: 'aide', id: aid }] });
    expect(rec.statusCode, JSON.stringify(rec.body)).toBe(201); expect(rec.body.added).toBe(true);
    expect((await post(A, { action: 'add', records: [{ type: 'aide', id: aid }] })).body.added).toBe(false);
    expect((await list(A)).find((i) => i.id === rec.body.item.id)).toMatchObject({ records: [{ type: 'aide', available: true, title: 'Fiche aide de test' }] });
  });
  without('plan data sent with « add »: the step is created, the plan data is not stored and the answer says so; invalid plan data is still refused', async () => {
    const r = await post(A, { action: 'add', title: 'Étape avec un plan', planStep: { need: 'energie', actor: { kind: 'citizen' }, dependsOnItemId: itemId } });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201); expect(r.body.planSaved).toBe(false);
    expect((await list(A)).find((i) => i.id === r.body.item.id)).toMatchObject({ step: null, dependsOn: null, waiting: false });
    const bad = await post(A, { action: 'add', title: 'Étape refusée', planStep: { need: 'pas-un-besoin' } });
    expect([bad.statusCode, bad.body.error]).toEqual([400, 'INVALID_PLAN_STEP']);
  });
  without('« plan » and the two closing reasons answer 409 PLAN_STEP_UNAVAILABLE and change nothing; an unknown step is still the uniform 404', async () => {
    const before = (await list(A)).find((i) => i.id === itemId);
    const plan = await post(A, { action: 'plan', id: itemId, planStep: { need: 'energie' } });
    expect([plan.statusCode, plan.body.error]).toEqual([409, 'PLAN_STEP_UNAVAILABLE']);
    for (const status of ['ABANDONED', 'OUTCOME_UNKNOWN']) {
      const r = await post(A, { action: 'status', id: itemId, status });
      expect([r.statusCode, r.body.error], status).toEqual([409, 'PLAN_STEP_UNAVAILABLE']);
    }
    expect((await list(A)).find((i) => i.id === itemId)).toEqual(before);
    expect((await post(A, { action: 'plan', id: nodeCrypto.randomUUID(), planStep: { need: 'energie' } })).statusCode).toBe(404);
    expect((await post(A, { action: 'status', id: nodeCrypto.randomUUID(), status: 'ABANDONED' })).statusCode).toBe(404);
  });
  without('a plan is imported and its « who does what next » is read back from the dossier, as before M1', async () => {
    const id = `m1n-share-${TS}`; shares.push(id);
    const results = { assessment: buildAssessment({ answers: { birthDate: '1992-03-10', householdSize: 1, territory: '67000', income: { unemployment: 700 }, housing: { status: 'tenant', rent: 480 } }, unsupportedRights: UNSUPPORTED_RIGHTS }) };
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${id}, NOW() + interval '7 days', '{}'::jsonb, ${JSON.stringify(results)}::jsonb, 0, ${'h-' + id}, ${'t-' + id}, 'GUEST_SHARE', ${B.id})`);
    const imp = await post(B, { action: 'import', shareId: id });
    expect(imp.statusCode, JSON.stringify(imp.body)).toBe(200); expect(imp.body.added).toBeGreaterThan(0);
    const steps = imp.body.items.filter((i) => i.origin === 'PLAN');
    expect(steps.every((i) => i.plan && i.plan.detail && i.step === null)).toBe(true);
    expect((await call({ method: 'DELETE', as: B, body: { id: steps[0].id } })).statusCode).toBe(200);
  });
  without('the delegate’s view and the person’s data export still return the steps', async () => {
    const n = (await db.execute(sql`SELECT count(*)::int n FROM "ParcoursItem" WHERE "userId" = ${A.id}`)).rows[0].n;
    expect(n).toBeGreaterThan(0);
    const { createPrivacyRightsService } = await import('../../api/_services/privacy.js');
    const out = await createPrivacyRightsService({ db, cryptoLib: nodeCrypto }).getExportData(A.id);
    expect(out.parcours.length).toBe(n); expect(out.parcours.every((i) => !('planStep' in i))).toBe(true);
    const delegation = await import('../../api/_services/delegation.js');
    const dId = `m1n-del-${TS}`;
    await db.insert(S.CitizenDelegation).values({ id: dId, principalUserId: A.id, delegateUserId: B.id, inviteEmail: B.email, role: 'AIDANT', scopes: ['PARCOURS_READ'], status: 'ACTIVE', proofStatus: 'NOT_REQUIRED', expiresAt: new Date(Date.now() + 86400000), acceptedAt: new Date() });
    const view = await delegation.delegateView(B.id, dId, 'parcours', db);
    expect(view.status, JSON.stringify(view)).toBe(200); expect(view.items.length).toBe(n);
  });
});
