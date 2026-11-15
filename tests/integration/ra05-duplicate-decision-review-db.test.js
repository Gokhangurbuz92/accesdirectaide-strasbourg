/**
 * RA-05 on REAL PostgreSQL — a recorded duplicate decision (including an automatic one of the verification chain, reviewer « ada-veille-automatique ») can be
 * found again and replaced by a person through the administrator handler:
 *  - GET ?view=decided: filters (automatic / human author, decision, in force / superseded, day range, text), pages beyond the 50 newest, both records'
 *    identifying fields with their current versions, the evidence and the note;
 *  - POST { decisions: [{ …, expectedDecisionId }] } (MFA): the decision in force is superseded (kept as history, never deleted), the new one is journalised
 *    under the person's name, the register's hold is lifted through the verification ledger — a verified record goes back to its own state, an unverified
 *    record is never published by the replacement;
 *  - a replacement bound to a decision that is no longer in force is refused (optimistic concurrency) and writes nothing; no MFA: refused.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `ra05${Date.now().toString(36)}`;
const ADMIN = `${TS}@example.test`;
const AUTO = 'ada-veille-automatique';
const EVIDENCE = 'https://annuaire-entreprises.data.gouv.fr/entreprise/000000000';
const EVIDENCE_2 = 'https://annuaire-entreprises.data.gouv.fr/etablissement/00000000000000';
const NOTE = 'Même SIRET, aucun autre registre ne distingue les deux fiches.';
const SIRET = `9${String(Date.now()).slice(-13).padStart(13, '0')}`;   // unique per run; the duplicate carries it written with spaces
const ids = [];
const rnd = () => randomUUID().replace(/-/g, '');
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  end() { return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader() { return undefined; }, on() { return this; } });

describe.skipIf(!hasDatabase)('RA-05 — review and replacement of a recorded duplicate decision (real DB)', () => {
  let db, reg, auth, handler, chain;
  let n = 0;
  const mkStructure = async ({ verified = false, siret = null } = {}) => {
    n += 1; const id = `${TS}-${String(n).padStart(3, '0')}`; ids.push(id);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, siret, "updatedAt", "createdAt")
      VALUES (${id}, ${`Fiche ${TS} ${rnd()}`}, ${id}, 'association', ${`${n} impasse ${rnd()}`}, 'Strasbourg', '67100', false, '{x}', '{tout_public}', '{social}', 'actif', ${siret}, NOW(), NOW())`);
    if (verified) {
      await db.execute(sql`UPDATE "Structure" SET verification_status = 'VERIFIED', verified_by = 'verificateur@example.test', date_verification = NOW(), territory_verified = true,
        launch_eligible = true, data_origin = 'official', source_url = 'https://annuaire-entreprises.data.gouv.fr/entreprise/1' WHERE id = ${id}`);
    }
    return id;
  };
  const state = async (id) => (await db.execute(sql`SELECT publication_hold AS h, verification_status AS v FROM "Structure" WHERE id = ${id}`)).rows[0];
  const automatic = async (x, y, decision, primaryId) => {
    const p = await reg.readPair(x, y);
    return reg.decide({ a: p.a.id, b: p.b.id, decision, primaryId, evidenceUrl: EVIDENCE, note: NOTE, versionA: p.a.version, versionB: p.b.version }, AUTO, { role: 'system' });
  };
  const tok = (mfa) => `Bearer ${auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: mfa })}`;
  const get = async (query) => { const r = mk(); await handler({ method: 'GET', url: '/api/admin/duplicates', query: { view: 'decided', q: TS, ...query }, headers: { host: 'localhost', authorization: tok(false) } }, r); return r; };
  const post = async (decisions, mfa = true) => { const r = mk(); await handler({ method: 'POST', url: '/api/admin/duplicates', query: {}, body: { decisions }, headers: { host: 'localhost', authorization: tok(mfa) } }, r); return r; };
  let A, B, C, D;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    reg = await import('../../api/_services/duplicate-register.js'); auth = await import('../../api/_utils/auth.js');
    chain = await import('../../api/_services/verification/chain.js');
    handler = (await import('../../api/_handlers/admin/duplicates.js')).default;
    A = await mkStructure({ verified: true, siret: SIRET }); B = await mkStructure({ verified: true, siret: `${SIRET.slice(0, 9)} ${SIRET.slice(9)}` });
    C = await mkStructure({ verified: true }); D = await mkStructure();
    expect((await automatic(A, B, 'SAME_ENTITY', A)).ok).toBe(true);   // the chain's « same SIRET » decision: B leaves the public directory
    expect((await automatic(C, D, 'SAME_ENTITY', C)).ok).toBe(true);   // D was never verified
  }, 60000);
  afterAll(async () => {
    if (!db || !ids.length) return;
    const list = sql.join(ids.map((i) => sql`${i}`), sql`, `);
    for (const q of [sql`DELETE FROM "StructureDuplicateDecision" WHERE "structureA" IN (${list}) OR "structureB" IN (${list})`, sql`DELETE FROM "ContentVerification" WHERE "entityId" IN (${list})`,
      sql`DELETE FROM "EntityVersion" WHERE entity_id IN (${list})`, sql`DELETE FROM "Structure" WHERE id IN (${list})`]) await db.execute(q).catch(() => {});
  });

  it('the automatic reviewer of the register is the one the verification chain signs with', () => {
    expect(reg.AUTOMATIC_REVIEWER).toBe(chain.SYSTEM_REVIEWER.id);
  });

  it('lists the decided pairs with both records, the evidence and the note; filters on the author, the decision, the state, the day and a text', async () => {
    const all = await get({});
    expect(all.statusCode).toBe(200);
    expect(all.body).toMatchObject({ total: 2, page: 1, pages: 1, automaticReviewer: AUTO });
    const ab = all.body.decisions.find((d) => d.key === `${A}|${B}`);
    expect(ab).toMatchObject({ decision: 'SAME_ENTITY', primaryId: A, reviewerId: AUTO, automatic: true, evidenceUrl: EVIDENCE, note: NOTE, supersededAt: null, changedSince: false });   // putting a record aside is not a content change
    expect(ab.A).toMatchObject({ id: A, siret: SIRET, ville: 'Strasbourg', code_postal: '67100', verification_status: 'VERIFIED', publication_hold: null });
    expect(ab.B.publication_hold).toMatch(/^Doublon \(registre des doublons\)/);
    expect(ab.A.version).toMatch(/^[0-9a-f]{64}$/); expect(ab.B.version).toMatch(/^[0-9a-f]{64}$/);

    await db.execute(sql`UPDATE "Structure" SET telephone = '03 88 00 00 00' WHERE id = ${D}`);   // a record edited after the decision is flagged
    expect((await get({})).body.decisions.find((d) => d.key === `${C}|${D}`).changedSince).toBe(true);
    expect((await get({ reviewer: 'auto' })).body.total).toBe(2);
    expect((await get({ reviewer: 'human' })).body.total).toBe(0);
    expect((await get({ decision: 'DISTINCT' })).body.total).toBe(0);
    expect((await get({ decision: 'SAME_ENTITY' })).body.total).toBe(2);
    expect((await get({ status: 'superseded' })).body.total).toBe(0);
    const today = new Date().toISOString().slice(0, 10); const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    expect((await get({ from: today, to: today })).body.total).toBe(2);
    expect((await get({ to: yesterday })).body.total).toBe(0);
    expect((await get({ from: '2026-02-31' })).body.total).toBe(2);   // not a calendar day: ignored, never an error
    expect((await get({ q: SIRET })).body.decisions.map((d) => d.key)).toEqual([`${A}|${B}`]);
    expect((await get({ q: `${TS}%_` })).body.total).toBe(0);   // % and _ are text, not wildcards
    const anonymous = mk(); await handler({ method: 'GET', url: '/api/admin/duplicates', query: { view: 'decided' }, headers: { host: 'localhost' } }, anonymous);
    expect(anonymous.statusCode).toBe(401);
  });

  it('a person replaces the automatic decision with expectedDecisionId: superseded history kept, the hold lifted through the ledger, journalised under her name', async () => {
    const before = (await get({})).body.decisions.find((d) => d.key === `${A}|${B}`);
    const item = { a: A, b: B, decision: 'DISTINCT', evidenceUrl: EVIDENCE_2, note: 'Deux établissements distincts au répertoire SIRENE (relecture humaine).', versionA: before.A.version, versionB: before.B.version, expectedDecisionId: before.id };
    expect((await post([item], false)).statusCode).toBe(403);   // no MFA: nothing written
    expect((await get({})).body.decisions.find((d) => d.key === `${A}|${B}`).id).toBe(before.id);

    const out = await post([item]);
    expect(out.statusCode).toBe(200);
    expect(out.body.results[0]).toMatchObject({ ok: true, idempotent: false, decision: { decision: 'DISTINCT', held: null, released: [B], superseded: 1 } });
    expect(await state(B), 'the record goes back to its own verification state').toEqual({ h: null, v: 'VERIFIED' });

    const inForce = (await get({ status: 'active' })).body.decisions.find((d) => d.key === `${A}|${B}`);
    expect(inForce).toMatchObject({ decision: 'DISTINCT', reviewerId: ADMIN, automatic: false, evidenceUrl: EVIDENCE_2, changedSince: false });
    const history = (await get({ status: 'superseded' })).body.decisions;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: before.id, decision: 'SAME_ENTITY', reviewerId: AUTO, automatic: true, note: NOTE });
    expect(history[0].supersededAt).toBeTruthy();
    expect((await get({ reviewer: 'human' })).body.total).toBe(1);
    expect((await get({ reviewer: 'auto', status: 'all' })).body.total).toBe(2);

    const ledger = (await db.execute(sql`SELECT outcome, "reviewerId" FROM "ContentVerification" WHERE "entityId" = ${B} ORDER BY "createdAt", outcome`)).rows;
    expect(ledger).toEqual([{ outcome: 'HOLD', reviewerId: AUTO }, { outcome: 'RELEASE_HOLD', reviewerId: ADMIN }]);
    const audit = (await db.execute(sql`SELECT actor, details FROM "AuditLog" WHERE action = 'STRUCTURE_DUPLICATE_DECIDED' AND entity_id = ${`${A}|${B}`} ORDER BY "timestamp"`)).rows;
    expect(audit.map((r) => [r.actor, r.details.decision, r.details.superseded])).toEqual([[AUTO, 'SAME_ENTITY', 0], [ADMIN, 'DISTINCT', 1]]);
    expect(audit[1].details.released).toEqual([B]);

    // the same request again, still bound to the automatic decision that is no longer in force: refused, nothing written
    const again = await post([{ ...item, note: 'Une autre note pour la même paire, envoyée trop tard.', evidenceUrl: EVIDENCE, versionB: inForce.B.version }]);
    expect(again.body.results[0]).toMatchObject({ ok: false, status: 409, code: 'PAIR_ALREADY_DECIDED' });
    expect((await get({ status: 'all' })).body.decisions.filter((d) => d.key === `${A}|${B}`)).toHaveLength(2);
  });

  it('replacing a « same establishment » decision never publishes a record that was not verified', async () => {
    const before = (await get({ status: 'active' })).body.decisions.find((d) => d.key === `${C}|${D}`);
    expect((await state(D)).h).toMatch(/^Doublon/);
    const out = await post([{ a: C, b: D, decision: 'DISTINCT', evidenceUrl: EVIDENCE_2, note: 'Deux établissements distincts au répertoire SIRENE.', versionA: before.A.version, versionB: before.B.version, expectedDecisionId: before.id }]);
    expect(out.body.results[0]).toMatchObject({ ok: true, decision: { released: [D] } });
    const row = (await db.execute(sql`SELECT publication_hold AS h, verification_status AS v, launch_eligible AS l FROM "Structure" WHERE id = ${D}`)).rows[0];
    expect(row.h).toBeNull(); expect(row.v).not.toBe('VERIFIED'); expect(row.l).not.toBe(true);
  });

  it('pages beyond the 50 newest decisions', async () => {
    const hub = await mkStructure();
    for (let i = 0; i < 53; i += 1) { const s = await mkStructure(); expect((await automatic(hub, s, 'DISTINCT')).ok).toBe(true); }
    const first = await get({ decision: 'DISTINCT', reviewer: 'auto', pageSize: 25 });
    expect(first.body).toMatchObject({ total: 53, page: 1, pageSize: 25, pages: 3 });
    expect(first.body.decisions).toHaveLength(25);
    const third = await get({ decision: 'DISTINCT', reviewer: 'auto', pageSize: 25, page: 3 });
    expect(third.body.decisions).toHaveLength(3);
    const seen = new Set([...first.body.decisions, ...(await get({ decision: 'DISTINCT', reviewer: 'auto', pageSize: 25, page: 2 })).body.decisions, ...third.body.decisions].map((d) => d.id));
    expect(seen.size).toBe(53);
    expect((await get({ pageSize: 5000 })).body.pageSize).toBe(100);
    expect((await get({ page: 99 })).body.decisions).toEqual([]);
  }, 120000);
});
