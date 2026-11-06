#!/usr/bin/env node
/**
 * R47 — mandatory secret-scan guard of a push and of a release. R46 pushed despite « leaks found: 1 » because the scan's output was piped to `tail`
 * (the pipe's status was the tail's). This guard decides from the scanners' exit codes AND their JSON reports, and prints only rule ids and files
 * (never a matched value).
 *
 *   node scripts/release-guard.mjs                      the working tree (scripts/security-secrets-scan.mjs = `npm run security:secrets`)
 *   node scripts/release-guard.mjs --log-opts <sha>     + the commits reachable from <sha> (`gitleaks git --log-opts`), e.g. a release commit
 *   node scripts/release-guard.mjs --pre-push [--remote <name>]  + the commits being pushed (git pre-push hook: refs on stdin; scripts/install-git-hooks.mjs)
 *   --cwd <dir>                                         the repository to scan (default: the current one)
 *
 * Exit 0 only when every scan ran and reported nothing; 1 on any finding; 2 when a scanner is missing or failed. The reviewed false positives are
 * the repository's own (.gitleaks.toml allowlists, .gitleaksignore fingerprints); this guard adds no suppression of its own.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isMainModule = () => { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ZERO = /^0+$/;

/**
 * Only what may be printed of a gitleaks JSON report: rule id, file, line, commit (short). Never Secret / Match / Line.
 * @param {any[]} report @returns {string[]}
 */
export function redactFindings(report) {
  return (Array.isArray(report) ? report : []).map((f) => `${f.RuleID || 'rule?'} ${String(f.File || '?').replace(/^\.\//, '')}:${f.StartLine ?? '?'}${f.Commit ? ` @${String(f.Commit).slice(0, 7)}` : ''}`);
}

/**
 * The git log ranges of the commits a pre-push hook is asked to push (stdin lines « <local ref> <local sha> <remote ref> <remote sha> »).
 * @param {string} stdin @param {string} remote
 * @returns {string[]} gitleaks --log-opts values
 */
export function prePushRanges(stdin, remote = 'origin') {
  const out = [];
  for (const line of String(stdin || '').split(/\r?\n/)) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || ZERO.test(localSha)) continue;   // a branch deletion pushes no commit
    out.push(!remoteSha || ZERO.test(remoteSha) ? `${localSha} --not --remotes=${remote}` : `${remoteSha}..${localSha}`);
  }
  return out;
}

/** @param {number | null} status @param {string} reportFile */
function readReport(status, reportFile) {
  let report = [];
  try { report = JSON.parse(fs.readFileSync(reportFile, 'utf8')); } catch { report = []; }
  return { status, findings: redactFindings(report) };
}

/** the working tree, through the repository's own scan (copy of the tracked + untracked-not-ignored files) @param {string} cwd */
function scanTree(cwd, tmp) {
  const reportFile = path.join(tmp, 'tree.json');
  const r = spawnSync(process.execPath, [path.join(HERE, 'security-secrets-scan.mjs')], { cwd, env: { ...process.env, SECRETS_SCAN_REPORT: reportFile }, encoding: 'utf8' });
  if (r.status === 2 || /gitleaks is not installed/.test(r.stderr || '')) return { status: 2, findings: [], error: 'gitleaks is not installed (brew install gitleaks)' };
  return readReport(r.status, reportFile);
}

/** commits, through `gitleaks git` (the repository's .gitleaks.toml / .gitleaksignore apply) @param {string} cwd @param {string} logOpts @param {string} tmp @param {number} i */
function scanCommits(cwd, logOpts, tmp, i) {
  const reportFile = path.join(tmp, `commits-${i}.json`);
  const r = spawnSync('gitleaks', ['git', '--redact', '--no-banner', '--log-level', 'error', '--log-opts', logOpts, '--report-format', 'json', '--report-path', reportFile, '.'], { cwd, encoding: 'utf8' });
  if (r.error && /** @type {any} */ (r.error).code === 'ENOENT') return { status: 2, findings: [], error: 'gitleaks is not installed (brew install gitleaks)' };
  return readReport(r.status, reportFile);
}

/**
 * @param {{ cwd: string, logOpts?: string[] }} o
 * @returns {{ exitCode: number, lines: string[] }}
 */
export function runGuard(o) {
  const lines = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-release-guard-'));
  let exitCode = 0;
  try {
    const scans = [['working tree', scanTree(o.cwd, tmp)]];
    (o.logOpts || []).forEach((opts, i) => scans.push([`commits ${opts}`, scanCommits(o.cwd, opts, tmp, i)]));
    for (const [label, /** @type {any} */ s] of scans) {
      if (s.error) { lines.push(`GUARD FAIL ${label}: ${s.error}`); exitCode = Math.max(exitCode, 2); continue; }
      if (s.findings.length) {
        lines.push(`GUARD FAIL ${label}: ${s.findings.length} finding(s)`);
        for (const f of s.findings) lines.push(`  ${f}`);
        exitCode = Math.max(exitCode, 1);
      } else if (s.status !== 0) {
        lines.push(`GUARD FAIL ${label}: the scanner exited ${s.status} without a readable report`); exitCode = Math.max(exitCode, 2);
      } else lines.push(`GUARD ok ${label}: no leak`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  lines.push(exitCode === 0 ? 'GUARD PASS' : 'GUARD FAIL — fix the finding (or, for a reviewed false positive, add its exact fingerprint to .gitleaksignore with a comment)');
  return { exitCode, lines };
}

// R47: compared on real paths — through a symlinked or URL-escaped path the `file://${argv[1]}` test was false and the script did NOTHING (exit 0)
if (isMainModule()) {
  const a = process.argv.slice(2);
  const val = (/** @type {string} */ n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const cwd = path.resolve(val('--cwd') || process.cwd());
  const logOpts = [];
  for (let i = 0; i < a.length; i += 1) if (a[i] === '--log-opts' && a[i + 1]) logOpts.push(a[i + 1]);
  if (a.includes('--pre-push')) {
    const stdin = fs.readFileSync(0, 'utf8');
    logOpts.push(...prePushRanges(stdin, val('--remote') || 'origin'));
  }
  const { exitCode, lines } = runGuard({ cwd, logOpts });
  for (const l of lines) console.log(l);
  process.exit(exitCode);
}
