#!/usr/bin/env node
/**
 * G3 (19/11/2026) — writes the public sub-graph of the Rights Graph for the anonymous page /droits (api/lib/rightsPublicView.js; owner decision C4: no D11
 * rule, no condition). Pure and offline: reads the graph's data files, data/reference/guide-offices.v1.json and data/reference/published-guides.v1.json.
 * The page imports the JSON at build time, so the visitor sends nothing. tests/unit/g3-rights-public-view.test.js fails when the committed file is stale.
 *   node scripts/rights-public-view.mjs [--check]        (--check: exit 1 when data/reference/rights-public-view.v1.json differs, nothing written)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRightsGraph } from '../api/lib/rightsGraph.js';
import { publicRightsView } from '../api/lib/rightsPublicView.js';
import { isMainModule } from './lib/is-main.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = 'data/reference/rights-public-view.v1.json';

/** the JSON text of the public view, as committed @param {string} [root] */
export function renderPublicView(root = ROOT) {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  const { graph } = loadRightsGraph(root);
  const view = publicRightsView(graph, { offices: read('data/reference/guide-offices.v1.json'), guides: read('data/reference/published-guides.v1.json') });
  return `${JSON.stringify(view, null, 1)}\n`;
}

if (isMainModule(import.meta.url)) {
  const text = renderPublicView();
  const file = path.join(ROOT, OUT);
  const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
  if (process.argv.includes('--check')) {
    console.log(same ? `${OUT} up to date` : `${OUT} is stale: run node scripts/rights-public-view.mjs`);
    process.exit(same ? 0 : 1);
  }
  if (!same) fs.writeFileSync(file, text);
  console.log(`${OUT} ${same ? 'unchanged' : 'written'}`);
}
