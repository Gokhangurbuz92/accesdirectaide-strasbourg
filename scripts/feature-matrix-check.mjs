#!/usr/bin/env node
/**
 * R47 — consistency checker of a feature-completion matrix (one row per protected feature, e.g. R46_173_FEATURE_COMPLETION_MATRIX.csv). READ-ONLY: it reads
 * two CSV files and prints findings; it never writes, never connects to anything.
 *
 *   node scripts/feature-matrix-check.mjs <matrix.csv> <reconciliation.csv> [--expect-sha <sha>] [--json]
 *
 * The reconciliation CSV (newest STRASBOURG_173_RECONCILIATION_*.csv) gives the canonical ids (its `id` column). Rules (each finding has a code):
 *   CANONICAL_COUNT        the reconciliation does not hold exactly 173 distinct ids (or holds a deferred one)
 *   DUPLICATE_ID           an id appears twice in the matrix
 *   MISSING_ID / EXTRA_ID  the matrix ids differ from the canonical ids (exactly 173 expected)
 *   DEFERRED_ID            one of the 15 explicitly deferred ids (OWNER_SCOPE_REVISION_STRASBOURG_2026-10-21.md §8) is in the matrix
 *   BAD_STATUS             a status column holds something other than Y, N or NA (a missing status column is MISSING_COLUMN)
 *   READY_NOT_IMPLEMENTED  TECHNICALLY_READY=Y while IMPLEMENTED≠Y
 *   ACTIVE_NOT_DEPLOYED    PRODUCTION_ACTIVE=Y while DEPLOYED≠Y
 *   ACTIVE_NOT_READY       PRODUCTION_ACTIVE=Y while TECHNICALLY_READY≠Y
 *   OPERATIONALLY_ACCEPTED OPERATIONALLY_ACCEPTED=Y anywhere (formal acceptance is human/external and never recorded by engineering)
 *   READY_WITHOUT_E2E      TECHNICALLY_READY=Y with END_TO_END_TESTED=N, unless the row carries a non-software justification (column
 *                          `non_software_justification`, real text — a document / procedure verified instead of a journey)
 *   NA_INCONSISTENT        IMPLEMENTED=NA while TECHNICALLY_READY is not NA (a non-applicable row cannot be « ready »)
 *   DEPLOYED_WITHOUT_SHA / SHA_WITHOUT_DEPLOY / SHA_INCONSISTENT   deployed_sha empty on a deployed row, set on a non-deployed row, or not one value
 *                          (nor --expect-sha) over the deployed rows
 *   PLACEHOLDER_EVIDENCE   the `evidence` column is empty, « — », « - », « TBD », « TODO », « see above », « see work », « n/a », « ? »…
 *   E2E_WITHOUT_TESTS      END_TO_END_TESTED=Y while the `tests` column is empty or a placeholder
 *   REMAINING_MISMATCH     the `remaining` column disagrees with the *_PENDING flags (e.g. « external_provider » without EXTERNAL_PROVIDER_PENDING=Y, a
 *                          pending flag missing from it, or « none » with a pending flag)
 * Exit code: 0 when no finding, 1 when findings, 2 on a usage / read error.
 */
import fs from 'node:fs';

export const CANONICAL_COUNT = 173;
/** OWNER_SCOPE_REVISION_STRASBOURG_2026-10-21.md §8 (15 rows, owner decision; only the owner changes this list) */
export const DEFERRED_IDS = Object.freeze(['E09', 'M02', 'M03', 'M05', 'N07', 'X01', 'X02', 'X03', 'X04', 'X05', 'X06', 'X07', 'X08', 'X09', 'X12']);
export const STATUS_COLUMNS = Object.freeze(['IMPLEMENTED', 'END_TO_END_TESTED', 'SECURITY_VERIFIED', 'LANGUAGES_VERIFIED', 'TECHNICALLY_READY',
  'EXTERNAL_PROVIDER_PENDING', 'LEGAL_ACTIVATION_PENDING', 'REAL_PARTNER_PENDING', 'HDS_PENDING', 'HUMAN_REVIEW_PENDING', 'DEPLOYED', 'PRODUCTION_ACTIVE',
  'OPERATIONALLY_ACCEPTED']);
export const STATUS_VALUES = Object.freeze(['Y', 'N', 'NA']);
/** `remaining` token → pending flag */
export const REMAINING_FLAGS = Object.freeze({ external_provider: 'EXTERNAL_PROVIDER_PENDING', legal_activation: 'LEGAL_ACTIVATION_PENDING',
  real_partner: 'REAL_PARTNER_PENDING', hds: 'HDS_PENDING', human_review: 'HUMAN_REVIEW_PENDING' });
export const JUSTIFICATION_COLUMN = 'non_software_justification';

