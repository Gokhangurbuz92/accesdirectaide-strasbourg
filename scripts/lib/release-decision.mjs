#!/usr/bin/env node
/**
 * R47 — the decisions of scripts/release-production.sh, as pure functions (unit-tested with recorded Vercel CLI outputs in
 * tests/unit/r47-release-decision.test.js) and a small CLI the shell script calls. Nothing here talks to Vercel, GitHub or the network.
 *
 * R46: `vercel deploy --prod --yes` (CLI 65.7.0) printed the Inspect and Production URLs, then, while following the build, a JSON
 * {"status":"error","reason":"deploy_failed","message":"Not authorized"} and exited 1 — the deployment itself became Ready and served the SHA.
 * The CLI's OAuth access token (8 h lifetime, refreshed only when a command STARTS) expired during the ~5 min build wait. The release now
 * deploys with --no-wait, polls `vercel inspect <url> --json` (a fresh CLI process each time, which refreshes the token) until a terminal state,
 * and decides from what Vercel and the production domain report — never from the deploy command's exit code alone.
 *
 *   node scripts/lib/release-decision.mjs deploy-url <deploy-log>          → prints the deployment URL (exit 1 when none)
 *   node scripts/lib/release-decision.mjs ready-state <inspect-json-file>  → prints READY | ERROR | CANCELED | BUILDING … | UNKNOWN
 *   node scripts/lib/release-decision.mjs decide --sha <sha> --deploy-exit <n> --deploy-log <file> --ready <state> --served <sha>
 *        [--prev <url>] [--alias <url>]                                    → DECISION PASS|WARN|FAIL lines; exit 0 (PASS/WARN) or 1 (FAIL)
 *   node scripts/lib/release-decision.mjs qa --summary <SUMMARY.json> --sha <sha> [--tree <tree>] → QA PASS|FAIL lines; exit 0 or 1
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const isMainModule = () => { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };

const TERMINAL = new Set(['READY', 'ERROR', 'CANCELED']);
/** the shapes of an authorization failure of the CLI (expired / revoked token, missing scope), never of a build failure */
const AUTH_ERROR = /not authori[sz]ed|forbidden|\b403\b|token[^.\n]*(?:expired|invalid|not valid)|invalid token|not logged in|re-?authenticate|missing scope/i;

const hostOf = (/** @type {string} */ url) => { try { return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).host.toLowerCase(); } catch { return ''; } };
const stripAnsi = (/** @type {unknown} */ t) => String(t || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const isSha = (/** @type {unknown} */ s) => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);

/**
 * The deployment URL and any CLI error in the output of `vercel deploy` (stdout and stderr together).
 * @param {string} text
 * @returns {{ deploymentUrl: string | null, cliError: { reason: string, message: string } | null, authError: boolean }}
 */
export function parseDeployOutput(text) {
  const s = stripAnsi(text);
  let deploymentUrl = null;
  // the « Production  https://… » / « Preview  https://… » line first (the deployment's own URL), then a bare URL line (stdout with --no-wait)
  const labelled = s.match(/^[^\w\n]*(?:Production|Preview):?\s+(https:\/\/[a-z0-9][a-z0-9-]*\.vercel\.app)\b/im);
  if (labelled) deploymentUrl = labelled[1];
  else {
    const bare = s.split(/\r?\n/).map((l) => l.trim()).find((l) => /^https:\/\/[a-z0-9][a-z0-9-]*\.vercel\.app\/?$/i.test(l));
    if (bare) deploymentUrl = bare.replace(/\/$/, '');
  }
  let cliError = null;
  if (/"status"\s*:\s*"error"/.test(s)) {
    const reason = (s.match(/"reason"\s*:\s*"([^"]*)"/) || [])[1] || 'error';
    const message = (s.match(/"message"\s*:\s*"([^"]*)"/) || [])[1] || '';
    cliError = { reason, message };
  } else {
    const line = s.split(/\r?\n/).find((l) => /^\s*Error:/.test(l));
    if (line) cliError = { reason: 'error', message: line.replace(/^\s*Error:\s*/, '').trim() };
  }
  const authError = !!cliError && AUTH_ERROR.test(`${cliError.reason} ${cliError.message}`);
  return { deploymentUrl, cliError, authError };
}

