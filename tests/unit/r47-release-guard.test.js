/**
 * R47 (tooling) — the mandatory secret-scan guard (scripts/release-guard.mjs) and the opt-in pre-push hook (scripts/install-git-hooks.mjs).
 * R46 pushed despite « leaks found: 1 » (the scan was read through `| tail`). Proof with a synthetic, harmless canary — an AWS-style access key id built
 * at run time in a temporary repository (never in this file, never committed here): the guard fails on it, in the tree and in the history, and prints
 * the rule and file only; a clean tree passes; the repository's reviewed false positives (.gitleaksignore) still apply and nothing is suppressed globally.
 * The scans need the gitleaks binary (the release machine and the native QA have it); without it only the pure parts run.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactFindings, prePushRanges, runGuard } from '../../scripts/release-guard.mjs';
import { installHook, MARKER } from '../../scripts/install-git-hooks.mjs';

const ROOT = process.cwd();
const HAS_GITLEAKS = spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).status === 0;
const git = (/** @type {string} */ cwd, /** @type {string[]} */ args) => spawnSync('git', ['-c', 'user.email=r47@example.test', '-c', 'user.name=r47', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
/** a fake AWS-style access key id (AKIA + 16 base32 characters), random per run */
const canary = () => 'AKIA' + Array.from(crypto.randomBytes(16), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[b % 32]).join('');

/** a temporary repository with the guard and the scan script (as in a clone) @returns {string} */
function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r47-guard-'));
  git(dir, ['init', '-q', '-b', 'main']);
  fs.mkdirSync(path.join(dir, 'scripts'));
  for (const f of ['release-guard.mjs', 'security-secrets-scan.mjs']) fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(dir, 'scripts', f));
  fs.writeFileSync(path.join(dir, 'README.md'), 'synthetic repository\n');
  git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

describe('R47 release guard — pure parts', () => {
  it('prints rule id, file, line and short commit only — never the matched value', () => {
    const report = [{ RuleID: 'aws-access-token', File: './src/x.js', StartLine: 3, Commit: 'abcdef0123456789', Secret: 'SHOULD-NOT-APPEAR', Match: 'SHOULD-NOT-APPEAR', Line: 'SHOULD-NOT-APPEAR' }];
    const out = redactFindings(report);
    expect(out).toEqual(['aws-access-token src/x.js:3 @abcdef0']);
    expect(out.join('')).not.toContain('SHOULD-NOT-APPEAR');
    expect(redactFindings(/** @type {any} */ (null))).toEqual([]);
  });
  it('pre-push ranges: an update scans remote..local, a new branch everything not on the remote, a deletion nothing', () => {
    const z = '0'.repeat(40), a = 'a'.repeat(40), b = 'b'.repeat(40);
    expect(prePushRanges(`refs/heads/x ${a} refs/heads/x ${b}\nrefs/heads/n ${a} refs/heads/n ${z}\nrefs/heads/d ${z} refs/heads/d ${b}\n`, 'origin'))
      .toEqual([`${b}..${a}`, `${a} --not --remotes=origin`]);
    expect(prePushRanges('')).toEqual([]);
  });
});

describe.skipIf(!HAS_GITLEAKS)('R47 release guard — scans (gitleaks)', () => {
  /** @type {string[]} */ const dirs = [];
  afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

  it('a clean tree passes; a synthetic canary in the tree fails, with the rule and file only', () => {
    const dir = tempRepo(); dirs.push(dir);
    expect(runGuard({ cwd: dir })).toMatchObject({ exitCode: 0 });
    const key = canary();
    fs.writeFileSync(path.join(dir, 'leak.js'), `export const awsKeyId = '${key}';\n`);
    const r = runGuard({ cwd: dir });
    expect(r.exitCode).toBe(1);
    const text = r.lines.join('\n');
    expect(text).toMatch(/aws-access-token leak\.js:1/);
    expect(text).not.toContain(key);
    // the CLI exit code is the guard's (what a pre-push hook and the release script act on), and it prints nothing secret either
    const cli = spawnSync(process.execPath, [path.join(dir, 'scripts/release-guard.mjs'), '--cwd', dir], { encoding: 'utf8' });
    expect(cli.status).toBe(1); expect(cli.stdout + cli.stderr).not.toContain(key);
  });

  it('a canary removed from the tree but still in a commit fails the history scan', () => {
    const dir = tempRepo(); dirs.push(dir);
    const key = canary();
    fs.writeFileSync(path.join(dir, 'leak.js'), `export const awsKeyId = '${key}';\n`);
    git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', 'leak']);
    fs.rmSync(path.join(dir, 'leak.js')); git(dir, ['commit', '-q', '-am', 'remove']);
    expect(runGuard({ cwd: dir }).exitCode).toBe(0);
    const r = runGuard({ cwd: dir, logOpts: ['HEAD'] });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/aws-access-token leak\.js:1 @[0-9a-f]{7}/);
    expect(r.lines.join('\n')).not.toContain(key);
  });

  it('the repository\'s reviewed false positives still apply (.gitleaksignore fingerprints), and they are what keeps the file clean', () => {
    const dir = tempRepo(); dirs.push(dir);
    const rel = 'src/i18n/locales/en/legal.json';
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
    fs.copyFileSync(path.join(ROOT, '.gitleaks.toml'), path.join(dir, '.gitleaks.toml'));
    fs.copyFileSync(path.join(ROOT, '.gitleaksignore'), path.join(dir, '.gitleaksignore'));
    expect(runGuard({ cwd: dir }).exitCode).toBe(0);
    fs.rmSync(path.join(dir, '.gitleaksignore'));
    const r = runGuard({ cwd: dir });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/generic-api-key src\/i18n\/locales\/en\/legal\.json:\d+/);
  });

  it('no global suppression: the config keeps the default rules, its allowlists are path-scoped, and .gitleaksignore holds exact fingerprints only', () => {
    const toml = fs.readFileSync('.gitleaks.toml', 'utf8');
    expect(toml).toMatch(/useDefault = true/);
    expect(toml).not.toMatch(/^\s*disabledRules/m);
    expect(toml).not.toMatch(/^\[allowlist\]/m);   // no top-level (all-rules) allowlist
    const entries = fs.readFileSync('.gitleaksignore', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    for (const e of entries) expect(e).toMatch(/^([0-9a-f]{40}:)?[\w./-]+:[\w-]+:\d+$/);
  });

  it('the pre-push hook (opt-in, this clone only) refuses a push carrying the canary and lets a clean push through', () => {
    const dir = tempRepo(); dirs.push(dir);
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'r47-remote-')); dirs.push(remote);
    git(remote, ['init', '-q', '--bare']);
    git(dir, ['remote', 'add', 'origin', remote]);
    const installed = installHook({ cwd: dir });
    expect(installed.ok).toBe(true);
    expect(fs.readFileSync(String(installed.hookPath), 'utf8')).toContain(MARKER);
    expect(path.relative(fs.realpathSync(dir), fs.realpathSync(String(installed.hookPath)))).toBe(path.join('.git', 'hooks', 'pre-push'));
    const push = () => spawnSync('git', ['push', '-q', 'origin', 'main'], { cwd: dir, encoding: 'utf8' });
    expect(push().status).toBe(0);
    const key = canary();
    fs.writeFileSync(path.join(dir, 'leak.js'), `export const awsKeyId = '${key}';\n`);
    git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', 'leak']);
    fs.rmSync(path.join(dir, 'leak.js')); git(dir, ['commit', '-q', '-am', 'remove']);
    const refused = push();
    expect(refused.status).not.toBe(0);
    expect(refused.stdout + refused.stderr).toMatch(/aws-access-token leak\.js:1/);
    expect(refused.stdout + refused.stderr).not.toContain(key);
    // the leaking commits never reached the remote
    expect(spawnSync('git', ['log', '--oneline', 'main'], { cwd: remote, encoding: 'utf8' }).stdout.trim().split('\n')).toHaveLength(1);
  });
});

