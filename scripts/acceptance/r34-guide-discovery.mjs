#!/usr/bin/env node
/**
 * R34 — can a person FIND each published official guide with their own words? Read-only and paced (the search allows 30 requests a minute).
 *   node scripts/acceptance/r34-guide-discovery.mjs [base] [--out result.json]
 * A query passes when the expected sheet is among the first 3 guides returned. Negative controls: a query on another subject must NOT return the sheet.
 */
import fs from 'node:fs';
const base = (process.argv.find((a) => a.startsWith('http')) || 'https://www.accesdirectaide.fr').replace(/\/$/, '');
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
// [query, sheet expected in the top 3 | null, sheet that must NOT appear | null]
export const CASES = [
  ['curatelle', 'F2094'], ['tutelle de ma mère', 'F2120'], ['différence tutelle curatelle', 'F10424'], ['sauvegarde de justice', 'F2075'],
  ['habilitation familiale', 'F33367'], ['mandat de protection future', 'F16670'], ['violences conjugales', 'F12544'], ['mon mari me frappe', 'F12544'],
  ['victime agression porter plainte', 'F20789'], ['harcèlement sexuel', 'F1043'], ['harcèlement moral au travail', 'F2354'], ['enfant maltraité', 'F952'],
  ['maltraitance personne âgée', 'F861'], ['directives anticipées', 'F32010'], ['soins palliatifs', 'F39676'], ['allocation fin de vie', 'F706'],
  ['contraception', 'F707'], ['IVG', 'F1551'], ['avortement', 'F1551'], ['psychologue remboursé', 'F34917'], ['foyer jeunes travailleurs', 'F2018'],
  ['adapter logement personne âgée', 'F37501'], ['aide garde enfant', 'F38243'], ['mineur isolé titre de séjour majorité', 'F31037'],
  ['contrat intégration républicaine', 'F17048'], ['insertion par l\'activité économique', 'F2284'], ['carte mobilité inclusion', 'F34049'], ['carte stationnement handicapé', 'F34049'],
  // negative controls
  ['renouveler carte d\'identité', null, 'F1551'], ['facture électricité impayée', null, 'F2094'], ['ouvrir un compte bancaire', null, 'F12544'],
];
const res = await fetch(`${base}/api/health`); const cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; '); const token = /__csrf=([^;]+)/.exec(cookie)?.[1];
const rows = [];
for (const [query, want, forbid] of CASES) {
  await new Promise((r) => setTimeout(r, 2500));
  const r = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token, cookie, origin: base }, body: JSON.stringify({ query, lang: 'fr' }) });
  const body = await r.json().catch(() => ({}));
  const got = (body.guides || []).map((g) => String(g.slug).split('-').pop().toUpperCase());
  const rank = want ? got.indexOf(want) + 1 : 0;
  const pass = r.status === 200 && (want ? rank >= 1 && rank <= 3 : !got.includes(forbid));
  rows.push({ query, http: r.status, want, forbid: forbid || null, rank: rank || null, got: got.slice(0, 5), pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} « ${query} » ${want ? `→ ${want} rank ${rank || '-'}` : `must not return ${forbid}`} [${got.slice(0, 5).join(' ')}]${r.status !== 200 ? ` HTTP ${r.status}` : ''}`);
}
const summary = { base, at: new Date().toISOString(), pass: rows.filter((x) => x.pass).length, fail: rows.filter((x) => !x.pass).length };
console.log(`GUIDE_DISCOVERY ${JSON.stringify(summary)}`);
if (out) fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
process.exit(summary.fail ? 1 : 0);
