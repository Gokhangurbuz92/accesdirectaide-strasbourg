#!/usr/bin/env node
/**
 * R35 (§8, D11): rule-source assertion harness — the automated half of the D11 review, designed in R33 (R33_ORIGINAL_SIX_OPEN_REQUIREMENTS_EN.md §2).
 * For each of the 76 items of docs/rules/D11_REVIEW_FORM.csv it checks what a machine CAN check against the official texts:
 *   - a number a condition states (or a draftCheck parameter) is present in the current Service-Public fiche;
 *   - a phrase a reference case quotes « … » is present in the fiche;
 *   - the fiche still exists, was not redirected, and DILA's « date of the last important change » is not later than the register's consultation;
 *   - the legal basis articles (LEGI subset) are in force at the reference date.
 * It never decides an item, never writes the register and never sets a status: a report full of TEXT_CONFIRMED leaves every right
 * RESEARCHED_UNVALIDATED (the expert gate api/lib/validatedRules.js is separate). The archive's SHA-256 is recorded so a run can be reproduced.
 *   node scripts/d11-source-assert.mjs <vosdroits.zip> [--reference-date YYYY-MM-DD] [--out report.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadArchive, parseFiche, resolveId, ficheMeta } from '../api/_services/verification/dila.js';

export const VERDICTS = ['FICHE_MISSING', 'NUMBER_NOT_FOUND', 'QUOTE_NOT_FOUND', 'SOURCE_REVISED', 'FICHE_REDIRECTED', 'TEXT_CONFIRMED', 'METADATA_UNCHANGED', 'NO_ARCHIVE_SOURCE', 'NOT_MACHINE_CHECKABLE'];

/** digits only, thousands separators (space, NBSP, narrow NBSP, dot) removed, decimal comma kept, a zero decimal part dropped ("12 499,00" -> "12499") */
export function canonicalNumber(raw) {
  const s = String(raw).replace(/[\s  .]/g, '');
  return s.replace(/,0+$/, '');
}

/** every number written in a French text, canonical form; "112 499" is one number, never "12499" @param {string} text @returns {Set<string>} */
export function numbersIn(text) {
  const t = String(text || '').normalize('NFC');
  const out = new Set();
  for (const m of t.matchAll(/(?<![\d,])\d{1,3}(?:[   .]\d{3})+(?:,\d+)?(?![\d])|(?<![\d,])\d+(?:,\d+)?(?![\d])/g)) out.add(canonicalNumber(m[0]));
  return out;
}