describe('R47 hook installer', () => {
  /** @type {string} */ let dir;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r47-hook-')); git(dir, ['init', '-q']); });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  it('never replaces a foreign hook without --force, removes only its own, and leaves core.hooksPath setups alone', () => {
    const hook = path.join(dir, '.git', 'hooks', 'pre-push');
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, '#!/bin/sh\necho mine\n');
    expect(installHook({ cwd: dir }).ok).toBe(false);
    expect(installHook({ cwd: dir, remove: true }).ok).toBe(false);
    expect(fs.readFileSync(hook, 'utf8')).toContain('echo mine');
    expect(installHook({ cwd: dir, force: true }).ok).toBe(true);
    expect((fs.statSync(hook).mode & 0o111) !== 0).toBe(true);
    expect(installHook({ cwd: dir, remove: true }).ok).toBe(true);
    expect(fs.existsSync(hook)).toBe(false);
    spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir });
    expect(installHook({ cwd: dir })).toMatchObject({ ok: false });
    expect(fs.existsSync(path.join(dir, '.githooks', 'pre-push'))).toBe(false);
  });
  it('no hook is committed: the repository tracks nothing under .githooks / .husky and the hook lives in .git only', () => {
    const tracked = spawnSync('git', ['ls-files', '.githooks', '.husky'], { encoding: 'utf8' }).stdout.trim();
    expect(tracked).toBe('');
  });
});
