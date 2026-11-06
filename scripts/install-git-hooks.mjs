#!/usr/bin/env node
/**
 * R47 — opt-in: installs a git pre-push hook in THIS local clone only (the hooks directory of its .git; nothing is committed, no global git setting
 * is touched). The hook runs scripts/release-guard.mjs on the working tree and on the commits being pushed, and refuses the push on any finding.
 *
 *   node scripts/install-git-hooks.mjs            install (refuses to replace a pre-push hook it did not write)
 *   node scripts/install-git-hooks.mjs --force    replace an existing pre-push hook
 *   node scripts/install-git-hooks.mjs --remove   remove the hook it installed
 *   --cwd <dir>                                   the clone (default: the current one)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const isMainModule = () => { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };

export const MARKER = '# ada-release-guard (scripts/install-git-hooks.mjs)';
export const HOOK = `#!/bin/sh
${MARKER}
# Refuses the push when the secret scan of the working tree or of the pushed commits reports anything (rule ids and files only are printed).
ROOT=$(git rev-parse --show-toplevel) || exit 1
exec node "$ROOT/scripts/release-guard.mjs" --cwd "$ROOT" --pre-push --remote "$1"
`;

/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };

/**
 * @param {{ cwd: string, force?: boolean, remove?: boolean }} o
 * @returns {{ ok: boolean, message: string, hookPath?: string }}
 */
export function installHook(o) {
  const top = git(o.cwd, ['rev-parse', '--show-toplevel']);
  if (!top) return { ok: false, message: 'not a git clone' };
  const hooksPathSetting = git(top, ['config', '--get', 'core.hooksPath']);
  if (hooksPathSetting) return { ok: false, message: `core.hooksPath is set (${hooksPathSetting}): not changing it — add scripts/release-guard.mjs --pre-push to that hook yourself` };
  const hooksDir = path.resolve(top, git(top, ['rev-parse', '--git-path', 'hooks']) || '.git/hooks');
  const hookPath = path.join(hooksDir, 'pre-push');
  const existing = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, 'utf8') : null;
  const ours = existing !== null && existing.includes(MARKER);
  if (o.remove) {
    if (!ours) return { ok: existing === null, message: existing === null ? 'no pre-push hook' : 'the pre-push hook was not installed by this script: left as is', hookPath };
    fs.unlinkSync(hookPath); return { ok: true, message: `removed ${hookPath}`, hookPath };
  }
  if (existing !== null && !ours && !o.force) return { ok: false, message: `${hookPath} exists and was not written by this script (use --force to replace it)`, hookPath };
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(hookPath, HOOK, { mode: 0o755 }); fs.chmodSync(hookPath, 0o755);
  return { ok: true, message: `installed ${hookPath}`, hookPath };
}

// R47: compared on real paths — through a symlinked or URL-escaped path the `file://${argv[1]}` test was false and the script did NOTHING (exit 0)
if (isMainModule()) {
  const a = process.argv.slice(2);
  const i = a.indexOf('--cwd');
  const r = installHook({ cwd: path.resolve(i >= 0 ? a[i + 1] : process.cwd()), force: a.includes('--force'), remove: a.includes('--remove') });
  console.log(r.message);
  process.exit(r.ok ? 0 : 1);
}
