/**
 * Launch readiness — LAB → staging / production content transfer (scripts/content-transfer.mjs) on REAL PostgreSQL, a source database and a FRESH migrated
 * target:
 *  - export: one read-only snapshot of the public-information tables only; no verification state, no staff identity or internal note, no connector credential,
 *    no e-mail naming a person, nothing of the account / journal tables; hashes per file and per row; the source as a hash only;
 *  - import: a dry run unless asked; refuses the source database itself, another schema (same count but other migrations too), a changed file or row, a field
 *    that looks like a secret, a unique-key collision with another record, a dispositif linking a record that exists nowhere; the inserted rows are read back
 *    and compared; they arrive UNVERIFIED and hidden; a receipt and one journal line; a second import keeps everything;
 *  - existing records: one changed in the target since is never overwritten; one newer in the bundle is refreshed through the versioned import and held;
 *  - D-5 v2 on the target: its own automatic veille (doubles of SIRENE / the Annuaire, no network) verifies and publishes the transferred association,
 *    and a second run adds no second decision;
 *  - rollback from the receipt removes exactly the inserted records still unchanged and unverified, and keeps the verified one.
 * Disposable target database (unique name, dropped). Requires DATABASE_URL; skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const P = `ct-${TS}-`;
const TARGET = `ada_ct_target_${TS}`;
const SIRET = '9' + Date.now().toString().slice(-13).padStart(13, '4');
const MARK = `marqueur-personnel-${TS}`;
const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** doubles of the official sources: SIRENE confirms the association open at the record's address; the Annuaire lists nothing; the archive is unavailable */
const sources = () => async (url) => {
  const u = new URL(url);
  if (u.hostname === 'recherche-entreprises.api.gouv.fr') {
    const q = u.searchParams.get('q') || '';
    return Response.json({ results: q.includes(SIRET) || /ENTRAIDE TRANSFERT/i.test(q) ? [{ nom_complet: `ASSOCIATION ENTRAIDE TRANSFERT ${TS}`, etat_administratif: 'A',
      complements: { est_association: true }, nature_juridique: '9220', date_mise_a_jour: '2026-09-01', matching_etablissements: [{ siret: SIRET, etat_administratif: 'A',
        date_fermeture: null, adresse: '12 rue du Transfert 67100 Strasbourg', code_postal: '67100', commune: '67482', libelle_commune: 'STRASBOURG', latitude: '48.57', longitude: '7.75' }] }] : [] });
  }
  if (u.hostname === 'api-lannuaire.service-public.fr') return Response.json({ total_count: 0, results: [] });
  if (u.hostname === 'lecomarquage.service-public.gouv.fr') return new Response('', { status: 503 });
  return new Response('not found', { status: 404 });
};
/** the local model double: answers every prompt with checked, faithful texts */
const model = () => async ({ systemInstruction, prompt }) => {
  if (/contrôleur qualité/.test(systemInstruction)) { const n = (prompt.match(/^\d+\. /gm) || []).length; return { model: 'double', content: { verdicts: Array.from({ length: n }, (_, i) => ({ n: i + 1, ok: true, raison: 'conforme' })) } }; }
  if (/FALC/.test(systemInstruction)) return { model: 'double', content: { resume: ['Cette association vous accueille à Strasbourg.', 'Elle vous aide dans vos démarches.'] } };
  return { model: 'double', content: { resume: 'Cette association accueille et accompagne les habitants de Strasbourg dans leurs démarches.' } };
};

