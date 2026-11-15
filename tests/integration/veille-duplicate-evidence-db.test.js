/**
 * The nightly chain's automatic duplicate decision, on REAL PostgreSQL (no network) — the evidence must be strong by the duplicate register's own assessor
 * (api/_services/duplicate-evidence.js) before a record is put aside without a person:
 *  - two establishments of one manager (same SIRET, two different FINESS numbers) are two services: both stay online, the night's report says so ONCE;
 *  - two different public functions under one SIRET (a mission locale and a point-justice) stay online too;
 *  - the same SIRET at the same address with nothing to tell the records apart is still merged automatically (the most complete record is kept).
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const N = String(Date.now()).slice(-7);
const TS = `vde${N}`;
const SIRET = { finess: `91${N}00011`, fn: `92${N}00022`, same: `93${N}00033` };
const ID = { finA: `${TS}-fin-a`, finB: `${TS}-fin-b`, fnA: `${TS}-fn-a`, fnB: `${TS}-fn-b`, sameA: `${TS}-same-a`, sameB: `${TS}-same-b` };
const HOLD = 'Doublon (registre des doublons)';

/** SIRENE's answer for one establishment, whether asked by its number or by a name (annuaire-entreprises search) */
const etab = (siret, name) => ({ nom_complet: name, etat_administratif: 'A', complements: { est_association: true }, nature_juridique: '9220', date_mise_a_jour: '2026-09-01',
  matching_etablissements: [{ siret, etat_administratif: 'A', date_fermeture: null, adresse: '3 rue des Tilleuls 67000 Strasbourg', code_postal: '67000', commune: '67482', libelle_commune: 'STRASBOURG', latitude: '48.57', longitude: '7.75' }] });
const BY_NAME = { [`Tilleuls ${N}`]: SIRET.finess, [`Mission locale ${N}`]: SIRET.fn, [`Entraide ${N}`]: SIRET.same };
const sources = async (url) => {
  const u = new URL(url);
  if (u.hostname === 'api-lannuaire.service-public.fr') return Response.json({ total_count: 0, results: [] });
  if (u.hostname === 'recherche-entreprises.api.gouv.fr') {
    const q = u.searchParams.get('q') || '';
    if (Object.values(SIRET).includes(q)) return Response.json({ results: [etab(q, `ETABLISSEMENT ${q}`)] });
    const hit = Object.entries(BY_NAME).find(([key]) => q.toLowerCase().includes(key.toLowerCase()));
    return Response.json({ results: hit ? [etab(hit[1], q.toUpperCase())] : [] });
  }
  return new Response('not found', { status: 404 });
};

