#!/usr/bin/env node
/**
 * D11 (R31) — re-reads every official page the rules register cites (data/rules/rights-rules.v1.json) and compares the page's own « Vérifié le » date with
 * the date the register recorded. A changed date means the page was revised: the register and the expert review pack must be re-read for that right before
 * any validation. Read-only; one request per page; prints a JSON report (and writes it with --out <file>).
 *   node scripts/d11-source-check.mjs [--out report.json]
 */
import fs from 'node:fs';

const MONTHS = { janvier: '01', février: '02', fevrier: '02', mars: '03', avril: '04', mai: '05', juin: '06', juillet: '07', août: '08', aout: '08', septembre: '09', octobre: '10', novembre: '11', décembre: '12', decembre: '12' };
/** « Vérifié le 01 avril 2026 » → 2026-04-01 (Service-Public); null when the page carries no such line */
export function pageVerifiedOn(html) {
  const m = String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\s+/g, ' ').match(/V[ée]rifi[ée] le (\d{1,2}) ([a-zéû]+) (\d{4})/i);
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
}

async function main() {
  const register = JSON.parse(fs.readFileSync(new URL('../data/rules/rights-rules.v1.json', import.meta.url), 'utf8'));
  const out = { checkedAt: new Date().toISOString(), pages: [] };
  for (const right of register.rights) {
    for (const s of right.sources) {
      const row = { right: right.id, url: s.url, recorded: s.pageVerifiedOn || null };
      try {
        const res = await fetch(s.url, { headers: { 'user-agent': 'AccesDirectAide-verification/1.0 (+https://www.accesdirectaide.fr)' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
        row.http = res.status;
        const html = await res.text();
        row.current = pageVerifiedOn(html);
        row.verdict = res.status !== 200 ? 'UNREACHABLE' : !row.recorded && !row.current ? 'NO_DATE_ON_PAGE' : row.current === row.recorded ? 'UNCHANGED' : row.current ? 'REVISED' : 'DATE_NOT_FOUND';
      } catch (e) { row.verdict = 'UNREACHABLE'; row.error = e?.name || 'error'; }
      out.pages.push(row);
    }
  }
  out.summary = out.pages.reduce((a, p) => ({ ...a, [p.verdict]: (a[p.verdict] || 0) + 1 }), {});
  const text = JSON.stringify(out, null, 2);
  const i = process.argv.indexOf('--out');
  if (i > 0) fs.writeFileSync(process.argv[i + 1], `${text}\n`);
  console.log(text);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
