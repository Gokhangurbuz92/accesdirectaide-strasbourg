/**
 * A-21 — removing one organisation, or stopping all sharing, ends the purposes that organisation held in the CONSENT LEDGER (REAL PostgreSQL, real
 * public/dossier-grants handler, owner secret, synthetic rows). Before: enforcement was right but the ledger's latest PURP-05 / PURP-07 row stayed « yes ».
 */
import crypto from 'node:crypto';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const SA = `a21-sa-${TS}`, SB = `a21-sb-${TS}`, D = `a21-d-${TS}`, OTHER = `a21-other-${TS}`;
const SECRET = crypto.randomBytes(32).toString('base64url');
const hash = (c) => crypto.createHash('sha256').update(c, 'utf8').digest('hex');
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('A-21 revoke / stop sharing write the purpose withdrawal to the consent ledger (real DB)', () => {
  let db, grants, ledgerLib;
  const act = async (body, shareId = D) => { const r = mk(); await grants({ method: 'POST', url: '/api/public/dossier-grants', query: {}, body: { shareId, ...body }, headers: { host: 'localhost', 'x-share-owner-secret': SECRET } }, r); return r; };
  const ledger = async (shareId = D) => (await db.execute(sql`SELECT split_part(subject_id, ':', 2) AS org, purpose, decision, withdrawn_at IS NOT NULL AS withdrawn FROM "ConsentLog"
    WHERE subject_type = 'SHARED_DOSSIER_GRANT' AND split_part(subject_id, ':', 1) = ${shareId} ORDER BY created_at, purpose`)).rows.map((r) => `${r.org === SA ? 'A' : 'B'} ${r.purpose} ${r.decision ? 'yes' : 'no'}${r.withdrawn ? ' withdrawn' : ''}`);
  const latest = async (org, purpose, shareId = D) => (await db.execute(sql`SELECT decision FROM "ConsentLog" WHERE subject_type = 'SHARED_DOSSIER_GRANT' AND subject_id = ${`${shareId}:${org}`} AND purpose = ${purpose} ORDER BY created_at DESC LIMIT 1`)).rows[0]?.decision;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    grants = (await import('../../api/_handlers/public/dossier-grants.js')).default;
    ledgerLib = await import('../../api/lib/consent-ledger.js');
    for (const [sid, n] of [[SA, 'A'], [SB, 'B']]) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt") VALUES (${sid}, ${'A21 ' + n}, ${'a21-slug-' + n + '-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', NOW(), NOW())`);
    for (const id of [D, OTHER]) {
      await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType") VALUES (${id}, NOW() + interval '1 day', '{}'::jsonb, '{}'::jsonb, 0, ${hash(SECRET)}, ${hash('share-' + id)}, 'GUEST_SHARE')`);
      for (const sid of [SA, SB]) await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId") VALUES (${`a21-g-${id}-${sid}`}, ${id}, ${sid}, 'a21-pro')`);
    }
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${D}, ${OTHER})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${SA}, ${SB})`);
  });

  it('setup: the owner allows the automated analysis for A and B and the SIAO transmission for A (three « yes » rows)', async () => {
    for (const sid of [SA, SB]) expect((await act({ action: 'set_purposes', structureId: sid, purposes: ['PURP-06', 'PURP-05'] })).statusCode).toBe(200);
    expect((await act({ action: 'set_siao', structureId: SA, siao: true })).statusCode).toBe(200);
    expect((await act({ action: 'set_purposes', structureId: SA, purposes: ['PURP-06', 'PURP-05'] }, OTHER)).statusCode).toBe(200);   // another dossier of the same owner, same organisation
    expect(await ledger()).toEqual(['A PURP-05 yes', 'B PURP-05 yes', 'A PURP-07 yes']);
  });

  it('changing ONE purpose of an organisation that keeps its access writes exactly its own row (no extra withdrawal)', async () => {
    expect((await act({ action: 'set_purposes', structureId: SB, purposes: ['PURP-06'] })).statusCode).toBe(200);
    expect((await act({ action: 'set_purposes', structureId: SB, purposes: ['PURP-06', 'PURP-05'] })).statusCode).toBe(200);
    expect(await ledger()).toEqual(['A PURP-05 yes', 'B PURP-05 yes', 'A PURP-07 yes', 'B PURP-05 no withdrawn', 'B PURP-05 yes']);
    expect(await latest(SA, 'PURP-07')).toBe(true);   // A's SIAO consent is untouched by B's change
  });

  it('removing A: its two purposes are withdrawn in the ledger; B and the other dossier are untouched', async () => {
    expect((await act({ action: 'revoke', structureId: SA })).statusCode).toBe(200);
    expect(await latest(SA, 'PURP-05')).toBe(false);
    expect(await latest(SA, 'PURP-07')).toBe(false);
    expect(await latest(SB, 'PURP-05')).toBe(true);
    expect(await latest(SA, 'PURP-05', OTHER)).toBe(true);
    const rows = await ledger();
    expect(rows.filter((r) => r.startsWith('A ') && r.endsWith('no withdrawn')).sort()).toEqual(['A PURP-05 no withdrawn', 'A PURP-07 no withdrawn']);
    const [w] = (await db.execute(sql`SELECT w.policy_version = y.policy_version AND w.policy_hash = y.policy_hash AND w.proof_level = y.proof_level AND w.created_at > y.created_at AS ok
      FROM "ConsentLog" w JOIN "ConsentLog" y ON y.subject_id = w.subject_id AND y.purpose = w.purpose AND y.decision IS TRUE
      WHERE w.subject_id = ${`${D}:${SA}`} AND w.purpose = 'PURP-07' AND w.decision IS FALSE`)).rows;
    expect(w.ok).toBe(true);   // same policy, same proof level, strictly later than the consent it ends
  });

  it('idempotent: nothing more is written when there is nothing left to withdraw', async () => {
    const before = await ledger();
    expect(await ledgerLib.withdrawPurposesOfRevokedGrants(db, D, SA)).toBe(0);
    expect(await ledgerLib.withdrawPurposesOfRevokedGrants(db, D)).toBe(0);
    expect(await ledger()).toEqual(before);
  });

  it('stopping all sharing: every remaining « yes » of the dossier is withdrawn; the other dossier keeps its consent', async () => {
    expect((await act({ action: 'stop_sharing' })).statusCode).toBe(200);
    expect(await latest(SB, 'PURP-05')).toBe(false);
    const open = (await db.execute(sql`SELECT count(*)::int AS n FROM (SELECT DISTINCT ON (subject_id, purpose) decision FROM "ConsentLog" WHERE subject_type = 'SHARED_DOSSIER_GRANT' AND split_part(subject_id, ':', 1) = ${D} ORDER BY subject_id, purpose, created_at DESC) l WHERE l.decision IS TRUE`)).rows[0].n;
    expect(open).toBe(0);
    expect(await latest(SA, 'PURP-05', OTHER)).toBe(true);
  });

  it('the personal-data view of the ledger (export query) no longer shows a stale « yes »', async () => {
    const rows = (await db.execute(sql`SELECT DISTINCT ON (c.subject_id, c.purpose) c.subject_id, c.purpose, c.decision, c.withdrawn_at FROM "ConsentLog" c
      WHERE c.subject_type = 'SHARED_DOSSIER_GRANT' AND split_part(c.subject_id, ':', 1) = ${D} ORDER BY c.subject_id, c.purpose, c.created_at DESC`)).rows;
    expect(rows).toHaveLength(3);
    for (const r of rows) { expect(r.decision).toBe(false); expect(r.withdrawn_at).not.toBeNull(); }
  });
});
