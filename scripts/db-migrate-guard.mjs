/**
 * R44 — migration safety guard shared by scripts/db-deploy-migrate.mjs, drizzle.config.ts and the tests. Pure functions plus two read-only catalogue readers.
 *
 * Why it exists. drizzle-orm 0.45 (`pg-core/dialect.js migrate()`, also behind `drizzle-kit migrate`) keeps no per-migration bookkeeping: it reads the NEWEST
 * `created_at` of drizzle.__drizzle_migrations and applies, in journal order, every entry whose « when » is later — never looking at names or hashes. On
 * Production (0042) that means 0043 and 0044, the retired account-free booking migrations, would run before anything newer. This module makes that impossible
 * for the repository's own tooling:
 *   1. OBSOLETE_MANIFEST pins the two obsolete migrations (index, tag, « when », sha256 of the file): a renamed, renumbered or edited copy is caught;
 *   2. verifyJournal() — idx contiguous, tags unique and numbered by idx, « when » strictly increasing (a later migration with an earlier « when » would be
 *      skipped silently by drizzle), one file per entry and one entry per file, the obsolete entries exactly as pinned;
 *   3. auditHistory() — every recorded row matches a journal entry by « when » and by hash; no duplicate; no non-obsolete migration left behind the newest
 *      recorded one (drizzle would skip it for ever); optionally no obsolete migration recorded at all (Production);
 *   4. planDeploy() — what drizzle would apply, refused while an obsolete migration is pending; `only` = exactly one migration;
 *   5. expectedObjects() / physicalDrift() — the tables, columns, named constraints, indexes, enum types, triggers and functions the applied migrations create
 *      (parsed from their SQL), compared with the catalogue: an object missing, or an object that only an UNRECORDED migration creates (e.g. a guest column
 *      without a 0043 row), is drift; CHECK_MARKERS add the CHECK-content changes the parser cannot see (0043 and 0045 rewrite one CHECK);
 *   6. stockMigrateRefusal() — `drizzle-kit migrate` / `push` are refused by drizzle.config.ts against any non-local database.
 * Historic migration files are never modified: LAB databases and the native QA rely on them.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** the retired guest-booking migrations (R42 DEC-R42-01): kept in the journal for LAB databases, never applied in Production */
export const OBSOLETE_MANIFEST = Object.freeze([
  Object.freeze({ idx: 43, tag: '0043_r38_guest_booking', when: 1793650324179, sha256: '6934ec73828a167040c1c215c145454e9196fb3aaf4b739c2184b82080ad3824' }),
  Object.freeze({ idx: 44, tag: '0044_r39_guest_reminder_consent', when: 1793659117545, sha256: '9d2a52a82eba70e32d01333f6397e5863df19b6f625cc588c11ea7b01c612605' }),
]);
export const OBSOLETE_MIGRATIONS = Object.freeze(OBSOLETE_MANIFEST.map((m) => m.tag));
const isObsolete = (tag) => OBSOLETE_MIGRATIONS.includes(tag);

/**
 * CHECK-content changes the SQL parser cannot see (a migration that DROPs and re-ADDs a CHECK under the same name). For each tag: the constraint whose
 * definition contains `token` exactly when that migration is applied.
 */
export const CHECK_MARKERS = Object.freeze([
  Object.freeze({ tag: '0043_r38_guest_booking', table: 'AppointmentNotice', constraint: 'AppointmentNotice_kind_check', token: "'BOOKED_BY_GUEST'" }),
  Object.freeze({ tag: '0045_r43_appointment_notice_kinds', table: 'AppointmentNotice', constraint: 'AppointmentNotice_kind_check', token: "'REQUEST_RECEIVED'" }),
]);

export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** the journal and the files, read exactly as drizzle reads them (hash = sha256 of the whole file) */
export function loadMigrations(folder) {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8'));
  const entries = journal.entries;
  const sqlFiles = fs.readdirSync(folder).filter((f) => f.endsWith('.sql')).sort();
  /** @type {Record<string, { text: string, hash: string }>} */
  const files = {};
  for (const e of entries) {
    const p = path.join(folder, `${e.tag}.sql`);
    if (fs.existsSync(p)) { const text = fs.readFileSync(p, 'utf8'); files[e.tag] = { text, hash: sha256(text) }; }
  }
  return { entries, files, sqlFiles };
}

