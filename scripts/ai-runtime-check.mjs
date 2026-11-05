#!/usr/bin/env node
/**
 * R46 (D23) — checks the LOCAL AI runtime the product may use (Ollama on loopback, qwen3:8b + nomic-embed-text) and that no cloud fallback is possible.
 *   node scripts/ai-runtime-check.mjs [--json]     (OLLAMA_BASE_URL, default http://127.0.0.1:11434)
 * Exit 0 only when the runtime is READY and cloudFallback is false. Reads the model list only: no prompt, no personal data, nothing downloaded.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function check() {
  const { localRuntimeStatus } = await import('../api/lib/ai-foundation.js');
  const status = await localRuntimeStatus();
  return { ...status, pass: status.state === 'READY' && status.cloudFallback === false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  check().then((s) => {
    if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(s)}\n`);
    else process.stdout.write(`local AI runtime: ${s.state} (${s.locality}); ${Object.entries(s.models).map(([m, v]) => `${m} ${v.present ? 'present' : 'MISSING'}`).join(', ')}; cloud fallback ${s.cloudFallback ? 'POSSIBLE' : 'impossible (policy)'}\n`);
    process.exitCode = s.pass ? 0 : 1;
  }).catch(() => { process.stderr.write('ai-runtime-check: ERROR\n'); process.exitCode = 1; });
}
