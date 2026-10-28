#!/usr/bin/env node
/**
 * Launch readiness — the STAGING-EQUIVALENT REHEARSAL of the public-content transfer (scripts/content-transfer.mjs), on THIS machine only. It never connects to
 * an external staging or production database: the target is a NEW database it creates on a LOCAL PostgreSQL (loopback address only), migrated from zero like a
 * fresh staging would be, and dropped at the end (--keep keeps it). The source is only READ (one read-only snapshot).
 *
 *   SOURCE_DATABASE_URL=<the LAB> REHEARSAL_ADMIN_URL=postgresql://user@127.0.0.1:<port>/postgres node --import tsx scripts/transfer-rehearsal.mjs --out <new dir> [--keep] [--network]
 *
 * Steps (each one recorded in <out>/rehearsal-report.json and .md — no address, no secret, no content):
 *   1  target created and migrated (drizzle/ journal) — the same migrations as the source, else the import refuses;
 *   2  export: read-only snapshot, hashes per file and per row, no verification state, no staff identity, no secret, no personal e-mail;
 *   3  preview: nothing written;
 *   4  a failure in the middle of an import (a row the target refuses): nothing written at all (one transaction);
 *   5  a conflict (another record of the target with the same key): the apply is refused, nothing written;
 *   6  apply: every row read back equal to the export; nothing verified, nothing public — the records wait for the target's own automatic verification;
 *   7  re-import: nothing inserted (idempotent); a record changed in the target since is never overwritten;
 *   8  the target's own veille (D-5 v2, no person per record): with --network it reads the official sources like a staging would; without, it reads the FINESS
 *      files already in the LAB cache and nothing else — records whose source cannot be read stay unpublished (fail-closed);
 *   9  rollback by receipt: what the import inserted and the target never verified is removed; what the target's veille verified is kept;
 *  10  the source is unchanged (same counts and content hashes before and after).
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { exportContent, readBundle, importContent, rollbackImport, schemaIdentity, TABLES, rowHash } from './content-transfer.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const die = (m) => { console.error(`transfer-rehearsal : ${m}`); process.exit(2); };
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** the admin URL must be a LOCAL PostgreSQL: a rehearsal never touches a remote server @param {string} url */
export function localAdmin(url) {
  let u; try { u = new URL(url); } catch { return null; }
  return /^postgres(ql)?:$/.test(u.protocol) && LOOPBACK.has(u.hostname) ? u : null;
}

