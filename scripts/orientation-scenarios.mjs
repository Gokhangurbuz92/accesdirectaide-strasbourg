#!/usr/bin/env node
/**
 * Extension R32 — runs the cross-domain orientation scenarios (data/reference/orientation-scenarios.v1.json) against the public search of a running
 * site, read-only and paced (the search allows 30 requests a minute): node scripts/orientation-scenarios.mjs [base] [--out result.json]
 * Records, per scenario, what each section returned, whether one returned record contains an expected word, and whether an abstention was honest.
 */
import fs from 'node:fs';
const base = (process.argv.find((a) => a.startsWith('http')) || 'https://www.accesdirectaide.fr').replace(/\/$/, '');
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const set = JSON.parse(fs.readFileSync('data/reference/orientation-scenarios.v1.json', 'utf8'));
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const res = await fetch(`${base}/api/health`); const cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; '); const token = /__csrf=([^;]+)/.exec(cookie)?.[1];
const rows = [];
for (const s of set.scenarios) {
  await new Promise((r) => setTimeout(r, 2500));
  const r = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token, cookie, origin: base }, body: JSON.stringify({ query: s.query, lang: s.lang }) });
  const body = await r.json().catch(() => ({}));
  const all = ['items', 'demarches', 'structures', 'actualites', 'guides'].flatMap((k) => (Array.isArray(body[k]) ? body[k].map((x) => ({ k, type: x.type_structure || x.category || null, title: x.titre || x.nom || x.title || '', text: `${x.titre || x.nom || x.title || ''} ${x.description_courte || x.cest_quoi || x.resume || x.description || ''} ${x.type_structure || ''}`, slug: x.slug })) : []));
  const relevant = all.filter((x) => s.words.some((w) => fold(x.text).includes(fold(w))));
  // expectType: the scenario asks for a KIND of office — a place of another kind that merely mentions it does not count
  const typed = s.expectType ? all.filter((x) => x.k === 'structures' && x.type === s.expectType) : null;
  // R34: expectSafety — the emergency number the search must show first (false: no emergency block at all)
  const nums = body.safety?.numbers || [];
  const safetyOk = s.expectSafety === undefined ? true : s.expectSafety === false ? nums.length === 0 : nums.includes(s.expectSafety);
  // R34: places — at least minStructures of them, and none of rejectTypes among the first 3 (a place whose NAME merely contains the word)
  const places = all.filter((x) => x.k === 'structures');
  const placesOk = (!s.minStructures || places.length >= s.minStructures) && !(s.rejectTypes || []).some((t) => places.slice(0, 3).some((x) => x.type === t));
  const pass = safetyOk && placesOk && (s.expect === 'any' ? true : s.expect === 'abstain' ? all.length === 0 : typed ? typed.length > 0 : relevant.length > 0);
  rows.push({ id: s.id, query: s.query, lang: s.lang, http: r.status, expect: s.expect, expectType: s.expectType || null, typed: typed ? typed.length : null, safety: nums, returned: all.length, relevant: relevant.length, crossLanguage: body.crossLanguage || null, sample: relevant.slice(0, 3).map((x) => `${x.k}:${x.slug}`), pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} #${s.id} ${s.lang} « ${s.query} » → ${all.length} returned, ${relevant.length} relevant`);
}
console.log(`SCENARIOS ${JSON.stringify({ pass: rows.filter((x) => x.pass).length, total: rows.length })}`);
if (out) fs.writeFileSync(out, `${JSON.stringify({ base, ranAt: new Date().toISOString(), rows }, null, 1)}\n`);
