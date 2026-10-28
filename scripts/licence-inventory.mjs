#!/usr/bin/env node
/**
 * Maintainability (Q09) — the licences of what ships: every package of the PRODUCTION dependency tree (npm ls --omit=dev, the lockfile's resolution) with its
 * declared licence, read from the installed package. Writes docs/reports/licences-production.json and prints the count per licence; a package whose
 * licence is copyleft (GPL / AGPL / LGPL / SSPL / EUPL / CC-BY-SA), missing or « UNLICENSED » is listed for a person to review — the script decides nothing.
 * The data the product publishes have their own licences (Licence Ouverte 2.0 for the official sources), recorded with each source (SourceRegistryEntry).
 *   node scripts/licence-inventory.mjs [--check]   --check: exit 1 when a package needs a review
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json', '--long'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
const seen = new Map();
(function walk(deps, at) {
  for (const [name, d] of Object.entries(deps || {})) {
    const key = `${name}@${d.version}`;
    if (!seen.has(key) && d.version) {
      const dir = d.path || path.join(at, 'node_modules', name);
      let licence = null; let repo = null;
      try { const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); licence = typeof pj.license === 'string' ? pj.license : pj.license?.type || (Array.isArray(pj.licenses) ? pj.licenses.map((l) => l.type || l).join(' OR ') : null); repo = typeof pj.repository === 'string' ? pj.repository : pj.repository?.url || null; } catch { /* not installed here */ }
      seen.set(key, { name, version: d.version, licence, repository: repo });
    }
    walk(d.dependencies, d.path || path.join(at, 'node_modules', name));
  }
})(tree.dependencies, ROOT);
const items = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
const REVIEW = /(^|[^L])GPL|AGPL|LGPL|SSPL|EUPL|CC-BY-SA|UNLICENSED/i;
const review = items.filter((i) => !i.licence || REVIEW.test(i.licence));
const byLicence = {}; for (const i of items) byLicence[i.licence || '(non déclarée)'] = (byLicence[i.licence || '(non déclarée)'] || 0) + 1;
const out = { generatedAt: new Date().toISOString(), scope: 'npm ls --omit=dev --all (production dependency tree)', packages: items.length, byLicence, toReview: review, items };
fs.mkdirSync(path.join(ROOT, 'docs', 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'reports', 'licences-production.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`${items.length} paquets de production :`, Object.entries(byLicence).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(', '));
console.log(review.length ? `À revoir par une personne (${review.length}) : ${review.map((r) => `${r.name}@${r.version} (${r.licence || 'non déclarée'})`).join(', ')}` : 'Aucune licence copyleft ou absente.');
if (process.argv.includes('--check') && review.length) process.exit(1);
