/**
 * R45 / ENG-LR-7 on a REAL PostgreSQL — erasure ledger v2 (scripts/db-erasure-replay.mjs): what a restore of an OLDER backup undoes besides DSR erasures.
 * Simulation on one database: the ledger is read from the « live » state (a withdrawn booking message, a new legal hold, a new restriction, an open access
 * request), then the « restored copy » is simulated by putting the message back and removing the protections; the replay reinstates the protections,
 * erases the message again and records the withdrawal again; a second replay changes nothing. 0042 columns only; synthetic data.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const id = (s) => `r45v2-${s}-${TS}`;

describe.skipIf(!hasDatabase)('R45 erasure ledger v2 (real DB)', () => {
  let pool; let replay;
  const n = async (q, p = []) => Number((await pool.query(q, p)).rows[0].n);
  beforeAll(async () => {
    replay = await import('../../scripts/db-erasure-replay.mjs');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    await pool.query(`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt")
      VALUES ($1, 'R45 S', $2, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`, [id('str'), `slug-${id('str')}`]);
    await pool.query(`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES ($1, $2, 'S', 30, NOW())`, [id('svc'), id('str')]);
    await pool.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())`, [id('u'), `${id('u')}@example.test`]);
    await pool.query(`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", notes, "citizenUserId", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, NOW() + interval '3 days', NOW() + interval '3 days 30 minutes', 'confirmed', 'Personne synthétique', NULL, $4, NOW(), NOW())`, [id('apt'), id('str'), id('svc'), id('u')]);
    // « live » state after the backup: the person withdrew the message (notes already NULL), a hold, a restriction and an access request were created
    await pool.query(`INSERT INTO "ConsentLog" (id, policy_version, policy_hash, subject_type, subject_id, purpose, decision, withdrawn_at, created_at, collection_channel, guardian_involved, proof_level)
      VALUES ($1, 'r43-e6-2026-11-04', $2, 'CITIZEN_USER', $3, 'BOOKING_MESSAGE_TRANSMISSION', false, NOW(), NOW(), 'account', false, 'EXPLICIT_CHECKBOX')`, [id('cl'), `r43-e6-2026-11-04:BOOKING_MESSAGE_TRANSMISSION:${id('apt')}`, id('u')]);
    await pool.query(`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status, "createdAt") VALUES ($1, 'CitizenUser', $2, 'R45 TEST', 'test', 'ACTIVE', NOW())`, [id('lh'), id('u')]);
    await pool.query(`INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode", "affectedDomains", "reasonCode", "createdAt") VALUES
      ($1, 'CITIZEN_USER', $3, 'RESTRICT', 'ACTIVE', 'HUMAN_REVIEW_REQUIRED', '[]', 'a', NOW()), ($2, 'CITIZEN_USER', $3, 'ACCESS', 'IN_REVIEW', 'HUMAN_REVIEW_REQUIRED', '[]', NULL, NOW())`, [id('rs'), id('ac'), id('u')]);
  });
  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM "ConsentLog" WHERE subject_id = $1`, [id('u')]);
    await pool.query(`DELETE FROM "LegalHold" WHERE id = $1`, [id('lh')]);
    await pool.query(`DELETE FROM "DSRRequest" WHERE "subjectId" = $1`, [id('u')]);
    await pool.query(`DELETE FROM "ProAppointment" WHERE "structureId" = $1`, [id('str')]);
    await pool.query(`DELETE FROM "CitizenUser" WHERE id = $1`, [id('u')]);
    await pool.query(`DELETE FROM "ProRdvService" WHERE id = $1`, [id('svc')]);
    await pool.query(`DELETE FROM "Structure" WHERE id = $1`, [id('str')]);
    await pool.end();
  });

  it('exports the withdrawal (ids and time only) and the protections; replays them on the « older copy »; a second replay changes nothing', async () => {
    const withdrawals = (await replay.readMessageWithdrawals(pool)).filter((w) => w.subjectId === id('u'));
    expect(withdrawals).toEqual([expect.objectContaining({ subjectId: id('u'), appointmentId: id('apt'), policyVersion: 'r43-e6-2026-11-04' })]);
    const protections = await replay.readProtections(pool);
    const mineH = protections.legalHolds.filter((h) => h.id === id('lh')); const mineR = protections.requests.filter((q) => q.subjectId === id('u'));
    expect(mineH.length).toBe(1);
    expect(mineR.map((q) => q.requestType).sort()).toEqual(['ACCESS', 'RESTRICT']);
    const ledger = replay.ledgerOf([], new Date(Date.now() + 1000), { messageWithdrawals: withdrawals, protections: { legalHolds: mineH, requests: mineR } });
    expect(JSON.stringify(ledger)).not.toMatch(/@example|Personne/);

    // « the restored older copy »: the message is back, the withdrawal row, the hold and the requests are not
    await pool.query(`UPDATE "ProAppointment" SET notes = 'Message synthétique' WHERE id = $1`, [id('apt')]);
    await pool.query(`DELETE FROM "ConsentLog" WHERE subject_id = $1`, [id('u')]);
    await pool.query(`DELETE FROM "LegalHold" WHERE id = $1`, [id('lh')]);
    await pool.query(`DELETE FROM "DSRRequest" WHERE "subjectId" = $1`, [id('u')]);

    const plan = replay.replayPlan(ledger, new Date(Date.now() - 60_000).toISOString());
    const query = (q, p) => pool.query(q, p);
    const prot = await replay.reinstateProtections({ inspected: await replay.inspectProtections(pool, plan.protections), query });
    expect(prot).toEqual({ holdsReinstated: 1, holdsPresent: 0, holdsNotActiveForReview: 0, requestsReinstated: 2, requestsPresent: 0, failed: 0 });
    const msg = await replay.replayWithdrawals({ inspected: await replay.inspectWithdrawals(pool, plan.withdrawals), query });
    expect(msg).toEqual({ messagesErased: 1, absent: 0, failed: 0 });
    expect(await n(`SELECT count(*)::int n FROM "ProAppointment" WHERE id = $1 AND notes IS NULL`, [id('apt')])).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM "ConsentLog" WHERE subject_id = $1 AND decision = false AND collection_channel = 'restore-replay'`, [id('u')])).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM "LegalHold" WHERE id = $1 AND status = 'ACTIVE'`, [id('lh')])).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM "DSRRequest" WHERE "subjectId" = $1 AND status IN ('ACTIVE', 'IN_REVIEW')`, [id('u')])).toBe(2);

    const prot2 = await replay.reinstateProtections({ inspected: await replay.inspectProtections(pool, plan.protections), query });
    expect(prot2).toMatchObject({ holdsReinstated: 0, holdsPresent: 1, requestsReinstated: 0, requestsPresent: 2 });
    expect(await replay.replayWithdrawals({ inspected: await replay.inspectWithdrawals(pool, plan.withdrawals), query })).toEqual({ messagesErased: 0, absent: 1, failed: 0 });
    expect(await n(`SELECT count(*)::int n FROM "ConsentLog" WHERE subject_id = $1 AND decision = false`, [id('u')])).toBe(1);
  });
});
