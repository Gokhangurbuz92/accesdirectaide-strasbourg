// WS2_DETERMINISTIC_R2_SEED_V1
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { verifyWs2Data } from './verify-ws2-data.mjs';

const { Client } = pg;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMBEDDING_MODEL = 'nomic-embed-text';
const EMBEDDING_DIMENSION = 768;
const DEFAULT_OLLAMA_BASE = 'http://127.0.0.1:11434';

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  throw error;
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'oui'].includes(String(value ?? '').trim().toLowerCase());
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((value) => String(value).trim());
  return rows.slice(1).filter((values) => values.some((value) => String(value).trim())).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])),
  );
}

function validateLocalDatabaseUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) fail('WS2_DATABASE_URL_REQUIRED');
  const parsed = new URL(value);
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) fail('WS2_DATABASE_URL_PROTOCOL_NOT_ALLOWED');
  const host = String(parsed.hostname || '').toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) fail('WS2_REMOTE_DATABASE_FORBIDDEN');
  return value;
}

function localOllamaBase() {
  const raw = String(process.env.WS2_OLLAMA_URL || process.env.OLLAMA_HOST || DEFAULT_OLLAMA_BASE).trim();
  const parsed = new URL(raw);
  const host = String(parsed.hostname || '').toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) fail('WS2_REMOTE_OLLAMA_FORBIDDEN');
  if (!['http:', 'https:'].includes(parsed.protocol)) fail('WS2_OLLAMA_PROTOCOL_NOT_ALLOWED');
  return raw.replace(/\/$/, '');
}

async function embed(text) {
  const base = localOllamaBase();
  const common = { method: 'POST', headers: { 'content-type': 'application/json' } };
  let response = await fetch(`${base}/api/embed`, { ...common, body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }) });
  let vector = null;
  if (response.ok) {
    const body = await response.json();
    vector = Array.isArray(body?.embeddings) ? body.embeddings[0] : null;
  }
  if (!Array.isArray(vector)) {
    response = await fetch(`${base}/api/embeddings`, { ...common, body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }) });
    if (!response.ok) fail('WS2_LOCAL_EMBEDDING_FAILED', `status=${response.status}`);
    const body = await response.json();
    vector = body?.embedding;
  }
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSION) {
    fail('WS2_EMBEDDING_DIMENSION_MISMATCH', `expected=${EMBEDDING_DIMENSION} actual=${Array.isArray(vector) ? vector.length : 'missing'}`);
  }
  if (!vector.every((value) => Number.isFinite(Number(value)))) fail('WS2_EMBEDDING_NONFINITE');
  return vector.map(Number);
}

