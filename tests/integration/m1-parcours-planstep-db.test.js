/**
 * M1 (C07 / C08) — the durable plan data of a Mon Parcours step ("ParcoursItem"."planStep", migration 0046) on REAL PostgreSQL, through the real handler
 * and signed session cookies:
 *  1. backward compatibility: a step without planStep (NULL — every row that existed before 0046) lists and changes exactly as before, and stays NULL;
 *  2. strict server validation (allowed keys, taxonomy need, who acts, official links only, size cap): a refusal stores nothing;
 *  3. a dependency on another step: shown as waiting, never a lock; loops refused; another person's step refused exactly like an unknown id;
 *  4. honest ways to end a step (abandoned / outcome unknown) inside the ten self-declared states and the append-only history;
 *  5. the copy an imported plan step keeps once its dossier is gone; the data export carries the plan data; the delegate's view does not.
 * Needs the column (skipped on a database without 0046: tests/integration/m1-parcours-without-0046-db.test.js covers that level). Synthetic data only.
 */
import nodeCrypto from 'node:crypto';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const A = { id: `m1-a-${TS}`, email: `m1-a-${TS}@example.test` };
const B = { id: `m1-b-${TS}`, email: `m1-b-${TS}@example.test` };
const C = { id: `m1-c-${TS}`, email: `m1-c-${TS}@example.test` };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const OFFICIAL = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F20055';

