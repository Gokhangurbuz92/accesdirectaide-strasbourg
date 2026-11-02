#!/usr/bin/env node
/**
 * R39 — can a person find an official guide in THEIR language? Read-only and paced (the search allows 30 requests a minute).
 *   node scripts/acceptance/r39-multilingual-discovery.mjs [base] [--out result.json]
 * Each case is an everyday query in en / tr / ar / de / uk sent with that interface language; it passes when the expected Service-Public sheet is among the
 * first 3 guides returned (the cross-language search translates the query into French before ranking). Negative controls must not return the sheet.
 */
import fs from 'node:fs';
const base = (process.argv.find((a) => a.startsWith('http')) || 'https://www.accesdirectaide.fr').replace(/\/$/, '');
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
// [lang, query, sheet expected in the top 3 | null, sheet that must NOT appear | null]
export const CASES = [
  ['en', 'unpaid electricity bill', 'F20055'], ['en', 'housing benefit to pay my rent', 'F12006'], ['en', 'domestic violence', 'F12544'], ['en', 'abortion', 'F1551'],
  ['en', 'suicide prevention helpline', 'F33954'], ['en', 'carer leave to look after my mother', 'F16920'],
  ['tr', 'elektrik faturası ödenmedi', 'F20055'], ['tr', 'kira yardımı', 'F12006'], ['tr', 'aile içi şiddet', 'F12544'], ['tr', 'kürtaj', 'F1551'],
  ['ar', 'فاتورة الكهرباء غير مدفوعة', 'F20055'], ['ar', 'مساعدة السكن لدفع الإيجار', 'F12006'], ['ar', 'العنف الأسري', 'F12544'], ['ar', 'الإجهاض', 'F1551'],
  ['de', 'Stromrechnung unbezahlt', 'F20055'], ['de', 'Wohngeld für die Miete', 'F12006'], ['de', 'häusliche Gewalt', 'F12544'], ['de', 'Abtreibung', 'F1551'],
  ['uk', 'неоплачений рахунок за електрику', 'F20055'], ['uk', 'допомога на оплату житла', 'F12006'], ['uk', 'домашнє насильство', 'F12544'], ['uk', 'аборт', 'F1551'],
  // negative controls
  ['en', 'renew my passport', null, 'F1551'], ['de', 'Führerschein', null, 'F12544'], ['tr', 'pasaport yenileme', null, 'F20055'],
];
const sheet = (slug) => String(slug).split('-').pop().toUpperCase();
const h = await fetch(`${base}/api/health`); const cookie = (h.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; '); const token = /__csrf=([^;]+)/.exec(cookie)?.[1];
const rows = [];
for (const [lang, query, want, forbid = null] of CASES) {
  await new Promise((r) => setTimeout(r, 2500));
  const r = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token, cookie, origin: base }, body: JSON.stringify({ query, lang }) });
  const body = await r.json().catch(() => ({}));
  const got = (body.guides || []).map((g) => sheet(g.slug));
  const pass = r.status === 200 && (want ? got.slice(0, 3).includes(want) : true) && (!forbid || !got.includes(forbid));
  rows.push({ lang, query, want, forbid, http: r.status, got: got.slice(0, 5), translated: body.crossLanguage?.query || null, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${lang} « ${query} » → ${want || `not ${forbid}`} ; got [${got.slice(0, 3).join(' ')}]${body.crossLanguage?.query ? ` (fr: ${body.crossLanguage.query})` : ' (no translation)'}`);
}
const summary = { base, at: new Date().toISOString(), pass: rows.filter((x) => x.pass).length, fail: rows.filter((x) => !x.pass).length,
  byLang: Object.fromEntries(['en', 'tr', 'ar', 'de', 'uk'].map((l) => [l, `${rows.filter((x) => x.lang === l && x.pass).length}/${rows.filter((x) => x.lang === l).length}`])) };
console.log(`R39_MULTILINGUAL_DISCOVERY ${JSON.stringify(summary)}`);
if (out) fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
process.exit(summary.fail ? 1 : 0);
