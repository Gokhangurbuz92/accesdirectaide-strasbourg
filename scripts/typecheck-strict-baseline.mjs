import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASELINE_PATH = path.join('docs', 'reports', 'tsc-strict-baseline.json');
const STRICT_TSCONFIG = 'tsconfig.strict.json';

function getBin(name) {
  const bin = process.platform === 'win32' ? `${name}.cmd` : name;
  return path.join('node_modules', '.bin', bin);
}

function runTsc() {
  const tscBin = getBin('tsc');
  const args = ['-p', STRICT_TSCONFIG, '--noEmit', '--pretty', 'false'];
  const res = spawnSync(tscBin, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  if (res.error) throw res.error;

  const out = `${res.stdout || ''}${res.stderr || ''}`;

  // Exit code 0: OK, >0: has errors or config failure.
  return { status: typeof res.status === 'number' ? res.status : 1, output: out };
}

function summarize(output) {
  const byCode = {};
  const re = /error TS(\d+):/g;
  let match;
  while ((match = re.exec(output))) {
    const code = match[1];
    byCode[code] = (byCode[code] || 0) + 1;
  }

  const total = Object.values(byCode).reduce((acc, n) => acc + n, 0);
  const byCodeSorted = Object.fromEntries(Object.entries(byCode).sort((a, b) => a[0].localeCompare(b[0])));

  return { total, byCode: byCodeSorted };
}

function readBaseline() {
  const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
  const data = JSON.parse(raw);

  if (!data || typeof data !== 'object') throw new Error('Invalid baseline JSON.');
  if (!('byCode' in data) || typeof data.byCode !== 'object') throw new Error('Invalid baseline JSON (missing byCode).');
  if (!('total' in data) || typeof data.total !== 'number') throw new Error('Invalid baseline JSON (missing total).');

  return data;
}

function writeBaseline(summary) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });

  const data = {
    generatedAt: new Date().toISOString(),
    config: STRICT_TSCONFIG,
    total: summary.total,
    byCode: summary.byCode,
  };

  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function compare(baseline, current) {
  const regressions = [];

  const baselineByCode = baseline.byCode || {};
  const currentByCode = current.byCode || {};

  for (const [code, count] of Object.entries(currentByCode)) {
    const baselineCount = Number(baselineByCode[code] || 0);
    if (count > baselineCount) {
      regressions.push({ code, baseline: baselineCount, current: count });
    }
  }

  const totalRegression = current.total > baseline.total;

  regressions.sort((a, b) => (b.current - b.baseline) - (a.current - a.baseline));

  return { regressions, totalRegression };
}

function printTop(summary, max = 8) {
  const top = Object.entries(summary.byCode)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max);

  for (const [code, count] of top) {
    console.log(`- TS${code}: ${count}`);
  }
}

const update = process.argv.includes('--update');

try {
  const { status, output } = runTsc();
  const current = summarize(output);

  if (status !== 0 && current.total === 0) {
    throw new Error(`tsc failed (${status}) without parseable TypeScript errors.`);
  }

  if (update) {
    writeBaseline(current);
    console.log(`[typecheck:strict] baseline updated at ${BASELINE_PATH}`);
    console.log(`[typecheck:strict] total errors: ${current.total}`);
    printTop(current);
    process.exit(0);
  }

  const baseline = readBaseline();
  const { regressions, totalRegression } = compare(baseline, current);

  if (regressions.length > 0 || totalRegression) {
    console.error('[typecheck:strict] regression detected vs baseline.');
    console.error(`[typecheck:strict] baseline total=${baseline.total} current total=${current.total}`);
    console.error('[typecheck:strict] increased error codes (top):');
    for (const r of regressions.slice(0, 10)) {
      console.error(`- TS${r.code}: ${r.baseline} -> ${r.current}`);
    }
    process.exit(1);
  }

  console.log('[typecheck:strict] OK (no regression vs baseline).');
  console.log(`[typecheck:strict] total errors: baseline=${baseline.total} current=${current.total}`);
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[typecheck:strict] failed: ${message}`);
  process.exit(2);
}