function deterministicUuid(entity, slug) {
  const hex = crypto.createHash('sha256').update(`${entity}:${slug}`).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const compact = hex.join('');
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function quoteIdent(name) { return `"${String(name).replace(/"/g, '""')}"`; }

async function tableColumns(client, tableName) {
  const result = await client.query(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default, is_identity, is_generated FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [tableName],
  );
  if (!result.rows.length) fail('WS2_DB_TABLE_MISSING', tableName);
  return result.rows;
}

function normalizeKey(value) { return String(value ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase(); }

/** PKG-1 / D-5: columns only the human verification handler may write. A CSV cell (even one named launchEligible) can never set them; undefined = omitted: insert takes the safe default, a re-seed preserves a recorded verification. */
const VERIFICATION_OWNED_COLUMNS = new Set(['launcheligible', 'verificationstatus', 'verifiedby', 'territoryverified', 'publicationhold']);

function sourceValue(entity, row, columnName, embeddingVector) {
  if (VERIFICATION_OWNED_COLUMNS.has(normalizeKey(columnName))) return undefined;
  if (columnName === 'data_origin') return 'official';   // curated project data awaiting verification (never 'verified' by itself)
  const direct = Object.entries(row).find(([key]) => key === columnName)
    || Object.entries(row).find(([key]) => normalizeKey(key) === normalizeKey(columnName));
  if (direct) return direct[1];
  const aliases = {
    id: deterministicUuid(entity, row.slug || row.titre || row.nom || 'record'),
    recordkey: row.slug, record_key: row.slug,
    descriptioncourte: row.summary_falc, description_courte: row.summary_falc, description: row.summary_falc,
    conditions: row.conditions_falc, montant: row.montant_falc, source: row.provenance,
    providername: 'ws2-strasbourg-local', provider_name: 'ws2-strasbourg-local',
    verifiedcurrent: parseBoolean(row.verifiedCurrent), verified_current: parseBoolean(row.verifiedCurrent),
    launcheligible: parseBoolean(row.launchEligible), launch_eligible: parseBoolean(row.launchEligible),
    embeddingmodel: EMBEDDING_MODEL, embedding_model: EMBEDDING_MODEL,
    embedding: embeddingVector ? `[${embeddingVector.join(',')}]` : undefined,
    // DTA S9 (WS2-R1): the import time is NOT a verification date. A source row that carries its own date_verification is used by the exact-name lookup above; otherwise the value is
    // left undefined = column omitted: a new row stores NULL (unknown), a re-seed keeps whatever a human-verified date already is in the table. fetched_at stays the import time (it IS the collection time).
    fetchedat: new Date(), fetched_at: new Date(),
    createdat: new Date(), created_at: new Date(), updatedat: new Date(), updated_at: new Date(),
    rawdatahash: crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex'),
    raw_data_hash: crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex'),
  };
  return aliases[columnName] ?? aliases[normalizeKey(columnName)];
}

function coerce(value, column) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const type = String(column.data_type || '').toLowerCase();
  const udt = String(column.udt_name || '').toLowerCase();
  if (type === 'boolean') return typeof value === 'boolean' ? value : parseBoolean(value);
  if (['smallint', 'integer', 'bigint', 'numeric', 'decimal', 'real', 'double precision'].includes(type)) {
    const number = Number(value); return Number.isFinite(number) ? number : null;
  }
  if (type.includes('timestamp') || type === 'date') return value instanceof Date ? value : new Date(value);
  if (type === 'json' || type === 'jsonb') {
    if (typeof value !== 'string') return JSON.stringify(value);
    try { return JSON.stringify(JSON.parse(value)); } catch {
      // the launch CSV writes steps as « step 1 | step 2 »: the pages read a list of steps ({ numero, titre }), a plain string was never shown
      if (column.column_name === 'etapes' && value.includes('|')) return JSON.stringify(value.split('|').map((t) => t.trim()).filter(Boolean).map((titre, i) => ({ numero: i + 1, titre, description: '' })));
      return JSON.stringify(value);
    }
  }
  if (type === 'array' || udt.startsWith('_')) { if (Array.isArray(value)) return value; return String(value).split(/[|;]/).map((item) => item.trim()).filter(Boolean); }
  return value;
}

/**
 * DTA S9 (WS2-R2), kept by PKG-1: a row whose OWN flags say it is not launch-eligible or not verified-current must never be seeded as published. (PKG-1 / D-5 adds the real publication
 * contract in the read path: even a 'publie' seed row stays hidden until a human records a verification; this guard remains as defence in depth.) This invents no condition: it applies the record's declared flags. It does not decide anything about the data: set the
 * flags to true after human verification and the record is seeded as published again.
 * @param {Record<string, unknown>} row @param {unknown} statut
 */
export function guardedStatut(row, statut) {
  if (String(statut ?? '').trim() !== 'publie') return statut;
  return parseBoolean(row.launchEligible) === true && parseBoolean(row.verifiedCurrent) === true ? statut : 'brouillon';
}

async function idempotentUpsert(client, tableName, entity, row, embeddingVector = null) {
  const columns = await tableColumns(client, tableName);
  const values = {};
  for (const column of columns) {
    const value = sourceValue(entity, row, column.column_name, embeddingVector);
    if (value !== undefined) values[column.column_name] = coerce(value, column);
  }
  if ('statut' in values) {
    const guarded = guardedStatut(row, values.statut);
    if (guarded !== values.statut) process.stderr.write(`WS2_SEED_FAIL_CLOSED ${tableName}/${String(row.slug)}: statut '${values.statut}' -> '${guarded}' (the record's own flags say launchEligible=${String(row.launchEligible)} verifiedCurrent=${String(row.verifiedCurrent)})\n`);
    values.statut = guarded;
  }
  const missing = columns.filter((column) => column.is_nullable === 'NO' && column.column_default == null && column.is_identity !== 'YES' && column.is_generated === 'NEVER' && !(column.column_name in values));
  if (missing.length) fail('WS2_REQUIRED_DB_COLUMN_UNMAPPED', `${tableName}:${missing.map((column) => column.column_name).join(',')}`);
  if (!('slug' in values) || !String(values.slug || '').trim()) fail('WS2_DB_SLUG_REQUIRED', tableName);
  const existing = await client.query(`SELECT ${quoteIdent('id')} FROM ${quoteIdent(tableName)} WHERE ${quoteIdent('slug')} = $1 LIMIT 1`, [values.slug]);
  const writable = Object.entries(values).filter(([name]) => name !== 'id' || existing.rowCount === 0);
  if (existing.rowCount) {
    const update = writable.filter(([name]) => name !== 'slug');
    if (update.length) {
      const setSql = update.map(([name], index) => `${quoteIdent(name)} = $${index + 1}`).join(', ');
      await client.query(`UPDATE ${quoteIdent(tableName)} SET ${setSql} WHERE ${quoteIdent('slug')} = $${update.length + 1}`, [...update.map(([, value]) => value), values.slug]);
    }
    return 'updated';
  }
  const names = writable.map(([name]) => name);
  const params = writable.map(([, value]) => value);
  const placeholders = names.map((_, index) => `$${index + 1}`).join(', ');
  await client.query(`INSERT INTO ${quoteIdent(tableName)} (${names.map(quoteIdent).join(', ')}) VALUES (${placeholders})`, params);
  return 'inserted';
}

async function loadRows(relativePath) { return parseCsv(await readFile(path.join(REPO_ROOT, relativePath), 'utf8')); }

export async function runWs2R2Seed(options = {}) {
  await verifyWs2Data({ rootDir: REPO_ROOT });
  const databaseUrl = validateLocalDatabaseUrl(options.databaseUrl ?? process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL);
  const aides = await loadRows('data/aides-alsace.csv');
  const demarches = await loadRows('data/demarches-alsace.csv');
  const structures = await loadRows('data/structures-alsace.csv');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const counts = { aides: 0, demarches: 0, structures: 0 };
  try {
    await client.query('BEGIN');
    for (const row of aides) {
      const vector = await embed([row.titre, row.summary_falc, row.cest_quoi, row.conditions_falc].filter(Boolean).join('\n'));
      await idempotentUpsert(client, 'Aide', 'Aide', row, vector); counts.aides += 1;
    }
    for (const row of demarches) { await idempotentUpsert(client, 'Demarche', 'Demarche', row); counts.demarches += 1; }
    for (const row of structures) { await idempotentUpsert(client, 'Structure', 'Structure', row); counts.structures += 1; }
    await client.query('COMMIT');
    return { ok: true, counts, embeddingModel: EMBEDDING_MODEL, embeddingDimension: EMBEDDING_DIMENSION, idempotent: true };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  } finally { await client.end(); }
}

/**
 * PKG-5 / WS2 local review (owner's LAB database only): loads the 49 launch records so a human can review them in /admin/ws2 BEFORE the launch gate can pass.
 * Differences with runWs2R2Seed, all on the safe side: the launch verifier is not a precondition (it cannot pass before the human review it exists for); every
 * record is inserted as a NON-PUBLIC draft (statut 'brouillon'); an existing row (same slug) is never touched, so a recorded verification or correction stays;
 * no verification column is ever written (same mapping as above); the embedding is computed only if a local Ollama answers, otherwise left empty.
 * @param {{ databaseUrl?: string }} [options]
 */
export async function runWs2ReviewSeed(options = {}) {
  const databaseUrl = validateLocalDatabaseUrl(options.databaseUrl ?? process.env.DATABASE_URL);
  const sets = [['Aide', 'data/aides-alsace.csv', true], ['Demarche', 'data/demarches-alsace.csv', false], ['Structure', 'data/structures-alsace.csv', false]];
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const counts = { inserted: 0, keptExisting: 0, embedded: 0 };
  try {
    await client.query('BEGIN');   // all or nothing
    for (const [table, file, withEmbedding] of sets) {
      for (const source of await loadRows(file)) {
        const exists = await client.query(`SELECT 1 FROM ${quoteIdent(table)} WHERE slug = $1 LIMIT 1`, [source.slug]);
        if (exists.rowCount) { counts.keptExisting += 1; continue; }
        // lists the CSV does not carry (structures: services, publics, categories) are stored EMPTY = unknown, visible as a gap in the review; nothing is guessed
        const row = { ...(table === 'Structure' ? { services: '', publics_accueillis: '', categories_aidees: '' } : {}), ...source, statut: 'brouillon' };
        let vector = null;
        if (withEmbedding) { try { vector = await embed([row.titre, row.summary_falc, row.cest_quoi, row.conditions_falc].filter(Boolean).join('\n')); counts.embedded += 1; } catch { vector = null; } }
        await idempotentUpsert(client, table, table, row, vector); counts.inserted += 1;
      }
    }
    await client.query('COMMIT');
    return { ok: true, counts, published: 0, verified: 0 };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* keep the original error */ }
    throw error;
  } finally { await client.end(); }
}

function isDirectExecution() { return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); }
if (isDirectExecution()) {
  runWs2R2Seed().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error?.code || error?.message || 'WS2_R2_SEED_FAILED'); process.exitCode = 1;
  });
}