/** numbers a draftCheck uses (ages, ceilings…), recursively @param {unknown} v @param {Set<string>} [acc] */
export function draftCheckNumbers(v, acc = new Set()) {
  if (typeof v === 'number' && Number.isFinite(v)) acc.add(canonicalNumber(String(v).replace('.', ',')));
  else if (Array.isArray(v)) v.forEach((x) => draftCheckNumbers(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => draftCheckNumbers(x, acc));
  return acc;
}

const squashText = (s) => String(s || '').normalize('NFC').replace(/[  ]/g, ' ').replace(/[’]/g, "'").replace(/\s+/g, ' ').toLowerCase();

/** phrases quoted « … » in a case basis @param {string} basis */
export const quotesIn = (basis) => [...String(basis || '').matchAll(/«\s*([^»]+?)\s*»/g)].map((m) => m[1]);

/**
 * @param {{ register: any, cases: any, legal: any, form: { right: string, item_type: string, item_id: string, text: string }[],
 *   archive: { fiches: Map<string, string>, redirections: Map<string, string> }, referenceDate: string }} input
 */
export function assessItems({ register, cases, legal, form, archive, referenceDate }) {
  const rights = new Map(register.rights.map((/** @type {any} */ r) => [r.id, r]));
  const caseById = new Map(cases.cases.map((/** @type {any} */ c) => [c.id, c]));
  /** @type {Map<string, any>} */
  const ficheCache = new Map();
  const fiche = (/** @type {string} */ id) => {
    if (ficheCache.has(id)) return ficheCache.get(id);
    const to = resolveId(id, archive.redirections);
    const xml = archive.fiches.get(to);
    const f = xml ? { id: to, redirected: to !== id, meta: ficheMeta(xml), parsed: parseFiche(xml) } : null;
    if (f) { f.numbers = numbersIn(f.parsed.text); f.flat = squashText(f.parsed.text); }
    ficheCache.set(id, f);
    return f;
  };
  const consultedOf = (/** @type {any} */ right, /** @type {string} */ id) => {
    const s = right.sources.find((/** @type {any} */ x) => String(x.url).endsWith(`/${id}`));
    return s?.consultedAt || register.consultedAt || null;
  };
  const metaChecks = (/** @type {any} */ right, /** @type {string} */ id, /** @type {any} */ f) => {
    /** @type {{ check: string, result: string, detail?: string }[]} */
    const checks = [];
    if (f.redirected) checks.push({ check: 'redirection', result: 'FICHE_REDIRECTED', detail: `${id} -> ${f.id}` });
    const changed = f.meta.importantChangeAt; const consulted = consultedOf(right, id);
    if (changed && consulted && changed > consulted) checks.push({ check: 'important_change_date', result: 'SOURCE_REVISED', detail: `DILA dateDerniereModificationImportante ${changed} > register consultation ${consulted}` });
    else checks.push({ check: 'important_change_date', result: 'UNCHANGED', detail: `${changed || 'none'} <= ${consulted || '?'}` });
    return checks;
  };
  const verdictOf = (/** @type {{ result: string }[]} */ checks, /** @type {string} */ fallback) => {
    for (const v of VERDICTS) if (checks.some((c) => c.result === v)) return v;
    return fallback;
  };

  const rows = [];
  for (const item of form) {
    const right = rights.get(item.right);
    const row = { right: item.right, item_type: item.item_type, item_id: item.item_id, tier: 'D', checks: /** @type {any[]} */ ([]), verdict: 'NOT_MACHINE_CHECKABLE' };
    if (item.item_type === 'condition') {
      const cond = right.conditions.find((/** @type {any} */ c) => c.fact === item.item_id);
      const src = String(cond?.source || '');
      if (!/^[FN]\d+$/.test(src)) { row.tier = 'B'; row.verdict = 'NO_ARCHIVE_SOURCE'; row.checks.push({ check: 'source', result: 'NO_ARCHIVE_SOURCE', detail: `${src}: not in the DILA archive (no date on page)` }); rows.push(row); continue; }
      const f = fiche(src);
      if (!f) { row.tier = 'B'; row.verdict = 'FICHE_MISSING'; row.checks.push({ check: 'fiche', result: 'FICHE_MISSING', detail: src }); rows.push(row); continue; }
      const nums = new Set([...numbersIn(cond.text), ...draftCheckNumbers(cond.draftCheck)]);
      row.tier = nums.size ? 'A' : 'B';
      for (const n of nums) row.checks.push({ check: `number ${n}`, result: f.numbers.has(n) ? 'FOUND' : 'NUMBER_NOT_FOUND' });
      row.checks.push(...metaChecks(right, src, f));
      row.verdict = verdictOf(row.checks, nums.size ? 'TEXT_CONFIRMED' : 'METADATA_UNCHANGED');
    } else if (item.item_type === 'case') {
      const c = caseById.get(item.item_id);
      const quotes = quotesIn(c?.basis);
      const src = (String(c?.basis || '').match(/\b([FN]\d{2,6})\b/) || [])[1];
      if (!quotes.length || !src) { row.tier = 'C'; row.verdict = 'NOT_MACHINE_CHECKABLE'; row.checks.push({ check: 'internal_consistency', result: 'TESTED_ELSEWHERE', detail: 'expected result = draft reading (tests/unit/pkg6-d11-rules-draft.test.jsx)' }); rows.push(row); continue; }
      const f = fiche(src);
      if (!f) { row.tier = 'A'; row.verdict = 'FICHE_MISSING'; row.checks.push({ check: 'fiche', result: 'FICHE_MISSING', detail: src }); rows.push(row); continue; }
      row.tier = 'A';
      for (const q of quotes) row.checks.push({ check: `quote « ${q} »`, result: f.flat.includes(squashText(q)) ? 'FOUND' : 'QUOTE_NOT_FOUND' });
      row.checks.push(...metaChecks(right, src, f));
      row.verdict = verdictOf(row.checks, 'TEXT_CONFIRMED');
    } else {
      // ambiguities are decided by a person only; the figures they quote are re-checked for information, which decides nothing
      const src = right.sources.map((/** @type {any} */ s) => (String(s.url).match(/\/([FN]\d+)$/) || [])[1]).filter(Boolean);
      const nums = [...numbersIn(item.text)].filter((n) => n.length >= 3);
      for (const n of nums) row.checks.push({ check: `figure ${n} (information only)`, result: src.some((id) => fiche(id)?.numbers.has(n)) ? 'FOUND' : 'NOT_FOUND' });
    }
    rows.push(row);
  }

  // legal bases: every resolved article in force at the reference date (LEGI subset data/rules/legal-articles.v1.json)
  const legalByRight = /** @type {Record<string, { articles: number, inForce: number, notInForce: string[] }>} */ ({});
  for (const ref of legal.references) {
    const r = (legalByRight[ref.right] ||= { articles: 0, inForce: 0, notInForce: [], repealScheduled: [] });
    for (const a of ref.resolved || []) {
      r.articles += 1;
      // ABROGE_DIFF = repeal scheduled at dateFin: the article still applies before that date (it is reported apart, for the reviewer)
      if (['VIGUEUR', 'ABROGE_DIFF'].includes(a.etat) && a.dateDebut <= referenceDate && referenceDate < a.dateFin) {
        r.inForce += 1;
        if (a.etat === 'ABROGE_DIFF') r.repealScheduled.push(`${a.code} ${a.num} (repeal scheduled ${a.dateFin})`);
      } else r.notInForce.push(`${a.code} ${a.num} (${a.etat}, ${a.dateDebut}–${a.dateFin})`);
    }
  }
  const summary = /** @type {Record<string, number>} */ ({});
  for (const r of rows) summary[r.verdict] = (summary[r.verdict] || 0) + 1;
  return { referenceDate, items: rows.length, summary, legalBasis: legalByRight, rows };
}

/** @param {string} text CSV with quoted fields */
export function parseFormCsv(text) {
  const out = []; const rows = []; let field = ''; let row = []; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') q = false; else field += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  for (const r of body) if (r.length > 1) out.push(Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const zip = process.argv[2];
  const arg = (/** @type {string} */ k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
  if (!zip || !fs.existsSync(zip)) { process.stderr.write('usage: node scripts/d11-source-assert.mjs <vosdroits.zip> [--reference-date YYYY-MM-DD] [--out report.json]\n'); process.exit(2); }
  const root = process.cwd();
  const read = (/** @type {string} */ p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  const bytes = fs.readFileSync(zip);
  const archive = loadArchive(new Uint8Array(bytes));
  if (!archive.fiches.size) { process.stderr.write('empty archive: nothing checked (fail closed)\n'); process.exit(1); }
  const referenceDate = arg('--reference-date') || new Date().toISOString().slice(0, 10);
  const report = {
    tool: 'scripts/d11-source-assert.mjs', ranAt: new Date().toISOString(), archive: { file: path.basename(zip), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), fiches: archive.fiches.size },
    statement: 'Machine checks only. Nothing here validates a rule: the D11 decision stays with an expert reviewer (scripts/d11-review.mjs, api/lib/validatedRules.js).',
    ...assessItems({ register: read('data/rules/rights-rules.v1.json'), cases: read('data/rules/reference-cases.proposed.v1.json'), legal: read('data/rules/legal-articles.v1.json'),
      form: parseFormCsv(fs.readFileSync(path.join(root, 'docs/rules/D11_REVIEW_FORM.csv'), 'utf8')), archive, referenceDate }),
  };
  if (arg('--out')) fs.writeFileSync(String(arg('--out')), `${JSON.stringify(report, null, 1)}\n`);
  process.stdout.write(`D11_SOURCE_ASSERT ${JSON.stringify({ items: report.items, summary: report.summary, archive: report.archive.sha256.slice(0, 12) })}\n`);
  for (const r of report.rows.filter((x) => !['TEXT_CONFIRMED', 'METADATA_UNCHANGED', 'NOT_MACHINE_CHECKABLE'].includes(x.verdict))) {
    process.stdout.write(`  ${r.verdict.padEnd(18)} ${r.right}/${r.item_type}/${r.item_id}: ${r.checks.filter((c) => !['FOUND', 'UNCHANGED'].includes(c.result)).map((c) => `${c.check}${c.detail ? ` (${c.detail})` : ''}`).join('; ')}\n`);
  }
}
