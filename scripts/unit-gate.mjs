#!/usr/bin/env node
/**
 * Q08 — the unit-test gate of a release. Every unit test must pass, except the declared KNOWN_FAILURES: tests that read LAB evidence the public
 * repository does not contain (WS2/WS8 data). A known failure that starts passing is reported so the list can shrink; any other failure stops the release.
 *
 *   node scripts/unit-gate.mjs            → exit 0 when the gate passes, 1 otherwise
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const KNOWN_FAILURES = [
  'tests/unit/dta-s4a-ws2-findings.test.js > the real LAB data (ratchet; technical findings only) > stays fail-closed and the counts match the closure matrix',
  'tests/unit/dta-s6-ws2-closure-register.test.js > WS2 closure register (real LAB data) > 49 records, unique ids, fail-closed, consistent with the findings ratchet',
  'tests/unit/ws8-frozen-launch-data.test.js > WS8 frozen Strasbourg launch-data gate > validates the actual frozen launch set with the WS2 verifier',
  'tests/unit/ws8-frozen-launch-data.test.js > WS8 frozen Strasbourg launch-data gate > requires the authoritative source manifest to agree that launch data is current and eligible',
];

/** the gate's decision from a vitest JSON report @param {any} report @param {string} root */
export function gateDecision(report, root = process.cwd()) {
  const failed = []; let passed = 0;
  for (const file of report.testResults || []) {
    const rel = path.relative(root, file.name);
    for (const t of file.assertionResults || []) {
      const id = `${rel} > ${[...(t.ancestorTitles || []), t.title].join(' > ')}`;
      if (t.status === 'passed') passed += 1;
      else if (t.status === 'failed') failed.push(id);
    }
    if ((file.assertionResults || []).length === 0 && file.status === 'failed') failed.push(`${rel} > (the file did not load)`);
  }
  const unexpected = failed.filter((f) => !KNOWN_FAILURES.includes(f));
  const nowPassing = KNOWN_FAILURES.filter((k) => !failed.includes(k));
  return { ok: unexpected.length === 0 && passed > 0, passed, failed: failed.length, unexpected, nowPassing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'unit-gate-')), 'report.json');
  spawnSync('npx', ['vitest', 'run', 'tests/unit', '--reporter=json', `--outputFile=${out}`], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (!fs.existsSync(out)) { console.log('UNIT_GATE {"ok":false,"error":"no test report"}'); process.exit(1); }
  const d = gateDecision(JSON.parse(fs.readFileSync(out, 'utf8')));
  console.log(`UNIT_GATE ${JSON.stringify(d)}`);
  process.exit(d.ok ? 0 : 1);
}
