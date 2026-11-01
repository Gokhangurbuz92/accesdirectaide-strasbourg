#!/usr/bin/env node
/**
 * R32 — benchmark of local translation engines on REAL verified AccesDirectAide text (no invented sentence).
 *
 *   node scripts/translation-benchmark.mjs --engines translategemma:4b,qwen3:8b [--n 30] [--langs en,tr,ar,de,uk] --out <result.json> [--csv <review.csv>]
 *
 * Corpus: translation units drawn from the published records (api/lib/contentTranslation.js FIELDS), stratified so that it contains negations,
 * numbers/amounts/dates/ages, uncertainty, official names and high-risk fields (conditions, documents, steps). Selection is deterministic (SHA-256
 * order). Each engine translates every unit into every language and back into French; the automatic checks (checkField) and the round-trip chrF
 * are recorded with latency. The CSV is for HUMAN review (columns left empty): automatic results are never presented as a human judgement.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { FIELDS, KINDS, checkField, protect, restore, unitsOf } from '../api/lib/contentTranslation.js';
import { Engine } from './lib/translation-engines.mjs';
import { publishedRecords } from './translate-content.mjs';

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const NEG = /(?<![\p{L}])(ne|n['’]|pas|jamais|aucun|sans|ni|non)(?![\p{L}])/iu;
const UNC = /(?<![\p{L}])(peut|pouvez|peuvent|pourrait|peut-être|éventuellement|selon|si vous)(?![\p{L}])/iu;
const NUM = /\d/;

export function buildCorpus(recordsByKind, n = 30) {
  const all = [];
  for (const [kind, records] of Object.entries(recordsByKind)) {
    for (const r of records) for (const [field, risk] of Object.entries(FIELDS[kind])) {
      for (const u of unitsOf(r[field]).units) {
        if (u.length < 25 || u.length > 700) continue;
        const tags = [NEG.test(u) && 'negation', NUM.test(u) && 'numbers', UNC.test(u) && 'uncertainty', protect(u).slots.length && 'names', risk === 'high' && 'high-risk'].filter(Boolean);
        all.push({ id: crypto.createHash('sha256').update(u).digest('hex').slice(0, 12), kind, slug: r.slug, field, risk, tags, text: u });
      }
    }
  }
  const seen = new Set(); const uniq = all.filter((x) => (seen.has(x.id) ? false : seen.add(x.id))).sort((a, b) => a.id.localeCompare(b.id));
  const pick = []; const want = ['negation', 'numbers', 'uncertainty', 'names', 'high-risk'];
  for (const tag of want) for (const x of uniq.filter((u) => u.tags.includes(tag))) { if (pick.filter((p) => p.tags.includes(tag)).length >= Math.ceil(n / want.length)) break; if (!pick.includes(x)) pick.push(x); }
  for (const x of uniq) { if (pick.length >= n) break; if (!pick.includes(x)) pick.push(x); }
  return pick.slice(0, n);
}

async function main() {
  const base = arg('base', 'https://www.accesdirectaide.fr');
  const langs = arg('langs', 'en,tr,ar,de,uk').split(',');
  const engines = arg('engines', 'translategemma:4b').split(',');
  const recordsByKind = {};
  for (const k of KINDS) recordsByKind[k] = await publishedRecords(base, k);
  const corpus = buildCorpus(recordsByKind, Number(arg('n', '30')));
  const rows = []; const summary = {};
  for (const model of engines) {
    const e = new Engine(model); const info = await e.describe(); summary[model] = { info, perLanguage: {} };
    for (const lang of langs) {
      const s = { units: 0, critical: 0, warnings: 0, byCheck: {}, roundtrip: [], ms: [] };
      for (const u of corpus) {
        const p = protect(u.text); const t0 = Date.now();
        const raw = await e.translate('fr', lang, p.text); const ms = Date.now() - t0;
        const r = restore(raw, p.slots, lang, new Set());
        const back = await e.translate(lang, 'fr', r.text);
        const c = checkField({ lang, risk: u.risk, source: u.text, target: r.text, back, missing: r.missing });
        s.units += 1; if (c.critical.length) s.critical += 1; if (c.warnings.length) s.warnings += 1;
        for (const x of [...c.critical, ...c.warnings]) s.byCheck[x] = (s.byCheck[x] || 0) + 1;
        s.roundtrip.push(c.roundtrip); if (ms > 5) s.ms.push(ms);
        rows.push({ engine: model, lang, unit: u.id, kind: u.kind, field: u.field, tags: u.tags.join('+'), source: u.text, target: r.text, back, critical: c.critical.join('+'), warnings: c.warnings.join('+'), roundtrip: c.roundtrip, ms });
      }
      const med = (a) => { const x = [...a].sort((p, q) => p - q); return x.length ? x[Math.floor(x.length / 2)] : null; };
      summary[model].perLanguage[lang] = { units: s.units, withCritical: s.critical, withWarnings: s.warnings, byCheck: s.byCheck, roundtripMedian: med(s.roundtrip), msMedian: med(s.ms) };
      console.log(`${model} ${lang}: critical ${s.critical}/${s.units}, warnings ${s.warnings}, chrF med ${med(s.roundtrip)}, ${med(s.ms)} ms/unit, checks ${JSON.stringify(s.byCheck)}`);
    }
    summary[model].stats = e.stats;
  }
  const out = { ranAt: new Date().toISOString(), base, corpus: corpus.map(({ text, ...x }) => ({ ...x, chars: text.length, sha256: crypto.createHash('sha256').update(text).digest('hex') })), summary, rows,
    note: 'Automatic checks and round-trip chrF only: they flag detectable errors and say nothing certain about meaning. Human review columns are in the CSV and empty.' };
  fs.writeFileSync(arg('out', 'translation-benchmark.json'), `${JSON.stringify(out, null, 1)}\n`);
  if (arg('csv')) {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['engine', 'lang', 'unit', 'kind', 'field', 'tags', 'source', 'target', 'back', 'critical', 'warnings', 'roundtrip', 'human_meaning_0_2', 'human_fluency_0_2', 'human_errors', 'reviewer', 'date'];
    fs.writeFileSync(arg('csv'), `${[head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n')}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.stack || e); process.exitCode = 1; });
