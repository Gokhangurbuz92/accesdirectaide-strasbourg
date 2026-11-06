/**
 * R47 (tooling) — the decisions of scripts/release-production.sh (scripts/lib/release-decision.mjs), from recorded Vercel CLI 65.7.0 outputs.
 * R46: `vercel deploy --prod --yes` printed the Inspect / Production URLs, then « Not authorized » while following the build, and exited 1;
 * the deployment was Ready and served the SHA. Now: authorization error + READY + served SHA = WARN (continue to smoke); anything else = FAIL.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { parseDeployOutput, parseInspectState, isTerminalState, releaseDecision, qaDecision } from '../../scripts/lib/release-decision.mjs';

const SHA = 'cc027790eeb5678d2a6b63e80a2c62d0c3189b17';
const OTHER = 'b5c3ceabebfdbdd10a08684a3bcc7cabebe0cecb';
const DEPLOY = 'https://accesdirectaide-strasbourg-abc123def-team-example.vercel.app';
const PREV = 'https://accesdirectaide-strasbourg-zyx987wvu-team-example.vercel.app';

// recorded: the R46 release log, deploy step (team slug and ids replaced by synthetic ones; the repository is public)
const R46_DEPLOY_OUTPUT = `
Vercel CLI 65.7.0
  Inspect         https://vercel.com/team-example/accesdirectaide-strasbourg/SyntheticDeploymentId0000000
  Production      ${DEPLOY}
{
  "status": "error",
  "reason": "deploy_failed",
  "message": "Not authorized",
  "next": [
    {
      "command": "vercel deploy",
      "when": "retry deploy"
    }
  ]
}
Error: Not authorized`;
// the shape of `deploy --no-wait`: progress on stderr, the deployment URL alone on stdout
const NO_WAIT_OUTPUT = `Vercel CLI 65.7.0\n\u001b[36mInspect\u001b[39m: https://vercel.com/team-example/accesdirectaide-strasbourg/XyZ [2s]\n${DEPLOY}\n`;
const BUILD_FAILED_OUTPUT = `Vercel CLI 65.7.0\n  Inspect  https://vercel.com/x/y/z\n  Production  ${DEPLOY}\nError: Command "npm run build" exited with 1\n`;
const AUTH_BEFORE_URL = 'Vercel CLI 65.7.0\nError: The specified token is not valid. Use `vercel login` to generate a new token.\n';
// recorded: `vercel inspect <R46 deployment>` (text) and the fields of `--json` (2026-11-06, read-only)
const R46_INSPECT_TEXT = `Vercel CLI 65.7.0\n> Fetched deployment "x" in team-example [365ms]\n\n  General\n\n    id\t\tdpl_SyntheticDeploymentId0000000\n    name\taccesdirectaide-strasbourg\n    target\tproduction\n    status\t● Ready\n    url\t\t${DEPLOY}\n`;
const R46_INSPECT_JSON = JSON.stringify({ id: 'dpl_SyntheticDeploymentId0000000', name: 'accesdirectaide-strasbourg', url: DEPLOY.replace('https://', ''), target: 'production', readyState: 'READY' });

const base = { requestedSha: SHA, deployExitCode: 1, deployOutput: R46_DEPLOY_OUTPUT, readyState: 'READY', servedSha: SHA, previousUrl: PREV, aliasUrl: DEPLOY };

describe('R47 release decision — parsing the CLI', () => {
  it('reads the deployment URL and the R46 « Not authorized » JSON error, classified as an authorization error', () => {
    expect(parseDeployOutput(R46_DEPLOY_OUTPUT)).toEqual({ deploymentUrl: DEPLOY, cliError: { reason: 'deploy_failed', message: 'Not authorized' }, authError: true });
  });
  it('reads the bare URL of --no-wait (ANSI colours stripped), never the vercel.com Inspect URL', () => {
    expect(parseDeployOutput(NO_WAIT_OUTPUT)).toEqual({ deploymentUrl: DEPLOY, cliError: null, authError: false });
    expect(parseDeployOutput('Inspect https://vercel.com/a/b/c\n').deploymentUrl).toBeNull();
  });
  it('a build failure is a CLI error that is NOT an authorization error; a token error before any URL leaves no URL', () => {
    expect(parseDeployOutput(BUILD_FAILED_OUTPUT)).toMatchObject({ deploymentUrl: DEPLOY, authError: false, cliError: { reason: 'error' } });
    expect(parseDeployOutput(AUTH_BEFORE_URL)).toMatchObject({ deploymentUrl: null, authError: true });
  });
  it('reads the state of inspect (JSON and text) and knows the terminal states', () => {
    expect(parseInspectState(R46_INSPECT_JSON)).toBe('READY');
    expect(parseInspectState(R46_INSPECT_TEXT)).toBe('READY');
    expect(parseInspectState('{"readyState":"BUILDING"}')).toBe('BUILDING');
    expect(parseInspectState('{"readyState":"CANCELLED"}')).toBe('CANCELED');
    expect(parseInspectState('Error: Not authorized')).toBe('UNKNOWN');
    expect(['READY', 'ERROR', 'CANCELED'].every(isTerminalState)).toBe(true);
    expect(['BUILDING', 'QUEUED', 'INITIALIZING', 'UNKNOWN'].some(isTerminalState)).toBe(false);
  });
});

describe('R47 release decision — go / no-go before the smoke test', () => {
  it('R46 replay: « Not authorized » while READY and serving the SHA = WARN, the release continues', () => {
    const d = releaseDecision(base);
    expect(d.verdict).toBe('WARN'); expect(d.deploymentUrl).toBe(DEPLOY);
    expect(d.messages.join('\n')).toMatch(/Not authorized/);
  });
  it('a clean --no-wait deploy, READY, serving the SHA = PASS', () => {
    expect(releaseDecision({ ...base, deployExitCode: 0, deployOutput: NO_WAIT_OUTPUT }).verdict).toBe('PASS');
  });
  it('never treats a CLI error as success: the same « Not authorized » with the deployment not READY = FAIL with the rollback command', () => {
    for (const readyState of ['ERROR', 'CANCELED', 'BUILDING', 'UNKNOWN', 'TIMEOUT(BUILDING)']) {
      const d = releaseDecision({ ...base, readyState });
      expect(d.verdict).toBe('FAIL');
      expect(d.messages.join('\n')).toContain(`rollback ${PREV} --yes`);
    }
  });
  it('FAIL on any mismatch: served SHA, production alias, missing URL, non-authorization error, unexplained exit code, short SHA', () => {
    expect(releaseDecision({ ...base, servedSha: OTHER }).verdict).toBe('FAIL');
    expect(releaseDecision({ ...base, servedSha: '' }).verdict).toBe('FAIL');
    expect(releaseDecision({ ...base, servedSha: SHA.slice(0, 7) }).verdict).toBe('FAIL');
    expect(releaseDecision({ ...base, aliasUrl: PREV }).verdict).toBe('FAIL');
    expect(releaseDecision({ ...base, deployOutput: AUTH_BEFORE_URL }).verdict).toBe('FAIL');
    expect(releaseDecision({ ...base, deployOutput: BUILD_FAILED_OUTPUT }).verdict).toBe('FAIL');
    expect(releaseDecision({ ...base, deployExitCode: 1, deployOutput: NO_WAIT_OUTPUT }).verdict).toBe('FAIL');
    expect(releaseDecision({ ...base, requestedSha: SHA.slice(0, 7) }).verdict).toBe('FAIL');
    expect(releaseDecision({ ...base, previousUrl: '', readyState: 'ERROR' }).messages.join('\n')).toMatch(/no previous production deployment was recorded/);
  });
  it('the CLI the shell script calls: exit 0 on WARN, 1 on FAIL', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r47-rd-'));
    const log = path.join(dir, 'deploy.log'); fs.writeFileSync(log, R46_DEPLOY_OUTPUT);
    const run = (/** @type {string[]} */ extra) => spawnSync(process.execPath, ['scripts/lib/release-decision.mjs', 'decide', '--sha', SHA, '--deploy-exit', '1', '--deploy-log', log, '--prev', PREV, '--alias', DEPLOY, ...extra], { encoding: 'utf8' });
    const warn = run(['--ready', 'READY', '--served', SHA]);
    expect(warn.status).toBe(0); expect(warn.stdout).toMatch(/DECISION WARN/);
    const fail = run(['--ready', 'READY', '--served', OTHER]);
    expect(fail.status).toBe(1); expect(fail.stdout).toMatch(/DECISION FAIL/);
    const url = spawnSync(process.execPath, ['scripts/lib/release-decision.mjs', 'deploy-url', log], { encoding: 'utf8' });
    expect(url.stdout.trim()).toBe(DEPLOY);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('R47 exact-SHA QA evidence', () => {
  // the fields of a real launcher SUMMARY.json (RC5_AUTHZ_QA runs/20261105T234353Z-2b4f97/evidence/SUMMARY.json), reduced to what is decided on
  const TREE = '84abeda93619d680308d3a1cf7bc5e5264f6add6';
  const pass = { run: '20261105T234353Z-2b4f97', verdict: 'RC5_PRODUCT_QA_DIAGNOSTIC_PASS', REAL_E2E_PASS: true, partial_run: false, aborted_at_gate: false,
    missing_mandatory_stages: [], status_totals: { PASS: 34 }, tested: { head: OTHER, tree: TREE, expect_sha: OTHER, sha_overridden: false, status_clean: true } };
  it('accepts a complete PASS of exactly the release commit and tree', () => {
    expect(qaDecision(pass, { releaseSha: OTHER, releaseTree: TREE })).toEqual({ ok: true, reasons: [] });
  });
  it('R46 replay: the last QA PASS tested b5c3cea while cc02779 was released — refused', () => {
    const d = qaDecision(pass, { releaseSha: SHA });
    expect(d.ok).toBe(false); expect(d.reasons.join('\n')).toMatch(/tested SHA b5c3cea\w+ ≠ release SHA cc02779/);
  });
  it('refuses a FAIL verdict, a partial / aborted run, missing stages, FAIL or BLOCKED stages, an overridden SHA, a dirty checkout, another tree', () => {
    const no = (/** @type {any} */ patch, /** @type {any} */ tested = {}) => qaDecision({ ...pass, ...patch, tested: { ...pass.tested, ...tested } }, { releaseSha: OTHER, releaseTree: TREE }).ok;
    expect(no({ verdict: 'RC5_PRODUCT_QA_FAIL' })).toBe(false);
    expect(no({ verdict: undefined })).toBe(false);
    expect(no({ REAL_E2E_PASS: false })).toBe(false);
    expect(no({ partial_run: true })).toBe(false);
    expect(no({ partial_run: undefined })).toBe(false);
    expect(no({ aborted_at_gate: true })).toBe(false);
    expect(no({ missing_mandatory_stages: ['unit_tests'] })).toBe(false);
    expect(no({ status_totals: { PASS: 33, FAIL: 1 } })).toBe(false);
    expect(no({ status_totals: { PASS: 26, BLOCKED: 8 } })).toBe(false);
    expect(no({}, { sha_overridden: true })).toBe(false);
    expect(no({}, { status_clean: false })).toBe(false);
    expect(no({}, { tree: '0'.repeat(40) })).toBe(false);
    expect(no({}, { expect_sha: SHA })).toBe(false);
    expect(qaDecision(null, { releaseSha: OTHER }).ok).toBe(false);
  });
  it('the release script requires QA_SUMMARY, checks it before the gate, runs the secret guard, polls inspect and decides before the smoke test', () => {
    const sh = fs.readFileSync('scripts/release-production.sh', 'utf8');
    const at = (/** @type {string} */ s) => { const i = sh.indexOf(s); expect(i, s).toBeGreaterThan(0); return i; };
    expect(sh).toMatch(/QA_SUMMARY=<RC5_AUTHZ_QA\/runs\/<id>\/evidence\/SUMMARY\.json> is required/);
    expect(at('$DECIDE qa --summary')).toBeLessThan(at('npm ci --no-audit'));
    expect(at('node scripts/release-guard.mjs --log-opts "$FULL" ||')).toBeLessThan(at('npm ci --no-audit'));
    expect(at('deploy --prod --yes --no-wait')).toBeLessThan(at('$VERCEL inspect "$DEPLOY_URL" --json'));
    expect(at('$DECIDE decide')).toBeLessThan(at('if smoke; then'));
    expect(sh).not.toMatch(/release-guard[^\n]*[^|]\|(?!\|)/);   // never through a pipe (`||` is fine)
  });
});