describe.skipIf(!hasDatabase)('automatic duplicate decision: only on strong evidence (real DB)', () => {
  let db; let runVeille; const runs = [];
  const mine = (kind, r) => Object.values(ID).includes(r.id);
  const run = async (extra = {}) => { const r = await runVeille({ db, fetchImpl: sources, trigger: 'test', only: ['structure'], texts: false, ignorePause: true, forceRegistry: true, root: process.cwd(), select: mine, ...extra }); runs.push(r.runId); return r; };
  const rec = async (id) => (await db.execute(sql`SELECT statut, verification_status AS v, publication_hold AS h FROM "Structure" WHERE id = ${id}`)).rows[0];
  const events = async (id) => (await db.execute(sql`SELECT kind, outcome, summary, details FROM "VeilleEvent" WHERE entity_id = ${id} AND kind = 'DUPLICATE' ORDER BY created_at`)).rows;
  const decisions = async (x, y) => (await db.execute(sql`SELECT decision FROM "StructureDuplicateDecision" WHERE "structureA" = ${[x, y].sort()[0]} AND "structureB" = ${[x, y].sort()[1]}`)).rows;
  /** the SIRET column is unique: the first record of a place holds it, the second is identified by SIRENE from its name and street (checkStructureRecord) */
  const st = async (id, nom, siret, { finess = null, type = 'Association', tel = null } = {}) => {
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, code_postal, ville, siret, numero_finess, telephone, services, publics_accueillis, categories_aidees, statut, "createdAt", "updatedAt")
      VALUES (${id}, ${nom}, ${id}, ${type}, '3 rue des Tilleuls', '67000', 'Strasbourg', ${siret}, ${finess}, ${tel}, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 'brouillon',
        NOW() - (${id.endsWith('-a') ? 2 : 1} || ' minutes')::interval, NOW())`);
  };

  beforeAll(async () => {
    process.env.ADA_VERIFICATION_MIN_GAP_MS = '0';
    ({ db } = await import('../../src/db/index.js'));
    ({ runVeille } = await import('../../api/_services/verification/chain.js'));
    await st(ID.finA, `EHPAD Les Tilleuls ${N}`, SIRET.finess, { finess: `67A${N}`.slice(0, 9), type: 'EHPAD', tel: '03 88 00 00 00' });
    await st(ID.finB, `SSIAD Les Tilleuls ${N}`, null, { finess: `67B${N}`.slice(0, 9), type: 'SSIAD' });
    await st(ID.fnA, `Mission locale ${N}`, SIRET.fn, { tel: '03 88 00 00 01' });
    await st(ID.fnB, `Point-justice Mission locale ${N}`, null);
    await st(ID.sameA, `Association Entraide ${N}`, SIRET.same, { tel: '03 88 00 00 02' });
    await st(ID.sameB, `Association Entraide ${N} Strasbourg`, null);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    const list = sql.join(Object.values(ID).map((s) => sql`${s}`), sql`, `);
    for (const q of [sql`DELETE FROM "StructureDuplicateDecision" WHERE "structureA" IN (${list}) OR "structureB" IN (${list})`, sql`DELETE FROM "ContentVerification" WHERE "entityId" IN (${list})`,
      sql`DELETE FROM "EntityVersion" WHERE entity_id IN (${list})`, sql`DELETE FROM "VeilleEvent" WHERE entity_id IN (${list})`,
      ...(runs.filter(Boolean).length ? [sql`DELETE FROM "CronRun" WHERE id IN (${sql.join(runs.filter(Boolean).map((r) => sql`${r}`), sql`, `)})`] : []),
      sql`DELETE FROM "Structure" WHERE id IN (${list})`]) await db.execute(q).catch(() => {});
  });

  it('same SIRET, two different FINESS numbers: neither record is withdrawn; same SIRET alone at one address is still merged', async () => {
    const r = await run();
    expect(r.ok).toBe(true);
    // two FINESS establishments of one manager
    expect([await rec(ID.finA), await rec(ID.finB)]).toEqual([{ statut: 'actif', v: 'VERIFIED', h: null }, { statut: 'actif', v: 'VERIFIED', h: null }]);
    expect(await decisions(ID.finA, ID.finB)).toEqual([]);
    const ev = await events(ID.finB);
    expect(ev.map((e) => e.outcome)).toEqual(['UNRESOLVED']);
    expect(ev[0].summary).toMatch(/même SIRET, services possiblement distincts : les deux fiches restent en ligne/);
    expect(ev[0].summary).toMatch(/FINESS/);
    expect(ev[0].details).toMatchObject({ primaryId: ID.finA, basis: 'FINESS_DIFFERENT' });
    // two public functions under one SIRET
    expect([(await rec(ID.fnA)).h, (await rec(ID.fnB)).h]).toEqual([null, null]);
    expect(await decisions(ID.fnA, ID.fnB)).toEqual([]);
    expect((await events(ID.fnB)).map((e) => [e.outcome, e.details.basis])).toEqual([['UNRESOLVED', 'FUNCTIONS_DIFFER']]);
    // nothing tells them apart: the automatic merge is unchanged (the most complete record is kept)
    expect((await rec(ID.sameA)).h).toBeNull();
    expect(String((await rec(ID.sameB)).h)).toMatch(new RegExp(`^${HOLD.replace(/[()]/g, '\\$&')}`));
    expect(await decisions(ID.sameA, ID.sameB)).toEqual([{ decision: 'SAME_ENTITY' }]);
    expect((await events(ID.sameB)).map((e) => e.outcome)).toEqual(['WITHDRAWN']);
  }, 120000);

  it('the next night: still online, and the same note is not written again', async () => {
    const r = await run({ force: true });
    expect(r.ok).toBe(true);
    expect([(await rec(ID.finA)).h, (await rec(ID.finB)).h, (await rec(ID.fnA)).h, (await rec(ID.fnB)).h]).toEqual([null, null, null, null]);
    expect(await events(ID.finB)).toHaveLength(1);
    expect(await events(ID.fnB)).toHaveLength(1);
    expect(r.counts['DUPLICATE:pending']).toBe(2);
  }, 120000);
});
