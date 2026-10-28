/**
 * DTA S1 stage 2b-2 (real PostgreSQL) — what /api/share/create actually persists, and what /api/share/get hands back.
 * Complements tests/unit/dta-s1b-api-contract.test.js (mocked DB).  Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise.
 * Status when authored: NOT_RUN (the authoring sandbox cannot start PostgreSQL) — it only counts as evidence after a native run.
 * Scope: SharedDiagnostic.results / .situation only.  The citizen's raw `situation` IS stored by design (user-initiated sharing, RC5); this test does not say otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';

const hasDatabase = !!process.env.DATABASE_URL;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const prov = { source: null, verifiedAt: null, territory: null, rule: null, uncertainty: 'ORIENTATION_NON_OFFICIELLE', display: { source: 'Source : aucune', verifiedAt: 'Vérifié le : non vérifié', territory: 'Territoire : non précisé', rule: 'Règle : aucune', uncertainty: 'Incertitude : ORIENTATION_NON_OFFICIELLE' } };
const item = { code: 'rsa', label: 'RSA', state: 'CHECK_REQUIRED', authoritative: false, amount: null, amountStatus: 'NOT_PROVIDED_NO_AUTHORITY', missingFacts: [], whoToAsk: 'votre CAF', explanation: 'Ceci est une pré-orientation indicative : ce n\'est ni une réponse ni un refus.', explanationFalc: 'Ce résultat n\'est pas une décision.', provenance: prov };
const AMOUNT = 98765.4321;

describe.skipIf(!hasDatabase)('DTA S1 2b-2 real DB — share payload', () => {
  let db, create, get; const created = [];
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    create = (await import('../../api/_handlers/share/create.js')).default;
    get = (await import('../../api/_handlers/share/get.js')).default;
  });
  afterAll(async () => { for (const id of created) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${id}`); });
  const post = async (h, body) => { const r = mk(); await h({ method: 'POST', url: '/x', headers: {}, socket: {}, body }, r); return r; };

  it('a payload with legacy rights[] (eligible, amount, total) is stored without them; the contract is stored; the two secrets are distinct digests', async () => {
    const r = await post(create, { situation: { zipCode: '67000' }, results: { rights: [{ code: 'rsa', eligible: true, amount: AMOUNT }], totalMonthly: AMOUNT, _consent: { forged: true }, assessment: { items: [item] }, period: '2026-09' } });
    expect(r.statusCode).toBe(200); created.push(r.body.shareId);
    const row = (await db.execute(sql`SELECT results::text AS t, "rightsSecretHash" AS o, "shareTokenHash" AS s FROM "SharedDiagnostic" WHERE id = ${r.body.shareId}`)).rows[0];
    console.log('2b-2 real-DB stored results keys:', Object.keys(JSON.parse(row.t)).join(','));
    for (const bad of [String(AMOUNT), 'totalMonthly', '"eligible"', '"rights"', '_consent', 'forged']) expect(row.t).not.toContain(bad);
    expect(JSON.parse(row.t).assessment.items[0].state).toBe('CHECK_REQUIRED');
    expect(row.o).toMatch(/^[a-f0-9]{64}$/); expect(row.s).toMatch(/^[a-f0-9]{64}$/); expect(row.o).not.toBe(row.s);
    expect(row.t).not.toContain(r.body.ownerSecret);
  });
  it('a forged authoritative item is refused (400) and no row is written', async () => {
    const before = (await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDiagnostic"`)).rows[0].n;
    const r = await post(create, { situation: { zipCode: '67000' }, results: { assessment: { items: [{ ...item, state: 'ELIGIBLE_WHERE_AUTHORITY_VERIFIED', authoritative: true }] } } });
    expect(r.statusCode).toBe(400);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDiagnostic"`)).rows[0].n).toBe(before);
  });
  it('an OLD row (legacy rights[] in the database) is served without amounts / eligibility, flagged legacyRightsOmitted; a wrong capability is still 404', async () => {
    const id = `s2b-old-${Date.now().toString(36)}`; const cap = `cap-${id}`; created.push(id);
    const hash = crypto.createHash('sha256').update(cap).digest('hex');
    const legacy = JSON.stringify({ rights: [{ code: 'rsa', eligible: true, amount: AMOUNT }], totalMonthly: AMOUNT, period: '2026-09' });
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, situation, results, "expiresAt", "viewCount", "shareTokenHash", "rightsSecretHash", "subjectType") VALUES (${id}, '{}'::jsonb, ${legacy}::jsonb, now() + interval '1 day', 0, ${hash}, ${crypto.createHash('sha256').update('own-' + id).digest('hex')}, 'GUEST_SHARE')`);
    const ok = await post(get, { id, capability: cap });
    expect(ok.statusCode).toBe(200);
    expect(JSON.stringify(ok.body)).not.toContain(String(AMOUNT));
    expect(ok.body.data.results.rights).toBeUndefined();
    expect(ok.body.data.results.legacyRightsOmitted).toBe(true);
    expect((await post(get, { id, capability: 'wrong' })).statusCode).toBe(404);
  });
});