describe('R47 release script — the deploy / verify glue, replayed offline with a fake CLI and a loopback « production domain »', () => {
  /** runs the lines of scripts/release-production.sh from served_sha() to smoke() with a fake `vercel` and SITE on 127.0.0.1 */
  async function replay(/** @type {{ deployOut: string, deployRc: number, state: string, served: string }} */ o) {
    const http = await import('node:http');
    const server = http.createServer((_req, res) => { res.setHeader('x-release-sha', o.served); res.end('{}'); });
    await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
    const port = /** @type {any} */ (server.address()).port;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r47-glue-'));
    fs.writeFileSync(path.join(dir, 'deploy.out'), o.deployOut);
    const fake = path.join(dir, 'vercel');
    fs.writeFileSync(fake, `#!/bin/bash
case "$1" in
  deploy) cat "${dir}/deploy.out"; exit ${o.deployRc} ;;
  inspect) if [ "$3" = "--json" ]; then echo '{"readyState":"${o.state}","url":"${DEPLOY.replace('https://', '')}"}'; else printf '  General\\n    url\\t\\t${DEPLOY}\\n'; fi ;;
esac
`, { mode: 0o755 });
    const sh = fs.readFileSync('scripts/release-production.sh', 'utf8');
    const glue = sh.slice(sh.indexOf('served_sha() {'), sh.indexOf('smoke() {'));
    const script = `set -euo pipefail\nsay() { echo "RELEASE $*"; }\nVERCEL=${fake}; DECIDE="node scripts/lib/release-decision.mjs"; TMPD=${dir}; DEPLOY_TIMEOUT=5\nFULL=${SHA}; PREV=${PREV}; SITE=http://127.0.0.1:${port}\n${glue.replace(/sleep (10|15)/g, 'sleep 0.1')}\necho CONTINUE_TO_SMOKE\n`;
    const r = await new Promise((resolve) => { const p = spawn('bash', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; }); p.on('close', (code) => resolve({ code, out })); });
    server.close(); fs.rmSync(dir, { recursive: true, force: true });
    return /** @type {{ code: number, out: string }} */ (r);
  }
  it('R46 « Not authorized » + READY + SHA served → WARN, then on to the smoke test', async () => {
    const r = await replay({ deployOut: R46_DEPLOY_OUTPUT, deployRc: 1, state: 'READY', served: SHA });
    expect(r.out).toMatch(/DECISION WARN/); expect(r.out).toMatch(/CONTINUE_TO_SMOKE/); expect(r.code).toBe(0);
  });
  it('the same error with another SHA served → FAIL, exit 5, rollback command printed, no smoke', async () => {
    const r = await replay({ deployOut: R46_DEPLOY_OUTPUT, deployRc: 1, state: 'READY', served: OTHER });
    expect(r.code).toBe(5); expect(r.out).toMatch(/DECISION FAIL/); expect(r.out).toContain(`rollback "${PREV}" --yes`); expect(r.out).not.toMatch(/CONTINUE_TO_SMOKE/);
  }, 30000);
  it('a deployment that ends in ERROR → FAIL, exit 5', async () => {
    const r = await replay({ deployOut: NO_WAIT_OUTPUT, deployRc: 0, state: 'ERROR', served: SHA });
    expect(r.code).toBe(5); expect(r.out).toMatch(/is ERROR, not READY/);
  });
  it('a deployment still BUILDING at the timeout → FAIL, exit 5', async () => {
    const r = await replay({ deployOut: NO_WAIT_OUTPUT, deployRc: 0, state: 'BUILDING', served: SHA });
    expect(r.code).toBe(5); expect(r.out).toMatch(/TIMEOUT\(BUILDING\)/);
  }, 30000);
  it('a clean --no-wait deploy, READY and serving the SHA → PASS, on to the smoke test', async () => {
    const r = await replay({ deployOut: NO_WAIT_OUTPUT, deployRc: 0, state: 'READY', served: SHA });
    expect(r.out).toMatch(/DECISION PASS/); expect(r.out).toMatch(/CONTINUE_TO_SMOKE/);
  });
});