describe.skipIf(!hasDatabase)('M1 Mon Parcours plan step (real DB)', () => {
  let db, userAuth, parcours, S, level = false, buildAssessment, UNSUPPORTED_RIGHTS;
  const cookie = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const call = async ({ method = 'GET', body, query = {}, as } = {}) => { const r = mk(); await parcours({ method, url: '/api/citizen/parcours', query, body, headers: { host: 'localhost', ...(as ? { cookie: cookie(as) } : {}) } }, r); return r; };
  const post = (as, body) => call({ method: 'POST', as, body });
  const add = async (as, title, planStep) => { const r = await post(as, { action: 'add', title, ...(planStep === undefined ? {} : { planStep }) }); expect(r.statusCode, JSON.stringify(r.body)).toBe(201); return r.body.item; };
  const list = async (as) => (await call({ as })).body.items;
  const one = async (as, id) => (await list(as)).find((i) => i.id === id);
  const stored = async (id) => (await db.execute(sql`SELECT "planStep" AS p, status FROM "ParcoursItem" WHERE id = ${id}`)).rows[0];
  const count = async (u) => (await db.execute(sql`SELECT count(*)::int n FROM "ParcoursItem" WHERE "userId" = ${u.id}`)).rows[0].n;
  const shares = [];

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    S = await import('../../src/db/schema.js');
    userAuth = await import('../../api/_utils/user-auth.js');
    ({ buildAssessment } = await import('../../api/lib/assessmentContract.js'));
    ({ UNSUPPORTED_RIGHTS } = await import('../../api/lib/diagnosticAssessment.js'));
    parcours = (await import('../../api/_handlers/citizen/parcours.js')).default;
    level = (await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ParcoursItem' AND column_name = 'planStep'`)).rows.length > 0;
    for (const u of [A, B, C]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    for (const id of shares) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${id}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${A.id}, ${B.id}, ${C.id})`);
  });
  const withColumn = (name, fn) => it(name, async (ctx) => { if (!level) { console.info('[m1] database without migration 0046: covered by m1-parcours-without-0046-db.test.js'); return ctx.skip(); } return fn(); });

  describe('backward compatibility: a step without plan data', () => {
    withColumn('a row as it existed before 0046 (planStep NULL) lists with the former fields and null plan data, and every former action still works on it', async () => {
      const id = `m1-legacy-${TS}`;
      // exactly the columns of 0016: the INSERT never names "planStep"
      await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "updatedAt") VALUES (${id}, ${A.id}, 'MANUAL', 'custom', 'Étape ancienne', NOW())`);
      expect((await stored(id)).p).toBeNull();
      const all = await call({ as: A });
      expect(all.statusCode).toBe(200); expect(all.body.planSteps).toBe(true);
      expect(all.body.items.find((i) => i.id === id)).toMatchObject({ id, origin: 'MANUAL', stepKind: 'custom', title: 'Étape ancienne', status: 'NOT_STARTED', itemCodes: [], records: [], available: true, plan: null,
        closure: null, step: null, dependsOn: null, waiting: false, dueDate: null, note: null });
      for (const status of ['IN_PROGRESS', 'DOCUMENTS_REQUIRED', 'READY', 'SUBMITTED', 'WAITING_ORGANIZATION', 'ADDITIONAL_INFORMATION', 'DECISION_POSITIVE', 'DECISION_NEGATIVE', 'CLOSED', 'NOT_STARTED']) {
        const r = await post(A, { action: 'status', id, status });
        expect(r.statusCode, status).toBe(200); expect(r.body.item).toMatchObject({ status, closure: null });
      }
      expect((await post(A, { action: 'deadline', id, dueDate: '2031-05-01', dueSourceUrl: OFFICIAL })).statusCode).toBe(200);
      expect((await post(A, { action: 'note', id, note: 'note privée de test' })).statusCode).toBe(200);
      const history = (await call({ as: A, query: { history: id } })).body.events;
      expect(history.map((e) => e.kind)).toEqual([...Array(10).fill('STATUS'), 'DEADLINE', 'NOTE']);
      // none of the former actions wrote plan data: the column is still NULL
      expect((await stored(id)).p).toBeNull();
      expect(await one(A, id)).toMatchObject({ step: null, closure: null, note: 'note privée de test' });
    });
    withColumn('a step added the former way (a title only) is stored with planStep NULL', async () => {
      const item = await add(A, 'Étape sans plan');
      expect(item.closure).toBeNull(); expect((await stored(item.id)).p).toBeNull();
    });
  });

  describe('plan data: stored, shown, strictly validated', () => {
    let itemId;
    withColumn('need, who acts, official links and the next action are stored with the step and given back, the need with its taxonomy label', async () => {
      const item = await add(A, 'Factures d’électricité', { need: 'energie', actor: { kind: 'organisation', name: '  Caisse d’allocations familiales ' }, links: [{ url: OFFICIAL, label: 'Fiche officielle' }], nextActionKey: 'contact_organisation' });
      itemId = item.id;
      expect((await stored(item.id)).p).toEqual({ v: 1, need: 'energie', actor: { kind: 'organisation', name: 'Caisse d’allocations familiales' }, links: [{ url: OFFICIAL, label: 'Fiche officielle' }], nextActionKey: 'contact_organisation' });
      const shown = await one(A, item.id);
      expect(shown.step).toEqual({ need: { id: 'energie', label: expect.any(String) }, actor: { kind: 'organisation', name: 'Caisse d’allocations familiales' }, links: [{ url: OFFICIAL, label: 'Fiche officielle' }], nextActionKey: 'contact_organisation', detail: null });
      expect(shown.step.need.label.length).toBeGreaterThan(3);
      expect(shown).toMatchObject({ status: 'NOT_STARTED', closure: null, dependsOn: null, waiting: false, plan: null });
    });
    withColumn('« plan » changes only the keys sent: a key set to null is cleared, a key left out is untouched', async () => {
      const r = await post(A, { action: 'plan', id: itemId, planStep: { actor: { kind: 'citizen' }, links: null } });
      expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
      expect((await stored(itemId)).p).toEqual({ v: 1, need: 'energie', actor: { kind: 'citizen' }, nextActionKey: 'contact_organisation' });
      expect((await post(A, { action: 'plan', id: itemId, planStep: { need: null, actor: null, nextActionKey: null } })).statusCode).toBe(200);
      expect((await stored(itemId)).p).toBeNull();   // nothing left: NULL again, not an empty object
      expect((await post(A, { action: 'plan', id: itemId, planStep: { need: 'energie', actor: { kind: 'professional' }, nextActionKey: 'ask_professional' } })).statusCode).toBe(200);
      // it is not a status change and writes no history line
      expect((await call({ as: A, query: { history: itemId } })).body.events.map((e) => e.kind)).toEqual(['CREATED']);
    });
    withColumn('anything outside the contract is refused with one code and stores nothing — on « add » and on « plan »', async () => {
      const before = await count(A); const was = (await stored(itemId)).p;
      const invalid = [
        'energie', [], 7, true,
        { unknown: 1 }, { closure: 'ABANDONED' }, { v: 1 }, { detail: 'texte' }, { need: 'energie', extra: true },
        { need: 'pas-un-besoin' }, { need: 7 }, { need: ['energie'] }, { need: "energie' OR 1=1" },
        { actor: 'citizen' }, { actor: { kind: 'admin' } }, { actor: { kind: 'organisation' } }, { actor: { kind: 'organisation', name: 'x' } }, { actor: { kind: 'organisation', name: 'x'.repeat(121) } },
        { actor: { kind: 'citizen', name: 'Camille Exemple' } }, { actor: { kind: 'professional', name: 'Dominique Exemple' } }, { actor: { kind: 'organisation', name: 'Caf', phone: '0600000000' } },
        { links: 'https://www.service-public.gouv.fr/' }, { links: [OFFICIAL] }, { links: [{ url: OFFICIAL }] }, { links: [{ url: OFFICIAL, label: '' }] },
        { links: [{ url: 'http://www.service-public.gouv.fr/x', label: 'http' }] }, { links: [{ url: 'https://example.org/aide', label: 'non officiel' }] },
        { links: [{ url: 'https://evil.example/?u=service-public.gouv.fr', label: 'piège' }] }, { links: [{ url: 'https://user:pw@www.service-public.gouv.fr/x', label: 'identifiants' }] },
        { links: [{ url: 'javascript:alert(1)', label: 'js' }] }, { links: [{ to: '/aides/rsa', label: 'interne' }] }, { links: [{ url: OFFICIAL, label: 'a', rel: 'x' }] },
        { links: Array.from({ length: 6 }, (_, n) => ({ url: `${OFFICIAL}?n=${n}`, label: `Lien ${n}` })) },
        { dependsOnItemId: 7 }, { dependsOnItemId: '' }, { dependsOnItemId: '../x' }, { dependsOnItemId: 'x'.repeat(65) },
        { nextActionKey: 'texte libre' }, { nextActionKey: 'after_refusal' }, { nextActionKey: 7 },
        { actor: { kind: 'organisation', name: 'o'.repeat(100) }, links: Array.from({ length: 5 }, (_, n) => ({ url: `${OFFICIAL}?${'p'.repeat(400)}${n}`, label: 'l'.repeat(200) })), need: 'energie', nextActionKey: 'read_record', dependsOnItemId: 'x'.repeat(9000) },
      ];
      for (const planStep of invalid) {
        const a = await post(A, { action: 'add', title: 'Étape refusée', planStep });
        expect([a.statusCode, a.body.error], `add ${JSON.stringify(planStep).slice(0, 80)}`).toEqual([400, 'INVALID_PLAN_STEP']);
        const p = await post(A, { action: 'plan', id: itemId, planStep });
        expect([p.statusCode, p.body.error], `plan ${JSON.stringify(planStep).slice(0, 80)}`).toEqual([400, 'INVALID_PLAN_STEP']);
      }
      expect((await post(A, { action: 'plan', id: itemId })).body.error).toBe('INVALID_PLAN_STEP');   // « plan » without planStep
      expect(await count(A)).toBe(before); expect((await stored(itemId)).p).toEqual(was);
    });
    withColumn('a link whose host is no longer on the official allow-list is not shown (read as strictly as written)', async () => {
      const id = `m1-stale-${TS}`;
      await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "updatedAt", "planStep") VALUES (${id}, ${A.id}, 'MANUAL', 'custom', 'Étape au lien retiré', NOW(),
        ${JSON.stringify({ v: 1, need: 'energie', links: [{ url: 'https://example.org/x', label: 'Ancien lien' }, { url: OFFICIAL, label: 'Lien officiel' }], nextActionKey: 'inconnu', surprise: '<script>' })}::jsonb)`);
      expect((await one(A, id)).step).toEqual({ need: { id: 'energie', label: expect.any(String) }, actor: null, links: [{ url: OFFICIAL, label: 'Lien officiel' }], nextActionKey: null, detail: null });
      await db.execute(sql`UPDATE "ParcoursItem" SET "planStep" = '{"v": 2, "need": "energie"}'::jsonb WHERE id = ${id}`);
      expect(await one(A, id)).toMatchObject({ step: null, closure: null, waiting: false });   // another version: ignored, the step itself still lists
    });
  });

  describe('a step that depends on another one', () => {
    let first, second, third, other;
    withColumn('is shown as waiting until the other step is finished — and is never locked: its own status changes freely meanwhile', async () => {
      first = await add(A, 'Demander une attestation'); second = await add(A, 'Envoyer le dossier', { dependsOnItemId: first.id });
      expect(await one(A, second.id)).toMatchObject({ waiting: true, dependsOn: { id: first.id, title: 'Demander une attestation', status: 'NOT_STARTED', closure: null, done: false } });
      expect(await one(A, first.id)).toMatchObject({ waiting: false, dependsOn: null });
      for (const status of ['IN_PROGRESS', 'SUBMITTED', 'NOT_STARTED']) {
        const r = await post(A, { action: 'status', id: second.id, status });
        expect([r.statusCode, r.body.item.status], status).toEqual([200, status]);
      }
      expect((await one(A, second.id)).waiting).toBe(true);
      await post(A, { action: 'status', id: first.id, status: 'DECISION_POSITIVE' });
      expect(await one(A, second.id)).toMatchObject({ waiting: false, dependsOn: { id: first.id, status: 'DECISION_POSITIVE', done: true } });
      await post(A, { action: 'status', id: first.id, status: 'IN_PROGRESS' });
      expect((await one(A, second.id)).waiting).toBe(true);
      // a finished step is not « waiting », whatever it depended on
      await post(A, { action: 'status', id: second.id, status: 'CLOSED' });
      expect((await one(A, second.id)).waiting).toBe(false);
      await post(A, { action: 'status', id: second.id, status: 'NOT_STARTED' });
    });
    withColumn('a loop is refused — itself, two steps, three steps — and nothing is stored', async () => {
      third = await add(A, 'Attendre la réponse', { dependsOnItemId: second.id });   // third → second → first
      const self = await post(A, { action: 'plan', id: first.id, planStep: { dependsOnItemId: first.id } });
      expect([self.statusCode, self.body.error]).toEqual([409, 'DEPENDENCY_CYCLE']);
      const two = await post(A, { action: 'plan', id: first.id, planStep: { dependsOnItemId: second.id } });
      expect([two.statusCode, two.body.error]).toEqual([409, 'DEPENDENCY_CYCLE']);
      const three = await post(A, { action: 'plan', id: first.id, planStep: { dependsOnItemId: third.id } });
      expect([three.statusCode, three.body.error]).toEqual([409, 'DEPENDENCY_CYCLE']);
      expect((await stored(first.id)).p).toBeNull();
      // a change that closes no loop is accepted: third may depend on first directly
      expect((await post(A, { action: 'plan', id: third.id, planStep: { dependsOnItemId: first.id } })).statusCode).toBe(200);
      expect((await stored(third.id)).p).toEqual({ v: 1, dependsOnItemId: first.id });
    });
    withColumn('another person’s step is refused exactly like an id that does not exist: same status, same body, nothing stored, nothing revealed', async () => {
      other = await add(B, 'Étape d’une autre personne');
      const unknownId = nodeCrypto.randomUUID();
      const viaPlan = async (dependsOnItemId) => { const r = await post(A, { action: 'plan', id: second.id, planStep: { dependsOnItemId } }); return [r.statusCode, r.body]; };
      const viaAdd = async (dependsOnItemId) => { const r = await post(A, { action: 'add', title: 'Étape dépendante', planStep: { dependsOnItemId } }); return [r.statusCode, r.body]; };
      const before = await count(A);
      expect(await viaPlan(other.id)).toEqual(await viaPlan(unknownId));
      expect(await viaAdd(other.id)).toEqual(await viaAdd(unknownId));
      const [status, body] = await viaPlan(other.id);
      expect(status).toBe(400); expect(body.error).toBe('INVALID_DEPENDENCY');
      expect(JSON.stringify(body)).not.toContain('autre personne'); expect(JSON.stringify(body)).not.toContain(other.id);
      expect(await count(A)).toBe(before); expect((await stored(second.id)).p).toEqual({ v: 1, dependsOnItemId: first.id });
      // and B's step cannot be changed or read by A (the uniform 404 of every other action)
      const foreign = await post(A, { action: 'plan', id: other.id, planStep: { need: 'energie' } });
      const missing = await post(A, { action: 'plan', id: unknownId, planStep: { need: 'energie' } });
      expect([foreign.statusCode, foreign.body]).toEqual([missing.statusCode, missing.body]); expect(foreign.statusCode).toBe(404);
      expect((await stored(other.id)).p).toBeNull();
      // a dependency forged in the database towards another account's step is never resolved
      await db.execute(sql`UPDATE "ParcoursItem" SET "planStep" = ${JSON.stringify({ v: 1, dependsOnItemId: other.id })}::jsonb WHERE id = ${third.id}`);
      expect(await one(A, third.id)).toMatchObject({ dependsOn: null, waiting: false });
    });
    withColumn('removing the step another one depended on leaves that one free (no error, no waiting)', async () => {
      expect((await call({ method: 'DELETE', as: A, body: { id: first.id } })).statusCode).toBe(200);
      expect(await one(A, second.id)).toMatchObject({ dependsOn: null, waiting: false, status: 'NOT_STARTED' });
    });
  });

  describe('honest ways a step ends', () => {
    withColumn('« abandoned » and « outcome unknown » close the step with their reason; the ten states, the status CHECK and the append-only history are unchanged', async () => {
      const item = await add(C, 'Demande que je ne poursuis pas', { need: 'energie' });
      const ab = await post(C, { action: 'status', id: item.id, status: 'ABANDONED' });
      expect(ab.statusCode, JSON.stringify(ab.body)).toBe(200); expect(ab.body.item).toMatchObject({ status: 'CLOSED', closure: 'ABANDONED' });
      expect(await stored(item.id)).toEqual({ status: 'CLOSED', p: { v: 1, need: 'energie', closure: 'ABANDONED' } });
      expect((await post(C, { action: 'status', id: item.id, status: 'ABANDONED' })).body.item.closure).toBe('ABANDONED');   // the same again: no new history line
      const un = await post(C, { action: 'status', id: item.id, status: 'OUTCOME_UNKNOWN' });
      expect(un.body.item).toMatchObject({ status: 'CLOSED', closure: 'OUTCOME_UNKNOWN' });
      // one of the ten states afterwards removes the reason and keeps the rest of the plan data
      const back = await post(C, { action: 'status', id: item.id, status: 'IN_PROGRESS' });
      expect(back.body.item).toMatchObject({ status: 'IN_PROGRESS', closure: null });
      expect(await stored(item.id)).toEqual({ status: 'IN_PROGRESS', p: { v: 1, need: 'energie' } });
      await post(C, { action: 'status', id: item.id, status: 'OUTCOME_UNKNOWN' });
      await post(C, { action: 'status', id: item.id, status: 'CLOSED' });   // plain « Terminé »: the reason goes
      expect(await one(C, item.id)).toMatchObject({ status: 'CLOSED', closure: null });
      const events = (await call({ as: C, query: { history: item.id } })).body.events.map((e) => [e.kind, e.fromStatus, e.toStatus]);
      expect(events).toEqual([['CREATED', null, 'NOT_STARTED'], ['STATUS', 'NOT_STARTED', 'CLOSED'], ['STATUS', 'CLOSED', 'CLOSED'], ['STATUS', 'CLOSED', 'IN_PROGRESS'], ['STATUS', 'IN_PROGRESS', 'CLOSED'], ['STATUS', 'CLOSED', 'CLOSED']]);
      // the database never sees the two reasons as a status, and the history still refuses a rewrite
      await expect(db.execute(sql`UPDATE "ParcoursItem" SET status = 'ABANDONED' WHERE id = ${item.id}`)).rejects.toThrow();
      await expect(db.execute(sql`UPDATE "ParcoursEvent" SET kind = 'NOTE' WHERE "itemId" = ${item.id}`)).rejects.toThrow();
      for (const status of ['abandoned', 'DONE', '', null, 7, ['ABANDONED']]) expect((await post(C, { action: 'status', id: item.id, status })).body.error, String(status)).toBe('INVALID_STATUS');
      // a reason left in the data is ignored once the step is no longer CLOSED
      await db.execute(sql`UPDATE "ParcoursItem" SET status = 'SUBMITTED', "planStep" = '{"v": 1, "closure": "ABANDONED"}'::jsonb WHERE id = ${item.id}`);
      expect(await one(C, item.id)).toMatchObject({ status: 'SUBMITTED', closure: null });
    });
    withColumn('a step given up no longer holds back the step that depended on it', async () => {
      const a = await add(C, 'Première étape'); const b = await add(C, 'Seconde étape', { dependsOnItemId: a.id });
      await post(C, { action: 'status', id: a.id, status: 'ABANDONED' });
      expect(await one(C, b.id)).toMatchObject({ waiting: false, dependsOn: { id: a.id, status: 'CLOSED', closure: 'ABANDONED', done: true } });
    });
  });

  describe('durability, export, delegation', () => {
    withColumn('an imported plan step keeps who acts, the explanation, its links and the next action once its dossier is deleted', async () => {
      const id = `m1-share-${TS}`; shares.push(id);
      const results = { assessment: buildAssessment({ answers: { birthDate: '1992-03-10', householdSize: 1, territory: '67000', income: { unemployment: 700 }, housing: { status: 'tenant', rent: 480 } }, unsupportedRights: UNSUPPORTED_RIGHTS }) };
      await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${id}, NOW() + interval '7 days', '{}'::jsonb, ${JSON.stringify(results)}::jsonb, 0, ${'h-' + id}, ${'t-' + id}, 'GUEST_SHARE', ${B.id})`);
      const imp = await post(B, { action: 'import', shareId: id });
      expect(imp.statusCode, JSON.stringify(imp.body)).toBe(200);
      const steps = imp.body.items.filter((i) => i.origin === 'PLAN');
      const verify = steps.filter((i) => i.stepKind === 'verify'); expect(verify.length).toBeGreaterThan(0);
      for (const v of verify) expect(v.step).toMatchObject({ actor: { kind: 'organisation', name: v.plan.who }, nextActionKey: 'contact_organisation', detail: v.plan.detail });
      expect(steps.find((i) => i.stepKind === 'prepare').step).toMatchObject({ actor: { kind: 'citizen', name: null }, nextActionKey: 'gather_documents' });
      expect(steps.flatMap((i) => i.step.links).every((l) => /^\/[a-z]/.test(l.to) && !l.url)).toBe(true);
      await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${id}`);
      const later = (await list(B)).filter((i) => i.origin === 'PLAN');
      expect(later.length).toBe(steps.length); expect(later.every((i) => i.sourceShareId === null)).toBe(true);
      // by id: steps created in the same millisecond have no fixed order in the list
      const byId = (l) => Object.fromEntries(l.map((i) => [i.id, [i.plan, i.step]]));
      expect(byId(later)).toEqual(byId(steps));
      // importing the same plan again never rewrote a step (planKey): nothing to import any more, the copies are untouched
      expect((await post(B, { action: 'import', shareId: id })).statusCode).toBe(404);
    });
    withColumn('the person’s data export contains the plan data; the delegate’s read-only view does not', async () => {
      const { createPrivacyRightsService } = await import('../../api/_services/privacy.js');
      const out = await createPrivacyRightsService({ db, cryptoLib: nodeCrypto }).getExportData(A.id);
      expect(out.exportInfo.complete).toBe(true);
      const exported = out.parcours ?? Object.values(out).find((v) => Array.isArray(v) && v.some((x) => x && x.title === 'Factures d’électricité'));
      expect(exported.length).toBe(await count(A));
      expect(exported.find((i) => i.title === 'Factures d’électricité').planStep).toEqual({ v: 1, need: 'energie', actor: { kind: 'professional' }, nextActionKey: 'ask_professional' });
      const delegation = await import('../../api/_services/delegation.js');
      const dId = `m1-del-${TS}`;
      await db.insert(S.CitizenDelegation).values({ id: dId, principalUserId: A.id, delegateUserId: B.id, inviteEmail: B.email, role: 'AIDANT', scopes: ['PARCOURS_READ'], status: 'ACTIVE', proofStatus: 'NOT_REQUIRED', expiresAt: new Date(Date.now() + 86400000), acceptedAt: new Date() });
      const view = await delegation.delegateView(B.id, dId, 'parcours', db);
      expect(view.status, JSON.stringify(view)).toBe(200); expect(view.items.length).toBe(await count(A));
      for (const i of view.items) expect(Object.keys(i).sort()).toEqual(['dueDate', 'dueSourceUrl', 'id', 'status', 'title']);
    });
  });
});
