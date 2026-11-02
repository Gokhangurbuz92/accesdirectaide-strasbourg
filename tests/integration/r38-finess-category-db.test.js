/**
 * R38 — a bounded FINESS run on REAL PostgreSQL, synthetic register files (no network): with categories ['340'] the veille adds ONLY the open MJPM services
 * (« Service mandataire judiciaire à la protection des majeurs », official category 340) of the département, published with the register's facts; an
 * EHPAD of the same file that is not yet in the directory is NOT added by this run; nothing else is created. Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const N = String(Date.now()).slice(-6);
const F = { mjpm: `67M${N}`, mjpmClosed: `67C${N}`, ehpad: `67E${N}` };
const ege = (num, { cat, state = 'A', closedAt = null, name, street }) => ({
  informationsGeneralesEGE: { egeId: `e${num}`, dateFermeture: closedAt, dateOuverture: '2001-01-01', nomEgeCourt: name, nomEgeLong: name, numFinessEge: num, siret: null },
  categorieentiteGeographiqueExercice: cat, adresse: [{ usageAdresse: '03', cogCommune: '67482', ligneAcheminement: 'STRASBOURG', ligneQuatre: street, codePostal: '67000', coordonneesGeographique: { directionLatitude: '48.58', directionLongitude: '7.75' } }],
  contact: [{ typeContact: { roleContact: '01' }, telecom: { telephone: '0388000001', telecopie: null, courriel: null } }], engagement: [], evenement: [], roleEge: [], etatObjet: state, dateDerniereMaj: '2026-09-01 00:00:00' });
const pm = (eges) => ({ informationsGeneralesPMEJ: { pmSmsseId: `p${N}`, numFinessPm: `67P${N}`, denominationLonguePmSmsse: `ASSOCIATION TUTELAIRE ${N}`, siren: null }, adresse: [], contact: [], engagement: [], evenement: [], ege: eges, etatObjet: 'A', dateDerniereMaj: '2026-09-01 00:00:00' });

describe.skipIf(!hasDatabase)('R38 bounded FINESS run: only the requested official categories are added', () => {
  let db; let runVeille; let dir; let runId;
  const list = (xs) => sql`(${sql.join(xs.map((x) => sql`${x}`), sql`, `)})`;
  beforeAll(async () => {
    process.env.ADA_VERIFICATION_MIN_GAP_MS = '0';
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-finess-r38-'));
    ({ db } = await import('../../src/db/index.js'));
    ({ runVeille } = await import('../../api/_services/verification/chain.js'));
    await db.execute(sql`DELETE FROM "CronRun" WHERE job = 'veille' AND jsonb_typeof(metrics->'finess') = 'object'`);
  });
  afterAll(async () => {
    if (!db) return;
    const ids = (await db.execute(sql`SELECT id FROM "Structure" WHERE numero_finess IN ${list(Object.values(F))}`)).rows.map((r) => r.id);
    if (ids.length) for (const t of ['ContentVerification', 'EntityVersion']) await db.execute(sql`DELETE FROM ${sql.raw(`"${t}"`)} WHERE ${sql.raw(t === 'EntityVersion' ? 'entity_id' : '"entityId"')} IN ${list(ids)}`).catch(() => {});
    if (runId) { await db.execute(sql`DELETE FROM "VeilleEvent" WHERE run_id = ${runId}`).catch(() => {}); await db.execute(sql`DELETE FROM "CronRun" WHERE id = ${runId}`).catch(() => {}); }
    if (ids.length) await db.execute(sql`DELETE FROM "Structure" WHERE id IN ${list(ids)}`).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('adds the open MJPM service only', async () => {
    const s = path.join(dir, 's.json.gz'); const a = path.join(dir, 'a.json.gz');
    fs.writeFileSync(s, zlib.gzipSync(JSON.stringify({ schemaVersion: 'v1', generatedAt: '2026-11-02T03:00:00', gco: [], gcc: [], pmej: [pm([
      ege(F.mjpm, { cat: '340', name: `SERV. M.J.P.M. TUTELLES ${N}`, street: '1 RUE DES TUTELLES' }),
      ege(F.mjpmClosed, { cat: '340', state: 'I', closedAt: '2025-12-31', name: `SERV. M.J.P.M. FERME ${N}`, street: '2 RUE FERMEE' }),
      ege(F.ehpad, { cat: '500', name: `EHPAD NON DEMANDE ${N}`, street: '3 RUE DES AINES' }),
    ])] })));
    fs.writeFileSync(a, zlib.gzipSync(JSON.stringify({ schemaVersion: 'v1', generatedAt: '2026-11-02T03:00:00', pmej: [] })));
    const finessFiles = { structures: { file: s, title: 'finess-structures-journalier-20261102.json.gz', date: '2026-11-02', sha1: 'test' }, activites: { file: a, title: 'a', date: '2026-11-02', sha1: 'test' } };
    const before = (await db.execute(sql`SELECT count(*)::int AS n FROM "Structure"`)).rows[0].n;
    const r = await runVeille({ db, fetchImpl: async () => { throw new TypeError('offline'); }, trigger: 'test', only: ['finess'], finessFiles, texts: false, ignorePause: true, force: true,
      categories: ['340'], limits: { newFiness: 10 } });
    runId = r.runId;
    const rows = (await db.execute(sql`SELECT numero_finess, type_structure, statut, telephone FROM "Structure" WHERE numero_finess IN ${list(Object.values(F))}`)).rows;
    expect(rows.map((x) => x.numero_finess)).toEqual([F.mjpm]);
    expect(rows[0]).toMatchObject({ statut: 'actif', type_structure: 'Service mandataire judiciaire à la protection des majeurs', telephone: '03 88 00 00 01' });   // the register's number, formatted as every directory number
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "Structure"`)).rows[0].n).toBe(before + 1);
  });
});