describe.skipIf(!hasDatabase)('content transfer to another database (real PostgreSQL)', () => {
  let ct; let decide; let src; let tgt; let tmp; let dir; let receipt;
  const tgtUrl = () => withDb(process.env.DATABASE_URL, TARGET);
  beforeAll(async () => {
    ct = await import('../../scripts/content-transfer.mjs');
    ({ decide } = await import('../../api/lib/publicVisibility.js'));
    src = new pg.Client({ connectionString: process.env.DATABASE_URL }); await src.connect();
    // the source as the LAB holds it: verified and published records with their check journal, easy-to-read texts, internal notes and staff identities
    await src.query(`INSERT INTO "Aide" (id, slug, titre, statut, data_origin, summary_falc, verification_status, verified_by, date_verification, territory_verified, launch_eligible,
      auto_check, source_url, "updatedBy", falc_reviewed_by, falc_reviewed_at, commentaire_statut, "updatedAt") VALUES ($1, $1, 'Aide transférée (QA)', 'publie', 'official', 'Un texte facile à lire.',
      'VERIFIED', 'ada-veille-automatique', NOW(), true, true, '{"ok": true}', 'https://www.service-public.fr/particuliers/vosdroits/F1', 'owner-${TS}@example.test',
      'owner-${TS}@example.test', NOW(), 'note interne ${MARK}', NOW() - interval '1 hour')`, [`${P}aide`]);
    const st = (id, nom, extra) => src.query(`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis,
      categories_aidees, statut, verification_status, verified_by, date_verification, territory_verified, launch_eligible, data_origin, email, siret, settings_json, "updatedAt", "createdAt")
      VALUES ($1, $2, $1, 'association', '12 rue du Transfert', 'Strasbourg', '67100', false, ARRAY['accueil'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED',
      'ada-veille-automatique', NOW(), true, true, 'official', $3, $4, $5, NOW() - interval '1 hour', NOW() - interval '2 hours')`, [id, nom, extra.email, extra.siret ?? null, JSON.stringify(extra.settings ?? {})]);
    await st(`${P}asso`, `Association Entraide Transfert ${TS}`, { email: 'contact@entraide-transfert.example', siret: SIRET, settings: { rdv: MARK } });
    await st(`${P}str`, `Structure transférée ${TS}`, { email: 'jean.dupont@example.test' });
    await src.query(`INSERT INTO "SourceRegistryEntry" (id, source_id, name, type, auth_config) VALUES ($1, $1, 'Source QA', 'REST_API', $2)`, [`${P}src`, JSON.stringify({ apiKey: `SECRET-${MARK}` })]);
    await src.query(`INSERT INTO "Dispositif" (id, slug, titre, public, statut, related_aide_ids, related_structure_ids, "updatedAt", "createdAt") VALUES ($1, $1, 'Dispositif transféré',
      ARRAY['tout_public'], 'brouillon', ARRAY[$2], ARRAY[$3], NOW(), NOW())`, [`${P}disp`, `${P}aide`, `${P}asso`]);
    // what must never travel: an account, its hash and a journal line, with the same marker
    await src.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, $3, NOW())`, [`${P}user`, `${MARK}@example.test`, `scrypt$${MARK}`]);
    await src.query(`INSERT INTO "AuditLog" (id, action, actor, entity, entity_id, details) VALUES ($1, 'QA_CT', 'qa', 'ct', $2, $3)`, [`${P}audit`, P, JSON.stringify({ m: MARK })]);
    const admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
    try { await admin.query(`CREATE DATABASE "${TARGET}"`); } finally { await admin.end(); }
    tgt = new pg.Client({ connectionString: tgtUrl() }); await tgt.connect();
    for (const e of ['unaccent', 'pg_trgm', 'vector']) await tgt.query(`CREATE EXTENSION IF NOT EXISTS ${e}`);
    await tgt.query(`ALTER DATABASE "${TARGET}" SET timezone TO 'UTC'`);
    const pool = new pg.Pool({ connectionString: tgtUrl() });
    try { await migrate(drizzle(pool), { migrationsFolder: path.resolve('drizzle') }); } finally { await pool.end(); }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-ct-test-')); dir = path.join(tmp, 'bundle');
  }, 180000);
  afterAll(async () => {
    if (tgt) await tgt.end().catch(() => {});
    if (src) {
      await src.query(`DROP DATABASE IF EXISTS "${TARGET}" WITH (FORCE)`).catch(() => {});
      for (const t of ['Aide', 'Structure', 'SourceRegistryEntry', 'Dispositif', 'CitizenUser', 'AuditLog']) await src.query(`DELETE FROM "${t}" WHERE id LIKE $1`, [`${P}%`]).catch(() => {});
      await src.end();
    }
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('exports only public information: no verification state, staff identity, internal note, credential, personal e-mail or account data', async () => {
    const r = await ct.exportContent(src, { outDir: dir, sourceHost: '127.0.0.1', idPrefix: P });
    expect(Object.keys(r.manifest.files).sort()).toEqual(['Aide', 'Demarche', 'Dispositif', 'SourceRegistryEntry', 'Structure']);
    expect(r.manifest.files).toMatchObject({ Aide: { rows: 1 }, Structure: { rows: 2 }, SourceRegistryEntry: { rows: 1 }, Dispositif: { rows: 1 } });
    expect(r.manifest.withheldPersonalEmails).toBe(1);
    // the data files hold no value of what never travels; the manifest names the excluded fields (names only) and holds no value either
    const data = fs.readdirSync(dir).filter((f) => f !== 'MANIFEST.json').map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    for (const leak of [MARK, `owner-${TS}@example.test`, 'jean.dupont', 'passwordHash', 'scrypt$', '127.0.0.1', 'auth_config', 'apiKey', 'ada-veille-automatique']) expect(data).not.toContain(leak);
    const manifest = fs.readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8');
    for (const leak of [MARK, `owner-${TS}@example.test`, 'jean.dupont', '127.0.0.1', 'ada_test']) expect(manifest).not.toContain(leak);
    const aide = JSON.parse(fs.readFileSync(path.join(dir, 'Aide.json'), 'utf8'))[0];
    for (const k of ct.NEVER_COPIED.content) expect(aide).not.toHaveProperty(k);
    expect(aide).toMatchObject({ statut: 'publie', data_origin: 'official', summary_falc: 'Un texte facile à lire.' });
    expect(fs.statSync(path.join(dir, 'Aide.json')).mode & 0o777).toBe(0o600);
    await expect(ct.exportContent(src, { outDir: dir, sourceHost: '127.0.0.1', idPrefix: P })).rejects.toMatchObject({ code: 'OUT_EXISTS' });
  });

  it('refuses a changed file or row, a secret-looking field, the source database itself, an unknown environment; a dry run writes nothing', async () => {
    const copy = (name) => { const c = path.join(tmp, name); fs.cpSync(dir, c, { recursive: true }); return c; };
    const c1 = copy('changed'); const p1 = path.join(c1, 'Aide.json'); fs.writeFileSync(p1, fs.readFileSync(p1, 'utf8').replace('Aide transférée', 'Aide modifiée'));
    expect(ct.readBundle(c1)).toMatchObject({ ok: false, reason: expect.stringContaining('a changé depuis l’export') });
    // a row edited and its file digest recomputed: the row digest still refuses it
    const c2 = copy('row'); const p2 = path.join(c2, 'Aide.json'); const body = fs.readFileSync(p2, 'utf8').replace('Aide transférée', 'Aide modifiée'); fs.writeFileSync(p2, body);
    const m2 = JSON.parse(fs.readFileSync(path.join(c2, 'MANIFEST.json'), 'utf8')); m2.files.Aide.sha256 = sha(body); fs.writeFileSync(path.join(c2, 'MANIFEST.json'), JSON.stringify(m2));
    expect(ct.readBundle(c2)).toMatchObject({ ok: false, reason: expect.stringContaining('empreinte') });
    const bundle = ct.readBundle(dir); expect(bundle.ok).toBe(true);
    expect(await ct.importContent(src, { bundle, apply: true, targetEnv: 'rehearsal' })).toMatchObject({ ok: false, reason: expect.stringContaining('la base source elle-même') });
    expect(await ct.importContent(tgt, { bundle, apply: true, targetEnv: 'prod' })).toMatchObject({ ok: false });
    const r = await ct.importContent(tgt, { bundle, targetEnv: 'rehearsal' });
    expect(r).toMatchObject({ ok: true, blocked: null, receipt: { applied: false, conflicts: [], dangling: [], integrity: { ok: true, checked: 5 } } });
    expect(r.receipt.counts.Structure).toEqual({ inserted: 2, kept: { same: 0, newerInTarget: 0, newerInBundle: 0 } });
    expect((await tgt.query(`SELECT count(*)::int n FROM "Structure" WHERE id LIKE $1`, [`${P}%`])).rows[0].n).toBe(0);
    expect((await tgt.query(`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'CONTENT_TRANSFER_IMPORT'`)).rows[0].n).toBe(0);
  });

  it('imports the records unverified and hidden, reads them back, writes a receipt and one journal line; a second import keeps everything', async () => {
    const bundle = ct.readBundle(dir);
    const r = await ct.importContent(tgt, { bundle, apply: true, targetEnv: 'rehearsal' });
    expect(r).toMatchObject({ ok: true, receipt: { applied: true, targetEnv: 'rehearsal', integrity: { ok: true, checked: 5 } } });
    receipt = r.receipt;
    expect(Object.keys(receipt.inserted.Structure).sort()).toEqual([`${P}asso`, `${P}str`]);
    expect(JSON.stringify(receipt)).not.toContain('Aide transférée');
    for (const id of [`${P}aide`]) {
      const a = (await tgt.query(`SELECT * FROM "Aide" WHERE id = $1`, [id])).rows[0];
      expect(a).toMatchObject({ statut: 'publie', verification_status: 'UNVERIFIED', verified_by: null, date_verification: null, launch_eligible: false, territory_verified: false,
        publication_hold: null, auto_check: null, updatedBy: null, falc_reviewed_by: null, commentaire_statut: null });
      expect(decide(a, 'aide', { mode: 'strict' }).visible).toBe(false);
    }
    const str = (await tgt.query(`SELECT * FROM "Structure" WHERE id = $1`, [`${P}str`])).rows[0];
    expect(str.email).toBeNull(); expect(str.services).toEqual(['accueil']); expect(decide(str, 'structure', { mode: 'strict' }).visible).toBe(false);
    expect((await tgt.query(`SELECT settings_json FROM "Structure" WHERE id = $1`, [`${P}asso`])).rows[0].settings_json).toEqual({});
    expect((await tgt.query(`SELECT auth_config FROM "SourceRegistryEntry" WHERE id = $1`, [`${P}src`])).rows[0].auth_config).toBeNull();
    expect((await tgt.query(`SELECT count(*)::int n FROM "CitizenUser"`)).rows[0].n).toBe(0);
    const audit = (await tgt.query(`SELECT actor, entity_id, details FROM "AuditLog" WHERE action = 'CONTENT_TRANSFER_IMPORT'`)).rows;
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ actor: 'content-transfer-cli', entity_id: receipt.receiptId, details: { targetEnv: 'rehearsal', manifestSha256: bundle.manifestSha256 } });
    const again = await ct.importContent(tgt, { bundle, apply: true, targetEnv: 'rehearsal' });
    expect(again.receipt.counts).toMatchObject({ Aide: { inserted: 0, kept: { same: 1 } }, Structure: { inserted: 0, kept: { same: 2 } }, SourceRegistryEntry: { inserted: 0, kept: { same: 1 } },
      Dispositif: { inserted: 0, kept: { same: 1 } } });
  });

  it('existing records: one changed in the target since is never overwritten; one newer in the bundle is refreshed through the versioned import and held', async () => {
    // the target's veille verified the aide; in the LAB its easy-to-read text was written again
    await tgt.query(`UPDATE "Aide" SET verification_status = 'VERIFIED', verified_by = 'ada-veille-automatique', date_verification = NOW(), territory_verified = true,
      launch_eligible = true WHERE id = $1`, [`${P}aide`]);
    await src.query(`UPDATE "Aide" SET summary_falc = 'Un nouveau texte facile à lire.', "updatedAt" = NOW() WHERE id = $1`, [`${P}aide`]);
    // and in the target, someone changed the plain structure after the transfer
    await tgt.query(`UPDATE "Structure" SET horaires = 'Lundi 9h-12h (cible)', "updatedAt" = NOW() + interval '1 minute' WHERE id = $1`, [`${P}str`]);
    await src.query(`UPDATE "Structure" SET horaires = 'Mardi 9h-12h (LAB)', "updatedAt" = NOW() WHERE id = $1`, [`${P}str`]);
    const dir2 = path.join(tmp, 'bundle2'); await ct.exportContent(src, { outDir: dir2, sourceHost: '127.0.0.1', idPrefix: P });
    const bundle = ct.readBundle(dir2); expect(bundle.ok).toBe(true);
    const preview = await ct.importContent(tgt, { bundle, targetEnv: 'rehearsal' });
    expect(preview.receipt.counts.Aide.kept).toEqual({ same: 0, newerInTarget: 0, newerInBundle: 1 });
    expect(preview.receipt.counts.Structure.kept).toEqual({ same: 1, newerInTarget: 1, newerInBundle: 0 });
    expect(preview.refreshable).toMatchObject({ Aide: [`${P}aide`], Structure: [] });
    const { applySourceUpdate } = await import('../../api/_services/source-updates.js');
    const schema = await import('../../src/db/schema.js'); const { getTableColumns } = await import('drizzle-orm');
    const pool = new pg.Pool({ connectionString: tgtUrl(), max: 2 });
    try {
      const counts = await ct.updateExisting(tgt, { bundle, db: drizzle(pool), applySourceUpdate, tables: schema, getTableColumns });
      expect(counts.Aide).toEqual({ updated: 1, held: 1, unchanged: 0, newerInTarget: 0, absent: 0, failed: 0 });
      expect(counts.Structure).toEqual({ updated: 0, held: 0, unchanged: 1, newerInTarget: 1, absent: 0, failed: 0 });
    } finally { await pool.end(); }
    expect((await tgt.query(`SELECT horaires FROM "Structure" WHERE id = $1`, [`${P}str`])).rows[0].horaires).toBe('Lundi 9h-12h (cible)');
    const aide = (await tgt.query(`SELECT * FROM "Aide" WHERE id = $1`, [`${P}aide`])).rows[0];
    expect(aide).toMatchObject({ statut: 'publie', summary_falc: 'Un nouveau texte facile à lire.', verification_status: 'VERIFIED' });
    expect(aide.publication_hold).toMatch(/^Contenu mis à jour par l’import \(summary_falc\)/);
    expect(decide(aide, 'aide', { mode: 'strict' }).visible).toBe(false);
    // the prior row is kept (restorable), then the ledger keeps the row it holds, as for every import
    expect((await tgt.query(`SELECT reason, snapshot_json->>'summary_falc' AS t FROM "EntityVersion" WHERE entity_id = $1 ORDER BY reason`, [`${P}aide`])).rows).toEqual([
      { reason: 'before HOLD', t: 'Un nouveau texte facile à lire.' }, { reason: 'before import lab-transfer (summary_falc)', t: 'Un texte facile à lire.' }]);
    expect((await tgt.query(`SELECT outcome, "reviewerId", "reviewerRole" FROM "ContentVerification" WHERE "entityId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [`${P}aide`])).rows[0])
      .toEqual({ outcome: 'HOLD', reviewerId: 'import:lab-transfer', reviewerRole: 'system' });
  });

  it('D-5 v2 on the target: its own veille verifies and publishes the transferred association from the official source; a second run decides nothing new', async () => {
    process.env.ADA_VERIFICATION_MIN_GAP_MS = '0';
    const { runVeille } = await import('../../api/_services/verification/chain.js');
    const schema = await import('../../src/db/schema.js');
    const pool = new pg.Pool({ connectionString: tgtUrl(), max: 3 });
    const verified = async () => (await tgt.query(`SELECT count(*)::int n FROM "ContentVerification" WHERE "entityId" = $1 AND outcome = 'VERIFIED'`, [`${P}asso`])).rows[0].n;
    try {
      const db = drizzle(pool, { schema });
      const opts = { db, fetchImpl: sources(), generate: model(), trigger: 'test', root: process.cwd(), select: (kind, row) => row.id === `${P}asso`, only: ['structure'], limits: { newOffices: 0, newFiches: 0 } };
      const r1 = await runVeille(opts); expect(r1.ok).toBe(true);
      const s = (await tgt.query(`SELECT * FROM "Structure" WHERE id = $1`, [`${P}asso`])).rows[0];
      expect(s).toMatchObject({ statut: 'actif', verification_status: 'VERIFIED', verified_by: 'ada-veille-automatique' });
      expect(s.source_url).toBe(`https://annuaire-entreprises.data.gouv.fr/etablissement/${SIRET}`);
      expect(decide(s, 'structure', { mode: 'strict' }).visible).toBe(true);
      const ledger = (await tgt.query(`SELECT "reviewerId", "reviewerRole" FROM "ContentVerification" WHERE "entityId" = $1 AND outcome = 'VERIFIED'`, [`${P}asso`])).rows;
      expect(ledger).toEqual([{ reviewerId: 'ada-veille-automatique', reviewerRole: 'system' }]);   // the system, never a person
      const r2 = await runVeille(opts); expect(r2.ok).toBe(true);
      expect(await verified()).toBe(1);
    } finally { await pool.end(); }
  }, 120000);

  it('rollback from the receipt removes the inserted records still unchanged and unverified, and keeps the verified or changed ones', async () => {
    const dry = await ct.rollbackImport(tgt, { receipt });
    expect(dry).toMatchObject({ ok: true, applied: false });
    expect((await tgt.query(`SELECT count(*)::int n FROM "Dispositif" WHERE id = $1`, [`${P}disp`])).rows[0].n).toBe(1);
    const r = await ct.rollbackImport(tgt, { receipt, apply: true });
    expect(r.counts).toMatchObject({ Aide: { removed: 0, keptVerified: 1 }, Structure: { removed: 0, keptVerified: 1, keptChanged: 1 }, Dispositif: { removed: 1 }, SourceRegistryEntry: { removed: 1 } });
    expect((await tgt.query(`SELECT id FROM "Structure" WHERE id LIKE $1 ORDER BY id`, [`${P}%`])).rows.map((x) => x.id)).toEqual([`${P}asso`, `${P}str`]);
    expect((await tgt.query(`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'CONTENT_TRANSFER_ROLLBACK'`)).rows[0].n).toBe(1);
    expect(await ct.rollbackImport(src, { receipt, apply: true })).toMatchObject({ ok: false, reason: expect.stringContaining('autre base') });
  });

  it('refuses a unique-key collision, a dangling dispositif link, and a target whose migrations differ (even with the same count)', async () => {
    await tgt.query(`INSERT INTO "Dispositif" (id, slug, titre, public, "updatedAt", "createdAt") VALUES ($1, $2, 'Autre dispositif de la cible', ARRAY['tout_public'], NOW(), NOW())`, [`${P}other`, `${P}disp`]);
    const bundle = ct.readBundle(dir);
    expect(await ct.importContent(tgt, { bundle, apply: true, targetEnv: 'rehearsal' })).toMatchObject({ ok: false, reason: expect.stringContaining('en conflit'),
      receipt: { conflicts: [{ table: 'Dispositif', id: `${P}disp`, constraint: 'Dispositif_slug_unique' }] } });
    await tgt.query(`DELETE FROM "Dispositif" WHERE id = $1`, [`${P}other`]);
    await src.query(`UPDATE "Dispositif" SET related_structure_ids = ARRAY[$2] WHERE id = $1`, [`${P}disp`, `${P}nowhere`]);
    const dir3 = path.join(tmp, 'bundle3'); await ct.exportContent(src, { outDir: dir3, sourceHost: '127.0.0.1', idPrefix: P });
    expect(await ct.importContent(tgt, { bundle: ct.readBundle(dir3), apply: true, targetEnv: 'rehearsal' })).toMatchObject({ ok: false, reason: expect.stringContaining('introuvable'),
      receipt: { dangling: [{ id: `${P}disp`, kind: 'related_structure_ids', missing: `${P}nowhere` }] } });
    await tgt.query(`UPDATE drizzle.__drizzle_migrations SET hash = 'qa-other' WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)`);
    expect(await ct.importContent(tgt, { bundle, apply: true, targetEnv: 'rehearsal' })).toMatchObject({ ok: false, reason: expect.stringContaining('pas les mêmes') });
  });

  it('the command line names the target to confirm and never prints the connection string', () => {
    const url = tgtUrl();
    const r = spawnSync(process.execPath, ['scripts/content-transfer.mjs', 'import', '--from', dir, '--confirm-target', 'autre-hote/autre-base', '--target-env', 'rehearsal', '--apply'],
      { encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH, HOME: process.env.HOME, TARGET_DATABASE_URL: url } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`--confirm-target ${ct.targetName(url)}`);
    expect(`${r.stdout}${r.stderr}`).not.toContain(url);
  });
});
