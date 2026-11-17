/**
 * FA D3 / D10 on REAL PostgreSQL (no network) — the night chain and historical duplicate decisions:
 *  - a FINESS establishment and a record WITHOUT a FINESS number that SIRENE identifies by the same SIRET (the Neuhof decision of 15/11/2026): both records
 *    stay online, no decision is written, the night's report says so once (basis FINESS_ONE_SIDED) — a person decides in the duplicate register;
 *  - a historical automatic SAME_ENTITY decision taken before the rule changed is NOT rewritten by the night: not reverted, not superseded, the record it put
 *    aside keeps its hold (only a person replaces it, through « Revoir » — covered by ra05-duplicate-decision-review-db);
 *  - a person's DISTINCT decision on a pair the night would otherwise merge is never overridden.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const N = String(Date.now()).slice(-7);
const TS = `fad3${N}`;
const SIRET = { one: `94${N}00044`, hist: `95${N}00055`, human: `96${N}00066` };
const ID = { oneA: `${TS}-one-a`, oneB: `${TS}-one-b`, histA: `${TS}-hist-a`, histB: `${TS}-hist-b`, humA: `${TS}-hum-a`, humB: `${TS}-hum-b` };
const HOLD = 'Doublon (registre des doublons) : même organisation que « Historique »';
const AUTO = 'ada-veille-automatique';

const etab = (siret, name) => ({ nom_complet: name, etat_administratif: 'A', complements: { est_association: true }, nature_juridique: '9220', date_mise_a_jour: '2026-09-01',
  matching_etablissements: [{ siret, etat_administratif: 'A', date_fermeture: null, adresse: '2 A rue de Brantome 67100 Strasbourg', code_postal: '67100', commune: '67482', libelle_commune: 'STRASBOURG', latitude: '48.55', longitude: '7.77' }] });
const BY_NAME = { [`Neuhof ${N}`]: SIRET.one, [`Historique ${N}`]: SIRET.hist, [`Humain ${N}`]: SIRET.human };
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

describe.skipIf(!hasDatabase)('FA D3/D10: night chain vs historical duplicate decisions (real DB)', () => {
  let db; let runVeille; const runs = [];
  const mine = (kind, r) => Object.values(ID).includes(r.id);
  const run = async (extra = {}) => { const r = await runVeille({ db, fetchImpl: sources, trigger: 'test', only: ['structure'], texts: false, ignorePause: true, forceRegistry: true, root: process.cwd(), select: mine, ...extra }); runs.push(r.runId); return r; };
  const rec = async (id) => (await db.execute(sql`SELECT statut, publication_hold AS h FROM "Structure" WHERE id = ${id}`)).rows[0];
  const events = async (id) => (await db.execute(sql`SELECT outcome, details FROM "VeilleEvent" WHERE entity_id = ${id} AND kind = 'DUPLICATE' ORDER BY created_at`)).rows;
  const decisions = async (x, y) => (await db.execute(sql`SELECT id, decision, "reviewerId" AS r, "supersededAt" AS s FROM "StructureDuplicateDecision"
    WHERE "structureA" = ${[x, y].sort()[0]} AND "structureB" = ${[x, y].sort()[1]} ORDER BY "decidedAt"`)).rows;
  const st = async (id, nom, siret, { finess = null, tel = null, hold = null } = {}) => {
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, code_postal, ville, siret, numero_finess, telephone, publication_hold, services, publics_accueillis, categories_aidees, statut, "createdAt", "updatedAt")
      VALUES (${id}, ${nom}, ${id}, 'Maison de santé', '2 A rue de Brantôme', '67100', 'Strasbourg', ${siret}, ${finess}, ${tel}, ${hold}, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 'brouillon',
        NOW() - (${id.endsWith('-a') ? 2 : 1} || ' minutes')::interval, NOW())`);
  };
  const decision = async (a, b, kind, reviewer) => {
    const [x, y] = [a, b].sort();
    await db.execute(sql`INSERT INTO "StructureDuplicateDecision" (id, "structureA", "structureB", decision, "primaryId", "evidenceUrl", note, "reviewerId", "versionA", "versionB", "decidedAt")
      VALUES (${`${TS}-dec-${a}`}, ${x}, ${y}, ${kind}, ${kind === 'SAME_ENTITY' ? a : null}, ${`https://annuaire-entreprises.data.gouv.fr/etablissement/${SIRET.hist}`},
        ${kind === 'SAME_ENTITY' ? `Même établissement selon le répertoire SIRENE (${SIRET.hist}) : la fiche la plus complète est conservée.` : 'Deux services distincts (décision humaine).'},
        ${reviewer}, 'v1', 'v1', NOW() - interval '3 days')`);
  };

  beforeAll(async () => {
    process.env.ADA_VERIFICATION_MIN_GAP_MS = '0';
    ({ db } = await import('../../src/db/index.js'));
    ({ runVeille } = await import('../../api/_services/verification/chain.js'));
    // the Neuhof shape: the FINESS establishment holds the SIRET; the other record is identified by SIRENE from its name and street
    await st(ID.oneA, `Maison Urbaine de Sante du Neuhof ${N}`, SIRET.one, { finess: `67N${N}`.slice(0, 9), tel: '03 88 00 00 10' });
    await st(ID.oneB, `Maison de santé du Neuhof ${N}`, null);
    // a historical automatic decision (before the rule changed): B put aside
    await st(ID.histA, `Centre Historique ${N}`, SIRET.hist, { finess: `67H${N}`.slice(0, 9), tel: '03 88 00 00 11' });
    await st(ID.histB, `Centre Historique ${N} bis`, null, { hold: HOLD });
    await decision(ID.histA, ID.histB, 'SAME_ENTITY', AUTO);
    // a person decided two distinct services for a pair nothing else tells apart
    await st(ID.humA, `Accueil Humain ${N}`, SIRET.human, { tel: '03 88 00 00 12' });
    await st(ID.humB, `Accueil Humain ${N} Strasbourg`, null);
    await decision(ID.humA, ID.humB, 'DISTINCT', 'person@example.test');
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    const list = sql.join(Object.values(ID).map((s) => sql`${s}`), sql`, `);
    for (const q of [sql`DELETE FROM "StructureDuplicateDecision" WHERE "structureA" IN (${list}) OR "structureB" IN (${list})`, sql`DELETE FROM "ContentVerification" WHERE "entityId" IN (${list})`,
      sql`DELETE FROM "EntityVersion" WHERE entity_id IN (${list})`, sql`DELETE FROM "VeilleEvent" WHERE entity_id IN (${list})`,
      ...(runs.filter(Boolean).length ? [sql`DELETE FROM "CronRun" WHERE id IN (${sql.join(runs.filter(Boolean).map((r) => sql`${r}`), sql`, `)})`] : []),
      sql`DELETE FROM "Structure" WHERE id IN (${list})`]) await db.execute(q).catch(() => {});
  });

  it('a FINESS establishment and a record without a FINESS number under one SIRET: both online, no decision, one note for a person', async () => {
    const r = await run();
    expect(r.ok).toBe(true);
    expect([(await rec(ID.oneA)).h, (await rec(ID.oneB)).h]).toEqual([null, null]);
    expect(await decisions(ID.oneA, ID.oneB)).toEqual([]);
    const ev = await events(ID.oneB);
    expect(ev.map((e) => [e.outcome, e.details.basis])).toEqual([['UNRESOLVED', 'FINESS_ONE_SIDED']]);
    expect(ev[0].details).toMatchObject({ primaryId: ID.oneA, key: `s:${SIRET.one}` });
  }, 120000);

  it('historical automatic decision: neither reverted nor superseded by the night; the record it put aside keeps its hold', async () => {
    const d = await decisions(ID.histA, ID.histB);
    expect(d.map((x) => [x.decision, x.r, x.s])).toEqual([['SAME_ENTITY', AUTO, null]]);
    expect((await rec(ID.histB)).h).toBe(HOLD);
    expect((await rec(ID.histA)).h).toBeNull();
  });

  it('a person\'s DISTINCT decision is never overridden: both records online, no new decision', async () => {
    expect((await decisions(ID.humA, ID.humB)).map((x) => [x.decision, x.s])).toEqual([['DISTINCT', null]]);
    expect([(await rec(ID.humA)).h, (await rec(ID.humB)).h]).toEqual([null, null]);
    expect(await events(ID.humB)).toEqual([]);
  });

  it('the next night changes nothing and does not repeat the note', async () => {
    const r = await run({ force: true });
    expect(r.ok).toBe(true);
    expect(await events(ID.oneB)).toHaveLength(1);
    expect(await decisions(ID.oneA, ID.oneB)).toEqual([]);
    expect((await decisions(ID.histA, ID.histB)).map((x) => x.s)).toEqual([null]);
    expect((await rec(ID.histB)).h).toBe(HOLD);
    expect((await decisions(ID.humA, ID.humB)).map((x) => x.decision)).toEqual(['DISTINCT']);
  }, 120000);
});
