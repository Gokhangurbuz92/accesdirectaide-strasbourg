#!/usr/bin/env node
/**
 * Launch readiness — moving the public information prepared in the LAB (official records, easy-to-read texts written by the local model, the source registry)
 * to another database: a rehearsal on a throwaway copy, then staging, then production (each import is the owner's decision). Fail-closed by construction:
 *
 *   export   DATABASE_URL=<source> node scripts/content-transfer.mjs export --out <new directory>
 *   preview  TARGET_DATABASE_URL=<target> node scripts/content-transfer.mjs import --from <dir> --confirm-target <host>/<db> --target-env rehearsal|staging|production
 *   import   … the same with --apply (and --update-existing, with node --import tsx, to refresh records the target already has)
 *   rollback TARGET_DATABASE_URL=<target> node scripts/content-transfer.mjs rollback --receipt <receipt.json> --confirm-target <host>/<db> [--apply]
 *
 * What travels — and what never does:
 *  - only the public-information tables (Aide, Demarche, Structure, Dispositif) and the source registry (SourceRegistryEntry); the list is fixed here. No account,
 *    credential, appointment, dossier, document, message, case note, consent, journal, decision or history table, no verification ledger;
 *  - inside those rows, never: the verification state (verification columns, hold, check journal), embeddings, the staff identities and internal notes
 *    (updatedBy, FALC reviewer, per-field reviews, internal status comment), a structure's professional settings, a registry entry's connector credentials
 *    (auth_config); an e-mail address that names a person (prénom.nom@…, the chain's own rule) is withheld and counted;
 *  - a bundle whose row carries any of them, or a key that looks like a secret, is refused.
 * D-5 v2: a record arrives UNVERIFIED and is not public in the target until the target's own automatic veille has checked it against the official source;
 * `statut` and `data_origin` travel (what the record is, where it comes from), never a « verified » state, never a human reviewer.
 *
 * Checks: the export is one read-only, repeatable-read transaction (one consistent snapshot); the bundle carries a SHA-256 per file and per row and the
 * source's identity (hashes only); the import refuses the source database itself, another schema (migration count AND the hash of the applied migrations),
 * a changed file or row, a missing identifier or required field, a duplicate, a unique-key collision with ANOTHER record of the target (slug, SIRET, FINESS,
 * RNA, external id, source), a dispositif linking a record that exists nowhere; after the inserts, every inserted row is read back and its hash compared
 * (any difference: nothing is written). Records the target already has are kept (their state is reported: same, newer in the target, newer in the bundle);
 * --update-existing refreshes the « newer in the bundle » ones through the versioned import path, never one the target changed since.
 * --apply is one transaction for the inserts, then one per refreshed record (a rerun resumes: unchanged records are skipped). Every import writes a receipt
 * (ids and hashes only, no connection string, no content) and one AuditLog line; `rollback` removes exactly the inserted records that are still unchanged and
 * never verified in the target, and keeps the others (a refreshed record is restored from its EntityVersion, see docs/runbooks.md § 7).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { connectionOptions, databaseHost } from './admin-bootstrap.mjs';
import { nominativeEmail } from '../api/_services/verification/contacts.js';

export const FORMAT = 'ada-content-transfer/2';
export const RECEIPT_FORMAT = 'ada-content-transfer-receipt/1';
/** table -> what it is (documentation of the allowlist) */
export const TABLES = { Aide: 'aides', Demarche: 'démarches', Structure: 'structures et lieux d’accueil', Dispositif: 'dispositifs', SourceRegistryEntry: 'registre des sources (D-5 v2)' };
export const CONTENT = ['Aide', 'Demarche', 'Structure', 'Dispositif'];
/** the target verifies by itself: never copied */
export const LEFT_EMPTY = ['verification_status', 'verified_by', 'date_verification', 'territory_verified', 'launch_eligible', 'publication_hold', 'auto_check', 'last_checked',
  'last_checked_at', 'embedding', 'embedding_model'];
