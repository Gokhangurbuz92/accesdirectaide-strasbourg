/**
 * R36 — the bounded FINESS activity import (scripts/lib/finess-activities.mjs, scripts/finess-activities-import.mjs) on REAL PostgreSQL with synthetic FINESS+
 * files in the official JSON shape: activities added to a published record and only there, a second run changes nothing, a changed or vanished activity
 * replaces what the import wrote, a person's services, a suspended / archived / held record and an establishment absent from the register are left as they
 * are, an ambiguous register entry is rejected, a record changed after the dry-run is skipped, a database error stops the run with what was committed, the
 * other fields never change, and the command refuses a tampered cached file or an invalid backup. Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const N = String(Date.now()).slice(-6);
const K = ['add', 'again', 'changed', 'gone', 'none', 'person', 'suspended', 'archived', 'held', 'ambiguous', 'absent', 'race', 'boom'];
const F = Object.fromEntries(K.map((k, i) => [k, `67${String.fromCharCode(65 + i)}${N}`]));
const id = (k) => `r36fa-${k}-${N}`;
const SRC = (num) => `https://finess.esante.gouv.fr/fininter/jsp/actionDetailEtablissement.do?noFinesset=${num}`;

const ege = (num, { cp = '67000', insee = '67482' } = {}) => ({ informationsGeneralesEGE: { egeId: `e${num}`, dateFermeture: null, dateOuverture: '2001-01-01', nomEgeCourt: `FOYER ${num}`, nomEgeLong: `FOYER ${num}`, numFinessEge: num, siret: null },
  categorieentiteGeographiqueExercice: '500', adresse: [{ usageAdresse: '03', cogCommune: insee, ligneAcheminement: 'STRASBOURG', ligneQuatre: '1 RUE DU REGISTRE', codePostal: cp }], contact: [], engagement: [], evenement: [], roleEge: [], etatObjet: 'A', dateDerniereMaj: '2026-10-01 00:00:00' });
const act = (activity, mode = '11', public_ = '700', state = 'A', nature = 'AMSR') => ({ caracteristiquesGeneriques: { etatObjet: state },
  nature: { codeNature: nature, caracteristiquesSpecifiques: { [nature === 'AMSR' ? 'typeActiviteAMSR' : 'typeActiviteASOCR']: { activiteSocialeRegulee: activity, modeFonctionnement: mode, public: public_ } } } });
const actEge = (num, acts) => ({ numFinessEge: num, activitesExercees: acts });

describe.skipIf(!hasDatabase)('R36 bounded FINESS activity import (real DB, synthetic register files)', () => {
  let db; let lib; let recordVerification; let snapshotRow; let readFiness; let dir; let src; let register; let activities;
  const rec = async (k) => (await db.execute(sql`SELECT nom, adresse, code_postal, ville, telephone, email, horaires, statut, verification_status, launch_eligible, publication_hold, services, "updatedBy" AS by FROM "Structure" WHERE id = ${id(k)}`)).rows[0];
  const mine = async () => (await lib.finessRows(db)).filter((r) => r.id.endsWith(`-${N}`));
  const plan = async () => lib.planImport({ rows: await mine(), register, activities });
  const kinds = (p) => Object.fromEntries(Object.entries(p).flatMap(([k, xs]) => xs.map((x) => [x.id.split('-')[1], k])));
  const write = (name, json) => { const f = path.join(dir, name); fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(json))); return f; };
  const files = (acts, date = new Date().toISOString().slice(0, 10)) => {
    const regs = K.filter((k) => k !== 'absent').map((k) => ege(F[k]));
    const s = write('finess-structures.json.gz', { schemaVersion: 'v1', pmej: [{ informationsGeneralesPMEJ: { numFinessPm: `67P${N}` }, ege: regs }] });
    const a = write('finess-activites.json.gz', { schemaVersion: 'v1', pmej: [{ ege: acts }] });
    const meta = (f, title) => { const sha1 = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'); fs.writeFileSync(`${f}.json`, JSON.stringify({ title, sha1, date })); return { file: f, title, sha1, date }; };
    return { structures: meta(s, `finess-structures-journalier-${date.replace(/-/g, '')}.json.gz`), activites: meta(a, `finess-activites-journalier-${date.replace(/-/g, '')}.json.gz`) };
  };
  const load = async (acts) => { src = files(acts); register = (await readFiness({ structures: src.structures.file })).byFiness; activities = await lib.readActivities(src.activites.file); };
  const apply = (p) => lib.applyPlan({ db, plan: p, source: src, recordVerification, snapshotRow });
  const insert = async (k, { statut = 'actif', verification = 'VERIFIED', hold = null, services = [], by = 'ada-veille-automatique' } = {}) => db.execute(sql`INSERT INTO "Structure"
    (id, nom, slug, adresse, code_postal, ville, departement, telephone, email, horaires, numero_finess, source_url, source_url_exact, services, publics_accueillis, categories_aidees, statut, verification_status, launch_eligible, territory_verified, data_origin, verified_by, date_verification, publication_hold, "updatedBy", "updatedAt", "createdAt")
    VALUES (${id(k)}, ${`Foyer ${k} ${N}`}, ${id(k)}, '1 rue du Registre', '67000', 'Strasbourg', '67', '03 88 00 00 00', 'accueil@foyer.example', 'Lundi : 9:00-12:00', ${F[k]}, ${SRC(F[k])}, ${SRC(F[k])},
      ${arr(services)}, ARRAY[]::text[], ARRAY['Hébergement'], ${statut}, ${verification}, ${verification === 'VERIFIED'}, true, 'official', 'ada-veille-automatique', NOW(), ${hold}, ${by}, NOW(), NOW())`);

  const arr = (xs) => (xs.length ? sql`ARRAY[${sql.join(xs.map((x) => sql`${x}`), sql`, `)}]::text[]` : sql`ARRAY[]::text[]`);
  // labels of the official terminology (TRE-R401 activity 924 « Accueil pour Personnes Âgées »… whatever the shipped terms say): read back, not hard-coded
  let L1; let L2;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-r36-finess-'));
    ({ db } = await import('../../src/db/index.js'));
    lib = await import('../../scripts/lib/finess-activities.mjs');
    ({ recordVerification } = await import('../../api/_services/content-verification.js'));
    ({ snapshotRow } = await import('../../api/_services/content-versions.js'));
    ({ readFiness } = await import('../../api/_services/verification/finess.js'));
    const { activityServices } = await import('../../api/_services/verification/finess.js');
    [L1] = activityServices(actEge('x', [act('924')])); [L2] = activityServices(actEge('x', [act('925', '13')]));
    expect(L1).toBeTruthy(); expect(L2).toBeTruthy(); expect(L1).not.toBe(L2);
    for (const k of ['add', 'again', 'none', 'race', 'boom', 'ambiguous', 'absent']) await insert(k);
    await insert('changed', { services: [L1] }); await insert('gone', { services: [L1] });
    await insert('person', { services: ['Accueil de jour décrit par la structure'], by: 'admin@ada.example' });
    await insert('suspended', { statut: 'suspendu' }); await insert('archived', { statut: 'archive' }); await insert('held', { hold: 'Contrôle en cours' });
    await load([actEge(F.add, [act('924')]), actEge(F.again, [act('924')]), actEge(F.changed, [act('925', '13')]), actEge(F.gone, [act('924', '11', '700', 'F')]),
      actEge(F.person, [act('924')]), actEge(F.suspended, [act('924')]), actEge(F.archived, [act('924')]), actEge(F.held, [act('924')]),
      actEge(F.ambiguous, [act('924')]), actEge(F.ambiguous, [act('925', '13')]), actEge(F.absent, [act('924')]), actEge(F.race, [act('924')]), actEge(F.boom, [act('924')]),
      actEge(F.none, [act('924', '11', '801')])]);   // a judge's placement only: not a service a person asks for (finess.js)
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DROP TRIGGER IF EXISTS r36fa_boom ON "Structure"`); await db.execute(sql`DROP FUNCTION IF EXISTS r36fa_boom()`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${`r36fa-%-${N}`}`);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('plans per record: adds, updates, removes only what the import or the veille wrote; leaves held, a person\'s services and unsafe matches alone', async () => {
    const p = await plan();
    expect(kinds(p)).toEqual({ add: 'add', again: 'add', race: 'add', boom: 'add', changed: 'update', gone: 'remove', none: 'noActivity', person: 'conflict',
      suspended: 'held', archived: 'held', held: 'held', ambiguous: 'rejected', absent: 'rejected' });
    const reason = (k) => Object.values(p).flat().find((x) => x.id === id(k)).reason;
    expect([reason('suspended'), reason('archived'), reason('held'), reason('ambiguous'), reason('absent'), reason('person')])
      .toEqual(['STATUT_SUSPENDU', 'STATUT_ARCHIVE', 'PUBLICATION_HOLD', 'AMBIGUOUS_REGISTER_ENTRY', 'NOT_IN_REGISTER', 'SERVICES_WRITTEN_BY_A_PERSON']);
    expect(p.add.find((x) => x.id === id('add')).after).toEqual([L1]);
    // the fingerprint follows the register files and the database state
    const again = await plan();
    expect(lib.fingerprint(src, again)).toBe(lib.fingerprint(src, p));
    expect(lib.fingerprint({ ...src, activites: { ...src.activites, sha1: 'other' } }, p)).not.toBe(lib.fingerprint(src, p));
  });

  it('a database error stops the run: what was committed is listed, the failing record and the rest are untouched', async () => {
    await db.execute(sql.raw(`CREATE FUNCTION r36fa_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${id('boom')}' AND NEW.services <> OLD.services THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END; $$`));
    await db.execute(sql`CREATE TRIGGER r36fa_boom BEFORE UPDATE ON "Structure" FOR EACH ROW EXECUTE FUNCTION r36fa_boom()`);
    const p = await plan();
    const only = { add: p.add.filter((x) => [id('add'), id('boom'), id('again')].includes(x.id)).sort((a, b) => (a.id === id('boom') ? 1 : b.id === id('boom') ? -1 : 0)), update: [], remove: [] };
    const r = await apply(only);
    expect(r.ok).toBe(false);
    expect(r.failure).toMatchObject({ id: id('boom'), kind: 'add' });
    expect(r.done.map((d) => d.id).sort()).toEqual([id('add'), id('again')].sort());
    expect((await rec('boom')).services).toEqual([]);
    const versions = (await db.execute(sql`SELECT count(*)::int AS n FROM "EntityVersion" WHERE entity_id = ${id('boom')}`)).rows[0].n;
    expect(versions).toBe(0);   // the failed record's transaction left nothing behind
    await db.execute(sql`DROP TRIGGER r36fa_boom ON "Structure"`);
  });

  it('applies the rest; a record changed after the dry-run is skipped; unrelated fields never change; the evidence names the file and its SHA-1', async () => {
    const before = Object.fromEntries(await Promise.all(K.map(async (k) => [k, await rec(k)])));
    const p = await plan();
    await db.execute(sql`UPDATE "Structure" SET services = ARRAY['changé entre-temps'] WHERE id = ${id('race')}`);
    const r = await apply(p);
    expect(r.ok).toBe(true);
    expect(r.skipped).toEqual([{ id: id('race'), finess: F.race, reason: 'CHANGED_SINCE_DRY_RUN' }]);
    expect(r.done.map((d) => `${d.kind}:${d.id.split('-')[1]}`).sort()).toEqual(['add:boom', 'remove:gone', 'update:changed']);
    expect((await rec('changed')).services).toEqual([L2]);
    expect((await rec('gone')).services).toEqual([]);
    expect((await rec('boom')).services).toEqual([L1]);
    for (const k of K) {
      const a = before[k]; const b = await rec(k);
      for (const f of ['nom', 'adresse', 'code_postal', 'ville', 'telephone', 'email', 'horaires', 'statut', 'verification_status', 'launch_eligible', 'publication_hold']) expect([k, f, b[f]]).toEqual([k, f, a[f]]);
    }
    for (const k of ['person', 'suspended', 'archived', 'held', 'ambiguous', 'absent', 'none']) expect([k, (await rec(k)).services]).toEqual([k, before[k].services]);
    const [v] = (await db.execute(sql`SELECT "reviewerId" AS by, "evidenceNote" AS note, "sourceUrl" AS url FROM "ContentVerification" WHERE "entityId" = ${id('boom')} ORDER BY "createdAt" DESC LIMIT 1`)).rows;
    expect(v.by).toBe(lib.IMPORTER.id);
    expect(v.url).toBe(SRC(F.boom));
    expect(v.note).toContain(src.activites.sha1); expect(v.note).toContain(L1); expect(v.note).toMatch(/ni les places libres ni l’admission/);
    const [ver] = (await db.execute(sql`SELECT snapshot_json->'services' AS s FROM "EntityVersion" WHERE entity_id = ${id('changed')} AND reason LIKE 'avant import%'`)).rows;
    expect(ver.s).toEqual([L1]);   // the exact prior version is kept (reversible)
  });

  it('a second run changes nothing (idempotent) and the counts read the published state (statut actif)', async () => {
    await db.execute(sql`UPDATE "Structure" SET services = ARRAY[]::text[], "updatedBy" = 'ada-veille-automatique' WHERE id = ${id('race')}`);
    const r1 = await apply(await plan());
    expect(r1.done.map((d) => d.id)).toEqual([id('race')]);
    const p = await plan();
    expect(p.add.length + p.update.length + p.remove.length).toBe(0);
    expect(p.unchanged.map((x) => x.id).sort()).toEqual(['add', 'again', 'boom', 'changed', 'race'].map(id).sort());
    const r2 = await apply(p);
    expect(r2.done).toEqual([]);
    const c = await lib.finessCounts(db);
    const own = (await db.execute(sql`SELECT count(*) FILTER (WHERE statut = 'actif')::int AS published, count(*) FILTER (WHERE statut = 'actif' AND cardinality(services) > 0)::int AS pws FROM "Structure" WHERE id LIKE ${`r36fa-%-${N}`}`)).rows[0];
    expect(own).toEqual({ published: 11, pws: 6 });   // 13 records: suspended and archived are not published (the held one is, under its hold)
    expect(c.published).toBeGreaterThanOrEqual(11);
  });

  it('the command: dry-run reads the cached files, refuses a tampered one, and the apply refuses an invalid backup before touching anything', () => {
    const run = (args) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/finess-activities-import.mjs', ...args], { encoding: 'utf8', env: process.env, timeout: 120000 });
    const planFile = path.join(dir, 'plan.json');
    const ok = run(['--dry-run', '--offline', '--cache-dir', dir, '--out', planFile]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/^BEFORE \{"records":\d+,"with_services":\d+,"published":\d+/m);
    expect(ok.stdout).toMatch(/^FINGERPRINT "[0-9a-f]{64}"$/m);
    const saved = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    expect(saved.plan.unchanged.map((x) => x.id)).toContain(id('add'));
    expect(ok.stdout).not.toMatch(/accueil@foyer|03 88/);   // counts and public labels only
    const badBackup = run(['--apply', '--plan', planFile, '--confirm', saved.fingerprint.slice(0, 12), '--backup', path.join(dir, 'none.dump.enc')]);
    expect(badBackup.status).toBe(4); expect(badBackup.stdout).toMatch(/BACKUP_NOT_VALID/);
    const offlineApply = run(['--apply', '--offline', '--plan', planFile, '--confirm', 'x', '--backup', 'x']);
    expect(offlineApply.status).toBe(2);
    fs.appendFileSync(path.join(dir, 'finess-activites.json.gz'), 'x');
    const tampered = run(['--dry-run', '--offline', '--cache-dir', dir]);
    expect(tampered.status).toBe(4); expect(tampered.stdout).toMatch(/CHECKSUM_MISMATCH/);
  });

  it('a stale register file is reported by the dry-run (the apply refuses it)', async () => {
    const old = files([actEge(F.add, [act('924')])], '2026-01-05');
    expect(old.activites.date).toBe('2026-01-05');
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/finess-activities-import.mjs', '--dry-run', '--offline', '--cache-dir', dir], { encoding: 'utf8', env: process.env, timeout: 120000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/"stale":true/); expect(r.stdout).toMatch(/the apply would refuse them/);
  });
});

describe('planImport (pure)', () => {
  it('rejects a FINESS number held by two records', async () => {
    const lib = await import('../../scripts/lib/finess-activities.mjs');
    const row = (i) => ({ id: `r${i}`, numero_finess: '670000001', statut: 'actif', verification_status: 'VERIFIED', launch_eligible: true, publication_hold: null, services: [], updated_by: null });
    const p = lib.planImport({ rows: [row(1), row(2)], register: new Map([['670000001', { open: true, scope: ['x', 'y'], insee: '67482' }]]), activities: { byFiness: new Map([['670000001', ['A']]]), ambiguous: new Set() } });
    expect(p.rejected.map((x) => x.reason)).toEqual(['DUPLICATE_RECORD', 'DUPLICATE_RECORD']);
    expect(p.add).toEqual([]);
  });
});