/** @param {{ entries: Array<{ idx: number, when: number, tag: string }>, files: Record<string, { hash: string }>, sqlFiles: string[] }} m */
export function verifyJournal({ entries, files, sqlFiles }) {
  const problems = [];
  const tags = new Set();
  entries.forEach((e, i) => {
    if (e.idx !== i) problems.push({ code: 'IDX_NOT_CONTIGUOUS', tag: e.tag, idx: e.idx, expected: i });
    if (!String(e.tag).startsWith(String(e.idx).padStart(4, '0') + '_')) problems.push({ code: 'TAG_NOT_NUMBERED_BY_IDX', tag: e.tag });
    if (tags.has(e.tag)) problems.push({ code: 'DUPLICATE_TAG', tag: e.tag });
    tags.add(e.tag);
    if (!Number.isSafeInteger(e.when)) problems.push({ code: 'WHEN_NOT_AN_INTEGER', tag: e.tag });
    if (i > 0 && !(e.when > entries[i - 1].when)) problems.push({ code: 'WHEN_NOT_INCREASING', tag: e.tag, when: e.when, previous: entries[i - 1].when });
    if (!files[e.tag]) problems.push({ code: 'MISSING_FILE', tag: e.tag });
  });
  for (const f of sqlFiles) if (!tags.has(f.replace(/\.sql$/, ''))) problems.push({ code: 'FILE_WITHOUT_ENTRY', file: f });
  for (const m of OBSOLETE_MANIFEST) {
    const e = entries.find((x) => x.tag === m.tag);
    if (!e) { problems.push({ code: 'OBSOLETE_ENTRY_MISSING', tag: m.tag }); continue; }
    if (e.idx !== m.idx || e.when !== m.when) problems.push({ code: 'OBSOLETE_ENTRY_CHANGED', tag: m.tag, idx: e.idx, when: e.when });
    if (files[m.tag] && files[m.tag].hash !== m.sha256) problems.push({ code: 'OBSOLETE_FILE_CHANGED', tag: m.tag });
  }
  for (const e of entries) {
    if (isObsolete(e.tag)) continue;
    const twin = OBSOLETE_MANIFEST.find((m) => m.when === e.when || (files[e.tag] && files[e.tag].hash === m.sha256));
    if (twin) problems.push({ code: 'OBSOLETE_MIGRATION_RENAMED', tag: e.tag, obsolete: twin.tag });
  }
  return { ok: problems.length === 0, problems };
}

/**
 * The recorded history against the journal. Rows: { id, hash, created_at } of drizzle.__drizzle_migrations.
 * @param {Array<{ idx: number, when: number, tag: string }>} entries @param {Record<string, { hash: string }>} files
 * @param {Array<{ id?: number, hash: string, created_at: string | number | null }>} rows @param {{ forbidObsoleteApplied?: boolean }} [opts]
 */
export function auditHistory(entries, files, rows, { forbidObsoleteApplied = false } = {}) {
  const findings = [];
  const byWhen = new Map(entries.map((e) => [e.when, e]));
  const applied = [];
  const seen = new Set();
  for (const r of rows) {
    const when = r.created_at === null || r.created_at === undefined ? null : Number(r.created_at);
    const e = when === null ? undefined : byWhen.get(when);
    if (!e) { findings.push({ code: 'UNKNOWN_HISTORY_ROW', id: r.id ?? null, created_at: when }); continue; }
    if (seen.has(e.tag)) findings.push({ code: 'DUPLICATE_HISTORY_ROW', tag: e.tag, id: r.id ?? null });
    seen.add(e.tag);
    if (files[e.tag] && files[e.tag].hash !== r.hash) findings.push({ code: 'HISTORY_HASH_MISMATCH', tag: e.tag, id: r.id ?? null });
    if (isObsolete(e.tag) && forbidObsoleteApplied) findings.push({ code: 'OBSOLETE_MIGRATION_RECORDED', tag: e.tag });
  }
  for (const e of entries) if (seen.has(e.tag)) applied.push(e.tag);
  const known = rows.map((r) => Number(r.created_at)).filter((w) => byWhen.has(w));
  const last = known.length ? Math.max(...known) : null;
  const rawLast = rows.length ? Math.max(...rows.map((r) => Number(r.created_at)).filter((w) => Number.isFinite(w))) : null;
  if (last !== null) for (const e of entries) if (e.when < last && !seen.has(e.tag) && !isObsolete(e.tag)) findings.push({ code: 'SKIPPED_MIGRATION', tag: e.tag });
  return { ok: findings.length === 0, findings, applied, lastCreatedAt: Number.isFinite(rawLast) ? rawLast : null };
}