/** staff identities, internal notes, professional settings, connector credentials: never copied either */
export const NEVER_COPIED = { content: [...LEFT_EMPTY, 'updatedBy', 'falc_reviewed_by', 'falc_reviewed_at', 'falc_field_reviews', 'commentaire_statut', 'is_pro_enabled', 'settings_json',
  'embedded_text_sha256', 'embedded_at'], SourceRegistryEntry: ['auth_config'] };
const excluded = (/** @type {string} */ table) => (CONTENT.includes(table) ? NEVER_COPIED.content : NEVER_COPIED.SourceRegistryEntry);
const REQUIRED = { Aide: ['titre'], Demarche: ['titre'], Dispositif: ['titre', 'public'], Structure: ['nom', 'services', 'publics_accueillis', 'categories_aidees'], SourceRegistryEntry: ['source_id', 'name', 'type'] };
/** a key that looks like a credential never belongs to public information */
export const SECRET_KEY = /pass(word|wd)?|secret|totp|mfa|otp|token|api_?key|private_?key|auth_config|credential/i;
const TARGET_ENVS = ['rehearsal', 'staging', 'production'];

const sha256 = (/** @type {string | Buffer} */ b) => crypto.createHash('sha256').update(b).digest('hex');
/** @param {any} v @returns {any} */
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
/** the hash of one row, independent of key order @param {Record<string, any>} row */
export const rowHash = (row) => sha256(JSON.stringify(sorted(row)));
const fileOf = (/** @type {string} */ table) => `${table}.json`;
const quote = (/** @type {string} */ k) => `"${k.replace(/"/g, '""')}"`;

/** Which database this is, as a hash (the cluster's system identifier and the database name; never the address). @param {pg.Client} client */
export async function databaseIdentity(client) {
  const db = (await client.query('SELECT current_database() AS d')).rows[0].d;
  let sys = '';
  try { sys = (await client.query('SELECT system_identifier::text AS s FROM pg_control_system()')).rows[0].s; } catch { sys = 'unknown'; }
  return sha256(`${sys}/${db}`);
}
/** The applied migrations: their number and the hash of their ordered hashes (the bundle and the target must agree). @param {pg.Client} client */
export async function schemaIdentity(client) {
  const r = (await client.query(`SELECT count(*)::int AS n, coalesce(string_agg(hash, ',' ORDER BY created_at, id), '') AS h FROM drizzle.__drizzle_migrations`)).rows[0];
  return { migrations: r.n, migrationsSha256: sha256(r.h) };
}

/**
 * Reads the tables of the allowlist into a NEW directory, in one read-only snapshot. idPrefix: tests restrict the export to their own rows.
 * @param {pg.Client} client @param {{ outDir: string, sourceHost: string, idPrefix?: string, now?: Date }} opts
 */
