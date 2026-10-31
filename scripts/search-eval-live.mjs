#!/usr/bin/env node
/**
 * D16 (R31) — runs the catalogue query set (data/search-eval/retrieval-eval.v2.catalogue.json) against the public search of a running site, read-only:
 * one POST /api/search per query (the same call as the search page, CSRF included), nothing written.
 *   node scripts/search-eval-live.mjs [https://www.accesdirectaide.fr] [--out result.json] [--review review.csv]
 * Reports recall@5 and MRR per section against the ENGINEERING-PROPOSED labels, the results shown for vague and off-topic queries, and writes a review
 * file (one row per result shown) for a human to grade 0 / 1 / 2. Machine labels and human grades are kept apart: the score is never presented as validated.
 */
import fs from 'node:fs';

const SECTIONS = { aide: 'items', demarche: 'demarches', structure: 'structures' };
const K = 5;

/** labels a result list matches, per section @returns {{ recall: number|null, rr: number|null, hits: string[] }} */
export function scoreSection(kind, results, labels) {
  const mine = labels.filter((l) => l.kind === kind && l.grade >= 1);
  if (!mine.length) return { recall: null, rr: null, hits: [] };
  const top = results.slice(0, K).map((r) => String(r.slug || r.id));
  const matches = (l, s) => (l.slug ? s === l.slug : s.startsWith(l.slugPrefix));
  const found = mine.filter((l) => top.some((s) => matches(l, s)));
  const first = top.findIndex((s) => mine.some((l) => matches(l, s)));
  return { recall: found.length / mine.length, rr: first >= 0 ? 1 / (first + 1) : 0, hits: found.map((l) => l.slug || `${l.slugPrefix}*`) };
}

/** aggregate of the per-query scores (pure) */
export function summarize(rows) {
  const out = {};
  for (const kind of Object.keys(SECTIONS)) {
    const s = rows.flatMap((r) => (r.scores[kind]?.recall === null || r.scores[kind] === undefined ? [] : [r.scores[kind]]));
    out[kind] = s.length ? { queries: s.length, recallAt5: Math.round((s.reduce((a, x) => a + x.recall, 0) / s.length) * 1000) / 1000, mrr: Math.round((s.reduce((a, x) => a + x.rr, 0) / s.length) * 1000) / 1000 } : null;
  }
  const all = rows.flatMap((r) => Object.values(r.scores).filter((x) => x.recall !== null));
  out.all = all.length ? { pairs: all.length, recallAt5: Math.round((all.reduce((a, x) => a + x.recall, 0) / all.length) * 1000) / 1000, mrr: Math.round((all.reduce((a, x) => a + x.rr, 0) / all.length) * 1000) / 1000 } : null;
  out.misses = rows.filter((r) => Object.values(r.scores).some((x) => x.recall === 0)).map((r) => r.id);
  out.abstention = rows.filter((r) => r.category === 'abstention').map((r) => ({ id: r.id, shown: r.shown }));
  return out;
}

async function session(base) {
  const res = await fetch(`${base}/api/health`, { redirect: 'follow' });
  const cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const token = /__csrf=([^;]+)/.exec(cookie)?.[1];
  if (!token) throw new Error('no CSRF cookie from /api/health');
  return { cookie, token };
}

async function main() {
  const args = process.argv.slice(2);
  const base = (args.find((a) => a.startsWith('http')) || 'https://www.accesdirectaide.fr').replace(/\/$/, '');
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const set = JSON.parse(fs.readFileSync(new URL('../data/search-eval/retrieval-eval.v2.catalogue.json', import.meta.url), 'utf8'));
  const { cookie, token } = await session(base);
  const rows = []; const review = [['query_id', 'query', 'section', 'rank', 'slug', 'title', 'engineering_label', 'human_grade_0_1_2', 'reviewer', 'date']];
  for (const q of set.queries) {
    const res = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token, cookie, origin: base }, body: JSON.stringify({ query: q.query }) });
    const body = await res.json().catch(() => ({}));
    const scores = {}; let shown = 0;
    for (const [kind, key] of Object.entries(SECTIONS)) {
      const list = Array.isArray(body[key]) ? body[key] : [];
      shown += Math.min(list.length, K);
      scores[kind] = scoreSection(kind, list, q.labels);
      list.slice(0, K).forEach((r, i) => {
        const slug = String(r.slug || r.id);
        const label = q.labels.find((l) => l.kind === kind && (l.slug ? l.slug === slug : slug.startsWith(l.slugPrefix)));
        review.push([q.id, q.query, kind, i + 1, slug, r.title || r.titre || r.nom || '', label ? `grade ${label.grade}` : 'non étiqueté', '', '', '']);
      });
    }
    rows.push({ id: q.id, query: q.query, category: q.category, http: res.status, shown, scores });
  }
  const result = { set: set.schema, labelStatus: set.labelStatus, base, ranAt: new Date().toISOString(), queries: rows.length, summary: summarize(rows), rows };
  const text = JSON.stringify(result, null, 2);
  if (opt('--out')) fs.writeFileSync(opt('--out'), `${text}\n`);
  if (opt('--review')) fs.writeFileSync(opt('--review'), `${review.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n')}\n`);
  console.log(JSON.stringify({ base, summary: result.summary }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
