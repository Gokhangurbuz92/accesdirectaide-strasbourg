#!/usr/bin/env node
/**
 * R37 — multi-need orientation and eligibility cautions, through the real search API. Read-only and paced (the search allows 30 requests a minute).
 *   node scripts/acceptance/r37-orientation.mjs [base] [--out result.json]
 * Per case: the needs found (in order of urgency), the cautions, and the aides: an aide whose condition the person's words put in doubt (APL/ALS without a
 * residence permit or without a home, RSA under 25 or for « isolé » in the sense of loneliness) must never rank above an aide without such a doubt, and
 * must carry its caution. Negative controls: a query that describes no need of the list gets no orientation.
 */
import fs from 'node:fs';
const base = (process.argv.find((a) => a.startsWith('http')) || 'https://www.accesdirectaide.fr').replace(/\/$/, '');
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const HOUSING = /aide personnalis[ée]e au logement|\(apl\)|allocation de logement|\(als\)|\(alf\)/i; const RSA = /revenu de solidarit[ée] active|\(rsa\)|prime d.activit[ée]/i;
// [query, needs expected in this order (prefix), cautions expected, aide pattern that must not lead the aides unless cautioned, sheets expected]
const CASES = [
  // the four R36 failures
  ['Je suis sans titre de séjour et sans logement.', ['hebergement-urgence', 'droits-sans-titre'], ['permit-housing-aid', 'no-home-housing-aid'], HOUSING, ['F3079', 'F2003']],
  ['Je suis isolé et déprimé.', ['psy', 'isolement'], ['isolated-meaning'], RSA, ['F34917']],
  ['J’ai des dettes et on va me couper l’électricité.', ['energie', 'surendettement'], [], null, ['F20055', 'F1334', 'F134']],
  ['Je sors de l’ASE à 18 ans et je n’ai pas de logement.', ['hebergement-urgence', 'sortie-ase'], ['no-home-housing-aid', 'under-25-rsa'], HOUSING, ['F2018']],
  // the directive's multi-need situations
  ['loyer impayé, on va me couper l’électricité et j’ai deux enfants', ['energie', 'expulsion-impayes', 'prestations-familiales'], [], null, ['F31272']],
  ['aidant épuisé, ma mère âgée ne peut plus rester seule à domicile', ['aidants', 'aide-domicile'], [], null, ['F245']],
  ['je sors de l’ASE, j’ai 18 ans, pas de logement et très peu de revenus', ['hebergement-urgence', 'sortie-ase'], ['no-home-housing-aid', 'under-25-rsa'], HOUSING, []],
  ['je suis au chômage, j’ai des dettes et je risque de perdre mon logement', ['expulsion-impayes', 'surendettement', 'recherche-emploi'], [], null, ['F134']],
  ['je me sens isolé et j’ai des idées noires', ['psy', 'isolement'], [], null, []],
  ['handicap et difficultés pour me déplacer en transport', ['accessibilite-mobilite'], [], null, ['F34049']],
  ['je n’ai pas de papiers et je dois me soigner', ['droits-sans-titre'], ['permit-housing-aid'], HOUSING, ['F3079']],
  ['violences conjugales, je dois quitter le logement', ['violences-conjugales', 'hebergement-urgence'], [], null, ['F12544']],
  // the question when the words do not say it
  ['je suis étranger et je cherche un logement', [], [], null, [], 'permit'],
  // negative controls
  ['renouveler ma carte d’identité', null], ['horaires de la mairie de Strasbourg', null], ['curatelle', null],
];
const h = await fetch(`${base}/api/health`); const cookie = (h.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; '); const token = /__csrf=([^;]+)/.exec(cookie)?.[1];
const rows = [];
for (const [query, needs, cautions = [], leadPattern = null, sheets = [], question = null] of CASES) {
  await new Promise((r) => setTimeout(r, 2500));
  const r = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token, cookie, origin: base }, body: JSON.stringify({ query, lang: 'fr' }) });
  const j = await r.json().catch(() => ({}));
  const o = j.orientation || null; const gotNeeds = (o?.needs || []).map((n) => n.id); const gotCautions = (o?.cautions || []).map((c) => c.id);
  const aides = (j.items || []).map((x) => ({ title: x.title, cautions: x.cautions || [] }));
  const gotSheets = (o?.needs || []).flatMap((n) => [...n.sheets, ...n.rules.map((x) => x.sheet)]);
  const checks = needs === null ? { noOrientation: !o } : {
    needsInOrder: JSON.stringify(gotNeeds.slice(0, needs.length)) === JSON.stringify(needs),
    cautions: cautions.every((c) => gotCautions.includes(c)),
    sheets: sheets.every((s) => gotSheets.includes(s)),
    // an aide the words put in doubt is never above one they do not, and it carries its caution
    cautionedAidesLast: !leadPattern || aides.every((a, i) => !leadPattern.test(a.title) || (a.cautions.length > 0 && aides.slice(i + 1).every((b) => b.cautions.length > 0))),
    question: !question || (o?.questions || []).some((q) => q.id === question),
  };
  const pass = r.status === 200 && Object.values(checks).every(Boolean);
  rows.push({ query, http: r.status, pass, checks, needs: gotNeeds, cautions: gotCautions, aides: aides.slice(0, 5), guides: (j.guides || []).slice(0, 3).map((g) => g.slug) });
  console.log(`${pass ? 'PASS' : 'FAIL'} « ${query} » needs [${gotNeeds.join(' ')}] cautions [${gotCautions.join(' ')}] aides [${aides.slice(0, 4).map((a) => `${a.title.slice(0, 28)}${a.cautions.length ? '⚠' : ''}`).join(' | ')}]${pass ? '' : ' ' + JSON.stringify(checks)}`);
}
const summary = { base, at: new Date().toISOString(), pass: rows.filter((x) => x.pass).length, fail: rows.filter((x) => !x.pass).length };
console.log(`R37_ORIENTATION ${JSON.stringify(summary)}`);
if (out) fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
process.exit(summary.fail ? 1 : 0);
