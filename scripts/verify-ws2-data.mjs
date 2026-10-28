import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRUE_VALUES = new Set(['true', '1', 'yes', 'oui']);
const BAD_TOKENS = ['example.com', 'lorem ipsum', 'placeholder', 'synthetic record', 'fake data'];
const REQUIRED_SP_IDS = [
  'F10009', 'F12006', 'F1280', 'F12242', 'F14809', 'F14202', 'N19775',
  'N31477', 'F2882', 'F10027', 'F18074', 'F2038', 'F21375', 'F13609',
  'F34917', 'F245', 'F248', 'F10007', 'R34754', 'R78263', 'F1637',
  'R54651', 'R52880', 'F34959', 'N110',
];
const REQUIRED_AIDE_SOURCE_IDS = [
  'F10009', 'F12006', 'F1280', 'F12242', 'F14809', 'F14202', 'F10027',
  'N19775', 'F2882', 'F18074', 'F13609', 'F21375', 'F2038',
];
const REQUIRED_DEMARCHE_SOURCE_IDS = [
  'R78263', 'F10007', 'R34754', 'F34959', 'F1637', 'F10027',
  'R52880', 'R54651', 'F2882', 'N31477', 'N110',
];

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  throw error;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 1; continue; }
      if (ch === '"') { quoted = false; continue; }
      field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  row.push(field.replace(/\r$/, ''));
  if (row.length > 1 || row[0] !== '' || rows.length === 0) rows.push(row);
  while (rows.length && rows[rows.length - 1].every((value) => value === '')) rows.pop();
  if (!rows.length) return [];
  const headers = rows.shift().map((header) => String(header).trim());
  return rows
    .filter((values) => values.some((value) => String(value).trim() !== ''))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

async function readCsv(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return { raw, rows: parseCsv(raw) };
}

async function readJson(filePath) {
  let raw;
  try { raw = await readFile(filePath, 'utf8'); }
  catch (cause) { const error = new Error(`WS2_FILE_MISSING: ${filePath}`); error.cause = cause; throw error; }
  try { return { raw, value: JSON.parse(raw) }; }
  catch (cause) { const error = new Error(`WS2_JSON_INVALID: ${filePath}`); error.cause = cause; throw error; }
}

export function truthy(value) {
  return TRUE_VALUES.has(String(value ?? '').trim().toLowerCase());
}

function requireColumns(rows, names, label) {
  if (!rows.length) fail('WS2_EMPTY_DATASET', label);
  const headers = new Set(Object.keys(rows[0]));
  for (const name of names) if (!headers.has(name)) fail('WS2_REQUIRED_COLUMN_MISSING', `${label}:${name}`);
}

function requireUnique(rows, key, label) {
  const seen = new Set();
  for (const row of rows) {
    const value = String(row[key] ?? '').trim();
    if (!value) fail('WS2_RECORD_KEY_EMPTY', `${label}:${key}`);
    if (seen.has(value)) fail('WS2_DUPLICATE_RECORD_KEY', `${label}:${value}`);
    seen.add(value);
  }
}

function requireLaunchRows(rows, label, falcColumns) {
  for (const row of rows) {
    for (const name of falcColumns) {
      if (!String(row[name] ?? '').trim()) fail('WS2_REQUIRED_FIELD_EMPTY', `${label}:${name}`);
    }
    if (!String(row.provenance ?? '').trim()) fail('WS2_PROVENANCE_EMPTY', label);
    if (!truthy(row.verifiedCurrent)) fail('WS2_NOT_VERIFIED_CURRENT', label);
    if (!truthy(row.launchEligible)) fail('WS2_NOT_LAUNCH_ELIGIBLE', label);
  }
}

function requireNoSynthetic(raw, label) {
  const lower = raw.toLowerCase();
  for (const token of BAD_TOKENS) if (lower.includes(token)) fail('WS2_SYNTHETIC_OR_PLACEHOLDER_DATA', `${label}:${token}`);
}

function requireIds(raw, ids, label) {
  for (const id of ids) if (!raw.includes(id)) fail('WS2_REQUIRED_SOURCE_ID_MISSING', `${label}:${id}`);
}

function remoteRuntimeEnabled(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(remoteRuntimeEnabled);
  for (const [key, value] of Object.entries(node)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['runtimefetch', 'remotefetch', 'externalremoteapiused', 'networkruntimeenabled'].includes(normalized) && value === true) return true;
    if (remoteRuntimeEnabled(value)) return true;
  }
  return false;
}


