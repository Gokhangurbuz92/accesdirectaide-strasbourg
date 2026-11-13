/**
 * D13 follow-up on REAL PostgreSQL — reversing a duplicate decision and counting the open pairs:
 *  - a SAME_ENTITY decision replaced by DISTINCT lifts the register's hold on the record it had put aside (through the verification ledger, by the new
 *    decision's author, journalised); replaced by SAME_ENTITY with the other record kept, the hold moves; nothing is published by the release itself;
 *  - a hold that is no longer the register's (a person's hold) is never lifted, nor a record another active SAME_ENTITY pair still puts aside;
 *  - the dashboard's « Doublons proposés » counts every open pair, not the list's first page (100).
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const ADMIN = `rev-${TS}@example.test`; const OTHER_ADMIN = `rev2-${TS}@example.test`;
const EVIDENCE = 'https://annuaire-entreprises.data.gouv.fr/entreprise/000000000';
const NOTE = 'Ce que le registre officiel établit pour ces deux fiches.';
const ids = [];
const rnd = () => randomUUID().replace(/-/g, '');   // names no trigram similarity brings together

describe.skipIf(!hasDatabase)('D13 duplicate decision reversal and open-pair count (real DB)', () => {
  let db, reg, tasks;
  let n = 0;
  const mkStructure = async ({ nom, adresse, cp = '67100', verified = false } = {}) => {
    n += 1; const id = `rev-${TS}-${n}`; ids.push(id);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt")
      VALUES (${id}, ${nom || `Fiche ${rnd()}`}, ${id}, 'association', ${adresse || `${n} impasse ${rnd()}`}, 'Strasbourg', ${cp}, false, '{x}', '{tout_public}', '{social}', 'actif', NOW(), NOW())`);
    if (verified) {
      await db.execute(sql`UPDATE "Structure" SET verification_status = 'VERIFIED', verified_by = 'verificateur@example.test', date_verification = NOW(), territory_verified = true,
        launch_eligible = true, data_origin = 'official', source_url = 'https://annuaire-entreprises.data.gouv.fr/entreprise/1' WHERE id = ${id}`);
    }
    return id;
  };
  const hold = async (id) => (await db.execute(sql`SELECT publication_hold AS h, verification_status AS v FROM "Structure" WHERE id = ${id}`)).rows[0];
  const decideOn = async (x, y, decision, primaryId, who = ADMIN) => {
    const p = await reg.readPair(x, y);
    return reg.decide({ a: x, b: y, decision, primaryId, evidenceUrl: EVIDENCE, note: NOTE, versionA: p.a.id === x ? p.a.version : p.b.version, versionB: p.a.id === x ? p.b.version : p.a.version }, who);
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    reg = await import('../../api/_services/duplicate-register.js'); tasks = await import('../../api/_services/admin-tasks.js');
  }, 60000);
  afterAll(async () => {
    if (!db || !ids.length) return;
    const list = sql.join(ids.map((i) => sql`${i}`), sql`, `);
    for (const q of [sql`DELETE FROM "StructureDuplicateDecision" WHERE "structureA" IN (${list}) OR "structureB" IN (${list})`, sql`DELETE FROM "ContentVerification" WHERE "entityId" IN (${list})`,
      sql`DELETE FROM "EntityVersion" WHERE entity_id IN (${list})`, sql`DELETE FROM "Structure" WHERE id IN (${list})`]) await db.execute(q).catch(() => {});
  });

  it('SAME_ENTITY then DISTINCT: the record put aside comes back to its own verification state, released by the new decision\'s author and journalised', async () => {
    const A = await mkStructure(); const B = await mkStructure({ verified: true });
    const first = await decideOn(A, B, 'SAME_ENTITY', A);
    expect([first.ok, first.decision.held, first.decision.released]).toEqual([true, B, []]);
    expect((await hold(B)).h).toMatch(/^Doublon \(registre des doublons\)/);
    const second = await decideOn(A, B, 'DISTINCT', undefined, OTHER_ADMIN);
    expect([second.ok, second.decision.held, second.decision.released, second.decision.superseded]).toEqual([true, null, [B], 1]);
    expect(await hold(B), 'hold lifted; the verification is the record\'s own').toEqual({ h: null, v: 'VERIFIED' });
    const ledger = (await db.execute(sql`SELECT outcome, "reviewerId" FROM "ContentVerification" WHERE "entityId" = ${B} ORDER BY "createdAt", outcome`)).rows;
    expect(ledger).toEqual([{ outcome: 'HOLD', reviewerId: ADMIN }, { outcome: 'RELEASE_HOLD', reviewerId: OTHER_ADMIN }]);
    const audit = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'STRUCTURE_DUPLICATE_DECIDED' AND entity_id = ${[A, B].sort().join('|')} AND details->>'decision' = 'DISTINCT'`)).rows[0];
    expect(audit.details.released).toEqual([B]);
  });

  it('releasing never publishes an unverified record', async () => {
    const A = await mkStructure({ verified: true }); const B = await mkStructure();
    await decideOn(A, B, 'SAME_ENTITY', A);
    const out = await decideOn(A, B, 'DISTINCT');
    expect(out.decision.released).toEqual([B]);
    const row = (await db.execute(sql`SELECT publication_hold AS h, verification_status AS v, launch_eligible AS l FROM "Structure" WHERE id = ${B}`)).rows[0];
    expect(row.h).toBeNull(); expect(row.v).not.toBe('VERIFIED'); expect(row.l).not.toBe(true);
  });

  it('SAME_ENTITY keeping A, then SAME_ENTITY keeping B: the hold moves from B to A', async () => {
    const A = await mkStructure(); const B = await mkStructure();
    await decideOn(A, B, 'SAME_ENTITY', A);
    const out = await decideOn(A, B, 'SAME_ENTITY', B);
    expect([out.ok, out.decision.held, out.decision.released]).toEqual([true, A, [B]]);
    expect((await hold(A)).h).toMatch(/^Doublon \(registre des doublons\)/);
    expect((await hold(B)).h).toBeNull();
  });

  it('a hold that is not the register\'s (put by a person since) is left as it is', async () => {
    const A = await mkStructure(); const B = await mkStructure();
    await decideOn(A, B, 'SAME_ENTITY', A);
    const { recordVerification } = await import('../../api/_services/content-verification.js');
    expect((await recordVerification({ entityType: 'structure', entityId: B, action: 'HOLD', holdReason: 'Signalement en cours d’examen', reviewer: { id: OTHER_ADMIN, role: 'admin' } })).ok).toBe(true);
    const out = await decideOn(A, B, 'DISTINCT');
    expect([out.ok, out.decision.released]).toEqual([true, []]);
    expect((await hold(B)).h).toBe('Signalement en cours d’examen');
  });

  // DBL-HOLD: a hold present BEFORE the SAME_ENTITY decision (a person's, editorial, re-verification) is carried, journalised (priorHold) and put back on reversal
  const auditOf = async (A, B, decision) => (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'STRUCTURE_DUPLICATE_DECIDED' AND entity_id = ${[A, B].sort().join('|')}
    AND details->>'decision' = ${decision} ORDER BY "timestamp" DESC LIMIT 1`)).rows[0]?.details;
  const personHold = async (id, reason) => {
    const { recordVerification } = await import('../../api/_services/content-verification.js');
    expect((await recordVerification({ entityType: 'structure', entityId: id, action: 'HOLD', holdReason: reason, reviewer: { id: OTHER_ADMIN, role: 'admin' } })).ok).toBe(true);
  };
  const verifyAs = async (id) => {
    const { recordVerification } = await import('../../api/_services/content-verification.js');
    return recordVerification({ entityType: 'structure', entityId: id, action: 'VERIFY', reviewer: { id: OTHER_ADMIN, role: 'admin' }, sourceUrl: EVIDENCE, evidenceNote: 'Vérifié sur le registre officiel des entreprises.', territoryConfirmed: true });
  };
  const releaseAs = async (id) => {
    const { recordVerification } = await import('../../api/_services/content-verification.js');
    return recordVerification({ entityType: 'structure', entityId: id, action: 'RELEASE_HOLD', reviewer: { id: OTHER_ADMIN, role: 'admin' } });
  };

  it('(a) a person\'s hold, then SAME_ENTITY: the register\'s marker goes first and the decision journals the earlier hold (priorHold)', async () => {
    const A = await mkStructure(); const B = await mkStructure({ verified: true });
    await personHold(B, 'Mise de côté éditoriale : vérification en cours');
    const out = await decideOn(A, B, 'SAME_ENTITY', A);
    expect([out.ok, out.decision.held]).toEqual([true, B]);
    const h = (await hold(B)).h;
    expect(h.startsWith(reg.DUPLICATE_HOLD)).toBe(true);
    expect(h, 'the earlier reason is carried after the marker').toContain('Mise de côté éditoriale : vérification en cours');
    const audit = await auditOf(A, B, 'SAME_ENTITY');
    expect(audit.priorHold.reason).toBe('Mise de côté éditoriale : vérification en cours');
    expect(typeof audit.priorHold.at).toBe('string');
    const ledger = (await db.execute(sql`SELECT outcome, "evidenceNote" AS n FROM "ContentVerification" WHERE "entityId" = ${B} ORDER BY "createdAt", outcome`)).rows;
    expect(ledger.map((r) => r.outcome)).toEqual(['HOLD', 'HOLD']);
    expect(ledger[1].n).toContain('Mise de côté éditoriale : vérification en cours');
  });

  it('(b) then DISTINCT: the person\'s hold is active again with its original reason, reported as restored (not released)', async () => {
    const A = await mkStructure(); const B = await mkStructure({ verified: true });
    await personHold(B, 'Signalement usager à examiner');
    expect((await decideOn(A, B, 'SAME_ENTITY', A)).ok).toBe(true);
    const out = await decideOn(A, B, 'DISTINCT');
    expect([out.ok, out.decision.released, out.decision.restored]).toEqual([true, [], [B]]);
    expect(await hold(B), 'the person\'s hold is active again').toEqual({ h: 'Signalement usager à examiner', v: 'VERIFIED' });
    const audit = await auditOf(A, B, 'DISTINCT');
    expect([audit.released, audit.restored]).toEqual([[], [B]]);
    const ledger = (await db.execute(sql`SELECT outcome FROM "ContentVerification" WHERE "entityId" = ${B} ORDER BY "createdAt", outcome`)).rows.map((r) => r.outcome);
    expect(ledger, 'append-only: hold, duplicate hold, restored hold').toEqual(['HOLD', 'HOLD', 'HOLD']);
  });

  it('(c) without a prior hold, SAME_ENTITY still holds and DISTINCT still releases; no priorHold, nothing restored', async () => {
    const A = await mkStructure(); const B = await mkStructure({ verified: true });
    const first = await decideOn(A, B, 'SAME_ENTITY', A);
    expect([first.ok, first.decision.held]).toEqual([true, B]);
    expect((await hold(B)).h).toBe(`${reg.DUPLICATE_HOLD} : même organisation que « ${(await db.execute(sql`SELECT nom FROM "Structure" WHERE id = ${A}`)).rows[0].nom} »`);
    expect((await auditOf(A, B, 'SAME_ENTITY')).priorHold).toBeUndefined();
    const second = await decideOn(A, B, 'DISTINCT');
    expect([second.ok, second.decision.released, second.decision.restored]).toEqual([true, [B], []]);
    expect(await hold(B)).toEqual({ h: null, v: 'VERIFIED' });
  });

  it('(d) while SAME_ENTITY is active over a person\'s hold, the duplicate guards still see the record as put aside', async () => {
    const A = await mkStructure(); const B = await mkStructure({ verified: true });
    await personHold(B, 'Mise de côté éditoriale');
    expect((await decideOn(A, B, 'SAME_ENTITY', A)).ok).toBe(true);
    // the chain's guards (verification/chain.js: checkStructureRecord, rememberIdentity, PROTECTED_HOLD) and the register read this exact predicate
    const isDuplicateHeld = (h) => String(h || '').startsWith(reg.DUPLICATE_HOLD);
    expect(isDuplicateHeld((await hold(B)).h)).toBe(true);
    expect((await verifyAs(B)).code, 'no verification publishes over the duplicate hold').toBe('PUBLICATION_HOLD_ACTIVE');
    const chainSrc = (await import('node:fs')).readFileSync(new URL('../../api/_services/verification/chain.js', import.meta.url), 'utf8');
    expect(chainSrc).toMatch(/if \(String\(row\.publication_hold \|\| ''\)\.startsWith\(DUPLICATE_HOLD\)\) \{ count\(ctx, 'structure:duplicate'\); return; \}/);
  });

  it('(e) an edit hold under SAME_ENTITY is carried: no release or verification drops it, and the reversal puts it back so VERIFY lifts it as before', async () => {
    const { EDIT_HOLD_PREFIX } = await import('../../api/_services/content-versions.js');
    const A = await mkStructure(); const B = await mkStructure({ verified: true });
    const edit = `${EDIT_HOLD_PREFIX} (description_courte) : à revérifier`;
    await personHold(B, edit);
    expect((await decideOn(A, B, 'SAME_ENTITY', A)).ok).toBe(true);
    const h = (await hold(B)).h;
    expect(h.startsWith(reg.DUPLICATE_HOLD)).toBe(true); expect(h).toContain(edit);
    expect((await verifyAs(B)).code).toBe('PUBLICATION_HOLD_ACTIVE');
    expect((await releaseAs(B)).code, 'a plain release would republish unreviewed text').toBe('REVERIFICATION_REQUIRED');
    const out = await decideOn(A, B, 'DISTINCT');
    expect([out.decision.released, out.decision.restored]).toEqual([[], [B]]);
    expect((await hold(B)).h).toBe(edit);
    expect((await releaseAs(B)).code).toBe('REVERIFICATION_REQUIRED');
    expect((await verifyAs(B)).ok, 'the fresh verification lifts the edit hold, as it would have').toBe(true);
    expect((await hold(B)).h).toBeNull();
  });

  it('(f) a person\'s hold under two SAME_ENTITY pairs comes back only when the last one is reversed', async () => {
    const A = await mkStructure(); const B = await mkStructure({ verified: true }); const C = await mkStructure();
    await personHold(B, 'Signalement en cours');
    await decideOn(A, B, 'SAME_ENTITY', A); await decideOn(B, C, 'SAME_ENTITY', C);
    expect((await auditOf(B, C, 'SAME_ENTITY')).priorHold.reason, 'the second decision keeps the earlier hold too').toBe('Signalement en cours');
    const one = await decideOn(A, B, 'DISTINCT');
    expect([one.decision.released, one.decision.restored]).toEqual([[], []]);
    expect((await hold(B)).h.startsWith(reg.DUPLICATE_HOLD)).toBe(true);
    const two = await decideOn(B, C, 'DISTINCT');
    expect([two.decision.released, two.decision.restored]).toEqual([[], [B]]);
    expect((await hold(B)).h).toBe('Signalement en cours');
  });

  it('a record another active SAME_ENTITY pair still puts aside stays aside', async () => {
    const A = await mkStructure(); const B = await mkStructure(); const C = await mkStructure();
    await decideOn(A, B, 'SAME_ENTITY', A);   // B aside (kept: A)
    await decideOn(B, C, 'SAME_ENTITY', C);   // B aside (kept: C)
    const out = await decideOn(A, B, 'DISTINCT');
    expect([out.ok, out.decision.released]).toEqual([true, []]);
    expect((await hold(B)).h).toMatch(/^Doublon \(registre des doublons\)/);
    const last = await decideOn(B, C, 'DISTINCT');   // the last pair that held B is reversed: now it comes back
    expect(last.decision.released).toEqual([B]);
    expect((await hold(B)).h).toBeNull();
  });

  it('the idempotent replay and the bound expectedDecisionId still behave; the bulk path reports the release per item', async () => {
    const A = await mkStructure(); const B = await mkStructure();
    const first = await decideOn(A, B, 'SAME_ENTITY', A);
    const p = await reg.readPair(A, B);
    const item = { a: A, b: B, decision: 'DISTINCT', evidenceUrl: EVIDENCE, note: NOTE, versionA: p.a.id === A ? p.a.version : p.b.version, versionB: p.a.id === A ? p.b.version : p.a.version };
    expect((await reg.decideBatch([{ ...item, expectedDecisionId: null }], ADMIN)).results[0].code, 'another decision is active').toBe('PAIR_ALREADY_DECIDED');
    expect((await hold(B)).h).toMatch(/^Doublon/);
    const batch = await reg.decideBatch([{ ...item, expectedDecisionId: first.decision.id }], ADMIN);
    expect([batch.saved, batch.results[0].decision.released]).toEqual([1, [B]]);
    const p2 = await reg.readPair(A, B);
    const replay = await reg.decideBatch([{ ...item, versionA: p2.a.id === A ? p2.a.version : p2.b.version, versionB: p2.a.id === A ? p2.b.version : p2.a.version, expectedDecisionId: batch.results[0].decision.id }], ADMIN);
    expect([replay.results[0].idempotent, replay.results[0].decision.released]).toEqual([true, []]);
  });

  it('the dashboard counts every open pair, beyond the list page of 100', async () => {
    for (let i = 0; i < 105; i += 1) {   // 105 same-address pairs
      const addr = `${i} allée des doublons ${TS}`;
      await mkStructure({ nom: rnd(), adresse: addr, cp: '67200' }); await mkStructure({ nom: rnd(), adresse: addr, cp: '67200' });
    }
    const { total } = await reg.countCandidates();
    const all = (await reg.candidates({ limit: 1000 })).candidates;
    expect(all.length).toBeLessThan(1000);
    expect(total).toBe(all.length);
    expect(total).toBeGreaterThanOrEqual(105);
    expect((await reg.candidates()).candidates.length, 'the list page stays bounded').toBeLessThanOrEqual(100);
    expect((await tasks.adminTasks({ db })).duplicates).toBe(total);
  }, 120000);
});