export async function exportContent(client, { outDir, sourceHost, idPrefix = '', now = new Date() }) {
  const out = path.resolve(outDir);
  if (fs.existsSync(out)) throw Object.assign(new Error('le dossier de sortie existe déjà : choisissez un nouveau dossier'), { code: 'OUT_EXISTS' });
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const identity = await databaseIdentity(client); const schema = await schemaIdentity(client);
    /** @type {Record<string, { file: string, rows: number, sha256: string, rowHashes: Record<string, string> }>} */ const files = {};
    /** @type {Record<string, any[]>} */ const all = {};
    let withheldEmails = 0;
    for (const table of Object.keys(TABLES)) {
      const rows = (await client.query(`SELECT to_jsonb(t) - $1::text[] AS r FROM ${quote(table)} t WHERE t.id LIKE $2 ORDER BY t.id`, [excluded(table), `${idPrefix}%`])).rows.map((x) => x.r);
      for (const r of rows) if (table === 'Structure' && r.email && nominativeEmail(r.email)) { r.email = null; withheldEmails += 1; }
      all[table] = rows;
    }
    await client.query('COMMIT');
    fs.mkdirSync(out, { recursive: true, mode: 0o700 });
    for (const [table, rows] of Object.entries(all)) {
      const body = JSON.stringify(rows);
      fs.writeFileSync(path.join(out, fileOf(table)), body, { mode: 0o600 });
      files[table] = { file: fileOf(table), rows: rows.length, sha256: sha256(body), rowHashes: Object.fromEntries(rows.map((r) => [r.id, rowHash(r)])) };
    }
    const manifest = { format: FORMAT, exportedAt: now.toISOString(), source: { identitySha256: identity, hostSha256: sha256(sourceHost) }, schema,
      neverCopied: NEVER_COPIED, withheldPersonalEmails: withheldEmails, files };
    fs.writeFileSync(path.join(out, 'MANIFEST.json'), JSON.stringify(manifest, null, 1), { mode: 0o600 });
    return { manifest, manifestSha256: sha256(fs.readFileSync(path.join(out, 'MANIFEST.json'))) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

/**
 * Checks a bundle before anything is read into a database: format, allowlist, every file's and row's digest, identifiers, required fields, no copied state.
 * @param {string} dir @returns {{ ok: true, manifest: any, manifestSha256: string, rows: Record<string, any[]> } | { ok: false, reason: string }}
 */
export function readBundle(dir) {
  const d = path.resolve(dir); const mp = path.join(d, 'MANIFEST.json');
  if (!fs.existsSync(mp)) return { ok: false, reason: 'MANIFEST.json introuvable.' };
  let manifest; try { manifest = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch { return { ok: false, reason: 'MANIFEST.json illisible.' }; }
  if (manifest?.format !== FORMAT) return { ok: false, reason: `format inconnu (${manifest?.format}).` };
  if (!manifest.source?.identitySha256 || !manifest.schema?.migrationsSha256) return { ok: false, reason: 'manifeste incomplet (identité de la source ou du schéma).' };
  const listed = Object.keys(manifest.files || {});
  if ([...listed].sort().join() !== Object.keys(TABLES).sort().join()) return { ok: false, reason: `tables inattendues : ${listed.join(', ')}.` };
  /** @type {Record<string, any[]>} */ const rows = {};
  for (const [table, f] of Object.entries(manifest.files)) {
    if (f.file !== fileOf(table)) return { ok: false, reason: `nom de fichier inattendu pour ${table}.` };
    const p = path.join(d, f.file); if (!fs.existsSync(p)) return { ok: false, reason: `${f.file} manquant.` };
    const body = fs.readFileSync(p);
    if (sha256(body) !== f.sha256) return { ok: false, reason: `${f.file} a changé depuis l’export (empreinte différente) : rien n’est importé.` };
    let list; try { list = JSON.parse(body.toString('utf8')); } catch { return { ok: false, reason: `${f.file} illisible.` }; }
    if (!Array.isArray(list) || list.length !== f.rows) return { ok: false, reason: `${f.file} : nombre de lignes différent du manifeste.` };
    if (list.some((r) => !r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id)) return { ok: false, reason: `${f.file} : une ligne sans identifiant.` };
    if (new Set(list.map((r) => r.id)).size !== list.length) return { ok: false, reason: `${f.file} : identifiant en double.` };
    const missing = list.find((r) => REQUIRED[table].some((k) => r[k] === null || r[k] === undefined || r[k] === ''));
    if (missing) return { ok: false, reason: `${f.file} : champ obligatoire absent (${missing.id}).` };
    if (list.some((r) => excluded(table).some((k) => k in r))) return { ok: false, reason: `${f.file} contient un état de vérification ou une donnée interne : refusé.` };
    if (list.some((r) => Object.keys(r).some((k) => SECRET_KEY.test(k)))) return { ok: false, reason: `${f.file} contient un champ de type secret : refusé.` };
    if (list.some((r) => rowHash(r) !== f.rowHashes?.[r.id])) return { ok: false, reason: `${f.file} : une ligne ne correspond pas à son empreinte.` };
    rows[table] = list;
  }
  return { ok: true, manifest, manifestSha256: sha256(fs.readFileSync(mp)), rows };
}

/** --confirm-target host/database must name the target exactly. */
export function targetName(/** @type {string} */ url) {
  try { const u = new URL(String(url || '')); return `${databaseHost(url)}/${decodeURIComponent(u.pathname.replace(/^\//, ''))}`; } catch { return ''; }
}

/** The target row in the form of a bundle row (same exclusions, same withheld e-mail), to compare hashes. @param {string} table @param {any} r */
const asBundleRow = (table, r) => { const x = { ...r }; for (const k of excluded(table)) delete x[k]; if (table === 'Structure' && x.email && nominativeEmail(x.email)) x.email = null; return x; };
const stamp = (/** @type {any} */ v) => (v ? Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(String(v)) ? String(v) : `${v}Z`) : NaN);

/**
 * Plans (dry run) or applies the import of a checked bundle. Returns a receipt (ids, hashes, counts; no content, no address).
 * @param {pg.Client} client @param {{ bundle: { manifest: any, manifestSha256: string, rows: Record<string, any[]> }, apply?: boolean, targetEnv: string, now?: Date }} opts
 */
export async function importContent(client, { bundle, apply = false, targetEnv, now = new Date() }) {
  if (!TARGET_ENVS.includes(targetEnv)) return { ok: false, reason: `--target-env : ${TARGET_ENVS.join(' | ')}.` };
  const targetIdentity = await databaseIdentity(client);
  if (targetIdentity === bundle.manifest.source.identitySha256) return { ok: false, reason: 'la cible est la base source elle-même : rien n’est importé.' };
  const schema = await schemaIdentity(client);
  if (schema.migrations !== bundle.manifest.schema.migrations || schema.migrationsSha256 !== bundle.manifest.schema.migrationsSha256) {
    return { ok: false, reason: `migrations : export ${bundle.manifest.schema.migrations}, cible ${schema.migrations}${schema.migrations === bundle.manifest.schema.migrations ? ' (mais pas les mêmes)' : ''} — appliquez les mêmes migrations d’abord.` };
  }
  /** @type {Record<string, { inserted: number, kept: { same: number, newerInTarget: number, newerInBundle: number } }>} */ const counts = {};
  /** @type {{ table: string, id: string, constraint: string }[]} */ const conflicts = [];
  /** @type {Record<string, Record<string, string>>} */ const inserted = {};
  /** @type {Record<string, string[]>} */ const refreshable = {};
  await client.query('BEGIN');
  try {
    for (const table of Object.keys(TABLES)) {
      const cols = new Set((await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).rows.map((r) => r.column_name));
      counts[table] = { inserted: 0, kept: { same: 0, newerInTarget: 0, newerInBundle: 0 } }; inserted[table] = {}; refreshable[table] = [];
      for (const row of bundle.rows[table] || []) {
        const unknown = Object.keys(row).filter((k) => !cols.has(k));
        if (unknown.length) throw Object.assign(new Error(`colonnes absentes de la cible (${table}) : ${unknown.slice(0, 3).join(', ')}`), { code: 'SCHEMA_MISMATCH' });
        // the target's own registry entry for the same source (another id) is kept too: its veille owns that source's health
        const have = (table === 'SourceRegistryEntry'
          ? await client.query(`SELECT to_jsonb(t) AS r FROM "SourceRegistryEntry" t WHERE id = $1 OR source_id = $2 LIMIT 1`, [row.id, row.source_id ?? null])
          : await client.query(`SELECT to_jsonb(t) AS r FROM ${quote(table)} t WHERE id = $1`, [row.id])).rows[0]?.r;
        if (have) {
          const k = counts[table].kept;
          if (rowHash(asBundleRow(table, have)) === rowHash(row)) k.same += 1;
          else if (CONTENT.includes(table) && stamp(have.updatedAt) > stamp(row.updatedAt)) k.newerInTarget += 1;   // changed in the target since: never overwritten
          else { k.newerInBundle += 1; if (CONTENT.includes(table) && have.id === row.id) refreshable[table].push(row.id); }
          continue;
        }
        const names = Object.keys(row).map(quote).join(', ');
        // another record of the target with the same slug / SIRET / FINESS / RNA / source: reported, never merged (the duplicate register decides that)
        await client.query('SAVEPOINT transfer_row');
        try {
          await client.query(`INSERT INTO ${quote(table)} (${names}) SELECT ${names} FROM jsonb_populate_record(NULL::${quote(table)}, $1::jsonb)`, [JSON.stringify(row)]);
          await client.query('RELEASE SAVEPOINT transfer_row'); counts[table].inserted += 1; inserted[table][row.id] = rowHash(row);
        } catch (e) {
          if (/** @type {any} */ (e)?.code !== '23505') throw e;
          await client.query('ROLLBACK TO SAVEPOINT transfer_row'); conflicts.push({ table, id: row.id, constraint: /** @type {any} */ (e).constraint || 'unique' });
        }
      }
    }
    // links of a dispositif must point to records that exist (in the target, after the inserts)
    /** @type {{ id: string, kind: string, missing: string }[]} */ const dangling = [];
    for (const d of bundle.rows.Dispositif || []) {
      for (const [col, table] of [['related_aide_ids', 'Aide'], ['related_structure_ids', 'Structure']]) {
        const ids = Array.isArray(d[col]) ? d[col] : [];
        if (!ids.length) continue;
        const found = new Set((await client.query(`SELECT id FROM ${quote(table)} WHERE id = ANY($1::text[])`, [ids])).rows.map((r) => r.id));
        for (const x of ids) if (!found.has(x)) dangling.push({ id: d.id, kind: col, missing: x });
      }
    }
    // integrity: every inserted row read back from the target is the bundle's row
    /** @type {string[]} */ const mismatched = [];
    for (const [table, ids] of Object.entries(inserted)) {
      const list = Object.keys(ids); if (!list.length) continue;
      for (const { r } of (await client.query(`SELECT to_jsonb(t) AS r FROM ${quote(table)} t WHERE id = ANY($1::text[])`, [list])).rows) {
        if (rowHash(asBundleRow(table, r)) !== ids[r.id]) mismatched.push(`${table}:${r.id}`);
      }
    }
    const receipt = { format: RECEIPT_FORMAT, receiptId: crypto.randomUUID(), at: now.toISOString(), targetEnv, applied: false, targetIdentitySha256: targetIdentity,
      sourceIdentitySha256: bundle.manifest.source.identitySha256, manifestSha256: bundle.manifestSha256, schema, counts, inserted, conflicts, dangling,
      integrity: mismatched.length ? { ok: false, mismatched: mismatched.slice(0, 50) } : { ok: true, checked: Object.values(inserted).reduce((n, x) => n + Object.keys(x).length, 0) },
      withheldPersonalEmails: bundle.manifest.withheldPersonalEmails ?? 0, verification: 'aucune : les fiches attendent la vérification automatique de cet environnement (D-5 v2)' };
    const blocked = conflicts.length ? `${conflicts.length} fiche(s) en conflit avec d’autres fiches de la cible (même clé)`
      : dangling.length ? `${dangling.length} lien(s) de dispositif vers une fiche introuvable` : mismatched.length ? `${mismatched.length} fiche(s) relue(s) différente(s) de l’export` : null;
    if (!apply || blocked) {
      await client.query('ROLLBACK');
      return blocked && apply ? { ok: false, reason: `${blocked} : rien n’est importé.`, receipt, refreshable } : { ok: true, receipt, refreshable, blocked };
    }
    receipt.applied = true;
    await client.query(`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details) VALUES ($1, 'CONTENT_TRANSFER_IMPORT', 'content-transfer-cli', 'content-transfer-cli', 'Content', $2, $3)`,
      [crypto.randomUUID(), receipt.receiptId, JSON.stringify({ targetEnv, counts, conflicts: 0, integrity: receipt.integrity, manifestSha256: bundle.manifestSha256,
        sourceIdentitySha256: receipt.sourceIdentitySha256, receiptSha256: rowHash(receipt), verification: receipt.verification })]);
    await client.query('COMMIT');
    return { ok: true, receipt, refreshable };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (/** @type {any} */ (e)?.code === 'SCHEMA_MISMATCH') return { ok: false, reason: /** @type {any} */ (e).message };
    throw e;
  }
}

/**
 * Removes what an import inserted, as long as it is still the record that came in and the target never verified it; keeps (and lists) the others.
 * @param {pg.Client} client @param {{ receipt: any, apply?: boolean, now?: Date }} opts
 */
export async function rollbackImport(client, { receipt, apply = false, now = new Date() }) {
  if (receipt?.format !== RECEIPT_FORMAT || !receipt.applied) return { ok: false, reason: 'reçu inconnu ou import non appliqué.' };
  if ((await databaseIdentity(client)) !== receipt.targetIdentitySha256) return { ok: false, reason: 'ce reçu concerne une autre base : rien n’est retiré.' };
  /** @type {Record<string, { removed: number, keptChanged: number, keptVerified: number, absent: number }>} */ const counts = {};
  await client.query('BEGIN');
  try {
    for (const table of Object.keys(TABLES)) {
      const ids = receipt.inserted?.[table] || {}; counts[table] = { removed: 0, keptChanged: 0, keptVerified: 0, absent: 0 };
      for (const [id, hash] of Object.entries(ids)) {
        const r = (await client.query(`SELECT to_jsonb(t) AS r FROM ${quote(table)} t WHERE id = $1 FOR UPDATE`, [id])).rows[0]?.r;
        if (!r) { counts[table].absent += 1; continue; }
        if (CONTENT.includes(table) && r.verification_status === 'VERIFIED') { counts[table].keptVerified += 1; continue; }   // the target's veille has published it since
        if (rowHash(asBundleRow(table, r)) !== hash) { counts[table].keptChanged += 1; continue; }
        await client.query(`DELETE FROM ${quote(table)} WHERE id = $1`, [id]); counts[table].removed += 1;
      }
    }
    if (!apply) { await client.query('ROLLBACK'); return { ok: true, applied: false, counts }; }
    await client.query(`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details) VALUES ($1, 'CONTENT_TRANSFER_ROLLBACK', 'content-transfer-cli', 'content-transfer-cli', 'Content', $2, $3)`,
      [crypto.randomUUID(), receipt.receiptId, JSON.stringify({ counts, at: now.toISOString(), manifestSha256: receipt.manifestSha256 })]);
    await client.query('COMMIT');
    return { ok: true, applied: true, counts };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

/** never written into a record the target already has: what it is, where it comes from, when it was created; the excluded columns are not in the bundle */
const NEVER_UPDATED = ['id', 'statut', 'data_origin', 'createdAt', 'updatedAt'];
const KIND = { Aide: 'aide', Demarche: 'demarche', Structure: 'structure', Dispositif: 'dispositif' };

/** A to_jsonb value in the form drizzle expects for that column (timestamps are stored in UTC without a zone). @param {any} col @param {any} v */
function toDrizzle(col, v) {
  if (v === null || v === undefined) return null;
  if (col.columnType === 'PgTimestamp' || col.columnType === 'PgDate') {
    const s = String(v); return new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : /(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
  }
  return col.columnType === 'PgNumeric' ? String(v) : v;
}

/**
 * --update-existing: the records the import reported « newer in the bundle » are refreshed through the regular, versioned import path
 * (api/_services/source-updates.js): the prior row is versioned, `statut` and the verification are never written, a VERIFIED record whose public content changed is
 * held until the target's veille checks it again. A record changed in the target since (its updatedAt is later) is never touched. One transaction per record
 * (applySourceUpdate's own): a failure is counted, the others stay, a rerun resumes.
 * @param {pg.Client} client @param {{ bundle: { rows: Record<string, any[]> }, ids?: Record<string, string[]>, db: any, applySourceUpdate: Function, tables: Record<string, any>, getTableColumns: Function }} deps
 */
export async function updateExisting(client, { bundle, ids, db, applySourceUpdate, tables, getTableColumns }) {
  /** @type {Record<string, { updated: number, held: number, unchanged: number, newerInTarget: number, absent: number, failed: number }>} */ const counts = {};
  for (const table of CONTENT) {
    counts[table] = { updated: 0, held: 0, unchanged: 0, newerInTarget: 0, absent: 0, failed: 0 };
    const byName = new Map(Object.entries(getTableColumns(tables[table])).map(([key, col]) => [col.name, { key, col }]));
    const wanted = ids ? new Set(ids[table] || []) : null;
    for (const row of bundle.rows[table] || []) {
      if (wanted && !wanted.has(row.id)) continue;
      const cur = (await client.query(`SELECT to_jsonb(t) AS r FROM ${quote(table)} t WHERE id = $1`, [row.id])).rows[0]?.r;
      if (!cur) { counts[table].absent += 1; continue; }
      if (stamp(cur.updatedAt) > stamp(row.updatedAt)) { counts[table].newerInTarget += 1; continue; }
      /** @type {Record<string, any>} */ const patch = {};
      for (const [name, v] of Object.entries(row)) {
        const m = byName.get(name);
        if (!m || NEVER_UPDATED.includes(name) || m.col.columnType === 'PgCustomColumn') continue;
        if (JSON.stringify(sorted(cur[name] ?? null)) !== JSON.stringify(sorted(v ?? null))) patch[m.key] = toDrizzle(m.col, v);
      }
      if (!Object.keys(patch).length) { counts[table].unchanged += 1; continue; }
      if (byName.has('updatedAt')) patch[/** @type {any} */ (byName.get('updatedAt')).key] = new Date();
      const r = await applySourceUpdate({ kind: KIND[/** @type {keyof typeof KIND} */ (table)], id: row.id, patch, source: 'lab-transfer' }, db).catch(() => ({ ok: false }));
      if (!r.ok) { counts[table].failed += 1; continue; }
      counts[table].updated += 1; if (r.held) counts[table].held += 1;
    }
  }
  return counts;
}

const arg = (/** @type {string} */ name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const die = (/** @type {string} */ m) => { console.error(`content-transfer : ${m}`); process.exit(2); };
/** the target, confirmed by name on every write-capable command */
function confirmedTarget() {
  const url = process.env.TARGET_DATABASE_URL || die('TARGET_DATABASE_URL absente (la base cible).');
  const want = targetName(/** @type {string} */ (url));
  if (arg('confirm-target') !== want) die(`indiquez --confirm-target ${want} : la base cible est confirmée à chaque commande.`);
  return /** @type {string} */ (url);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'export') {
    const url = process.env.DATABASE_URL || die('DATABASE_URL absente (la base source).');
    const out = arg('out') || die('indiquez --out <nouveau dossier>.');
    const client = new pg.Client(connectionOptions(url)); await client.connect();
    try {
      const r = await exportContent(client, { outDir: /** @type {string} */ (out), sourceHost: databaseHost(url) });
      console.log(JSON.stringify({ exported: Object.fromEntries(Object.entries(r.manifest.files).map(([t, f]) => [t, /** @type {any} */ (f).rows])), migrations: r.manifest.schema.migrations,
        withheldPersonalEmails: r.manifest.withheldPersonalEmails, manifestSha256: r.manifestSha256 }));
    } finally { await client.end(); }
    return;
  }
  if (cmd === 'import') {
    const from = arg('from') || die('indiquez --from <dossier exporté>.');
    const url = confirmedTarget();
    const targetEnv = arg('target-env') || die(`indiquez --target-env ${TARGET_ENVS.join(' | ')}.`);
    const apply = process.argv.includes('--apply'); const refresh = process.argv.includes('--update-existing');
    if (refresh && !apply) die('--update-existing écrit dans les fiches existantes : il demande aussi --apply (lancez d’abord l’essai sans les deux).');
    const bundle = readBundle(/** @type {string} */ (from)); if (!bundle.ok) die(/** @type {any} */ (bundle).reason);
    const client = new pg.Client(connectionOptions(url)); await client.connect();
    /** @type {pg.Pool | null} */ let pool = null;
    try {
      const r = await importContent(client, { bundle: /** @type {any} */ (bundle), apply, targetEnv: /** @type {string} */ (targetEnv) });
      if (r.receipt) {
        const receiptFile = arg('receipt') || path.join(path.resolve(/** @type {string} */ (from)), `receipt-${r.receipt.applied ? 'import' : 'preview'}-${r.receipt.receiptId}.json`);
        fs.writeFileSync(receiptFile, JSON.stringify(r.receipt, null, 1), { mode: 0o600 });
        console.error(`reçu : ${receiptFile}`);
      }
      if (!r.ok) { if (r.receipt) console.error(JSON.stringify({ conflicts: r.receipt.conflicts.slice(0, 50), dangling: r.receipt.dangling.slice(0, 50), integrity: r.receipt.integrity })); die(/** @type {string} */ (r.reason)); }
      /** @type {Record<string, any> | null} */ let refreshed = null;
      if (refresh) {
        // the services' default database is never this process's: only the confirmed target is written (node --import tsx, the services are TypeScript)
        delete process.env.DATABASE_URL; delete process.env.DATABASE_URL_TEST; process.env.VITE_SKIP_DB = 'true';
        const [{ applySourceUpdate }, schema, { drizzle }, { getTableColumns }] = await Promise.all([import('../api/_services/source-updates.js'), import('../src/db/schema.js'),
          import('drizzle-orm/node-postgres'), import('drizzle-orm')]);
        pool = new pg.Pool({ ...connectionOptions(url), max: 2 });
        refreshed = await updateExisting(client, { bundle: /** @type {any} */ (bundle), ids: r.refreshable, db: drizzle(pool), applySourceUpdate, tables: schema, getTableColumns });
      }
      const rc = /** @type {any} */ (r.receipt);
      console.log(JSON.stringify({ applied: rc.applied, targetEnv, counts: rc.counts, conflicts: rc.conflicts.slice(0, 50), dangling: rc.dangling.slice(0, 50), integrity: rc.integrity,
        ...(r.blocked ? { blocked: r.blocked } : {}), ...(refreshed ? { refreshed } : {}),
        note: rc.applied ? 'fiches importées sans vérification : la veille de cet environnement les vérifie avant toute publication' : 'essai : rien n’est écrit (ajoutez --apply)' }));
    } finally { await client.end(); if (pool) await pool.end(); }
    return;
  }
  if (cmd === 'rollback') {
    const file = arg('receipt') || die('indiquez --receipt <reçu de l’import>.');
    const url = confirmedTarget();
    let receipt; try { receipt = JSON.parse(fs.readFileSync(/** @type {string} */ (file), 'utf8')); } catch { die('reçu illisible.'); }
    const client = new pg.Client(connectionOptions(url)); await client.connect();
    try {
      const r = await rollbackImport(client, { receipt, apply: process.argv.includes('--apply') });
      if (!r.ok) die(/** @type {string} */ (r.reason));
      console.log(JSON.stringify({ applied: r.applied, counts: r.counts, note: r.applied ? 'fiches retirées (les fiches vérifiées ou modifiées depuis sont gardées)' : 'essai : rien n’est retiré (ajoutez --apply)' }));
    } finally { await client.end(); }
    return;
  }
  die('commande : export | import | rollback');
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => die(e?.code ? `erreur ${e.code}` : 'erreur inattendue (aucune donnée affichée).'));