/** a cell that names no evidence (case-insensitive, trimmed, trailing dots ignored) */
export function isPlaceholder(value) {
  const v = String(value ?? '').trim().replace(/\.+$/, '').trim().toLowerCase();
  if (!v) return true;
  return /^(?:[-—–_?.…]+|tbd|tbc|todo|fixme|xxx|n\/?a|none|pending|see (?:above|below|work|notes?|row|report)|cf\.? (?:above|ci-dessus)|ci-dessus|idem|same|ditto|placeholder|à compléter|a completer)$/.test(v);
}

/** RFC 4180 CSV (quotes, doubled quotes, CR/LF inside quotes) → array of rows */
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i += 1; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i += 1; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (q) throw new Error('CSV_UNTERMINATED_QUOTE');
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** @returns {{ header: string[], records: Record<string, string>[] }} */
export function csvRecords(text) {
  const [header = [], ...body] = parseCsv(text);
  const h = header.map((x) => x.trim());
  return { header: h, records: body.map((r) => Object.fromEntries(h.map((k, i) => [k, String(r[i] ?? '').trim()]))) };
}

/**
 * @param {{ header: string[], records: Record<string, string>[] }} matrix
 * @param {{ header: string[], records: Record<string, string>[] }} reconciliation
 * @param {{ expectSha?: string | null }} [opts]
 * @returns {{ code: string, id?: string, detail?: string }[]}
 */
