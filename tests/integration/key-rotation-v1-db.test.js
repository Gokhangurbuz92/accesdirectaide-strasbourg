/**
 * Launch-readiness item 61 on REAL PostgreSQL — the key rotation covers the v1 values (api/lib/crypto.ts) it used to skip as « legacy »: an appointment's contact
 * snapshot, name and notes, a conversation message. With a new primary key and the old one decrypt-only, the status is NOT « safe to retire » while such a value
 * needs the old key; the run re-encrypts it (compare-and-set) and afterwards it reads with the new key alone. The suite moves its own rows back to the test
 * environment's key at the end; rows of other suites are never touched. Synthetic keys and data; skipped without DATABASE_URL.
 */
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const ID = (n) => `kr1-${n}-${TS}`;
const A = crypto.randomBytes(32).toString('hex');
const B = crypto.randomBytes(32).toString('hex');

describe.skipIf(!hasDatabase)('key rotation of v1 values (real DB, synthetic keys)', () => {
  let db, c, rot; const ORIG = process.env.ADA_ENCRYPTION_KEY; const ORIG_PREV = process.env.ADA_ENCRYPTION_KEY_PREVIOUS;
  const ring = (primary, previous = []) => { process.env.ADA_ENCRYPTION_KEY = primary; process.env.ADA_ENCRYPTION_KEY_PREVIOUS = previous.filter(Boolean).join(','); };
  const mine = async () => (await db.execute(sql`SELECT "citizenEmailSnapshot" e, "beneficiaryName" n, notes FROM "ProAppointment" WHERE id = ${ID('apt')}`)).rows[0];
  const kind = (st, k) => st.byKind[k]?.needing || 0;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    c = await import('../../api/lib/crypto.js');
    rot = await import('../../api/_services/key-rotation.js');
    const schema = await import('../../src/db/schema.js');
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt")
      VALUES (${ID('str')}, 'Rotation', ${ID('str')}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.insert(schema.ProRdvService).values({ id: ID('svc'), structureId: ID('str'), name: 'S', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true });
    ring(A);
    const start = new Date(Date.now() + 5 * 86400000);
    await db.insert(schema.ProAppointment).values({ id: ID('apt'), structureId: ID('str'), serviceId: ID('svc'), startAt: start, endAt: new Date(start.getTime() + 1800000), status: 'confirmed',
      beneficiaryName: c.encrypt('Prénom Nom'), notes: c.encrypt('Apporter le dernier avis d’imposition'), citizenEmailSnapshot: c.encrypt('prenom.nom@example.test') });
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    try {
      ring(ORIG, [B, A]);   // the suite's own rows back to the environment key, so other suites are unaffected
      await rot.rewrapAll({ apply: true });
    } finally {
      process.env.ADA_ENCRYPTION_KEY = ORIG; if (ORIG_PREV === undefined) delete process.env.ADA_ENCRYPTION_KEY_PREVIOUS; else process.env.ADA_ENCRYPTION_KEY_PREVIOUS = ORIG_PREV;
      for (const q of [sql`DELETE FROM "ProAppointment" WHERE id = ${ID('apt')}`, sql`DELETE FROM "ProRdvService" WHERE id = ${ID('svc')}`, sql`DELETE FROM "Structure" WHERE id = ${ID('str')}`]) await db.execute(q).catch(() => {});
    }
  });

  it('with a new primary key the old v1 values are counted: the old key is not « safe to retire »', async () => {
    ring(B, [A]);
    const st = await rot.rotationStatus();
    expect(kind(st, 'ProAppointment.citizenEmailSnapshot')).toBe(1);
    expect(kind(st, 'ProAppointment.beneficiaryName')).toBe(1);
    expect(kind(st, 'ProAppointment.notes')).toBe(1);
    expect(st.safeToRetireOldKeys).toBe(false);
    const row = await mine();
    expect(c.decrypt(row.e)).toBe('prenom.nom@example.test');   // still readable while A is kept decrypt-only
  });

  it('the run re-encrypts them with the primary key; then they read with the new key alone', async () => {
    ring(B, [A]);
    const run = await rot.rewrapAll({ apply: true });
    expect(run.byKind['ProAppointment.citizenEmailSnapshot']).toMatchObject({ updated: 1, failed: 0 });
    const st = await rot.rotationStatus();
    for (const k of ['ProAppointment.citizenEmailSnapshot', 'ProAppointment.beneficiaryName', 'ProAppointment.notes']) expect(kind(st, k), k).toBe(0);
    ring(B);
    const row = await mine();
    expect([c.decrypt(row.e), c.decrypt(row.n), c.decrypt(row.notes)]).toEqual(['prenom.nom@example.test', 'Prénom Nom', 'Apporter le dernier avis d’imposition']);
    expect(c.v1KeyIndex(row.e)).toBe(0);
  });
});