async function contentFingerprint(client) {
  const out = {};
  for (const t of Object.keys(TABLES)) {
    const r = (await client.query(`SELECT count(*)::int AS n, coalesce(md5(string_agg(to_jsonb(x)::text, '' ORDER BY id)), '') AS h FROM "${t}" x`)).rows[0];
    out[t] = { rows: r.n, md5: r.h };
  }
  return out;
}
const statusCounts = async (client) => (await client.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE verification_status = 'VERIFIED')::int AS verified,
  count(*) FILTER (WHERE verification_status = 'VERIFIED' AND publication_hold IS NULL AND statut = 'actif')::int AS public FROM "Structure"`)).rows[0];

async function main() {
  const source = process.env.SOURCE_DATABASE_URL || die('SOURCE_DATABASE_URL absente (la base LAB, lue seulement).');
  const admin = localAdmin(process.env.REHEARSAL_ADMIN_URL || '') || die('REHEARSAL_ADMIN_URL doit désigner un PostgreSQL LOCAL (127.0.0.1, localhost ou ::1).');
  const out = arg('out') || die('--out <nouveau répertoire>');
  if (fs.existsSync(out)) die('--out doit être un répertoire nouveau.');
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const name = `ada_staging_rehearsal_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  const target = new URL(admin); target.pathname = `/${name}`;
  const report = { label: 'STAGING-EQUIVALENT LOCAL REHEARSAL (not a staging, not a production import)', startedAt: new Date().toISOString(), target: `${admin.hostname}/${name}`, steps: [] };
  const step = (n, title, ok, detail = {}) => { report.steps.push({ n, title, ok, ...detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}. ${title}${detail.summary ? ` — ${detail.summary}` : ''}`); if (!ok) throw new Error(`étape ${n} : ${title}`); };

  const src = new pg.Client({ connectionString: source }); await src.connect();
  const adm = new pg.Client({ connectionString: admin.toString() }); await adm.connect();
  let tgt = null;
  try {
    const before = await contentFingerprint(src);
    await adm.query(`CREATE DATABASE "${name}"`); await adm.query(`ALTER DATABASE "${name}" SET timezone TO 'UTC'`);
    tgt = new pg.Client({ connectionString: target.toString() }); await tgt.connect();
    await migrate(drizzle(tgt), { migrationsFolder: path.join(ROOT, 'drizzle') });
    const [ss, ts] = [await schemaIdentity(src), await schemaIdentity(tgt)];
    step(1, 'base cible neuve, migrée depuis zéro (mêmes migrations que la source)', ss.migrations === ts.migrations && ss.migrationsSha256 === ts.migrationsSha256, { summary: `${ts.migrations} migrations`, migrations: ts.migrations });

    const bundleDir = path.join(out, 'bundle');
    const exp = await exportContent(src, { outDir: bundleDir, sourceHost: new URL(source).hostname });
    const bundle = readBundle(bundleDir);
    const text = Object.keys(TABLES).map((t) => fs.readFileSync(path.join(bundleDir, `${t}.json`), 'utf8')).join('\n');
    const leaks = { verified: /"verification_status"/.test(text), staff: /"updatedBy"|"falc_reviewed_by"/.test(text), authConfig: /"auth_config"/.test(text) };
    step(2, 'export en lecture seule, empreintes par fichier et par fiche, sans état de vérification, identité de personnel, secret ni courriel nominatif',
      bundle.ok && !leaks.verified && !leaks.staff && !leaks.authConfig, { summary: Object.entries(bundle.manifest?.files || {}).map(([t, f]) => `${t} ${f.rows}`).join(', '), rows: Object.fromEntries(Object.entries(bundle.manifest?.files || {}).map(([t, f]) => [t, f.rows])), withheldPersonalEmails: exp?.withheldPersonalEmails ?? bundle.manifest?.withheldPersonalEmails ?? 0, leaks });

    const preview = await importContent(tgt, { bundle, apply: false, targetEnv: 'rehearsal' });
    const empty = Object.values(await contentFingerprint(tgt)).every((x) => x.rows === 0 || x.rows === undefined);
    step(3, 'aperçu : rien n’est écrit', preview.ok && (await statusCounts(tgt)).n === 0, { summary: Object.entries(preview.receipt.counts).map(([t, c]) => `${t} +${c.inserted}`).join(', '), targetEmptyApartFromSeed: empty });

    // 4. a row the target refuses in the middle (an unknown enum value in the last table): the whole import is rolled back
    const broken = JSON.parse(JSON.stringify(bundle)); const reg = broken.rows.SourceRegistryEntry;
    if (reg?.length) reg[reg.length - 1] = { ...reg[reg.length - 1], type: 'NOT_A_SOURCE_TYPE' };
    let failed = null; try { failed = await importContent(tgt, { bundle: broken, apply: true, targetEnv: 'rehearsal' }); } catch (e) { failed = { ok: false, error: e?.code || 'error' }; }
    step(4, 'échec au milieu d’un import : rien n’est écrit (une seule transaction)', !failed.ok && (await statusCounts(tgt)).n === 0, { summary: `refus ${failed.error || failed.reason || ''}`.trim() });

    // 5. a conflict: another record of the target with the slug of a record of the bundle
    const victim = bundle.rows.Structure.find((r) => r.slug);
    await tgt.query(`INSERT INTO "Structure" (id, nom, slug, services, publics_accueillis, categories_aidees, "updatedAt") VALUES ($1, 'Fiche locale de la cible', $2, '{}', '{}', '{}', NOW())`, [`local-${crypto.randomUUID()}`, victim.slug]);
    const conflict = await importContent(tgt, { bundle, apply: true, targetEnv: 'rehearsal' });
    const afterConflict = (await statusCounts(tgt)).n;
    await tgt.query(`DELETE FROM "Structure" WHERE id LIKE 'local-%'`);
    step(5, 'conflit avec une autre fiche de la cible (même clé) : import refusé, rien n’est écrit', !conflict.ok && afterConflict === 1, { summary: conflict.reason || '' });

    const applied = await importContent(tgt, { bundle, apply: true, targetEnv: 'rehearsal' });
    fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(applied.receipt, null, 1));
    const sc = await statusCounts(tgt);
    step(6, 'import appliqué : chaque fiche relue identique à l’export ; aucune vérifiée, aucune publique', applied.ok && applied.receipt.integrity.ok && sc.verified === 0 && sc.public === 0,
      { summary: `${applied.receipt.integrity.checked} fiches relues identiques ; ${sc.n} structures, ${sc.verified} vérifiées, ${sc.public} publiques`, integrity: applied.receipt.integrity, counts: applied.receipt.counts });

    const again = await importContent(tgt, { bundle, apply: true, targetEnv: 'rehearsal' });
    const inserted = Object.values(again.receipt.counts).reduce((n, c) => n + c.inserted, 0);
    const edited = bundle.rows.Structure[0].id;
    await tgt.query(`UPDATE "Structure" SET telephone = '03 00 00 00 00', "updatedAt" = NOW() + interval '1 minute' WHERE id = $1`, [edited]);
    const third = await importContent(tgt, { bundle, apply: true, targetEnv: 'rehearsal' });
    const kept = (await tgt.query(`SELECT telephone FROM "Structure" WHERE id = $1`, [edited])).rows[0].telephone;
    step(7, 'réimport : rien d’inséré ; une fiche modifiée dans la cible depuis n’est jamais écrasée', again.ok && inserted === 0 && third.receipt.counts.Structure.kept.newerInTarget === 1 && kept === '03 00 00 00 00',
      { summary: `0 insérée ; ${third.receipt.counts.Structure.kept.same} identiques, ${third.receipt.counts.Structure.kept.newerInTarget} plus récente dans la cible gardée` });

    // 8. the target's own veille, in a child process bound to the TARGET database (the application reads DATABASE_URL when it loads)
    const cache = process.env.ADA_VEILLE_CACHE_DIR || '';
    const child = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'scripts', 'transfer-rehearsal-veille.mjs'), process.argv.includes('--network') ? 'network' : 'offline', cache], {
      cwd: ROOT, encoding: 'utf8', timeout: 45 * 60000, env: { PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'UTC', NODE_ENV: 'development', VERCEL_ENV: 'development', ADA_PUBLIC_CONTENT_MODE: 'lab',
        DATABASE_URL: target.toString(), JWT_SECRET: crypto.randomBytes(24).toString('hex'), ADA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'), ADA_VEILLE_CACHE_DIR: cache, ADA_VERIFICATION_MIN_GAP_MS: process.env.ADA_VERIFICATION_MIN_GAP_MS || '' } });
    const vr = (() => { try { return JSON.parse((child.stdout || '').trim().split('\n').pop()); } catch { return null; } })();
    const sv = await statusCounts(tgt);
    const ledger = (await tgt.query(`SELECT "reviewerId", "reviewerRole", count(*)::int AS n FROM "ContentVerification" GROUP BY 1, 2`)).rows;
    step(8, 'veille de la cible (D-5 v2) : publication automatique sur preuve, sans personne par fiche ; ce qui n’a pas pu être vérifié reste non publié', Boolean(vr?.ok) && ledger.every((l) => l.reviewerId === 'ada-veille-automatique' && l.reviewerRole === 'system'),
      { summary: `${sv.public} publiques sur ${sv.n} (${vr?.mode}) ; registre de vérification : ${ledger.map((l) => `${l.n} par ${l.reviewerId}`).join(', ') || 'vide'}`, veille: vr, structures: sv });

    const rb = await rollbackImport(tgt, { receipt: applied.receipt, apply: true });
    const left = await statusCounts(tgt);
    step(9, 'retrait par reçu : ce que l’import a inséré et que la cible n’a pas vérifié est retiré ; ce que sa veille a vérifié est gardé', rb.ok && left.n === left.verified + (rb.counts.Structure.keptChanged || 0),
      { summary: Object.entries(rb.counts).map(([t, c]) => `${t} −${c.removed} (gardées : ${c.keptVerified} vérifiées, ${c.keptChanged} modifiées)`).join(' ; '), counts: rb.counts });

    const after = await contentFingerprint(src);
    step(10, 'la source n’a pas changé (mêmes nombres et empreintes)', JSON.stringify(before) === JSON.stringify(after), { summary: Object.entries(after).map(([t, x]) => `${t} ${x.rows}`).join(', ') });
    report.ok = true;
  } catch (e) {
    report.ok = false; report.error = String(e?.message || e).slice(0, 300);
  } finally {
    report.finishedAt = new Date().toISOString();
    if (tgt) await tgt.end().catch(() => {});
    if (!process.argv.includes('--keep')) { await adm.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {}); report.targetDropped = true; }
    await adm.end().catch(() => {}); await src.end().catch(() => {});
    fs.rmSync(path.join(out, 'bundle'), { recursive: true, force: true });   // the content itself is not kept with the report
    fs.writeFileSync(path.join(out, 'rehearsal-report.json'), JSON.stringify({ ...report, reportSha256: rowHash(report) }, null, 1));
    fs.writeFileSync(path.join(out, 'rehearsal-report.md'), [`# ${report.label}`, '', `Cible : ${report.target} (${report.targetDropped ? 'supprimée à la fin' : 'gardée'}) — ${report.startedAt} → ${report.finishedAt}`, '',
      ...report.steps.map((s) => `- ${s.ok ? 'PASS' : 'FAIL'} ${s.n}. ${s.title}${s.summary ? ` — ${s.summary}` : ''}`), '', report.ok ? '**Toutes les étapes ont réussi.**' : `**Échec : ${report.error}**`, ''].join('\n'));
  }
  process.exit(report.ok ? 0 : 1);
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
