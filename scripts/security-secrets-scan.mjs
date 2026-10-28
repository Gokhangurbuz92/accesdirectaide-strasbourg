import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (res.error && res.error.code === 'ENOENT') {
    throw new Error(`Command not found: ${cmd}`);
  }
  if (typeof res.status === 'number') return res.status;
  return 1;
}

function runCapture(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.error && res.error.code === 'ENOENT') {
    throw new Error(`Command not found: ${cmd}`);
  }
  if (res.status !== 0) {
    const err = (res.stderr || Buffer.from('')).toString('utf8');
    throw new Error(`${cmd} failed (${res.status}): ${err.trim()}`);
  }
  return res.stdout || Buffer.from('');
}

function getRepoFiles() {
  // Include untracked-but-not-ignored files (e.g. newly added docs/configs),
  // but exclude ignored files like `.env.local`.
  const out = runCapture('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  return out
    .toString('utf8')
    .split('\0')
    .map((s) => s.trim())
    .filter(Boolean);
}

function copyTrackedFilesToTemp(trackedFiles, tempDir) {
  for (const rel of trackedFiles) {
    // Skip weird paths just in case.
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;

    const src = path.join(process.cwd(), rel);
    const dest = path.join(tempDir, rel);

    const st = fs.statSync(src, { throwIfNoEntry: false });
    if (!st || !st.isFile()) continue;

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

let tempDir = '';
try {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-gitleaks-'));

  const repoFiles = getRepoFiles();
  copyTrackedFilesToTemp(repoFiles, tempDir);

  const exitCode = run('gitleaks', ['detect', '--no-git', '--redact', '--source', tempDir]);
  process.exit(exitCode);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes('Command not found: gitleaks')) {
    console.error('[security] gitleaks is not installed.');
    console.error('Install: brew install gitleaks');
    process.exit(2);
  }

  console.error(`[security] secrets scan failed: ${message}`);
  process.exit(1);
} finally {
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}