/**
 * The readyState of `vercel inspect <url> --json` (or of the text output: « status  ● Ready »).
 * @param {string} text
 * @returns {string} READY | ERROR | CANCELED | QUEUED | BUILDING | INITIALIZING | UNKNOWN
 */
export function parseInspectState(text) {
  const s = stripAnsi(text);
  const start = s.indexOf('{');
  if (start >= 0) {
    try {
      const j = JSON.parse(s.slice(start, s.lastIndexOf('}') + 1));
      const st = String(j.readyState || j.state || j.status || '').toUpperCase();
      if (st) return st === 'CANCELLED' ? 'CANCELED' : st;
    } catch { /* not JSON: the text form below */ }
  }
  const m = s.match(/^\s*status\s+(?:●\s*)?([A-Za-z]+)/m);
  if (m) { const st = m[1].toUpperCase(); return st === 'CANCELLED' ? 'CANCELED' : st; }
  return 'UNKNOWN';
}

export const isTerminalState = (/** @type {string} */ st) => TERMINAL.has(String(st || '').toUpperCase());

/**
 * Whether the release may go on to its smoke test.
 * @param {{ requestedSha: string, deployExitCode: number, deployOutput: string, readyState: string, servedSha: string,
 *           previousUrl?: string, aliasUrl?: string }} o
 * @returns {{ verdict: 'PASS' | 'WARN' | 'FAIL', deploymentUrl: string | null, messages: string[] }}
 */
export function releaseDecision(o) {
  const messages = [];
  const want = String(o.requestedSha || '').toLowerCase();
  const { deploymentUrl, cliError, authError } = parseDeployOutput(o.deployOutput);
  const rollback = () => o.previousUrl
    ? `rollback: npx --yes vercel@65.7.0 rollback ${o.previousUrl} --yes   (then check x-release-sha on the production domain)`
    : 'rollback: no previous production deployment was recorded — inspect the project in Vercel before any action';
  const fail = (/** @type {string} */ m) => ({ verdict: /** @type {const} */ ('FAIL'), deploymentUrl, messages: [...messages, m, rollback()] });

  if (!isSha(want)) return fail('the requested SHA is not a full 40-character commit');
  if (!deploymentUrl) return fail(`no deployment URL in the deploy output${cliError ? ` (CLI error: ${cliError.reason} ${cliError.message})` : ''}`);
  const state = String(o.readyState || 'UNKNOWN').toUpperCase();
  if (state !== 'READY') return fail(`deployment ${deploymentUrl} is ${state}, not READY`);
  if (o.aliasUrl && hostOf(o.aliasUrl) !== hostOf(deploymentUrl)) return fail(`the production domain points to ${o.aliasUrl}, not to ${deploymentUrl}`);
  const served = String(o.servedSha || '').trim().toLowerCase();
  if (served !== want) return fail(`the production domain serves x-release-sha '${served || 'none'}', not ${want}`);
  if (cliError) {
    if (authError) {
      messages.push(`WARN: the CLI reported « ${cliError.message || cliError.reason} » (authorization) but ${deploymentUrl} is READY and serves ${want.slice(0, 7)}`);
      return { verdict: 'WARN', deploymentUrl, messages };
    }
    return fail(`the CLI reported an error that is not an authorization error: ${cliError.reason} ${cliError.message}`);
  }
  if (Number(o.deployExitCode) !== 0) return fail(`vercel deploy exited ${o.deployExitCode} without a recognised error`);
  messages.push(`deployment ${deploymentUrl} READY and serving ${want.slice(0, 7)}`);
  return { verdict: 'PASS', deploymentUrl, messages };
}

const PASS_VERDICT = /^RC5_[A-Z0-9_]*_PASS$/;

