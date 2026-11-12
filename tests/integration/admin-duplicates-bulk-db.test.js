/**
 * Registre des doublons — bulk review on REAL PostgreSQL, on copies of real proposed pairs (tests/fixtures/duplicate-pairs-lab.json: names, kinds, addresses
 * and official source pages kept; identifiers remapped to unique test values with the same equal / different relations).
 *  - register(): every pair with both records' versions (exactly the ones decide() checks) and the evidence assistance;
 *  - decideBatch(): each decision through decide() — official evidence, note, versions read, the pair's state seen —, its own transaction: a stale record,
 *    a pair decided meanwhile, a bad URL or a pair sent twice fail alone; the others are saved, journalised, and leave the queue (history kept);
 *  - a replayed batch writes nothing (idempotent); two concurrent decisions on one pair: exactly one wins;
 *  - nothing unrelated changes: only the record not kept is put on hold; no record is deleted or merged;
 *  - the handler: MFA for the batch.
 * Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import fixture from '../fixtures/duplicate-pairs-lab.json';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const ADMIN = `dup-bulk-${TS}@example.test`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  end() { return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader() { return undefined; }, on() { return this; } });

// identifiers remapped per run (the real numbers exist in a LAB copy and are unique as written); equal stays equal, different stays different
const seq = { n: 0 };
const remap = new Map();
const fake = (kind, v) => { if (!v) return null; const k = `${kind}:${String(v).replace(/[^0-9A-Za-z]/g, '')}`; if (!remap.has(k)) { seq.n += 1; const d = `${Date.now()}${seq.n}`.slice(-8).padStart(8, '0'); remap.set(k, kind === 'siret' ? `9${d}${String(seq.n).padStart(5, '0')}` : kind === 'annuaire' ? `test-${TS}-${seq.n}` : `9${d}`); } return remap.get(k); };
const ids = [];
const copy = (r, tag, patch = {}) => {
  const id = `dupb-${TS}-${tag}`; ids.push(id);
  return { ...r, id, slug: id, nom: `${r.nom} ${TS}`, adresse: `${r.adresse} ${TS}`, siret: fake('siret', r.siret), numero_finess: fake('finess', r.numero_finess), source_annuaire: fake('annuaire', r.source_annuaire), publication_hold: null, ...patch };
};
const P = fixture.pairs;
const real = P.camsp.A.numero_finess === '670797158' ? P.camsp.A : P.camsp.B;
const R = {
  castel: [copy(P.castel.A, 'castel-a'), copy(P.castel.B, 'castel-b')],
  mairieCcas: [copy(P.mairie_ccas.A, 'mc-a'), copy(P.mairie_ccas.B, 'mc-b')],
  dental: [copy(P.dental_medical.A, 'dm-a'), copy(P.dental_medical.B, 'dm-b')],
  sameName: [copy(P.same_name_ccas.A, 'sn-a'), copy(P.same_name_ccas.B, 'sn-b')],
  falsePos: [copy(P.false_positive.A, 'fp-a'), copy(P.false_positive.B, 'fp-b')],
  missing: [copy(P.missing_evidence.A, 'me-a'), copy(P.missing_evidence.B, 'me-b')],
};
const trueA = copy(real, 'td-a', { telephone: '03 88 00 00 01' });
const trueB = { ...trueA, id: `dupb-${TS}-td-b`, slug: `dupb-${TS}-td-b`, nom: `${real.nom} doublon ${TS}`, numero_finess: `${trueA.numero_finess.slice(0, 3)} ${trueA.numero_finess.slice(3)}`, telephone: null };   // the same number written differently
ids.push(trueB.id);
const bystander = copy({ nom: 'Lieu sans rapport', type_structure: 'Association', adresse: '99 rue Isolée', code_postal: '67999', ville: 'Ailleurs' }, 'by');
const ALL = [...Object.values(R).flat(), trueA, trueB, bystander];
const key = (x, y) => [x.id, y.id].sort().join('|');

describe.skipIf(!hasDatabase)('duplicate register — bulk review (real DB)', () => {
  let db, reg, cv, auth, handler;
  const inList = (list) => sql.join(list.map((i) => sql`${i}`), sql`, `);
  const checksum = async (exclude = []) => (await db.execute(sql`SELECT md5(string_agg(to_jsonb(t)::text, '' ORDER BY id)) AS h, count(*)::int AS n FROM "Structure" t WHERE NOT (id IN (${inList(exclude.length ? exclude : ['-'])}))`)).rows[0];
  const item = (reg2, pr, decision, patch = {}) => {
    const p = reg2.pairs.find((x) => x.key === key(pr[0], pr[1]));
    const s = p.assessment;
    return { a: p.a, b: p.b, decision, evidenceUrl: s.evidenceUrl, note: s.note, versionA: p.A.version, versionB: p.B.version, expectedDecisionId: null, ...(decision === 'SAME_ENTITY' ? { primaryId: s.primaryId } : {}), ...patch };
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    reg = await import('../../api/_services/duplicate-register.js'); cv = await import('../../api/_services/content-verification.js');
    auth = await import('../../api/_utils/auth.js'); handler = (await import('../../api/_handlers/admin/duplicates.js')).default;
    for (const r of ALL) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, siret, numero_finess,
          source_annuaire, source_url, auto_check, verification_status, telephone, "updatedAt", "createdAt")
        VALUES (${r.id}, ${r.nom}, ${r.slug}, ${r.type_structure}, ${r.adresse}, ${r.ville}, ${r.code_postal}, false, '{x}', '{tout_public}', '{social}', 'actif', ${r.siret}, ${r.numero_finess},
          ${r.source_annuaire}, ${r.source_url || null}, ${r.auto_check ? JSON.stringify(r.auto_check) : null}::jsonb, ${r.verification_status || 'pending'}, ${r.telephone || null}, NOW(), NOW())`);
    }
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    const l = inList(ALL.map((r) => r.id));
    for (const q of [sql`DELETE FROM "StructureDuplicateDecision" WHERE "structureA" IN (${l}) OR "structureB" IN (${l})`, sql`DELETE FROM "ContentVerification" WHERE "entityId" IN (${l})`,
      sql`DELETE FROM "EntityVersion" WHERE entity_id IN (${l})`, sql`DELETE FROM "Structure" WHERE id IN (${l})`]) await db.execute(q).catch(() => {});
  });

  it('register: every fixture pair, with the versions decide() checks and the evidence assistance', async () => {
    const out = await reg.register();
    const get = (pr) => out.pairs.find((p) => p.key === key(pr[0], pr[1]));
    for (const pr of [...Object.values(R), [trueA, trueB]]) expect(get(pr), pr[0].nom).toBeTruthy();
    const p = get(R.castel);
    expect(p.A.version).toBe(cv.contentVersion(await cv.rowJson(db, 'structure', p.a)));
    expect([p.assessment.suggestion, p.assessment.confidence, p.assessment.basis]).toEqual(['DISTINCT', 'high', 'FINESS_DIFFERENT']);
    expect(get(R.mairieCcas).assessment.suggestion).toBe('DISTINCT');
    expect(get(R.dental).assessment.reasons.map((r) => r.code)).toContain('DENTAL_VS_MEDICAL');
    expect(get(R.sameName).assessment).toMatchObject({ suggestion: 'DISTINCT', wellDocumented: false });
    expect(get(R.missing).assessment.suggestion).toBeNull();
    expect(get([trueA, trueB]).assessment).toMatchObject({ suggestion: 'SAME_ENTITY', basis: 'FINESS_SAME', primaryId: trueA.id });
    expect(out.pairs.some((x) => [x.a, x.b].includes(bystander.id)), 'an unrelated record is never proposed').toBe(false);
  });

  it('batch: partial failure, each decision on its own, decided pairs leave the queue with their history; nothing unrelated changes', async () => {
    const r0 = await reg.register();
    // already decided (another administrator, meanwhile) then sent from the stale queue with another decision
    const fp = item(r0, R.falsePos, 'DISTINCT');
    expect((await reg.decide(fp, `other-${ADMIN}`)).ok).toBe(true);
    // concurrent change of a record after the queue was read
    await db.execute(sql`UPDATE "Structure" SET telephone = '03 88 99 99 99' WHERE id = ${R.castel[0].id}`);
    const before = await checksum([trueB.id]);
    const items = [
      item(r0, R.castel, 'DISTINCT'),                                                     // stale
      item(r0, R.mairieCcas, 'DISTINCT'),                                                 // ok
      item(r0, R.dental, 'DISTINCT'),                                                     // ok
      item(r0, [trueA, trueB], 'SAME_ENTITY'),                                            // ok: trueB held
      item(r0, R.sameName, 'DISTINCT', { evidenceUrl: 'http://example.com/ccas' }),       // bad evidence
      { ...fp, decision: 'SAME_ENTITY', primaryId: fp.a, note: 'Même établissement selon la source.' },   // decided meanwhile
      item(r0, R.mairieCcas, 'DISTINCT'),                                                 // twice in one submission
    ];
    const out = await reg.decideBatch(items, ADMIN);
    expect(out.results.map((r) => (r.ok ? 'ok' : r.code))).toEqual(['STALE_REVIEW', 'ok', 'ok', 'ok', 'EVIDENCE_URL_NOT_ALLOWED', 'PAIR_ALREADY_DECIDED', 'DUPLICATE_IN_BATCH']);
    expect([out.saved, out.failed]).toEqual([3, 4]);

    // each saved decision has its own evidence URL and note, and its audit row
    const rows = (await db.execute(sql`SELECT "structureA" || '|' || "structureB" AS k, decision, "evidenceUrl", note, "primaryId" FROM "StructureDuplicateDecision" WHERE "supersededAt" IS NULL AND "reviewerId" = ${ADMIN}`)).rows;
    expect(rows.map((r) => r.k).sort()).toEqual([key(...R.mairieCcas), key(...R.dental), key(trueA, trueB)].sort());
    for (const r of rows) { expect(r.evidenceUrl).toMatch(/^https:\/\//); expect(r.note.length).toBeGreaterThan(20); }
    expect(rows.find((r) => r.k === key(...R.dental)).note).toMatch(/FINESS/);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'STRUCTURE_DUPLICATE_DECIDED' AND actor = ${ADMIN}`)).rows[0].n).toBe(3);
    expect((await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'STRUCTURE_DUPLICATE_BATCH' AND actor = ${ADMIN}`)).rows[0].details).toMatchObject({ submitted: 7, saved: 3, failed: 4 });

    // only the record not kept changed (put on hold, still there); nothing deleted, nothing merged
    expect((await checksum([trueB.id]))).toEqual(before);
    const held = (await db.execute(sql`SELECT id, publication_hold AS h, nom, telephone FROM "Structure" WHERE id IN (${inList([trueA.id, trueB.id])}) ORDER BY id`)).rows;
    expect(held.find((h) => h.id === trueB.id).h).toMatch(/^Doublon \(registre des doublons\)/);
    expect(held.find((h) => h.id === trueA.id)).toMatchObject({ h: null, telephone: '03 88 00 00 01' });
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "ContentVerification" WHERE "entityId" IN (${inList(ALL.map((r) => r.id))}) AND outcome = 'HOLD'`)).rows[0].n).toBe(1);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "Structure" WHERE id IN (${inList(ALL.map((r) => r.id))})`)).rows[0].n).toBe(ALL.length);

    // the queue: decided pairs leave it; the failed ones stay; the history keeps every decision
    const r1 = await reg.register();
    const left = new Set(r1.pairs.map((p) => p.key));
    for (const pr of [R.mairieCcas, R.dental, [trueA, trueB], R.falsePos]) expect(left.has(key(...pr))).toBe(false);
    for (const pr of [R.castel, R.sameName, R.missing]) expect(left.has(key(...pr))).toBe(true);
    const hist = (await reg.recentDecisions({ limit: 200 })).decisions.map((d) => `${d.a}|${d.b}`);
    expect(hist).toEqual(expect.arrayContaining([key(...R.mairieCcas), key(...R.dental), key(trueA, trueB), key(...R.falsePos)]));

    // replay (a lost answer, the same request again): nothing new is written
    const replay = await reg.decideBatch(items.slice(1, 4), ADMIN);
    expect(replay.results.map((r) => [r.ok, r.idempotent])).toEqual([[true, true], [true, true], [true, true]]);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "StructureDuplicateDecision" WHERE "reviewerId" = ${ADMIN}`)).rows[0].n).toBe(3);
  });

  it('two concurrent decisions on one pair: exactly one is recorded', async () => {
    const r0 = await reg.register();
    const base = item(r0, R.sameName, 'DISTINCT');
    const [x, y] = await Promise.all([reg.decideBatch([base], `${ADMIN}-1`), reg.decideBatch([{ ...base, decision: 'SAME_ENTITY', primaryId: base.a, note: 'Même guichet selon l’Annuaire.' }], `${ADMIN}-2`)]);
    const res = [x.results[0], y.results[0]];
    expect(res.filter((r) => r.ok).length).toBe(1);
    expect(res.find((r) => !r.ok).code).toBe('PAIR_ALREADY_DECIDED');
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "StructureDuplicateDecision" WHERE "structureA" = ${[R.sameName[0].id, R.sameName[1].id].sort()[0]} AND "supersededAt" IS NULL`)).rows[0].n).toBe(1);
  });

  it('handler: the register for an administrator; the batch needs an MFA session', async () => {
    const tok = (mfa) => `Bearer ${auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: mfa })}`;
    const g = mk(); await handler({ method: 'GET', url: '/api/admin/duplicates?view=register', query: { view: 'register' }, headers: { host: 'localhost', authorization: tok(false) } }, g);
    expect(g.statusCode).toBe(200); expect(Array.isArray(g.body.pairs)).toBe(true);
    const r0 = g.body; const body = { decisions: [item(r0, R.castel, 'DISTINCT')] };
    const no = mk(); await handler({ method: 'POST', url: '/api/admin/duplicates', query: {}, body, headers: { host: 'localhost', authorization: tok(false) } }, no);
    expect(no.statusCode).toBe(403);
    const yes = mk(); await handler({ method: 'POST', url: '/api/admin/duplicates', query: {}, body, headers: { host: 'localhost', authorization: tok(true) } }, yes);
    expect(yes.statusCode).toBe(200); expect(yes.body.results[0]).toMatchObject({ ok: true, key: key(...R.castel) });
    const big = mk(); await handler({ method: 'POST', url: '/api/admin/duplicates', query: {}, body: { decisions: Array.from({ length: 51 }, () => body.decisions[0]) }, headers: { host: 'localhost', authorization: tok(true) } }, big);
    expect([big.statusCode, big.body.error]).toEqual([400, 'BATCH_TOO_LARGE']);
  });
});