export function requireExactServicePublicIdentities(snapshot, requiredIds) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    fail('WS2_SERVICE_PUBLIC_SNAPSHOT_INVALID');
  }
  const byId = snapshot.byId;
  if (byId && typeof byId === 'object' && !Array.isArray(byId)) {
    for (const id of requiredIds) {
      const item = Object.prototype.hasOwnProperty.call(byId, id) ? byId[id] : null;
      if (!item) fail('WS2_SERVICE_PUBLIC_ID_MISSING', id);
      if (item.id !== id || item.servicePublicId !== id ||
          item.sourceId !== id || item.archiveMember !== `${id}.xml` ||
          !/^[a-f0-9]{64}$/.test(item.recordSha256 || '') ||
          item.provenance?.archiveMember !== `${id}.xml` ||
          item.provenance?.recordSha256 !== item.recordSha256) {
        fail('WS2_SERVICE_PUBLIC_IDENTITY_MISMATCH', id);
      }
    }
    if (Array.isArray(snapshot.items)) {
      for (const id of requiredIds) {
        const occurrences = snapshot.items.filter((item) => item && item.id === id);
        if (occurrences.length !== 1 || occurrences[0].archiveMember !== `${id}.xml`) {
          fail('WS2_SERVICE_PUBLIC_ALIAS_MISMATCH', id);
        }
      }
    }
    return;
  }
  // Legacy minimal test fixtures use an items array with exact IDs.
  if (!Array.isArray(snapshot.items)) fail('WS2_SERVICE_PUBLIC_COLLECTION_INVALID');
  const present = new Set(snapshot.items.map((item) => item && item.id).filter((id) => typeof id === 'string'));
  for (const id of requiredIds) {
    if (!present.has(id)) fail('WS2_SERVICE_PUBLIC_ID_MISSING', id);
  }
}

export async function verifyWs2Data({ rootDir = REPO_ROOT } = {}) {
  const root = path.resolve(rootDir);
  const aides = await readCsv(path.join(root, 'data/aides-alsace.csv'));
  const demarches = await readCsv(path.join(root, 'data/demarches-alsace.csv'));
  const structures = await readCsv(path.join(root, 'data/structures-alsace.csv'));
  const snapshot = await readJson(path.join(root, 'data/strasbourg/service-public-demarches.snapshot.json'));
  const manifest = await readJson(path.join(root, 'data/strasbourg/ws2-source-manifest.json'));

  if (aides.rows.length !== 15) fail('WS2_AIDE_COUNT_INVALID', String(aides.rows.length));
  if (demarches.rows.length !== 10) fail('WS2_DEMARCHE_COUNT_INVALID', String(demarches.rows.length));
  if (structures.rows.length < 20) fail('WS2_STRUCTURE_COUNT_INVALID', String(structures.rows.length));

  requireColumns(aides.rows, ['slug', 'summary_falc', 'conditions_falc', 'provenance', 'verifiedCurrent', 'launchEligible'], 'aides');
  requireColumns(demarches.rows, ['slug', 'summary_falc', 'pour_qui', 'ou_faire', 'etapes', 'provenance', 'verifiedCurrent', 'launchEligible'], 'demarches');
  requireColumns(structures.rows, ['slug', 'nom', 'adresse', 'summary_falc', 'provenance', 'verifiedCurrent', 'launchEligible'], 'structures');

  requireUnique(aides.rows, 'slug', 'aides');
  requireUnique(demarches.rows, 'slug', 'demarches');
  requireUnique(structures.rows, 'slug', 'structures');

  requireLaunchRows(aides.rows, 'aides', ['summary_falc', 'conditions_falc']);
  requireLaunchRows(demarches.rows, 'demarches', ['summary_falc', 'pour_qui', 'ou_faire', 'etapes']);
  requireLaunchRows(structures.rows, 'structures', ['nom', 'adresse', 'summary_falc']);

  requireNoSynthetic(aides.raw, 'aides');
  requireNoSynthetic(demarches.raw, 'demarches');
  requireNoSynthetic(structures.raw, 'structures');
  requireIds(aides.raw, REQUIRED_AIDE_SOURCE_IDS, 'aides');
  requireIds(demarches.raw, REQUIRED_DEMARCHE_SOURCE_IDS, 'demarches');

  requireExactServicePublicIdentities(snapshot.value, REQUIRED_SP_IDS);
  if (remoteRuntimeEnabled(manifest.value)) fail('WS2_REMOTE_RUNTIME_FORBIDDEN');

  return {
    launchReady: true,
    offlineOnly: true,
    counts: { aides: aides.rows.length, demarches: demarches.rows.length, structures: structures.rows.length },
    requiredServicePublicIds: REQUIRED_SP_IDS.length,
  };
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  verifyWs2Data()
    .then((result) => { process.stdout.write(`${JSON.stringify(result)}\n`); })
    .catch((error) => {
      process.stderr.write(`${error?.code || error?.message || 'WS2_VERIFY_FAILED'}\n`);
      process.exitCode = 1;
    });
}