/**
 * What a run would apply — exactly drizzle's rule (every entry whose « when » is later than the newest recorded created_at). Pure.
 * @param {Array<{ idx: number, when: number, tag: string }>} entries @param {number | null} lastCreatedAt @param {string | null} [only]
 * @returns {{ ok: true, apply: Array<{ idx: number, when: number, tag: string }> } | { ok: false, reason: string, pending?: string[] }}
 */
export function planDeploy(entries, lastCreatedAt, only = null) {
  const pending = entries.filter((e) => lastCreatedAt === null || Number(lastCreatedAt) < e.when);
  if (!only) {
    const obsolete = pending.filter((e) => isObsolete(e.tag)).map((e) => e.tag);
    if (obsolete.length) return { ok: false, reason: 'OBSOLETE_MIGRATION_PENDING', pending: pending.map((e) => e.tag) };
    return { ok: true, apply: pending };
  }
  const target = entries.find((e) => e.tag === only);
  if (!target) return { ok: false, reason: 'UNKNOWN_MIGRATION' };
  if (isObsolete(target.tag)) return { ok: false, reason: 'OBSOLETE_MIGRATION_REFUSED' };
  if (lastCreatedAt === null) return { ok: false, reason: 'EMPTY_DATABASE' };
  if (!pending.some((e) => e.tag === only)) return { ok: false, reason: 'ALREADY_APPLIED' };
  const before = pending.filter((e) => e.when < target.when && !isObsolete(e.tag)).map((e) => e.tag);
  if (before.length) return { ok: false, reason: 'EARLIER_MIGRATION_PENDING', pending: before };
  return { ok: true, apply: [target] };
}

const ID = '"([^"]+)"';
const TABLE_REF = `(?:IF EXISTS )?(?:ONLY )?(?:"public"\\.)?${ID}`;
/**
 * The named objects one migration creates and drops, in textual order (comments removed). Unnamed CHECK / PRIMARY KEY constraints are not tracked.
 * @param {string} sql @returns {Array<{ op: 'add' | 'drop', kind: string, key: string, table?: string }>}
 */
