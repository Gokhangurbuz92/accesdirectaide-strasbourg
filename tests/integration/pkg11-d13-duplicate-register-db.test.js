/**
 * D13 (owner LAB audit) on REAL PostgreSQL — the duplicate register of the directory:
 *  - candidates: same SIRET, same address in the same postal code, very similar names in the same postal code; an unrelated record is never proposed;
 *  - a decision needs an MFA session, an official https evidence page, a note, and the versions of BOTH records read (a record changed since: 409);
 *  - SAME_ENTITY keeps one record and puts the other on the verification ledger's publication hold (out of the public directory); the pair leaves the
 *    candidates; a later decision supersedes the previous one (nothing deleted); every decision is journalised.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const S = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [n, `d13-${TS}-${n}`]));
const ADMIN = `d13-${TS}@example.test`; const EVIDENCE = 'https://annuaire-entreprises.data.gouv.fr/entreprise/000000000';
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  end() { return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader() { return undefined; }, on() { return this; } });

describe.skipIf(!hasDatabase)('D13 duplicate register (real DB)', () => {
  let db, reg, auth, handler;
  const pairOf = (list, x, y) => list.find((c) => (c.a === x && c.b === y) || (c.a === y && c.b === x));
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    reg = await import('../../api/_services/duplicate-register.js'); auth = await import('../../api/_utils/auth.js'); handler = (await import('../../api/_handlers/admin/duplicates.js')).default;
    const ins = (id, nom, adresse, cp, siret = null) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, siret, "updatedAt", "createdAt")
      VALUES (${id}, ${nom}, ${id}, 'association', ${adresse}, 'Strasbourg', ${cp}, false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', ${siret}, NOW(), NOW())`);
    const siret = String(Date.now()).slice(-14).padStart(14, '9');   // the same SIRET written two ways (the column is unique as written)
    await ins(S[1], `Accueil Alpha ${TS}`, `1 rue Une ${TS}`, '67001', siret); await ins(S[2], `Association Beta ${TS}`, `2 rue Deux ${TS}`, '67002', `${siret.slice(0, 3)} ${siret.slice(3, 6)} ${siret.slice(6, 9)} ${siret.slice(9)}`);
    await ins(S[3], `Point Gamma ${TS}`, `3 rue Trois ${TS}`, '67003'); await ins(S[4], `Lieu Delta ${TS}`, `3, Rue Trois ${TS}`, '67003');
    await ins(S[5], `Centre social Hautepierre ${TS}`, `5 place ${TS}`, '67005'); await ins(S[6], `Centre Social de Hautepierre ${TS}`, `6 avenue ${TS}`, '67005');
    await ins(S[7], `Maison Epsilon ${TS}`, `7 quai ${TS}`, '67007');
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    const ids = Object.values(S);
    for (const q of [sql`DELETE FROM "StructureDuplicateDecision" WHERE "structureA" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`,
      sql`DELETE FROM "EntityVersion" WHERE entity_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`,
      sql`DELETE FROM "Structure" WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`]) await db.execute(q).catch(() => {});
  });

  it('proposes same-SIRET, same-address and similar-name pairs, never an unrelated record', async () => {
    const { candidates } = await reg.candidates();
    expect(pairOf(candidates, S[1], S[2])?.sameSiret).toBe(true);
    expect(pairOf(candidates, S[3], S[4])?.sameAddress).toBe(true);
    expect(Number(pairOf(candidates, S[5], S[6])?.nameSimilarity)).toBeGreaterThanOrEqual(0.6);
    expect(candidates.some((c) => [c.a, c.b].includes(S[7]))).toBe(false);
  });

  it('a decision needs MFA, official evidence, a note and the versions read; SAME_ENTITY holds the other record; a later decision supersedes', async () => {
    const r = mk(); await handler({ method: 'POST', url: '/api/admin/duplicates', query: {}, body: {}, headers: { host: 'localhost', authorization: `Bearer ${auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: false })}` } }, r);
    expect(r.statusCode, 'no MFA, no decision').toBe(403);
    const p = await reg.readPair(S[2], S[1]);
    const base = { a: S[1], b: S[2], decision: 'SAME_ENTITY', primaryId: S[1], evidenceUrl: EVIDENCE, note: 'Même SIRET au registre des entreprises.', versionA: p.a.version, versionB: p.b.version };
    expect((await reg.decide({ ...base, evidenceUrl: 'https://example.com/x' }, ADMIN)).code).toBe('EVIDENCE_URL_NOT_ALLOWED');
    expect((await reg.decide({ ...base, note: 'court' }, ADMIN)).code).toBe('NOTE_REQUIRED');
    expect((await reg.decide({ ...base, primaryId: S[7] }, ADMIN)).code).toBe('PRIMARY_REQUIRED');
    await db.execute(sql`UPDATE "Structure" SET telephone = '03 88 00 00 13' WHERE id = ${S[2]}`);
    expect((await reg.decide(base, ADMIN)).code, 'a record changed since it was read').toBe('STALE_REVIEW');
    const p2 = await reg.readPair(S[1], S[2]);
    const ok = await reg.decide({ ...base, versionA: p2.a.version, versionB: p2.b.version }, ADMIN);
    expect([ok.ok, ok.decision.held]).toEqual([true, S[2]]);
    const held = (await db.execute(sql`SELECT publication_hold AS h FROM "Structure" WHERE id = ${S[2]}`)).rows[0].h;
    expect(held).toMatch(/^Doublon \(registre des doublons\)/);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "ContentVerification" WHERE "entityId" = ${S[2]} AND outcome = 'HOLD'`)).rows[0].n).toBe(1);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'STRUCTURE_DUPLICATE_DECIDED' AND entity_id = ${`${[S[1], S[2]].sort().join('|')}`}`)).rows[0].n).toBe(1);
    expect(pairOf((await reg.candidates()).candidates, S[1], S[2]), 'decided pairs are no longer proposed').toBeUndefined();
    const p3 = await reg.readPair(S[1], S[2]);
    expect((await reg.decide({ a: S[1], b: S[2], decision: 'DISTINCT', evidenceUrl: EVIDENCE, note: 'Deux établissements distincts au registre.', versionA: p3.a.version, versionB: p3.b.version }, ADMIN)).ok).toBe(true);
    const rows = (await db.execute(sql`SELECT decision, "supersededAt" IS NULL AS active FROM "StructureDuplicateDecision" WHERE "structureA" = ${[S[1], S[2]].sort()[0]} ORDER BY "decidedAt"`)).rows;
    expect(rows).toEqual([{ decision: 'SAME_ENTITY', active: false }, { decision: 'DISTINCT', active: true }]);
  });
});
