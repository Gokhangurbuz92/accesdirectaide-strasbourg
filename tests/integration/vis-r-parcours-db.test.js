/**
 * VIS-R — Mon Parcours gaps on REAL PostgreSQL (migrated schema, no new migration), through the real handler and signed session cookies:
 *  1. « Ajouter à mon parcours »: a PUBLIC aide / démarche / dispositif / guide becomes a tracked step (strict input, no existence oracle, idempotent, cap of 100);
 *  2. a record that is withdrawn or no longer visible is flagged in the list (`available: false`, the same decision as favourites) without its content;
 *  3. a plan step gives back who / detail / links while the account owns its dossier;
 *  4. the status stays the person's own (a negative answer changes nothing else).
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const A = { id: `visr-a-${TS}`, email: `visr-a-${TS}@example.test` };
const B = { id: `visr-b-${TS}`, email: `visr-b-${TS}@example.test` };
const C = { id: `visr-c-${TS}`, email: `visr-c-${TS}@example.test` };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('VIS-R Mon Parcours (real DB)', () => {
  let db, userAuth, parcours, S, buildAssessment, UNSUPPORTED_RIGHTS;
  const cookie = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const call = async ({ method = 'GET', body, query = {}, as } = {}) => { const r = mk(); await parcours({ method, url: '/api/citizen/parcours', query, body, headers: { host: 'localhost', ...(as ? { cookie: cookie(as) } : {}) } }, r); return r; };
  const add = (as, body) => call({ method: 'POST', as, body: { action: 'add', ...body } });
  const list = async (as) => (await call({ as })).body.items;
  const count = async (u) => (await db.execute(sql`SELECT count(*)::int n FROM "ParcoursItem" WHERE "userId" = ${u.id}`)).rows[0].n;
  const ids = { aide: [], demarche: [], dispositif: [], guide: [], shares: [] };
  const PUBLIC = { statut: 'publie', launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'rev@example.test', territory_verified: true, data_origin: 'official', date_verification: new Date(Date.now() - 3 * 86400000), source_url: 'https://www.service-public.fr/x' };
  const record = async (type, name, extra = {}) => {
    const id = `visr-${type}-${name}-${TS}`; ids[type].push(id);
    const T = { aide: S.Aide, demarche: S.Demarche, dispositif: S.Dispositif, guide: S.Guide }[type];
    const base = type === 'guide' ? { statut: 'publie', publics: [], contexte: [], mots_cles: [], sources_urls: [] } : type === 'dispositif' ? { ...PUBLIC, public: [] } : PUBLIC;
    await db.insert(T).values({ id, slug: `${id}-slug`, titre: `Fiche ${type} ${name}`, ...base, ...extra });
    return id;
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    S = await import('../../src/db/schema.js');
    userAuth = await import('../../api/_utils/user-auth.js');
    ({ buildAssessment } = await import('../../api/lib/assessmentContract.js'));
    ({ UNSUPPORTED_RIGHTS } = await import('../../api/lib/diagnosticAssessment.js'));
    parcours = (await import('../../api/_handlers/citizen/parcours.js')).default;
    for (const u of [A, B, C]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    const del = async (table, list) => { if (list.length) await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE id IN (${sql.join(list.map((i) => sql`${i}`), sql`, `)})`); };
    await del('SharedDiagnostic', ids.shares); await del('Aide', ids.aide); await del('Demarche', ids.demarche); await del('Dispositif', ids.dispositif); await del('Guide', ids.guide);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${A.id}, ${B.id}, ${C.id})`);
  });

  describe('« Ajouter à mon parcours »', () => {
    it('refuses an anonymous caller', async () => {
      expect((await call({ method: 'POST', body: { action: 'add', records: [{ type: 'aide', id: 'x' }] } })).statusCode).toBe(401);
    });
    it('a public aide becomes ONE tracked step: by id, then by slug, then again — idempotent, one creation event', async () => {
      const aid = await record('aide', 'apl', { ou_demander: 'Auprès de la Caf' });
      const first = await add(A, { records: [{ type: 'aide', id: aid }] });
      expect(first.statusCode, JSON.stringify(first.body)).toBe(201);
      expect(first.body).toMatchObject({ added: true, item: { origin: 'MANUAL', stepKind: 'custom', status: 'NOT_STARTED', title: 'Fiche aide apl', itemCodes: [`aide:${aid}`] } });
      for (const id of [`${aid}-slug`, aid]) {
        const again = await add(A, { records: [{ type: 'aide', id }] });
        expect(again.statusCode).toBe(200); expect(again.body).toMatchObject({ added: false, item: { id: first.body.item.id } });
      }
      const both = await Promise.all([add(A, { records: [{ type: 'aide', id: aid }] }), add(A, { records: [{ type: 'aide', id: aid }], title: 'Un autre titre' })]);   // the title does not make a second step
      expect(both.map((r) => r.body.added)).toEqual([false, false]);
      expect(await count(A)).toBe(1);
      expect((await call({ as: A, query: { history: first.body.item.id } })).body.events.map((e) => e.kind)).toEqual(['CREATED']);
      expect(await list(B)).toEqual([]);   // B sees nothing of A, and can add the same record for themselves
      expect((await add(B, { records: [{ type: 'aide', id: aid }] })).statusCode).toBe(201);
    });
    it('two simultaneous first clicks create one step', async () => {
      const aid = await record('aide', 'race');
      const out = await Promise.all([1, 2, 3].map(() => add(C, { records: [{ type: 'aide', id: aid }] })));
      expect(out.every((r) => [200, 201].includes(r.statusCode)), JSON.stringify(out.map((r) => r.body))).toBe(true);
      expect(new Set(out.map((r) => r.body.item.id)).size).toBe(1); expect(await count(C)).toBe(1);
    });
    it('a hidden, unknown or unpublished record is the same 404 and creates nothing; a malformed input is a 400', async () => {
      const hidden = await record('aide', 'hidden', { verification_status: 'UNVERIFIED', verified_by: null });
      const held = await record('demarche', 'held', { publication_hold: 'PRIVACY_REVIEW' });
      const draft = await record('guide', 'draft', { statut: 'brouillon' });
      const before = await count(A);
      for (const r of [{ type: 'aide', id: hidden }, { type: 'demarche', id: held }, { type: 'guide', id: draft }, { type: 'dispositif', id: 'does-not-exist' }]) {
        const out = await add(A, { records: [r] });
        expect([out.statusCode, out.body.error], JSON.stringify(r)).toEqual([404, 'NOT_FOUND']);
      }
      const ok = await record('demarche', 'ok');
      expect((await add(A, { records: [{ type: 'demarche', id: ok }, { type: 'aide', id: hidden }] })).statusCode, 'one hidden record refuses the whole step').toBe(404);
      for (const records of [[], 'x', [{ type: 'actualite', id: ok }], [{ type: 'aide', id: "x' OR '1'='1" }], Array.from({ length: 6 }, () => ({ type: 'demarche', id: ok }))])
        expect((await add(A, { records })).body.error, JSON.stringify(records)).toBe('INVALID_RECORDS');
      expect((await add(A, { records: [{ type: 'demarche', id: ok }], title: 'x' })).body.error).toBe('INVALID_TITLE');
      expect(await count(A)).toBe(before);
    });
    it('a démarche, a dispositif and an orientation need (its guides, its own title) are tracked; the list gives each record, its page and whether it names a contact', async () => {
      const dem = await record('demarche', 'logement', { ou_faire: 'En mairie' }); const dis = await record('dispositif', 'fonds'); const g1 = await record('guide', 'g1'); const g2 = await record('guide', 'g2');
      expect((await add(A, { records: [{ type: 'demarche', id: dem }] })).statusCode).toBe(201);
      expect((await add(A, { records: [{ type: 'dispositif', id: `${dis}-slug` }] })).statusCode).toBe(201);
      const need = await add(A, { records: [{ type: 'guide', id: `${g2}-slug` }, { type: 'guide', id: `${g1}-slug` }], title: '  Payer moins cher ses transports  ' });   // G8: an orientation title that reveals no sensitive fact (« … sans titre de séjour » is now refused by default)
      expect(need.statusCode, JSON.stringify(need.body)).toBe(201);
      expect(need.body.item).toMatchObject({ title: 'Payer moins cher ses transports', itemCodes: [`guide:${g1}`, `guide:${g2}`] });
      expect((await add(A, { records: [{ type: 'guide', id: g1 }, { type: 'guide', id: g2 }] })).body.added, 'the same set in another order').toBe(false);
      const items = await list(A);
      const of = (code) => items.find((i) => i.itemCodes.includes(code));
      expect(of(`demarche:${dem}`)).toMatchObject({ available: true, plan: null, records: [{ code: `demarche:${dem}`, type: 'demarche', available: true, title: 'Fiche demarche logement', href: `/demarches/${dem}-slug`, contact: true }] });
      expect(of(`dispositif:${dis}`).records).toEqual([{ code: `dispositif:${dis}`, type: 'dispositif', available: true, title: 'Fiche dispositif fonds', href: `/dispositifs/${dis}-slug`, contact: false }]);
      expect(of(`guide:${g1}`).records.map((r) => r.href)).toEqual([`/bonnes-pratiques/${g1}-slug`, `/bonnes-pratiques/${g2}-slug`]);
      expect(items.find((i) => i.title === 'Fiche aide apl').records[0]).toMatchObject({ contact: true, href: expect.stringMatching(/^\/aides\//) });
    });
    it('the cap of 100 steps applies; a record already tracked is still answered « already there »', async () => {
      const aid = await record('aide', 'cap'); const other = await record('aide', 'cap2');
      expect((await add(B, { records: [{ type: 'aide', id: aid }] })).statusCode).toBe(201);
      await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "updatedAt") SELECT 'visr-fill-' || g || '-' || ${String(TS)}, ${B.id}, 'MANUAL', 'custom', 'Étape ' || g, NOW() FROM generate_series(1, ${100 - (await count(B))}) g`);
      expect(await count(B)).toBe(100);
      const full = await add(B, { records: [{ type: 'aide', id: other }] });
      expect([full.statusCode, full.body.error]).toEqual([409, 'PARCOURS_FULL']);
      expect((await add(B, { records: [{ type: 'aide', id: aid }] })).body.added).toBe(false);
      expect(await count(B)).toBe(100);
    });
    it('the manual step still works as before (no records)', async () => {
      const m = await add(A, { title: 'Appeler la CAF pour mon dossier' });
      expect(m.statusCode).toBe(201); expect(m.body.item).toMatchObject({ origin: 'MANUAL', itemCodes: [] });
      expect((await list(A)).find((i) => i.id === m.body.item.id)).toMatchObject({ records: [], available: true, plan: null });
    });
  });

  describe('a record that is withdrawn or no longer visible', () => {
    it('is flagged in the list without its title or address — on hold, unpublished, or deleted; the step itself stays', async () => {
      const items = await list(A);
      const aide = items.find((i) => i.title === 'Fiche aide apl'); const aid = aide.itemCodes[0].slice('aide:'.length);
      const guides = items.find((i) => i.title === 'Payer moins cher ses transports'); const [g1, g2] = guides.itemCodes.map((c) => c.slice('guide:'.length));
      const dis = items.find((i) => i.title === 'Fiche dispositif fonds'); const did = dis.itemCodes[0].slice('dispositif:'.length);
      await db.execute(sql`UPDATE "Aide" SET publication_hold = 'PRIVACY_REVIEW' WHERE id = ${aid}`);
      await db.execute(sql`UPDATE "Guide" SET statut = 'brouillon' WHERE id = ${g2}`);
      await db.execute(sql`DELETE FROM "Dispositif" WHERE id = ${did}`);
      const after = await list(A); const by = (id) => after.find((i) => i.id === id);
      const gone = (code, type) => ({ code, type, available: false, title: null, href: null, contact: false });
      expect(by(aide.id)).toMatchObject({ available: false, title: 'Fiche aide apl', records: [gone(`aide:${aid}`, 'aide')] });
      expect(by(dis.id)).toMatchObject({ available: false, records: [gone(`dispositif:${did}`, 'dispositif')] });
      expect(by(guides.id).available).toBe(false);
      expect(by(guides.id).records).toEqual([expect.objectContaining({ code: `guide:${g1}`, available: true }), gone(`guide:${g2}`, 'guide')]);
      expect(after.filter((i) => i.available === false).length).toBe(3);
      await db.execute(sql`UPDATE "Aide" SET publication_hold = NULL WHERE id = ${aid}`);
      expect((await list(A)).find((i) => i.id === aide.id)).toMatchObject({ available: true, records: [{ title: 'Fiche aide apl' }] });   // back when the record is public again
    });
    it('a self-declared negative answer is only the person’s status: nothing else changes, the record stays linked', async () => {
      const [item] = (await list(A)).filter((i) => i.title === 'Fiche aide apl');
      const out = await call({ method: 'POST', as: A, body: { action: 'status', id: item.id, status: 'DECISION_NEGATIVE' } });
      expect(out.body.item.status).toBe('DECISION_NEGATIVE');
      expect((await list(A)).find((i) => i.id === item.id)).toMatchObject({ status: 'DECISION_NEGATIVE', available: true, records: [{ contact: true }] });
    });
  });

  describe('« who does what next » of a plan step', () => {
    it('is given back for the dossier the account owns (who, detail, internal links); once the dossier is not theirs it stays only as the step’s own copy (M1)', async () => {
      const id = `visr-share-${TS}`; ids.shares.push(id);
      const results = { assessment: buildAssessment({ answers: { birthDate: '1992-03-10', householdSize: 1, territory: '67000', income: { unemployment: 700 }, housing: { status: 'tenant', rent: 480 } }, unsupportedRights: UNSUPPORTED_RIGHTS }) };
      await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${id}, NOW() + interval '7 days', '{}'::jsonb, ${JSON.stringify(results)}::jsonb, 0, ${'h-' + id}, ${'t-' + id}, 'GUEST_SHARE', ${C.id})`);
      const imp = await call({ method: 'POST', as: C, body: { action: 'import', shareId: id } });
      expect(imp.statusCode, JSON.stringify(imp.body)).toBe(200); expect(imp.body.added).toBeGreaterThan(0);
      const steps = imp.body.items.filter((i) => i.origin === 'PLAN');
      expect(steps.every((i) => i.plan && typeof i.plan.detail === 'string' && i.plan.detail.length > 0), JSON.stringify(steps.map((s) => s.plan))).toBe(true);
      const verify = steps.filter((i) => i.stepKind === 'verify');
      expect(verify.length).toBeGreaterThan(0);
      for (const v of verify) { expect(v.plan.who).toBeTruthy(); expect(v.title).toContain(v.plan.who); expect(v.plan.links.length).toBeGreaterThan(0); }
      expect(steps.flatMap((i) => i.plan.links).every((l) => /^\/[a-z]/.test(l.to) && l.label)).toBe(true);   // internal routes only: no anchor of the diagnostic form, no external address
      // a bare plan code ADA holds no record for is not listed; one that matches an aide follows that aide's visibility
      // (another suite may have seeded an aide under the same code in a shared test database: the fixture is then left alone)
      const code = verify[0].itemCodes[0]; const aid = `visr-aide-plan-${TS}`;
      const seeded = (await db.execute(sql`SELECT id FROM "Aide" WHERE slug = ${code} OR id = ${code}`)).rows.length > 0;
      if (!seeded) {
        expect(verify[0].records.filter((r) => r.code === code)).toEqual([]);
        if (verify[0].records.length === 0) expect(verify[0].available).toBe(true);
        ids.aide.push(aid);
        await db.insert(S.Aide).values({ id: aid, slug: code, titre: 'Fiche du plan', ...PUBLIC });
        expect((await list(C)).find((i) => i.id === verify[0].id).records.find((r) => r.code === code)).toMatchObject({ type: 'aide', available: true, title: 'Fiche du plan' });
        await db.execute(sql`UPDATE "Aide" SET statut = 'archive' WHERE id = ${aid}`);
        const flagged = (await list(C)).find((i) => i.id === verify[0].id);
        expect(flagged.available).toBe(false); expect(flagged.records.find((r) => r.code === code)).toMatchObject({ available: false, title: null, href: null });
      }
      expect((await list(A)).every((i) => i.plan === null)).toBe(true);
      await db.execute(sql`UPDATE "SharedDiagnostic" SET "ownerCitizenId" = NULL WHERE id = ${id}`);
      const later = (await list(C)).filter((i) => i.origin === 'PLAN');
      expect(later.length).toBe(steps.length);
      // M1 (migration 0046): the step carries its own copy of who / detail / links, so they outlive the dossier; on a database without "planStep" the
      // former behaviour stays (read back from the dossier only: nothing once it is gone). Details: tests/integration/m1-parcours-planstep-db.test.js
      const durable = (await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ParcoursItem' AND column_name = 'planStep'`)).rows.length > 0;
      if (durable) expect(Object.fromEntries(later.map((i) => [i.id, i.plan]))).toEqual(Object.fromEntries(steps.map((i) => [i.id, i.plan])));
      else expect(later.every((i) => i.plan === null)).toBe(true);
    });
  });
});
