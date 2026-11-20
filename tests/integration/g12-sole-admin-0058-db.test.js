/**
 * G12 / 0058 (owner 20/11/2026) — legal-hold release and ownership recovery with ONE administrator, on REAL PostgreSQL (synthetic data only).
 *  - two or more MFA administrators: the proposer is refused (403 TWO_PERSON_RULE) as before;
 *  - sole administrator: 409 sole_admin_delay before 24 h; after 24 h the proposer decides, the row says soleAdministrator and the audit too;
 *  - the database still refuses proposer = decider when the row does not say soleAdministrator (0058 CHECK rules).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const TS = Date.now(); const ADM = `g12-adm-${TS}@example.test`;
const CIT = { id: `g12-cit-${TS}`, email: `g12-cit-${TS}@example.test` };
const SOLE = async () => ({ registered: true, others: 0, sole: true });
const TWO = async () => ({ registered: true, others: 1, sole: false });
const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e?.cause?.code || e?.code || String(e); } };

describe('G12 / 0058: sole-administrator legal-hold release and ownership recovery (real DB)', () => {
  let db, pc;
  const hold = async (backHours) => {
    const id = `g12-hold-${backHours}-${TS}`;
    await db.execute(sql`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status, "releaseProposedBy", "releaseProposedAt", "releaseReason")
      VALUES (${id}, 'CitizenUser', ${CIT.id}, 'LITIGATION', ${ADM}, 'ACTIVE', ${ADM}, NOW() - make_interval(hours => ${backHours}), 'Fin du litige, conservation inutile.')`);
    const [r] = (await db.execute(sql`SELECT "releaseProposedAt" AS at FROM "LegalHold" WHERE id = ${id}`)).rows;
    return { id, at: r.at };
  };
  const recovery = async (backHours) => {
    const id = `g12-rec-${backHours}-${TS}`;
    await db.execute(sql`INSERT INTO "OwnershipRecoveryCase" (id, "citizenUserId", "newEmailEncrypted", "evidenceNote", status, "proposedBy", "proposedAt")
      VALUES (${id}, ${CIT.id}, 'sealed', 'Identité vérifiée en personne sur pièce officielle.', 'PROPOSED', ${ADM}, NOW() - make_interval(hours => ${backHours}))`);
    return id;
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    pc = await import('../../api/_services/privacy-console.js');
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
  }, 90000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "LegalHold" WHERE "recordId" = ${CIT.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "OwnershipRecoveryCase" WHERE "citizenUserId" = ${CIT.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`).catch(() => {});
  });

  it('legal hold: refused with two administrators, delayed before 24 h, released by the sole administrator after 24 h', async () => {
    const a = await hold(30);
    expect((await pc.confirmRelease(a.id, ADM, db, a.at, { soleAdministratorCheck: TWO })).code).toBe('TWO_PERSON_RULE');
    const b = await hold(2);
    const early = await pc.confirmRelease(b.id, ADM, db, b.at, { soleAdministratorCheck: SOLE });
    expect([early.status, early.code]).toEqual([409, 'sole_admin_delay']);
    expect(await pc.confirmRelease(a.id, ADM, db, a.at, { soleAdministratorCheck: SOLE })).toMatchObject({ ok: true });
    const [row] = (await db.execute(sql`SELECT status, "releasedBy", "releaseSoleAdministrator" AS s FROM "LegalHold" WHERE id = ${a.id}`)).rows;
    expect(row).toEqual({ status: 'RELEASED', releasedBy: ADM, s: true });
    const [au] = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'LEGAL_HOLD_RELEASED' AND entity_id = ${a.id}`)).rows;
    expect(au.details.soleAdministrator).toBe(true);
    // the database still refuses a self-release that does not say soleAdministrator
    expect(await code(db.execute(sql`UPDATE "LegalHold" SET status = 'RELEASED', "releasedAt" = NOW(), "releasedBy" = ${ADM} WHERE id = ${b.id}`))).toBe('23514');
  });

  it('ownership recovery: refused with two administrators, delayed before 24 h, decided by the sole administrator after 24 h', async () => {
    const a = await recovery(30);
    expect((await pc.decideRecovery(a, { decision: 'REJECT', note: 'Preuve insuffisante après relecture.' }, ADM, db, { soleAdministratorCheck: TWO })).code).toBe('TWO_PERSON_RULE');
    const b = await recovery(2);
    const early = await pc.decideRecovery(b, { decision: 'REJECT', note: 'Preuve insuffisante après relecture.' }, ADM, db, { soleAdministratorCheck: SOLE });
    expect([early.status, early.code]).toEqual([409, 'sole_admin_delay']);
    expect(await pc.decideRecovery(a, { decision: 'REJECT', note: 'Preuve insuffisante après relecture.' }, ADM, db, { soleAdministratorCheck: SOLE })).toMatchObject({ ok: true });
    const [row] = (await db.execute(sql`SELECT status, "decidedBy", "soleAdministrator" AS s FROM "OwnershipRecoveryCase" WHERE id = ${a}`)).rows;
    expect(row).toEqual({ status: 'REJECTED', decidedBy: ADM, s: true });
    expect(await code(db.execute(sql`UPDATE "OwnershipRecoveryCase" SET status = 'REJECTED', "decidedBy" = ${ADM}, "decidedAt" = NOW() WHERE id = ${b}`))).toBe('23514');
  });
});