export function expectedObjects(sql) {
  const text = sql.replace(/--[^\n]*/g, '');
  const ops = [];
  const re = new RegExp([
    `CREATE TABLE (?:IF NOT EXISTS )?(?:"public"\\.)?${ID} \\(`,
    `DROP TABLE (?:IF EXISTS )?(?:"public"\\.)?${ID}`,
    `ALTER TABLE ${TABLE_REF} ADD COLUMN (?:IF NOT EXISTS )?${ID}`,
    `ALTER TABLE ${TABLE_REF} DROP COLUMN (?:IF EXISTS )?${ID}`,
    `ALTER TABLE ${TABLE_REF} ADD CONSTRAINT ${ID}`,
    `ALTER TABLE ${TABLE_REF} DROP CONSTRAINT (?:IF EXISTS )?${ID}`,
    `CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?${ID} ON (?:ONLY )?(?:"public"\\.)?${ID}`,
    `DROP INDEX (?:CONCURRENTLY )?(?:IF EXISTS )?(?:"public"\\.)?${ID}`,
    `CREATE TYPE (?:"public"\\.)?${ID} AS ENUM`,
    `CREATE (?:OR REPLACE )?FUNCTION (?:"public"\\.)?${ID}\\(`,
    `CREATE (?:OR REPLACE )?TRIGGER ${ID} [^;]*? ON (?:"public"\\.)?${ID}`,
  ].map((s) => `(?:${s})`).join('|'), 'g');
  let m;
  while ((m = re.exec(text))) {
    const g = m.slice(1);
    if (g[0]) {
      const t = g[0];
      ops.push({ op: 'add', kind: 'table', key: t });
      // the column / CONSTRAINT lines of the CREATE TABLE body (up to the closing « ); »)
      const end = text.indexOf('\n);', re.lastIndex);
      const body = text.slice(re.lastIndex, end < 0 ? undefined : end);
      for (const line of body.split('\n')) {
        const col = line.match(/^\s*"([^"]+)"\s/);
        if (col) ops.push({ op: 'add', kind: 'column', key: `${t}.${col[1]}`, table: t });
        const con = line.match(/^\s*CONSTRAINT "([^"]+)"/);
        if (con) ops.push({ op: 'add', kind: 'constraint', key: `${t}.${con[1]}`, table: t });
      }
    } else if (g[1]) ops.push({ op: 'drop', kind: 'table', key: g[1] });
    else if (g[2]) ops.push({ op: 'add', kind: 'column', key: `${g[2]}.${g[3]}`, table: g[2] });
    else if (g[4]) ops.push({ op: 'drop', kind: 'column', key: `${g[4]}.${g[5]}`, table: g[4] });
    else if (g[6]) ops.push({ op: 'add', kind: 'constraint', key: `${g[6]}.${g[7]}`, table: g[6] });
    else if (g[8]) ops.push({ op: 'drop', kind: 'constraint', key: `${g[8]}.${g[9]}`, table: g[8] });
    else if (g[10]) ops.push({ op: 'add', kind: 'index', key: g[10], table: g[11] });
    else if (g[12]) ops.push({ op: 'drop', kind: 'index', key: g[12] });
    else if (g[13]) ops.push({ op: 'add', kind: 'type', key: g[13] });
    else if (g[14]) ops.push({ op: 'add', kind: 'function', key: g[14] });
    else if (g[15]) ops.push({ op: 'add', kind: 'trigger', key: `${g[16]}.${g[15]}`, table: g[16] });
  }
  return ops;
}

/** the net set of objects after replaying `tags` in order (a dropped table takes its columns, constraints, indexes and triggers with it) */
export function replayObjects(files, tags) {
  /** @type {Map<string, { kind: string, key: string, table?: string, tag: string }>} */
  const objs = new Map();
  for (const tag of tags) {
    for (const o of expectedObjects(files[tag]?.text || '')) {
      const id = `${o.kind}:${o.key}`;
      if (o.op === 'add') { objs.set(id, { kind: o.kind, key: o.key, table: o.table, tag }); continue; }
      if (o.kind === 'table') { for (const [k, v] of objs) if (v.table === o.key || k === id) objs.delete(k); continue; }
      objs.delete(id);
    }
  }
  return objs;
}

/** the catalogue of the public schema, read-only: the same keys as expectedObjects() */
export async function readCatalogue(client) {
  const q = async (sql) => (await client.query(sql)).rows.map((r) => r.k);
  const keys = new Set();
  const add = (kind, list) => { for (const k of list) keys.add(`${kind}:${k}`); };
  add('table', await q(`select table_name k from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`));
  add('column', await q(`select table_name || '.' || column_name k from information_schema.columns where table_schema = 'public'`));
  add('constraint', await q(`select t.relname || '.' || c.conname k from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relnamespace = 'public'::regnamespace`));
  add('index', await q(`select indexname k from pg_indexes where schemaname = 'public'`));
  add('type', await q(`select typname k from pg_type where typnamespace = 'public'::regnamespace and typtype = 'e'`));
  add('function', await q(`select proname k from pg_proc where pronamespace = 'public'::regnamespace`));
  add('trigger', await q(`select t.relname || '.' || g.tgname k from pg_trigger g join pg_class t on t.oid = g.tgrelid where not g.tgisinternal and t.relnamespace = 'public'::regnamespace`));
  /** @type {Record<string, string>} */
  const checks = {};
  for (const r of (await client.query(`select t.relname || '.' || c.conname k, pg_get_constraintdef(c.oid) d from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relnamespace = 'public'::regnamespace and c.contype = 'c'`)).rows) checks[r.k] = r.d;
  return { keys, checks };
}

/**
 * Physical schema vs recorded history. Pure on (files, entries, appliedTags, catalogue).
 * @returns {{ ok: boolean, findings: Array<{ code: string, kind?: string, key?: string, tag?: string }>, expected: number }}
 */