/**
 * The native QA evidence (RC5_AUTHZ_QA runs/<id>/evidence/SUMMARY.json) must be a complete PASS of exactly the commit being released.
 * @param {any} summary @param {{ releaseSha: string, releaseTree?: string }} o
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function qaDecision(summary, o) {
  const reasons = [];
  const want = String(o.releaseSha || '').toLowerCase();
  if (!summary || typeof summary !== 'object') return { ok: false, reasons: ['the QA summary is not a JSON object'] };
  const t = summary.tested || {};
  const verdict = String(summary.verdict || '');
  if (!isSha(want)) reasons.push('the release SHA is not a full 40-character commit');
  if (!PASS_VERDICT.test(verdict) || /FAIL/.test(verdict)) reasons.push(`verdict is '${verdict || 'absent'}', not a PASS`);
  if (summary.REAL_E2E_PASS !== true) reasons.push('REAL_E2E_PASS is not true');
  if (summary.partial_run !== false) reasons.push('the run is partial (or partial_run is absent)');
  if (summary.aborted_at_gate) reasons.push('the run was aborted at a gate');
  if (!Array.isArray(summary.missing_mandatory_stages) || summary.missing_mandatory_stages.length) reasons.push('mandatory stages are missing');
  const totals = summary.status_totals || {};
  for (const k of ['FAIL', 'BLOCKED', 'ERROR']) if (Number(totals[k] || 0) > 0) reasons.push(`status_totals.${k} = ${totals[k]}`);
  const head = String(t.head || '').toLowerCase();
  if (head !== want) reasons.push(`tested SHA ${head || 'absent'} ≠ release SHA ${want}`);
  if (t.expect_sha && String(t.expect_sha).toLowerCase() !== want) reasons.push(`expect_sha ${t.expect_sha} ≠ release SHA`);
  if (t.sha_overridden === true) reasons.push('the tested SHA was overridden');
  if (t.status_clean !== true) reasons.push('the tested checkout was not clean');
  if (o.releaseTree && t.tree && String(t.tree).toLowerCase() !== String(o.releaseTree).toLowerCase()) reasons.push(`tested tree ${t.tree} ≠ release tree ${o.releaseTree}`);
  return { ok: reasons.length === 0, reasons };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const arg = (/** @type {string[]} */ a, /** @type {string} */ name) => { const i = a.indexOf(name); return i >= 0 ? a[i + 1] : undefined; };
const readText = (/** @type {string | undefined} */ f) => (f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');

// R47: compared on real paths — through a symlinked or URL-escaped path the `file://${argv[1]}` test was false and the script did NOTHING (exit 0)
if (isMainModule()) {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'deploy-url') {
    const { deploymentUrl } = parseDeployOutput(readText(a[0]));
    if (!deploymentUrl) process.exit(1);
    console.log(deploymentUrl);
  } else if (cmd === 'ready-state') {
    console.log(parseInspectState(readText(a[0])));
  } else if (cmd === 'decide') {
    const d = releaseDecision({
      requestedSha: arg(a, '--sha') || '', deployExitCode: Number(arg(a, '--deploy-exit') ?? 1), deployOutput: readText(arg(a, '--deploy-log')),
      readyState: arg(a, '--ready') || 'UNKNOWN', servedSha: arg(a, '--served') || '', previousUrl: arg(a, '--prev') || '', aliasUrl: arg(a, '--alias') || '',
    });
    for (const m of d.messages) console.log(`DECISION ${d.verdict}: ${m}`);
    console.log(`DECISION ${d.verdict}`);
    process.exit(d.verdict === 'FAIL' ? 1 : 0);
  } else if (cmd === 'qa') {
    const file = arg(a, '--summary');
    let summary = null;
    try { summary = JSON.parse(fs.readFileSync(String(file), 'utf8')); } catch { console.log(`QA FAIL: cannot read the QA summary '${file || ''}'`); process.exit(1); }
    const d = qaDecision(summary, { releaseSha: arg(a, '--sha') || '', releaseTree: arg(a, '--tree') });
    for (const r of d.reasons) console.log(`QA FAIL: ${r}`);
    console.log(d.ok ? `QA PASS: run ${summary.run} (${summary.verdict}) tested exactly ${String(summary.tested?.head).slice(0, 7)}` : 'QA FAIL');
    process.exit(d.ok ? 0 : 1);
  } else {
    console.error('usage: release-decision.mjs deploy-url|ready-state|decide|qa …'); process.exit(2);
  }
}
