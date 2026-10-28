import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASELINE_PATH = path.join('docs', 'reports', 'eslint-strict-baseline.json');
const STRICT_CONFIG = 'eslint.strict.config.js';

function getBin(name) {
  const bin = process.platform === 'win32' ? `${name}.cmd` : name;
  return path.join('node_modules', '.bin', bin);
}

function runCapture(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const msg = (res.stderr || res.stdout || '').trim();
    throw new Error(`${cmd} failed (${res.status}). ${msg}`);
  }
  return res.stdout || '';
}

function getTrackedLintFiles() {
  // Deterministic: only lint tracked files so CI/local don't diverge due to generated artifacts.
  const out = runCapture('git', ['ls-files', '-z']);
  return out
    .split('\0')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => /\.(jsx?|mjs|cjs)$/.test(p))
    .filter((p) => fs.existsSync(p));   // a tracked file deleted in the working tree (not yet committed) is not linted
}

function runEslintJson() {
  const eslintBin = getBin('eslint');
  const files = getTrackedLintFiles();
  if (files.length === 0) return [];

  const res = spawnSync(eslintBin, ['--config', STRICT_CONFIG, '--format', 'json', ...files], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  if (res.error) throw res.error;

  // ESLint exit codes:
  // - 0: no lint issues
  // - 1: lint issues found
  // - 2: configuration / runtime error
  if (typeof res.status === 'number' && res.status > 1) {
    const msg = (res.stderr || res.stdout || '').trim();
    throw new Error(`eslint failed (${res.status}). ${msg}`);
  }

  const out = (res.stdout || '').trim();
  if (!out) return [];

  try {
    return JSON.parse(out);
  } catch (err) {
    throw new Error(`Failed to parse eslint JSON output. ${err instanceof Error ? err.message : String(err)}`);
  }
}

function summarize(results) {
  const byRule = {};
  let total = 0;

  for (const file of results) {
    for (const msg of file.messages || []) {
      const ruleId = msg.ruleId || 'unknown';
      byRule[ruleId] = (byRule[ruleId] || 0) + 1;
      total += 1;
    }
  }

  // Stable output ordering.
  const byRuleSorted = Object.fromEntries(
    Object.entries(byRule).sort((a, b) => a[0].localeCompare(b[0]))
  );

  return { total, byRule: byRuleSorted };
}

function readBaseline() {
  const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
  const data = JSON.parse(raw);

  if (!data || typeof data !== 'object') throw new Error('Invalid baseline JSON.');
  if (!('byRule' in data) || typeof data.byRule !== 'object') throw new Error('Invalid baseline JSON (missing byRule).');
  if (!('total' in data) || typeof data.total !== 'number') throw new Error('Invalid baseline JSON (missing total).');

  return data;
}

function writeBaseline(summary) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });

  const data = {
    generatedAt: new Date().toISOString(),
    config: STRICT_CONFIG,
    total: summary.total,
    byRule: summary.byRule,
  };

  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function compare(baseline, current) {
  const regressions = [];

  const baselineByRule = baseline.byRule || {};
  const currentByRule = current.byRule || {};

  for (const [ruleId, count] of Object.entries(currentByRule)) {
    const baselineCount = Number(baselineByRule[ruleId] || 0);
    if (count > baselineCount) {
      regressions.push({ ruleId, baseline: baselineCount, current: count });
    }
  }

  // Also treat an increased total as a regression (even if per-rule checks would catch most cases).
  const totalRegression = current.total > baseline.total;

  regressions.sort((a, b) => (b.current - b.baseline) - (a.current - a.baseline));

  return { regressions, totalRegression };
}

function printTop(summary, max = 8) {
  const top = Object.entries(summary.byRule)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max);

  for (const [ruleId, count] of top) {
    console.log(`- ${ruleId}: ${count}`);
  }
}

const update = process.argv.includes('--update');

try {
  const results = runEslintJson();
  const current = summarize(results);

  if (update) {
    writeBaseline(current);
    console.log(`[lint:strict] baseline updated at ${BASELINE_PATH}`);
    console.log(`[lint:strict] total issues: ${current.total}`);
    printTop(current);
    process.exit(0);
  }

  const baseline = readBaseline();
  const { regressions, totalRegression } = compare(baseline, current);

  if (regressions.length > 0 || totalRegression) {
    console.error('[lint:strict] regression detected vs baseline.');
    console.error(`[lint:strict] baseline total=${baseline.total} current total=${current.total}`);
    console.error('[lint:strict] increased rules (top):');
    for (const r of regressions.slice(0, 10)) {
      console.error(`- ${r.ruleId}: ${r.baseline} -> ${r.current}`);
    }
    process.exit(1);
  }

  console.log('[lint:strict] OK (no regression vs baseline).');
  console.log(`[lint:strict] total issues: baseline=${baseline.total} current=${current.total}`);
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[lint:strict] failed: ${message}`);
  process.exit(2);
}