export function physicalDrift(entries, files, appliedTags, catalogue) {
  const findings = [];
  const appliedSet = new Set(appliedTags);
  const ordered = entries.map((e) => e.tag).filter((t) => appliedSet.has(t));
  const expected = replayObjects(files, ordered);
  for (const [id, o] of expected) if (!catalogue.keys.has(id)) findings.push({ code: 'PHYSICAL_OBJECT_MISSING', kind: o.kind, key: o.key, tag: o.tag });
  const unrecorded = entries.map((e) => e.tag).filter((t) => !appliedSet.has(t));
  for (const tag of unrecorded) {
    for (const o of expectedObjects(files[tag]?.text || '')) {
      const id = `${o.kind}:${o.key}`;
      if (o.op === 'add' && !expected.has(id) && catalogue.keys.has(id)) findings.push({ code: 'PHYSICAL_OBJECT_UNRECORDED', kind: o.kind, key: o.key, tag });
    }
  }
  for (const mk of CHECK_MARKERS) {
    const def = catalogue.checks[`${mk.table}.${mk.constraint}`];
    if (def === undefined) continue;   // the constraint itself is covered by the object comparison
    const has = def.includes(mk.token);
    if (appliedSet.has(mk.tag) && !has) findings.push({ code: 'CHECK_CHANGE_MISSING', tag: mk.tag, key: `${mk.table}.${mk.constraint}` });
    if (!appliedSet.has(mk.tag) && has) findings.push({ code: 'CHECK_CHANGE_UNRECORDED', tag: mk.tag, key: `${mk.table}.${mk.constraint}` });
  }
  const seen = new Set();
  const unique = findings.filter((f) => { const k = JSON.stringify(f); if (seen.has(k)) return false; seen.add(k); return true; });
  return { ok: unique.length === 0, findings: unique, expected: expected.size };
}

/** the history rows, or [] when drizzle's table does not exist yet (read-only) */
export async function readHistory(client) {
  const exists = (await client.query(`select to_regclass('drizzle.__drizzle_migrations') is not null as e`)).rows[0].e;
  if (!exists) return [];
  return (await client.query('select id, hash, created_at::text as created_at from drizzle.__drizzle_migrations order by id')).rows;
}

/** every check at once, read-only: journal, history, physical schema, plan */
export async function preflight(client, folder, { only = null, forbidObsoleteApplied = false, physical = true } = {}) {
  const m = loadMigrations(folder);
  const journal = verifyJournal(m);
  const rows = await readHistory(client);
  const history = auditHistory(m.entries, m.files, rows, { forbidObsoleteApplied });
  const drift = physical ? physicalDrift(m.entries, m.files, history.applied, await readCatalogue(client)) : { ok: true, findings: [], expected: 0 };
  const plan = planDeploy(m.entries, history.lastCreatedAt, only);
  return { ok: journal.ok && history.ok && drift.ok, journal, history: { ...history, rows: rows.length }, drift, plan, migrations: m };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** true for a loopback / Unix-socket database url (the only targets the stock drizzle migrate may touch) */
export function isLocalDatabaseUrl(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return false; }
  if (LOCAL_HOSTS.has(u.hostname)) return true;
  return u.hostname === '' && (u.searchParams.get('host') || '').startsWith('/');
}

/**
 * drizzle.config.ts calls this: `drizzle-kit migrate` (journal order: it would apply 0043/0044 on Production) and `drizzle-kit push` (schema.ts, which
 * describes the LAB schema) are refused against any database that is not local. Production migrations go through scripts/db-deploy-migrate.mjs only.
 * @param {string[]} argv @param {string | undefined} url @returns {string | null} the refusal message, or null
 */
export function stockMigrateRefusal(argv, url) {
  const cmd = argv.slice(2).find((a) => !a.startsWith('-'));
  if (cmd !== 'migrate' && cmd !== 'push') return null;
  if (!url || isLocalDatabaseUrl(url)) return null;
  return `drizzle-kit ${cmd} refused: DATABASE_URL is not a local database. Stock drizzle applies every journal entry newer than the last recorded one, `
    + `including the obsolete ${OBSOLETE_MIGRATIONS.join(' / ')}; use scripts/db-deploy-migrate.mjs (see docs/database.md).`;
}
