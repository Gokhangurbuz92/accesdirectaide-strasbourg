// PKG-5 / WS2 — versioned launch-data release: node --import tsx scripts/ws2-launch-release.mjs --out <new directory>
// Copies the launch datasets into a NEW directory (refused if it exists or lies inside data/) and sets verifiedCurrent / launchEligible from the
// content-verification LEDGER ONLY: a row is verifiedCurrent=true only when its database record's latest decision is VERIFIED (named MFA reviewer,
// official source). The self-declared flags of the source CSVs are never carried over. The shipped data/ files are never written.
// Then runs the WS2 verifier on the new directory and records its result. RELEASE_MANIFEST.json keeps input/output sha256 and the decisions used
// (outcome, date, source — never the reviewer's identity). Reads DATABASE_URL from the environment; prints counters only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, verifyWs2Data } from './verify-ws2-data.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATASETS = { aides: 'data/aides-alsace.csv', demarches: 'data/demarches-alsace.csv', structures: 'data/structures-alsace.csv' };
const COPIED = ['data/strasbourg/service-public-demarches.snapshot.json', 'data/strasbourg/ws2-source-manifest.json'];
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * Pure part: given the queue states (Map "dataset:slug" -> { state, decision }), write the release into outDir.
 * @param {{ root?: string, outDir: string, states: Map<string, { state: string, decision: any, entityType?: string }>, generatedAt?: string }} input
 */
export async function buildRelease({ root = REPO_ROOT, outDir, states, generatedAt = new Date().toISOString() }) {
  const out = path.resolve(outDir); const rootAbs = path.resolve(root);
  if (out === rootAbs || out.startsWith(path.join(rootAbs, 'data') + path.sep) || out === path.join(rootAbs, 'data')) throw Object.assign(new Error('WS2_RELEASE_OUT_INSIDE_DATA'), { code: 'WS2_RELEASE_OUT_INSIDE_DATA' });
  if (fs.existsSync(out)) throw Object.assign(new Error('WS2_RELEASE_OUT_EXISTS'), { code: 'WS2_RELEASE_OUT_EXISTS' });
  fs.mkdirSync(path.join(out, 'data/strasbourg'), { recursive: true });
  const inputs = {}; const outputs = {}; const counts = {}; const decisions = [];
  for (const [dataset, rel] of Object.entries(DATASETS)) {
    const raw = fs.readFileSync(path.join(rootAbs, rel), 'utf8'); inputs[rel] = sha(raw);
    const rows = parseCsv(raw); const headers = Object.keys(rows[0] || {});
    let verified = 0; let carriedSelfDeclared = 0;
    const lines = [headers.map(cell).join(',')];
    for (const row of rows) {
      const st = states.get(`${dataset}:${row.slug}`);
      const ok = st?.state === 'HUMAN_VERIFIED';
      if (String(row.verifiedCurrent).trim().toLowerCase() === 'true' && !ok) carriedSelfDeclared += 1;
      if (ok) { verified += 1; decisions.push({ dataset, slug: row.slug, outcome: st.decision?.outcome, verifiedAt: st.decision?.at, source: st.decision?.source || null }); }
      const next = { ...row, verifiedCurrent: ok ? 'true' : 'false', launchEligible: ok && String(row.launchEligible).trim().toLowerCase() === 'true' ? 'true' : 'false' };
      lines.push(headers.map((h) => cell(next[h])).join(','));
    }
    const text = lines.join('\n') + '\n'; fs.writeFileSync(path.join(out, rel), text); outputs[rel] = sha(text);
    counts[dataset] = { rows: rows.length, humanVerified: verified, selfDeclaredFlagsDropped: carriedSelfDeclared };
  }
  for (const rel of COPIED) { const buf = fs.readFileSync(path.join(rootAbs, rel)); inputs[rel] = sha(buf); fs.writeFileSync(path.join(out, rel), buf); outputs[rel] = sha(buf); }
  let verifier;
  try { verifier = { pass: true, result: await verifyWs2Data({ rootDir: out }) }; }
  catch (error) { verifier = { pass: false, code: String(error?.message || error?.code || 'WS2_VERIFY_FAILED').slice(0, 200) }; }
  const manifest = { schema: 'ada.ws2.launch-release.v1', generatedAt, rule: 'verifiedCurrent=true only for rows whose database record has a latest content-verification decision VERIFIED; source CSV flags ignored',
    inputs, outputs, counts, decisions, verifier, shippedDataUntouched: true };
  fs.writeFileSync(path.join(out, 'RELEASE_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

async function main() {
  const i = process.argv.indexOf('--out'); const outDir = i > 0 ? process.argv[i + 1] : '';
  if (!outDir) { process.stderr.write('usage: scripts/ws2-launch-release.mjs --out <new directory>\n'); process.exit(2); }
  const { ws2Queue } = await import('../api/_services/ws2-review.js');
  const q = await ws2Queue({ root: REPO_ROOT });
  const states = new Map(q.records.map((r) => [`${r.dataset}:${r.slug}`, { state: r.state, decision: r.decision }]));
  const m = await buildRelease({ outDir, states });
  process.stdout.write(JSON.stringify({ counts: m.counts, verifier: m.verifier.pass ? 'PASS' : m.verifier.code }) + '\n');
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { process.stderr.write(`${e?.code || 'WS2_RELEASE_FAILED'}\n`); process.exit(1); });