export function checkMatrix(matrix, reconciliation, opts = {}) {
  /** @type {{ code: string, id?: string, detail?: string }[]} */
  const out = [];
  const add = (code, id, detail) => out.push({ code, ...(id ? { id } : {}), ...(detail ? { detail } : {}) });
  const deferred = new Set(DEFERRED_IDS);

  // canonical ids
  const canon = reconciliation.records.map((r) => r.id).filter(Boolean);
  const canonSet = new Set(canon);
  if (!reconciliation.header.includes('id')) add('MISSING_COLUMN', undefined, 'reconciliation: id');
  if (canonSet.size !== CANONICAL_COUNT || canon.length !== CANONICAL_COUNT) add('CANONICAL_COUNT', undefined, `reconciliation: ${canon.length} rows, ${canonSet.size} distinct ids (expected ${CANONICAL_COUNT})`);
  for (const id of canonSet) if (deferred.has(id)) add('CANONICAL_COUNT', id, 'deferred id in the reconciliation');

  // columns
  for (const c of ['id', ...STATUS_COLUMNS, 'deployed_sha', 'evidence', 'tests', 'remaining']) if (!matrix.header.includes(c)) add('MISSING_COLUMN', undefined, c);
  const hasJustification = matrix.header.includes(JUSTIFICATION_COLUMN);

  // ids
  const seen = new Map();
  for (const r of matrix.records) seen.set(r.id, (seen.get(r.id) || 0) + 1);
  for (const [id, n] of seen) {
    if (!id) add('MISSING_ID', undefined, `${n} row(s) without an id`);
    else if (n > 1) add('DUPLICATE_ID', id, `${n} rows`);
    if (deferred.has(id)) add('DEFERRED_ID', id);
    else if (id && !canonSet.has(id)) add('EXTRA_ID', id);
  }
  for (const id of canonSet) if (!seen.has(id)) add('MISSING_ID', id);
  if (matrix.records.length !== CANONICAL_COUNT) add('ROW_COUNT', undefined, `${matrix.records.length} rows (expected ${CANONICAL_COUNT})`);

  // rows
  const deployedShas = new Map();
  for (const r of matrix.records) {
    const id = r.id || '(no id)';
    const v = (/** @type {string} */ c) => String(r[c] ?? '').trim();
    for (const c of STATUS_COLUMNS) if (matrix.header.includes(c) && !STATUS_VALUES.includes(v(c))) add('BAD_STATUS', id, `${c}=${JSON.stringify(v(c))}`);
    if (v('TECHNICALLY_READY') === 'Y' && v('IMPLEMENTED') !== 'Y') add('READY_NOT_IMPLEMENTED', id, `IMPLEMENTED=${v('IMPLEMENTED')}`);
    if (v('PRODUCTION_ACTIVE') === 'Y' && v('DEPLOYED') !== 'Y') add('ACTIVE_NOT_DEPLOYED', id, `DEPLOYED=${v('DEPLOYED')}`);
    if (v('PRODUCTION_ACTIVE') === 'Y' && v('TECHNICALLY_READY') !== 'Y') add('ACTIVE_NOT_READY', id, `TECHNICALLY_READY=${v('TECHNICALLY_READY')}`);
    if (v('OPERATIONALLY_ACCEPTED') === 'Y') add('OPERATIONALLY_ACCEPTED', id);
    if (v('IMPLEMENTED') === 'NA' && v('TECHNICALLY_READY') !== 'NA') add('NA_INCONSISTENT', id, `TECHNICALLY_READY=${v('TECHNICALLY_READY')}`);
    if (v('TECHNICALLY_READY') === 'Y' && v('END_TO_END_TESTED') === 'N' && !(hasJustification && !isPlaceholder(v(JUSTIFICATION_COLUMN)))) {
      add('READY_WITHOUT_E2E', id, hasJustification ? `${JUSTIFICATION_COLUMN} empty or placeholder` : `no ${JUSTIFICATION_COLUMN} column`);
    }
    const sha = v('deployed_sha');
    if (v('DEPLOYED') === 'Y') {
      if (!sha || isPlaceholder(sha)) add('DEPLOYED_WITHOUT_SHA', id);
      else deployedShas.set(sha, [...(deployedShas.get(sha) || []), id]);
      if (sha && !/^[0-9a-f]{7,40}$/.test(sha) && !isPlaceholder(sha)) add('SHA_INCONSISTENT', id, `not a git sha: ${JSON.stringify(sha)}`);
    } else if (v('DEPLOYED') === 'N' && sha && !isPlaceholder(sha)) add('SHA_WITHOUT_DEPLOY', id, `DEPLOYED=${v('DEPLOYED')} deployed_sha=${sha}`);
    if (matrix.header.includes('evidence') && isPlaceholder(v('evidence'))) add('PLACEHOLDER_EVIDENCE', id, `evidence=${JSON.stringify(v('evidence'))}`);
    if (v('END_TO_END_TESTED') === 'Y' && matrix.header.includes('tests') && isPlaceholder(v('tests'))) add('E2E_WITHOUT_TESTS', id, `tests=${JSON.stringify(v('tests'))}`);
    if (matrix.header.includes('remaining')) {
      const tokens = v('remaining').split(/[;,\s]+/).filter(Boolean);
      const known = new Set(Object.keys(REMAINING_FLAGS));
      for (const t of tokens) {
        if (t === 'none') continue;
        if (!known.has(t)) add('REMAINING_MISMATCH', id, `unknown token ${JSON.stringify(t)}`);
        else if (v(REMAINING_FLAGS[/** @type {keyof typeof REMAINING_FLAGS} */ (t)]) !== 'Y') add('REMAINING_MISMATCH', id, `${t} listed but ${REMAINING_FLAGS[/** @type {keyof typeof REMAINING_FLAGS} */ (t)]}=${v(REMAINING_FLAGS[/** @type {keyof typeof REMAINING_FLAGS} */ (t)])}`);
      }
      for (const [t, flag] of Object.entries(REMAINING_FLAGS)) if (v(flag) === 'Y' && !tokens.includes(t)) add('REMAINING_MISMATCH', id, `${flag}=Y but « ${t} » not in remaining`);
      if (tokens.includes('none') && tokens.length > 1) add('REMAINING_MISMATCH', id, '« none » with other tokens');
      if (!tokens.length) add('REMAINING_MISMATCH', id, 'remaining empty');
    }
  }
  if (deployedShas.size > 1) add('SHA_INCONSISTENT', undefined, `deployed rows name ${deployedShas.size} SHAs: ${[...deployedShas].map(([s, ids]) => `${s}×${ids.length}`).join(', ')}`);
  if (opts.expectSha) {
    const want = String(opts.expectSha).toLowerCase();
    for (const [s, ids] of deployedShas) if (!(want.startsWith(s.toLowerCase()) || s.toLowerCase().startsWith(want))) add('SHA_INCONSISTENT', undefined, `${ids.length} deployed row(s) name ${s}, expected ${want}`);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--expect-sha');
  const shaAt = args.indexOf('--expect-sha');
  const expectSha = shaAt >= 0 ? args[shaAt + 1] : null;
  if (pos.length !== 2) { console.error('usage: node scripts/feature-matrix-check.mjs <matrix.csv> <reconciliation.csv> [--expect-sha <sha>] [--json]'); process.exit(2); }
  let m; let r;
  try { m = csvRecords(fs.readFileSync(pos[0], 'utf8')); r = csvRecords(fs.readFileSync(pos[1], 'utf8')); } catch (e) { console.error(`FEATURE_MATRIX_CHECK {"ok":false,"error":${JSON.stringify(String(/** @type {any} */ (e)?.code || /** @type {any} */ (e)?.message || e))}}`); process.exit(2); }
  const findings = checkMatrix(m, r, { expectSha });
  /** @type {Record<string, number>} */
  const byCode = {};
  for (const f of findings) byCode[f.code] = (byCode[f.code] || 0) + 1;
  if (args.includes('--json')) console.log(JSON.stringify({ ok: findings.length === 0, rows: m.records.length, byCode, findings }, null, 2));
  else {
    for (const f of findings) console.log(`${f.code}${f.id ? ` ${f.id}` : ''}${f.detail ? ` — ${f.detail}` : ''}`);
    console.log(`FEATURE_MATRIX_CHECK ${JSON.stringify({ ok: findings.length === 0, rows: m.records.length, findings: findings.length, byCode })}`);
  }
  process.exit(findings.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
