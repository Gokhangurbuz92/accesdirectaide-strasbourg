#!/usr/bin/env node
/**
 * R34 / D16 — an evaluation of the place search whose EXPECTED answers come from the administration, not from AccesDirectAide: each official Service-Public
 * sheet says where to go (OuSAdresser / PivotLocal: caf, cpam, mairie, cidf, mjd…). For every published guide built from such a sheet, the search is asked
 * the sheet's own title and must return, among its places, an office of a kind the sheet names — when the catalogue holds offices of that kind at all.
 *   node scripts/acceptance/r34-d16-official-office.mjs <vosdroits.zip> [base] [--out result.json]
 * Read-only and paced (the search allows 30 requests a minute). The mapping below translates the Annuaire's pivot codes into the catalogue's type labels.
 */
import fs from 'node:fs';
import { loadArchive, readSource } from '../../api/_services/verification/dila.js';
import { OFFICIAL_GUIDES } from '../official-guides.mjs';

import { PIVOT_TYPES } from '../../api/lib/official-offices.js';

const args = process.argv.slice(2);
const zip = args.find((a) => a.endsWith('.zip'));
const base = (args.find((a) => a.startsWith('http')) || 'https://www.accesdirectaide.fr').replace(/\/$/, '');
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
if (!zip) { console.error('usage: node scripts/acceptance/r34-d16-official-office.mjs <vosdroits.zip> [base] [--out f.json]'); process.exit(2); }
const archive = loadArchive(new Uint8Array(fs.readFileSync(zip)));

const r0 = await fetch(`${base}/api/health`); const cookie = (r0.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; '); const token = /__csrf=([^;]+)/.exec(cookie)?.[1];
const rows = [];
for (const e of OFFICIAL_GUIDES) {
  const src = readSource(e.id, archive); if (!src) continue;
  const pivots = [...new Set((src.whereToGo || []).map((w) => w.pivot).filter(Boolean))];
  const expected = [...new Set(pivots.flatMap((p) => PIVOT_TYPES[p] || []))];
  if (!expected.length) { rows.push({ id: e.id, title: src.title, pivots, expected, verdict: 'NO_OFFICE_IN_SHEET_OR_CATALOGUE' }); continue; }
  await new Promise((r) => setTimeout(r, 2500));
  const res = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token, cookie, origin: base }, body: JSON.stringify({ query: src.title, lang: 'fr' }) });
  const body = await res.json().catch(() => ({}));
  const types = (body.structures || []).map((s) => s.category || s.type_structure);
  const hit = types.some((t) => expected.includes(t));
  rows.push({ id: e.id, title: src.title, pivots, expected, http: res.status, returned: types, verdict: res.status !== 200 ? 'HTTP_ERROR' : hit ? 'PASS' : types.length ? 'WRONG_KIND' : 'NO_PLACE' });
  console.log(`${rows.at(-1).verdict.padEnd(10)} ${e.id} « ${src.title.slice(0, 60)} » expected [${expected.join(' | ')}] got [${types.join(' | ')}]`);
}
// phase 2 — the same expected offices, asked in a person's own words (not the sheet's title): the search must not depend on official wording
const EVERYDAY = { F2094: 'curatelle', F31272: 'expulsion loyer impayé', F32037: 'APL', F827: 'déménagement prévenir la caf', F17048: 'contrat intégration',
  F34049: 'carte stationnement handicapé', F16670: 'mandat protection future', F20789: 'victime agression porter plainte', F952: 'enfant maltraité',
  F861: 'maltraitance personne âgée', F2018: 'foyer jeunes travailleurs', F37501: 'adapter logement personne âgée', F17317: 'domiciliation sans domicile',
  F20849: 'médiateur assurance maladie', F12544: 'violences conjugales' };
for (const r of rows.filter((x) => x.expected.length && EVERYDAY[x.id])) {
  await new Promise((res) => setTimeout(res, 2500));
  const res = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token, cookie, origin: base }, body: JSON.stringify({ query: EVERYDAY[r.id], lang: 'fr' }) });
  const body = await res.json().catch(() => ({}));
  const types = (body.structures || []).map((s) => s.category || s.type_structure);
  r.everyday = { query: EVERYDAY[r.id], returned: types, verdict: res.status !== 200 ? 'HTTP_ERROR' : types.some((t) => r.expected.includes(t)) ? 'PASS' : types.length ? 'WRONG_KIND' : 'NO_PLACE' };
  console.log(`${r.everyday.verdict.padEnd(10)} ${r.id} « ${EVERYDAY[r.id]} » expected [${r.expected.join(' | ')}] got [${types.join(' | ')}]`);
}
const scored = rows.filter((r) => r.verdict !== 'NO_OFFICE_IN_SHEET_OR_CATALOGUE');
const summary = { base, at: new Date().toISOString(), sheets: rows.length, scored: scored.length, pass: scored.filter((r) => r.verdict === 'PASS').length,
  wrongKind: scored.filter((r) => r.verdict === 'WRONG_KIND').length, noPlace: scored.filter((r) => r.verdict === 'NO_PLACE').length, httpError: scored.filter((r) => r.verdict === 'HTTP_ERROR').length,
  everyday: { scored: scored.filter((r) => r.everyday).length, pass: scored.filter((r) => r.everyday?.verdict === 'PASS').length } };
console.log(`D16_OFFICIAL_OFFICE ${JSON.stringify(summary)}`);
if (out) fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
