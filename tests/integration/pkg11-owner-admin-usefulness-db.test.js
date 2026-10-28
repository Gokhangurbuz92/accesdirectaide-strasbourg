/**
 * Owner LAB audit (2026-10-25) on REAL PostgreSQL — the administration says what really waits and what was really decided:
 *  - « À traiter » (admin/stats → tasks): each count follows its screen's rule — organizations by decision (never decided / on hold / refused / verified),
 *    open quality items, new reports, open support requests — and moves when the data moves;
 *  - the catalogue list tells a reviewer's HOLD decision from a change made after a verification (holdKind DECISION / EDIT) and returns the refusal;
 *  - the duplicate register no longer proposes two branches of one network (« Agence … STRASBOURG MEINAU » / « … DANUBE ») for their shared prefix, and
 *    still proposes real near-duplicates; each candidate carries the records' current decisions;
 *  - the deep health check accepts a named administrator session when the retired legacy ADMIN_TOKEN is not configured (the LAB), and still refuses anonymous.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const S = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [n, `use-${TS}-${n}`]));
const A = Object.fromEntries([1, 2].map((n) => [n, `use-${TS}-aide-${n}`]));
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  end() { return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader() { return undefined; }, on() { return this; } });

describe.skipIf(!hasDatabase)('owner admin usefulness (real DB)', () => {
  let db, tasks, content, reg, edit;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    tasks = await import('../../api/_services/admin-tasks.js'); content = await import('../../api/_services/admin-content.js');
    reg = await import('../../api/_services/duplicate-register.js'); edit = await import('../../api/_services/content-versions.js');
  }, 60000);
  const ins = (id, nom, adresse, cp, extra = sql``) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt")
      VALUES (${id}, ${nom}, ${id}, 'association', ${adresse}, 'Strasbourg', ${cp}, false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'brouillon', NOW(), NOW())${extra}`);
  afterAll(async () => {
    if (!db) return;
    const ids = Object.values(S);
    for (const q of [sql`DELETE FROM "ReviewQueueItem" WHERE id LIKE ${`use-${TS}-%`}`, sql`DELETE FROM "ContentReport" WHERE "contentId" LIKE ${`use-${TS}-%`}`,
      sql`DELETE FROM "SupportRequest" WHERE id LIKE ${`use-${TS}-%`}`, sql`DELETE FROM "Aide" WHERE id IN (${A[1]}, ${A[2]})`,
      sql`DELETE FROM "Structure" WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`]) await db.execute(q).catch(() => {});
  });

  it('« À traiter » counts follow each screen and move with the data', async () => {
    const before = await tasks.adminTasks({ db });
    for (const k of ['organizations', 'quality', 'reports', 'support', 'duplicates', 'proposals', 'falc', 'accessRequests', 'erasures', 'closures', 'breakGlass', 'aiSuggestions'])
      expect(before[k], `${k} is computed`).not.toBeNull();
    await ins(S[1], `Asso never ${TS}`, `1 rue A ${TS}`, '67101');
    await ins(S[2], `Asso held ${TS}`, `2 rue B ${TS}`, '67102'); await db.execute(sql`UPDATE "Structure" SET publication_hold = 'Téléphone à confirmer (QA)' WHERE id = ${S[2]}`);
    await ins(S[3], `Asso refused ${TS}`, `3 rue C ${TS}`, '67103'); await db.execute(sql`UPDATE "Structure" SET verification_status = 'REJECTED' WHERE id = ${S[3]}`);
    await db.execute(sql`INSERT INTO "ReviewQueueItem" (id, "entityType", "entityId", title, reason, severity, status, details, "createdAt", "updatedAt")
      VALUES (${`use-${TS}-q`}, 'STRUCTURE', ${S[1]}, 'QA', 'MISSING_SOURCE_DOCUMENT', 'P1', 'OPEN', '{}'::jsonb, NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ContentReport" (id, "contentType", "contentId", reason, message, status, "createdAt", "updatedAt")
      VALUES (${`use-${TS}-r`}, 'STRUCTURE', ${`use-${TS}-1`}, 'HORAIRES_FAUX', 'Horaires changés (QA).', 'NEW', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "SupportRequest" (id, category, "messageEncrypted", "contactEncrypted", status, "createdAt", "updatedAt") VALUES (${`use-${TS}-s`}, 'OTHER', 'x', null, 'OPEN', NOW(), NOW())`);
    const after = await tasks.adminTasks({ db });
    expect(after.organizations.never - before.organizations.never, 'never decided').toBe(1);
    expect(after.organizations.onHold - before.organizations.onHold, 'on hold').toBe(1);
    expect(after.organizations.rejected - before.organizations.rejected, 'refused').toBe(1);
    expect(after.organizations.total - before.organizations.total).toBe(3);
    expect([after.quality - before.quality, after.reports - before.reports, after.support - before.support]).toEqual([1, 1, 1]);
  });

  it('the catalogue list tells a reviewer\'s hold from an edit after verification, and returns the refusal', async () => {
    for (const [id, hold] of [[A[1], 'Montant à confirmer avec la caisse (QA).'], [A[2], `${edit.EDIT_HOLD_PREFIX} (cest_quoi) : à revérifier`]])
      await db.execute(sql`INSERT INTO "Aide" (id, slug, titre, statut, data_origin, cest_quoi, publication_hold, "updatedAt") VALUES (${id}, ${id}, ${`Aide usage ${TS}`}, 'brouillon', 'official', 'QA', ${hold}, NOW())`);
    const items = (await content.listContent('aide', { q: `Aide usage ${TS}` }, db)).items;
    expect(Object.fromEntries(items.map((r) => [r.id, r.holdKind]))).toEqual({ [A[1]]: 'DECISION', [A[2]]: 'EDIT' });
    const refused = (await content.listContent('structure', { q: S[3] }, db)).items[0];
    expect(refused.verification_status).toBe('REJECTED');
  });

  it('two branches of one network are not proposed for their shared prefix; real near-duplicates still are, with their decisions', async () => {
    await ins(S[4], 'Agence QA Réseau STRASBOURG MEINAU', `4 rue D ${TS}`, '67104');
    await ins(S[5], 'Agence QA Réseau STRASBOURG DANUBE', `5 rue E ${TS}`, '67104');
    await ins(S[6], `Centre social Neudorf ${TS}`, `6 rue F ${TS}`, '67106'); await ins(S[7], `Centre Social de Neudorf ${TS}`, `7 rue G ${TS}`, '67106');
    await db.execute(sql`UPDATE "Structure" SET verification_status = 'REJECTED' WHERE id = ${S[7]}`);
    const { candidates } = await reg.candidates({ db });
    const pair = (x, y) => candidates.find((c) => (c.a === x && c.b === y) || (c.a === y && c.b === x));
    expect(pair(S[4], S[5]), 'two agencies of one network').toBeUndefined();
    const near = pair(S[6], S[7]); expect(near, 'a real near-duplicate').toBeDefined();
    expect([near.a === S[7] ? near.decisionA : near.decisionB]).toEqual(['REJECTED']);
    expect(reg.distinctivePartsClose('Agence France Travail STRASBOURG PONT MATTHIS', 'Agence France Travail STRASBOURG SEYBOTH')).toBe(false);
  });

  it('the deep health check accepts a named administrator session without the legacy ADMIN_TOKEN, and refuses anonymous requests', async () => {
    const saved = process.env.ADMIN_TOKEN; delete process.env.ADMIN_TOKEN;   // env.secrets.adminToken is read at call time
    try {
      const auth = await import('../../api/_utils/auth.js'); const handler = (await import('../../api/_handlers/health-deep.js')).default;
      const anon = mk(); await handler({ method: 'GET', url: '/api/health/deep', query: {}, headers: { host: 'localhost' } }, anon);
      expect(anon.statusCode).toBe(401);
      const token = auth.signAdminSessionToken({ email: `use-${TS}@example.test`, role: 'admin', mfa_verified: true });
      const r = mk(); await handler({ method: 'GET', url: '/api/health/deep', query: {}, headers: { host: 'localhost', authorization: `Bearer ${token}` } }, r);
      expect(r.statusCode, 'an administrator reads the deep check (200, or 503 when a dependency is down — never 401)').not.toBe(401);
      expect(r.body?.deps?.db).toBeDefined();
      // R13: the territory reference is counted; without communes the administrator sees the release blocker TERRITORY_REFERENCE_MISSING (not an outage)
      const tr = r.body.deps.territoryReference; expect(tr.ok).toBe(tr.communes > 0);
      expect(r.body.config.failing.includes('TERRITORY_REFERENCE_MISSING')).toBe(!tr.ok);
    } finally { if (saved !== undefined) process.env.ADMIN_TOKEN = saved; }
  });
});
