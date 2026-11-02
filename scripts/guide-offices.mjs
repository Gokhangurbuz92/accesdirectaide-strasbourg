#!/usr/bin/env node
/**
 * R34 / D16 — writes data/reference/guide-offices.v1.json: for each curated official guide, the kinds of office its Service-Public sheet says to go to
 * (OuSAdresser / PivotLocal), translated into catalogue place types (api/lib/official-offices.js). Re-run with each new archive:
 *   node scripts/guide-offices.mjs <vosdroits.zip>
 */
import fs from 'node:fs';
import { loadArchive, readSource } from '../api/_services/verification/dila.js';
import { OFFICIAL_GUIDES } from './official-guides.mjs';
import { PIVOT_TYPES } from '../api/lib/official-offices.js';

export function guideOffices(archive) {
  const sheets = {};
  for (const e of OFFICIAL_GUIDES) {
    const src = readSource(e.id, archive); if (!src) continue;
    const pivots = [...new Set((src.whereToGo || []).map((w) => w.pivot).filter(Boolean))];
    const types = [...new Set(pivots.flatMap((p) => PIVOT_TYPES[p] || []))];
    if (types.length) sheets[e.id] = { pivots, types };
  }
  return { schema: 'ada-guide-offices/1', source: 'DILA vosdroits (Licence Ouverte 2.0), OuSAdresser/PivotLocal', archiveBuiltAt: archive.builtAt || null, sheets };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const zip = process.argv[2]; if (!zip) { console.error('usage: node scripts/guide-offices.mjs <vosdroits.zip>'); process.exit(2); }
  const out = guideOffices(loadArchive(new Uint8Array(fs.readFileSync(zip))));
  fs.writeFileSync('data/reference/guide-offices.v1.json', `${JSON.stringify(out, null, 1)}\n`);
  console.log(`GUIDE_OFFICES ${Object.keys(out.sheets).length} sheets`);
}
