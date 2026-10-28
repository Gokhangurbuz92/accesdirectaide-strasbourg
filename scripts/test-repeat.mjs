import { spawnSync } from 'node:child_process';

function nodeCmd() {
  return process.execPath;
}

function safeExit(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function runOnce(iteration) {
  console.log(`\n[test:repeat] Run ${iteration}/3`);
  const result = spawnSync(nodeCmd(), ['scripts/test-run.mjs'], {
    stdio: 'inherit',
    windowsHide: true,
    env: process.env,
  });

  if (result.error) {
    safeExit(`[test:repeat] Failed to run tests: ${String(result.error.message || result.error)}`);
  }

  return result.status ?? 1;
}

for (let i = 1; i <= 3; i += 1) {
  const status = runOnce(i);
  if (status !== 0) process.exit(status);
}

process.exit(0);

